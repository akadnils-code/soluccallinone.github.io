'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTracking, planCourierEvent } = require('../tracking');
const { createFakeDb } = require('../testing/fake-rtdb');

const DB_URL = 'https://demo-default-rtdb.europe-west1.firebasedatabase.app';
const OWNER = 'owner-secret-for-tests-0123456789';
const ID = 'abcdefghij0123456789abcd'; // 24 caractères
const OTHER_ID = 'zzzzzzzzzz0123456789zzzz';
const CLIENT_KEY = 'C'.repeat(43);
const COURIER_KEY = 'K'.repeat(43);
const OTHER_COURIER_KEY = 'Z'.repeat(43);
const CODE = '123456';

function setup(options) {
  const db = createFakeDb(options);
  const clock = { t: 1_800_000_000_000 };
  const app = createTracking({
    database: () => db,
    databaseUrl: () => DB_URL,
    ownerSecret: () => OWNER,
    now: () => (clock.t += 1000)
  });
  const call = (body) => app.handle({ body });
  return { db, clock, call };
}

async function publish(call, over) {
  const o = Object.assign({ id: ID, s: 1, bad: 0, code: CODE, ck: CLIENT_KEY, dk: COURIER_KEY }, over || {});
  return call({
    action: 'publish', db: DB_URL, ownerKey: OWNER, id: o.id,
    clientKey: o.ck, courierKey: o.dk, deliveryCode: o.code,
    allowRegress: o.allowRegress,
    patch: { v: 'Boutique', p: 'Produit', s: o.s, bad: o.bad, t: 1 }
  });
}

const courier = (call, event, over) =>
  call(Object.assign({ action: 'courierEvent', id: ID, courierKey: COURIER_KEY, event, eventId: event + '-' + ID }, over || {}));

const events = (db) => Object.values(db.read('track/' + ID).ev || {});
const rejectsWith = (promise, status) =>
  assert.rejects(promise, (error) => { assert.equal(error.status, status, error.message); return true; });

/* ---------- événements livreur : cas nominaux ---------- */

test('Récupéré : la commande validée passe en route avec un seul événement horodaté par le serveur', async () => {
  const { db, call } = setup();
  await publish(call);
  const r = await courier(call, 'pickup');
  assert.equal(r.ok, true);
  assert.equal(r.duplicate, false);
  assert.equal(db.read('track/' + ID).s, 2);
  assert.equal(events(db).filter((e) => /récupéré/.test(e.x)).length, 1);
  assert.equal(r.data.dc, undefined, 'le code de livraison ne sort jamais vers le livreur');
});

test('Livré : exige le bon code, passe à 3 et clôt la livraison', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'pickup');
  const r = await courier(call, 'delivered', { code: CODE });
  assert.equal(r.duplicate, false);
  assert.equal(db.read('track/' + ID).s, 3);
  assert.ok(events(db).some((e) => e.x === 'Colis livré'));
});

test('Refusé : pose bad=1 avec le motif', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'refused', { reason: 'Client absent' });
  const rec = db.read('track/' + ID);
  assert.equal(rec.bad, 1);
  assert.equal(rec.r, 'Client absent');
  assert.ok(events(db).some((e) => e.x === 'Livraison échouée : Client absent'));
});

test('Refusé sans motif : libellé par défaut', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'refused');
  assert.equal(db.read('track/' + ID).r, 'Refusé');
  assert.ok(events(db).some((e) => e.x === 'Livraison refusée par le client'));
});

test('Livré depuis « validée » (sans Récupéré préalable) est accepté avec le code', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'delivered', { code: CODE });
  assert.equal(db.read('track/' + ID).s, 3);
});

test('l’ancienne action « deliver » passe par le même contrôle', async () => {
  const { db, call } = setup();
  await publish(call);
  await call({ action: 'deliver', id: ID, courierKey: COURIER_KEY, code: CODE });
  assert.equal(db.read('track/' + ID).s, 3);
});

/* ---------- idempotence ---------- */

test('Récupéré envoyé 3 fois (même eventId) : un seul changement', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'pickup');
  const before = JSON.stringify(db.read('track/' + ID));
  const again = await courier(call, 'pickup');
  const third = await courier(call, 'pickup');
  assert.equal(again.duplicate, true);
  assert.equal(third.duplicate, true);
  assert.equal(JSON.stringify(db.read('track/' + ID)), before);
});

test('Récupéré rejoué avec un autre eventId : aucun second événement', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'pickup');
  const before = events(db).length;
  const r = await courier(call, 'pickup', { eventId: 'autre-identifiant-1' });
  assert.equal(r.duplicate, true);
  assert.equal(events(db).length, before);
});

test('Récupéré sans eventId : toujours idempotent grâce au statut', async () => {
  const { db, call } = setup();
  await publish(call);
  await call({ action: 'courierEvent', id: ID, courierKey: COURIER_KEY, event: 'pickup' });
  const before = events(db).length;
  const r = await call({ action: 'courierEvent', id: ID, courierKey: COURIER_KEY, event: 'pickup' });
  assert.equal(r.duplicate, true);
  assert.equal(events(db).length, before);
});

test('Refusé rejoué : réponse ok, pas de second événement ni de 409', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'refused', { reason: 'Client absent' });
  const before = events(db).length;
  const r = await courier(call, 'refused', { eventId: 'refus-bis-0001', reason: 'Autre motif' });
  assert.equal(r.duplicate, true);
  assert.equal(events(db).length, before);
  assert.equal(db.read('track/' + ID).r, 'Client absent', 'le motif d’origine est conservé');
});

test('Livré rejoué : ok sans second événement et sans consommer d’essai de code', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'delivered', { code: CODE });
  const before = JSON.stringify(db.read('track/' + ID));
  const r = await courier(call, 'delivered', { eventId: 'livre-bis-0001', code: '000000' });
  assert.equal(r.duplicate, true);
  assert.equal(JSON.stringify(db.read('track/' + ID)), before);
  assert.equal(db.read('_privateTrackAuth/' + ID).failedAttempts, 0);
});

test('Récupéré après Livré : sans effet (l’événement est périmé)', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'delivered', { code: CODE });
  const r = await courier(call, 'pickup', { eventId: 'tardif-0001' });
  assert.equal(r.duplicate, true);
  assert.equal(db.read('track/' + ID).s, 3);
});

test('5 envois simultanés du même Récupéré : exactement un changement', async () => {
  const { db, call } = setup();
  await publish(call);
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => courier(call, 'pickup')));
  assert.equal(results.filter((r) => r.duplicate === false).length, 1);
  assert.equal(events(db).filter((e) => /récupéré/.test(e.x)).length, 1);
  assert.equal(db.read('track/' + ID).s, 2);
});

test('l’historique des eventId est borné', async () => {
  const { db, call } = setup();
  await publish(call);
  for (let i = 0; i < 60; i += 1) await courier(call, 'pickup', { eventId: 'evenement-' + String(i).padStart(4, '0') });
  assert.ok(Object.keys(db.read('_privateTrackAuth/' + ID).events).length <= 40);
});

test('l’ancien courierUpdate « Récupéré » répété n’ajoute pas d’événement', async () => {
  const { db, call } = setup();
  await publish(call);
  const patch = { s: 2, t: 5, ev: { e5: { t: 5, x: 'Colis récupéré, le livreur est en route' } } };
  await call({ action: 'courierUpdate', id: ID, courierKey: COURIER_KEY, patch });
  const before = JSON.stringify(db.read('track/' + ID));
  await call({ action: 'courierUpdate', id: ID, courierKey: COURIER_KEY, patch: Object.assign({}, patch, { ev: { e9: { t: 9, x: 'bis' } } }) });
  assert.equal(JSON.stringify(db.read('track/' + ID)), before);
});

/* ---------- transitions ---------- */

test('transitions : tableau de décision', () => {
  const kinds = (kind, rec) => planCourierEvent(kind, rec).type;
  assert.equal(kinds('pickup', { s: 0 }), 'reject');
  assert.equal(kinds('pickup', { s: 1 }), 'apply');
  assert.equal(kinds('pickup', { s: 2 }), 'noop');
  assert.equal(kinds('pickup', { s: 3 }), 'noop');
  assert.equal(kinds('pickup', { s: 1, bad: 1 }), 'reject');
  assert.equal(kinds('refused', { s: 0 }), 'reject');
  assert.equal(kinds('refused', { s: 1 }), 'apply');
  assert.equal(kinds('refused', { s: 2 }), 'apply');
  assert.equal(kinds('refused', { s: 3 }), 'reject');
  assert.equal(kinds('refused', { s: 2, bad: 1 }), 'noop');
  assert.equal(kinds('delivered', { s: 0 }), 'reject');
  assert.equal(kinds('delivered', { s: 1 }), 'apply');
  assert.equal(kinds('delivered', { s: 2 }), 'apply');
  assert.equal(kinds('delivered', { s: 3 }), 'noop');
  assert.equal(kinds('delivered', { s: 2, bad: 1 }), 'reject');
});

test('commande non validée (s=0) : aucun événement livreur accepté', async () => {
  const { db, call } = setup();
  await publish(call, { s: 0 });
  await rejectsWith(courier(call, 'pickup'), 409);
  await rejectsWith(courier(call, 'refused'), 409);
  await rejectsWith(courier(call, 'delivered', { code: CODE }), 409);
  assert.equal(db.read('track/' + ID).s, 0);
});

test('commande refusée : ni Récupéré ni Livré', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'refused');
  await rejectsWith(courier(call, 'pickup', { eventId: 'pick-apres-refus' }), 409);
  await rejectsWith(courier(call, 'delivered', { eventId: 'liv-apres-refus', code: CODE }), 409);
  assert.equal(db.read('track/' + ID).s, 1);
});

test('commande livrée : Refusé impossible', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'delivered', { code: CODE });
  await rejectsWith(courier(call, 'refused', { eventId: 'refus-apres-livre' }), 409);
  assert.equal(db.read('track/' + ID).bad, 0);
});

/* ---------- code de livraison ---------- */

test('Livré : mauvais code refusé (401), la commande ne change pas', async () => {
  const { db, call } = setup();
  await publish(call);
  await rejectsWith(courier(call, 'delivered', { code: '000000' }), 401);
  assert.equal(db.read('track/' + ID).s, 1);
  assert.equal(db.read('_privateTrackAuth/' + ID).failedAttempts, 1);
});

test('Livré : code absent ou mal formé refusé (400)', async () => {
  const { call } = setup();
  await publish(call);
  await rejectsWith(courier(call, 'delivered'), 400);
  await rejectsWith(courier(call, 'delivered', { code: '12345' }), 400);
  await rejectsWith(courier(call, 'delivered', { code: 'abcdef' }), 400);
});

test('Livré : 3 mauvais codes bloquent 30 minutes, même avec le bon code ensuite', async () => {
  const { db, clock, call } = setup();
  await publish(call);
  await rejectsWith(courier(call, 'delivered', { code: '000001' }), 401);
  await rejectsWith(courier(call, 'delivered', { code: '000002' }), 401);
  await rejectsWith(courier(call, 'delivered', { code: '000003' }), 429);
  await rejectsWith(courier(call, 'delivered', { code: CODE }), 429);
  assert.equal(db.read('track/' + ID).s, 1);
  clock.t += 31 * 60 * 1000;
  await courier(call, 'delivered', { code: CODE });
  assert.equal(db.read('track/' + ID).s, 3);
});

/* ---------- jetons invalides et accès non autorisés ---------- */

test('jeton livreur incorrect : 403 et aucun changement', async () => {
  const { db, call } = setup();
  await publish(call);
  const before = JSON.stringify(db.read('track/' + ID));
  await rejectsWith(courier(call, 'pickup', { courierKey: OTHER_COURIER_KEY }), 403);
  await rejectsWith(courier(call, 'refused', { courierKey: OTHER_COURIER_KEY }), 403);
  await rejectsWith(courier(call, 'delivered', { courierKey: OTHER_COURIER_KEY, code: CODE }), 403);
  assert.equal(JSON.stringify(db.read('track/' + ID)), before);
  assert.equal(db.read('_privateTrackAuth/' + ID).failedAttempts, 0, 'un jeton invalide ne teste pas le code');
});

test('jeton livreur absent ou mal formé : 403', async () => {
  const { call } = setup();
  await publish(call);
  await rejectsWith(call({ action: 'courierEvent', id: ID, event: 'pickup' }), 403);
  await rejectsWith(courier(call, 'pickup', { courierKey: 'court' }), 403);
  await rejectsWith(courier(call, 'pickup', { courierKey: 12345 }), 403);
  await rejectsWith(courier(call, 'pickup', { courierKey: '!'.repeat(43) }), 403);
});

test('la clé client ne permet pas d’agir comme livreur', async () => {
  const { db, call } = setup();
  await publish(call);
  await rejectsWith(courier(call, 'pickup', { courierKey: CLIENT_KEY }), 403);
  assert.equal(db.read('track/' + ID).s, 1);
});

test('la clé propriétaire ne passe pas comme jeton livreur', async () => {
  const { call } = setup();
  await publish(call);
  await rejectsWith(courier(call, 'pickup', { courierKey: OWNER }), 403);
  await rejectsWith(courier(call, 'pickup', { courierKey: undefined, ownerKey: OWNER }), 403);
});

test('le jeton d’une commande ne vaut rien sur une autre commande', async () => {
  const { db, call } = setup();
  await publish(call);
  await publish(call, { id: OTHER_ID, dk: OTHER_COURIER_KEY, ck: 'D'.repeat(43) });
  await rejectsWith(courier(call, 'pickup', { id: OTHER_ID }), 403);
  assert.equal(db.read('track/' + OTHER_ID).s, 1);
  await courier(call, 'pickup', { id: OTHER_ID, courierKey: OTHER_COURIER_KEY });
  assert.equal(db.read('track/' + OTHER_ID).s, 2);
  assert.equal(db.read('track/' + ID).s, 1);
});

test('identifiant invalide : 400 ; commande inconnue : 404', async () => {
  const { call } = setup();
  await rejectsWith(courier(call, 'pickup', { id: 'court' }), 400);
  await rejectsWith(courier(call, 'pickup', { id: '../../secret' }), 400);
  await rejectsWith(courier(call, 'pickup', { id: ID }), 404);
});

test('événement inconnu, eventId ou motif invalides : 400', async () => {
  const { call } = setup();
  await publish(call);
  await rejectsWith(courier(call, 'teleport'), 400);
  await rejectsWith(courier(call, 'pickup', { event: undefined }), 400);
  await rejectsWith(courier(call, 'pickup', { eventId: 'a b' }), 400);
  await rejectsWith(courier(call, 'pickup', { eventId: 42 }), 400);
  await rejectsWith(courier(call, 'refused', { reason: { x: 1 } }), 400);
});

test('requête trop grosse ou mal formée', async () => {
  const { call } = setup();
  await rejectsWith(call(null), 400);
  await rejectsWith(call([]), 400);
  await rejectsWith(call({ action: 'courierEvent', id: ID, pad: 'x'.repeat(70000) }), 413);
  await rejectsWith(call({ action: 'inconnue', id: ID }), 400);
});

test('le client ne peut ni changer le statut ni écrire comme livreur', async () => {
  const { db, call } = setup();
  await publish(call);
  await rejectsWith(call({ action: 'clientUpdate', id: ID, clientKey: CLIENT_KEY, patch: { s: 3 } }), 400);
  await rejectsWith(call({ action: 'clientUpdate', id: ID, clientKey: CLIENT_KEY, patch: { bad: 1 } }), 400);
  await rejectsWith(call({ action: 'clientUpdate', id: ID, clientKey: COURIER_KEY, patch: { rt: 5 } }), 403);
  await rejectsWith(call({ action: 'courierEvent', id: ID, courierKey: CLIENT_KEY, event: 'delivered', code: CODE }), 403);
  assert.equal(db.read('track/' + ID).s, 1);
});

test('le livreur ne peut ni livrer ni modifier la fiche via courierUpdate', async () => {
  const { db, call } = setup();
  await publish(call);
  await rejectsWith(call({ action: 'courierUpdate', id: ID, courierKey: COURIER_KEY, patch: { s: 3 } }), 403);
  await rejectsWith(call({ action: 'courierUpdate', id: ID, courierKey: COURIER_KEY, patch: { bad: 0 } }), 400);
  await rejectsWith(call({ action: 'courierUpdate', id: ID, courierKey: COURIER_KEY, patch: { v: 'Pirate' } }), 400);
  await rejectsWith(call({ action: 'courierUpdate', id: ID, courierKey: CLIENT_KEY, patch: { pos: [1, 2] } }), 403);
  assert.equal(db.read('track/' + ID).v, 'Boutique');
  assert.equal(db.read('track/' + ID).s, 1);
});

test('publication et lecture propriétaire : clé requise, jamais renvoyée', async () => {
  const { call } = setup();
  await rejectsWith(call({ action: 'publish', db: DB_URL, ownerKey: 'mauvaise', id: ID, clientKey: CLIENT_KEY, courierKey: COURIER_KEY, deliveryCode: CODE, patch: {} }), 403);
  await rejectsWith(call({ action: 'publish', db: 'https://autre.firebaseio.com', ownerKey: OWNER, id: ID, clientKey: CLIENT_KEY, courierKey: COURIER_KEY, deliveryCode: CODE, patch: {} }), 400);
  await publish(call);
  const owner = await call({ action: 'read', id: ID, ownerKey: OWNER });
  assert.equal(JSON.stringify(owner).includes(OWNER), false);
  assert.equal(owner.dc, undefined);
  await rejectsWith(call({ action: 'read', id: ID, ownerKey: 'mauvaise' }), 403);
  await rejectsWith(call({ action: 'ping', db: DB_URL, ownerKey: 'mauvaise' }), 403);
  assert.deepEqual(await call({ action: 'ping', db: DB_URL, ownerKey: OWNER }), { ok: true });
});

test('lecture : le code de livraison n’est donné qu’au client', async () => {
  const { call } = setup();
  await publish(call);
  const asClient = await call({ action: 'read', id: ID, clientKey: CLIENT_KEY });
  const asCourier = await call({ action: 'read', id: ID, courierKey: COURIER_KEY });
  assert.equal(asClient.dc, CODE);
  assert.equal(asCourier.dc, undefined);
  await rejectsWith(call({ action: 'read', id: ID, courierKey: OTHER_COURIER_KEY }), 403);
});

test('secret propriétaire vide côté serveur : aucune clé ne passe', async () => {
  const db = createFakeDb();
  const app = createTracking({ database: () => db, databaseUrl: () => DB_URL, ownerSecret: () => '' });
  await rejectsWith(app.handle({ body: { action: 'ping', db: DB_URL, ownerKey: 'x' } }), 403);
});

/* ---------- événement non perdu si la commande n'est pas encore publiée ---------- */

test('commande pas encore publiée : 404 (à rejouer), puis succès avec le même eventId', async () => {
  const { db, call } = setup();
  await rejectsWith(courier(call, 'pickup'), 404);
  await publish(call);
  const r = await courier(call, 'pickup');
  assert.equal(r.duplicate, false);
  assert.equal(db.read('track/' + ID).s, 2);
});

test('l’événement livreur reste en base même si le propriétaire est hors ligne', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'pickup');
  // le propriétaire revient plus tard et lit l'état : l'événement est là
  const state = await call({ action: 'read', id: ID, ownerKey: OWNER });
  assert.equal(state.s, 2);
  assert.ok(Object.values(state.ev).some((e) => /récupéré/.test(e.x)));
  assert.equal(db.read('track/' + ID).s, 2);
});

/* ---------- publication propriétaire périmée ---------- */

test('une publication périmée du propriétaire n’efface pas « Récupéré »', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'pickup');
  const r = await publish(call, { s: 1 }); // l'appli du propriétaire n'a pas encore reçu l'événement
  assert.equal(r.kept, true);
  assert.equal(db.read('track/' + ID).s, 2);
  assert.ok(!events(db).some((e) => e.x === 'Commande validée'), 'pas d’événement obsolète ajouté');
});

test('une publication périmée n’annule pas un « Refusé » du livreur', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'refused');
  await publish(call, { s: 1, bad: 0 });
  assert.equal(db.read('track/' + ID).bad, 1);
});

test('annulation par le propriétaire après « Récupéré » : bad=1 et événement conservés, statut non abaissé', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'pickup');
  await call({
    action: 'publish', db: DB_URL, ownerKey: OWNER, id: ID, clientKey: CLIENT_KEY, courierKey: COURIER_KEY, deliveryCode: CODE,
    patch: { s: 0, bad: 1, t: 50, ev: { e50: { t: 50, x: 'Commande annulée ou refusée' } } }
  });
  const rec = db.read('track/' + ID);
  assert.equal(rec.bad, 1);
  assert.equal(rec.s, 2);
  assert.ok(events(db).some((e) => e.x === 'Commande annulée ou refusée'));
});

test('correction manuelle du propriétaire (allowRegress) : le statut peut redescendre', async () => {
  const { db, call } = setup();
  await publish(call);
  await courier(call, 'refused');
  await publish(call, { s: 1, bad: 0, allowRegress: true });
  assert.equal(db.read('track/' + ID).bad, 0);
});

test('republier deux fois le même état n’ajoute pas d’événement d’historique', async () => {
  const { db, call } = setup();
  const pub = (s) => call({
    action: 'publish', db: DB_URL, ownerKey: OWNER, id: ID, clientKey: CLIENT_KEY, courierKey: COURIER_KEY, deliveryCode: CODE,
    patch: { s, bad: 0, t: 1, ev: { ['e' + (100 + s)]: { t: 100 + s, x: 'Commande validée ' + Math.random() } } }
  });
  await pub(1);
  await pub(1);
  await pub(1);
  assert.equal(events(db).length, 1);
  await pub(2);
  assert.equal(events(db).length, 2);
});

test('publication normale vers l’avant et premier envoi', async () => {
  const { db, call } = setup();
  const first = await publish(call, { s: 0 });
  assert.equal(first.kept, undefined);
  await publish(call, { s: 1 });
  assert.equal(db.read('track/' + ID).s, 1);
});

/* ---------- robustesse : mêmes résultats avec un cache chaud ---------- */

test('mêmes résultats avec un cache de base déjà chaud', async () => {
  const { db, call } = setup({ coldCache: false });
  await publish(call);
  await courier(call, 'pickup');
  await courier(call, 'pickup');
  await courier(call, 'delivered', { code: CODE });
  assert.equal(db.read('track/' + ID).s, 3);
  assert.equal(events(db).length, 2, 'un événement Récupéré et un événement Livré, sans doublon');
});

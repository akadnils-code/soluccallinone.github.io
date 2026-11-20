'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const AioEvents = require('../track-events.js');
const { classify, createOutbox, describe, drain } = AioEvents;

function memoryStorage(initial) {
  const data = Object.assign({}, initial || {});
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    dump: () => data
  };
}

function setup(sendImpl, storage) {
  const clock = { t: 1_000_000 };
  const timers = [];
  const sent = [];
  const states = [];
  const store = storage || memoryStorage();
  const box = createOutbox({
    storage: store,
    now: () => clock.t,
    send: async (item) => { sent.push(item.eventId + '|' + item.kind); return sendImpl(item, sent.length); },
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {},
    onChange: (s) => states.push(s)
  });
  return { box, clock, timers, sent, states, store };
}

const MISSION = { tid: 't'.repeat(32), api: 'https://europe-west1-demo-app.cloudfunctions.net/track', courierKey: 'K'.repeat(43) };
const httpError = (status, message) => Object.assign(new Error(message || 'x'), { status });

/* ---------- classify ---------- */

test('classify : réseau, 404 et 5xx sont rejoués ; les refus de droits ne le sont pas', () => {
  assert.equal(classify(new TypeError('Failed to fetch')).retry, true);
  assert.equal(classify(httpError(404)).retry, true);
  assert.equal(classify(httpError(500)).retry, true);
  assert.equal(classify(httpError(503)).retry, true);
  assert.equal(classify(httpError(408)).retry, true);
  assert.equal(classify(httpError(403)).retry, false);
  assert.equal(classify(httpError(401)).retry, false);
  assert.equal(classify(httpError(409)).retry, false);
  assert.equal(classify(httpError(429)).retry, false);
  assert.equal(classify(httpError(400, 'Invalid status.')).message, 'Invalid status.');
  assert.equal(classify(Object.assign(new Error('URL invalide'), { fatal: true })).retry, false);
});

test('classify : chaque cas a un message lisible, jamais « Code invalide » pour une panne réseau', () => {
  assert.match(classify(new TypeError('Failed to fetch')).message, /connexion/i);
  assert.match(classify(httpError(401)).message, /code/i);
  assert.match(classify(httpError(403)).message, /lien/i);
  assert.doesNotMatch(classify(new TypeError('x')).message, /incorrect/i);
});

/* ---------- file d'attente livreur ---------- */

test('envoi réussi : l’événement est marqué envoyé avec son identifiant stable', async () => {
  const { box, sent } = setup(async () => ({ ok: true, duplicate: false }));
  box.enqueue(Object.assign({ kind: 'pickup' }, MISSION));
  await box.flush();
  assert.deepEqual(sent, ['pickup-' + MISSION.tid + '|pickup']);
  assert.equal(box.list()[0].status, 'done');
  assert.equal(box.summary().pending, 0);
});

test('double appui : un seul envoi pour une même commande et un même type', async () => {
  const { box, sent } = setup(async () => ({ ok: true }));
  const a = box.enqueue(Object.assign({ kind: 'pickup' }, MISSION));
  const b = box.enqueue(Object.assign({ kind: 'pickup' }, MISSION));
  assert.equal(a, b);
  await box.flush();
  box.enqueue(Object.assign({ kind: 'pickup' }, MISSION)); // après succès : toujours pas de renvoi
  await box.flush();
  assert.equal(sent.length, 1);
  assert.equal(box.list().length, 1);
});

test('types différents ou commandes différentes : envois distincts', async () => {
  const { box, sent } = setup(async () => ({ ok: true }));
  box.enqueue(Object.assign({ kind: 'pickup' }, MISSION));
  box.enqueue(Object.assign({ kind: 'refused', reason: 'Client absent' }, MISSION));
  box.enqueue(Object.assign({}, MISSION, { kind: 'pickup', tid: 'u'.repeat(32) }));
  await box.flush();
  assert.equal(sent.length, 3);
});

test('réseau coupé : l’événement est conservé et rejoué avec le même identifiant', async () => {
  let online = false;
  const { box, clock, sent } = setup(async () => {
    if (!online) throw new TypeError('Failed to fetch');
    return { ok: true };
  });
  box.enqueue(Object.assign({ kind: 'pickup' }, MISSION));
  await box.flush();
  assert.equal(box.list()[0].status, 'pending');
  assert.match(box.summary().error, /connexion/i);
  online = true;
  clock.t += 3000; // délai de reprise écoulé
  await box.flush();
  assert.equal(box.list()[0].status, 'done');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].split('|')[0], sent[1].split('|')[0], 'même eventId à chaque tentative');
});

test('les tentatives s’espacent (reprise croissante) et ne sont pas rejouées trop tôt', async () => {
  const { box, clock, sent, timers } = setup(async () => { throw httpError(503); });
  box.enqueue(Object.assign({ kind: 'pickup' }, MISSION));
  await box.flush();
  const first = box.list()[0].next - clock.t;
  await box.flush(); // trop tôt : rien n'est renvoyé
  assert.equal(sent.length, 1);
  clock.t += first;
  await box.flush();
  const second = box.list()[0].next - clock.t;
  assert.ok(second > first, 'le délai augmente');
  assert.ok(timers.length >= 1, 'une reprise automatique est programmée');
});

test('commande pas encore publiée (404) : rejouée puis acceptée', async () => {
  let published = false;
  const { box, clock } = setup(async () => {
    if (!published) throw httpError(404, 'Tracking record not found.');
    return { ok: true };
  });
  box.enqueue(Object.assign({ kind: 'pickup' }, MISSION));
  await box.flush();
  assert.equal(box.list()[0].status, 'pending');
  published = true;
  clock.t += 5000;
  await box.flush();
  assert.equal(box.list()[0].status, 'done');
});

test('refus définitif (jeton invalide 403) : conservé en « failed » avec un message, jamais effacé', async () => {
  const { box, clock, sent } = setup(async () => { throw httpError(403, 'Tracking link is invalid.'); });
  box.enqueue(Object.assign({ kind: 'pickup' }, MISSION));
  await box.flush();
  const item = box.list()[0];
  assert.equal(item.status, 'failed');
  assert.match(item.error, /lien livreur invalide/i);
  clock.t += 10 * 60 * 1000;
  await box.flush();
  assert.equal(sent.length, 1, 'pas de nouvelle tentative inutile');
  assert.equal(describe(box.summary()).error, true);
  assert.match(describe(box.summary()).text, /Récupéré non envoyé/);
});

test('transition refusée (409) : explicite, conservé en « failed »', async () => {
  const { box } = setup(async () => { throw httpError(409, 'Delivery is already closed.'); });
  box.enqueue(Object.assign({ kind: 'refused' }, MISSION));
  await box.flush();
  assert.equal(box.list()[0].status, 'failed');
  assert.match(box.list()[0].error, /état actuel/);
});

test('un événement refusé peut être renvoyé après correction (nouvel enqueue)', async () => {
  let ok = false;
  const { box } = setup(async () => { if (!ok) throw httpError(403); return { ok: true }; });
  box.enqueue(Object.assign({ kind: 'pickup' }, MISSION));
  await box.flush();
  assert.equal(box.list()[0].status, 'failed');
  ok = true;
  box.enqueue(Object.assign({ kind: 'pickup' }, MISSION));
  await box.flush();
  assert.equal(box.list().length, 1);
  assert.equal(box.list()[0].status, 'done');
});

test('abandon explicite après 24 h de nouvelles tentatives infructueuses', async () => {
  const { box, clock } = setup(async () => { throw new TypeError('Failed to fetch'); });
  box.enqueue(Object.assign({ kind: 'pickup' }, MISSION));
  await box.flush();
  clock.t += 25 * 3600 * 1000;
  await box.retryNow();
  const item = box.list()[0];
  assert.equal(item.status, 'failed');
  assert.match(item.error, /Abandon après 24 h/);
});

test('rechargement de la page : la file est relue et rejouée (rien n’est perdu)', async () => {
  const store = memoryStorage();
  const first = setup(async () => { throw new TypeError('Failed to fetch'); }, store);
  first.box.enqueue(Object.assign({ kind: 'pickup' }, MISSION));
  await first.box.flush();
  const second = setup(async () => ({ ok: true }), store);
  assert.equal(second.box.list().length, 1);
  second.clock.t += 10_000;
  await second.box.flush();
  assert.equal(second.box.list()[0].status, 'done');
});

test('page fermée pendant un envoi : l’événement repasse en attente et est rejoué', async () => {
  const store = memoryStorage({
    aio_evq: JSON.stringify([{ key: 'a:pickup', tid: 'a', kind: 'pickup', api: MISSION.api, courierKey: MISSION.courierKey,
      eventId: 'pickup-a', created: 1, attempts: 1, next: 0, status: 'sending', error: '' }])
  });
  const { box, sent } = setup(async () => ({ ok: true, duplicate: true }), store);
  assert.equal(box.list()[0].status, 'pending');
  await box.flush();
  assert.equal(sent.length, 1);
  assert.equal(box.list()[0].result, 'duplicate');
});

test('stockage plein : l’erreur est signalée, pas avalée', () => {
  const failing = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  const { box } = setup(async () => ({ ok: true }), failing);
  box.enqueue(Object.assign({ kind: 'pickup' }, MISSION));
  assert.match(box.summary().error, /Mémoire du téléphone pleine/);
});

test('événement invalide refusé dès l’ajout', () => {
  const { box } = setup(async () => ({ ok: true }));
  assert.throws(() => box.enqueue({ kind: 'teleport', tid: 'a', api: 'x', courierKey: 'y' }));
  assert.throws(() => box.enqueue({ kind: 'pickup', tid: '', api: 'x', courierKey: 'y' }));
  assert.throws(() => box.enqueue({ kind: 'pickup', tid: 'a', api: 'x' }));
});

test('un envoi lent n’est pas lancé deux fois en parallèle', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { box, sent } = setup(async () => { await gate; return { ok: true }; });
  box.enqueue(Object.assign({ kind: 'pickup' }, MISSION));
  const a = box.flush();
  const b = box.flush();
  release();
  await Promise.all([a, b]);
  assert.equal(sent.length, 1);
});

test('describe : textes de l’état affiché au livreur', async () => {
  assert.deepEqual(describe(null), { text: '', error: false });
  const { box } = setup(async () => ({ ok: true }));
  box.enqueue(Object.assign({ kind: 'delivered' }, MISSION));
  assert.match(describe(box.summary()).text, /1 événement en attente/);
  await box.flush();
  assert.match(describe(box.summary()).text, /Livré envoyé/);
});

/* ---------- propriétaire : vidage de la file ---------- */

function drainSetup(rows, opts) {
  const o = opts || {};
  const acked = [];
  const run = () => drain({
    limit: 500,
    fetchPending: async () => { if (o.fetchError) throw o.fetchError; return rows.filter((r) => !acked.includes(r.id)); },
    apply: (r) => (o.apply ? o.apply(r) : 'done'),
    ack: async (r) => { if (o.ackError && o.ackError(r)) throw new Error('PATCH 500'); acked.push(r.id); }
  });
  return { run, acked };
}

test('vidage : événements appliqués puis acquittés', async () => {
  const { run, acked } = drainSetup([{ id: 1, order_id: 'a', kind: 'pickup' }, { id: 2, order_id: 'a', kind: 'delivered' }]);
  const r = await run();
  assert.equal(r.applied, 2);
  assert.equal(r.acked, 2);
  assert.deepEqual(acked, [1, 2]);
  assert.deepEqual(r.errors, []);
});

test('commande pas encore présente : l’événement reste en attente puis est appliqué plus tard', async () => {
  const local = new Set();
  const rows = [{ id: 1, order_id: 'a', kind: 'pickup' }];
  const { run, acked } = drainSetup(rows, { apply: (r) => (local.has(r.order_id) ? 'done' : 'miss') });
  const first = await run();
  assert.equal(first.pending, 1);
  assert.equal(first.applied, 0);
  assert.deepEqual(acked, [], 'non acquitté : il sera repris');
  local.add('a'); // la commande arrive par la synchronisation
  const second = await run();
  assert.equal(second.applied, 1);
  assert.deepEqual(acked, [1]);
});

test('un événement en attente ne bloque pas les suivants', async () => {
  const rows = [{ id: 1, order_id: 'absente', kind: 'pickup' }, { id: 2, order_id: 'ok', kind: 'pickup' }];
  const { run, acked } = drainSetup(rows, { apply: (r) => (r.order_id === 'ok' ? 'done' : 'miss') });
  const r = await run();
  assert.equal(r.pending, 1);
  assert.deepEqual(acked, [2]);
});

test('rejeu d’un événement déjà appliqué (dup) : acquitté sans nouvelle modification', async () => {
  const { run, acked } = drainSetup([{ id: 1, order_id: 'a', kind: 'pickup' }], { apply: () => 'dup' });
  const r = await run();
  assert.equal(r.applied, 0);
  assert.deepEqual(acked, [1]);
});

test('échec de l’accusé : erreur remontée, événement conservé pour la prochaine fois', async () => {
  let failAck = true;
  const rows = [{ id: 1, order_id: 'a', kind: 'pickup' }];
  const { run, acked } = drainSetup(rows, { apply: (r) => (failAck ? 'done' : 'dup'), ackError: () => failAck });
  const first = await run();
  assert.equal(first.errors.length, 1);
  assert.equal(first.errors[0].stage, 'ack');
  assert.equal(first.pending, 1);
  failAck = false;
  const second = await run();
  assert.deepEqual(second.errors, []);
  assert.deepEqual(acked, [1]);
});

test('erreur à l’application d’une ligne : signalée, les autres lignes continuent', async () => {
  const rows = [{ id: 1, order_id: 'a', kind: 'pickup' }, { id: 2, order_id: 'b', kind: 'pickup' }];
  const { run, acked } = drainSetup(rows, { apply: (r) => { if (r.id === 1) throw new Error('boum'); return 'done'; } });
  const r = await run();
  assert.equal(r.errors[0].message, 'boum');
  assert.deepEqual(acked, [2]);
});

test('résultat inattendu : traité comme une erreur, jamais acquitté', async () => {
  const { run, acked } = drainSetup([{ id: 1, order_id: 'a', kind: 'pickup' }], { apply: () => undefined });
  const r = await run();
  assert.equal(r.errors.length, 1);
  assert.deepEqual(acked, []);
});

test('lecture impossible : l’erreur est propagée (pas de résultat vide trompeur)', async () => {
  const { run } = drainSetup([], { fetchError: Object.assign(new Error('Erreur 500'), { status: 500 }) });
  await assert.rejects(run(), /Erreur 500/);
});

test('file saturée : signalée par « truncated »', async () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ id: i + 1, order_id: 'x' + i, kind: 'pickup' }));
  const { run } = drainSetup(rows, { apply: () => 'miss' });
  const r = await run();
  assert.equal(r.truncated, true);
  assert.equal(r.pending, 500);
});

test('secrets : dropSecrets / cleanSettings / keepSecrets', () => {
  const o = { id: 'a', trackAuth: { client: 'x', courier: 'y' }, dc: '123456', name: 'n' };
  assert.deepEqual(AioEvents.dropSecrets(o), { id: 'a', name: 'n' });
  assert.ok(o.trackAuth, 'ne modifie pas l’original');
  const set = { db: 1, ikey: 1, trackOwnerKey: 'k', ttok: 't', rtok: 'r', whk: 'w', cur: 'MAD' };
  assert.deepEqual(AioEvents.cleanSettings(set), { cur: 'MAD' });
  const m = AioEvents.keepSecrets({ id: 'a', name: 'cloud' }, o);
  assert.equal(m.dc, '123456');
  assert.deepEqual(m.trackAuth, o.trackAuth);
  assert.equal(AioEvents.keepSecrets({ dc: 'z' }, o).dc, 'z', 'ne remplace pas une valeur déjà présente');
});

test('cloud.js utilise les helpers de secrets aux points push/pull/prepare', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'cloud.js'), 'utf8');
  assert.ok(/dropSecrets\(r\)/.test(src), 'pushAll');
  assert.ok(/dropSecrets\(loc\)/.test(src), 'hash local');
  assert.ok(/dropSecrets\(cloud\)/.test(src), 'hash cloud');
  assert.ok(/keepSecrets\(m, loc\)/.test(src), 'restore');
  assert.ok(/cleanSettings\(s\)/.test(src) && /map\(AioEvents\.dropSecrets\)/.test(src), 'prepare');
});

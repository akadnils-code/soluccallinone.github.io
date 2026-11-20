'use strict';

/*
 * Logique de la fonction de suivi, sans dépendance Firebase : la base, le secret
 * propriétaire et l'horloge sont injectés (voir index.js). Cela permet de la tester
 * avec une base en mémoire (functions/test).
 *
 * Événements livreur (Récupéré / Livré / Refusé) : action « courierEvent ».
 *  - jeton livreur propre à la commande (haché côté serveur) ;
 *  - transitions de statut contrôlées côté serveur (voir planCourierEvent) ;
 *  - idempotent : un événement répété ne modifie pas la commande une seconde fois ;
 *  - « Livré » exige le code de livraison (blocage après 3 essais).
 */

const { createHash, timingSafeEqual } = require('node:crypto');

const ID_RE = /^[a-z0-9]{24,48}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const EVENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const CODE_RE = /^[0-9]{6}$/;
const MAX_EVENTS = 100;
const MAX_EVENT_IDS = 40;
const MAX_ATTEMPTS = 3;
const LOCK_MS = 30 * 60 * 1000;
const COURIER_EVENTS = ['pickup', 'delivered', 'refused'];

function hash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function tokenMatches(stored, supplied) {
  if (typeof stored !== 'string' || typeof supplied !== 'string' || !TOKEN_RE.test(supplied)) return false;
  const a = Buffer.from(stored, 'hex');
  const b = Buffer.from(hash(supplied), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function cleanString(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function cleanPatch(input, kind) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Invalid tracking update.');
  const allowed = kind === 'owner'
    ? ['v', 'vc', 'cc', 'p', 's', 'bad', 'c', 've', 'r', 'rq', 'rt', 'fb', 't', 'pt', 'pos', 'ev']
    : kind === 'courier'
      ? ['s', 'bad', 'r', 't', 'pt', 'pos', 'ev']
      : ['rq', 'rt', 'fb', 't', 'ev'];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) fail(400, `Field not allowed: ${key}`);

  const patch = {};
  const stringLimits = { v: 80, vc: 60, cc: 60, p: 160, c: 80, ve: 20, r: 40, rq: 120, fb: 120 };
  for (const key of Object.keys(stringLimits)) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string') fail(400, `Invalid ${key}.`);
      patch[key] = cleanString(input[key], stringLimits[key]);
    }
  }
  if (input.s !== undefined) {
    if (!Number.isInteger(input.s) || input.s < 0 || input.s > 3) fail(400, 'Invalid status.');
    if (kind === 'courier' && input.s !== 2) fail(403, 'Courier cannot set this status.');
    patch.s = input.s;
  }
  if (input.bad !== undefined) {
    const valid = kind === 'owner'
      ? input.bad === 0 || input.bad === 1
      : kind === 'courier' && input.bad === 1;
    if (!valid) fail(400, 'Invalid refusal status.');
    patch.bad = input.bad;
  }
  if (input.rt !== undefined) {
    if (!Number.isInteger(input.rt) || input.rt < 1 || input.rt > 5) fail(400, 'Invalid rating.');
    patch.rt = input.rt;
  }
  for (const key of ['t', 'pt']) {
    if (input[key] !== undefined) {
      if (!Number.isFinite(input[key])) fail(400, `Invalid ${key}.`);
      patch[key] = input[key];
    }
  }
  if (input.pos !== undefined) {
    const p = input.pos;
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) ||
        p[0] < -90 || p[0] > 90 || p[1] < -180 || p[1] > 180) fail(400, 'Invalid GPS position.');
    patch.pos = p;
  }
  if (input.ev !== undefined) {
    if (!input.ev || typeof input.ev !== 'object' || Array.isArray(input.ev)) fail(400, 'Invalid event.');
    const events = Object.values(input.ev);
    if (!events.length || events.length > 10) fail(400, 'Invalid event count.');
    patch.ev = events.map((event) => {
      if (!event || !Number.isFinite(event.t) || typeof event.x !== 'string') fail(400, 'Invalid event.');
      return { t: event.t, x: cleanString(event.x, 120) };
    });
  }
  return patch;
}

// Les événements client/propriétaire gardent la clé « e<t> » : renvoyer le même envoi réécrit la même clé.
function appendEvents(existing, events) {
  const next = Object.assign({}, existing || {});
  (events || []).forEach((event) => {
    const key = 'e' + String(Math.max(0, Math.floor(event.t)));
    next[key] = event;
  });
  const keys = Object.keys(next).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  keys.slice(0, Math.max(0, keys.length - MAX_EVENTS)).forEach((key) => delete next[key]);
  return next;
}

// Horodatage libre pour un événement créé par le serveur (jamais d'écrasement d'un autre événement).
function freeEventTime(existing, at) {
  let t = Math.max(0, Math.floor(at));
  while (existing && existing['e' + t]) t += 1;
  return t;
}

function publicRecord(value) {
  const data = Object.assign({}, value);
  delete data.dc;
  return data;
}

/*
 * Exécute une transaction sans dépendre du cache de la base : lors du premier appel le
 * cache peut être vide (null) ; on renvoie alors null pour que le SDK relance la fonction
 * avec la valeur réelle du serveur (renvoyer undefined annulerait la transaction à tort).
 * decide(current) renvoie { write?, ...infos } ; sans « write », la transaction est annulée.
 */
async function transact(ref, decide) {
  let decision = null;
  const result = await ref.transaction((current) => {
    decision = null;
    if (current === null || current === undefined) return null;
    decision = decide(current);
    return decision.write;
  });
  const value = result.snapshot.val();
  if (value === null || value === undefined) fail(404, 'Tracking record not found.');
  return { committed: result.committed, decision, value };
}

/*
 * Transitions autorisées pour le livreur (statut s : 0 en attente, 1 validée, 2 en route, 3 livrée ;
 * bad = 1 : livraison refusée/annulée) :
 *   pickup    : s=1 -> 2 ; s>=2 déjà fait (sans effet) ; refusée -> 409 ; s=0 -> 409
 *   refused   : s in {1,2} -> bad=1 ; déjà refusée (sans effet) ; s=3 -> 409 ; s=0 -> 409
 *   delivered : s in {1,2} -> 3 (code exigé) ; déjà livrée (sans effet) ; refusée -> 409 ; s=0 -> 409
 */
function planCourierEvent(kind, record) {
  const s = Number.isInteger(record.s) ? record.s : 0;
  const refused = record.bad === 1;
  const apply = { type: 'apply' };
  const noop = { type: 'noop' };
  const reject = (message) => ({ type: 'reject', status: 409, message });
  if (kind === 'pickup') {
    if (refused) return reject('Delivery is already closed.');
    if (s >= 2) return noop;
    return s === 1 ? apply : reject('Order is not validated yet.');
  }
  if (kind === 'refused') {
    if (refused) return noop;
    if (s === 3) return reject('Delivery is already closed.');
    return s >= 1 ? apply : reject('Order is not validated yet.');
  }
  if (refused) return reject('Delivery is already closed.');
  if (s === 3) return noop;
  return s >= 1 ? apply : reject('Order is not validated yet.');
}

function createTracking(deps) {
  const now = deps.now || Date.now;

  function secretMatches(supplied) {
    if (typeof supplied !== 'string' || !supplied) return false;
    const secret = deps.ownerSecret();
    if (typeof secret !== 'string' || !secret) return false;
    return timingSafeEqual(Buffer.from(hash(secret), 'hex'), Buffer.from(hash(supplied), 'hex'));
  }

  function requireOwner(body) {
    if (body.db !== deps.databaseUrl()) fail(400, 'Database URL does not match the deployed function.');
    if (!secretMatches(body.ownerKey)) fail(403, 'Owner authorization failed.');
  }

  async function rememberEvent(privateRef, eventId) {
    if (!eventId) return;
    const at = now();
    await privateRef.transaction((current) => {
      if (current === null || current === undefined) return null;
      const events = Object.assign({}, current.events || {});
      events[eventId] = at;
      const keys = Object.keys(events).sort((a, b) => events[a] - events[b]);
      keys.slice(0, Math.max(0, keys.length - MAX_EVENT_IDS)).forEach((key) => delete events[key]);
      return Object.assign({}, current, { events });
    });
  }

  async function checkDeliveryCode(privateRef, code) {
    if (typeof code !== 'string' || !CODE_RE.test(code)) fail(400, 'Invalid delivery code.');
    let outcome = '';
    const tx = await privateRef.transaction((current) => {
      outcome = '';
      if (current === null || current === undefined) return null;
      const t = now();
      if (current.blockedUntil > t) {
        outcome = 'blocked';
        return;
      }
      const expected = Buffer.from(current.deliveryCode || '');
      const supplied = Buffer.from(code);
      const valid = expected.length === supplied.length && timingSafeEqual(expected, supplied);
      if (valid) {
        outcome = 'ok';
        return Object.assign({}, current, { failedAttempts: 0, blockedUntil: 0 });
      }
      const failedAttempts = (current.failedAttempts || 0) + 1;
      outcome = failedAttempts >= MAX_ATTEMPTS ? 'blocked' : 'invalid';
      return Object.assign({}, current, {
        failedAttempts,
        blockedUntil: failedAttempts >= MAX_ATTEMPTS ? t + LOCK_MS : 0
      });
    });
    const stored = tx.snapshot.val();
    if (stored === null || stored === undefined) fail(404, 'Tracking record not found.');
    if (outcome === 'blocked') fail(429, 'Too many delivery-code attempts. Try again in 30 minutes.');
    if (outcome !== 'ok') fail(401, 'Incorrect delivery code.');
  }

  async function applyCourierEvent(track, kind, reason) {
    const label = {
      pickup: 'Colis récupéré, le livreur est en route',
      delivered: 'Colis livré',
      refused: reason ? 'Livraison échouée : ' + reason : 'Livraison refusée par le client'
    }[kind];
    const done = await transact(track, (current) => {
      const plan = planCourierEvent(kind, current);
      if (plan.type !== 'apply') return { plan };
      const at = now();
      const next = Object.assign({}, current);
      if (kind === 'pickup') next.s = 2;
      if (kind === 'delivered') next.s = 3;
      if (kind === 'refused') {
        next.bad = 1;
        next.r = reason || 'Refusé';
      }
      next.t = at;
      next.ev = appendEvents(current.ev, [{ t: freeEventTime(current.ev, at), x: label }]);
      delete next.dc;
      return { plan, write: next };
    });
    if (done.committed) return { applied: true, data: publicRecord(done.value) };
    const plan = done.decision && done.decision.plan;
    if (plan && plan.type === 'noop') return { applied: false, data: publicRecord(done.value) };
    fail(plan && plan.status ? plan.status : 409, plan && plan.message ? plan.message : 'Invalid tracking state.');
  }

  async function courierEvent(body, id, track, privateRef) {
    const kind = body.event;
    if (!COURIER_EVENTS.includes(kind)) fail(400, 'Unknown courier event.');
    if (body.eventId !== undefined && (typeof body.eventId !== 'string' || !EVENT_ID_RE.test(body.eventId))) {
      fail(400, 'Invalid event ID.');
    }
    if (body.reason !== undefined && typeof body.reason !== 'string') fail(400, 'Invalid reason.');
    const reason = kind === 'refused' ? cleanString(body.reason, 40).trim() : '';

    const auth = await privateRef.get();
    if (!auth.exists()) fail(404, 'Tracking record not found.');
    const a = auth.val();
    if (!tokenMatches(a.courierHash, body.courierKey)) fail(403, 'Tracking link is invalid.');

    const record = await track.get();
    if (!record.exists()) fail(404, 'Tracking record not found.');
    if (body.eventId && a.events && a.events[body.eventId]) {
      return { ok: true, duplicate: true, data: publicRecord(record.val()) };
    }

    const early = planCourierEvent(kind, record.val());
    if (early.type === 'reject') fail(early.status, early.message);
    if (early.type === 'apply' && kind === 'delivered') await checkDeliveryCode(privateRef, body.code);

    const result = await applyCourierEvent(track, kind, reason);
    await rememberEvent(privateRef, body.eventId);
    return { ok: true, duplicate: !result.applied, data: result.data };
  }

  // Ancien état (clientUpdate / courierUpdate) : conservé, avec les mêmes contrôles et sans doublon.
  async function legacyUpdate(body, action, track, privateRef) {
    const auth = await privateRef.get();
    if (!auth.exists()) fail(404, 'Tracking record not found.');
    const a = auth.val();
    const isClient = action === 'clientUpdate' && tokenMatches(a.clientHash, body.clientKey);
    const isCourier = action === 'courierUpdate' && tokenMatches(a.courierHash, body.courierKey);
    if (!isClient && !isCourier) fail(403, 'Tracking link is invalid.');
    const patch = cleanPatch(body.patch || {}, isClient ? 'client' : 'courier');
    const done = await transact(track, (current) => {
      const effective = Object.assign({}, patch);
      if (isCourier) {
        if (current.s === 3 || current.bad === 1 || (effective.s === 2 && current.s !== 1 && current.s !== 2) ||
            (effective.bad === 1 && !(current.s >= 1))) {
          return {}; // pas de write : transaction annulée -> 409
        }
        if (effective.s === 2 && current.s === 2) {
          // « Récupéré » déjà enregistré : on ne rejoue ni le statut ni l'événement.
          delete effective.s;
          delete effective.ev;
        }
      }
      const next = Object.assign({}, current, effective);
      if (effective.ev) next.ev = appendEvents(current.ev, effective.ev);
      delete next.dc;
      return { write: next };
    });
    if (!done.committed) fail(409, 'Invalid tracking state.');
    return { ok: true, data: publicRecord(done.value) };
  }

  async function handle(req) {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid request.');
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 65536) fail(413, 'Request too large.');
    const { action, id } = body;
    if (action === 'ping') {
      requireOwner(body);
      await deps.database().ref('_privateTrackAuth').limitToFirst(1).get();
      return { ok: true };
    }
    if (typeof id !== 'string' || !ID_RE.test(id)) fail(400, 'Invalid tracking ID.');
    const db = deps.database();
    const track = db.ref('track/' + id);
    const privateRef = db.ref('_privateTrackAuth/' + id);

    if (action === 'publish') {
      requireOwner(body);
      if (!TOKEN_RE.test(body.clientKey || '') || !TOKEN_RE.test(body.courierKey || '')) fail(400, 'Invalid tracking credentials.');
      if (typeof body.deliveryCode !== 'string' || !CODE_RE.test(body.deliveryCode)) fail(400, 'Invalid delivery code.');
      const patch = cleanPatch(body.patch || {}, 'owner');
      const auth = await privateRef.get();
      const authData = {
        clientHash: hash(body.clientKey),
        courierHash: hash(body.courierKey),
        deliveryCode: body.deliveryCode
      };
      if (auth.exists()) {
        if (!auth.val().clientHash || !auth.val().courierHash) fail(500, 'Tracking credentials are incomplete.');
        await privateRef.update(authData);
      } else {
        await privateRef.set(Object.assign({}, authData, { failedAttempts: 0, blockedUntil: 0 }));
      }
      /*
       * Une publication du propriétaire fondée sur un état local en retard ne doit pas effacer
       * un statut posé par le livreur : sans allowRegress, s ne peut pas baisser et bad ne peut
       * pas repasser à 0. L'application envoie allowRegress seulement après une correction
       * manuelle du statut.
       */
      const allowRegress = body.allowRegress === true;
      let kept = false;
      const published = await track.transaction((current) => {
        kept = false;
        const incoming = Object.assign({}, patch);
        if (current && !allowRegress) {
          if (incoming.s !== undefined && Number.isInteger(current.s) && incoming.s < current.s) {
            delete incoming.s;
            // un événement d'annulation/refus du propriétaire reste utile ; un événement d'étape périmée non
            if (incoming.bad !== 1) delete incoming.ev;
            kept = true;
          }
          if (incoming.bad === 0 && current.bad === 1) {
            delete incoming.bad;
            delete incoming.ev;
            kept = true;
          }
        }
        // même état que celui déjà enregistré : on ne rajoute pas l'événement d'historique (republication, génération de lien)
        if (current && incoming.ev && (incoming.s === undefined || incoming.s === current.s) &&
            (incoming.bad === undefined || incoming.bad === current.bad)) delete incoming.ev;
        const next = Object.assign({}, current || {}, incoming);
        if (!current) {
          if (next.s === undefined) next.s = 0;
          if (next.bad === undefined) next.bad = 0;
        }
        if (incoming.ev) next.ev = appendEvents(current && current.ev, incoming.ev);
        delete next.dc;
        return next;
      });
      if (!published.committed) fail(409, 'Tracking record could not be published.');
      return kept ? { ok: true, kept: true } : { ok: true };
    }

    if (action === 'read') {
      const [record, auth] = await Promise.all([track.get(), privateRef.get()]);
      if (!record.exists()) fail(404, 'Tracking record not found.');
      if (secretMatches(body.ownerKey)) return publicRecord(record.val());
      if (!auth.exists()) fail(404, 'Tracking record not found.');
      const a = auth.val();
      const isClient = tokenMatches(a.clientHash, body.clientKey);
      const isCourier = tokenMatches(a.courierHash, body.courierKey);
      if (!isClient && !isCourier) fail(403, 'Tracking link is invalid.');
      const data = publicRecord(record.val());
      if (isClient) data.dc = a.deliveryCode;
      return data;
    }

    if (action === 'courierEvent') return courierEvent(body, id, track, privateRef);
    if (action === 'deliver') return courierEvent(Object.assign({}, body, { event: 'delivered' }), id, track, privateRef);
    if (action === 'clientUpdate' || action === 'courierUpdate') return legacyUpdate(body, action, track, privateRef);

    return fail(400, 'Unknown tracking action.');
  }

  return { handle };
}

module.exports = {
  createTracking,
  planCourierEvent,
  cleanPatch,
  appendEvents,
  hash,
  ID_RE,
  TOKEN_RE,
  COURIER_EVENTS
};

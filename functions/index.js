'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');

const ownerSecret = defineSecret('TRACKING_OWNER_KEY');
const ID_RE = /^[a-z0-9]{24,48}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const MAX_EVENTS = 100;
const LOCK_MS = 30 * 60 * 1000;

function databaseUrl() {
  const value = process.env.TRACKING_DATABASE_URL;
  if (!value) throw new Error('TRACKING_DATABASE_URL is not configured.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.port ||
      url.username || url.password || !/(^|\.)firebaseio\.com$|(^|\.)firebasedatabase\.app$/.test(url.hostname)) {
    throw new Error('TRACKING_DATABASE_URL must be an HTTPS Firebase Realtime Database URL.');
  }
  return url.origin;
}

function database() {
  const url = databaseUrl();
  const app = getApps()[0] || initializeApp({ databaseURL: url });
  if (app.options.databaseURL && app.options.databaseURL.replace(/\/$/, '') !== url) {
    throw new Error('The initialized Firebase app does not match TRACKING_DATABASE_URL.');
  }
  return getDatabase(app);
}

function hash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function tokenMatches(stored, supplied) {
  if (typeof stored !== 'string' || typeof supplied !== 'string' || !TOKEN_RE.test(supplied)) return false;
  const a = Buffer.from(stored, 'hex');
  const b = Buffer.from(hash(supplied), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function secretMatches(supplied) {
  if (typeof supplied !== 'string' || !supplied) return false;
  const expected = Buffer.from(hash(ownerSecret.value()), 'hex');
  const actual = Buffer.from(hash(supplied), 'hex');
  return timingSafeEqual(expected, actual);
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

function applyPatch(ref, patch, allowed) {
  let rejected = false;
  return ref.transaction((current) => {
    if (!current) return;
    if (allowed && !allowed(current)) {
      rejected = true;
      return;
    }
    const next = Object.assign({}, current, patch);
    if (patch.ev) next.ev = appendEvents(current.ev, patch.ev);
    delete next.dc;
    return next;
  }).then((result) => {
    if (!result.committed) fail(rejected ? 409 : 404, rejected ? 'Invalid tracking state.' : 'Tracking record not found.');
    return result.snapshot.val();
  });
}

async function handle(req) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid request.');
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 65536) fail(413, 'Request too large.');
  const { action, id } = body;
  if (action === 'ping') {
    const configured = databaseUrl();
    if (body.db !== configured) fail(400, 'Database URL does not match the deployed function.');
    if (!secretMatches(body.ownerKey)) fail(403, 'Owner authorization failed.');
    await database().ref('_privateTrackAuth').limitToFirst(1).get();
    return { ok: true };
  }
  if (typeof id !== 'string' || !ID_RE.test(id)) fail(400, 'Invalid tracking ID.');
  const db = database();
  const track = db.ref('track/' + id);
  const privateRef = db.ref('_privateTrackAuth/' + id);

  if (action === 'publish') {
    if (body.db !== databaseUrl()) fail(400, 'Database URL does not match the deployed function.');
    if (!secretMatches(body.ownerKey)) fail(403, 'Owner authorization failed.');
    if (!TOKEN_RE.test(body.clientKey || '') || !TOKEN_RE.test(body.courierKey || '')) fail(400, 'Invalid tracking credentials.');
    if (typeof body.deliveryCode !== 'string' || !/^[0-9]{6}$/.test(body.deliveryCode)) fail(400, 'Invalid delivery code.');
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
    const published = await track.transaction((current) => {
      const next = Object.assign({}, current || {}, patch);
      if (!current) {
        if (next.s === undefined) next.s = 0;
        if (next.bad === undefined) next.bad = 0;
      }
      if (patch.ev) next.ev = appendEvents(current && current.ev, patch.ev);
      delete next.dc;
      return next;
    });
    if (!published.committed) fail(409, 'Tracking record could not be published.');
    return { ok: true };
  }

  if (action === 'read') {
    const [record, auth] = await Promise.all([track.get(), privateRef.get()]);
    if (!record.exists()) fail(404, 'Tracking record not found.');
    if (secretMatches(body.ownerKey)) {
      const data = record.val();
      delete data.dc;
      return data;
    }
    if (!auth.exists()) fail(404, 'Tracking record not found.');
    const a = auth.val();
    const isClient = tokenMatches(a.clientHash, body.clientKey);
    const isCourier = tokenMatches(a.courierHash, body.courierKey);
    if (!isClient && !isCourier) fail(403, 'Tracking link is invalid.');
    const data = record.val();
    delete data.dc;
    if (isClient) data.dc = a.deliveryCode;
    return data;
  }

  if (action === 'clientUpdate' || action === 'courierUpdate') {
    const auth = await privateRef.get();
    if (!auth.exists()) fail(404, 'Tracking record not found.');
    const a = auth.val();
    const isClient = action === 'clientUpdate' && tokenMatches(a.clientHash, body.clientKey);
    const isCourier = action === 'courierUpdate' && tokenMatches(a.courierHash, body.courierKey);
    if (!isClient && !isCourier) fail(403, 'Tracking link is invalid.');
    const patch = cleanPatch(body.patch || {}, isClient ? 'client' : 'courier');
    const updated = await applyPatch(track, patch, isCourier ? (current) => {
      if (current.s === 3 || current.bad === 1) return false;
      return patch.s !== 2 || current.s === 1 || current.s === 2;
    } : undefined);
    return { ok: true, data: updated };
  }

  if (action === 'deliver') {
    const authSnapshot = await privateRef.get();
    if (!authSnapshot.exists() || !tokenMatches(authSnapshot.val().courierHash, body.courierKey)) {
      fail(403, 'Tracking link is invalid.');
    }
    const before = await track.get();
    if (!before.exists()) fail(404, 'Tracking record not found.');
    if (before.val().s === 3 || before.val().bad === 1) fail(409, 'Delivery is already closed.');
    if (typeof body.code !== 'string' || !/^[0-9]{6}$/.test(body.code)) fail(400, 'Invalid delivery code.');
    let outcome = '';
    const tx = await privateRef.transaction((current) => {
      if (!current) return;
      const now = Date.now();
      if (current.blockedUntil > now) {
        outcome = 'blocked';
        return;
      }
      const expected = Buffer.from(current.deliveryCode || '');
      const supplied = Buffer.from(body.code);
      const valid = expected.length === supplied.length && timingSafeEqual(expected, supplied);
      if (valid) {
        outcome = 'ok';
        return Object.assign({}, current, { failedAttempts: 0, blockedUntil: 0 });
      }
      const failedAttempts = (current.failedAttempts || 0) + 1;
      outcome = failedAttempts >= 3 ? 'blocked' : 'invalid';
      return Object.assign({}, current, {
        failedAttempts,
        blockedUntil: failedAttempts >= 3 ? now + LOCK_MS : 0
      });
    });
    if (!tx.committed) fail(404, 'Tracking record not found.');
    if (outcome === 'blocked') fail(429, 'Too many delivery-code attempts. Try again in 30 minutes.');
    if (outcome !== 'ok') fail(401, 'Incorrect delivery code.');
    const current = await track.get();
    if (!current.exists()) fail(404, 'Tracking record not found.');
    if (current.val().s === 3) return { ok: true, data: current.val() };
    if (current.val().bad === 1) fail(409, 'Delivery is already closed.');
    const now = Date.now();
    const data = await applyPatch(track, {
      s: 3,
      t: now,
      ev: [{ t: now, x: 'Colis livré' }]
    }, (current) => current.s !== 3 && current.bad !== 1);
    return { ok: true, data };
  }

  fail(400, 'Unknown tracking action.');
}

exports.track = onRequest(
  { region: 'europe-west1', cors: true, secrets: [ownerSecret] },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST required.' });
    try {
      const result = await handle(req);
      return res.status(200).json(result);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status === 500) console.error('Tracking function failed:', error);
      return res.status(status).json({ error: status === 500 ? 'Tracking service error.' : error.message });
    }
  }
);

'use strict';

const { initializeApp, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const { createTracking } = require('./tracking');

const ownerSecret = defineSecret('TRACKING_OWNER_KEY');

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

const tracking = createTracking({
  database,
  databaseUrl,
  ownerSecret: () => ownerSecret.value()
});

exports.track = onRequest(
  { region: 'europe-west1', cors: true, secrets: [ownerSecret] },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST required.' });
    try {
      const result = await tracking.handle(req);
      return res.status(200).json(result);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status === 500) console.error('Tracking function failed:', error);
      return res.status(status).json({ error: status === 500 ? 'Tracking service error.' : error.message });
    }
  }
);

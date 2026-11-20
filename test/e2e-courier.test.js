'use strict';

/*
 * Test de bout en bout de la page livreur (vraie app.js dans Chromium, serveur de suivi simulé).
 * Ignoré si Playwright/Chromium n'est pas disponible.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* ignoré plus bas */ }

const ROOT = path.join(__dirname, '..');
const API = 'https://europe-west1-demo.cloudfunctions.net/track';
const TID = 'a1b2c3d4e5f6a7b8c9d0e1f2';
const COURIER_KEY = 'K'.repeat(43);
const OWNER_KEY = 'OWNER-SECRET-MUST-NEVER-APPEAR-123456';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

function encq(o) { return encodeURIComponent(Buffer.from(JSON.stringify(o), 'utf8').toString('base64')); }
function missionUrl(base, extra) {
  const d = Object.assign({ id: 'A1', tid: TID, api: API, db: 'https://demo-default-rtdb.europe-west1.firebasedatabase.app', dk: COURIER_KEY,
    p: 'Produit test', v: 'Boutique', n: 'Client Test', cp: '0600000000', s: 1, m: 100, w: '212600000000' }, extra || {});
  return base + '/index.html?l=' + encq(d);
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+$/, '/index.html'));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function withPage(t, handler) {
  if (!chromium) return t.skip('Playwright indisponible');
  let browser;
  try { browser = await chromium.launch(); } catch (e) { return t.skip('Chromium indisponible : ' + e.message); }
  const server = await startServer();
  const base = 'http://127.0.0.1:' + server.address().port;
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const requests = [];
  const mode = { value: 'ok' };
  await page.route(API, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    requests.push(body);
    if (mode.value === 'offline') return route.abort('failed');
    if (mode.value === 'forbidden') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Tracking link is invalid.' }) });
    if (mode.value === 'notfound') return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Tracking record not found.' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, duplicate: false, data: { s: 2 } }) });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try { await handler({ page, base, requests, mode, errors }); }
  finally { await browser.close(); server.close(); }
}

const events = (requests) => requests.filter((r) => r.action === 'courierEvent');
const banner = (page) => page.locator('#tkst').innerText();

test('Récupéré : un appui envoie courierEvent « pickup » avec jeton livreur, eventId stable et sans clé propriétaire', async (t) => {
  await withPage(t, async ({ page, base, requests, errors }) => {
    await page.goto(missionUrl(base));
    await page.click('[data-act=cst][data-v="En cours"]');
    await page.waitForSelector('#tkst');
    await page.waitForFunction(() => /Récupéré envoyé/.test(document.getElementById('tkst').innerText));
    const sent = events(requests);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].event, 'pickup');
    assert.equal(sent[0].id, TID);
    assert.equal(sent[0].courierKey, COURIER_KEY);
    assert.equal(sent[0].eventId, 'pickup-' + TID);
    assert.equal(JSON.stringify(sent[0]).includes(OWNER_KEY), false);
    assert.equal(sent[0].ownerKey, undefined);
    assert.deepEqual(errors, []);
  });
});

test('Récupéré appuyé plusieurs fois : une seule requête', async (t) => {
  await withPage(t, async ({ page, base, requests }) => {
    await page.goto(missionUrl(base));
    const button = page.locator('[data-act=cst][data-v="En cours"]');
    await button.dblclick();
    await page.waitForFunction(() => /Récupéré envoyé/.test((document.getElementById('tkst') || {}).innerText || ''));
    await page.click('[data-act=cst][data-v="En cours"]').catch(() => {});
    assert.equal(events(requests).length, 1);
  });
});

test('réseau coupé : événement conservé sur le téléphone, message explicite, puis renvoi avec le même eventId', async (t) => {
  await withPage(t, async ({ page, base, requests, mode }) => {
    mode.value = 'offline';
    await page.goto(missionUrl(base));
    await page.click('[data-act=cst][data-v="En cours"]');
    await page.waitForFunction(() => /en attente d’envoi/.test((document.getElementById('tkst') || {}).innerText || ''));
    assert.match(await banner(page), /connexion/i);
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('aio_evq')));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].status, 'pending');
    mode.value = 'ok';
    await page.click('[data-tk=retry]');
    await page.waitForFunction(() => /Récupéré envoyé/.test((document.getElementById('tkst') || {}).innerText || ''));
    const sent = events(requests);
    assert.ok(sent.length >= 2);
    assert.equal(new Set(sent.map((r) => r.eventId)).size, 1, 'même eventId à chaque tentative');
  });
});

test('la file survit au rechargement de la page', async (t) => {
  await withPage(t, async ({ page, base, requests, mode }) => {
    mode.value = 'offline';
    await page.goto(missionUrl(base));
    await page.click('[data-act=cst][data-v="En cours"]');
    await page.waitForFunction(() => /en attente d’envoi/.test((document.getElementById('tkst') || {}).innerText || ''));
    mode.value = 'ok';
    await page.reload();
    await page.waitForFunction(() => /Récupéré envoyé/.test((document.getElementById('tkst') || {}).innerText || ''), null, { timeout: 15000 });
    assert.ok(events(requests).some((r) => r.event === 'pickup'));
  });
});

test('commande pas encore publiée (404) : rejouée, jamais perdue', async (t) => {
  await withPage(t, async ({ page, base, mode }) => {
    mode.value = 'notfound';
    await page.goto(missionUrl(base));
    await page.click('[data-act=cst][data-v="En cours"]');
    await page.waitForFunction(() => /pas encore publiée/.test((document.getElementById('tkst') || {}).innerText || ''));
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('aio_evq')));
    assert.equal(stored[0].status, 'pending');
  });
});

test('jeton refusé (403) : erreur visible, événement conservé en échec, pas de nouvelle tentative automatique', async (t) => {
  await withPage(t, async ({ page, base, requests, mode }) => {
    mode.value = 'forbidden';
    await page.goto(missionUrl(base));
    await page.click('[data-act=cst][data-v="En cours"]');
    await page.waitForFunction(() => /non envoyé/.test((document.getElementById('tkst') || {}).innerText || ''));
    assert.match(await banner(page), /Lien livreur invalide/);
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('aio_evq')));
    assert.equal(stored[0].status, 'failed');
    assert.equal(events(requests).length, 1);
  });
});

test('Refusé : motif « Colis refusé » envoyé comme événement « refused »', async (t) => {
  await withPage(t, async ({ page, base, requests }) => {
    await page.goto(missionUrl(base));
    await page.click('[data-act=crf]');
    await page.click('[data-act=crs][data-v="Colis refusé"]');
    await page.waitForFunction(() => /Refusé envoyé/.test((document.getElementById('tkst') || {}).innerText || ''));
    const sent = events(requests);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].event, 'refused');
    assert.equal(sent[0].reason, 'Colis refusé');
    assert.equal(sent[0].eventId, 'refused-' + TID);
  });
});

test('Livré : le code est envoyé au serveur (pas validé côté navigateur) avec eventId stable', async (t) => {
  await withPage(t, async ({ page, base, requests }) => {
    await page.goto(missionUrl(base));
    await page.click('[data-act=cgo]');
    await page.fill('#cdin', '123456');
    await page.click('[data-act=cok]');
    await page.waitForFunction(() => /Livraison validée/.test(document.body.innerText));
    const sent = events(requests);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].event, 'delivered');
    assert.equal(sent[0].code, '123456');
    assert.equal(sent[0].eventId, 'delivered-' + TID);
  });
});

test('Livré sans réseau : la livraison est mise en file et envoyée automatiquement au retour du réseau', async (t) => {
  await withPage(t, async ({ page, base, requests, mode }) => {
    mode.value = 'offline';
    await page.goto(missionUrl(base));
    await page.click('[data-act=cgo]');
    await page.fill('#cdin', '123456');
    await page.click('[data-act=cok]');
    await page.waitForFunction(() => /en attente d’envoi/.test((document.getElementById('tkst') || {}).innerText || ''));
    mode.value = 'ok';
    await page.click('[data-tk=retry]');
    await page.waitForFunction(() => /Livraison validée/.test(document.body.innerText));
    const sent = events(requests).filter((r) => r.event === 'delivered');
    assert.ok(sent.length >= 2);
    assert.equal(new Set(sent.map((r) => r.eventId)).size, 1);
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('aio_evq')));
    assert.equal(stored[0].code, undefined, 'le code n’est plus conservé une fois la livraison envoyée');
  });
});

test('ancien lien (tu/tk, sans Firebase) : le bouton historique data-cev reste proposé', async (t) => {
  await withPage(t, async ({ page, base }) => {
    await page.goto(missionUrl(base, { api: undefined, dk: undefined, tid: undefined, tu: 'https://x.supabase.co/functions/v1/track', tk: 'a'.repeat(24) }));
    assert.ok(await page.locator('[data-cev=pickup]').count() >= 1);
  });
});

/* ---------- contrôles statiques : aucune clé propriétaire dans les liens publics ---------- */

test('app.js : la clé propriétaire n’est jamais placée dans un lien (encq) et aucun jeton tenant n’est généré', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  app.split('\n').forEach((line, i) => {
    if (/encq\(/.test(line)) assert.equal(/trackOwnerKey|ownerKey/.test(line), false, 'ligne ' + (i + 1) + ' : clé propriétaire dans un lien');
  });
  assert.equal(/d\.tk\s*=/.test(app), false, 'le jeton tenant « tk » ne doit plus être injecté dans les liens');
  assert.equal(/d\.tu\s*=/.test(app), false);
  const cloud = fs.readFileSync(path.join(ROOT, 'cloud.js'), 'utf8');
  assert.equal(/ttok\s*=/.test(cloud), false, 'cloud.js ne calcule plus de jeton de suivi tenant');
});

test('app.js : les clés propriétaire ne sont envoyées qu’au corps des requêtes POST, jamais dans une URL', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const uses = app.split('\n').filter((l) => /trackOwnerKey/.test(l));
  uses.forEach((l) => assert.equal(/location\.|href|\?l=|\?t=|wa\(|share/.test(l), false, 'usage suspect : ' + l.slice(0, 120)));
});

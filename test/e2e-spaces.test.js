'use strict';

/*
 * Test de bout en bout des espaces livreur / vendeur (?r=CODE) : vraie app.js + cloud.js dans Chromium,
 * fonctions « link » et « space » simulées. Ignoré si Playwright/Chromium n'est pas disponible.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* ignoré plus bas */ }

const ROOT = path.join(__dirname, '..');
const SB = 'https://nrlganuculkiqmeemert.supabase.co';
const TENANT = '11111111-2222-4333-8444-555555555555';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const ORD = () => [
  { id: 'o1', p: 'Robe rouge', m: 250, cc: 'Fès', d: '', st: 'Confirmé', n: 'Sara Client', cp: '0600000001', ca: 'Rue 5', v: 'Boutique Atlas', vp: '0611111111', va: 'Av 1', vc: 'Rabat' },
  { id: 'o2', p: 'Sac noir', m: 120, cc: 'Salé', d: 'En cours', st: 'Confirmé', n: 'Omar Client', cp: '0600000002', ca: 'Rue 9', v: 'Boutique Atlas', vp: '0611111111', va: 'Av 1', vc: 'Rabat' },
  { id: 'o3', p: 'Montre', m: 90, cc: 'Rabat', d: 'Livré', st: 'Confirmé', n: 'Lina Client', cp: '0600000003', ca: 'Rue 3', v: 'Boutique Atlas' }
];
const LINKS = {
  CFCFCFCFCF: { status: 200, body: { k: 'cf', d: { i: 'A1', n: 'Sara', pr: 'Robe test', t: 250, a: 'Rue 1', c: 'Rabat', w: '212600000000', b: 'Boutique Atlas', u: 'https://reply.test/reply', k: 'abc', tc: 'TTTTTTTTTT' } } },
  KKKKKKKKKK: { status: 200, body: { k: 'dsp', d: { n: 'Kad' } } },
  VVVVVVVVVV: { status: 200, body: { k: 'vsp', d: { n: 'Boutique Atlas' } } },
  XXXXXXXXXX: { status: 410, body: { error: 'lien expiré' } }
};

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

async function withPage(t, opts, handler) {
  if (!chromium) return t.skip('Playwright indisponible');
  let browser;
  try { browser = await chromium.launch(); } catch (e) { return t.skip('Chromium indisponible : ' + e.message); }
  const server = await startServer();
  const base = 'http://127.0.0.1:' + server.address().port;
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const posts = [], writes = [], deletes = [], errors = [];
  const st = { orders: ORD(), postStatus: 200, s: 1 };
  await page.route('https://reply.test/reply', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route(SB + '/functions/v1/link/*', (route) => {
    const code = route.request().url().split('/').pop();
    if (code === 'TTTTTTTTTT') { st.tcalls = (st.tcalls || 0) + 1; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ k: 't', d: { v: 'Boutique Atlas', p: 'Robe test', s: st.s, c: st.s >= 2 ? 'Karim' : '', w: '212600000000', cc: 'Rabat', vc: 'Casablanca' } }) }); }
    const r = LINKS[code];
    if (!r) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"lien inconnu"}' });
    return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
  });
  await page.route(SB + '/functions/v1/space/*', (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const b = JSON.parse(req.postData());
      posts.push(b);
      if (st.postStatus !== 200) return route.fulfill({ status: st.postStatus, contentType: 'application/json', body: '{"error":"x"}' });
      const d = { pickup: 'En cours', delivered: 'Livré', refused: 'Refusé' }[b.a];
      st.orders.forEach((o) => { if (o.id === b.id) o.d = d; });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, d }) });
    }
    const code = req.url().split('/').pop();
    const k = code === 'VVVVVVVVVV' ? 'vsp' : 'dsp';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ k, n: k === 'vsp' ? 'Boutique Atlas' : 'Kad', o: st.orders }) });
  });
  await page.route(SB + '/rest/v1/memberships*', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ role: 'owner', tenant: { id: TENANT, name: 'Test', plan: 'trial', status: 'active' } }]) }));
  await page.route(SB + '/rest/v1/short_links*', (route) => {
    const req = route.request();
    if (req.method() === 'DELETE') deletes.push(req.url());
    else writes.push(JSON.parse(req.postData() || '[]')[0]);
    return route.fulfill({ status: req.method() === 'DELETE' ? 204 : 201, body: '' });
  });
  page.on('pageerror', (e) => errors.push(e.message + ' @ ' + String(e.stack).split('\n').slice(1,3).join('|')));
  page.on('dialog', (d) => d.accept());
  if (opts && opts.session) {
    await context.addInitScript((tenant) => {
      try {
        localStorage.setItem('aio_sb', JSON.stringify({ access_token: 'tok', refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'a@test.invalid' } }));
        localStorage.setItem('aio_tenant', JSON.stringify(tenant));
      } catch (e) { /* ignoré */ }
    }, TENANT);
  }
  try { await handler({ page, base, posts, writes, deletes, errors, st }); }
  finally { await browser.close(); server.close(); }
}

const text = (page) => page.locator('#app').innerText();

test('espace livreur : seules ses livraisons, boutons Récupéré / Refusé puis Livré', async (t) => {
  await withPage(t, {}, async ({ page, base, posts, errors }) => {
    await page.goto(base + '/index.html?r=KKKKKKKKKK');
    await page.waitForFunction(() => /Robe rouge/.test(document.getElementById('app').innerText), null, { timeout: 8000 });
    const txt = await text(page);
    assert.match(txt, /Mes livraisons/);
    assert.match(txt, /Sac noir/);
    assert.match(txt, /Boutique Atlas/);
    assert.match(txt, /370 dh/, 'à encaisser = commandes non terminées');
    assert.match(txt, /Terminées/);
    assert.equal(await page.locator('[data-act=spa][data-oid=o1][data-a=pickup]').count(), 1);
    assert.equal(await page.locator('[data-act=spa][data-oid=o1][data-a=delivered]').count(), 0, 'pas Livré avant Récupéré');
    assert.equal(await page.locator('[data-act=spa][data-oid=o2][data-a=delivered]').count(), 1);
    await page.click('[data-act=spa][data-oid=o1][data-a=pickup]');
    await page.waitForSelector('[data-act=spa][data-oid=o1][data-a=delivered]');
    assert.deepEqual(posts, [{ id: 'o1', a: 'pickup' }]);
    await page.click('[data-act=spa][data-oid=o2][data-a=delivered]');
    await page.waitForFunction(() => document.querySelectorAll('[data-act=spa][data-oid=o2]').length === 0);
    assert.deepEqual(posts[1], { id: 'o2', a: 'delivered' });
    assert.deepEqual(errors, []);
  });
});

test('espace livreur : refus confirmé, erreur serveur affichée', async (t) => {
  await withPage(t, {}, async ({ page, base, posts, st, errors }) => {
    await page.goto(base + '/index.html?r=KKKKKKKKKK');
    await page.waitForSelector('[data-act=spa][data-oid=o1][data-a=refused]');
    st.postStatus = 409;
    await page.click('[data-act=spa][data-oid=o1][data-a=refused]');
    await page.waitForFunction(() => /déjà clôturée/.test(document.getElementById('app').innerText), null, { timeout: 8000 });
    assert.deepEqual(posts[0], { id: 'o1', a: 'refused' });
    assert.deepEqual(errors, []);
  });
});

test('espace vendeur : lecture seule, aucun bouton d’action', async (t) => {
  await withPage(t, {}, async ({ page, base, posts, errors }) => {
    await page.goto(base + '/index.html?r=VVVVVVVVVV');
    await page.waitForFunction(() => /Robe rouge/.test(document.getElementById('app').innerText), null, { timeout: 8000 });
    assert.match(await text(page), /Mon espace/);
    assert.equal(await page.locator('[data-act=spa]').count(), 0);
    assert.deepEqual(posts, []);
    assert.deepEqual(errors, []);
  });
});

test('espace : lien expiré -> message clair', async (t) => {
  await withPage(t, {}, async ({ page, base, errors }) => {
    await page.goto(base + '/index.html?r=XXXXXXXXXX');
    await page.waitForFunction(() => /expiré/.test(document.getElementById('app').innerText), null, { timeout: 8000 });
    assert.deepEqual(errors, []);
  });
});

test('propriétaire : « Lien de son espace » crée le code, l’enregistre ; « Nouveau lien » supprime l’ancien', async (t) => {
  await withPage(t, { session: true }, async ({ page, base, writes, deletes, errors }) => {
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.DB && window.cloudShort && window.cloudShort.ready(), null, { timeout: 10000 });
    await page.evaluate(() => { DB.cour.push({ id: 'c1', name: 'Kad', phone: '', city: '' }); document.body.insertAdjacentHTML('beforeend', '<div id="tl">' + livlist() + '</div>'); });
    await page.click('#tl [data-act=spl][data-id=c1]');
    await page.waitForFunction(() => /^[A-Za-z0-9]{10}$/.test((DB.cour.find((c) => c.id === 'c1') || {}).sp || ''));
    const code = await page.evaluate(() => DB.cour.find((c) => c.id === 'c1').sp);
    await page.waitForFunction(() => true);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(writes.length, 1);
    assert.equal(writes[0].code, code);
    assert.equal(writes[0].kind, 'dsp');
    assert.equal(writes[0].order_id, 'c1');
    assert.deepEqual(writes[0].payload, { n: 'Kad' });
    await page.click('#tl [data-act=spn][data-id=c1]');
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(deletes.length, 1);
    assert.match(deletes[0], new RegExp('code=eq.' + code));
    const code2 = await page.evaluate(() => DB.cour.find((c) => c.id === 'c1').sp);
    assert.match(code2, /^[A-Za-z0-9]{10}$/);
    assert.notEqual(code2, code);
    assert.deepEqual(errors, []);
  });
});

test('suivi client : la page se met à jour toute seule quand la commande avance', async (t) => {
  await withPage(t, {}, async ({ page, base, st, errors }) => {
    await page.clock.install();
    await page.goto(base + '/index.html?r=TTTTTTTTTT');
    await page.waitForFunction(() => /Robe test/.test(document.getElementById('app').innerText), null, { timeout: 8000 });
    assert.doesNotMatch(await text(page), /Karim/);
    st.s = 2;
    await page.clock.runFor(31000);
    await page.waitForFunction(() => /Karim/.test(document.getElementById('app').innerText), null, { timeout: 8000 });
    assert.deepEqual(errors, []);
  });
});

test('confirmation client : après « Je confirme », bouton « Suivre ma commande » vers le même suivi court', async (t) => {
  await withPage(t, {}, async ({ page, base, errors }) => {
    await page.goto(base + '/index.html?r=CFCFCFCFCF');
    await page.waitForSelector('[data-x9=cfok]');
    await page.click('[data-x9=cfok]');
    await page.waitForFunction(() => /Merci/.test(document.getElementById('app').innerText), null, { timeout: 8000 });
    assert.equal(await page.getAttribute('#app a.pri', 'href'), '?r=TTTTTTTTTT');
    await page.click('#app a.pri');
    await page.waitForFunction(() => /Robe test/.test(document.getElementById('app').innerText) && /Suivi/.test(document.getElementById('app').innerText), null, { timeout: 8000 });
    assert.deepEqual(errors, []);
  });
});

test('client : après « Je confirme », un bouton « Suivre ma commande » mène au suivi court', async (t) => {
  await withPage(t, {}, async ({ page, base, errors }) => {
    await page.goto(base + '/index.html?r=KKKKKKKKKK');
    await page.waitForSelector('[data-act=spa]');
    await page.evaluate(() => { window.__cf = { tc: 'Ab3xY9kLmN', w: '212600000000', pr: 'Robe' }; cfDone(true); });
    assert.equal(await page.locator('a:has-text("Suivre ma commande")').getAttribute('href'), '?r=Ab3xY9kLmN');
    await page.evaluate(() => { window.__cf = { tc: 'bad link', w: '212600000000' }; cfDone(true); });
    assert.equal(await page.locator('a:has-text("Suivre ma commande")').count(), 0, 'code invalide : pas de bouton');
    await page.evaluate(() => { window.__cf = { tc: 'Ab3xY9kLmN' }; cfDone(false); });
    assert.equal(await page.locator('a:has-text("Suivre ma commande")').count(), 0, 'commande annulée : pas de bouton');
    assert.deepEqual(errors, []);
  });
});

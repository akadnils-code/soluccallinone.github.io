'use strict';

/*
 * Test de bout en bout des liens courts (?r=CODE) : vraie app.js + cloud.js dans Chromium, fonction « link » et API Supabase simulées.
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
const SB = 'https://nrlganuculkiqmeemert.supabase.co';
const TENANT = '11111111-2222-4333-8444-555555555555';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const LINKS = {
  AAAAAAAAAA: { status: 200, body: { k: 't', d: { v: 'Boutique Atlas', p: 'Robe test', s: 2, c: 'Karim', w: '212600000000', cc: 'Rabat', vc: 'Casablanca' } } },
  BBBBBBBBBB: { status: 200, body: { k: 'l', d: { id: 'A1', v: 'Boutique Atlas', n: 'Sara Client', cp: '0600000001', p: 'Robe test', m: 250, s: 1, w: '212600000000' } } },
  CCCCCCCCCC: { status: 200, body: { k: 'cf', d: { i: 'A1', n: 'Sara', pr: 'Robe test', t: 250, a: 'Rue 1', c: 'Rabat', w: '212600000000', b: 'Boutique Atlas' } } },
  DDDDDDDDDD: { status: 410, body: { error: 'lien expiré' } },
  EEEEEEEEEE: { status: 404, body: { error: 'lien inconnu' } },
  FFFFFFFFFF: { status: 403, body: { error: 'entreprise suspendue' } },
  GGGGGGGGGG: { abort: true }
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
  const linkCalls = [], writes = [], errors = [];
  const mode = { write: 201, tenantStatus: 'active', role: 'owner' };
  await page.route(SB + '/functions/v1/link/*', async (route) => {
    const code = route.request().url().split('/').pop();
    linkCalls.push(code);
    const r = LINKS[code];
    if (!r) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"lien inconnu"}' });
    if (r.abort) return route.abort('failed');
    return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
  });
  await page.route(SB + '/rest/v1/memberships*', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ role: mode.role, tenant: { id: TENANT, name: 'Test', plan: 'trial', status: mode.tenantStatus } }]) }));
  await page.route(SB + '/rest/v1/short_links*', async (route) => {
    writes.push(JSON.parse(route.request().postData() || '[]')[0]);
    if (mode.write >= 400) return route.fulfill({ status: mode.write, contentType: 'application/json', body: JSON.stringify({ message: 'new row violates row-level security policy' }) });
    return route.fulfill({ status: 201, body: '' });
  });
  page.on('pageerror', (e) => errors.push(e.message));
  if (opts && opts.session) {
    await context.addInitScript((tenant) => {
      try {
        localStorage.setItem('aio_sb', JSON.stringify({ access_token: 'tok', refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'a@test.invalid' } }));
        localStorage.setItem('aio_tenant', JSON.stringify(tenant));
      } catch (e) { /* ignoré */ }
    }, TENANT);
  }
  try { await handler({ page, base, linkCalls, writes, errors, mode }); }
  finally { await browser.close(); server.close(); }
}

const text = (page) => page.locator('#app').innerText();

test('?r= type « t » : la page de suivi client s’affiche avec le contenu du lien court', async (t) => {
  await withPage(t, {}, async ({ page, base, linkCalls, errors }) => {
    await page.goto(base + '/index.html?r=AAAAAAAAAA');
    await page.waitForFunction(() => /Robe test/.test(document.getElementById('app').innerText), null, { timeout: 8000 });
    const txt = await text(page);
    assert.match(txt, /Suivi de ta commande/);
    assert.match(txt, /Boutique Atlas/);
    assert.match(txt, /Karim/);
    assert.deepEqual(linkCalls, ['AAAAAAAAAA']);
    assert.deepEqual(errors, []);
  });
});

test('?r= type « l » : la page livreur s’affiche', async (t) => {
  await withPage(t, {}, async ({ page, base, errors }) => {
    await page.goto(base + '/index.html?r=BBBBBBBBBB');
    await page.waitForFunction(() => /Sara Client/.test(document.getElementById('app').innerText), null, { timeout: 8000 });
    assert.match(await text(page), /Robe test/);
    assert.deepEqual(errors, []);
  });
});

test('?r= type « cf » : la page de confirmation client s’affiche', async (t) => {
  await withPage(t, {}, async ({ page, base, errors }) => {
    await page.goto(base + '/index.html?r=CCCCCCCCCC');
    await page.waitForFunction(() => /Bonjour Sara/.test(document.getElementById('app').innerText), null, { timeout: 8000 });
    const txt = await text(page);
    assert.match(txt, /Robe test/);
    assert.match(txt, /250 dh/);
    assert.deepEqual(errors, []);
  });
});

test('?r= : messages clairs pour un lien expiré, inconnu, suspendu, hors ligne ou mal formé', async (t) => {
  await withPage(t, {}, async ({ page, base, linkCalls, errors }) => {
    const cases = [['DDDDDDDDDD', /expiré/], ['EEEEEEEEEE', /introuvable/], ['FFFFFFFFFF', /plus disponible/], ['GGGGGGGGGG', /Pas de connexion/]];
    for (const [code, re] of cases) {
      await page.goto(base + '/index.html?r=' + code);
      await page.waitForFunction((src) => new RegExp(src).test(document.getElementById('app').innerText), re.source, { timeout: 8000 });
    }
    const before = linkCalls.length;
    await page.goto(base + '/index.html?r=abc');
    await page.waitForFunction(() => /Lien invalide/.test(document.getElementById('app').innerText), null, { timeout: 8000 });
    assert.equal(linkCalls.length, before, 'un code mal formé ne doit appeler aucun serveur');
    assert.deepEqual(errors, []);
  });
});

test('ancien long lien ?t= : toujours accepté, sans appel à la fonction link', async (t) => {
  await withPage(t, {}, async ({ page, base, linkCalls, errors }) => {
    const d = { v: 'Ancienne Boutique', p: 'Ancien produit', s: 1, w: '212600000000' };
    await page.goto(base + '/index.html?t=' + encodeURIComponent(Buffer.from(JSON.stringify(d), 'utf8').toString('base64')));
    await page.waitForFunction(() => /Ancien produit/.test(document.getElementById('app').innerText), null, { timeout: 8000 });
    assert.deepEqual(linkCalls, []);
    assert.deepEqual(errors, []);
  });
});

async function ownerOrder(page) {
  await page.waitForFunction(() => window.cloudShort && typeof DB !== 'undefined' && DB && DB.set, null, { timeout: 8000 });
  await page.evaluate(() => {
    DB.orders.push({ id: 'o1', name: 'Sara', phone: '0600000001', vendor: 'Boutique Atlas', product: 'Robe test', amount: 250, city: 'Rabat', address: 'Rue 1', status: 'Confirmé', delivery: '', courier: '' });
  });
}

test('propriétaire sans compte cloud : tlink garde l’ancien long lien', async (t) => {
  await withPage(t, {}, async ({ page, base, writes, errors }) => {
    await page.goto(base + '/index.html');
    await ownerOrder(page);
    const link = await page.evaluate(() => tlink(DB.orders.find((o) => o.id === 'o1'), 't'));
    assert.match(link, /\?t=/);
    assert.equal(writes.length, 0);
    assert.deepEqual(errors, []);
  });
});

test('propriétaire connecté : lien court, enregistré une seule fois, mis à jour quand le contenu change', async (t) => {
  await withPage(t, { session: true }, async ({ page, base, writes, errors }) => {
    await page.goto(base + '/index.html');
    await ownerOrder(page);
    await page.waitForFunction(() => cloudShort.ready(), null, { timeout: 8000 });
    const l1 = await page.evaluate(() => tlink(DB.orders.find((o) => o.id === 'o1'), 't'));
    assert.match(l1, /^http:\/\/127\.0\.0\.1:\d+\/index\.html\?r=[A-Za-z0-9]{10}$/);
    assert.ok(l1.length < 70, 'lien trop long : ' + l1.length);
    await page.waitForFunction(() => true);
    await page.waitForTimeout(300);
    assert.equal(writes.length, 1);
    const code = l1.split('?r=')[1];
    assert.equal(writes[0].code, code);
    assert.equal(writes[0].kind, 't');
    assert.equal(writes[0].order_id, 'o1');
    assert.equal(writes[0].tenant_id, TENANT);
    assert.equal(writes[0].payload.p, 'Robe test');
    assert.equal(JSON.stringify(writes[0]).includes('trackOwnerKey'), false);
    // même contenu : même lien, aucun nouvel envoi
    const l2 = await page.evaluate(() => tlink(DB.orders.find((o) => o.id === 'o1'), 't'));
    await page.waitForTimeout(200);
    assert.equal(l2, l1);
    assert.equal(writes.length, 1);
    // le contenu change (livraison en cours) : même code, nouvel enregistrement
    await page.evaluate(() => { DB.orders.find((o) => o.id === 'o1').delivery = 'En cours'; });
    const l3 = await page.evaluate(() => tlink(DB.orders.find((o) => o.id === 'o1'), 't'));
    await page.waitForTimeout(300);
    assert.equal(l3, l1);
    assert.equal(writes.length, 2);
    assert.equal(writes[1].payload.s, 2);
    // lien livreur : code différent, type « l »
    const l4 = await page.evaluate(() => tlink(DB.orders.find((o) => o.id === 'o1'), 'l'));
    await page.waitForTimeout(300);
    assert.notEqual(l4, l1);
    assert.equal(writes[2].kind, 'l');
    assert.deepEqual(errors, []);
  });
});

test('propriétaire connecté : un refus du serveur ne provoque pas de boucle de requêtes', async (t) => {
  await withPage(t, { session: true }, async ({ page, base, writes, mode, errors }) => {
    mode.write = 403;
    await page.goto(base + '/index.html');
    await ownerOrder(page);
    await page.waitForFunction(() => cloudShort.ready(), null, { timeout: 8000 });
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => tlink(DB.orders.find((o) => o.id === 'o1'), 't'));
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(300);
    assert.equal(writes.length, 1, 'un refus définitif ne doit pas être rejoué à chaque affichage');
    assert.deepEqual(errors, []);
  });
});

test('entreprise suspendue ou rôle livreur : pas de lien court, ancien long lien', async (t) => {
  for (const [tenantStatus, role] of [['suspended', 'owner'], ['active', 'courier']]) {
    await withPage(t, { session: true }, async ({ page, base, writes, mode, errors }) => {
      mode.tenantStatus = tenantStatus; mode.role = role;
      await page.goto(base + '/index.html');
      await ownerOrder(page);
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => cloudShort.ready()), false);
      const link = await page.evaluate(() => tlink(DB.orders.find((o) => o.id === 'o1'), 't'));
      assert.match(link, /\?t=/);
      assert.equal(writes.length, 0);
      assert.deepEqual(errors, []);
    });
  }
});

test('cloudShort.code : 10 caractères alphanumériques, sans doublon sur 2000 tirages', async (t) => {
  await withPage(t, {}, async ({ page, base }) => {
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.cloudShort, null, { timeout: 8000 });
    const codes = await page.evaluate(() => Array.from({ length: 2000 }, () => cloudShort.code()));
    assert.ok(codes.every((c) => /^[A-Za-z0-9]{10}$/.test(c)));
    assert.equal(new Set(codes).size, 2000);
  });
});

test('sw.js : les liens courts ne sont pas mis en cache', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const m = /var LINK=(\/.*\/);/.exec(sw);
  assert.ok(m, 'LINK introuvable');
  const re = eval(m[1]); // expression régulière littérale du dépôt
  assert.ok(re.test('?r=AAAAAAAAAA'));
  assert.ok(re.test('?t=abc') && re.test('?l=abc') && re.test('?cf=abc'));
});

// Test de « neworder » (limite de taille). Lancer : node supabase/functions/neworder/neworder.test.mjs
let handler;
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' })[k] }, serve: (h) => { handler = h; } };
await import('./index.ts');
const J = (o, status = 200) => ({ ok: status < 400, status, json: async () => o, text: async () => JSON.stringify(o) });
let calls;
globalThis.fetch = async (url, opt = {}) => {
  calls.push(String(url));
  if (String(url).includes('/vendor_forms?')) return J([{ tenant_id: 'T1', vendor_name: 'V' }]);
  if (String(url).includes('/tenants?')) return J([{ status: 'active' }]);
  if (String(url).includes('/orders?select')) return J([]);
  return J({}, 201);
};
const K = 'a'.repeat(32);
const post = (b, h = {}) => handler(new Request('https://x/f/neworder', { method: 'POST', headers: h, body: JSON.stringify(b) }));
let fails = 0;
const check = (n, c) => { console.log((c ? 'OK   ' : 'ECHEC') + ' ' + n); if (!c) fails++; };
const base = { k: K, name: 'Sara', product: 'Robe', phone: '0612345678' };
calls = []; let r = await post(base); check('commande normale -> 200', r.status === 200);
calls = []; r = await post({ ...base, photo: 'data:image/png;base64,' + 'A'.repeat(1000000) }); check('photo énorme -> 413 sans écrire', r.status === 413 && !calls.some((u) => u.includes('/storage/') || u.includes('on_conflict')));
calls = []; r = await post(base, { 'content-length': '5000000' }); check('contenu annoncé trop lourd -> 413 sans lecture base', r.status === 413 && calls.length === 0);
calls = []; r = await post({ ...base, k: 'zz' }); check('clé invalide -> 401', r.status === 401);
console.log(fails ? '\n' + fails + ' ECHEC(S)' : '\nTous les tests passent'); process.exit(fails ? 1 : 0);

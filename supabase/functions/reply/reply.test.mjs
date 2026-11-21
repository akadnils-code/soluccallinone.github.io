// Test de la fonction Edge « reply » avec une base simulée. Lancer : node supabase/functions/reply/reply.test.mjs (Node 22.18 ou plus récent)
let handler;
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' })[k] }, serve: (h) => { handler = h; } };
await import('./index.ts');
const TOK = '7d28ef12466e081822b5a8a9', KEY = 'abcdefghijklmnop1234';
const J = (o, status = 200) => ({ ok: status < 400, status, json: async () => o, text: async () => JSON.stringify(o) });
let calls;
function mock(cfg) {
  calls = [];
  globalThis.fetch = async (url, opt = {}) => {
    calls.push({ url, method: opt.method || 'GET', body: opt.body });
    if (url.includes('reply_tok=eq.')) return cfg.lookup === 'error' ? J({}, 500) : J(cfg.lookup === 'hit' ? [{ tenant_id: 'T1' }] : []);
    if (url.includes('select=tenant_id,key')) return J(cfg.scan || []);
    if (url.includes('/tenants?')) return J([{ status: cfg.status || 'active' }]);
    if (url.includes('/order_replies?select')) return J(cfg.pending || []);
    if (url.includes('/order_replies') && opt.method === 'POST') return J({}, cfg.insertStatus || 201);
    throw new Error('appel inattendu ' + url);
  };
}
const post = (b) => handler(new Request('https://x/reply', { method: 'POST', body: JSON.stringify(b) }));
let fails = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'OK   ' : 'ECHEC') + ' ' + name + (cond ? '' : ' ' + extra)); if (!cond) fails++; };
const good = { t: TOK, i: 'abc123', s: 'ok', a: 'Rue 1', la: 33.5, ln: -7.6 };

mock({ lookup: 'hit' }); let r = await post({ t: TOK, i: 'a' });
check('1 requête sans statut -> 400', r.status === 400 && calls.length === 0);
mock({ lookup: 'hit' }); r = await post({ ...good, t: 'ZZ' });
check('2 jeton mal formé -> 400, aucun appel base', r.status === 400 && calls.length === 0);
mock({ lookup: 'empty' }); r = await post(good);
check('3 jeton inconnu -> 401, sans balayage des clés', r.status === 401 && !calls.some((c) => c.url.includes('select=tenant_id,key')), JSON.stringify(calls.map((c) => c.url)));
mock({ lookup: 'hit' }); r = await post(good); let j = await r.json();
const ins = calls.find((c) => c.method === 'POST');
check('4 jeton valide + active -> 200 ok + 1 insertion correcte', r.status === 200 && j.ok && ins && JSON.parse(ins.body).tenant_id === 'T1' && JSON.parse(ins.body).order_id === 'abc123' && JSON.parse(ins.body).status === 'ok');
mock({ lookup: 'hit', status: 'suspended' }); r = await post(good);
check('5 entreprise suspendue -> 403, aucune insertion', r.status === 403 && !calls.some((c) => c.method === 'POST'));
mock({ lookup: 'hit', pending: [{ id: 1, order_id: 'abc123', status: 'ok' }] }); r = await post(good); j = await r.json();
check('6 doublon en attente -> ok+dup, aucune insertion', r.status === 200 && j.dup === true && !calls.some((c) => c.method === 'POST'));
mock({ lookup: 'hit', pending: Array.from({ length: 500 }, (_, k) => ({ id: k, order_id: 'o' + k, status: 'ok' })) }); r = await post(good);
check('7 500 réponses en attente -> 429', r.status === 429);
mock({ lookup: 'error', scan: [{ tenant_id: 'T1', key: KEY }] }); r = await post(good);
check('8 colonne indisponible -> secours par balayage, 200', r.status === 200 && calls.some((c) => c.url.includes('select=tenant_id,key')));
mock({ lookup: 'error', scan: [{ tenant_id: 'T9', key: 'autreclecomplete1234' }] }); r = await post(good);
check('9 colonne indisponible + jeton inconnu -> 401', r.status === 401);
mock({ lookup: 'hit', insertStatus: 500 }); r = await post(good);
check('10 insertion en échec -> 502', r.status === 502);
mock({}); r = await handler(new Request('https://x/reply', { method: 'GET' })); j = await r.json();
check('11 GET -> service ok', j.ok === true);
console.log(fails ? '\n' + fails + ' ECHEC(S)' : '\nTous les tests passent');
process.exit(fails ? 1 : 0);

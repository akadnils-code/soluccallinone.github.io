// Test de la fonction Edge « space » avec une base simulée. Lancer : node supabase/functions/space/space.test.mjs (Node 22.18 ou plus récent)
let handler;
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' })[k] }, serve: (h) => { handler = h; } };
await import('./index.ts');
const J = (o, status = 200) => ({ ok: status < 400, status, json: async () => o, text: async () => JSON.stringify(o) });
const FUT = new Date(Date.now() + 864e5).toISOString(), PAST = new Date(Date.now() - 864e5).toISOString();
let calls;
function mock(cfg) {
  calls = [];
  globalThis.fetch = async (url, opt = {}) => {
    calls.push({ url, opt });
    if (url.includes('/short_links?')) return cfg.dbError ? J({}, 500) : J(cfg.rows || []);
    if (url.includes('/tenants?')) return J([{ status: cfg.status || 'active' }]);
    if (url.includes('/vendors?')) return J([{ name: 'Boutique', data: { phone: '0600', addr: 'Rue 1', city: 'Rabat' } }]);
    if (url.includes('/orders?') && (opt.method || 'GET') === 'GET') return J(cfg.orders || []);
    if (url.includes('/orders?') && opt.method === 'PATCH') return J({}, cfg.patchStatus || 200);
    throw new Error('appel inattendu ' + url);
  };
}
const CODE = 'Ab3xY9kLmN';
const req = (method, body, code = CODE) => handler(new Request('https://x/functions/v1/space/' + code, { method, body: body ? JSON.stringify(body) : undefined }));
const link = (o = {}) => ({ kind: 'dsp', payload: { n: 'Ali' }, tenant_id: 'T1', revoked: false, expires_at: FUT, ...o });
const ord = (o = {}, id = 'o1') => ({ id, deleted_at: null, data: { product: 'Robe', amount: 200, city: 'Fès', name: 'Sara', phone: '0611', address: 'Av 2', vendor: 'Boutique', courier: 'Ali', status: 'Confirmé', delivery: '', bd: 12, ...o } });
let fails = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'OK   ' : 'ECHEC') + ' ' + name + (cond ? '' : ' ' + extra)); if (!cond) fails++; };

mock({}); let r = await req('GET', null, 'abc');
check('1 code mal formé -> 400, aucun appel', r.status === 400 && calls.length === 0);
mock({ rows: [] }); r = await req('GET');
check('2 code inconnu -> 404', r.status === 404);
check('3 la requête ne lit que les liens dsp/vsp', calls[0].url.includes('kind=in.(dsp,vsp)'));
mock({ rows: [link({ revoked: true })] }); r = await req('GET');
check('4 révoqué -> 410', r.status === 410);
mock({ rows: [link({ expires_at: PAST })] }); r = await req('GET');
check('5 expiré -> 410', r.status === 410);
mock({ rows: [link()], status: 'suspended' }); r = await req('GET');
check('6 entreprise suspendue -> 403', r.status === 403);
mock({ rows: [link({ payload: {} })] }); r = await req('GET');
check('7 lien sans nom -> 400', r.status === 400);

mock({ rows: [link()], orders: [ord()] }); r = await req('GET'); let j = await r.json();
const ou = calls.find((c) => c.url.includes('/orders?')).url;
check('8 livreur : liste filtrée par son nom et commandes confirmées', r.status === 200 && j.k === 'dsp' && j.o.length === 1 && ou.includes('data->>courier=eq.') && ou.includes('status=eq.Confirm') && ou.includes('tenant_id=eq.T1'), ou);
check('9 livreur : adresse et téléphone du vendeur ajoutés', j.o[0].vp === '0600' && j.o[0].va === 'Rue 1' && j.o[0].v === 'Boutique');
check('10 aucune clé secrète dans la réponse', !JSON.stringify(j).includes('srk'));
mock({ rows: [link({ payload: { n: 'A"li\\' } })], orders: [] }); r = await req('GET');
const ou2 = calls.find((c) => c.url.includes('/orders?')).url;
check('11 nom avec guillemets : bien échappé dans la requête', ou2.includes('%5C%22') && !ou2.includes('A"li'), ou2);

mock({ rows: [link({ kind: 'vsp', payload: { n: 'Boutique' } })], orders: [ord({ delivery: 'Livré' })] }); r = await req('GET'); j = await r.json();
const ou3 = calls.find((c) => c.url.includes('/orders?')).url;
check('12 vendeur : filtre par vendeur, sans filtre de statut, avec le livreur', j.k === 'vsp' && ou3.includes('data->>vendor=eq.') && !ou3.includes('status=eq.') && j.o[0].c === 'Ali', ou3);

for (const [a, d] of [['pickup', 'En cours'], ['delivered', 'Livré'], ['refused', 'Refusé']]) {
  mock({ rows: [link()], orders: [ord()] }); r = await req('POST', { id: 'o1', a }); j = await r.json();
  const p = calls.find((c) => c.opt.method === 'PATCH'), body = p && JSON.parse(p.opt.body);
  check('13 ' + a + ' -> ' + d, r.status === 200 && j.d === d && body.delivery === d && body.data.delivery === d && p.url.includes('tenant_id=eq.T1') && p.url.includes('id=eq.o1'), JSON.stringify(j));
  if (a === 'delivered') check('14 commission de livraison figée (fd = bd)', body.data.fd === 12 && body.data.courier === 'Ali');
}
mock({ rows: [link()], orders: [ord({ courier: 'Karim' })] }); r = await req('POST', { id: 'o1', a: 'delivered' });
check('15 commande d’un autre livreur -> 404, aucune écriture', r.status === 404 && !calls.some((c) => c.opt.method === 'PATCH'));
mock({ rows: [link()], orders: [ord({ status: 'En attente' })] }); r = await req('POST', { id: 'o1', a: 'delivered' });
check('16 commande non confirmée -> 404', r.status === 404 && !calls.some((c) => c.opt.method === 'PATCH'));
mock({ rows: [link()], orders: [{ ...ord(), deleted_at: '2026-01-01' }] }); r = await req('POST', { id: 'o1', a: 'delivered' });
check('17 commande supprimée -> 404', r.status === 404);
mock({ rows: [link()], orders: [ord({ delivery: 'Livré' })] }); r = await req('POST', { id: 'o1', a: 'refused' });
check('18 commande déjà livrée : pas de retour en arrière -> 409', r.status === 409 && !calls.some((c) => c.opt.method === 'PATCH'));
mock({ rows: [link()], orders: [ord({ delivery: 'En cours' })] }); r = await req('POST', { id: 'o1', a: 'pickup' }); j = await r.json();
check('19 « Récupéré » rejoué : doublon ignoré', r.status === 200 && j.dup && !calls.some((c) => c.opt.method === 'PATCH'));
mock({ rows: [link()], orders: [ord()] }); r = await req('POST', { id: 'o1', a: 'hack' });
check('20 action inconnue -> 400', r.status === 400);
mock({ rows: [link({ kind: 'vsp', payload: { n: 'Boutique' } })], orders: [ord()] }); r = await req('POST', { id: 'o1', a: 'delivered' });
check('21 espace vendeur : écriture refusée -> 403', r.status === 403 && !calls.some((c) => c.opt.method === 'PATCH'));
mock({ rows: [link()], orders: [ord()], patchStatus: 500 }); r = await req('POST', { id: 'o1', a: 'delivered' });
check('22 écriture en erreur -> 502', r.status === 502);
mock({}); r = await req('DELETE');
check('23 DELETE -> 405', r.status === 405);
console.log(fails ? '\n' + fails + ' ECHEC(S)' : '\nTous les tests passent');
process.exit(fails ? 1 : 0);

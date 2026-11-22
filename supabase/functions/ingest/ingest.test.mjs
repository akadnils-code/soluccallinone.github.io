// Test du durcissement SSRF de la fonction Edge « ingest » (base et réseau simulés). Lancer : node supabase/functions/ingest/ingest.test.mjs
let handler;
const DNS = {};
globalThis.Deno = {
  env: { get: (k) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk', WHATSAPP_TOKEN: 'wt' })[k] },
  serve: (h) => { handler = h; },
  resolveDns: async (host, type) => { const r = (DNS[host] || {})[type]; if (!r) throw new Error('NXDOMAIN'); return r; },
};
await import('./index.ts');
const J = (o, status = 200, headers = {}) => ({ ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json', ...headers }), json: async () => o, text: async () => JSON.stringify(o), body: null });
const KEY = 'AbCdEfGhIjKlMnOp';
let fetched, auths;
function mock(extra = {}) {
  fetched = []; auths = [];
  globalThis.fetch = async (url, opt = {}) => {
    url = String(url);
    if (url.startsWith('https://x.supabase.co/rest/v1/webhook_keys')) return J([{ tenant_id: 'T1', default_vendor: 'V' }]);
    if (url.startsWith('https://x.supabase.co/rest/v1/tenants')) return J([{ status: 'active' }]);
    if (url.startsWith('https://x.supabase.co/')) return J({}, 201);
    fetched.push(url); auths.push((opt.headers || {}).Authorization || '');
    if (extra[url]) return extra[url]();
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }), body: null };
  };
}
const preview = (link) => handler(new Request('https://x/functions/v1/ingest/' + KEY + '/preview', { method: 'POST', body: JSON.stringify({ url: link }) }));
let fails = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'OK   ' : 'ECHEC') + ' ' + name + (cond ? '' : ' ' + extra)); if (!cond) fails++; };

for (const [name, link] of [
  ['IPv6 boucle locale', 'http://[::1]/x'], ['IPv4 boucle locale', 'http://127.0.0.1/x'], ['métadonnées cloud', 'http://169.254.169.254/latest'],
  ['réseau partagé 100.64/10', 'http://100.64.0.1/'], ['192.0.0.0/24', 'http://192.0.0.5/'], ['198.18/15', 'http://198.18.0.1/'],
  ['adresse décimale', 'http://2130706433/'], ['adresse hexadécimale', 'http://0x7f.0.0.1/'], ['localhost', 'http://localhost/'], ['IPv6 mappée', 'http://[::ffff:7f00:1]/'],
]) { mock(); await preview(link); check('adresse refusée : ' + name, !fetched.some((u) => /^https?:\/\/(\[|127|169|100\.64|192\.0|198\.18|2130|0x7f|localhost)/.test(u)), fetched.join(',')); }

DNS['evil6.test'] = { A: ['93.184.216.34'], AAAA: ['::1'] };
mock(); await preview('https://evil6.test/'); check('nom dont l’enregistrement AAAA vise ::1 : refusé', !fetched.some((u) => u.includes('evil6.test')));
DNS['evil6b.test'] = { A: ['93.184.216.34'], AAAA: ['fd00::1'] };
mock(); await preview('https://evil6b.test/'); check('AAAA fd00::/8 (réseau privé) : refusé', !fetched.some((u) => u.includes('evil6b.test')));
DNS['evil6c.test'] = { A: ['93.184.216.34'], AAAA: ['::ffff:10.0.0.1'] };
mock(); await preview('https://evil6c.test/'); check('AAAA mappée sur 10.0.0.1 : refusé', !fetched.some((u) => u.includes('evil6c.test')));
DNS['evil4.test'] = { A: ['10.1.2.3'] };
mock(); await preview('https://evil4.test/'); check('nom dont l’enregistrement A vise 10.x : refusé', !fetched.some((u) => u.includes('evil4.test')));
DNS['nodns.test'] = {};
mock(); await preview('https://nodns.test/'); check('nom sans enregistrement : refusé', !fetched.some((u) => u.includes('nodns.test')));
DNS['good.test'] = { A: ['93.184.216.34'], AAAA: ['2606:2800:220:1::1'] };
mock(); await preview('https://good.test/p'); check('site public (A + AAAA publics) : récupéré', fetched.includes('https://good.test/p'), fetched.join(','));

// Le jeton WhatsApp ne doit jamais suivre une redirection vers un autre site
DNS['graph.test'] = { A: ['93.184.216.34'] }; DNS['other.test'] = { A: ['93.184.216.35'] };
mock({
  'https://graph.facebook.com/v21.0/m1': () => J({ url: 'https://good.test/img.jpg' }),
  'https://good.test/img.jpg': () => ({ ok: false, status: 302, headers: new Headers({ location: 'https://other.test/steal.jpg' }), body: null }),
});
await handler(new Request('https://x/functions/v1/ingest/' + KEY, { method: 'POST', body: JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: [], messages: [{ id: 'w1', from: '212612345678', type: 'image', image: { id: 'm1', caption: 'commande tel: 0612345678' } }] } }] }] }) }));
const iGood = fetched.indexOf('https://good.test/img.jpg'), iOther = fetched.indexOf('https://other.test/steal.jpg');
check('jeton envoyé au site d’origine', iGood >= 0 && auths[iGood] === 'Bearer wt', JSON.stringify({ fetched, auths }));
check('jeton NON envoyé après redirection vers un autre site', iOther >= 0 && auths[iOther] === '', JSON.stringify({ fetched, auths }));
console.log(fails ? '\n' + fails + ' ECHEC(S)' : '\nTous les tests passent');
process.exit(fails ? 1 : 0);

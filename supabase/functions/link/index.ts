// @ts-nocheck
/**
 * ALL IN ONE · Edge Function « link » (liens courts)
 * GET /functions/v1/link/<code>  ->  { k: 't' | 'l' | 'cf', d: { ...charge utile du lien } }
 * Liens t/l : l'étape (s), l'indicateur d'échec (bad) et le livreur (c) sont relus dans la commande : le suivi est en direct.
 * Le code (10 caractères) est enregistré par l'application du vendeur (table short_links).
 * La page client / livreur reçoit la même charge utile que celle contenue dans un ancien long lien.
 * Refus : code mal formé (400), inconnu (404), révoqué ou expiré (410), entreprise suspendue (403).
 * Déploiement : verify_jwt = false (le client et le livreur n'ont pas de compte).
 */
const SB = Deno.env.get('SUPABASE_URL');
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: SR, Authorization: 'Bearer ' + SR };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*' };
const out = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return out({ error: 'méthode refusée' }, 405);

  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const code = parts[parts.length - 1] || '';
  if (!/^[A-Za-z0-9]{10}$/.test(code)) return out({ error: 'lien invalide' }, 400);

  const r = await fetch(SB + '/rest/v1/short_links?select=kind,payload,tenant_id,order_id,revoked,expires_at&code=eq.' + code + '&limit=1', { headers: H });
  if (!r.ok) { console.error('short_links', r.status); return out({ error: 'service indisponible' }, 502); }
  const j = await r.json();
  if (!j || !j.length) return out({ error: 'lien inconnu' }, 404);
  const row = j[0];
  if (row.revoked || new Date(row.expires_at).getTime() < Date.now()) return out({ error: 'lien expiré' }, 410);

  const tr = await fetch(SB + '/rest/v1/tenants?select=status&id=eq.' + row.tenant_id + '&limit=1', { headers: H });
  const tj = tr.ok ? await tr.json() : null;
  if (!tj || !tj.length || tj[0].status !== 'active') return out({ error: 'entreprise suspendue' }, 403);

  // Suivi en direct : pour les liens client (t) et livreur (l), l'étape et le livreur sont relus dans la commande à chaque ouverture.
  let d = row.payload;
  if ((row.kind === 't' || row.kind === 'l') && row.order_id) {
    const or = await fetch(SB + '/rest/v1/orders?select=data,deleted_at&tenant_id=eq.' + row.tenant_id + '&id=eq.' + encodeURIComponent(row.order_id) + '&limit=1', { headers: H });
    const oj = or.ok ? await or.json() : [];
    const o = oj && oj[0] && !oj[0].deleted_at ? oj[0].data || {} : null;
    if (o) {
      const bad = o.status === 'Annulé' || o.status === 'Injoignable' || o.delivery === 'Refusé' || o.delivery === 'Annulé';
      const s = o.status !== 'Confirmé' ? 0 : o.delivery === 'Livré' ? 3 : o.delivery === 'En cours' ? 2 : 1;
      d = Object.assign({}, row.payload, { s, bad: bad ? 1 : 0 });
      if (row.kind === 't') d.c = String(o.courier || '').slice(0, 120);
    }
  }
  return out({ k: row.kind, d });
});

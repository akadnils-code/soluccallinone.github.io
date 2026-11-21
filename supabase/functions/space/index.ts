// @ts-nocheck
/**
 * ALL IN ONE · Edge Function « space » (espace livreur / espace vendeur, sans compte)
 * GET  /functions/v1/space/<code> -> { k:'dsp'|'vsp', n:<nom>, o:[commandes], v:{vendeurs} }
 * POST /functions/v1/space/<code> {id, a:'pickup'|'delivered'|'refused'} -> espace livreur uniquement
 * Le code (table short_links, kind dsp ou vsp) identifie UN livreur ou UN vendeur : il ne voit que ses commandes.
 * Le livreur ne voit que les commandes confirmées qui lui sont attribuées ; le vendeur est en lecture seule.
 * Déploiement : verify_jwt = false.
 */
const SB = Deno.env.get('SUPABASE_URL');
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };
const out = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const EV = { pickup: 'En cours', delivered: 'Livré', refused: 'Refusé' };
const s = (v, n) => String(v == null ? '' : v).slice(0, n || 200);

async function load(code) {
  const r = await fetch(SB + '/rest/v1/short_links?select=kind,payload,tenant_id,revoked,expires_at&kind=in.(dsp,vsp)&code=eq.' + code + '&limit=1', { headers: H });
  if (!r.ok) return { e: out({ error: 'service indisponible' }, 502) };
  const j = await r.json();
  if (!j || !j.length) return { e: out({ error: 'lien inconnu' }, 404) };
  const row = j[0];
  if (row.revoked || new Date(row.expires_at).getTime() < Date.now()) return { e: out({ error: 'lien expiré' }, 410) };
  const tr = await fetch(SB + '/rest/v1/tenants?select=status&id=eq.' + row.tenant_id + '&limit=1', { headers: H });
  const tj = tr.ok ? await tr.json() : null;
  if (!tj || !tj.length || tj[0].status !== 'active') return { e: out({ error: 'entreprise suspendue' }, 403) };
  const n = s(row.payload && row.payload.n, 120);
  if (!n) return { e: out({ error: 'lien invalide' }, 400) };
  return { row, n, tid: row.tenant_id };
}

const field = (k) => (k === 'dsp' ? 'courier' : 'vendor');
const enc = (v) => encodeURIComponent('"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
const own = (o, k, n) => o && o.data && o.data[field(k)] === n && !o.deleted_at;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET' && req.method !== 'POST') return out({ error: 'méthode refusée' }, 405);
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const code = parts[parts.length - 1] || '';
  if (!/^[A-Za-z0-9]{10}$/.test(code)) return out({ error: 'lien invalide' }, 400);
  const L = await load(code);
  if (L.e) return L.e;
  const k = L.row.kind;

  if (req.method === 'GET') {
    const q = '&data->>' + field(k) + '=eq.' + enc(L.n) + (k === 'dsp' ? '&status=eq.Confirm%C3%A9' : '');
    const r = await fetch(SB + '/rest/v1/orders?select=id,data,deleted_at,updated_at&tenant_id=eq.' + L.tid + '&deleted_at=is.null' + q + '&order=updated_at.desc&limit=300', { headers: H });
    if (!r.ok) { console.error('orders', r.status); return out({ error: 'service indisponible' }, 502); }
    const rows = await r.json();
    const vr = await fetch(SB + '/rest/v1/vendors?select=name,data&tenant_id=eq.' + L.tid + '&deleted_at=is.null&limit=1000', { headers: H });
    const vj = vr.ok ? await vr.json() : [];
    const V = {};
    vj.forEach((x) => { V[x.name] = x.data || {}; });
    const O = rows.map((x) => {
      const d = x.data || {};
      const base = { id: x.id, p: s(d.product), m: +d.amount || 0, cc: s(d.city, 80), d: s(d.delivery, 20), st: s(d.status, 20), dt: s(d.date, 20), n: s(d.name, 120), cp: s(d.phone, 30), ca: s(d.address) };
      if (k === 'dsp') {
        const v = V[d.vendor] || {};
        base.v = s(d.vendor, 120); base.vp = s(v.phone, 30); base.va = s(v.addr); base.vc = s(v.city, 80);
      } else base.c = s(d.courier, 120);
      return base;
    });
    return out({ k, n: L.n, o: O });
  }

  if (req.method === 'POST') {
    if (k !== 'dsp') return out({ error: 'lecture seule' }, 403);
    let b;
    try { b = await req.json(); } catch { return out({ error: 'json' }, 400); }
    const id = s(b && b.id, 80), ev = EV[b && b.a];
    if (!id || !ev) return out({ error: 'requête invalide' }, 400);
    const r = await fetch(SB + '/rest/v1/orders?select=id,data,deleted_at&tenant_id=eq.' + L.tid + '&id=eq.' + encodeURIComponent(id) + '&limit=1', { headers: H });
    const j = r.ok ? await r.json() : [];
    const o = j[0];
    if (!own(o, k, L.n) || o.data.status !== 'Confirmé') return out({ error: 'commande introuvable' }, 404);
    const cur = o.data.delivery || '';
    if (cur === 'Livré' || cur === 'Refusé' || cur === 'Annulé') return out({ error: 'commande déjà clôturée', d: cur }, 409);
    if (cur === ev) return out({ ok: true, d: ev, dup: true });
    const d = Object.assign({}, o.data, { delivery: ev, fd: ev === 'Livré' ? (+o.data.bd || 0) : 0, ts: Date.now() });
    const w = await fetch(SB + '/rest/v1/orders?tenant_id=eq.' + L.tid + '&id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ delivery: ev, data: d }) });
    if (!w.ok) { console.error('patch', w.status, await w.text()); return out({ error: 'enregistrement impossible' }, 502); }
    return out({ ok: true, d: ev });
  }
  return out({ error: 'méthode refusée' }, 405);
});

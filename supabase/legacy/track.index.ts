// COPIE DE RÉFÉRENCE (lecture seule) de la fonction Edge Supabase « track » v1 déployée. Non déployée depuis ce dépôt.
// @ts-nocheck
/** ALL IN ONE · Edge Function « track » : le livreur signale Récupéré / Livré / Refusé depuis son lien.
 * Dépose l'événement dans order_events ; l'appli du propriétaire l'applique toute seule.
 * Jeton public t = SHA-256(clé d'import + ":track") tronqué (ne révèle pas la clé). verify_jwt = false. */
const SB = Deno.env.get('SUPABASE_URL');
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };
const out = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
async function tok(key) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key + ':track'));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
const KINDS = { pickup: 1, delivered: 1, refused: 1 };
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return out({ ok: true, service: 'track' });
  let b;
  try { b = await req.json(); } catch { return out({ error: 'json' }, 400); }
  const t = String((b && b.t) || ''), i = String((b && b.i) || ''), k = String((b && b.e) || '');
  if (!/^[a-f0-9]{24}$/.test(t) || !i || i.length > 80 || !KINDS[k]) return out({ error: 'requête invalide' }, 400);
  const kr = await fetch(SB + '/rest/v1/webhook_keys?select=tenant_id,key&limit=2000', { headers: H });
  const kj = kr.ok ? await kr.json() : [];
  let tid = '';
  for (const r of kj) { if ((await tok(r.key)) === t) { tid = r.tenant_id; break; } }
  if (!tid) return out({ error: 'boutique inconnue' }, 401);
  const tr = await fetch(SB + '/rest/v1/tenants?select=status&id=eq.' + tid + '&limit=1', { headers: H });
  const tj = tr.ok ? await tr.json() : null;
  if (!tj || !tj.length || tj[0].status !== 'active') return out({ error: 'entreprise suspendue' }, 403);
  const pr = await fetch(SB + '/rest/v1/order_events?select=order_id,kind&tenant_id=eq.' + tid + '&applied_at=is.null&limit=500', { headers: H });
  const pj = pr.ok ? await pr.json() : [];
  if (pj.some((x) => x.order_id === i && x.kind === k)) return out({ ok: true, dup: true });
  if (pj.length >= 500) return out({ error: 'trop d’événements en attente' }, 429);
  const w = await fetch(SB + '/rest/v1/order_events', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ tenant_id: tid, order_id: i, kind: k }) });
  if (!w.ok) { console.error('insert event', w.status, await w.text()); return out({ error: 'enregistrement impossible' }, 502); }
  return out({ ok: true });
});

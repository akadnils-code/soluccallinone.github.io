// @ts-nocheck
/**
 * ALL IN ONE · Edge Function « reply »
 * Reçoit la réponse du client (confirmer / annuler + adresse) depuis la page de confirmation
 * et la dépose dans order_replies. L'appli du propriétaire la lit et l'applique toute seule.
 * Le jeton public « t » = SHA-256(clé d'import + ":reply") tronqué : il ne révèle pas la clé.
 * La base calcule ce même jeton (colonne indexée webhook_keys.reply_tok) : plus de balayage de toutes les clés.
 * Déploiement : verify_jwt = false (le client n'a pas de compte).
 */
const SB = Deno.env.get('SUPABASE_URL');
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };
const out = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function tok(key) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key + ':reply'));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
const num = (v) => (v === null || v === undefined || v === '' || !isFinite(v) ? null : +v);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return out({ ok: true, service: 'reply' });
  let b;
  try { b = await req.json(); } catch { return out({ error: 'json' }, 400); }
  const t = String((b && b.t) || ''), i = String((b && b.i) || ''), s = b && b.s === 'ok' ? 'ok' : b && b.s === 'x' ? 'x' : '';
  if (!/^[a-f0-9]{24}$/.test(t) || !i || i.length > 80 || !s) return out({ error: 'requête invalide' }, 400);

  // Recherche de l'entreprise par le jeton (colonne indexée). Si la colonne est indisponible (erreur), ancien balayage en secours.
  let tid = '';
  const kr = await fetch(SB + '/rest/v1/webhook_keys?select=tenant_id&reply_tok=eq.' + t + '&limit=1', { headers: H });
  if (kr.ok) {
    const kj = await kr.json();
    if (kj && kj.length) tid = kj[0].tenant_id;
  } else {
    console.error('reply_tok lookup', kr.status);
    const ar = await fetch(SB + '/rest/v1/webhook_keys?select=tenant_id,key&limit=2000', { headers: H });
    const aj = ar.ok ? await ar.json() : [];
    for (const r of aj) { if ((await tok(r.key)) === t) { tid = r.tenant_id; break; } }
  }
  if (!tid) return out({ error: 'boutique inconnue' }, 401);

  const tr = await fetch(SB + '/rest/v1/tenants?select=status&id=eq.' + tid + '&limit=1', { headers: H });
  const tj = tr.ok ? await tr.json() : null;
  if (!tj || !tj.length || tj[0].status !== 'active') return out({ error: 'entreprise suspendue' }, 403);

  // Anti-spam : au plus 500 réponses en attente, et pas de doublon identique en attente.
  const pr = await fetch(SB + '/rest/v1/order_replies?select=id,order_id,status&tenant_id=eq.' + tid + '&applied_at=is.null&limit=500', { headers: H });
  const pj = pr.ok ? await pr.json() : [];
  if (pj.some((x) => x.order_id === i && x.status === s)) return out({ ok: true, dup: true });
  if (pj.length >= 500) return out({ error: 'trop de réponses en attente' }, 429);

  const la = num(b.la), ln = num(b.ln);
  const row = { tenant_id: tid, order_id: i, status: s, address: String(b.a || '').slice(0, 200), lat: la, lng: ln };
  const w = await fetch(SB + '/rest/v1/order_replies', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row) });
  if (!w.ok) { console.error('insert reply', w.status, await w.text()); return out({ error: 'enregistrement impossible' }, 502); }
  return out({ ok: true });
});

// @ts-nocheck
/** ALL IN ONE · Edge Function « neworder » : le vendeur saisit une commande (+ photo du produit) depuis son lien.
 * La commande arrive dans l'appli du propriétaire à la prochaine synchronisation. verify_jwt = false (le vendeur n'a pas de compte).
 * Clé = vendor_forms.key (révocable par vendeur). v2 : taille de la photo plafonnée avant tout décodage. */
const SB = Deno.env.get('SUPABASE_URL');
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };
const out = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
function mph(p){var d=String(p||'').replace(/[^\d+]/g,'');if(d[0]==='+')d=d.slice(1);else if(d.indexOf('00')===0)d=d.slice(2);if(d.indexOf('212')===0)d=d.slice(3);else if(d[0]==='0')d=d.slice(1);return /^[5-7]\d{8}$/.test(d)?'0'+d:null}
const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
async function sha(x) { const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(x)); return [...new Uint8Array(b)].map((y) => y.toString(16).padStart(2, '0')).join('').slice(0, 16); }
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return out({ ok: true, service: 'neworder' });
  if (+(req.headers.get('content-length') || 0) > 1000000) return out({ error: 'Requête trop lourde.' }, 413);
  let b; try { b = await req.json(); } catch { return out({ error: 'json' }, 400); }
  const k = s(b && b.k, 64);
  if (!/^[a-f0-9]{32}$/.test(k)) return out({ error: 'lien invalide' }, 401);
  const kr = await fetch(SB + '/rest/v1/vendor_forms?select=tenant_id,vendor_name&active=eq.true&key=eq.' + k + '&limit=1', { headers: H });
  const kj = kr.ok ? await kr.json() : null;
  if (!kj || !kj.length) return out({ error: 'lien inconnu ou désactivé' }, 401);
  const tid = kj[0].tenant_id, vendor = kj[0].vendor_name;
  const tr = await fetch(SB + '/rest/v1/tenants?select=status&id=eq.' + tid + '&limit=1', { headers: H });
  const tj = tr.ok ? await tr.json() : null;
  if (!tj || !tj.length || tj[0].status !== 'active') return out({ error: 'entreprise suspendue' }, 403);
  const name = s(b.name, 80), product = s(b.product, 120), phone = mph(b.phone);
  if (!name || !product || !phone) return out({ error: 'Nom, produit et téléphone marocain valide (06… / 07…) obligatoires.' }, 400);
  // Anti-abus : 60 commandes par heure et par vendeur
  const since = new Date(Date.now() - 3600e3).toISOString();
  const rr = await fetch(SB + '/rest/v1/orders?select=id&tenant_id=eq.' + tid + '&vendor_name=eq.' + encodeURIComponent(vendor) + '&updated_at=gte.' + since + '&limit=61', { headers: H });
  const rj = rr.ok ? await rr.json() : [];
  if (rj.length >= 60) return out({ error: 'Trop de commandes en peu de temps, réessaie plus tard.' }, 429);
  const id = 'f' + (await sha(tid + '|' + k + '|' + Date.now() + '|' + Math.random()));
  let photo = '';
  const ps = String(b.photo || '');
  if (ps.length > 900000) return out({ error: 'Photo trop lourde.' }, 413); // ≈ 650 Ko d'image : refusé avant tout décodage
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/.exec(ps);
  if (m) {
    const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    if (bin.length > 600000) return out({ error: 'Photo trop lourde.' }, 413);
    const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg', path = tid + '/' + id + '.' + ext;
    const up = await fetch(SB + '/storage/v1/object/product-photos/' + path, { method: 'POST', headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': m[1], 'x-upsert': 'false' }, body: bin });
    if (up.ok) photo = SB + '/storage/v1/object/public/product-photos/' + path; else console.error('photo', up.status, await up.text());
  }
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Casablanca' });
  const ord = { id, date, ts: Date.now(), vendor, name, phone, product, address: s(b.address, 160), city: s(b.city, 40), channel: 'Formulaire vendeur', amount: Math.max(0, Math.min(1e7, +b.amount || 0)), upsell: 0, status: 'En attente', attempts: 0, delivery: '', courier: '', note: '', reason: '', cb: 0, xid: '', photo };
  const row = { tenant_id: tid, id, phone, vendor_name: vendor, status: ord.status, delivery: null, order_date: date, tid: null, data: ord, deleted_at: null, updated_at: new Date().toISOString() };
  const w = await fetch(SB + '/rest/v1/orders?on_conflict=tenant_id,id', { method: 'POST', headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify([row]) });
  if (!w.ok) { console.error('insert', w.status, await w.text()); return out({ error: 'enregistrement impossible' }, 502); }
  return out({ ok: true, photo: !!photo });
});

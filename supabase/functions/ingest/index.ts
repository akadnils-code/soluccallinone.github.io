// @ts-nocheck
/**
 * ALL IN ONE · Edge Function « ingest »
 * Reçoit une vente venant d'un réseau social ou d'un lien et crée la commande dans l'appli, avec la
 * photo, le titre et le descriptif du produit.
 *
 *   POST /ingest/<clé>              commande depuis :
 *        - WhatsApp Business Cloud API (Meta)       object = whatsapp_business_account
 *        - Instagram / Messenger / Page Facebook    object = instagram | page
 *        - Make, Zapier, n8n, formulaire…           JSON { link, text, name, phone, address, city, amount, product, vendor, source }
 *   POST /ingest/<clé>/preview      { url }  -> { title, desc, image, price, channel } (sans créer de commande)
 *   GET  /ingest/<clé>?hub.mode=subscribe&hub.verify_token=<clé>&hub.challenge=…   vérification Meta
 *
 * Variables facultatives : META_APP_SECRET (vérifie la signature X-Hub-Signature-256),
 *                          WHATSAPP_TOKEN (permet de télécharger les photos reçues sur WhatsApp).
 * Déploiement : verify_jwt = false (la clé dans l'adresse sert d'authentification, comme « webhook »).
 * v3 : récupération de pages durcie (IPv6, plages réservées, en-têtes d'authentification jamais renvoyés à un autre site).
 */
const SB = Deno.env.get('SUPABASE_URL');
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const APP_SECRET = Deno.env.get('META_APP_SECRET') || '';
const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN') || '';
const H = { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': '*' };
const txt = (m, s) => new Response(m, { status: s || 200, headers: CORS });
const jout = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
const UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

/* ---------- outils ---------- */
function mph(p) { var d = String(p || '').replace(/[^\d+]/g, ''); if (d[0] === '+') d = d.slice(1); else if (d.indexOf('00') === 0) d = d.slice(2); if (d.indexOf('212') === 0) d = d.slice(3); else if (d[0] === '0') d = d.slice(1); return /^[5-7]\d{8}$/.test(d) ? '0' + d : null; }
async function sha(s) { const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 16); }
function dec(s) {
  return String(s || '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
const clean = (s, n) => dec(String(s || '')).replace(/\s+/g, ' ').trim().slice(0, n);

/* ---------- récupération sécurisée d'une page ---------- */
function v4Private(a, b, c) {
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
// Adresse IPv6 interdite : boucle locale, non spécifiée, locale unique (fc00::/7), lien local (fe80::/10), multicast, adresses « IPv4 » encapsulées.
function v6Private(ip) {
  ip = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (ip === '::' || ip === '::1') return true;
  const m4 = ip.match(/^(?:::ffff:|64:ff9b::|::)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m4) return v4Private(+m4[1], +m4[2], +m4[3]);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ip)) {
    const h = ip.slice(7).split(':'); const x = parseInt(h[0], 16), y = parseInt(h[1], 16);
    return v4Private(x >> 8, x & 255, y >> 8);
  }
  return /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || /^ff/.test(ip) || /^64:ff9b:/.test(ip) || /^2002:/.test(ip) || /^2001:(0)?:/.test(ip);
}
function blocked(host) {
  host = String(host || '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true;
  if (host.indexOf(':') >= 0) return true; // une adresse IPv6 écrite directement n'est jamais acceptée
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) return v4Private(+m[1], +m[2], +m[3]);
  return false;
}
async function dnsPrivate(host) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  let any = false;
  for (const t of ['A', 'AAAA']) {
    try {
      const r = await Deno.resolveDns(host, t);
      for (const ip of r) { any = true; if (t === 'A' ? blocked(ip) : v6Private(ip)) return true; }
    } catch { /* pas d'enregistrement de ce type */ }
  }
  return !any; // aucun enregistrement exploitable : refusé
}
async function sfetch(url, opt) {
  opt = opt || {};
  const max = opt.max || 600000;
  let cur = url;
  const origin = new URL(url).hostname;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(cur);
    if (!/^https?:$/.test(u.protocol) || blocked(u.hostname) || (await dnsPrivate(u.hostname))) throw new Error('adresse refusée');
    // Les en-têtes fournis (ex. Authorization) ne partent que vers le site d'origine, jamais après une redirection vers un autre site.
    const extra = u.hostname === origin ? (opt.headers || {}) : {};
    const r = await fetch(cur, { redirect: 'manual', headers: { 'User-Agent': UA, 'Accept-Language': 'fr,en;q=0.8', ...extra }, signal: AbortSignal.timeout(opt.timeout || 8000) });
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) { cur = new URL(loc, cur).toString(); continue; }
    const chunks = []; let n = 0;
    if (r.body) {
      const rd = r.body.getReader();
      for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); n += value.length; if (n >= max) { try { await rd.cancel(); } catch { /* */ } break; } }
    }
    const bytes = new Uint8Array(Math.min(n, max)); let o = 0;
    for (const c of chunks) { const k = Math.min(c.length, bytes.length - o); if (k <= 0) break; bytes.set(c.subarray(0, k), o); o += k; }
    return { status: r.status, url: cur, type: r.headers.get('content-type') || '', bytes };
  }
  throw new Error('trop de redirections');
}

/* ---------- lecture des informations produit d'un lien ---------- */
function metas(html) {
  const out = {}; const re = /<meta\s+([^>]+?)\/?>/gi; let m;
  while ((m = re.exec(html))) {
    const a = m[1];
    const k = (/(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(a) || [])[1];
    const c = /content\s*=\s*"([^"]*)"/i.exec(a) || /content\s*=\s*'([^']*)'/i.exec(a);
    if (k && c && !(k.toLowerCase() in out)) out[k.toLowerCase()] = dec(c[1]);
  }
  return out;
}
function ldProduct(html) {
  const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi; let m;
  const find = (o) => {
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o)) { for (const x of o) { const r = find(x); if (r) return r; } return null; }
    const t = [].concat(o['@type'] || []).join(',');
    if (/Product/i.test(t)) return o;
    return find(o['@graph']) || null;
  };
  while ((m = re.exec(html))) {
    try { const p = find(JSON.parse(m[1])); if (p) return p; } catch { /* JSON-LD invalide */ }
  }
  return null;
}
const pickImg = (v) => { if (!v) return ''; if (typeof v === 'string') return v; if (Array.isArray(v)) return pickImg(v[0]); if (typeof v === 'object') return v.url || v.contentUrl || ''; return ''; };
function chan(u) {
  const h = (u.hostname || '').toLowerCase();
  if (/tiktok\./.test(h)) return 'TikTok';
  if (/instagram\.com|instagr\.am/.test(h)) return 'Instagram';
  if (/facebook\.com|fb\.com|fb\.watch|fb\.me/.test(h)) return 'Facebook';
  if (/wa\.me|whatsapp\.com/.test(h)) return 'WhatsApp';
  if (/avito\./.test(h)) return 'Avito';
  return 'Autre';
}
async function productMeta(link) {
  const res = { title: '', desc: '', image: '', price: 0, currency: '', link, channel: 'Autre' };
  let u;
  try { u = new URL(link); } catch { return res; }
  if (!/^https?:$/.test(u.protocol)) return res;
  res.channel = chan(u);
  let html = '', finalUrl = link;
  try {
    const r = await sfetch(link);
    finalUrl = r.url;
    if (/html|xml|text/i.test(r.type) || !r.type) html = new TextDecoder('utf-8').decode(r.bytes);
    res.channel = chan(new URL(finalUrl));
  } catch (e) { console.error('page', String(e && e.message)); }
  if (html) {
    const m = metas(html), ld = ldProduct(html);
    res.title = clean(m['og:title'] || m['twitter:title'] || (ld && ld.name) || (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1], 160);
    res.desc = clean(m['og:description'] || m['description'] || m['twitter:description'] || (ld && ld.description), 600);
    let img = m['og:image:secure_url'] || m['og:image'] || m['twitter:image'] || m['twitter:image:src'] || pickImg(ld && ld.image);
    if (img) { try { img = new URL(img, finalUrl).toString(); } catch { img = ''; } }
    res.image = img || '';
    const offer = ld && (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers);
    const pr = m['product:price:amount'] || m['og:price:amount'] || (offer && (offer.price || offer.lowPrice));
    res.price = pr ? parseFloat(String(pr).replace(',', '.')) || 0 : 0;
    res.currency = m['product:price:currency'] || m['og:price:currency'] || (offer && offer.priceCurrency) || '';
  }
  if (res.channel === 'TikTok') {
    try {
      const o = await sfetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(finalUrl.split('?')[0]), { max: 100000 });
      const j = JSON.parse(new TextDecoder().decode(o.bytes));
      if (j.title && !res.desc) res.desc = clean(j.title, 600);
      if (j.title && !res.title) res.title = clean(j.title, 160);
      if (j.thumbnail_url && !res.image) res.image = j.thumbnail_url;
      if (j.author_name && !res.title) res.title = clean('TikTok · ' + j.author_name, 160);
    } catch (e) { console.error('oembed', String(e && e.message)); }
  }
  return res;
}
// Copie la photo dans le stockage de l'appli (adresse stable, pas de blocage « hotlink »). Sinon garde l'adresse d'origine.
async function storeImage(tid, imgUrl, bearer) {
  if (!imgUrl || !/^https:\/\//i.test(imgUrl)) return '';
  try {
    const r = await sfetch(imgUrl, { max: 2000000, headers: bearer ? { Authorization: 'Bearer ' + bearer } : {} });
    const type = (r.type || '').split(';')[0].trim().toLowerCase();
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[type];
    if (r.status !== 200 || !ext || r.bytes.length < 200 || r.bytes.length >= 2000000) return /^https:\/\//i.test(imgUrl) && !bearer ? imgUrl : '';
    const path = tid + '/' + (await sha(imgUrl)) + '.' + ext;
    const w = await fetch(SB + '/storage/v1/object/product-images/' + path, { method: 'POST', headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': type, 'x-upsert': 'true' }, body: r.bytes });
    if (!w.ok) { console.error('storage', w.status, await w.text()); return bearer ? '' : imgUrl; }
    return SB + '/storage/v1/object/public/product-images/' + path;
  } catch (e) { console.error('image', String(e && e.message)); return bearer ? '' : imgUrl; }
}

/* ---------- lecture d'un message de commande ---------- */
const URL_RE = /https?:\/\/[^\s<>"')]+/i;
const LABELS = {
  name: 'nom(?:\\s+complet)?|name|client|pr[ée]nom|الاسم',
  phone: 't[ée]l[ée]?phone|tel|gsm|whatsapp|mobile|phone|الهاتف',
  address: 'adresse|address|adress|العنوان',
  city: 'ville|city|المدينة',
  product: 'produit|article|product|المنتج',
  amount: 'prix|montant|total|price|السعر|الثمن',
};
function fromText(t) {
  t = String(t || '');
  const o = { name: '', phone: '', address: '', city: '', product: '', amount: 0, link: '' };
  const lk = URL_RE.exec(t); if (lk) o.link = lk[0].replace(/[.,;!?]+$/, '');
  const all = Object.keys(LABELS).map((k) => '(?<' + k + '>' + LABELS[k] + ')').join('|');
  const re = new RegExp('(?:^|[\\s,;|•*-])(?:' + all + ')\\s*[:：=]', 'gim');
  const hits = []; let m;
  while ((m = re.exec(t))) {
    const key = Object.keys(m.groups).find((k) => m.groups[k] !== undefined);
    hits.push({ key, start: m.index, end: re.lastIndex });
  }
  const got = {};
  hits.forEach((h, i) => {
    let v = t.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : t.length);
    v = v.split(/\r?\n/)[0].replace(/[\s,;|]+$/, '').trim();
    if (v && !got[h.key]) got[h.key] = v;
  });
  o.name = got.name || ''; o.phone = got.phone || ''; o.address = got.address || ''; o.city = got.city || ''; o.product = got.product || '';
  const am = got.amount || '';
  const pm = /(?:\+?212|0)[\s.-]?[5-7](?:[\s.-]?\d){8}/.exec(t);
  if (!mph(o.phone) && pm) o.phone = pm[0];
  const dm = /(\d[\d\s.,]*)\s*(?:dh|dhs|mad|درهم)(?![a-z])/i.exec(am || t);
  if (dm) o.amount = parseFloat(dm[1].replace(/\s/g, '').replace(',', '.')) || 0;
  else if (am) o.amount = parseFloat(am.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
  return o;
}
const ORDER_WORDS = /commande|commander|je veux|je prends|acheter|achat|order|buy|بغيت|بغيتو|طلب|نشري|ثمن|prix|livraison|disponible/i;

/* ---------- création de la commande ---------- */
async function saveOrder(tid, dv, o, seed) {
  const ph = mph(o.phone);
  const id = 'i' + (await sha(tid + '|' + seed));
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Casablanca' });
  const ord = {
    id, date, ts: Date.now(), vendor: String(o.vendor || dv || 'Boutique').slice(0, 60),
    name: String(o.name || 'Client sans nom').slice(0, 80), phone: ph || String(o.phone || '').slice(0, 30),
    product: String(o.product || '').slice(0, 120), address: String(o.address || '').slice(0, 160),
    city: String(o.city || '').slice(0, 40), channel: String(o.channel || 'Autre').slice(0, 30),
    amount: +o.amount || 0, upsell: 0, status: 'En attente', attempts: 0, delivery: '', courier: '',
    note: ph ? '' : 'Numéro à vérifier', reason: '', cb: 0, xid: 'ingest:' + id,
  };
  if (o.pimg) ord.pimg = String(o.pimg).slice(0, 500);
  if (o.pdesc) ord.pdesc = String(o.pdesc).slice(0, 600);
  if (o.plink) ord.plink = String(o.plink).slice(0, 500);
  const row = { tenant_id: tid, id, phone: ord.phone || null, vendor_name: ord.vendor, status: ord.status, delivery: null, order_date: date, tid: null, data: ord, deleted_at: null, updated_at: new Date().toISOString() };
  const w = await fetch(SB + '/rest/v1/orders?on_conflict=tenant_id,id', { method: 'POST', headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify([row]) });
  if (!w.ok) { console.error('insert orders', w.status, await w.text()); throw new Error('enregistrement'); }
  return ord;
}
// Complète une commande avec les infos produit d'un lien (titre, descriptif, photo, prix).
async function withProduct(tid, o) {
  if (!o.link) return o;
  const m = await productMeta(o.link);
  o.plink = o.link;
  if (!o.product && m.title) o.product = m.title;
  if (m.desc) o.pdesc = m.desc;
  if (!o.amount && m.price && /^(MAD|DH|DHS)?$/i.test(m.currency || '')) o.amount = m.price;
  if (!o.channel || o.channel === 'Autre') o.channel = m.channel;
  if (m.image) o.pimg = await storeImage(tid, m.image);
  return o;
}

/* ---------- Meta : extraction des messages ---------- */
function metaMessages(b) {
  const L = [];
  if (b.object === 'whatsapp_business_account') {
    for (const en of b.entry || []) for (const ch of en.changes || []) {
      const v = ch.value || {}, cs = v.contacts || [];
      for (const m of v.messages || []) {
        const c = cs.find((x) => x.wa_id === m.from);
        const text = m.type === 'text' ? (m.text && m.text.body) : m.type === 'image' ? (m.image && m.image.caption) : m.type === 'button' ? (m.button && m.button.text) : '';
        L.push({ chan: 'WhatsApp', id: m.id, from: m.from, fromPhone: m.from, name: (c && c.profile && c.profile.name) || '', text: text || '', mediaId: m.type === 'image' && m.image ? m.image.id : '' });
      }
    }
  } else if (b.object === 'instagram' || b.object === 'page') {
    const chn = b.object === 'instagram' ? 'Instagram' : 'Facebook';
    for (const en of b.entry || []) for (const ev of en.messaging || []) {
      const m = ev.message; if (!m || m.is_echo) continue;
      const at = (m.attachments || []);
      const img = at.find((x) => x.type === 'image' && x.payload && x.payload.url);
      const shr = at.find((x) => (x.type === 'share' || x.type === 'ig_post' || x.type === 'fallback' || x.type === 'story_mention') && x.payload && x.payload.url);
      L.push({ chan: chn, id: m.mid, from: ev.sender && ev.sender.id, fromPhone: '', name: '', text: (m.text || '') + (shr ? '\n' + shr.payload.url : ''), imageUrl: img ? img.payload.url : '' });
    }
  }
  return L;
}
async function hmacOk(raw, sig) {
  if (!APP_SECRET) return true;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(raw));
  const hex = 'sha256=' + [...new Uint8Array(s)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const got = String(sig || '');
  if (got.length !== hex.length) return false;
  let d = 0; for (let i = 0; i < hex.length; i++) d |= hex.charCodeAt(i) ^ got.charCodeAt(i); // comparaison à temps constant
  return d === 0;
}
async function waMedia(id) {
  if (!WA_TOKEN || !id) return null;
  try {
    const r = await fetch('https://graph.facebook.com/v21.0/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + WA_TOKEN }, signal: AbortSignal.timeout(8000) });
    const j = await r.json(); return j && j.url ? j.url : null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const ix = parts.indexOf('ingest');
  const key = (ix >= 0 ? parts[ix + 1] : parts[parts.length - 1]) || '';
  const action = ix >= 0 ? parts[ix + 2] || '' : '';

  // Vérification Meta (abonnement du webhook)
  if (req.method === 'GET') {
    if (url.searchParams.get('hub.mode') === 'subscribe' && /^[A-Za-z0-9]{16,64}$/.test(key) && url.searchParams.get('hub.verify_token') === key) {
      const kr = await fetch(SB + '/rest/v1/webhook_keys?select=tenant_id&key=eq.' + key + '&limit=1', { headers: H });
      const kj = kr.ok ? await kr.json() : null;
      if (kj && kj.length) return txt(url.searchParams.get('hub.challenge') || '', 200);
      return txt('clé inconnue', 403);
    }
    return txt('All In One ingest : OK', 200);
  }
  if (req.method !== 'POST') return txt('méthode refusée', 405);

  if (!/^[A-Za-z0-9]{16,64}$/.test(key)) return txt('clé invalide', 401);
  const kr = await fetch(SB + '/rest/v1/webhook_keys?select=tenant_id,default_vendor&key=eq.' + key + '&limit=1', { headers: H });
  const kj = kr.ok ? await kr.json() : null;
  if (!kj || !kj.length) return txt('clé inconnue', 401);
  const tid = kj[0].tenant_id, dv = kj[0].default_vendor || '';
  const tr = await fetch(SB + '/rest/v1/tenants?select=status&id=eq.' + tid + '&limit=1', { headers: H });
  const tj = tr.ok ? await tr.json() : null;
  if (!tj || !tj.length || tj[0].status !== 'active') return txt('entreprise suspendue', 403);

  const raw = await req.text();
  if (!raw || raw.length > 200000) return txt('contenu invalide', 413);

  // Aperçu d'un lien (utilisé par le formulaire « Ajouter » et le partage vers l'appli)
  if (action === 'preview') {
    let b; try { b = JSON.parse(raw); } catch { return jout({ error: 'json' }, 400); }
    const link = String((b && b.url) || '').trim();
    if (!/^https?:\/\//i.test(link)) return jout({ error: 'lien invalide' }, 400);
    const m = await productMeta(link);
    if (m.image) m.image = await storeImage(tid, m.image);
    return jout(m);
  }

  let body; try { body = JSON.parse(raw); } catch { body = Object.fromEntries(new URLSearchParams(raw)); }
  if (!body || typeof body !== 'object') return txt('vide', 400);

  // Messages Meta (WhatsApp / Instagram / Facebook)
  if (body.object) {
    if (!(await hmacOk(raw, req.headers.get('x-hub-signature-256')))) return txt('signature invalide', 401);
    let n = 0;
    for (const m of metaMessages(body)) {
      try {
        const p = fromText(m.text);
        const isOrder = !!p.link || !!mph(p.phone) || (!!m.fromPhone && (ORDER_WORDS.test(m.text) || (p.name && p.address)));
        if (!isOrder) continue; // simple discussion : pas une commande
        const o = { ...p, phone: mph(p.phone) ? p.phone : m.fromPhone, name: p.name || m.name || ('Client ' + m.chan), channel: m.chan, vendor: dv };
        await withProduct(tid, o);
        if (!o.pimg && m.imageUrl) o.pimg = await storeImage(tid, m.imageUrl);
        if (!o.pimg && m.mediaId) { const mu = await waMedia(m.mediaId); if (mu) o.pimg = await storeImage(tid, mu, WA_TOKEN); }
        if (!o.product && m.text) o.product = clean(m.text.replace(URL_RE, ''), 120);
        await saveOrder(tid, dv, o, m.id || raw);
        n++;
      } catch (e) { console.error('message', String(e && e.message)); }
    }
    return txt('ok ' + n, 200);
  }

  // Appel générique (Make, Zapier, n8n, formulaire…)
  const g = (...ks) => { for (const k of ks) if (body[k] !== undefined && body[k] !== null && String(body[k]).trim() !== '') return String(body[k]).trim(); return ''; };
  const t = g('text', 'message', 'body', 'texte');
  const p = fromText(t);
  const o = {
    name: g('name', 'nom', 'customer', 'client') || p.name, phone: g('phone', 'telephone', 'tel', 'whatsapp') || p.phone,
    address: g('address', 'adresse') || p.address, city: g('city', 'ville') || p.city,
    product: g('product', 'produit', 'title') || p.product, amount: parseFloat(g('amount', 'montant', 'price', 'prix', 'total').replace(',', '.')) || p.amount,
    link: g('link', 'url', 'lien') || p.link, vendor: g('vendor', 'vendeur', 'boutique') || dv, channel: g('source', 'channel', 'canal', 'platform'),
  };
  if (!o.name && !o.phone && !o.product && !o.link) return txt('ignoré : aucune commande reconnue', 200);
  const im = g('image', 'image_url', 'photo');
  await withProduct(tid, o);
  if (!o.pimg && /^https:\/\//i.test(im)) o.pimg = await storeImage(tid, im);
  if (!o.channel) o.channel = 'Autre';
  try { await saveOrder(tid, dv, o, g('id', 'order_id', 'xid') || raw); } catch { return txt('erreur enregistrement', 502); }
  return txt('ok', 200);
});

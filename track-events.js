/* All In One - événements livreur côté navigateur (Récupéré / Livré / Refusé).
   Module sans dépendance, testé sous Node (test/track-events.test.js).

   1) createOutbox : file d'attente persistante côté livreur. Un événement n'est jamais perdu :
      il reste enregistré sur le téléphone jusqu'à ce que le serveur l'ait accepté, avec des
      nouvelles tentatives automatiques (réseau coupé, commande pas encore publiée, panne du serveur).
      Les refus définitifs (jeton invalide, transition impossible) sont conservés et affichés,
      jamais effacés en silence.
   2) drain : côté propriétaire, applique les événements en attente dans la base cloud « order_events »
      (ancien circuit, vidé et non alimenté par les nouveaux liens). Un événement dont la commande
      n'est pas encore présente reste en attente ; une erreur est toujours remontée. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AioEvents = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KINDS = { pickup: 1, delivered: 1, refused: 1 };
  var LABEL = { pickup: 'Récupéré', delivered: 'Livré', refused: 'Refusé' };
  var BACKOFF = [2000, 5000, 15000, 30000, 60000, 120000, 300000];
  var MAX_AGE = 24 * 3600 * 1000;
  var MAX_ITEMS = 60;

  /* Classe une erreur : nouvelle tentative automatique ou refus définitif, avec un message lisible. */
  function classify(err) {
    var st = err && err.status, m = err && err.message ? String(err.message) : '';
    if (err && err.fatal) return { retry: false, message: m || 'Lien de suivi invalide.' };
    if (!st) return { retry: true, message: 'Pas de connexion : nouvel essai automatique.' };
    if (st === 404) return { retry: true, message: 'Commande pas encore publiée : nouvel essai automatique.' };
    if (st === 408 || st === 425 || st >= 500) return { retry: true, message: 'Service indisponible (' + st + ') : nouvel essai automatique.' };
    if (st === 401) return { retry: false, message: 'Code de livraison incorrect.' };
    if (st === 403) return { retry: false, message: 'Lien livreur invalide ou révoqué : demande un nouveau lien au vendeur.' };
    if (st === 429) return { retry: false, message: 'Trop d’essais de code : mission bloquée 30 min. Contacte le vendeur.' };
    if (st === 409) return { retry: false, message: 'Action impossible dans l’état actuel de la commande.' };
    return { retry: false, message: m || ('Erreur ' + st) };
  }

  function eventId(kind, tid) { return kind + '-' + tid; }

  function createOutbox(o) {
    var store = o.storage, key = o.key || 'aio_evq', now = o.now || Date.now, send = o.send;
    var setTimer = o.setTimer || function (f, ms) { return setTimeout(f, ms); };
    var clearTimer = o.clearTimer || function (t) { clearTimeout(t); };
    var onChange = o.onChange || function () {};
    var timer = null, flushing = false, persistError = '';
    var items = load();

    function load() {
      var v;
      try { v = JSON.parse(store.getItem(key) || '[]'); } catch (e) { v = []; }
      if (!Array.isArray(v)) v = [];
      // un envoi interrompu par la fermeture de la page est rejoué : le serveur dédoublonne (eventId)
      v.forEach(function (it) { if (it.status === 'sending') it.status = 'pending'; });
      return v;
    }
    function save() {
      try { store.setItem(key, JSON.stringify(items)); persistError = ''; }
      catch (e) { persistError = 'Mémoire du téléphone pleine : l’événement risque de ne pas être conservé.'; }
    }
    function find(k) { return items.filter(function (i) { return i.key === k; })[0]; }
    function notify() { try { onChange(summary()); } catch (e) {} }
    function trim() {
      while (items.length > MAX_ITEMS) {
        var idx = -1, i;
        for (i = 0; i < items.length; i++) if (items[i].status === 'done') { idx = i; break; }
        if (idx < 0) break;
        items.splice(idx, 1);
      }
    }

    function enqueue(ev) {
      if (!ev || !KINDS[ev.kind] || !ev.tid || !ev.api || !ev.courierKey) throw new Error('Événement livreur invalide.');
      var k = ev.tid + ':' + ev.kind, it = find(k);
      // même commande + même type : on ne crée pas un second envoi (double appui, rechargement de page)
      if (it && it.status !== 'failed') return it;
      var item = { key: k, tid: ev.tid, kind: ev.kind, api: ev.api, courierKey: ev.courierKey, eventId: eventId(ev.kind, ev.tid),
        created: now(), attempts: 0, next: 0, status: 'pending', error: '' };
      if (ev.code) item.code = String(ev.code);
      if (ev.reason) item.reason = String(ev.reason).slice(0, 40);
      if (it) items.splice(items.indexOf(it), 1);
      items.push(item);
      trim(); save(); notify();
      return item;
    }

    async function flush() {
      if (flushing) return;
      flushing = true;
      try {
        var due = items.filter(function (i) { return i.status === 'pending' && i.next <= now(); });
        for (var j = 0; j < due.length; j++) {
          var it = due[j];
          it.status = 'sending'; it.attempts++; save(); notify();
          try {
            var res = await send(it);
            it.status = 'done'; it.error = ''; it.doneAt = now(); it.result = res && res.duplicate ? 'duplicate' : 'applied';
            delete it.code;
          } catch (e) {
            var c = classify(e);
            it.error = c.message;
            if (c.retry && now() - it.created < MAX_AGE) {
              it.status = 'pending';
              it.next = now() + BACKOFF[Math.min(it.attempts - 1, BACKOFF.length - 1)];
            } else {
              it.status = 'failed';
              if (c.retry) it.error = 'Abandon après 24 h sans réponse du serveur. ' + c.message;
              delete it.code;
            }
          }
          save(); notify();
        }
      } finally { flushing = false; schedule(); }
    }

    function schedule() {
      if (timer) { clearTimer(timer); timer = null; }
      var pend = items.filter(function (i) { return i.status === 'pending'; });
      if (!pend.length) return;
      var t = Math.min.apply(null, pend.map(function (i) { return i.next; }));
      timer = setTimer(function () { timer = null; flush(); }, Math.max(500, t - now()));
    }

    function retryNow() {
      items.forEach(function (i) { if (i.status === 'pending') i.next = 0; });
      save();
      return flush();
    }
    function dismiss(k) {
      var it = find(k);
      if (it && it.status === 'failed') { items.splice(items.indexOf(it), 1); save(); notify(); }
    }
    function summary() {
      var pend = items.filter(function (i) { return i.status === 'pending' || i.status === 'sending'; });
      var failed = items.filter(function (i) { return i.status === 'failed'; });
      var last = pend.length ? pend[pend.length - 1] : null;
      return { pending: pend.length, failed: failed.length, items: items.slice(), error: persistError || (failed[0] && failed[0].error) || (last && last.error) || '' };
    }
    function start(env) {
      env = env || {};
      if (env.addEventListener) {
        env.addEventListener('online', retryNow);
        if (env.document && env.document.addEventListener) env.document.addEventListener('visibilitychange', function () { if (!env.document.hidden) retryNow(); });
      }
      return retryNow();
    }

    return { enqueue: enqueue, flush: flush, retryNow: retryNow, dismiss: dismiss, summary: summary, list: function () { return items.slice(); }, start: start };
  }

  /* Texte affiché au livreur à partir de l'état de la file. */
  function describe(s) {
    if (!s || (!s.pending && !s.failed && !(s.items || []).length)) return { text: '', error: false };
    var failed = (s.items || []).filter(function (i) { return i.status === 'failed'; })[0];
    if (failed) return { text: '⚠ ' + LABEL[failed.kind] + ' non envoyé : ' + failed.error, error: true };
    if (s.pending) return { text: '⏳ ' + s.pending + ' événement' + (s.pending > 1 ? 's' : '') + ' en attente d’envoi' + (s.error ? ' — ' + s.error : ' — envoi en cours…'), error: false };
    var done = (s.items || []).filter(function (i) { return i.status === 'done'; });
    var d = done[done.length - 1];
    return d ? { text: '✓ ' + LABEL[d.kind] + ' envoyé au vendeur', error: false } : { text: '', error: false };
  }

  /* Propriétaire : applique les événements en attente sans jamais en perdre ni masquer d'erreur.
     fetchPending() -> lignes { id, order_id, kind } dans l'ordre de création (une erreur est propagée)
     apply(ligne)   -> 'done' (appliqué), 'dup' (déjà appliqué) ou 'miss' (commande pas encore là : on garde)
     ack(ligne)     -> marque la ligne comme appliquée (une erreur est comptée, pas ignorée) */
  async function drain(o) {
    var rows = await o.fetchPending();
    rows = rows || [];
    var res = { applied: 0, acked: 0, pending: 0, errors: [], truncated: rows.length >= (o.limit || 500) };
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], z;
      try { z = o.apply(row); }
      catch (e) { res.errors.push({ id: row.id, stage: 'apply', message: (e && e.message) || String(e) }); res.pending++; continue; }
      if (z === 'miss') { res.pending++; continue; }
      if (z !== 'done' && z !== 'dup') { res.errors.push({ id: row.id, stage: 'apply', message: 'Résultat inattendu : ' + z }); res.pending++; continue; }
      if (z === 'done') res.applied++;
      try { await o.ack(row); res.acked++; }
      catch (e2) { res.errors.push({ id: row.id, stage: 'ack', message: (e2 && e2.message) || String(e2) }); res.pending++; }
    }
    return res;
  }

  return { classify: classify, createOutbox: createOutbox, describe: describe, drain: drain, eventId: eventId, KINDS: KINDS, LABEL: LABEL };
});

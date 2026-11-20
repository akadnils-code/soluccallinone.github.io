'use strict';

/*
 * Base Realtime Database en mémoire, pour les tests uniquement.
 * Reproduit le comportement du SDK qui compte ici : dans une transaction, le premier appel
 * reçoit le cache local (null si froid) ; renvoyer undefined annule ; si la valeur du serveur
 * diffère de celle vue, la fonction est relancée avec la valeur du serveur.
 */

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function same(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

function createFakeDb(options) {
  const coldCache = !options || options.coldCache !== false;
  const root = {};
  const log = [];

  const parts = (path) => path.split('/').filter(Boolean);

  function read(path) {
    let node = root;
    for (const key of parts(path)) {
      if (node === null || typeof node !== 'object' || !(key in node)) return null;
      node = node[key];
    }
    return clone(node);
  }

  function write(path, value) {
    const keys = parts(path);
    if (!keys.length) throw new Error('cannot write root');
    let node = root;
    for (let i = 0; i < keys.length - 1; i += 1) {
      if (node[keys[i]] === null || typeof node[keys[i]] !== 'object') node[keys[i]] = {};
      node = node[keys[i]];
    }
    const last = keys[keys.length - 1];
    if (value === null || value === undefined) delete node[last];
    else node[last] = clone(value);
    log.push({ path, value: clone(value) });
  }

  const snapshot = (value) => ({
    exists: () => value !== null && value !== undefined,
    val: () => clone(value === undefined ? null : value)
  });

  function ref(path) {
    return {
      async get() {
        await Promise.resolve();
        return snapshot(read(path));
      },
      async set(value) {
        await Promise.resolve();
        write(path, value);
      },
      async update(values) {
        await Promise.resolve();
        const current = read(path) || {};
        write(path, Object.assign({}, current, values));
      },
      limitToFirst() {
        return { get: () => ref(path).get() };
      },
      async transaction(update) {
        await Promise.resolve();
        let seen = coldCache ? null : read(path);
        for (let attempt = 0; attempt < 25; attempt += 1) {
          const out = update(clone(seen));
          if (out === undefined) return { committed: false, snapshot: snapshot(read(path)) };
          const actual = read(path);
          if (same(actual, seen)) {
            write(path, out);
            return { committed: true, snapshot: snapshot(out) };
          }
          seen = actual;
        }
        throw new Error('maxretry');
      }
    };
  }

  return { ref, read, write, log };
}

module.exports = { createFakeDb };

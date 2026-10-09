// אחסון מקומי בטאבלט (IndexedDB): סקרים, תמונות והגדרות
(function (root) {
  'use strict';
  const DB_NAME = 'tree-survey', VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('surveys')) db.createObjectStore('surveys', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then(r => { result = r; });
      t.oncomplete = () => resolve(result && result.result !== undefined && result instanceof IDBRequest ? result.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('abort'));
    }));
  }
  const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const DB = {
    async allSurveys() {
      const db = await open();
      return req2p(db.transaction('surveys').objectStore('surveys').getAll());
    },
    async getSurvey(id) {
      const db = await open();
      return req2p(db.transaction('surveys').objectStore('surveys').get(id));
    },
    putSurvey(s) { s.updated = Date.now(); return tx('surveys', 'readwrite', st => { st.put(s); }); },
    deleteSurvey(id) { return tx('surveys', 'readwrite', st => { st.delete(id); }); },
    putPhoto(p) { return tx('photos', 'readwrite', st => { st.put(p); }); },
    async getPhoto(id) {
      const db = await open();
      return req2p(db.transaction('photos').objectStore('photos').get(id));
    },
    deletePhoto(id) { return tx('photos', 'readwrite', st => { st.delete(id); }); },
    async getKV(k, def) {
      const db = await open();
      const v = await req2p(db.transaction('kv').objectStore('kv').get(k));
      return v === undefined ? def : v;
    },
    setKV(k, v) { return tx('kv', 'readwrite', st => { st.put(v, k); }); },
    delKV(k) { return tx('kv', 'readwrite', st => { st.delete(k); }); },
  };
  root.DB = DB;
})(self);

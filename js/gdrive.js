// חיבור לגוגל דרייב (Drive API v3, התחברות OAuth עם PKCE, בלי שרת).
// אותו ממשק כמו החיבור הקודם ל-OneDrive (OD), כך ששאר האפליקציה לא משתנה: תיקיות וקבצים לפי מזהה
(function (root) {
  'use strict';
  const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
  const TOKEN = 'https://oauth2.googleapis.com/token';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  // גישה לכל הדרייב: גם לכתוב גיבוי ודוחות, וגם לחפש ולפתוח סקרים ישנים בארכיון
  const SCOPE = 'https://www.googleapis.com/auth/drive';
  const FOLDER = 'application/vnd.google-apps.folder';
  const FIELDS = 'id,name,mimeType,size,modifiedTime,parents';

  const redirectUri = () => location.origin + location.pathname;
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const rand = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
  const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  // פריט בצורה שהאפליקציה מכירה: folder / file, גודל ותאריך
  const shape = f => f && Object.assign({ id: f.id, name: f.name, size: +f.size || 0, lastModifiedDateTime: f.modifiedTime, parents: f.parents },
    f.mimeType === FOLDER ? { folder: {} } : { file: { mimeType: f.mimeType } });

  // מזהה הלקוח "Tree Survey Web" בגוגל (ציבורי), מובנה כדי שכל מכשיר יתחבר בלי להקליד אותו.
  // הסוד (Client secret) לא נשמר בקוד, כי המאגר ציבורי: מקלידים אותו פעם אחת בכל מכשיר
  const DEFAULT_ID = '59129286840-gdjk14sc5kja0ls0s76lmr472hlbhi9v.apps.googleusercontent.com';

  class AuthError extends Error {}

  const OD = {
    AuthError,
    provider: 'gdrive',
    name: 'גוגל דרייב',

    defaultClientId: DEFAULT_ID,
    async clientId() { return (await DB.getKV('gdClientId', '')).trim() || DEFAULT_ID; },
    async clientSecret() { return (await DB.getKV('gdClientSecret', '')).trim(); },

    async beginLogin() {
      const clientId = await OD.clientId();
      if (!clientId) throw new Error('חסר מזהה הלקוח (Client ID) מגוגל');
      if (!(await OD.clientSecret())) throw new Error('חסר הסוד (Client secret) מגוגל');
      const verifier = rand(48);
      const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      const state = rand(16);
      localStorage.setItem('gd_pkce', JSON.stringify({ verifier, state, back: location.hash }));
      const p = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri(), scope: SCOPE,
        code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true' });
      location.href = AUTH + '?' + p;
    },

    // נקרא בעליית האפליקציה: אם חזרנו מההתחברות, מחליף את הקוד בטוקן
    async handleRedirect() {
      const p = new URLSearchParams(location.search);
      if (!p.has('code') && !p.has('error')) return null;
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem('gd_pkce') || '{}'); } catch (_) {}
      localStorage.removeItem('gd_pkce');
      history.replaceState(null, '', location.pathname + (saved.back || '#/settings'));
      if (p.has('error')) return { ok: false, message: p.get('error_description') || p.get('error') };
      if (p.get('state') !== saved.state) return { ok: false, message: 'ההתחברות לא הושלמה, נסה שוב' };
      try {
        await OD._token({ grant_type: 'authorization_code', code: p.get('code'), code_verifier: saved.verifier, redirect_uri: redirectUri() });
        const me = await OD.api('GET', '/about?fields=user(emailAddress,displayName)');
        await DB.setKV('odUser', (me && me.user && (me.user.emailAddress || me.user.displayName)) || '');
        return { ok: true };
      } catch (e) { return { ok: false, message: e.message }; }
    },

    async _token(params) {
      const body = new URLSearchParams(Object.assign({ client_id: await OD.clientId(), client_secret: await OD.clientSecret() }, params));
      const res = await fetch(TOKEN, { method: 'POST', body });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new AuthError(j.error_description || j.error || 'ההתחברות נכשלה');
      const old = (await DB.getKV('odAuth', null)) || {};
      // ברענון גוגל לא שולח refresh_token חדש: שומרים את הקודם
      await DB.setKV('odAuth', { access: j.access_token, refresh: j.refresh_token || old.refresh, exp: Date.now() + ((j.expires_in || 3600) - 120) * 1000 });
      return j.access_token;
    },

    async connected() { const a = await DB.getKV('odAuth', null); return !!(a && (a.refresh || a.access)); },

    async logout() { await DB.setKV('odAuth', null); await DB.setKV('odUser', ''); await DB.setKV('gdIds', null); OD._ids = null; OD._verified.clear(); },

    async accessToken() {
      const a = await DB.getKV('odAuth', null);
      if (!a) throw new AuthError('לא מחובר לגוגל דרייב');
      if (Date.now() < a.exp) return a.access;
      if (!a.refresh) throw new AuthError('צריך להתחבר מחדש לגוגל דרייב');
      // כמה בקשות במקביל: רענון אחד בלבד
      if (OD._refreshing) return OD._refreshing;
      OD._refreshing = (async () => {
        try { return await OD._token({ grant_type: 'refresh_token', refresh_token: a.refresh }); }
        catch (e) {
          if (e instanceof AuthError) { await DB.setKV('odAuth', Object.assign(a, { refresh: null, exp: 0 })); throw new AuthError('צריך להתחבר מחדש לגוגל דרייב'); }
          throw e;
        }
      })().finally(() => { OD._refreshing = null; });
      return OD._refreshing;
    },

    // בקשה ל-Drive API. 404 מחזיר null. raw=true מחזיר את התשובה עצמה (להורדת קבצים)
    async api(method, path, body, headers, raw) {
      for (let attempt = 0; ; attempt++) {
        const tok = await OD.accessToken();
        const h = Object.assign({ Authorization: 'Bearer ' + tok }, headers || {});
        let payload = body;
        if (body && !(body instanceof Blob) && typeof body === 'object') { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
        const res = await fetch(path.startsWith('http') ? path : API + path, { method, headers: h, body: payload });
        if (res.status === 401 && attempt === 0) { const a = await DB.getKV('odAuth', {}); await DB.setKV('odAuth', Object.assign(a, { exp: 0 })); continue; }
        if (res.status === 401) throw new AuthError('צריך להתחבר מחדש לגוגל דרייב');
        if (res.status === 404) return null;
        if (res.status === 429 || res.status >= 500 || (res.status === 403 && /rate|quota/i.test(await res.clone().text()))) {
          if (attempt < 3) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
          throw new Error('גוגל דרייב עמוס, ננסה שוב בעוד רגע');
        }
        if (raw) { if (!res.ok) throw new Error('גוגל דרייב ' + res.status); return res; }
        const text = await res.text();
        const j = text ? JSON.parse(text) : {};
        if (!res.ok) throw new Error((j.error && j.error.message) || ('גוגל דרייב ' + res.status));
        return j;
      }
    },

    // maxPages: לעצור אחרי כמה עמודים (בחיפוש לא צריך את כל התוצאות)
    async _list(query, extra, maxPages) {
      const out = []; let pages = 0;
      let token = '';
      do {
        const p = new URLSearchParams(Object.assign({ q: query, fields: `nextPageToken,files(${FIELDS})`, pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }, extra || {}));
        if (token) p.set('pageToken', token);
        const j = await OD.api('GET', '/files?' + p);
        if (!j) break;
        out.push(...(j.files || []));
        token = j.nextPageToken || '';
      } while (token && (!maxPages || ++pages < maxPages));
      return out;
    },
    async _find(parentId, name, folder) {
      const f = await OD._list(`${q(parentId || 'root')} in parents and name = ${q(OD.clean(name))} and trashed = false and mimeType ${folder ? '=' : '!='} '${FOLDER}'`);
      return f[0] || null;
    },

    // כל מה שבתוך תיקייה (null = הדרייב שלי)
    async children(itemId) {
      return (await OD._list(`${q(itemId || 'root')} in parents and trashed = false`, { orderBy: 'folder,name' })).map(shape);
    },

    clean: name => String(name).replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim() || 'ללא שם',

    // ---------- זיכרון מזהים (כדי לא לחפש כל פעם מחדש את אותן תיקיות וקבצים) ----------
    // תיקייה: נשמרת בטאבלט. בכל הפעלה של האפליקציה בודקים פעם אחת שהיא עדיין קיימת (ולא בפח)
    _ids: null,
    _verified: new Set(),
    _created: new Set(),
    async _idMap() {
      if (!OD._ids) OD._ids = new Map(Object.entries((await DB.getKV('gdIds', null)) || {}));
      return OD._ids;
    },
    _saveIds: (() => { let t = null; return () => { clearTimeout(t); t = setTimeout(() => DB.setKV('gdIds', Object.fromEntries(OD._ids || [])).catch(() => {}), 500); }; })(),
    _key: (parentId, name, folder) => `${folder ? 'd' : 'f'}|${parentId || 'root'}|${OD.clean(name)}`,
    async _cached(key) {
      const m = await OD._idMap();
      const id = m.get(key);
      if (!id) return null;
      if (OD._verified.has(id)) return id;
      const j = await OD.api('GET', `/files/${id}?fields=id,trashed&supportsAllDrives=true`).catch(() => null);
      if (j && !j.trashed) { OD._verified.add(id); return id; }
      m.delete(key); OD._saveIds();
      return null;
    },
    async _remember(key, id) { (await OD._idMap()).set(key, id); OD._verified.add(id); OD._saveIds(); },
    async _forget(key) { const m = await OD._idMap(); if (m.delete(key)) OD._saveIds(); },

    // תיקייה בתוך תיקייה (או בשורש), נוצרת אם אינה קיימת
    async folder(parentId, name) {
      const key = OD._key(parentId, name, true);
      const hit = await OD._cached(key);
      if (hit) return hit;
      // תיקייה שנוצרה עכשיו ריקה: אין מה לחפש בתוכה
      const found = OD._created.has(parentId) ? null : await OD._find(parentId, name, true);
      let id = found && found.id;
      if (!id) { id = (await OD.api('POST', '/files?fields=id&supportsAllDrives=true', { name: OD.clean(name), mimeType: FOLDER, parents: [parentId || 'root'] })).id; OD._created.add(id); }
      await OD._remember(key, id);
      return id;
    },
    // שרשרת תיקיות (למשל א עצים / הצעות מחיר / 2026 / היתר בניה), נוצרות לפי הצורך.
    // התיקיות שכבר מוכרות נבדקות כולן במקביל (בקשה אחת לכל אחת, באותו זמן) ולא אחת אחרי השנייה
    async path(names) {
      const m = await OD._idMap();
      let parent = null;
      const known = [];
      for (const n of names) { const id = m.get(OD._key(parent, n, true)); if (!id) break; known.push(id); parent = id; }
      await Promise.all(known.filter(id => !OD._verified.has(id)).map(id =>
        OD.api('GET', `/files/${id}?fields=id,trashed&supportsAllDrives=true`).then(j => { if (j && !j.trashed) OD._verified.add(id); }).catch(() => {})));
      parent = null;
      for (const n of names) parent = await OD.folder(parent, n);
      return parent;
    },

    // העלאת קובץ. replace=true מחליף קובץ קיים באותו שם. מחזיר {id, name}, או null אם התיקייה לא קיימת
    async upload(parentId, name, blob, replace) {
      name = OD.clean(name);
      const type = blob.type || 'application/octet-stream';
      const key = OD._key(parentId, name, false);
      if (replace) {
        // הקובץ כבר מוכר: מחליפים את התוכן ישר, בלי לחפש אותו (אם נמחק או בפח, ממשיכים כרגיל)
        const known = (await OD._idMap()).get(key);
        if (known) {
          const j = await OD.api('PATCH', `${UPLOAD}/files/${known}?uploadType=media&fields=id,name,trashed,version&supportsAllDrives=true`, blob, { 'Content-Type': type }).catch(() => null);
          if (j && !j.trashed) return j;
          await OD._forget(key);
        }
      }
      let existing = null;
      try { existing = replace ? await OD._find(parentId, name, false) : null; }
      catch (e) { if (/404|not found/i.test(e.message)) return null; throw e; }
      if (existing) { const j = await OD.replaceContent(existing.id, blob); await OD._remember(key, existing.id); return j; }
      let out;
      if (blob.size < 5 * 1024 * 1024) {
        // קובץ קטן: בקשה אחת (multipart) במקום שתיים
        const boundary = 'b' + Math.random().toString(36).slice(2);
        const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, JSON.stringify({ name, parents: [parentId || 'root'] }),
          `\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
        out = await OD.api('POST', `${UPLOAD}/files?uploadType=multipart&fields=id,name,version&supportsAllDrives=true`, body, { 'Content-Type': `multipart/related; boundary=${boundary}` });
        if (!out) { await OD._forgetParent(parentId); return null; } // תיקיית היעד נמחקה
      } else {
        // קובץ גדול: העלאה בהמשכים
        const tok = await OD.accessToken();
        const init = await fetch(`${UPLOAD}/files?uploadType=resumable&fields=id,name,version&supportsAllDrives=true`, {
          method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type },
          body: JSON.stringify({ name, parents: [parentId || 'root'] }) });
        if (init.status === 404) { await OD._forgetParent(parentId); return null; }
        if (!init.ok) throw new Error('העלאה לגוגל דרייב נכשלה (' + init.status + ')');
        const res = await fetch(init.headers.get('Location'), { method: 'PUT', headers: { 'Content-Type': type }, body: blob });
        if (!res.ok) throw new Error('העלאה לגוגל דרייב נכשלה (' + res.status + ')');
        out = await res.json();
      }
      if (replace && out && out.id) await OD._remember(key, out.id);
      return out;
    },
    // תיקייה שנמחקה: שוכחים אותה (ואת מה שבתוכה)
    async _forgetParent(parentId) {
      const m = await OD._idMap();
      for (const [k, v] of [...m]) if (v === parentId || k.split('|')[1] === parentId) m.delete(k);
      OD._verified.delete(parentId); OD._saveIds();
    },

    // מחליף את התוכן של קובץ קיים (תמונה אחרי ציור, נתוני סקר), בלי לשנות את שמו
    async replaceContent(itemId, blob) {
      const j = await OD.api('PATCH', `${UPLOAD}/files/${itemId}?uploadType=media&fields=id,name,version&supportsAllDrives=true`, blob, { 'Content-Type': blob.type || 'application/octet-stream' });
      if (!j) { const e = new Error('הקובץ לא נמצא בגוגל דרייב'); e.status = 404; throw e; }
      return j;
    },

    async download(itemId) {
      const res = await OD.api('GET', `/files/${itemId}?alt=media&supportsAllDrives=true`, null, null, true);
      return res ? res.blob() : null;
    },

    async readJson(parentId, name) {
      // קובץ מוכר: הורדה ישירה בלי לחפש אותו קודם
      const key = OD._key(parentId, name, false);
      const known = (await OD._idMap()).get(key);
      if (known) {
        const b = await OD.download(known).catch(() => null);
        if (b) { try { return JSON.parse(await b.text()); } catch (_) {} }
        await OD._forget(key);
      }
      const f = await OD._find(parentId, name, false);
      if (!f) return null;
      await OD._remember(key, f.id);
      const b = await OD.download(f.id);
      return b ? JSON.parse(await b.text()) : null;
    },

    // קובץ לפי שם בתיקייה: {id, name} או null
    async findFile(parentId, name) { return shape(await OD._find(parentId, name, false)); },

    // העתקה בתוך הדרייב (בלי הורדה לטאבלט). קובץ קיים באותו שם מוחלף
    async copy(itemId, parentId, name) {
      name = OD.clean(name);
      const old = await OD._find(parentId, name, false);
      const j = await OD.api('POST', `/files/${itemId}/copy?fields=id&supportsAllDrives=true`, { name, parents: [parentId] });
      if (!j) { const e = new Error('העתקה בגוגל דרייב נכשלה (404)'); e.status = 404; throw e; }
      if (old && old.id !== j.id) await OD.api('PATCH', `/files/${old.id}`, { trashed: true }).catch(() => {});
      return j;
    },

    rename(itemId, name) { return OD.api('PATCH', `/files/${itemId}?fields=id`, { name: OD.clean(name) }); },

    // תמונה ממוזערת (למפות), או null
    async thumb(itemId) {
      try {
        const j = await OD.api('GET', `/files/${itemId}?fields=thumbnailLink`);
        if (!j || !j.thumbnailLink) return null;
        const r = await fetch(j.thumbnailLink.replace(/=s\d+$/, '=s400'));
        return r.ok ? r.blob() : null;
      } catch (_) { return null; }
    },

    // חיפוש קובצי אקסל בכל הדרייב (שם הקובץ, וגם תוכן הקובץ כמו סמל מוסד), החדשים קודם
    // rootId: רק בתוך התיקייה הזו ובתתי התיקיות שלה (null = כל הדרייב). עמוד תוצאות אחד בלבד, כדי שיהיה מהיר
    async searchExcel(text, rootId) {
      const t = q(text.trim());
      const types = ['application/vnd.ms-excel.sheet.macroEnabled.12', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].map(m => `mimeType = '${m}'`).join(' or ');
      const [found, tree] = await Promise.all([
        OD._list(`(name contains ${t} or fullText contains ${t}) and (${types}) and trashed = false`, { pageSize: rootId ? '1000' : '150', orderBy: 'modifiedTime desc', fields: 'nextPageToken,files(id,name,parents,modifiedTime,mimeType,size)' }, 1),
        rootId ? OD.folderTree(rootId) : null]);
      // קובצי "מעקב ביקורות" (טבלת המעקב והגיבויים שלה) הם לא סקרים
      let files = found.filter(f => !/מעקב\s*ביקור/.test(f.name || ''));
      if (tree) files = files.filter(f => (f.parents || []).some(p => tree.has(p)));
      return files.slice(0, 60).map(shape);
    },
    // כל התיקיות בתוך תיקיית הארכיון: מזהה -> {שם, תיקיית אב}. נשמר בטאבלט ליום, ומתעדכן ברקע אחרי שעה
    // key: איפה לשמור בטאבלט (לכל חיפוש עץ משלו, כדי שלא ידרסו זה את זה)
    async folderTree(rootId, key) {
      const KEY = key || 'gdTree';
      OD._trees = OD._trees || {};
      const setMem = v => { OD._trees[KEY] = v; if (KEY === 'gdTree') OD._tree = v; };
      const mem = OD._trees[KEY];
      if (mem && mem.root === rootId && Date.now() - mem.at < 60 * 60 * 1000) return mem.map;
      const saved = mem && mem.root === rootId ? mem : await DB.getKV(KEY, null).then(x => x && x.root === rootId ? { root: x.root, at: x.at, map: new Map(x.list) } : null).catch(() => null);
      const load = async () => {
        const root = await OD.api('GET', `/files/${rootId}?fields=id,name,parents`);
        const map = new Map([[rootId, { name: root ? root.name : '', parent: root && root.parents ? root.parents[0] : null }]]);
        let level = [rootId];
        while (level.length) {
          const chunks = [];
          for (let i = 0; i < level.length; i += 40) chunks.push(level.slice(i, i + 40));
          // כמה תיקיות בבקשה אחת, וכמה בקשות במקביל
          const res = await Promise.all(chunks.map(c => OD._list(`(${c.map(id => `${q(id)} in parents`).join(' or ')}) and mimeType = '${FOLDER}' and trashed = false`, { fields: 'nextPageToken,files(id,name,parents)' })));
          const next = [];
          for (const f of res.flat()) if (!map.has(f.id)) { map.set(f.id, { name: f.name, parent: (f.parents || [])[0] }); next.push(f.id); }
          level = next;
        }
        setMem({ root: rootId, at: Date.now(), map });
        DB.setKV(KEY, { root: rootId, at: Date.now(), list: [...map] }).catch(() => {});
        return map;
      };
      if (saved && Date.now() - saved.at < 24 * 60 * 60 * 1000) {
        setMem(saved);
        OD._treeLoading = OD._treeLoading || {};
        if (Date.now() - saved.at > 60 * 60 * 1000 && !OD._treeLoading[KEY]) OD._treeLoading[KEY] = load().catch(() => {}).finally(() => { OD._treeLoading[KEY] = null; });
        return saved.map;
      }
      return load();
    },
    // חיפוש קבצים בתוך תיקייה ובכל התיקיות שבתוכה (שם הקובץ או התוכן), החדשים קודם. text ריק = הקבצים האחרונים
    // mimes: סוגי הקבצים. מחזיר עד 80 קבצים, כל אחד עם path (התיקיות מתחת לתיקיית החיפוש)
    async searchIn(rootId, text, mimes, treeKey) {
      const tree = await OD.folderTree(rootId, treeKey);
      const t = (text || '').trim();
      const cond = [t ? `(name contains ${q(t)} or fullText contains ${q(t)})` : null, `(${mimes.map(m => `mimeType = '${m}'`).join(' or ')})`, 'trashed = false'].filter(Boolean).join(' and ');
      const ids = [...tree.keys()], chunks = [];
      for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));
      const res = await Promise.all(chunks.map(c => OD._list(`(${c.map(id => `${q(id)} in parents`).join(' or ')}) and ${cond}`,
        { pageSize: '100', orderBy: 'modifiedTime desc', fields: 'nextPageToken,files(id,name,parents,modifiedTime,mimeType,size)' }, 1)));
      const pathOf = id => { const out = []; for (let i = 0; id && id !== rootId && i < 8; i++) { const f = tree.get(id); if (!f) break; out.unshift(f.name); id = f.parent; } return out; };
      return res.flat().sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime))).slice(0, 80)
        .map(f => Object.assign(shape(f), { path: pathOf((f.parents || [])[0]) }));
    },
    async subfolders(rootId) { return new Set((await OD.folderTree(rootId)).keys()); },
    // שם תיקייה (ותיקיות האב שלה) להצגה בתוצאות. כל תיקייה נקראת מגוגל פעם אחת בלבד
    async folderPath(id, depth) {
      const names = [];
      const tree = OD._tree && OD._tree.map;
      OD._fcache = OD._fcache || new Map();
      for (let i = 0; id && i < (depth || 2); i++) {
        let f = tree && tree.get(id);
        if (!f) {
          if (!OD._fcache.has(id)) OD._fcache.set(id, OD.api('GET', `/files/${id}?fields=id,name,parents`).then(x => x && { name: x.name, parent: x.parents ? x.parents[0] : null }).catch(() => null));
          f = await OD._fcache.get(id);
        }
        if (!f || !f.parent) break;
        names.unshift(f.name);
        id = f.parent;
      }
      return names;
    },
  };
  root.OD = OD;
})(self);

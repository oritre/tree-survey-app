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

    async logout() { await DB.setKV('odAuth', null); await DB.setKV('odUser', ''); },

    async accessToken() {
      const a = await DB.getKV('odAuth', null);
      if (!a) throw new AuthError('לא מחובר לגוגל דרייב');
      if (Date.now() < a.exp) return a.access;
      if (!a.refresh) throw new AuthError('צריך להתחבר מחדש לגוגל דרייב');
      try { return await OD._token({ grant_type: 'refresh_token', refresh_token: a.refresh }); }
      catch (e) {
        if (e instanceof AuthError) { await DB.setKV('odAuth', Object.assign(a, { refresh: null, exp: 0 })); throw new AuthError('צריך להתחבר מחדש לגוגל דרייב'); }
        throw e;
      }
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

    async _list(query, extra) {
      const out = [];
      let token = '';
      do {
        const p = new URLSearchParams(Object.assign({ q: query, fields: `nextPageToken,files(${FIELDS})`, pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }, extra || {}));
        if (token) p.set('pageToken', token);
        const j = await OD.api('GET', '/files?' + p);
        if (!j) break;
        out.push(...(j.files || []));
        token = j.nextPageToken || '';
      } while (token);
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

    // תיקייה בתוך תיקייה (או בשורש), נוצרת אם אינה קיימת
    async folder(parentId, name) {
      const found = await OD._find(parentId, name, true);
      if (found) return found.id;
      const made = await OD.api('POST', '/files?fields=id', { name: OD.clean(name), mimeType: FOLDER, parents: [parentId || 'root'] });
      return made.id;
    },

    // העלאת קובץ. replace=true מחליף קובץ קיים באותו שם. מחזיר {id, name}, או null אם התיקייה לא קיימת
    async upload(parentId, name, blob, replace) {
      name = OD.clean(name);
      const type = blob.type || 'application/octet-stream';
      let existing = null;
      try { existing = replace ? await OD._find(parentId, name, false) : null; }
      catch (e) { if (/404|not found/i.test(e.message)) return null; throw e; }
      if (existing) return OD.replaceContent(existing.id, blob);
      // קובץ חדש: העלאה בהמשכים (עובד לכל גודל)
      const tok = await OD.accessToken();
      const init = await fetch(`${UPLOAD}/files?uploadType=resumable&fields=id,name&supportsAllDrives=true`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type },
        body: JSON.stringify({ name, parents: [parentId || 'root'] }) });
      if (init.status === 404) return null; // תיקיית היעד נמחקה
      if (!init.ok) throw new Error('העלאה לגוגל דרייב נכשלה (' + init.status + ')');
      const res = await fetch(init.headers.get('Location'), { method: 'PUT', headers: { 'Content-Type': type }, body: blob });
      if (!res.ok) throw new Error('העלאה לגוגל דרייב נכשלה (' + res.status + ')');
      return res.json();
    },

    // מחליף את התוכן של קובץ קיים (תמונה אחרי ציור, נתוני סקר), בלי לשנות את שמו
    async replaceContent(itemId, blob) {
      const j = await OD.api('PATCH', `${UPLOAD}/files/${itemId}?uploadType=media&fields=id,name&supportsAllDrives=true`, blob, { 'Content-Type': blob.type || 'application/octet-stream' });
      if (!j) { const e = new Error('הקובץ לא נמצא בגוגל דרייב'); e.status = 404; throw e; }
      return j;
    },

    async download(itemId) {
      const res = await OD.api('GET', `/files/${itemId}?alt=media&supportsAllDrives=true`, null, null, true);
      return res ? res.blob() : null;
    },

    async readJson(parentId, name) {
      const f = await OD._find(parentId, name, false);
      if (!f) return null;
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
    // rootId: רק בתוך התיקייה הזו ובתתי התיקיות שלה (null = כל הדרייב)
    async searchExcel(text, rootId) {
      const t = q(text.trim());
      const types = ['application/vnd.ms-excel.sheet.macroEnabled.12', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].map(m => `mimeType = '${m}'`).join(' or ');
      let files = await OD._list(`(name contains ${t} or fullText contains ${t}) and (${types}) and trashed = false`, { pageSize: '200', orderBy: 'modifiedTime desc' });
      if (rootId) {
        const inside = await OD.subfolders(rootId);
        files = files.filter(f => (f.parents || []).some(p => inside.has(p)));
      }
      return files.slice(0, 60).map(shape);
    },
    // מזהי התיקייה וכל תתי התיקיות שלה (נשמר לכמה דקות, כדי שחיפוש נוסף יהיה מהיר)
    async subfolders(rootId) {
      const c = OD._sub;
      if (c && c.root === rootId && Date.now() - c.at < 10 * 60 * 1000) return c.ids;
      const ids = new Set([rootId]);
      let level = [rootId];
      while (level.length) {
        const next = [];
        // כמה תיקיות בבקשה אחת
        for (let i = 0; i < level.length; i += 40) {
          const parents = level.slice(i, i + 40).map(id => `${q(id)} in parents`).join(' or ');
          const subs = await OD._list(`(${parents}) and mimeType = '${FOLDER}' and trashed = false`, { fields: 'nextPageToken,files(id)' });
          for (const f of subs) if (!ids.has(f.id)) { ids.add(f.id); next.push(f.id); }
        }
        level = next;
      }
      OD._sub = { root: rootId, ids, at: Date.now() };
      return ids;
    },
    // שם תיקייה (ותיקיית האב שלה) להצגה בתוצאות
    async folderPath(id, depth) {
      const names = [];
      for (let i = 0; id && i < (depth || 2); i++) {
        const f = await OD.api('GET', `/files/${id}?fields=id,name,parents`);
        if (!f || !f.parents) break;
        names.unshift(f.name);
        id = f.parents[0];
      }
      return names;
    },
  };
  root.OD = OD;
})(self);

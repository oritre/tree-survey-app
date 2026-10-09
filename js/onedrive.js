// חיבור ל-OneDrive דרך Microsoft Graph (התחברות PKCE, בלי שרת)
(function (root) {
  'use strict';
  const AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  const SCOPE = 'Files.ReadWrite offline_access User.Read';
  const CHUNK = 327680 * 16; // 5MB, כפולה של 320KB כמו ש-Graph דורש

  const redirectUri = () => location.origin + location.pathname;
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const rand = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

  class AuthError extends Error {}

  const OD = {
    AuthError,

    async clientId() { return (await DB.getKV('odClientId', '')).trim(); },

    async beginLogin() {
      const clientId = await OD.clientId();
      if (!clientId) throw new Error('חסר מזהה אפליקציה (Client ID)');
      const verifier = rand(48);
      const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      const state = rand(16);
      localStorage.setItem('od_pkce', JSON.stringify({ verifier, state, back: location.hash }));
      const q = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri(), scope: SCOPE,
        code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account' });
      location.href = AUTH + '/authorize?' + q;
    },

    // נקרא בעליית האפליקציה: אם חזרנו מההתחברות, מחליף את הקוד בטוקן
    async handleRedirect() {
      const q = new URLSearchParams(location.search);
      if (!q.has('code') && !q.has('error')) return null;
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem('od_pkce') || '{}'); } catch (_) {}
      localStorage.removeItem('od_pkce');
      history.replaceState(null, '', location.pathname + (saved.back || '#/settings'));
      if (q.has('error')) return { ok: false, message: q.get('error_description') || q.get('error') };
      if (q.get('state') !== saved.state) return { ok: false, message: 'ההתחברות לא הושלמה, נסה שוב' };
      try {
        await OD._token({ grant_type: 'authorization_code', code: q.get('code'), code_verifier: saved.verifier, redirect_uri: redirectUri() });
        const me = await OD.api('GET', '/me');
        await DB.setKV('odUser', me.userPrincipalName || me.displayName || '');
        return { ok: true };
      } catch (e) { return { ok: false, message: e.message }; }
    },

    async _token(params) {
      const body = new URLSearchParams(Object.assign({ client_id: await OD.clientId(), scope: SCOPE }, params));
      const res = await fetch(AUTH + '/token', { method: 'POST', body });
      const j = await res.json();
      if (!res.ok) throw new AuthError(j.error_description || j.error || 'ההתחברות נכשלה');
      await DB.setKV('odAuth', { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in - 120) * 1000 });
      return j.access_token;
    },

    async connected() { return !!(await DB.getKV('odAuth', null)); },

    async logout() { await DB.setKV('odAuth', null); await DB.setKV('odUser', ''); },

    async accessToken() {
      const a = await DB.getKV('odAuth', null);
      if (!a) throw new AuthError('לא מחובר ל-OneDrive');
      if (Date.now() < a.exp) return a.access;
      if (!a.refresh) throw new AuthError('צריך להתחבר מחדש ל-OneDrive');
      try { return await OD._token({ grant_type: 'refresh_token', refresh_token: a.refresh }); }
      catch (e) {
        // טוקן של אפליקציית דפדפן תקף ל-24 שעות, אחר כך צריך התחברות מחדש
        if (e instanceof AuthError) { await DB.setKV('odAuth', Object.assign(a, { refresh: null, exp: 0 })); throw new AuthError('צריך להתחבר מחדש ל-OneDrive'); }
        throw e;
      }
    },

    async api(method, path, body, headers) {
      const tok = await OD.accessToken();
      const h = Object.assign({ Authorization: 'Bearer ' + tok }, headers || {});
      let payload = body;
      if (body && !(body instanceof Blob) && typeof body === 'object') { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
      const res = await fetch(path.startsWith('http') ? path : GRAPH + path, { method, headers: h, body: payload });
      if (res.status === 401) { await DB.setKV('odAuth', Object.assign(await DB.getKV('odAuth', {}), { exp: 0 })); throw new Error('OneDrive דחה את הבקשה, ננסה שוב'); }
      if (res.status === 404) return null;
      if (res.status === 429 || res.status === 503) throw new Error('OneDrive עמוס, ננסה שוב בעוד רגע');
      const text = await res.text();
      const j = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error((j.error && j.error.message) || ('OneDrive ' + res.status));
      return j;
    },

    seg: name => encodeURIComponent(String(name).replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim() || 'ללא שם'),

    // תיקייה בתוך תיקייה (או בשורש), נוצרת אם אינה קיימת
    async folder(parentId, name) {
      const base = parentId ? `/me/drive/items/${parentId}` : '/me/drive/root';
      const found = await OD.api('GET', `${base}:/${OD.seg(name)}`);
      if (found && found.folder) return found.id;
      const made = await OD.api('POST', `${base}/children`, { name: decodeURIComponent(OD.seg(name)), folder: {}, '@microsoft.graph.conflictBehavior': 'rename' });
      return made.id;
    },

    // העלאת קובץ. replace=true מחליף קובץ קיים באותו שם, אחרת נותן שם חדש
    async upload(parentId, name, blob, replace) {
      const behavior = replace ? 'replace' : 'rename';
      const path = `/me/drive/items/${parentId}:/${OD.seg(name)}:`;
      if (blob.size < 4 * 1024 * 1024) {
        return OD.api('PUT', `${path}/content?@microsoft.graph.conflictBehavior=${behavior}`, blob, { 'Content-Type': blob.type || 'application/octet-stream' });
      }
      const sess = await OD.api('POST', `${path}/createUploadSession`, { item: { '@microsoft.graph.conflictBehavior': behavior } });
      let last;
      for (let start = 0; start < blob.size; start += CHUNK) {
        const end = Math.min(blob.size, start + CHUNK);
        const res = await fetch(sess.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${end - 1}/${blob.size}` }, body: blob.slice(start, end) });
        if (!res.ok && res.status !== 202) throw new Error('העלאה ל-OneDrive נכשלה (' + res.status + ')');
        last = await res.json().catch(() => ({}));
      }
      return last;
    },

    rename(itemId, name) {
      return OD.api('PATCH', `/me/drive/items/${itemId}`, { name: decodeURIComponent(OD.seg(name)) });
    },
  };
  root.OD = OD;
})(self);

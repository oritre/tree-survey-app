// שליחת מייל מתוך האפליקציה דרך Gmail API, מהכתובת שנקבעה בהגדרות (ברירת מחדל oritrees@gmail.com).
// אתר לא יכול לבחור את השולח באפליקציית Gmail דרך חלון השיתוף, ולכן האפליקציה שולחת בעצמה.
// התחברות נפרדת מגוגל דרייב (אפשר שהדרייב בחשבון אחר), אותו מזהה לקוח וסוד, הרשאה לשליחה בלבד
(function (root) {
  'use strict';
  const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
  const TOKEN = 'https://oauth2.googleapis.com/token';
  const SEND = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';
  const SCOPE = 'openid email https://www.googleapis.com/auth/gmail.send';
  const DEFAULT_FROM = 'oritrees@gmail.com';
  const MAX_BYTES = 24 * 1024 * 1024; // מגבלת הקבצים המצורפים ב-Gmail היא 25MB

  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const rand = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
  const redirectUri = () => location.origin + location.pathname;
  class AuthError extends Error {}

  // טקסט עברי בכותרות המייל
  const utf8b64 = s => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(bin); };
  const encWord = s => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + utf8b64(s) + '?=';
  const wrap76 = s => s.replace(/.{1,76}/g, '$&\r\n');
  async function blobB64(blob) {
    const b = new Uint8Array(await blob.arrayBuffer()); let bin = '';
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  // הודעת MIME עם קבצים מצורפים (multipart/mixed)
  async function mime({ from, to, subject, body, files }) {
    const bd = 'ts' + rand(12);
    const parts = [
      'From: ' + from, 'To: ' + to, 'Subject: ' + encWord(subject), 'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${bd}"`, '', '--' + bd,
      'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(utf8b64(body || ''))];
    for (const f of files || []) {
      const name = f.name.replace(/["\\\r\n]/g, '');
      parts.push('--' + bd,
        `Content-Type: ${f.type || 'application/octet-stream'}; name="${encWord(name)}"`,
        `Content-Disposition: attachment; filename="${encWord(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Content-Transfer-Encoding: base64', '', wrap76(await blobB64(f)));
    }
    parts.push('--' + bd + '--', '');
    return new Blob([parts.join('\r\n')], { type: 'message/rfc822' });
  }
  // הכתובת מתוך ה-id_token של ההתחברות
  function emailOf(idToken) {
    try { return JSON.parse(decodeURIComponent(escape(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))).email || ''; } catch (_) { return ''; }
  }

  const GM = {
    AuthError, DEFAULT_FROM, MAX_BYTES, mime,
    async from() { return ((await DB.getKV('mailFrom', DEFAULT_FROM)) || DEFAULT_FROM).trim(); },
    // החשבון שמחובר לשליחה (או '' אם לא מחובר)
    async account() { const a = await DB.getKV('gmAuth', null); return a && (a.refresh || a.access) ? (a.email || '?') : ''; },
    async ready() { const acc = await GM.account(); return !!acc && acc.toLowerCase() === (await GM.from()).toLowerCase(); },
    async logout() { await DB.setKV('gmAuth', null); },

    // back: לאן לחזור באפליקציה אחרי ההתחברות. pending: מה לשלוח אחרי החזרה (נשמר בטאבלט)
    async beginLogin(back) {
      const clientId = await OD.clientId(), secret = await OD.clientSecret();
      if (!clientId || !secret) throw new Error('צריך קודם לחבר את גוגל דרייב בהגדרות (מזהה וסוד של גוגל)');
      const verifier = rand(48);
      const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      const state = 'gm' + rand(16);
      localStorage.setItem('gm_pkce', JSON.stringify({ verifier, state, back: back || location.hash }));
      const p = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri(), scope: SCOPE,
        code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent',
        login_hint: await GM.from() });
      location.href = AUTH + '?' + p;
    },
    // בעליית האפליקציה, לפני החזרה מהתחברות לדרייב: רק אם זו חזרה מההתחברות למייל
    async handleRedirect() {
      const p = new URLSearchParams(location.search);
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem('gm_pkce') || 'null'); } catch (_) {}
      if (!saved || (!p.has('code') && !p.has('error')) || p.get('state') !== saved.state) return null;
      localStorage.removeItem('gm_pkce');
      history.replaceState(null, '', location.pathname + (saved.back || '#/'));
      if (p.has('error')) return { ok: false, message: p.get('error_description') || p.get('error') };
      try {
        await GM._token({ grant_type: 'authorization_code', code: p.get('code'), code_verifier: saved.verifier, redirect_uri: redirectUri() });
        const acc = await GM.account(), want = await GM.from();
        if (acc.toLowerCase() !== want.toLowerCase()) return { ok: false, message: `התחברת עם ${acc}, ולא עם ${want}. נסה שוב ובחר את ${want}` };
        return { ok: true, email: acc };
      } catch (e) { return { ok: false, message: e.message }; }
    },
    async _token(params) {
      const body = new URLSearchParams(Object.assign({ client_id: await OD.clientId(), client_secret: await OD.clientSecret() }, params));
      const res = await fetch(TOKEN, { method: 'POST', body });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new AuthError(j.error_description || j.error || 'ההתחברות נכשלה');
      const old = (await DB.getKV('gmAuth', null)) || {};
      await DB.setKV('gmAuth', { access: j.access_token, refresh: j.refresh_token || old.refresh,
        email: (j.id_token && emailOf(j.id_token)) || old.email || '', exp: Date.now() + ((j.expires_in || 3600) - 120) * 1000 });
      return j.access_token;
    },
    async accessToken() {
      const a = await DB.getKV('gmAuth', null);
      if (!a) throw new AuthError('צריך להתחבר לשליחת מיילים');
      if (Date.now() < a.exp) return a.access;
      if (!a.refresh) throw new AuthError('צריך להתחבר מחדש לשליחת מיילים');
      try { return await GM._token({ grant_type: 'refresh_token', refresh_token: a.refresh }); }
      catch (e) {
        if (e instanceof AuthError) { await DB.setKV('gmAuth', Object.assign(a, { refresh: null, exp: 0 })); throw new AuthError('צריך להתחבר מחדש לשליחת מיילים'); }
        throw e;
      }
    },
    // שליחה: to = כתובת אחת או כמה מופרדות בפסיק. files = File[]
    async send(msg) {
      const size = (msg.files || []).reduce((a, f) => a + f.size, 0);
      if (size > MAX_BYTES) throw new Error(`הקבצים גדולים מדי למייל אחד (${(size / 1048576).toFixed(1)}MB, המקסימום ב-Gmail הוא 25MB). שלח בשני מיילים.`);
      const raw = await mime(Object.assign({ from: await GM.from() }, msg));
      for (let attempt = 0; ; attempt++) {
        const tok = await GM.accessToken();
        const res = await fetch(SEND, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'message/rfc822' }, body: raw });
        if (res.status === 401 && attempt === 0) { const a = await DB.getKV('gmAuth', {}); await DB.setKV('gmAuth', Object.assign(a, { exp: 0 })); continue; }
        if (res.status === 401) throw new AuthError('צריך להתחבר מחדש לשליחת מיילים');
        const j = await res.json().catch(() => ({}));
        if (res.status === 403 && /has not been used|disabled/i.test((j.error && j.error.message) || ''))
          throw new Error('צריך להפעיל את Gmail API בפרויקט של גוגל (פעם אחת). ההוראות בהגדרות > שליחת מיילים');
        if (!res.ok) throw new Error((j.error && j.error.message) || ('Gmail ' + res.status));
        return j;
      }
    },
  };
  root.GM = GM;
})(window);

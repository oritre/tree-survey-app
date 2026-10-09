// סנכרון ברקע כשיש קליטה: גיבוי כל התמונות לטלגרם ושמירת הסקרים ב-OneDrive
(function (root) {
  'use strict';
  const REPORT_EVERY = 5 * 60 * 1000; // דוח אקסל מתעדכן ב-OneDrive לכל היותר פעם ב-5 דקות בזמן עבודה

  let running = false, again = false, timer = null, forceReport = false;
  const listeners = new Set();
  const state = { tgPending: 0, odPending: 0, error: '', odNeedsLogin: false, busy: false, offline: !navigator.onLine };

  // App.live(id) מחזיר את הסקר הפתוח בזיכרון, כדי לא לדרוס עריכות שעוד לא נשמרו
  const live = s => (root.App && root.App.live(s.id)) || s;

  function emit() { for (const fn of listeners) try { fn(state); } catch (_) {} }

  const fmtDate = iso => iso ? iso.split('-').reverse().join('/') : '';

  function surveyLine(s) {
    return [s.project, s.site || 'סקר ללא שם', s.code ? 'סמל ' + s.code : '', fmtDate(s.date)].filter(Boolean).join(' · ');
  }

  function caption(s, t, p) {
    const label = Core.photoLabel(t, p);
    const lines = [
      p.note ? '📝 ' + p.note : '',
      ['עץ ' + label, t.species, t.urgency ? 'דחיפות ' + t.urgency : '', t.pines ? t.pines + ' אורנים' : '', p.inReport ? 'בדוח' : ''].filter(Boolean).join(' · '),
      t.notes || '',
      surveyLine(s),
      t.lat != null ? `📍 https://maps.google.com/?q=${t.lat.toFixed(6)},${t.lon.toFixed(6)}` : '',
    ];
    return lines.filter(Boolean).join('\n').slice(0, 1000);
  }

  function photoFileName(t, p, k) {
    const label = Core.photoLabel(t, p) || 'ללא מספר';
    return `עץ ${label}${p.note ? ' - ' + p.note : ' - ' + k}.jpg`;
  }

  // טביעת אצבע לתוכן הסקר (בלי שדות הסנכרון), כדי לדעת אם צריך להעלות שוב
  function hashSurvey(s) {
    const strip = JSON.stringify(s, (k, v) => (k.startsWith('tg') || k.startsWith('od') || k === 'updated' || k.startsWith('_')) ? undefined : v);
    let h = 5381;
    for (let i = 0; i < strip.length; i++) h = ((h << 5) + h + strip.charCodeAt(i)) | 0;
    return String(h >>> 0) + ':' + strip.length;
  }

  async function syncTelegram(s, cfg) {
    let dirty = false;
    for (const t of Core.sortTrees(s.trees)) {
      for (const p of t.photos || []) {
        if (!t.photos.includes(p)) continue; // נמחקה בינתיים
        const cap = caption(s, t, p);
        if (!p.tgMsgId) {
          const d = await DB.getPhoto(p.id);
          if (!d) continue;
          if (!s.tgHeaderSent) {
            await TG.sendText(cfg.token, cfg.chat, '📋 סקר בטיחות עצים\n' + surveyLine(s));
            s.tgHeaderSent = true;
          }
          p.tgMsgId = await TG.sendPhoto(cfg.token, cfg.chat, d.blob, cap);
          p.tgCaption = cap;
          dirty = true;
          await DB.putSurvey(s);
          emit();
        } else if (p.tgCaption !== cap) {
          const ok = await TG.editCaption(cfg.token, cfg.chat, p.tgMsgId, cap);
          if (ok) p.tgCaption = cap; else { p.tgMsgId = null; p.tgCaption = null; } // ההודעה נמחקה בטלגרם: תישלח שוב
          dirty = true;
          await DB.putSurvey(s);
        }
      }
    }
    return dirty;
  }

  async function syncOneDrive(s) {
    const rootName = (await DB.getKV('odRoot', 'סקרי עצים')) || 'סקרי עצים';
    if (!s.odFolderId) {
      const r = await OD.folder(null, rootName);
      const proj = await OD.folder(r, s.project || 'ללא פרויקט');
      s.odFolderId = await OD.folder(proj, `${s.date || ''} ${s.site || 'סקר'}${s.code ? ' (' + s.code + ')' : ''}`);
      await DB.putSurvey(s);
    }
    if (!s.odPhotosId) { s.odPhotosId = await OD.folder(s.odFolderId, 'תמונות'); await DB.putSurvey(s); }

    // תמונות: כל אחת עולה פעם אחת, ומשנה שם אם השם/הפרטים השתנו
    for (const t of Core.sortTrees(s.trees)) {
      let k = 1;
      for (const p of t.photos || []) {
        const name = photoFileName(t, p, k++);
        if (!p.odId) {
          const d = await DB.getPhoto(p.id);
          if (!d) continue;
          const item = await OD.upload(s.odPhotosId, name, d.blob, false);
          p.odId = item.id; p.odName = name;
          await DB.putSurvey(s);
          emit();
        } else if (p.odName !== name) {
          try { await OD.rename(p.odId, name); } catch (_) { /* שם תפוס: משאירים */ }
          p.odName = name;
          await DB.putSurvey(s);
        }
      }
    }

    // נתוני הסקר ושכבת GIS: בכל שינוי. דוח אקסל: לכל היותר פעם ב-5 דקות
    const hash = hashSurvey(s);
    if (s.odDataHash !== hash) {
      await OD.upload(s.odFolderId, 'נתוני סקר.json', new Blob([JSON.stringify(s, null, 1)], { type: 'application/json' }), true);
      await OD.upload(s.odFolderId, 'שכבת עצים.geojson', new Blob([root.Gis.geojson([s])], { type: 'application/geo+json' }), true);
      s.odDataHash = hash;
      await DB.putSurvey(s);
    }
    if (s.odReportHash !== hash && (forceReport || Date.now() - (s.odReportAt || 0) > REPORT_EVERY)) {
      const r = await root.App.buildReport(s);
      await OD.upload(s.odFolderId, r.name, r.blob, true);
      s.odReportHash = hash; s.odReportAt = Date.now();
      await DB.putSurvey(s);
    }
  }

  function countPending(surveys, tgOn, odOn) {
    let tg = 0, od = 0;
    for (const s0 of surveys) {
      const s = live(s0);
      for (const t of s.trees) for (const p of t.photos || []) {
        if (tgOn && !p.tgMsgId) tg++;
        if (odOn && !p.odId) od++;
      }
      if (odOn && s.trees.length && s.odDataHash !== hashSurvey(s)) od++;
    }
    state.tgPending = tg; state.odPending = od;
  }

  async function run() {
    if (running) { again = true; return; }
    running = true; again = false;
    state.busy = true; state.error = ''; state.offline = !navigator.onLine; emit();
    try {
      const token = await DB.getKV('tgToken', ''), chat = await DB.getKV('tgChat', '');
      const tgOn = !!(token && chat);
      const odOn = (await OD.connected()) && !!(await OD.clientId());
      let surveys = await DB.allSurveys();
      countPending(surveys, tgOn, odOn); emit();
      if (state.offline || (!tgOn && !odOn)) return;
      // הסקר הפתוח קודם
      surveys.sort((a, b) => (live(b) !== b) - (live(a) !== a) || (b.updated || 0) - (a.updated || 0));
      for (const s0 of surveys) {
        const s = live(s0);
        if (tgOn) {
          try { await syncTelegram(s, { token, chat }); }
          catch (e) { state.error = 'טלגרם: ' + e.message; }
        }
        if (odOn && !state.odNeedsLogin) {
          try { await syncOneDrive(s); }
          catch (e) {
            if (e instanceof OD.AuthError) state.odNeedsLogin = true;
            else state.error = 'OneDrive: ' + e.message;
          }
        }
      }
      forceReport = false;
      surveys = await DB.allSurveys();
      countPending(surveys, tgOn, odOn);
    } catch (e) {
      state.error = e.message;
    } finally {
      running = false; state.busy = false; emit();
      if (root.App && root.App.onSynced) root.App.onSynced();
      if (again) kick(true);
      else if (state.error || state.odPending || state.tgPending) schedule(60000); // ניסיון חוזר בעוד דקה
    }
  }

  function schedule(ms) { clearTimeout(timer); timer = setTimeout(run, ms); }

  // fast=true אחרי צילום (שולח כמעט מיד), אחרת מחכה שיסיימו להקליד
  function kick(fast) { schedule(fast ? 1500 : 8000); }

  window.addEventListener('online', () => { state.offline = false; kick(true); });
  window.addEventListener('offline', () => { state.offline = true; emit(); });
  setInterval(() => { if (!running) run(); }, 3 * 60 * 1000);

  root.Sync = {
    kick, state,
    now(opts) { if (opts && opts.report) forceReport = true; state.odNeedsLogin = false; schedule(0); },
    onChange(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    caption, photoFileName,
  };
})(self);

// סנכרון ברקע כשיש קליטה: גיבוי כל התמונות לטלגרם ושמירת הסקרים ב-OneDrive
(function (root) {
  'use strict';
  // נתוני הסקר עולים ל-OneDrive אחרי כל שינוי (קובץ קטן). האקסל וה-PDF עולים רק ב"סיום סקר"
  // או בלחיצה על "העלה אקסל לענן", כי הם כוללים את כל התמונות ועולים הרבה גלישה.
  const INDEX = 'אינדקס סקרים.json'; // רשימת כל הסקרים בענן, לחיפוש לפי סמל, שם, רחוב ועיר

  let running = false, again = false, timer = null;
  const listeners = new Set();
  const state = { tgPending: 0, odPending: 0, error: '', odNeedsLogin: false, busy: false, offline: !navigator.onLine };

  // App.live(id) מחזיר את הסקר הפתוח בזיכרון, כדי לא לדרוס עריכות שעוד לא נשמרו
  const live = s => (root.App && root.App.live(s.id)) || s;

  function emit() { for (const fn of listeners) try { fn(state); } catch (_) {} }

  // יומן גיבוי: שגיאות ואירועים חשובים, נשמר בטאבלט (300 האחרונים) ומוצג במסך "בקרת גיבוי"
  let logQ = Promise.resolve();
  function log(level, msg, s) {
    const e = { t: Date.now(), level, msg: String(msg).slice(0, 300), survey: s ? (s.site || s.id) : '' };
    logQ = logQ.then(async () => {
      const L = await DB.getKV('syncLog', []);
      const last = L[L.length - 1];
      if (last && last.msg === e.msg && last.survey === e.survey && e.t - last.t < 10 * 60 * 1000) { last.n = (last.n || 1) + 1; last.t = e.t; }
      else L.push(e);
      await DB.setKV('syncLog', L.slice(-300));
    }).catch(() => {});
    return logQ;
  }
  DB.getKV('syncLastOk', 0).then(v => { state.lastOk = v; }).catch(() => {});

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
          if (!d || !d.blob) continue;
          if (!s.tgHeaderSent) {
            await TG.sendText(cfg.token, cfg.chat, '📋 סקר בטיחות עצים\n' + surveyLine(s));
            s.tgHeaderSent = true;
          }
          const ver = p.ver || 0;
          p.tgMsgId = await TG.sendPhoto(cfg.token, cfg.chat, d.blob, cap);
          p.tgCaption = cap; p.tgVer = ver;
          dirty = true;
          await DB.putSurvey(s);
          emit();
        } else if ((p.ver || 0) !== (p.tgVer || 0)) {
          // ציירו על התמונה אחרי שנשלחה: מחליפים את התמונה באותה הודעה
          const d = await DB.getPhoto(p.id);
          if (!d || !d.blob) continue;
          const ver = p.ver || 0;
          const ok = await TG.editPhoto(cfg.token, cfg.chat, p.tgMsgId, d.blob, cap);
          if (ok) { p.tgVer = ver; p.tgCaption = cap; } else { p.tgMsgId = null; p.tgCaption = null; }
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

  // שתי תיקיות ב-OneDrive:
  //  "גיבוי אפליקציית סקרי עצים" — הגיבוי של האפליקציה: נתוני הסקר, התמונות, גרסאות קודמות ועותק של האקסל וה-PDF.
  //     ממנה החיפוש בענן עובד. לא מוחקים ממנה.
  //  "סקרי עצים" — הדוחות לעבודה: אקסל ו-PDF בלבד. אפשר למחוק ממנה בלי לפגוע בגיבוי.
  const folderBase = s => `${s.date || ''} ${s.site || 'סקר'}${s.code ? ' (' + s.code + ')' : ''}`;

  // סקרים מגרסה 1.4 ישבו בתיקיית הדוחות: מתחילים להם גיבוי בתיקייה החדשה
  function migrate(s) {
    if (s.odLayout === 2) return false;
    s.odFolderId = s.odPhotosId = s.odDataId = s.odDataHash = s.odIndexKey = s.odReportDir = null;
    s.odLayout = 2;
    return true;
  }

  async function syncFolders(s) {
    if (migrate(s)) {
      // תמונות שעוד נמצאות בטאבלט יעלו לתיקיית הגיבוי. תמונות שכבר פונו נשארות בקובץ הקיים ב-OneDrive
      for (const t of s.trees) for (const p of t.photos || []) {
        const d = await DB.getPhoto(p.id);
        if (d && d.blob) { p.odId = null; p.odName = null; }
      }
      await DB.putSurvey(s);
    }
    if (!s.odFolderId) {
      const proj = await OD.folder(await backupRoot(), s.project || 'ללא פרויקט');
      // שני סקרים עם אותו תאריך ושם (למשל סקר חדש שנפתח על בסיס ישן באותו יום) מקבלים תיקיות נפרדות
      for (let k = 1; ; k++) {
        const id = await OD.folder(proj, k > 1 ? `${folderBase(s)} - ${k}` : folderBase(s));
        const other = await OD.readJson(id, 'נתוני סקר.json');
        if (!other || other.id === s.id) { s.odFolderId = id; s.odFolderK = k; break; }
      }
      await DB.putSurvey(s);
    }
    if (!s.odPhotosId) { s.odPhotosId = await OD.folder(s.odFolderId, 'תמונות'); await DB.putSurvey(s); }
  }

  // בתיקיית הדוחות: תיקייה לכל פרויקט, וכל קבצי הסקרים ישירות בתוכה (בלי תיקייה לכל סקר)
  async function reportFolder(s) {
    if (!s.odReportDir) {
      s.odReportDir = await OD.folder(await reportRoot(), s.project || 'ללא פרויקט');
      await DB.putSurvey(s);
    }
    return s.odReportDir;
  }

  // קובץ דוח: נשמר בתיקיית הגיבוי, ועותק שלו (העתקה בתוך OneDrive, בלי גלישה נוספת) בתיקיית הדוחות
  async function putReportFile(s, name, blob) {
    const item = await OD.upload(s.odFolderId, name, blob, true);
    if (!item) { s.odFolderId = null; s.odPhotosId = null; await syncFolders(s); return putReportFile(s, name, blob); } // תיקיית הגיבוי נמחקה
    for (let attempt = 0; attempt < 2; attempt++) {
      const dest = await reportFolder(s);
      try { await OD.copy(item.id, dest, name); return; }
      catch (e) {
        if (e.status === 404) { s.odReportDir = null; continue; } // תיקיית הדוחות נמחקה: יוצרים מחדש
        const up = await OD.upload(dest, name, blob, true);
        if (up) return;
        s.odReportDir = null;
      }
    }
    throw new Error('לא ניתן לשמור בתיקיית הדוחות');
  }

  async function syncOneDrive(s) {
    await syncFolders(s);

    // הסקר נפתח ביום אחר: שומרים קודם את הגרסה הקודמת מהענן, כדי שלא תידרס
    if (s.snapshotFrom) {
      if (s.odDataId) {
        const blob = await OD.download(s.odDataId);
        if (blob) {
          const vf = await OD.folder(s.odFolderId, 'גרסאות קודמות');
          await OD.upload(vf, `נתוני סקר - עד ${s.snapshotFrom}.json`, blob, true);
          log('info', `נשמרה גרסה קודמת של הסקר (עד ${s.snapshotFrom})`, s);
        }
      }
      s.snapshotFrom = null;
      await DB.putSurvey(s);
    }

    // תמונות: כל אחת עולה פעם אחת, ומשנה שם אם השם/הפרטים השתנו
    for (const t of Core.sortTrees(s.trees)) {
      let k = 1;
      for (const p of t.photos || []) {
        const name = photoFileName(t, p, k++);
        if (!p.odId) {
          const d = await DB.getPhoto(p.id);
          if (!d || !d.blob) continue;
          const ver = p.ver || 0;
          const item = await OD.upload(s.odPhotosId, name, d.blob, false);
          if (!item) { s.odFolderId = s.odPhotosId = null; await DB.putSurvey(s); throw new Error('תיקיית הגיבוי ב-OneDrive נמחקה, יוצר אותה מחדש'); }
          p.odId = item.id; p.odName = name; p.odVer = ver;
          await DB.putSurvey(s);
          emit();
        } else if ((p.ver || 0) !== (p.odVer || 0)) {
          // התמונה עודכנה (ציור): מחליפים את הקובץ ב-OneDrive
          const d = await DB.getPhoto(p.id);
          if (!d || !d.blob) continue;
          const ver = p.ver || 0;
          let item;
          try { item = await OD.replaceContent(p.odId, d.blob); }
          catch (_) { item = await OD.upload(s.odPhotosId, p.odName || name, d.blob, true); } // הקובץ נמחק ב-OneDrive
          p.odId = item.id || p.odId; p.odVer = ver;
          await DB.putSurvey(s);
          emit();
        } else if (p.odName !== name) {
          try { await OD.rename(p.odId, name); } catch (_) { /* שם תפוס: משאירים */ }
          p.odName = name;
          await DB.putSurvey(s);
        }
      }
    }

    // נתוני הסקר ושכבת GIS: אחרי כל שינוי
    const hash = hashSurvey(s);
    if (s.odDataHash !== hash) {
      const item = await OD.upload(s.odFolderId, 'נתוני סקר.json', new Blob([JSON.stringify(s, null, 1)], { type: 'application/json' }), true);
      await OD.upload(s.odFolderId, 'שכבת עצים.geojson', new Blob([root.Gis.geojson([s])], { type: 'application/geo+json' }), true);
      if (!item) { s.odFolderId = s.odPhotosId = null; await DB.putSurvey(s); throw new Error('תיקיית הגיבוי ב-OneDrive נמחקה, יוצר אותה מחדש'); }
      if (item.id) s.odDataId = item.id;
      s.odDataHash = hash;
      await DB.putSurvey(s);
    }
    await updateIndex(s);

    // "סיום סקר": כשכל התמונות כבר בענן, מעלים אקסל ו-PDF לאותה תיקייה ומפנים את התמונות מהטאבלט
    if (s.finishPending && allInCloud(s)) {
      await uploadReport(s, { pdf: true });
      s.finishPending = false; s.finished = true; s.finishedAt = Date.now();
      await DB.putSurvey(s);
      await updateIndex(s);
      await freeLocal(s);
      log('ok', 'סיום סקר: אקסל ו-PDF נשמרו ב-OneDrive, והתמונות פונו מהטאבלט', s);
      emit();
    }
  }

  const allInCloud = s => s.trees.every(t => (t.photos || []).every(p => p.odId && (p.ver || 0) === (p.odVer || 0)));

  // מפנה מקום בטאבלט: התמונות המלאות נמחקות (נשארת תמונה ממוזערת), והן נטענות מ-OneDrive כשצריך
  async function freeLocal(s) {
    const tgOn = !!(await DB.getKV('tgChat', ''));
    for (const t of s.trees) for (const p of t.photos || []) {
      if (!p.odId || (p.ver || 0) !== (p.odVer || 0)) continue;
      if (tgOn && (!p.tgMsgId || (p.ver || 0) !== (p.tgVer || 0))) continue;
      const d = await DB.getPhoto(p.id);
      if (d && d.blob) await DB.putPhoto({ id: d.id, thumb: d.thumb, w: d.w, h: d.h, strokes: d.strokes, cloud: true });
    }
  }

  function indexEntry(s) {
    const n = s.trees.filter(Core.hasContent).length;
    return { id: s.id, project: s.project || '', siteName: s.siteName || '', street: s.street || '', city: s.city || '', site: s.site || '',
      code: s.code || '', manager: s.manager || '', date: s.date || '', trees: n, photos: s.trees.reduce((a, t) => a + (t.photos || []).length, 0),
      folderId: s.odFolderId, dataId: s.odDataId || null, finished: !!s.finished };
  }

  const BACKUP_ROOT = 'גיבוי אפליקציית סקרי עצים';
  async function backupRoot() { return OD.folder(null, (await DB.getKV('odBackupRoot', BACKUP_ROOT)) || BACKUP_ROOT); }
  async function reportRoot() { return OD.folder(null, (await DB.getKV('odRoot', 'סקרי עצים')) || 'סקרי עצים'); }
  const rootFolder = backupRoot;

  async function updateIndex(s) {
    if (!s.odDataId) return;
    const e = indexEntry(s), key = JSON.stringify(e);
    if (s.odIndexKey === key) return;
    const r = await rootFolder();
    const idx = (await OD.readJson(r, INDEX)) || { surveys: [] };
    idx.surveys = (idx.surveys || []).filter(x => x.id !== s.id).concat([e]);
    await OD.upload(r, INDEX, new Blob([JSON.stringify(idx)], { type: 'application/json' }), true);
    s.odIndexKey = key;
    await DB.putSurvey(s);
  }

  async function cloudIndex() {
    const r = await rootFolder();
    const idx = (await OD.readJson(r, INDEX)) || { surveys: [] };
    return idx.surveys || [];
  }

  // אקסל (ואם ביקשו גם PDF) לתיקיית הסקר ב-OneDrive, באותו שם
  async function uploadReport(s, opts) {
    await syncFolders(s);
    const r = await root.App.buildReport(s);
    await putReportFile(s, r.name, r.blob);
    s.odReportHash = hashSurvey(s); s.odReportAt = Date.now();
    log('ok', 'האקסל נשמר ב-OneDrive', s);
    if (opts && opts.pdf) await uploadPdf(s, await root.App.buildPdf(s));
    await DB.putSurvey(s);
  }
  async function uploadPdf(s, pdf) {
    await syncFolders(s);
    await putReportFile(s, pdf.name, pdf.blob);
    s.odPdfAt = Date.now();
    log('ok', 'ה-PDF נשמר ב-OneDrive', s);
    await DB.putSurvey(s);
  }

  function countPending(surveys, tgOn, odOn) {
    let tg = 0, od = 0;
    for (const s0 of surveys) {
      const s = live(s0);
      for (const t of s.trees) for (const p of t.photos || []) {
        if (tgOn && (!p.tgMsgId || (p.ver || 0) !== (p.tgVer || 0))) tg++;
        if (odOn && (!p.odId || (p.ver || 0) !== (p.odVer || 0))) od++;
      }
      if (odOn && s.trees.length && s.odDataHash !== hashSurvey(s)) od++;
      if (odOn && s.finishPending) od++;
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
          catch (e) { state.error = 'טלגרם: ' + e.message; log('error', state.error, s); }
        }
        if (odOn && !state.odNeedsLogin) {
          try { await syncOneDrive(s); }
          catch (e) {
            if (e instanceof OD.AuthError) { state.odNeedsLogin = true; log('error', 'OneDrive: צריך להתחבר מחדש', s); }
            else { state.error = 'OneDrive: ' + e.message; log('error', state.error, s); }
          }
        }
      }
      surveys = await DB.allSurveys();
      countPending(surveys, tgOn, odOn);
      if (!state.error && !state.odNeedsLogin && !state.tgPending && !state.odPending) { state.lastOk = Date.now(); DB.setKV('syncLastOk', state.lastOk); }
    } catch (e) {
      state.error = e.message;
      log('error', 'שגיאה כללית בגיבוי: ' + e.message);
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
    now() { state.odNeedsLogin = false; schedule(0); },
    // פעולות ידניות: עובדות על הסקר הפתוח ומחכות לסיום
    async uploadReport(s) { await syncFolders(s); await uploadReport(s, { pdf: false }); },
    async uploadPdf(s, pdf) { await syncFolders(s); await uploadPdf(s, pdf); },
    cloudIndex, allInCloud, freeLocal, log, hashSurvey,
    pendingOf(s, tgOn, odOn) {
      const ph = s.trees.flatMap(t => t.photos || []);
      return {
        photos: ph.length,
        tg: tgOn ? ph.filter(p => !p.tgMsgId || (p.ver || 0) !== (p.tgVer || 0)).length : null,
        od: odOn ? ph.filter(p => !p.odId || (p.ver || 0) !== (p.odVer || 0)).length : null,
        data: odOn ? s.odDataHash === hashSurvey(s) : null,
      };
    },
    onChange(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    caption, photoFileName,
  };
})(self);

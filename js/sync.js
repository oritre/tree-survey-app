// סנכרון ברקע כשיש קליטה: גיבוי כל התמונות לטלגרם ושמירת הסקרים בגוגל דרייב
(function (root) {
  'use strict';
  // נתוני הסקר עולים לגוגל דרייב אחרי כל שינוי (קובץ קטן). האקסל וה-PDF עולים רק ב"סיום סקר"
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

  // כיתוב התמונה בטלגרם: רק ההערה שנכתבה לתמונה באפליקציה, בלי שום דבר נוסף.
  // פרטי הסקר נשלחים פעם אחת בהודעה לפני התמונה הראשונה של הסקר
  // בסקר לבנייה: שם התמונה (מספר העץ, או מה שנכתב ידנית), כמו באקסל
  function caption(s, t, p) {
    if (Construction.isConstruction(s)) return Construction.photoName(t, p).slice(0, 1000);
    return (p.note || '').trim().slice(0, 1000);
  }


  // בסקר לבנייה: הקובץ נקרא כמו התמונה בנספח (7.jpg, 7-9.jpg), ותמונה נוספת באותו שם מקבלת _2, _3
  function photoFileName(t, p, k, s, used) {
    if (s && Construction.isConstruction(s)) {
      const base = (Construction.pictureName(Construction.photoName(t, p)).trim() || 'ללא מספר').replace(/[\\/:*?"<>|]/g, '_');
      const n = (used.get(base) || 0) + 1; used.set(base, n);
      return `${base}${n > 1 ? '_' + n : ''}.jpg`;
    }
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
        if (p.fromOld) continue; // תמונה מהסקר הקודם: כבר לא חדשה, לא שולחים לטלגרם
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
          await DB.putSurvey(s, false);
          emit();
        } else if ((p.ver || 0) !== (p.tgVer || 0)) {
          // ציירו על התמונה אחרי שנשלחה: מחליפים את התמונה באותה הודעה
          const d = await DB.getPhoto(p.id);
          if (!d || !d.blob) continue;
          const ver = p.ver || 0;
          const ok = await TG.editPhoto(cfg.token, cfg.chat, p.tgMsgId, d.blob, cap);
          if (ok) { p.tgVer = ver; p.tgCaption = cap; } else { p.tgMsgId = null; p.tgCaption = null; }
          dirty = true;
          await DB.putSurvey(s, false);
          emit();
        } else if (p.tgCaption !== cap) {
          const ok = await TG.editCaption(cfg.token, cfg.chat, p.tgMsgId, cap);
          if (ok) p.tgCaption = cap; else { p.tgMsgId = null; p.tgCaption = null; } // ההודעה נמחקה בטלגרם: תישלח שוב
          dirty = true;
          await DB.putSurvey(s, false);
        }
      }
    }
    return dirty;
  }

  // שתי תיקיות בגוגל דרייב:
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
      // תמונות שעוד נמצאות בטאבלט יעלו לתיקיית הגיבוי. תמונות שכבר פונו נשארות בקובץ הקיים בגוגל דרייב
      for (const t of s.trees) for (const p of t.photos || []) {
        const d = await DB.getPhoto(p.id);
        if (d && d.blob) { p.odId = null; p.odName = null; }
      }
      await DB.putSurvey(s, false);
    }
    if (!s.odFolderId) {
      const proj = await OD.folder(await backupRoot(), s.project || 'ללא פרויקט');
      // שני סקרים עם אותו תאריך ושם (למשל סקר חדש שנפתח על בסיס ישן באותו יום) מקבלים תיקיות נפרדות
      for (let k = 1; ; k++) {
        const id = await OD.folder(proj, k > 1 ? `${folderBase(s)} - ${k}` : folderBase(s));
        const other = await OD.readJson(id, 'נתוני סקר.json');
        if (!other || other.id === s.id) { s.odFolderId = id; s.odFolderK = k; break; }
      }
      await DB.putSurvey(s, false);
    }
    if (!s.odPhotosId) { s.odPhotosId = await OD.folder(s.odFolderId, 'תמונות'); await DB.putSurvey(s, false); }
  }

  // בתיקיית הדוחות: תיקייה לכל פרויקט. סקר בטיחות: הקבצים ישירות בתוכה.
  // סקר לבנייה: תת-תיקייה לכל סקר בשם הסקר (ori, גרסה 1.45), כדי שקבצים של כמה סקרים לא יתערבבו
  const isBuild = s => !!(root.Construction && root.Construction.isConstruction(s));
  const buildDirName = s => (root.App && root.App.reportDirName ? root.App.reportDirName(s) : (s.site || 'ללא שם'));
  async function reportFolder(s) {
    // סקר לבנייה מלפני 1.45 שמר את תיקיית הפרויקט: עוברים לתת-תיקייה של הסקר
    if (isBuild(s) && s.odReportDir && !s.odReportDirName) s.odReportDir = null;
    // התיקייה שנשמרה בסקר: בודקים פעם אחת בכל הפעלה שלא הועברה לפח (אחרת הקבצים היו נשמרים בתוך תיקייה בפח)
    if (s.odReportDir && !OD._verified.has(s.odReportDir)) {
      const j = await OD.api('GET', `/files/${s.odReportDir}?fields=id,trashed&supportsAllDrives=true`).catch(() => null);
      if (j && !j.trashed) OD._verified.add(s.odReportDir); else s.odReportDir = null;
    }
    if (s.odReportDir && isBuild(s) && s.odReportDirName !== buildDirName(s)) {
      // שם הסקר השתנה: משנים את שם התיקייה (הקבצים הקודמים נשארים בה)
      const name = buildDirName(s);
      if (await OD.rename(s.odReportDir, name).catch(() => null)) { s.odReportDirName = name; await DB.putSurvey(s, false); }
      else s.odReportDir = null;
    }
    if (!s.odReportDir) {
      const proj = await OD.folder(await reportRoot(), s.project || 'ללא פרויקט');
      if (isBuild(s)) {
        const name = buildDirName(s);
        s.odReportDir = await OD.folder(proj, name);
        s.odReportDirName = name;
      } else s.odReportDir = proj;
      await DB.putSurvey(s, false);
    }
    return s.odReportDir;
  }
  // הנתיב לתצוגה: סקרי עצים / פרויקט [/ שם הסקר]
  async function reportPath(s) {
    return [(await DB.getKV('odRoot', 'סקרי עצים')) || 'סקרי עצים', s.project || 'ללא פרויקט'].concat(isBuild(s) ? [s.odReportDirName || buildDirName(s)] : []).join(' / ');
  }

  // קובץ דוח: נשמר בתיקיית הגיבוי, ועותק שלו (העתקה בתוך גוגל דרייב, בלי גלישה נוספת) בתיקיית הדוחות
  async function putReportFile(s, name, blob) {
    // PDF: רק בתיקיית הדוחות. בגיבוי של האפליקציה נשמר רק האקסל (מהנתונים שבו אפשר להפיק את ה-PDF מחדש)
    if (/\.pdf$/i.test(name)) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (await OD.upload(await reportFolder(s), name, blob, true)) return;
        s.odReportDir = null; // תיקיית הדוחות נמחקה: יוצרים מחדש
      }
      throw new Error('לא ניתן לשמור בתיקיית הדוחות');
    }
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

    // סקר שיובא מקובץ אקסל ישן: עותק של הקובץ המקורי נשמר בתיקיית הגיבוי שלו (העתקה בתוך גוגל דרייב)
    if (s.odSrcId && !s.odSrcCopied) {
      try { await OD.copy(s.odSrcId, s.odFolderId, s.odSrcName || 'קובץ מקורי.xlsm'); }
      catch (e) { log('error', 'העתקת הקובץ המקורי לגיבוי נכשלה: ' + e.message, s); }
      s.odSrcCopied = true;
      await DB.putSurvey(s, false);
    }

    // הסקר נפתח ביום אחר: שומרים קודם את הגרסה הקודמת מהענן, כדי שלא תידרס
    if (s.snapshotFrom) {
      if (s.odDataId) {
        const blob = await OD.download(s.odDataId);
        if (blob) {
          const vf = await OD.folder(s.odFolderId, 'גרסאות קודמות');
          const tag = `לפני עריכה ${s.snapshotFrom.split("-").reverse().join(".")}`;
          await OD.upload(vf, `נתוני סקר - ${tag}.json`, blob, true);
          // גם האקסל וה-PDF שכבר הופקו, כי "סיום סקר" הבא ידרוס אותם באותו שם
          try {
            for (const it of await OD.children(s.odFolderId)) {
              if (it.file && /\.(xlsm|xlsx)$/i.test(it.name)) await OD.copy(it.id, vf, `${tag} - ${it.name}`);
            }
          } catch (e) { log('error', 'העתקת האקסל/PDF לגרסאות קודמות נכשלה: ' + e.message, s); }
          log('info', `נשמרה גרסה קודמת של הסקר (${tag})`, s);
        }
      }
      s.snapshotFrom = null;
      await DB.putSurvey(s, false);
    }

    // תמונות: כל אחת עולה פעם אחת, ומשנה שם אם השם/הפרטים השתנו. תמונות חדשות עולות 3 במקביל (מהיר יותר בקליטה חלשה)
    const jobs = [];
    const used = new Map();
    for (const t of Core.sortTrees(s.trees)) { let k = 1; for (const p of t.photos || []) jobs.push({ t, p, name: photoFileName(t, p, k++, s, used) }); }
    let lost = false;
    const uploadNew = async ({ p, name }) => {
      if (lost || p.odId) return;
      const d = await DB.getPhoto(p.id);
      if (!d || !d.blob) return;
      const ver = p.ver || 0;
      const item = await OD.upload(s.odPhotosId, name, d.blob, false);
      if (!item) { lost = true; return; }
      p.odId = item.id; p.odName = name; p.odVer = ver;
      await DB.putSurvey(s, false);
      emit();
    };
    const fresh = jobs.filter(j => !j.p.odId);
    let nextJob = 0;
    const worker = async () => { while (nextJob < fresh.length) await uploadNew(fresh[nextJob++]); };
    await Promise.all([worker(), worker(), worker()]);
    if (lost) { s.odFolderId = s.odPhotosId = null; await DB.putSurvey(s, false); throw new Error('תיקיית הגיבוי בגוגל דרייב נמחקה, יוצר אותה מחדש'); }
    for (const { p, name } of jobs) {
      if (!p.odId || p.odShared) continue; // תמונה מסקר קודם שנשארת בקובץ של הסקר הקודם: לא נוגעים בה
      if ((p.ver || 0) !== (p.odVer || 0)) {
        // התמונה עודכנה (ציור): מחליפים את הקובץ בגוגל דרייב
        const d = await DB.getPhoto(p.id);
        if (!d || !d.blob) continue;
        const ver = p.ver || 0;
        let item;
        try { item = await OD.replaceContent(p.odId, d.blob); }
        catch (_) { item = await OD.upload(s.odPhotosId, p.odName || name, d.blob, true); } // הקובץ נמחק בגוגל דרייב
        p.odId = item.id || p.odId; p.odVer = ver;
        await DB.putSurvey(s, false);
        emit();
      } else if (p.odName !== name) {
        try { await OD.rename(p.odId, name); } catch (_) { /* שם תפוס: משאירים */ }
        p.odName = name;
        await DB.putSurvey(s, false);
      }
    }

    // הקלטות של מצב הדיבור: כל קטע עולה פעם אחת לתיקייה "הקלטות"
    const recs = (s.recordings || []).filter(r => !r.odId);
    if (recs.length) {
      const rf = await OD.folder(s.odFolderId, 'הקלטות');
      const two = n => String(n).padStart(2, '0');
      for (const r of recs) {
        const d = await DB.getPhoto(r.id);
        if (!d || !d.blob) continue;
        const dt = new Date(r.start);
        const ext = /mp4/.test(r.type) ? 'm4a' : /ogg/.test(r.type) ? 'ogg' : 'webm';
        const name = `הקלטה ${dt.getFullYear()}-${two(dt.getMonth() + 1)}-${two(dt.getDate())} ${two(dt.getHours())}-${two(dt.getMinutes())}-${two(dt.getSeconds())}.${ext}`;
        const item = await OD.upload(rf, name, d.blob, false);
        if (!item) break;
        r.odId = item.id; r.odName = name;
        await DB.putSurvey(s, false);
        emit();
      }
    }

    // מדידה של המודד (סקר לבנייה): הגאומטריה שנקראה מה-DWG, כדי שתיפתח גם במכשיר אחר, וגם קובץ ה-DWG המקורי
    if (s.plan && (!s.plan.odGeoId || !s.plan.odDwgId || !s.plan.odImgId)) {
      const p = s.plan, base = String(p.name || 'מדידה').replace(/[\\/:*?<>|"]+/g, ' ').trim();
      if (!p.odGeoId) {
        const d = await DB.getPhoto('plan:' + p.id);
        if (d && d.geom) {
          const item = await OD.upload(s.odFolderId, `מדידה - ${base}.json`, new Blob([JSON.stringify(d.geom)], { type: 'application/json' }), true);
          if (item && item.id && s.plan === p) { p.odGeoId = item.id; await DB.putSurvey(s, false); }
        }
      }
      if (!p.odDwgId) {
        const d = await DB.getPhoto('plandwg:' + p.id);
        if (d && d.blob) {
          const item = await OD.upload(s.odFolderId, p.file || base + '.dwg', d.blob, true);
          if (item && item.id && s.plan === p) { p.odDwgId = item.id; await DB.putSurvey(s, false); }
        } else p.odDwgId = 'none'; // נטענה במכשיר אחר: הקובץ המקורי כבר שם
      }
      // שרטוט שהוא תמונה (סריקה / צילום)
      if (!p.odImgId) {
        const d = await DB.getPhoto('planimg:' + p.id);
        if (d && d.blob) {
          const item = await OD.upload(s.odFolderId, `מדידה - ${base}.jpg`, d.blob, true);
          if (item && item.id && s.plan === p) { p.odImgId = item.id; await DB.putSurvey(s, false); }
        } else p.odImgId = 'none';
      }
    }

    // נתוני הסקר ושכבת GIS: אחרי כל שינוי (גם מספרי הודעות טלגרם ומזהי תמונות, כדי שמכשיר אחר לא ישלח שוב)
    await pushData(s);
    await updateIndex(s);

    // "סיום סקר": כשכל התמונות כבר בענן, מעלים אקסל ו-PDF לאותה תיקייה ומפנים את התמונות מהטאבלט
    // (אם האקסל וה-PDF עוד מוכנים בטאבלט אחרי הלחיצה, מחכים להם במקום לבנות אותם פעם שנייה)
    if (s.finishPending && allInCloud(s) && !preparing.has(s.id)) {
      await uploadReport(s, { pdf: true });
      s.finishPending = false; s.finished = true; s.finishedAt = Date.now();
      await DB.putSurvey(s, false);
      await pushData(s); // שאר המכשירים יראו מיד שהסקר הסתיים
      await updateIndex(s);
      await freeLocal(s);
      log('ok', 'סיום סקר: אקסל ו-PDF נשמרו בגוגל דרייב, והתמונות פונו מהטאבלט', s);
      emit();
    }
  }

  async function pushData(s) {
    const hash = hashSurvey(s), full = syncHash(s);
    if (s.odDataHash === hash && s.odSyncHash === full) return;
    const text = JSON.stringify(s, null, 1);
    // שני הקבצים עולים במקביל
    const [item] = await Promise.all([
      OD.upload(s.odFolderId, 'נתוני סקר.json', new Blob([text], { type: 'application/json' }), true),
      s.deleted ? null : OD.upload(s.odFolderId, 'שכבת עצים.geojson', new Blob([root.Gis.geojson([s])], { type: 'application/geo+json' }), true)]);
    if (!item) { s.odFolderId = s.odPhotosId = null; await DB.putSurvey(s, false); throw new Error('תיקיית הגיבוי בגוגל דרייב נמחקה, יוצר אותה מחדש'); }
    if (item.id) s.odDataId = item.id;
    s.odDataHash = hash; s.odSyncHash = full;
    if (item.version != null) s.odDataVer = String(item.version);
    await DB.setKV('base:' + s.id, JSON.parse(text)); // מה שבענן עכשיו: הבסיס למיזוג הבא
    await DB.putSurvey(s, false);
  }

  // ---------- סנכרון בין מכשירים (טלפון, טאבלט) ----------
  // כל מכשיר מעלה את נתוני הסקר לקובץ "נתוני סקר.json", ובודק בכל סבב אם מכשיר אחר שינה אותו (מספר הגרסה של הקובץ בגוגל דרייב).
  // אם כן: מיזוג לפי עץ ולפי תמונה מול הבסיס (מה שהיה בענן בפעם האחרונה שהמכשיר הזה סונכרן), כך ששינויים משני המכשירים נשמרים.
  // כששני המכשירים שינו את אותו שדה, העריכה המאוחרת יותר קובעת.
  // שדות של המכשיר הזה בלבד, שלא עוברים בין מכשירים
  const LOCAL_KEYS = new Set(['odDataVer', 'odDataHash', 'odSyncHash', 'odIndexKey', 'updated', 'snapshotFrom', 'finishPending']);
  function syncHash(s) {
    const strip = JSON.stringify(s, (k, v) => (LOCAL_KEYS.has(k) || k.startsWith('_')) ? undefined : v);
    let h = 5381;
    for (let i = 0; i < strip.length; i++) h = ((h << 5) + h + strip.charCodeAt(i)) | 0;
    return String(h >>> 0) + ':' + strip.length;
  }
  const plain = v => v && typeof v === 'object' && !Array.isArray(v);
  // השוואה בלי שדות הגיבוי (od*, tg*) כשdata=true
  function same(a, b, data) {
    if (a === b) return true;
    if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return a == null && b == null;
    const keys = o => Object.keys(o).filter(k => o[k] !== undefined && !k.startsWith('_') && !(data && (k.startsWith('od') || k.startsWith('tg'))));
    const ka = keys(a), kb = keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && same(a[k], b[k], data));
  }
  const byId = (l, r) => Array.isArray(l) && Array.isArray(r) && l.concat(r).every(x => plain(x) && x.id != null);
  // b בסיס, l המכשיר הזה, r הענן. pl: העריכה כאן מאוחרת יותר
  function merge3(b, l, r, pl) {
    if (same(l, r)) return l;
    if (same(l, b)) return r;
    if (same(r, b)) return l;
    if (byId(l, r)) return mergeList(Array.isArray(b) ? b : [], l, r, pl);
    if (plain(l) && plain(r)) {
      const o = {}, bb = plain(b) ? b : {};
      for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
        const v = merge3(bb[k], l[k], r[k], pl);
        if (v !== undefined) o[k] = v;
      }
      return o;
    }
    return pl ? l : r;
  }
  // רשימות לפי מזהה (עצים, תמונות): מה שנוסף באחד המכשירים נכנס, מה שנמחק באחד מהם יוצא (אלא אם נערך במכשיר השני)
  function mergeList(b, l, r, pl) {
    const B = new Map(b.filter(plain).map(x => [x.id, x])), L = new Map(l.map(x => [x.id, x])), R = new Map(r.map(x => [x.id, x]));
    const out = [];
    for (const x of l) {
      if (R.has(x.id)) out.push(merge3(B.get(x.id), x, R.get(x.id), pl));
      else if (!B.has(x.id) || !same(x, B.get(x.id), true)) out.push(x);
    }
    for (const x of r) if (!L.has(x.id) && (!B.has(x.id) || !same(x, B.get(x.id), true))) out.push(x);
    return out;
  }
  function mergeSurvey(base, l, r) {
    const strip = o => { const c = {}; for (const k of Object.keys(o)) if (!LOCAL_KEYS.has(k) && !k.startsWith('_')) c[k] = o[k]; return c; };
    const L = strip(l), R = strip(r);
    // אין בסיס (סקר מלפני הגרסה הזו): אם לא נערך כאן מאז שעלה, הענן קובע. אחרת איחוד של שניהם
    const m = Object.assign({}, !base && l.odDataHash === hashSurvey(l) && l.odSyncHash !== null ? R
      : merge3(base ? strip(base) : undefined, L, R, (l.updated || 0) >= (r.updated || 0)));
    for (const k of Object.keys(l)) if (LOCAL_KEYS.has(k) || k.startsWith('_')) m[k] = l[k];
    m.updated = Math.max(l.updated || 0, r.updated || 0);
    return { merged: m, changed: !same(L, strip(m)), needPush: !same(R, strip(m)) };
  }

  // מוריד את הגרסה מהענן אם מכשיר אחר שינה אותה, וממזג לתוך s (באותו אובייקט, כדי שהמסך הפתוח יראה אותו).
  // מחזיר 'deleted' אם הסקר נמחק במכשיר אחר, 'busy' אם עורכים אותו עכשיו (ננסה בסבב הבא), true אם השתנה
  async function pull(s) {
    if (!s.odDataId || s.deleted) return false;
    const meta = await OD.api('GET', `/files/${s.odDataId}?fields=version,trashed&supportsAllDrives=true`);
    if (!meta || meta.trashed || meta.version == null) return false;
    const ver = String(meta.version);
    if (ver === s.odDataVer) return false;
    const blob = await OD.download(s.odDataId);
    if (!blob) return false;
    const remote = JSON.parse(await blob.text());
    if (!remote || remote.id !== s.id) return false;
    const { merged, changed, needPush } = mergeSurvey(await DB.getKV('base:' + s.id, null), s, remote);
    if (changed && root.App && root.App.isEditing && root.App.isEditing(s.id)) return 'busy';
    const before = new Map(s.trees.flatMap(t => t.photos || []).map(p => [p.id, p]));
    const beforeRec = (s.recordings || []).map(r => r.id);
    if (changed) {
      for (const k of Object.keys(s)) if (!(k in merged)) delete s[k];
      Object.assign(s, merged);
    }
    s.odDataVer = ver;
    if (!needPush) { s.odDataHash = hashSurvey(s); s.odSyncHash = syncHash(s); }
    else s.odSyncHash = null; // יש כאן שינויים שעוד לא בענן: יעלו מיד
    await DB.setKV('base:' + s.id, remote);
    if (s.deleted) { await removeLocal(s, beforeRec); return 'deleted'; }
    if (changed) {
      // תמונות: חדשות ממכשיר אחר נטענות מגוגל דרייב כשצריך; תמונה שצוירה במכשיר אחר מתחלפת; שנמחקו נמחקות גם כאן
      const now = new Set();
      for (const t of s.trees) for (const p of t.photos || []) {
        now.add(p.id);
        const old = before.get(p.id), d = await DB.getPhoto(p.id);
        if (!d) await DB.putPhoto({ id: p.id, thumb: null, w: p.w, h: p.h, cloud: true });
        else if (old && (old.ver || 0) !== (p.ver || 0) && d.blob && p.odId) await DB.putPhoto({ id: p.id, thumb: null, w: p.w, h: p.h, cloud: true });
      }
      for (const id of before.keys()) if (!now.has(id)) await DB.deletePhoto(id);
      const recNow = new Set((s.recordings || []).map(r => r.id));
      for (const id of beforeRec) if (!recNow.has(id)) await DB.deletePhoto(id);
    }
    await DB.putSurvey(s, false);
    if (changed) {
      log('info', 'הסקר עודכן ממכשיר אחר', s);
      if (s.finished) await freeLocal(s);
      if (root.App && root.App.remoteUpdated) root.App.remoteUpdated(s.id);
    }
    return changed;
  }

  async function removeLocal(s, extraIds) {
    for (const t of s.trees || []) for (const p of t.photos || []) await DB.deletePhoto(p.id);
    for (const r of s.recordings || []) await DB.deletePhoto(r.id);
    for (const id of extraIds || []) await DB.deletePhoto(id);
    await DB.deleteSurvey(s.id);
    await DB.delKV('base:' + s.id);
    DB.delKV('pdf:' + s.id).catch(() => {}); DB.delKV('xlsm:' + s.id).catch(() => {});
    if (root.App && root.App.remoteUpdated) root.App.remoteUpdated(s.id, true);
  }

  // סקר שנמחק בטאבלט: המחיקה עוברת לענן (סימון בקובץ ובאינדקס, הקבצים עצמם נשארים בגיבוי), ואז הוא נמחק מהטאבלט
  async function pushDeleted(s) {
    if (s.odDataId && s.odFolderId) { await pushData(s); await updateIndex(s); }
    await removeLocal(s);
  }

  // סקרים שהתחילו או עודכנו היום במכשיר אחר ועוד לא נמצאים כאן, וסקרים שנמחקו במכשיר אחר
  const DISCOVER_DAYS = 14;
  async function discover() {
    const list = await cloudIndex();
    const local = new Map((await DB.allSurveys(true)).map(s => [s.id, s]));
    const since = dayKey(Date.now() - DISCOVER_DAYS * 864e5), td = dayKey(Date.now());
    let added = 0;
    for (const e of list) {
      const l = local.get(e.id);
      if (e.deleted) {
        // נמחק במכשיר אחר: נמחק גם כאן אם לא נערך כאן מאז הסנכרון האחרון
        if (l && !holding.has(e.id) && l.odDataHash === hashSurvey(l)) await removeLocal(l);
        continue;
      }
      if (l || !e.dataId || !e.upd || e.upd < since || (e.finished && e.upd !== td)) continue;
      const meta = await OD.api('GET', `/files/${e.dataId}?fields=version,trashed&supportsAllDrives=true`);
      if (!meta || meta.trashed) continue;
      const b = await OD.download(e.dataId);
      if (!b) continue;
      const s = JSON.parse(await b.text());
      if (!s || s.id !== e.id || s.deleted) continue;
      await DB.setKV('base:' + s.id, JSON.parse(JSON.stringify(s)));
      for (const t of s.trees || []) for (const p of t.photos || []) {
        if (!(await DB.getPhoto(p.id))) await DB.putPhoto({ id: p.id, thumb: null, w: p.w, h: p.h, cloud: true });
      }
      s.odDataVer = String(meta.version); s.odDataHash = hashSurvey(s); s.odSyncHash = syncHash(s); s.finishPending = false;
      await DB.putSurvey(s, false);
      added++;
    }
    if (added) { log('info', `${added} סקרים נוספו ממכשיר אחר`); if (root.App && root.App.remoteUpdated) root.App.remoteUpdated(null); }
  }
  const dayKey = t => { const d = new Date(t || 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  const preparing = new Set(); // סקרים שהאקסל וה-PDF שלהם נבנים עכשיו אחרי "סיום סקר"
  const allInCloud = s => s.trees.every(t => (t.photos || []).every(p => p.odId && (p.ver || 0) === (p.odVer || 0)));

  // מפנה מקום בטאבלט: התמונות המלאות נמחקות (נשארת תמונה ממוזערת), והן נטענות מגוגל דרייב כשצריך
  async function freeLocal(s) {
    const tgOn = !!(await DB.getKV('tgChat', ''));
    for (const t of s.trees) for (const p of t.photos || []) {
      if (!p.odId || (p.ver || 0) !== (p.odVer || 0)) continue;
      if (tgOn && !p.fromOld && (!p.tgMsgId || (p.ver || 0) !== (p.tgVer || 0))) continue;
      const d = await DB.getPhoto(p.id);
      if (d && d.blob) await DB.putPhoto({ id: d.id, thumb: d.thumb, w: d.w, h: d.h, strokes: d.strokes, cloud: true });
    }
  }

  function indexEntry(s) {
    const n = s.trees.filter(Core.hasContent).length;
    return { id: s.id, project: s.project || '', siteName: s.siteName || '', street: s.street || '', city: s.city || '', site: s.site || '',
      code: s.code || '', manager: s.manager || '', date: s.date || '', trees: n, photos: s.trees.reduce((a, t) => a + (t.photos || []).length, 0),
      folderId: s.odFolderId, dataId: s.odDataId || null, finished: !!s.finished, upd: dayKey(s.updated || s.created), deleted: s.deleted ? true : undefined,
      // לתוכנת מעקב ביקורות (בפאי): סקר חדש פותח שם כרטיס עבודה מתוכננת, וסקר שנמחק מוחק אותו
      type: Construction.typeOf(s), created: s.created || undefined, jobId: s.jobId || undefined };
  }

  const BACKUP_ROOT = 'גיבוי אפליקציית סקרי עצים';
  async function backupRoot() { return OD.folder(null, (await DB.getKV('odBackupRoot', BACKUP_ROOT)) || BACKUP_ROOT); }
  async function reportRoot() { return OD.folder(null, (await DB.getKV('odRoot', 'סקרי עצים')) || 'סקרי עצים'); }
  const rootFolder = backupRoot;

  // האינדקס נקרא ונכתב כולו, אז כתיבות לא רצות במקביל (גיבוי רגיל וייבוא) כדי שרשומות לא ילכו לאיבוד
  let indexLock = Promise.resolve();
  function withIndex(fn) { const p = indexLock.then(fn); indexLock = p.catch(() => {}); return p; }
  async function writeIndexEntries(entries) {
    const r = await rootFolder();
    const idx = (await OD.readJson(r, INDEX)) || { surveys: [] };
    const ids = new Set(entries.map(e => e.id));
    idx.surveys = (idx.surveys || []).filter(x => !ids.has(x.id)).concat(entries);
    await OD.upload(r, INDEX, new Blob([JSON.stringify(idx)], { type: 'application/json' }), true);
  }
  async function updateIndex(s) {
    if (!s.odDataId) return;
    const e = indexEntry(s), key = JSON.stringify(e);
    if (s.odIndexKey === key) return;
    await withIndex(() => writeIndexEntries([e]));
    s.odIndexKey = key;
    await DB.putSurvey(s, false);
  }

  // ייבוא סקר ישן ישר לגיבוי בגוגל דרייב, בלי לשמור אותו בטאבלט (אלפי סקרים לא נכנסים לזיכרון של הדפדפן).
  // src: {blob} קובץ מהמחשב, או {odId} קובץ שכבר נמצא בגוגל דרייב (מועתק שם, בלי הורדה נוספת).
  // מחזיר את הרשומה לאינדקס; האינדקס עצמו נכתב בקבוצות (flushImported)
  const projCache = new Map();
  // שני קבצים של אותו מוסד ואותו תאריך לא נשמרים במקביל, כדי שכל אחד יקבל תיקייה משלו
  const importLocks = new Map();
  function importSurvey(s, src) {
    const key = (s.project || '') + '|' + folderBase(s);
    const p = (importLocks.get(key) || Promise.resolve()).catch(() => {}).then(() => importSurvey0(s, src));
    importLocks.set(key, p);
    return p;
  }
  async function importSurvey0(s, src) {
    const pk = s.project || 'ללא פרויקט';
    // ייבוא רץ כמה קבצים במקביל: שומרים את ההבטחה עצמה, כדי שאותה תיקייה לא תיווצר פעמיים
    if (!projCache.has('')) projCache.set('', backupRoot());
    if (!projCache.has(pk)) projCache.set(pk, projCache.get('').then(r => OD.folder(r, pk)));
    let proj;
    try { proj = await projCache.get(pk); } catch (e) { projCache.delete(pk); projCache.delete(''); throw e; }
    for (let k = 1; ; k++) {
      const id = await OD.folder(proj, k > 1 ? `${folderBase(s)} - ${k}` : folderBase(s));
      const other = await OD.readJson(id, 'נתוני סקר.json');
      if (!other || other.id === s.id) { s.odFolderId = id; s.odFolderK = k; break; }
    }
    const name = src.name || 'קובץ מקורי.xlsx';
    if (src.blob) await OD.upload(s.odFolderId, name, src.blob, true);
    else if (src.odId) await OD.copy(src.odId, s.odFolderId, name);
    s.odSrcCopied = true;
    const item = await OD.upload(s.odFolderId, 'נתוני סקר.json', new Blob([JSON.stringify(s, null, 1)], { type: 'application/json' }), true);
    if (!item || !item.id) throw new Error('שמירת נתוני הסקר בגוגל דרייב נכשלה');
    s.odDataId = item.id;
    if (s.trees.some(t => t.lat)) await OD.upload(s.odFolderId, 'שכבת עצים.geojson', new Blob([root.Gis.geojson([s])], { type: 'application/geo+json' }), true);
    s.odDataHash = hashSurvey(s);
    return indexEntry(s);
  }
  function flushImported(entries) { return entries.length ? withIndex(() => writeIndexEntries(entries)) : Promise.resolve(); }

  // הגדרות משותפות לכל המכשירים (טוקן הטלגרם והצ'אט), בקובץ בתיקיית הגיבוי בגוגל דרייב.
  // מה שעודכן אחרון (בטאבלט או בענן) הוא שקובע
  const SETTINGS = 'הגדרות משותפות.json';
  let settingsSynced = false, settingsAt = 0; // נבדק שוב כל 3 דקות, כדי ששינוי במכשיר אחר יגיע גם בלי לפתוח מחדש
  async function syncSettings() {
    const r = await backupRoot();
    const cloud = (await OD.readJson(r, SETTINGS)) || {};
    const local = { tgToken: await DB.getKV('tgToken', ''), tgChat: await DB.getKV('tgChat', ''), tgChatName: await DB.getKV('tgChatName', ''), tgUpdated: await DB.getKV('tgUpdated', 0) };
    if ((cloud.tgUpdated || 0) > local.tgUpdated) {
      for (const k of ['tgToken', 'tgChat', 'tgChatName', 'tgUpdated']) await DB.setKV(k, cloud[k] != null ? cloud[k] : '');
      log('info', cloud.tgToken ? 'הגדרות הטלגרם נטענו מהענן' : 'הטלגרם נותק במכשיר אחר');
    } else if (local.tgUpdated > (cloud.tgUpdated || 0) || (!cloud.tgUpdated && local.tgToken)) {
      if (!local.tgUpdated) { local.tgUpdated = Date.now(); await DB.setKV('tgUpdated', local.tgUpdated); }
      await OD.upload(r, SETTINGS, new Blob([JSON.stringify(Object.assign(cloud, local))], { type: 'application/json' }), true);
    }
    // מפתח Gemini (מצב דיבור): אותו מפתח בכל המכשירים, האחרון שנשמר מנצח
    const gk = await DB.getKV('geminiKey', ''), gu = await DB.getKV('geminiUpdated', 0);
    if ((cloud.geminiUpdated || 0) > gu) {
      await DB.setKV('geminiKey', cloud.geminiKey || ''); await DB.setKV('geminiUpdated', cloud.geminiUpdated);
      log('info', cloud.geminiKey ? 'מפתח Gemini נטען מהענן' : 'מפתח Gemini נמחק במכשיר אחר');
    } else if (gu > (cloud.geminiUpdated || 0) || (!cloud.geminiUpdated && gk)) {
      // מפתח שהוכנס לפני שהיה סנכרון (בלי זמן עדכון): עולה לענן עכשיו
      const at = gu || Date.now();
      if (!gu) await DB.setKV('geminiUpdated', at);
      await OD.upload(r, SETTINGS, new Blob([JSON.stringify(Object.assign(cloud, { geminiKey: gk, geminiUpdated: at }))], { type: 'application/json' }), true);
    }
    await syncLists(r, cloud);
    await Sig.sync(r).catch(() => {}); // החתימה והחותמת, שלא נמצאות באתר הציבורי
    settingsSynced = true; settingsAt = Date.now();
  }

  // רשימות הבחירה מההגדרות (מיני עצים, הערות בטיחות, הערות בנייה): אותן רשימות בכל המכשירים.
  // מה שנשמר אחרון מנצח. מכשיר שעוד לא סונכרן אף פעם מאחד את הרשימות שלו עם הענן, כדי שלא יאבד כלום
  const LIST_KEYS = ['species', 'phrases', 'constructionNotes'];
  async function syncLists(r, cloud) {
    const local = {};
    for (const k of LIST_KEYS) local[k] = await DB.getKV(k, null);
    const lu = await DB.getKV('listsUpdated', 0), cu = cloud.listsUpdated || 0, cl = cloud.lists || null;
    const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
    let take = null, up = null;
    if (cl && cu > lu) {
      if (lu) take = cl;
      else {
        const merged = {};
        for (const k of LIST_KEYS) merged[k] = cl[k] || local[k] ? [...new Set([...(cl[k] || []), ...(local[k] || [])])] : null;
        take = merged;
        if (LIST_KEYS.some(k => !same(merged[k], cl[k]))) up = merged;
      }
    } else if (lu > cu || (!cl && LIST_KEYS.some(k => local[k]))) up = local;
    if (take) {
      const changed = LIST_KEYS.some(k => !same(take[k], local[k]));
      for (const k of LIST_KEYS) if (!same(take[k], local[k])) await DB.setKV(k, take[k]);
      await DB.setKV('listsUpdated', up ? Date.now() : cu);
      if (changed) { log('info', 'רשימות הבחירה (מינים והערות) עודכנו ממכשיר אחר'); if (root.App && root.App.listsUpdated) root.App.listsUpdated(); }
    }
    if (up) {
      const at = take ? await DB.getKV('listsUpdated', Date.now()) : lu || Date.now();
      if (!take && !lu) await DB.setKV('listsUpdated', at);
      cloud.lists = up; cloud.listsUpdated = at;
      await OD.upload(r, SETTINGS, new Blob([JSON.stringify(cloud)], { type: 'application/json' }), true);
    }
  }

  // סקר מלא לפי רשומה באינדקס: מהטאבלט אם הוא שם, אחרת מגוגל דרייב
  async function loadSurvey(e) {
    const local = await DB.getSurvey(e.id);
    if (local) return local;
    if (!e.dataId) return null;
    const b = await OD.download(e.dataId);
    return b ? JSON.parse(await b.text()) : null;
  }

  async function cloudIndex() {
    const r = await rootFolder();
    const idx = (await OD.readJson(r, INDEX)) || { surveys: [] };
    return idx.surveys || [];
  }

  // ---------- ייעוד העצים (סטטוס מוצע, BC) בין האפליקציה לאקסל שבתיקיית הדוחות (1.81.0) ----------
  // האקסל הזה הוא מה שנפתח במחשב (גוגל דרייב במחשב) ומה ש-TREES ב-BricsCAD קורא וכותב אליו.
  // משיכה: האקסל השתנה מאז הפעם הקודמת (modifiedTime > s.xlSeen) -> עץ שהייעוד שלו באקסל השתנה (מול s.xlSnap,
  // הייעוד האחרון שידוע שהיה באקסל) מקבל אותו, אם לא שונה באפליקציה אחרי השמירה של האקסל (t.statusAt).
  // דחיפה: עץ שהייעוד שלו באפליקציה שונה ממה שבאקסל -> רק התאים בעמודה BC משתנים בקובץ, ושאר הקובץ נשאר כמו שהוא
  const xlBusy = new Map();
  const XL_TYPE = 'application/vnd.ms-excel.sheet.macroEnabled.12';
  function xlStatus(s, push = true) {
    if (xlBusy.has(s.id)) return xlBusy.get(s.id);
    const p = xlStatusRun(s, push).finally(() => xlBusy.delete(s.id));
    xlBusy.set(s.id, p);
    return p;
  }
  // האקסל של הסקר בגוגל דרייב. ori מעביר את קבצי הסקר מתיקיית "סקרי עצים" לתיקיות אחרות, משנה שמות ועובד גם משולחן העבודה, ולכן:
  // 1. לפי המזהים (נשאר אותו מזהה כשמעבירים קובץ בתוך גוגל דרייב), כולל קבצים שבחרו ידנית (s.xlPin)  2. בתיקיית הדוחות לפי השם
  // 3. כל 10 דקות: כל העותקים שמסומנים בסימון של הסקר (CA1, מאקסלים מ-1.82), בכל שם ובכל תיקייה. אם אין אף קובץ:
  //    חיפוש לפי השם המדויק, רק קובץ שהתאריך בו (Q1) הוא תאריך הסקר (לסקרים באותה כתובת יש אותו שם קובץ).
  // לא העותק שבתיקיית הגיבוי של האפליקציה, ולא קבצים שהוסרו ידנית (s.xlSkip)
  const xlSearchAt = new Map();
  const xlShape = j => ({ id: j.id, name: j.name, lastModifiedDateTime: j.modifiedTime, parents: j.parents });
  const XL_FIELDS = 'id,name,modifiedTime,trashed,parents';
  async function xlFiles(s, base) {
    const names = [base + '.xlsm', base + ' - טבלאות.xlsm'].map(n => OD.clean(n));
    const skip = new Set(s.xlSkip || []);
    let out = [];
    for (const id of new Set([...(s.xlPin || []), ...(s.xlIds || [])])) {
      if (skip.has(id)) continue;
      const j = await OD.api('GET', `/files/${id}?fields=${XL_FIELDS}&supportsAllDrives=true`).catch(() => null);
      if (j && !j.trashed) out.push(xlShape(j));
    }
    if (!out.length && s.odReportDir) for (const n of names) { const f = await OD.findFile(s.odReportDir, n).catch(() => null); if (f && !skip.has(f.id)) out.push(f); }
    if (Date.now() - (xlSearchAt.get(s.id) || 0) > (out.length ? 600000 : 120000)) {
      xlSearchAt.set(s.id, Date.now());
      const lit = v => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
      const want = s.date ? root.Construction.dateSerial(s.date) : null;
      const ok = j => !(j.parents || []).includes(s.odFolderId) && !skip.has(j.id);
      // רק xlsm (קובצי "טעינת עצים ... .xlsx" ל"יעלה" הם לא הסקר)
      const marked = await OD._list(`fullText contains ${lit(root.Construction.markOf(s))} and mimeType = '${XL_TYPE}' and trashed = false`, { orderBy: 'modifiedTime desc', pageSize: '10', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', fields: 'nextPageToken,files(id,name,modifiedTime,parents)' }, 1).catch(() => []);
      for (const j of marked.filter(ok).slice(0, 4)) out.push(xlShape(j));
      if (!out.length)
      for (const n of names) {
        const l = await OD._list(`name = ${lit(n)} and trashed = false`, { orderBy: 'modifiedTime desc', pageSize: '10', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', fields: 'nextPageToken,files(id,name,modifiedTime,parents)' }, 1).catch(() => []);
        for (const j of l.filter(ok).slice(0, 3)) {
          const b = await OD.download(j.id).catch(() => null);
          const x = b && await root.Construction.readStatuses(new Uint8Array(await b.arrayBuffer())).catch(() => null);
          if (x && (x.date == null || want == null || Math.floor(x.date) === want)) { out.push(xlShape(j)); break; }
        }
      }
    }
    out = out.filter((f, i) => out.findIndex(g => g.id === f.id) === i);
    s.xlIds = out.map(f => f.id);
    return out;
  }
  // כמה עותקים של האקסל (תיקיית הדוחות, שולחן העבודה, תיקיית הלקוח): קוראים כל עותק שהשתנה מאז הפעם האחרונה
  // (מהישן לחדש, כך שהשינוי האחרון גובר), ואז כותבים את אותו ייעוד לכל העותקים.
  // s.xlOk: מזהה קובץ -> זמן השינוי שלו כשהיה מעודכן אצלנו. s.xlDirty: יש עותקים שאולי לא מעודכנים
  async function xlStatusRun(s, push) {
    if (!hasXl(s) || !root.App || !root.App.fileBase) return false;
    const C = root.Construction, st = C.settingsOf(s), base = root.App.fileBase(s);
    const found = await xlFiles(s, base);
    if (!found.length) return false;
    const modOf = f => Date.parse(f.lastModifiedDateTime) || 0;
    const trees = s.trees.filter(t => Core.hasContent(t) && !t.ref && String(t.num || '').trim());
    const key = t => Core.normNum(String(t.num).trim());
    const before = JSON.stringify([s.xlIds, s.xlOk, s.xlSnap, s.xlDirty]);
    const ok = s.xlOk = s.xlOk || {};
    const got = new Map();   // file id -> bytes שכבר הורדו
    const snap = s.xlSnap;
    const keys = new Set(Object.keys(snap || {}));
    let pulled = 0, pushed = 0, read = 0;
    const toRead = found.filter(f => ok[f.id] !== modOf(f)).sort((a, b) => modOf(a) - modOf(b));
    for (const f of toRead) {
      const blob = await OD.download(f.id).catch(() => null);
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      got.set(f.id, bytes);
      const xl = await C.readStatuses(bytes).catch(() => null);
      const fresh = f.id in ok;
      ok[f.id] = modOf(f);
      if (!xl) continue;
      read++;
      const mod = modOf(f);
      // עותק שעוד לא סונכרן (נמצא עכשיו או נבחר ידנית) וישן מהסנכרון האחרון: לא לוקחים ממנו (ערכים ישנים), רק כותבים אליו
      if (!fresh && mod <= (s.xlSeen || 0)) { for (const t of trees) if (xl.has(key(t))) keys.add(key(t)); continue; }
      for (const t of trees) {
        const k = key(t);
        if (!xl.has(k)) continue;
        keys.add(k);
        const v = xl.get(k);
        if (v === C.statusOf(t, st)) continue;
        // שונה באקסל מאז שכתבנו אליו. בלי תמונת מצב (אקסל ממולא לפני 1.81, או עץ שלא היה בה): רק תאים שמולאו
        const inExcel = snap && k in snap ? snap[k] !== v : !!v;
        if (inExcel && (t.statusAt || 0) < mod) { t.status = v; t.statusAt = mod; pulled++; }
      }
    }
    const full = new Map(trees.filter(t => keys.has(key(t))).map(t => [key(t), C.statusOf(t, st)]));
    const diff = !snap || [...full].some(([k, v]) => snap[k] !== v);
    if (read || diff) s.xlDirty = true;
    if (push && s.xlDirty && full.size) {
      let all = true;
      for (const f of found) {
        let b = got.get(f.id);
        if (!b) { const x = await OD.download(f.id).catch(() => null); if (!x) { all = false; continue; } b = new Uint8Array(await x.arrayBuffer()); }
        const out = await C.patchStatuses(b, full);
        if (!out) continue;
        try { await OD.replaceContent(f.id, new Blob([out], { type: XL_TYPE })); }
        catch (e) { all = false; log('error', `כתיבת הייעוד ל"${f.name}" נכשלה: ${e.message}`, s); continue; }
        const meta = await OD.api('GET', `/files/${f.id}?fields=modifiedTime&supportsAllDrives=true`).catch(() => null);
        ok[f.id] = (meta && Date.parse(meta.modifiedTime)) || 0;
        pushed++;
      }
      if (all) s.xlDirty = false;
    }
    if (full.size) s.xlSnap = Object.fromEntries(full);
    s.xlSeen = Math.max(0, ...found.map(f => ok[f.id] || 0));
    for (const id of Object.keys(ok)) if (!s.xlIds.includes(id)) delete ok[id];
    if (pulled || JSON.stringify([s.xlIds, s.xlOk, s.xlSnap, s.xlDirty]) !== before) await DB.putSurvey(s, !!pulled);
    if (pulled) log('ok', `ייעוד ${pulled} עצים עודכן מהאקסל`, s);
    if (pushed) log('ok', pushed > 1 ? `הייעוד נכתב ל-${pushed} עותקי האקסל בגוגל דרייב` : 'הייעוד נכתב לאקסל בגוגל דרייב', s);
    if (pulled && root.App && root.App.remoteUpdated) root.App.remoteUpdated(s.id, false, `ייעוד ${pulled} עצים עודכן מהאקסל`);
    return { pulled, pushed };
  }

  // מיידי (ori, 1.83.0: עובדים מהאפליקציה, והאקסל הוא גיבוי שצריך להיות תמיד מעודכן):
  // שינוי ייעוד באפליקציה נכתב לאקסל אחרי שנייה, ובסקר הפתוח בודקים כל 15 שניות אם האקסל השתנה (בקשה קטנה: רק זמן השינוי)
  const hasXl = s => isBuild(s) && !!(s.odReportDir || (s.xlIds || []).length || (s.xlPin || []).length);
  let xlPushT = null;
  function statusChanged(s) {
    clearTimeout(xlPushT);
    xlPushT = setTimeout(async () => {
      if (!hasXl(s) || !navigator.onLine || !(await OD.connected().catch(() => false))) return;
      try { await locked(s.id, () => xlStatus(s)); }
      catch (e) { log('error', 'כתיבת הייעוד לאקסל נכשלה: ' + e.message, s); }
    }, 1000);
  }
  async function xlPoll() {
    const s = root.App && root.App.current && root.App.current();
    if (!s || !hasXl(s) || !navigator.onLine || document.hidden || xlBusy.has(s.id)) return;
    if (!(await OD.connected().catch(() => false))) return;
    let changed = !(s.xlIds || []).length || !!s.xlDirty;
    const ok = s.xlOk || {};
    for (const id of s.xlIds || []) {
      const j = await OD.api('GET', `/files/${id}?fields=modifiedTime,trashed&supportsAllDrives=true`).catch(() => null);
      if (!j || j.trashed || (Date.parse(j.modifiedTime) || 0) !== ok[id]) changed = true;
    }
    if (changed) { try { await locked(s.id, () => xlStatus(s)); } catch (_) {} }
  }
  setInterval(() => { xlPoll().catch(() => {}); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) xlPoll().catch(() => {}); });

  // אקסל (ואם ביקשו גם PDF) לתיקיית הסקר בגוגל דרייב, באותו שם
  async function uploadReport(s, opts) {
    await syncFolders(s);
    // סקר לבנייה: קודם הייעוד שנכתב באקסל או ב-BricsCAD, כדי שהאקסל החדש לא ימחק אותו
    if (isBuild(s)) await xlStatus(s, false).catch(e => log('error', 'קריאת הייעוד מהאקסל נכשלה: ' + e.message, s));
    // יש עצים או תחומים "לא להתייחסות": עולה רק הגרסה הנקייה (הם נשמרים בסקר באפליקציה בלבד)
    const twoSets = root.App.hasRef(s);
    const clean = twoSets ? Object.assign({}, s, { inclRef: false }) : s;
    // האקסל וה-PDF שהוכנו כבר בלחיצה על "סיום סקר" (בזמן שהתמונות עלו), אם הסקר לא השתנה מאז
    const hash = hashSurvey(s);
    const ready = await DB.getKV('xlsm:' + s.id, null);
    const r = !twoSets && ready && ready.hash === hash && ready.blob ? ready : await root.App.buildReport(clean);
    await putReportFile(s, r.name, r.blob);
    // הייעוד שבאקסל עכשיו = מה שבאפליקציה
    if (isBuild(s)) {
      const st = root.Construction.settingsOf(s);
      s.xlSnap = Object.fromEntries(s.trees.filter(t => Core.hasContent(t) && !t.ref && String(t.num || '').trim())
        .map(t => [Core.normNum(String(t.num).trim()), root.Construction.statusOf(t, st)]));
      // האקסל החדש בתיקיית הדוחות כבר מעודכן. שאר העותקים (שולחן העבודה, עותקים שהועברו) יעודכנו בסבב הבא
      const fresh = s.odReportDir ? await OD.findFile(s.odReportDir, OD.clean(r.name)).catch(() => null) : null;
      s.xlIds = [...new Set([...(fresh ? [fresh.id] : []), ...(s.xlIds || [])])].filter(id => !(s.xlSkip || []).includes(id));
      s.xlOk = fresh ? { [fresh.id]: Date.parse(fresh.lastModifiedDateTime) || 0 } : {};
      s.xlDirty = true;
    }
    DB.delKV('xlsm:' + s.id).catch(() => {});
    s.odReportHash = hashSurvey(s); s.odReportAt = Date.now();
    log('ok', 'האקסל נשמר בגוגל דרייב', s);
    // סקר לבנייה: גם קובץ המדידה והסימונים עליה (נקי, ואם יש גם המלא), כדי להמשיך לעבוד במחשב
    try {
      for (const f of await root.App.planFiles(s)) await putReportFile(s, f.name, f.blob);
    } catch (e) { log('error', 'קובץ המדידה לא עלה: ' + e.message, s); }
    let pdf = null;
    if (opts && opts.pdf) {
      const last = await DB.getKV('pdf:' + s.id, null);
      pdf = !twoSets && last && last.hash === hash && last.blob ? last : await root.App.buildPdf(clean);
    }
    if (pdf) await uploadPdf(s, pdf);
    await DB.putSurvey(s, false);
  }
  async function uploadPdf(s, pdf) {
    await syncFolders(s);
    await putReportFile(s, pdf.name, pdf.blob);
    s.odPdfAt = Date.now();
    log('ok', 'ה-PDF נשמר בגוגל דרייב', s);
    await DB.putSurvey(s, false);
  }

  function countPending(surveys, tgOn, odOn) {
    let tg = 0, od = 0;
    for (const s0 of surveys) {
      const s = live(s0);
      if (s.deleted) { if (odOn) od++; continue; }
      for (const t of s.trees) for (const p of t.photos || []) {
        if (tgOn && !p.fromOld && (!p.tgMsgId || (p.ver || 0) !== (p.tgVer || 0))) tg++;
        if (odOn && (!p.odId || (p.ver || 0) !== (p.odVer || 0))) od++;
      }
      if (odOn && s.trees.length && (s.odDataHash !== hashSurvey(s) || (s.odSyncHash !== syncHash(s) && s.odDataId))) od++;
      if (odOn && s.finishPending) od++;
    }
    state.tgPending = tg; state.odPending = od;
  }

  let stopped = false; // אחרי כיבוי: לא מגבים יותר עד שהאפליקציה נפתחת מחדש
  function stop() { stopped = true; clearTimeout(timer); }
  const holding = new Map();
  // גוגל דרייב של סקר אחד לא רץ פעמיים במקביל (סבב הגיבוי ו"סיום סקר" שרץ מיד, בלי לחכות לסבב)
  const odLocks = new Map(); let current = null;
  function locked(id, fn) {
    const p = (odLocks.get(id) || Promise.resolve()).catch(() => {}).then(fn);
    odLocks.set(id, p);
    p.catch(() => {}).finally(() => { if (odLocks.get(id) === p) odLocks.delete(id); });
    return p;
  }
  // "סיום סקר": מעלים את הסקר הזה מיד, בלי לחכות שסבב הגיבוי יסיים סקרים אחרים ותמונות לטלגרם
  async function finishNow(id) {
    if (stopped || !navigator.onLine || state.odNeedsLogin || !(await OD.connected())) return;
    const s = (root.App && root.App.live(id)) || holding.get(id) || await DB.getSurvey(id);
    if (!s || !s.finishPending) return;
    holding.set(id, s);
    try {
      // כשהסבב עובד עכשיו על הסקר הזה, הוא כבר משך ממכשירים אחרים (ושולח לטלגרם על אותו עותק): לא מושכים שוב
      if (!(running && current === id)) {
        const r = await locked(id, () => pull(s));
        if (r === 'busy' || r === 'deleted') return; // שינוי ממכשיר אחר שעוד לא נכנס: הסבב הרגיל ימשיך
      }
      await locked(id, () => syncOneDrive(s));
    } catch (e) {
      if (e instanceof OD.AuthError) state.odNeedsLogin = true;
      else { state.error = 'גוגל דרייב: ' + e.message; log('error', state.error, s); }
    } finally {
      if (!(running && current === id)) holding.delete(id);
      emit();
      if (root.App && root.App.onSynced) root.App.onSynced();
    }
  }
  const xlAt = new Map();
  const pulledAt = new Map(); let discoveredAt = 0; // בדיקת שינויים ממכשירים אחרים: לא יותר מפעם בדקה
  async function run() {
    if (stopped) return;
    if (running) { again = true; return; }
    running = true; again = false;
    state.busy = true; state.error = ''; state.offline = !navigator.onLine; emit();
    try {
      if ((!settingsSynced || Date.now() - settingsAt > 180000) && !state.offline && (await OD.connected())) {
        try { await syncSettings(); } catch (e) { if (e instanceof OD.AuthError) state.odNeedsLogin = true; }
      }
      const token = await DB.getKV('tgToken', ''), chat = await DB.getKV('tgChat', '');
      const tgOn = !!(token && chat);
      const odOn = (await OD.connected()) && !!(await OD.clientId());
      let surveys = await DB.allSurveys(true);
      countPending(surveys, tgOn, odOn); emit();
      if (state.offline || (!tgOn && !odOn)) return;
      // סקרים חדשים או מחוקים ממכשירים אחרים
      if (odOn && !state.odNeedsLogin && Date.now() - discoveredAt > 60000) {
        discoveredAt = Date.now();
        try { await discover(); surveys = await DB.allSurveys(true); }
        catch (e) { if (e instanceof OD.AuthError) state.odNeedsLogin = true; else log('error', 'בדיקת סקרים ממכשירים אחרים נכשלה: ' + e.message); }
      }
      let busy = false;
      // הסקר הפתוח קודם
      surveys.sort((a, b) => (live(b) !== b) - (live(a) !== a) || (b.updated || 0) - (a.updated || 0));
      for (const s0 of surveys) {
        // העותק העדכני: הסקר הפתוח, ואם הוא לא פתוח — מה שבטאבלט עכשיו (ייתכן שנערך אחרי תחילת הסבב)
        const s = live(s0) !== s0 ? live(s0) : holding.get(s0.id) || (await DB.getSurvey(s0.id)) || s0;
        // סקר שנפתח בזמן שהוא עולה: האפליקציה עובדת על אותו עותק, כדי שהשמירות של הגיבוי לא ידרסו עריכות
        holding.set(s.id, s); current = s.id;
        if (s.deleted) {
          if (odOn && !state.odNeedsLogin) {
            try { await pushDeleted(s); }
            catch (e) { if (e instanceof OD.AuthError) state.odNeedsLogin = true; else { state.error = 'גוגל דרייב: ' + e.message; log('error', state.error, s); } }
          } else if (!s.odDataId) await removeLocal(s);
          holding.delete(s.id);
          continue;
        }
        // קודם מושכים שינויים ממכשיר אחר (לפני הטלגרם, כדי לא לשלוח שוב תמונה שכבר נשלחה משם, ולפני ההעלאה, כדי לא לדרוס אותם)
        // (סקר פתוח: בכל סבב. השאר: פעם בדקה, ורק סקרים פתוחים או מהשבועיים האחרונים; ישן נבדק כשפותחים אותו)
        const recent = !s.finished || Date.now() - (s.updated || 0) < DISCOVER_DAYS * 864e5;
        if (odOn && !state.odNeedsLogin && (live(s) === s || (recent && Date.now() - (pulledAt.get(s.id) || 0) > 60000))) {
          pulledAt.set(s.id, Date.now());
          let r = false;
          try { r = await locked(s.id, () => pull(s)); }
          catch (e) {
            if (e instanceof OD.AuthError) state.odNeedsLogin = true;
            else { log('error', 'משיכת עדכונים ממכשיר אחר נכשלה: ' + e.message, s); r = 'busy'; }
          }
          if (r === 'deleted' || r === 'busy') { if (r === 'busy') busy = true; holding.delete(s.id); continue; }
        }
        // סקר לבנייה עם אקסל בתיקיית הדוחות: ייעוד העצים לשני הכיוונים (הסקר הפתוח בכל סבב, השאר פעם ב-3 דקות, עד 90 יום)
        if (odOn && !state.odNeedsLogin && hasXl(s) && !s.finishPending
          && (live(s) === s || (Date.now() - (s.updated || 0) < 90 * 864e5 && Date.now() - (xlAt.get(s.id) || 0) > 170000))) {
          xlAt.set(s.id, Date.now());
          try { await locked(s.id, () => xlStatus(s)); }
          catch (e) { if (e instanceof OD.AuthError) state.odNeedsLogin = true; else log('error', 'סנכרון הייעוד עם האקסל נכשל: ' + e.message, s); }
        }
        // טלגרם וגוגל דרייב במקביל: "סיום סקר" לא מחכה שכל התמונות יישלחו קודם לטלגרם
        await Promise.all([
          tgOn && (async () => {
            try { await syncTelegram(s, { token, chat }); }
            catch (e) { state.error = 'טלגרם: ' + e.message; log('error', state.error, s); }
          })(),
          odOn && !state.odNeedsLogin && (async () => {
            try { await locked(s.id, () => syncOneDrive(s)); }
            catch (e) {
              if (e instanceof OD.AuthError) { state.odNeedsLogin = true; log('error', 'גוגל דרייב: צריך להתחבר מחדש', s); }
              else { state.error = 'גוגל דרייב: ' + e.message; log('error', state.error, s); }
            }
          })()]);
        holding.delete(s.id);
      }
      surveys = await DB.allSurveys(true);
      countPending(surveys, tgOn, odOn);
      if (busy) state.odPending++;
      if (!state.error && !state.odNeedsLogin && !state.tgPending && !state.odPending) { state.lastOk = Date.now(); DB.setKV('syncLastOk', state.lastOk); }
    } catch (e) {
      state.error = e.message;
      log('error', 'שגיאה כללית בגיבוי: ' + e.message);
    } finally {
      holding.clear(); current = null;
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

  root.Sync = { stop, importSurvey, flushImported, preparing,
    _xlStatus: (s, push) => xlStatus(s, push), statusChanged,
    // עותקי האקסל שהסקר מסונכרן איתם (לתצוגה בלשונית ההפקה). search: לחפש עכשיו גם עותקים מסומנים בכל הדרייב
    async xlLinked(s, search) {
      if (!hasXl(s) || !root.App || !root.App.fileBase) return [];
      if (search) xlSearchAt.delete(s.id);
      return locked(s.id, async () => { const l = await xlFiles(s, root.App.fileBase(s)); await DB.putSurvey(s, false); return l; });
    },
    // ori בוחר קובץ אקסל (למשל העותק בשולחן העבודה ש-BricsCAD עובד איתו): מעכשיו האפליקציה קוראת וכותבת גם אליו
    async xlPin(s, id) {
      s.xlPin = [...new Set([id, ...(s.xlPin || [])])];
      s.xlSkip = (s.xlSkip || []).filter(x => x !== id);
      s.xlIds = [...new Set([id, ...(s.xlIds || [])])];
      if (s.xlOk) delete s.xlOk[id];   // נקרא פעם אחת (שינויים שנעשו בו ב-BricsCAD), ואז מקבל את הייעוד של האפליקציה
      s.xlDirty = true;
      await DB.putSurvey(s, false);
      return locked(s.id, () => xlStatus(s));
    },
    // לפני שמחברים קובץ: האם זה באמת אקסל של הסקר הזה (גיליון "סקר", תאריך, כמה ממספרי העצים קיימים בו)
    async xlCheck(s, id) {
      const b = await OD.download(id);
      const xl = b && await root.Construction.readStatuses(new Uint8Array(await b.arrayBuffer())).catch(() => null);
      if (!xl) return { survey: false };
      const nums = s.trees.filter(t => Core.hasContent(t) && !t.ref && String(t.num || '').trim()).map(t => Core.normNum(String(t.num).trim()));
      const want = s.date ? root.Construction.dateSerial(s.date) : null;
      return { survey: true, dateOk: xl.date == null || want == null || Math.floor(xl.date) === want,
        matched: nums.filter(n => xl.has(n)).length, total: nums.length };
    },
    async xlUnpin(s, id) {
      s.xlPin = (s.xlPin || []).filter(x => x !== id);
      s.xlSkip = [...new Set([id, ...(s.xlSkip || [])])];
      s.xlIds = (s.xlIds || []).filter(x => x !== id);
      if (s.xlOk) delete s.xlOk[id];
      await DB.putSurvey(s, false);
    },
    // ייעוד מהאקסל שבגוגל דרייב לפני הפקה במכשיר (בלי לחכות יותר מכמה שניות)
    async pullStatus(s) {
      if (!hasXl(s) || !navigator.onLine || !(await OD.connected())) return null;
      return Promise.race([xlStatus(s, false).catch(() => null), new Promise(r => setTimeout(r, 6000))]);
    },
    // ה-PDF של הסקר מתיקיית הדוחות בגוגל דרייב, אם הועלה אחרי השינוי האחרון בסקר (אחרת null ובונים מחדש)
    async cloudPdf(s, name) {
      if (!s.odReportDir || !s.odPdfAt || s.odPdfAt < (s.updated || 0) || !navigator.onLine || !(await OD.connected())) return null;
      const f = await OD.findFile(s.odReportDir, name).catch(() => null);
      return f ? OD.download(f.id).catch(() => null) : null;
    },
    holding: id => holding.get(id) || null,
    kick, state,
    now() { state.odNeedsLogin = false; schedule(0); },
    finishNow(id) { state.odNeedsLogin = false; finishNow(id); schedule(0); },
    // פעולות ידניות: עובדות על הסקר הפתוח ומחכות לסיום
    async uploadReport(s) { await syncFolders(s); await uploadReport(s, { pdf: false }); },
    async uploadPdf(s, pdf) { await syncFolders(s); await uploadPdf(s, pdf); },
    // קובץ נוסף לתיקיית הדוחות (למשל טבלאות ותמונות בנפרד בסקר לבנייה)
    async uploadFile(s, name, blob) {
      await syncFolders(s); await putReportFile(s, name, blob); log('ok', name + ' נשמר בגוגל דרייב', s); await DB.putSurvey(s, false);
      const folderId = await reportFolder(s);
      return { folderId, path: await reportPath(s) };
    },
    reportPath,
    cloudIndex, allInCloud, freeLocal, log, hashSurvey, loadSurvey, mergeSurvey,
    // לפני פתיחת סקר: מושכים את הגרסה האחרונה מהענן (עד כמה שניות), על אותו עותק שהגיבוי מחזיק
    async refresh(id) {
      if (!navigator.onLine || running || !(await OD.connected())) return null;
      const s = await DB.getSurvey(id);
      if (!s || !s.odDataId) return s || null;
      holding.set(id, s);
      const p = pull(s).catch(() => false).finally(() => { if (holding.get(id) === s && !running) holding.delete(id); });
      await Promise.race([p, new Promise(r => setTimeout(r, 4000))]);
      return s;
    },
    // הגדרות הטלגרם השתנו בטאבלט: יישמרו בענן בגיבוי הבא
    geminiChanged() { settingsSynced = false; DB.setKV('geminiUpdated', Date.now()).then(() => schedule(0)); },
    // רשימות הבחירה נשמרו בהגדרות: עולות לענן עכשיו
    listsChanged() { settingsSynced = false; DB.setKV('listsUpdated', Date.now()).then(() => schedule(0)); },
    settingsChanged() { settingsSynced = false; DB.setKV('tgUpdated', Date.now()).then(() => schedule(0)); },
    pendingOf(s, tgOn, odOn) {
      const ph = s.trees.flatMap(t => t.photos || []);
      return {
        photos: ph.length,
        tg: tgOn ? ph.filter(p => !p.fromOld && !p.tgMsgId || (p.ver || 0) !== (p.tgVer || 0)).length : null,
        od: odOn ? ph.filter(p => !p.odId || (p.ver || 0) !== (p.odVer || 0)).length : null,
        data: odOn ? s.odDataHash === hashSurvey(s) : null,
      };
    },
    onChange(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    caption, photoFileName,
  };
})(self);

// BricsCAD במחשב, בלי אקסל (1.95.0): האפליקציה וטבלת העצים ב-BricsCAD מסתנכרנות מיד דרך קבצים בתיקייה במחשב.
// במחשב בוחרים פעם אחת תיקייה (G:\האחסון שלי\סקרי עצים), והאפליקציה עובדת בתת-תיקייה BricsCAD שבתוכה:
//   oritrees-<מזהה הסקר>.tsv  נתוני הסקר ל-BricsCAD. רק האפליקציה כותבת אותו, אחרי כל שמירה של סקר לבנייה
//   oritrees-index.tsv        רשימת הסקרים, לבחירת הסקר של השרטוט (TREESFILE). רק האפליקציה כותבת
//   oritrees-edits.tsv        שינויים מ-BricsCAD (ייעוד מ-TREESTABLE, עץ שסומן בשרטוט). רק BricsCAD כותב (מוסיף שורות)
// האפליקציה קוראת את קובץ השינויים כל שנייה. אחרי שינוי באפליקציה היא שולחת ל-BricsCAD oritrees://sync
// (tools/bricscad/oritrees_link.pyw), והשרטוט מצטייר מחדש. גם בלי זה TREES מתעדכן בסוף כל פקודה ב-BricsCAD.
// השורות: עמודות מופרדות בטאב, UTF-8. זמנים בשעון המקומי "YYYY-MM-DD HH:MM:SS" (כמו ב-BricsCAD)
(function (root) {
  const SUB = 'BricsCAD', INDEX = 'oritrees-index.tsv', EDITS = 'oritrees-edits.tsv';
  const dataName = id => `oritrees-${id}.tsv`;
  const supported = typeof root.showDirectoryPicker === 'function';
  let baseH = null, dirH = null, perm = 'none', baseName = '';
  const written = new Map();      // מזהה סקר -> הטקסט האחרון שנכתב (בלי שורת הזמן), כדי לא לכתוב שוב אותו דבר
  let index = new Map();          // מזהה סקר -> שורה ברשימה
  const listeners = new Set();
  const emit = () => { for (const f of listeners) try { f(); } catch (_) {} };

  const pad = n => String(n).padStart(2, '0');
  const stamp = d => { d = d || new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const parseStamp = s => {
    const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(String(s || '').trim());
    return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0;
  };
  const cell = v => v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' ').trim();
  const r3 = v => v == null || !isFinite(v) ? '' : String(Math.round(v * 1000) / 1000);
  const r2 = v => v == null || !isFinite(v) ? '' : String(Math.round(v * 100) / 100);
  // קוד הייעוד ל-BricsCAD, כמו בגיליון "מדידה": 1 לא נדרש ברישיון, 2 העתקה, 3 שימור, 4 כריתה, 0 בלי
  const codeOf = st => !st ? 0 : /לא נדרש ברישיון/.test(st) ? 1 : /העתקה/.test(st) ? 2 : /שימור/.test(st) ? 3 : /כריתה/.test(st) ? 4 : 0;
  const isBuild = s => !!(s && root.Construction && root.Construction.isConstruction(s));

  // ---------- התיקייה ----------
  async function init() {
    if (!supported || !root.DB) return;
    try {
      baseH = await root.DB.getKV('cadDir', null);
      if (!baseH) return;
      baseName = baseH.name;
      perm = await baseH.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') await openSub();
    } catch (_) { perm = 'none'; }
    emit();
  }
  async function openSub() {
    dirH = await baseH.getDirectoryHandle(SUB, { create: true });
    perm = 'granted';
    await loadIndex();
    startPoll();
    writeAll().catch(() => {});
  }
  // בחירת התיקייה (מלחיצה של המשתמש)
  async function connect() {
    const h = await root.showDirectoryPicker({ id: 'oritrees-cad', mode: 'readwrite' });
    if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('לא ניתנה הרשאה לתיקייה');
    baseH = h; baseName = h.name;
    await root.DB.setKV('cadDir', h);
    written.clear();
    await openSub();
    emit();
    return h.name;
  }
  // אחרי הפעלה מחדש של הדפדפן הוא שואל שוב (לחיצה אחת)
  async function reconnect() {
    if (!baseH) return connect();
    if ((await baseH.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
    await openSub();
    emit();
    return true;
  }
  async function disconnect() {
    stopPoll();
    baseH = dirH = null; perm = 'none'; baseName = ''; written.clear();
    await root.DB.setKV('cadDir', null);
    emit();
  }
  const state = () => ({ supported, connected: !!dirH, needsClick: !!baseH && !dirH, name: baseName, folder: baseName ? baseName + '\\' + SUB : '' });

  async function writeFile(name, text) {
    const fh = await dirH.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(new Blob([text], { type: 'text/tab-separated-values' }));
    await w.close();
  }
  async function readFile(name) {
    try { return await (await (await dirH.getFileHandle(name)).getFile()).text(); }
    catch (e) { if (e && e.name === 'NotFoundError') return null; throw e; }
  }
  const lines = text => String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim()).map(l => l.split('\t'));

  // ---------- קובץ הנתונים של סקר ----------
  // H  מזהה, שם, תאריך הסקר, זמן הכתיבה, גרסה
  // L  רשימת הייעודים
  // T  מזהה עץ, מספר, X, Y, X מספר, Y מספר, מספר המודד, ייעוד, מזהה עץ המודד, קוד, מין, כמות, גובה, קוטר משוקלל, סך ערך, ערכיות
  //    (עמודות 3 עד 12 = A עד I בגיליון "מדידה", באותו סדר. עץ בלי מיקום: X,Y ריקים, רק בטבלה)
  // A  שם התחום, נקודות "X,Y;X,Y;..."
  async function dataText(s) {
    const C = root.Construction, st = C.settingsOf(s);
    const keep = t => root.Core.hasContent(t) && !t.ref;
    const pl = root.Plan ? await root.Plan.placed(s, keep) : { trees: [], polys: [], lab: new Map() };
    const pos = new Map(pl.trees.map(t => [t.src, t]));
    const out = [['L', ...C.STATUSES.map(x => x.key)]];
    for (const t of root.Core.sortTrees(s.trees).filter(keep)) {
      const c = C.compute(t, st), p = pos.get(t), L = p && pl.lab.get(p);
      const status = c.status || '', name = c.name.trim() ? c.name : (t.species || '');
      const num = root.Core.num ? root.Core.num(t.qty) : parseFloat(t.qty);
      out.push(['T', t.id, cell(t.num), p ? r3(p.px) : '', p ? r3(p.py) : '', L ? r3(L[0]) : '', L ? r3(L[1]) : '', cell(t.pname), cell(status), cell(t.pref),
        codeOf(status), cell(name), num == null || isNaN(num) ? '' : num, cell(t.height), r2(c.I), c.N == null ? '' : c.N, cell(c.cat)]);
    }
    pl.polys.forEach((p, i) => out.push(['A', cell(p.name || 'תחום ' + (i + 1)), p.pts.map(q => r3(q[0]) + ',' + r3(q[1])).join(';')]));
    return out.map(r => r.map(cell).join('\t')).join('\r\n') + '\r\n';
  }
  const headLine = s => ['H', s.id, cell(s.site), cell(s.date), stamp(), root.App && root.App.version || ''].join('\t') + '\r\n';
  const excelBase = s => { try { return root.App && root.App.fileBase ? root.App.fileBase(s) : ''; } catch (_) { return ''; } };

  async function loadIndex() {
    index = new Map();
    for (const r of lines(await readFile(INDEX).catch(() => null))) if (r[0] && r[0] !== 'id') index.set(r[0], r);
  }
  let indexT = null;
  function saveIndexSoon() {
    clearTimeout(indexT);
    indexT = setTimeout(() => {
      if (!dirH) return;
      const rows = [...index.values()].sort((a, b) => String(b[4] || '').localeCompare(String(a[4] || '')));
      writeFile(INDEX, ['id\tשם\tתאריך\tקובץ האקסל\tעודכן', ...rows.map(r => r.map(cell).join('\t'))].join('\r\n') + '\r\n').catch(() => {});
    }, 300);
  }

  // כתיבת הסקר (רק כשמשהו השתנה). אחרי שינוי שהמשתמש עשה עכשיו: BricsCAD מצטייר מחדש מיד
  const pending = new Map();
  function writeSoon(s) {
    if (!dirH || !isBuild(s)) return;
    clearTimeout(pending.get(s.id));
    pending.set(s.id, setTimeout(() => { pending.delete(s.id); write(s).catch(() => {}); }, 120));
  }
  async function write(s) {
    if (!dirH || !isBuild(s)) return false;
    const body = await dataText(s);
    const entry = [s.id, cell(s.site), cell(s.date), cell(excelBase(s)), stamp(new Date(s.updated || Date.now()))];
    const old = index.get(s.id);
    if (!old || old.join('\t') !== entry.join('\t')) { index.set(s.id, entry); saveIndexSoon(); }
    if (written.get(s.id) === body) return false;
    await writeFile(dataName(s.id), headLine(s) + body);
    written.set(s.id, body);
    ping();
    return true;
  }
  // כל הסקרים לבנייה, כשמתחברים (כדי שכל סקר יופיע ברשימה של TREESFILE)
  async function writeAll() {
    for (const s of await root.DB.allSurveys()) if (isBuild(s)) { try { await write(s); } catch (_) {} }
  }

  // ---------- רענון מיידי ב-BricsCAD ----------
  // רק כשהשינוי נעשה עכשיו בלחיצה או בהקלדה (הדפדפן פותח קישור כזה רק אחרי פעולה של המשתמש), לכל היותר פעם בשנייה וחצי
  let lastPing = 0, pingT = null;
  function activeDoc() {
    const docs = [];
    if (popup && !popup.closed) docs.push(popup.document);
    docs.push(document);
    for (const d of docs) {
      const ua = d.defaultView && d.defaultView.navigator.userActivation;
      if (ua && ua.isActive) return d;
    }
    return null;
  }
  function launch(url, doc) {
    doc = doc || activeDoc() || document;
    const a = doc.createElement('a');
    a.href = url; a.style.display = 'none';
    doc.body.append(a); a.click(); a.remove();
  }
  function ping() {
    const doc = activeDoc();
    if (!doc) return;
    const wait = lastPing + 1500 - Date.now();
    clearTimeout(pingT);
    if (wait > 0) { pingT = setTimeout(() => { const d = activeDoc(); if (d) { lastPing = Date.now(); launch('oritrees://sync', d); } }, wait); return; }
    lastPing = Date.now();
    launch('oritrees://sync', doc);
  }

  // ---------- שינויים מ-BricsCAD ----------
  // S  מזהה סקר, מזהה עץ, מספר, ייעוד, זמן     ייעוד מ-TREESTABLE (נכנס אם הוא חדש יותר מהשינוי האחרון של העץ)
  // P  מזהה סקר, מזהה עץ, מספר, זמן            עץ שסומן בשרטוט (TREESPICK): מסומן באפליקציה ובטבלה שליד
  let pollT = null, seenMod = 0, seenSize = -1, pickFrom = Date.now(), busy = false;
  function startPoll() { stopPoll(); pickFrom = Date.now(); pollT = setInterval(() => { poll().catch(() => {}); }, 1000); }
  function stopPoll() { clearInterval(pollT); pollT = null; }
  async function poll() {
    if (!dirH || busy) return;
    busy = true;
    try {
      let f;
      try { f = await (await dirH.getFileHandle(EDITS)).getFile(); } catch (_) { return; }
      if (f.lastModified === seenMod && f.size === seenSize) return;
      const text = await f.text();
      seenMod = f.lastModified; seenSize = f.size;
      await apply(lines(text));
    } finally { busy = false; }
  }
  async function apply(rows) {
    const bySurvey = new Map();
    let pick = null;
    for (const r of rows) {
      if (r[0] === 'S' && r[1]) {
        const at = parseStamp(r[5]);
        if (!at) continue;
        if (!bySurvey.has(r[1])) bySurvey.set(r[1], []);
        bySurvey.get(r[1]).push({ id: r[2], num: (r[3] || '').trim(), status: (r[4] || '').trim(), at });
      } else if (r[0] === 'P' && r[1]) {
        const at = parseStamp(r[4]);
        if (at && at >= pickFrom - 1000 && (!pick || at >= pick.at)) pick = { sid: r[1], id: r[2], num: (r[3] || '').trim(), at };
      }
    }
    for (const [sid, eds] of bySurvey) {
      const live = root.App && root.App.live ? root.App.live(sid) : null;
      const s = live || await root.DB.getSurvey(sid);
      if (!s || !isBuild(s)) continue;
      const changed = [];
      for (const e of eds.sort((a, b) => a.at - b.at)) {
        const t = s.trees.find(x => x.id === e.id) || s.trees.find(x => String(x.num || '').trim() === e.num && e.num);
        if (!t || e.at <= (t.statusAt || 0)) continue;
        // ייעוד ריק ב-BricsCAD = ריק ידני (כמו לחיצה על הייעוד הנבחר באפליקציה)
        const valid = !e.status || root.Construction.STATUSES.some(x => x.key === e.status);
        if (!valid) continue;
        if (root.Construction.manualStatus(t) === e.status && t.status != null) { t.statusAt = e.at; continue; }
        t.status = e.status; t.statusAt = e.at;
        changed.push(t);
      }
      if (!changed.length) continue;
      if (live && root.App.cadUpdated) root.App.cadUpdated(sid, changed);
      else { await root.DB.putSurvey(s); if (root.Sync && root.Sync.kick) root.Sync.kick(true); }
      if (root.Sync && root.Sync.statusChanged) root.Sync.statusChanged(s);
    }
    renderTable();
    if (pick && pick.at > lastPick) {
      lastPick = pick.at;
      if (root.App && root.App.cadPicked) root.App.cadPicked(pick.sid, pick.id, pick.num);
      highlight(pick.id, pick.num);
    }
  }
  let lastPick = 0;

  // ---------- גם בלי תיקייה במחשב (1.111.0): קובץ הסקר עולה לגוגל דרייב, ל"סקרי עצים/BricsCAD" ----------
  // ori: לא מורידים אקסל. "סיום סקר" מעלה לדרייב את הסימונים על המדידה (DXF, עם מזהה הסקר), מעתיקים אותם לשרטוט,
  // ו-TREES מצייר מהקובץ הזה, שגוגל דרייב במחשב מוריד ל-G:\האחסון שלי\סקרי עצים\BricsCAD. כך זה עובד גם משינוי בטאבלט.
  // כשהתיקייה מחוברת במכשיר הזה (מחשב) היא כבר כותבת לשם, אז לא מעלים פעמיים
  const driveSent = new Map(), driveT = new Map();
  const hasMarks = s => (s.trees || []).some(t => t.px != null) || (s.planPolys || []).some(p => p.pts && p.pts.length > 2);
  function driveSoon(s) {
    if (dirH || !isBuild(s) || !hasMarks(s) || !root.OD) return;
    clearTimeout(driveT.get(s.id));
    driveT.set(s.id, setTimeout(() => { driveT.delete(s.id); toDrive(s).catch(() => {}); }, 4000));
  }
  async function toDrive(s) {
    if (dirH || !isBuild(s) || !hasMarks(s) || !root.OD || (typeof navigator !== 'undefined' && navigator.onLine === false)) return false;
    if (!(await root.OD.connected())) return false;
    const body = await dataText(s);
    if (driveSent.get(s.id) === body) return false;
    const top = (await root.DB.getKV('odRoot', 'סקרי עצים')) || 'סקרי עצים';
    const dir = await root.OD.folder(await root.OD.folder(null, top), SUB);
    const ok = await root.OD.upload(dir, dataName(s.id), new Blob([headLine(s) + body], { type: 'text/tab-separated-values' }), true);
    if (ok) driveSent.set(s.id, body);
    return !!ok;
  }

  // כל שמירה של סקר (גם שינוי שהגיע ממכשיר אחר) נכתבת לקובץ של BricsCAD, והטבלה שליד מתעדכנת
  if (root.DB && root.DB.putSurvey) {
    const put = root.DB.putSurvey.bind(root.DB);
    root.DB.putSurvey = function (s, touch) {
      const r = put(s, touch);
      Promise.resolve(r).then(() => { writeSoon(s); driveSoon(s); tableSoon(s); }, () => {});
      return r;
    };
  }

  // ---------- טבלת העצים ליד BricsCAD: חלון קטן של האפליקציה ----------
  // החלון מצויר מהחלון הראשי (אותם נתונים, אותה שמירה), ומתעדכן מיד אחרי כל שינוי, באפליקציה או ב-BricsCAD.
  // ייעוד שנבחר בו נשמר ונשלח ל-BricsCAD מיד. לחיצה על שורה = הצגת העץ בשרטוט
  let popup = null, tableFor = null, tableFilter = '', tableT = null;
  const CSS = `
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font:14px/1.35 system-ui,"Segoe UI",Arial,sans-serif;background:#f6f7f5;color:#1d2420;direction:rtl;display:flex;flex-direction:column}
header{padding:8px 10px;background:#fff;border-bottom:1px solid #d8ddd8;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
header h1{font-size:15px;margin:0;flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header input{font:inherit;padding:5px 8px;border:1px solid #c4cbc5;border-radius:6px;width:110px}
.sum{font-size:12px;color:#5b655e;padding:4px 10px;background:#fff;border-bottom:1px solid #e3e7e3}
.wrap{flex:1;overflow:auto}
table{border-collapse:collapse;width:100%}
th{position:sticky;top:0;background:#eef1ee;font-weight:600;font-size:12px;text-align:right;padding:5px 6px;border-bottom:1px solid #cfd5d0;white-space:nowrap}
td{padding:3px 6px;border-bottom:1px solid #e6e9e6;white-space:nowrap}
td.sp{white-space:normal;min-width:90px}
tr{cursor:pointer}tr:hover td{background:#f0f4ff}
tr.hit td{background:#fff3b0 !important;transition:background .2s}
tr.hidden{display:none}
select{font:inherit;font-size:13px;padding:2px 4px;border-radius:5px;border:1px solid #c4cbc5;max-width:190px}
.n{font-weight:700}
.msg{padding:24px;text-align:center;color:#5b655e}
@media (prefers-color-scheme: dark){body{background:#161a18;color:#e6ebe7}header,.sum{background:#1f2421;border-color:#333a35}
th{background:#262c28;border-color:#3a423c}td{border-color:#2c332e}tr:hover td{background:#25304a}tr.hit td{background:#5a4c00 !important}
select,header input{background:#1f2421;color:#e6ebe7;border-color:#454e48}}`;

  function openTable() {
    const w = 600, H = (screen.availHeight || 900);
    const L = Math.max(0, (screen.availLeft || 0) + (screen.availWidth || 1400) - w), T = screen.availTop || 0;
    if (!popup || popup.closed) {
      popup = root.open('', 'oritrees-cad', `popup=yes,width=${w},height=${H},left=${L},top=${T}`);
      if (!popup) throw new Error('הדפדפן חסם את החלון. צריך לאשר חלונות קופצים לאתר הזה');
      popup.document.open();
      popup.document.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>טבלת עצים ל-BricsCAD</title><style>${CSS}</style></head><body></body></html>`);
      popup.document.close();
      // החלון הראשי נסגר או נטען מחדש: גם הטבלה נסגרת (היא מצוירת ממנו)
      root.addEventListener('pagehide', () => { try { popup.close(); } catch (_) {} });
    }
    tableFor = null;
    renderTable(true);
    popup.focus();
  }
  function tableSoon(s) {
    if (!popup || popup.closed) return;
    const cur = root.App && root.App.current && root.App.current();
    if (!cur || cur.id !== s.id) return;
    clearTimeout(tableT);
    tableT = setTimeout(() => renderTable(), 150);
  }
  function rowsOf(s) {
    const C = root.Construction, st = C.settingsOf(s);
    return root.Core.sortTrees(s.trees).filter(t => root.Core.hasContent(t) && !t.ref).map(t => ({ t, c: C.compute(t, st) }));
  }
  function renderTable(force) {
    if (!popup || popup.closed) return;
    const d = popup.document, s = root.App && root.App.current && root.App.current();
    if (!isBuild(s)) {
      d.body.replaceChildren(Object.assign(d.createElement('div'), { className: 'msg', textContent: 'פתח באפליקציה סקר לבנייה, והטבלה שלו תופיע כאן.' }));
      tableFor = null;
      return;
    }
    const C = root.Construction;
    // ציור מחדש של השורות בלבד, כדי לשמור על הגלילה, על הסינון ועל רשימה פתוחה
    if (force || tableFor !== s.id || !d.querySelector('tbody')) {
      tableFor = s.id;
      const head = d.createElement('header');
      const h1 = d.createElement('h1'); h1.textContent = s.site || 'סקר לבנייה';
      const q = d.createElement('input'); q.type = 'search'; q.placeholder = 'מספר עץ'; q.value = tableFilter;
      q.oninput = () => { tableFilter = q.value; filterRows(); };
      q.onkeydown = e => { if (e.key === 'Enter') { const r = d.querySelector('tbody tr:not(.hidden)'); if (r) r.click(); } };
      head.append(h1, q);
      const sum = d.createElement('div'); sum.className = 'sum';
      const table = d.createElement('table');
      table.innerHTML = '<thead><tr><th>מספר</th><th>מין העץ</th><th>כמות</th><th>גובה</th><th>קוטר</th><th>ערך</th><th>ערכיות</th><th>ייעוד</th></tr></thead><tbody></tbody>';
      const wrap = d.createElement('div'); wrap.className = 'wrap'; wrap.append(table);
      d.body.replaceChildren(head, sum, wrap);
    }
    const open = d.activeElement && d.activeElement.tagName === 'SELECT' ? d.activeElement.dataset.id : null;
    if (open) { tableT = setTimeout(() => renderTable(), 800); return; } // רשימה פתוחה: מחכים שתיסגר
    const tbody = d.querySelector('tbody'), rows = rowsOf(s), counts = {};
    tbody.replaceChildren(...rows.map(({ t, c }) => {
      const tr = d.createElement('tr');
      if (t.id === hit.id && Date.now() < hit.until) tr.className = 'hit';
      tr.dataset.id = t.id; tr.dataset.nums = ' ' + (root.Core.expandNum(t.num) || [String(t.num || '').trim()]).join(' ') + ' ';
      const status = c.status || '', x = C.STATUSES.find(z => z.key === status);
      counts[status || 'בלי ייעוד'] = (counts[status || 'בלי ייעוד'] || 0) + 1;
      const td = (v, cls) => { const e = d.createElement('td'); e.textContent = v == null ? '' : v; if (cls) e.className = cls; return e; };
      const sel = d.createElement('select');
      sel.dataset.id = t.id;
      const man = C.manualStatus(t);
      const opts = [['', '(בלי ייעוד)'], ...C.STATUSES.map(z => [z.key, z.key])];
      for (const [v, label] of opts) { const o = d.createElement('option'); o.value = v; o.textContent = label + (v === status && status && !man ? ' (אוטומטי)' : ''); sel.append(o); }
      sel.value = status;
      if (x) { sel.style.background = x.color; sel.style.color = x.ink; }
      sel.onclick = e => e.stopPropagation();
      sel.onchange = () => { if (root.App && root.App.cadSetStatus) root.App.cadSetStatus(s.id, t.id, sel.value); };
      const stTd = d.createElement('td'); stTd.append(sel);
      tr.append(td(t.num, 'n'), td(c.name.trim() ? c.name : t.species, 'sp'), td(t.qty), td(t.height), td(c.I ? Math.round(c.I * 10) / 10 : ''), td(c.N == null ? '' : c.N), td(c.cat), stTd);
      tr.onclick = () => {
        const num = String(t.num || '').trim();
        if (num) launch('oritrees://go/' + encodeURIComponent(num), d);
        if (root.App && root.App.cadPicked) root.App.cadPicked(s.id, t.id, num, true);
      };
      return tr;
    }));
    d.querySelector('.sum').textContent = `${rows.length} עצים · ` + Object.entries(counts).map(([k, n]) => `${k}: ${n}`).join(' · ') +
      (dirH ? '' : ' · BricsCAD לא מחובר (הגדרות > BricsCAD במחשב)');
    d.title = `טבלת עצים ל-BricsCAD · ${s.site || ''}`;
    filterRows();
  }
  function filterRows() {
    if (!popup || popup.closed) return;
    const q = tableFilter.trim();
    for (const tr of popup.document.querySelectorAll('tbody tr')) tr.classList.toggle('hidden', !!q && !tr.dataset.nums.includes(' ' + q + ' ') && !tr.dataset.nums.includes(' ' + q));
  }
  function highlight(id, num) {
    if (!popup || popup.closed) return;
    const d = popup.document;
    const tr = d.querySelector(`tbody tr[data-id="${CSS_ESC(id)}"]`) || [...d.querySelectorAll('tbody tr')].find(r => num && r.dataset.nums.includes(' ' + num + ' '));
    if (!tr) return;
    if (tr.classList.contains('hidden')) { tableFilter = ''; const q = d.querySelector('header input'); if (q) q.value = ''; filterRows(); }
    for (const r of d.querySelectorAll('tr.hit')) r.classList.remove('hit');
    tr.classList.add('hit');
    hit = { id: tr.dataset.id, until: Date.now() + 2500 };
    tr.scrollIntoView({ block: 'center' });
    setTimeout(() => { for (const r of d.querySelectorAll('tr.hit')) r.classList.remove('hit'); }, 2600);
  }
  let hit = { id: null, until: 0 };
  const CSS_ESC = v => (root.CSS && root.CSS.escape ? root.CSS.escape(String(v || '')) : String(v || '').replace(/"/g, '\\"'));

  root.CadLink = {
    supported, init, connect, reconnect, disconnect, state, onChange: f => listeners.add(f),
    write, writeSoon, toDrive, ping, openTable, renderTable, highlight, tableOpen: () => !!(popup && !popup.closed),
    _use: async h => { baseH = h; baseName = h.name; await openSub(); emit(); }, // בדיקות
    _dataText: dataText, _apply: apply, _poll: poll, _parseStamp: parseStamp, _stamp: stamp, codeOf,
  };
})(window);

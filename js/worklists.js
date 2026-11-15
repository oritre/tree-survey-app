// עבודה לפי רשימה (1.96.0): ייבוא רשימת מוסדות מאקסל (למשל רשימת המעונות מהלקוח), עריכת התאים באפליקציה,
// שיוך עמודות לשדות הסקר (שם, רחוב, עיר, סמל מוסד, מנהל/ת), ופתיחת סקר משורה ברשימה.
// לפני פתיחה מחפשים סקר קודם באותו מקום (באפליקציה ובארכיון בגוגל דרייב), כדי להתחיל מהסקר של השנה שעברה.
// הרשימות נשמרות בטאבלט (KV workLists) ובקובץ "רשימות עבודה.json" בתיקיית הגיבוי, כך שהן זהות בטלפון ובטאבלט
(function (root) {
  'use strict';
  const U = () => App.ui;
  const $ = (s, el) => (el || document).querySelector(s);
  const FILE = 'רשימות עבודה.json';
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // שדות הסקר שאפשר לשייך להם עמודה. prev: כשפותחים על בסיס סקר קודם, הערך מהסקר הקודם נשאר (ברירת מחדל)
  const FIELDS = [
    { key: 'siteName', label: 'שם המוסד / האתר', re: /שם\s*ה?(מוסד|מעון|גן|אתר|בית\s*ספר|בי"ס)|^שם$|^מוסד|^מעון/, prev: true, safetyOnly: true },
    { key: 'street', label: 'רחוב ומספר', re: /כתובת|רחוב/, prev: true },
    { key: 'city', label: 'עיר', re: /^עיר|ישוב|יישוב|רשות|^מקום$/, prev: true },
    { key: 'code', label: 'סמל מוסד', re: /סמל/, safetyOnly: true },
    { key: 'manager', label: 'מנהל/ת', re: /מנהל|אחראי|איש\s*קשר/, safetyOnly: true },
    { key: 'gush', label: 'גוש', re: /^גוש/, buildOnly: true },
    { key: 'helka', label: 'חלקה', re: /^חלק/, buildOnly: true },
  ];
  const fieldsOf = l => FIELDS.filter(f => l.type === 'construction' ? !f.safetyOnly : !f.buildOnly);

  // ערים לזיהוי אוטומטי כשאין ברשימה עמודת עיר (בנוסף לערים מהסקרים הקודמים)
  const CITIES = ['ירושלים', 'תל אביב', 'תל אביב יפו', 'חיפה', 'ראשון לציון', 'פתח תקווה', 'אשדוד', 'נתניה', 'באר שבע', 'בני ברק', 'חולון', 'רמת גן', 'אשקלון', 'רחובות',
    'בת ים', 'בית שמש', 'כפר סבא', 'הרצליה', 'חדרה', 'מודיעין', 'מודיעין עילית', 'נצרת', 'לוד', 'רמלה', 'רעננה', 'ביתר עילית', 'רהט', 'הוד השרון', 'גבעתיים', 'קרית אתא',
    'נהריה', 'קרית גת', 'אום אל פחם', 'עפולה', 'אילת', 'יבנה', 'ראש העין', 'עכו', 'אלעד', 'רמת השרון', 'כרמיאל', 'טבריה', 'נוף הגליל', 'קרית מוצקין', 'קרית ביאליק',
    'קרית ים', 'קרית שמונה', 'קרית מלאכי', 'קרית אונו', 'קרית טבעון', 'קרית ארבע', 'קרית שמואל', 'נס ציונה', 'דימונה', 'צפת', 'שדרות', 'נתיבות', 'אופקים', 'ערד', 'בית שאן',
    'מגדל העמק', 'יקנעם', 'יקנעם עילית', 'טירת כרמל', 'נשר', 'אור עקיבא', 'אור יהודה', 'יהוד', 'גבעת שמואל', 'זכרון יעקב', 'פרדס חנה כרכור', 'פרדס חנה', 'כרכור', 'בנימינה',
    'מעלות תרשיחא', 'מעלות', 'שלומי', 'חצור הגלילית', 'חצור', 'ירוחם', 'מצפה רמון', 'קצרין', 'עתלית', 'גני תקווה', 'שוהם', 'מבשרת ציון', 'מעלה אדומים', 'אריאל', 'אפרת',
    'גבעת זאב', 'קדימה צורן', 'אבן יהודה', 'כפר יונה', 'טירה', 'טייבה', 'סח\'נין', 'שפרעם', 'עספיא', 'דלית אל כרמל', 'מגדל', 'ראש פינה', 'יבנאל', 'כפר תבור', 'כנרת',
    'גדרה', 'מזכרת בתיה', 'קרית עקרון', 'באר יעקב', 'גן יבנה', 'קציר', 'חריש', 'כפר קאסם', 'יפו'];

  const clean = v => String(v == null ? '' : v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  // להשוואה: בלי גרשיים, סימנים וקיצורי "רח'"/"שכ'", בלי ה"א הידיעה בתחילת מילה ארוכה
  const norm = v => clean(v).replace(/["'׳״“”‘’`]/g, '').replace(/[.,;:()\-–_/\\+]/g, ' ')
    .split(' ').filter(Boolean).filter(w => !/^(רח|רחוב|שכ|שכונת|שכונה|שיכון|שד|שדרות|דרך|כיכר)$/.test(w))
    .map(w => w.length > 3 && w[0] === 'ה' ? w.slice(1) : w).join(' ').toLowerCase();
  const hasWord = (hay, w) => !!w && (' ' + hay + ' ').includes(' ' + w + ' ');

  // ---------- אחסון וסנכרון ----------
  let cache = null;
  async function all() { if (!cache) cache = (await DB.getKV('workLists', [])) || []; return cache; }
  const live = async () => (await all()).filter(l => !l.deleted);
  const byId = async id => (await all()).find(l => l.id === id && !l.deleted) || null;
  async function save(l) {
    l.updated = Date.now();
    const list = await all();
    const i = list.findIndex(x => x.id === l.id);
    if (i >= 0) list[i] = l; else list.push(l);
    await DB.setKV('workLists', list);
    pushSoon();
  }
  // מיזוג: רשימה שעודכנה אחרונה קובעת את העמודות והשיוך, והשורות מתמזגות לפי זמן העדכון של כל שורה
  function mergeList(a, b) {
    if (!a) return b; if (!b) return a;
    const [n, o] = (b.updated || 0) > (a.updated || 0) ? [b, a] : [a, b];
    if (n.deleted || o.deleted) return Object.assign({}, n, { deleted: n.deleted || o.deleted, updated: Math.max(n.updated || 0, o.updated || 0) });
    const rows = new Map(o.rows.map(r => [r.id, r]));
    for (const r of n.rows) { const x = rows.get(r.id); rows.set(r.id, !x || (r.u || 0) >= (x.u || 0) ? r : x); }
    const order = [...n.rows.map(r => r.id), ...o.rows.map(r => r.id).filter(id => !n.rows.some(r => r.id === id))];
    return Object.assign({}, n, { rows: order.map(id => rows.get(id)) });
  }
  let pushT = null, pulledAt = 0, syncing = null;
  const pushSoon = () => { clearTimeout(pushT); pushT = setTimeout(() => sync(true).catch(() => {}), 1500); };
  async function rootDir() { return OD.folder(null, (await DB.getKV('odBackupRoot', 'גיבוי אפליקציית סקרי עצים')) || 'גיבוי אפליקציית סקרי עצים'); }
  // force: גם אם משכנו לפני רגע (אחרי שינוי מקומי)
  async function sync(force) {
    if (syncing) { await syncing.catch(() => {}); if (!force) return false; }
    if (!force && Date.now() - pulledAt < 30000) return false;
    if (navigator.onLine === false || !(await OD.connected())) return false;
    syncing = (async () => {
      const r = await rootDir();
      const j = (await OD.readJson(r, FILE)) || { lists: [] };
      const local = await all();
      const ids = new Set([...local.map(l => l.id), ...(j.lists || []).map(l => l.id)]);
      const merged = [...ids].map(id => mergeList(local.find(l => l.id === id), (j.lists || []).find(l => l.id === id)));
      const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
      const changedLocal = !same(merged, local);
      if (changedLocal) { cache = merged; await DB.setKV('workLists', merged); }
      if (!same(merged, j.lists || [])) await OD.upload(r, FILE, new Blob([JSON.stringify({ lists: merged })], { type: 'application/json' }), true);
      pulledAt = Date.now();
      return changedLocal;
    })();
    try { return await syncing; } finally { syncing = null; }
  }

  // ---------- קריאת קובץ ----------
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(clean));
  }
  async function readFile(file) {
    if (/\.csv$/i.test(file.name)) return [{ name: file.name, rows: parseCsv(await file.text()) }];
    if (/\.xls$/i.test(file.name)) throw new Error('קובץ xls ישן: שמור אותו באקסל כ-xlsx ונסה שוב');
    return Importer.readTable(await file.arrayBuffer());
  }
  const cellText = v => v == null ? '' : typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : typeof v === 'boolean' ? (v ? 'כן' : '') : clean(v);
  // שורת הכותרות: הראשונה (בין 15 הראשונות) עם לפחות 3 תאי טקסט, שאחריה יש שורות נתונים
  function guessHeader(rows) {
    for (let i = 0; i < Math.min(rows.length - 1, 15); i++) {
      const texts = (rows[i] || []).filter(v => typeof v === 'string' && v && !/^\d+([./-]\d+)*$/.test(v));
      if (texts.length >= 3) return i;
    }
    return 0;
  }
  // בונה את העמודות והשורות מהטבלה הגולמית לפי שורת הכותרות
  function buildFromRaw(l) {
    const rows = l.raw, hr = l.headerRow;
    const width = Math.max(0, ...rows.slice(hr).map(r => r.length));
    const used = [];
    for (let c = 0; c < width; c++) if (rows.slice(hr).some(r => cellText(r[c]))) used.push(c);
    const head = rows[hr] || [];
    l.cols = used.map((c, i) => ({ id: 'c' + c, name: cellText(head[c]) || 'עמודה ' + (i + 1) }));
    l.rows = rows.slice(hr + 1).filter(r => used.some(c => cellText(r[c])))
      .map(r => ({ id: uid(), cells: Object.fromEntries(used.map(c => ['c' + c, cellText(r[c])])), u: Date.now() }));
    l.map = {};
    for (const f of FIELDS) {
      const col = l.cols.find(c => f.re.test(c.name) && !(f.key === 'siteName' && /מנהל/.test(c.name)) && !Object.values(l.map).some(m => m.col === c.id));
      l.map[f.key] = { col: col ? col.id : '', pre: '', prev: !!f.prev };
    }
  }
  // אין עמודת עיר: עמודה חדשה "עיר" שמתמלאת לפי שם עיר שמופיע בשורה (קודם בעמודות שאינן הכתובת)
  async function addCityColumn(l) {
    if (l.map.city.col) return;
    const known = new Set(CITIES);
    for (const s of await DB.allSurveys().catch(() => [])) if (s.city) known.add(clean(s.city));
    const cities = [...known].filter(Boolean).sort((a, b) => b.length - a.length).map(c => [c, norm(c)]);
    const streetCol = l.map.street.col;
    const order = [...l.cols.filter(c => c.id !== streetCol), ...l.cols.filter(c => c.id === streetCol)];
    let found = 0;
    const id = 'city' + uid();
    for (const r of l.rows) {
      let city = '';
      for (const c of order) { const t = norm(r.cells[c.id]); const hit = cities.find(([, n]) => hasWord(t, n) || t.startsWith(n + ' ') || t === n); if (hit) { city = hit[0]; break; } }
      r.cells[id] = city; if (city) found++;
    }
    if (!found) { for (const r of l.rows) delete r.cells[id]; return; }
    l.cols.push({ id, name: 'עיר' });
    l.map.city = { col: id, pre: '', prev: true };
  }

  // ערכי הסקר לשורה, לפי השיוך
  function valuesOf(l, r) {
    const out = {};
    for (const f of fieldsOf(l)) {
      const m = l.map[f.key] || {};
      const v = [clean(m.pre), m.col ? clean(r.cells[m.col]) : ''].filter(Boolean).join(' ');
      if (v) out[f.key] = v;
    }
    return out;
  }

  // ---------- סקרים קודמים ----------
  // מילת הרחוב שלפני מספר הבית ("שכ' טירת צבי רח' חנה סנש 6" -> סנש) ומספר הבית
  function streetKey(street) {
    const w = norm(street).split(' ');
    const i = w.findIndex(x => /^\d+[א-ת]?$/.test(x));
    if (i > 0) return { word: w[i - 1], num: w[i].replace(/\D+/g, '') };
    const words = w.filter(x => !/\d/.test(x) && x.length > 1);
    return { word: words[words.length - 1] || '', num: '' };
  }
  function scoreOf(v, text, code) {
    const hay = norm(text);
    let sc = 0;
    if (v.code && code && String(code).replace(/\D+/g, '') === String(v.code).replace(/\D+/g, '')) sc += 10;
    const city = norm(v.city), first = city.split(' ')[0];
    const cityHit = city && (hay.includes(city) || (first.length >= 3 && hasWord(hay, first)));
    if (cityHit) sc += 3;
    const { word, num } = streetKey(v.street);
    const stHit = word && word.length >= 2 && hasWord(hay, word);
    const numHit = !!(stHit && num && hasWord(hay, num));
    if (stHit) sc += numHit ? 4 : 3;
    return { sc, cityHit, stHit, numHit };
  }
  // סקרים באפליקציה (בטאבלט ובאינדקס בענן) ובארכיון (קובצי אקסל) שמתאימים לשורה
  async function candidates(l, v, onArchive) {
    const local = await DB.allSurveys();
    let cloud = [];
    const odOn = navigator.onLine !== false && await OD.connected();
    if (odOn) cloud = await Sync.cloudIndex().catch(() => []);
    const ents = new Map(cloud.filter(e => !e.deleted).map(e => [e.id, Object.assign({ kind: 'app' }, e)]));
    for (const s of local) if (!s.deleted) ents.set(s.id, Object.assign({}, ents.get(s.id) || {}, { kind: 'app', id: s.id, local: true, type: s.type, code: s.code, siteName: s.siteName || s.site, street: s.street, city: s.city, site: s.site, date: s.date, finished: s.finished, dataId: (ents.get(s.id) || {}).dataId || s.odDataId }));
    const type = l.type === 'construction' ? 'construction' : 'safety';
    const app = [...ents.values()].filter(e => (e.type === 'construction' ? 'construction' : 'safety') === type)
      .map(e => Object.assign(e, scoreOf(v, [e.siteName, e.street, e.city, e.site].join(' '), e.code)))
      .filter(e => e.sc >= 10 || (e.cityHit && e.stHit))
      .sort((a, b) => b.sc - a.sc || (b.date || '').localeCompare(a.date || '')).slice(0, 5);
    let arch = [];
    if (odOn && onArchive) {
      onArchive();
      const archive = await DB.getKV('gdArchive', null);
      const { word } = streetKey(v.street);
      const terms = [...new Set([word && word.length >= 2 ? word : '', clean(v.city), v.code || ''].filter(Boolean))];
      const files = new Map();
      for (const res of await Promise.all(terms.map(t => OD.searchExcel(t, archive && archive.id).catch(() => []))))
        for (const f of res) files.set(f.id, f);
      const list = [...files.values()];
      const paths = await Promise.all(list.map(f => U().pathOf(f).catch(() => [])));
      arch = list.map((f, i) => ({ kind: 'file', f, path: paths[i] }))
        .filter(x => !x.path.some(n => /^גיבוי אפליקציית סקרי עצים$/.test(n)) && !/^טעינת עצים/.test(x.f.name))
        .map(x => {
          const yi = x.path.findIndex(n => /^\s*(19|20)\d\d\s*$/.test(n));
          x.year = yi >= 0 ? x.path[yi].trim() : (x.f.lastModifiedDateTime || '').slice(0, 4);
          return Object.assign(x, scoreOf(v, x.f.name.replace(/\.xls[xm]$/i, '') + ' ' + x.path.slice(-2).join(' '), ''));
        })
        .filter(x => x.cityHit || x.numHit) // רחוב בלי עיר ובלי מספר הבית (למשל רחוב ירושלים) תופס יותר מדי קבצים
        .sort((a, b) => b.sc - a.sc || (b.year || '').localeCompare(a.year || '') || (b.f.lastModifiedDateTime || '').localeCompare(a.f.lastModifiedDateTime || '')).slice(0, 6);
    }
    return { app, arch, odOn };
  }

  // ---------- פתיחת סקר משורה ----------
  // השדות מהרשימה נכנסים לסקר. בפתיחה על בסיס סקר קודם, שדה שמסומן "מהסקר הקודם" נשאר כמו שהיה שם (אם יש בו ערך)
  function applier(l, r, v, fromPrev) {
    return s => {
      for (const f of fieldsOf(l)) {
        if (!v[f.key]) continue;
        if (fromPrev && (l.map[f.key] || {}).prev && clean(s[f.key])) continue;
        s[f.key] = v[f.key];
      }
      if (l.project) s.project = l.project;
      s.listRef = { list: l.id, row: r.id, name: l.name };
      s.site = U().composeSite(s);
      r.sid = s.id; r.u = Date.now();
      save(l);
    };
  }
  async function openRow(l, r) {
    const ui = U();
    if (r.sid) {
      const s = await DB.getSurvey(r.sid);
      if (s && !s.deleted) { ui.go('#/s/' + s.id); return; }
      const idx = navigator.onLine !== false && await OD.connected() ? await Sync.cloudIndex().catch(() => []) : [];
      const e = idx.find(x => x.id === r.sid && !x.deleted);
      if (e) { const b = ui.h('button'); await ui.lists.fromCloud(e, false, b); return; }
    }
    const v = valuesOf(l, r);
    const title = [v.siteName, v.street, v.city].filter(Boolean).join(', ') || 'שורה ברשימה';
    const status = ui.h('div', { class: 'muted small' }, 'מחפש סקרים קודמים באפליקציה…');
    const box = ui.h('div', { class: 'stack' });
    const close = () => ov.remove();
    const ov = ui.h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
      ui.h('div', { class: 'card stack', style: 'max-width:560px;width:94%' },
        ui.h('h2', { style: 'margin:0;font-size:21px' }, 'סקר עבור ' + title),
        ui.h('div', { class: 'muted small' }, [v.code ? 'סמל ' + v.code : null, v.manager ? 'מנהל/ת: ' + v.manager : null, l.project ? 'פרויקט ' + l.project : null].filter(Boolean).join(' · ')),
        status, box,
        ui.h('button', { class: 'btn big block', onclick: () => { close(); ui.lists.blank(l.type || 'safety', applier(l, r, v, false)); } }, '➕ סקר חדש ריק (בלי סקר קודם)'),
        ui.h('button', { class: 'btn', onclick: close }, 'ביטול')));
    document.body.append(ov);
    const busy = async (btn, fn) => { for (const b of ov.querySelectorAll('button')) b.disabled = true; try { await fn(); } finally { if (document.body.contains(ov)) { close(); } } };
    let res;
    try { res = await candidates(l, v, () => { status.textContent = 'מחפש גם בארכיון בגוגל דרייב…'; }); }
    catch (e) { status.textContent = 'החיפוש נכשל: ' + e.message; return; }
    if (!document.body.contains(ov)) return;
    const recent = e => e.date && (Date.now() - new Date(e.date).getTime()) < 120 * 864e5;
    const rows = [];
    for (const e of res.app) {
      const sub = [e.code ? 'סמל ' + e.code : null, [e.street, e.city].filter(Boolean).join(', '), ui.fmtDate(e.date), e.finished ? '✓ הסתיים' : null].filter(Boolean).join(' · ');
      const cont = recent(e);
      rows.push(ui.h('div', { class: 'card stack wl-cand' + (e.sc >= 6 ? ' best' : '') },
        ui.h('div', { style: 'font-weight:600' }, (cont ? '📋 ' : '🌳 ') + (e.siteName || e.site || 'סקר')), ui.h('div', { class: 'muted small' }, 'באפליקציה · ' + sub),
        ui.h('div', { class: 'row' },
          cont ? ui.h('button', { class: 'btn primary', onclick: ev => busy(ev.currentTarget, async () => {
            r.sid = e.id; r.u = Date.now(); await save(l);
            if (e.local) ui.go('#/s/' + e.id); else await ui.lists.fromCloud(e, false, ev.currentTarget);
          }) }, 'המשך את הסקר הזה') : null,
          ui.h('button', { class: 'btn' + (cont ? '' : ' primary'), onclick: ev => busy(ev.currentTarget, () => ui.lists.fromApp(e, ev.currentTarget, applier(l, r, v, true))) },
            `סקר חדש מהיום על בסיסו (${ui.fmtDate(e.date)})`))));
    }
    for (const x of res.arch) {
      rows.push(ui.h('div', { class: 'card stack wl-cand' + (x.sc >= 6 ? ' best' : '') },
        ui.h('div', { style: 'font-weight:600;overflow-wrap:anywhere' }, '📄 ' + x.f.name.replace(/\.xls[xm]$/i, '')),
        ui.h('div', { class: 'muted small' }, ['ארכיון', x.path.join(' / '), x.f.lastModifiedDateTime ? ui.fmtDate(x.f.lastModifiedDateTime.slice(0, 10)) : ''].filter(Boolean).join(' · ')),
        ui.h('div', { class: 'row' },
          ui.h('button', { class: 'btn primary', onclick: ev => busy(ev.currentTarget, () => ui.lists.fromArchive(x.f, x.path, ev.currentTarget, applier(l, r, v, true))) }, 'סקר חדש מהיום על בסיסו (עם העצים והתמונות)'),
          ui.h('a', { class: 'btn', href: 'https://drive.google.com/file/d/' + encodeURIComponent(x.f.id) + '/view', target: '_blank', rel: 'noopener' }, 'הצג'))));
    }
    status.textContent = rows.length ? `נמצאו ${rows.length} סקרים קודמים שמתאימים (המתאים ביותר למעלה):`
      : res.odOn ? 'לא נמצא סקר קודם באפליקציה או בארכיון.' : 'לא נמצא סקר קודם בטאבלט (בלי חיבור לגוגל דרייב אין חיפוש בארכיון).';
    box.replaceChildren(...rows);
  }

  // ---------- מסכים ----------
  async function render(hash) {
    const parts = hash.split('/');
    const id = parts[2] ? decodeURIComponent(parts[2]) : null;
    if (id) {
      const l = await byId(id);
      if (!l) { U().go('#/lists'); return; }
      return parts[3] === 'setup' ? renderSetup(l) : renderList(l);
    }
    return renderLists();
  }
  // אחרי משיכה מהענן שמשנה משהו: מציירים מחדש, אם לא באמצע הקלדה
  function syncThen(redraw) {
    sync(false).then(ch => { if (ch && !(document.activeElement && document.activeElement.matches('input, textarea, select'))) redraw(); }).catch(() => {});
  }

  async function renderLists() {
    const ui = U(), { h } = ui;
    const lists = (await live()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const pick = h('input', { type: 'file', accept: '.xlsx,.xlsm,.csv,.xls', style: 'display:none' });
    pick.onchange = async () => {
      const f = pick.files[0]; pick.value = '';
      if (f) await importFile(f);
    };
    const local = new Map((await DB.allSurveys()).map(s => [s.id, s]));
    ui.app().replaceChildren(ui.bar('עבודה לפי רשימה', '#/'),
      h('main', { class: 'stack', style: 'max-width:820px;margin:0 auto' },
        h('div', { class: 'card stack' },
          h('div', { class: 'small' }, 'רשימת מוסדות מאקסל (למשל רשימת המעונות מהלקוח): אפשר לערוך את התאים כאן, לבחור איזו עמודה היא הכתובת, העיר, סמל המוסד והמנהל/ת, ולפתוח סקר מכל שורה. לפני הפתיחה האפליקציה מחפשת סקר קודם באותו מקום (גם בארכיון בגוגל דרייב), כדי להתחיל מהסקר של השנה שעברה עם העצים והתמונות.'),
          h('button', { class: 'btn primary big', onclick: () => pick.click() }, '📥 ייבוא רשימה מאקסל'), pick,
          h('div', { class: 'muted small', style: 'text-align:center' }, 'במחשב אפשר גם לגרור את קובץ האקסל לכאן')),
        lists.length ? lists.map(l => {
          const rs = l.rows.filter(r => !r.deleted);
          const st = rs.map(r => r.sid && local.get(r.sid)).filter(Boolean);
          return h('div', { class: 'card survey-item', role: 'button', tabindex: 0, onclick: () => ui.go('#/lists/' + encodeURIComponent(l.id)) },
            h('div', { style: 'flex:1;min-width:0' },
              h('div', { class: 't' }, l.name || 'רשימה'),
              h('div', { class: 'muted small' }, [l.project ? 'פרויקט ' + l.project : null, `${rs.length} שורות`, `${rs.filter(r => r.sid).length} נפתחו`, st.filter(s => s.finished || s.finishPending).length ? `✓ ${st.filter(s => s.finished || s.finishPending).length} הסתיימו` : null].filter(Boolean).join(' · '))),
            h('span', { class: 'arrow', 'aria-hidden': 'true' }, '‹'));
        }) : h('div', { class: 'empty' }, ui.icon('list'), 'עוד אין רשימות. ייבא קובץ אקסל של רשימת מוסדות.')));
    syncThen(renderLists);
  }

  async function importFile(f) {
    const ui = U();
    try {
      const sheets = (await readFile(f)).filter(s => s.rows.some(r => r.some(v => cellText(v))));
      if (!sheets.length) throw new Error('הקובץ ריק');
      const sh = sheets[0];
      const title = sh.rows.slice(0, guessHeader(sh.rows)).flat().map(cellText).filter(t => t.length > 8).sort((a, b) => b.length - a.length)[0];
      const l = { id: uid(), name: (title || f.name.replace(/\.[^.]+$/, '')).slice(0, 120), file: f.name, project: (await DB.getKV('lastProject', '')) || '', type: 'safety',
        raw: sh.rows.map(r => Array.from(r, v => cellText(v))), headerRow: guessHeader(sh.rows), created: Date.now() };
      buildFromRaw(l);
      await addCityColumn(l);
      await save(l);
      ui.go('#/lists/' + encodeURIComponent(l.id) + '/setup');
    } catch (e) { ui.toast('הייבוא נכשל: ' + e.message, 5000); }
  }

  // הגדרות הרשימה: שם, פרויקט, סוג הסקר, העמודות (שם, הוספה, מחיקה) והשיוך לשדות הסקר
  function renderSetup(l) {
    const ui = U(), { h } = ui;
    const draft = JSON.parse(JSON.stringify(l));
    const main = h('main', { class: 'stack', style: 'max-width:820px;margin:0 auto' });
    const back = '#/lists/' + encodeURIComponent(l.id);
    ui.app().replaceChildren(ui.bar({ title: 'הגדרות הרשימה', sub: l.name }, back), main);
    const field = (label, el) => h('div', {}, h('label', { class: 'f' }, label), el);
    const draw = () => {
      const colOpts = sel => [h('option', { value: '', selected: !sel ? '' : null }, '— בלי עמודה —'), ...draft.cols.map(c => h('option', { value: c.id, selected: c.id === sel ? '' : null }, c.name))];
      const sample = draft.rows.find(r => !r.deleted);
      const mapRow = f => {
        const m = draft.map[f.key] = draft.map[f.key] || { col: '', pre: '', prev: !!f.prev };
        const prevEl = h('label', { class: 'row small', style: 'gap:6px' }, h('input', { type: 'checkbox', checked: !!m.prev, onchange: e => { m.prev = e.target.checked; } }), 'אם יש סקר קודם: הערך שלו נשאר');
        const ex = h('div', { class: 'muted small' });
        const upd = () => { ex.textContent = sample ? 'בשורה הראשונה: ' + ([clean(m.pre), m.col ? clean(sample.cells[m.col]) : ''].filter(Boolean).join(' ') || '—') : ''; };
        upd();
        return h('div', { class: 'card stack wl-map' },
          h('b', {}, f.label),
          h('div', { class: 'row', style: 'gap:8px;align-items:stretch' },
            h('div', { style: 'flex:2;min-width:180px' }, field('עמודה ברשימה', h('select', { class: 'in', onchange: e => { m.col = e.target.value; upd(); } }, colOpts(m.col)))),
            h('div', { style: 'flex:1;min-width:150px' }, field('טקסט קבוע לפני', h('input', { class: 'in', value: m.pre || '', placeholder: 'למשל: מעון אמונה', oninput: e => { m.pre = e.target.value; upd(); } })))),
          ex, prevEl);
      };
      main.replaceChildren(
        h('div', { class: 'card stack' },
          field('שם הרשימה', h('input', { class: 'in', value: draft.name || '', oninput: e => { draft.name = e.target.value; } })),
          h('div', { class: 'row', style: 'gap:8px;align-items:stretch' },
            h('div', { style: 'flex:1;min-width:200px' }, field('פרויקט לסקרים (למשל: אמונה)', h('input', { class: 'in', value: draft.project || '', oninput: e => { draft.project = e.target.value; } }))),
            h('div', { style: 'flex:1;min-width:200px' }, field('סוג הסקר', h('select', { class: 'in', onchange: e => { draft.type = e.target.value; draw(); } },
              Object.entries(Construction.TYPES).map(([k, v]) => h('option', { value: k, selected: (draft.type || 'safety') === k ? '' : null }, v)))))),
          draft.raw ? field('שורת הכותרות בקובץ', h('select', { class: 'in', onchange: e => {
            draft.headerRow = +e.target.value; buildFromRaw(draft); addCityColumn(draft).then(draw);
          } }, draft.raw.slice(0, 20).map((r, i) => h('option', { value: i, selected: i === draft.headerRow ? '' : null }, `שורה ${i + 1}: ` + r.filter(Boolean).join(' | ').slice(0, 70))))) : null),
        h('h2', { class: 'proj-head' }, 'איזו עמודה היא מה'),
        h('div', { class: 'muted small' }, 'הערכים נכנסים לפרטי הסקר כשפותחים סקר משורה. "טקסט קבוע לפני" נוסף לפני הערך מהעמודה, ובלי עמודה הוא הערך עצמו (למשל שם המוסד "מעון אמונה" לכל השורות, כמו בסקרים של 2025).'),
        ...fieldsOf(draft).map(mapRow),
        h('h2', { class: 'proj-head' }, `העמודות (${draft.cols.length})`),
        h('div', { class: 'card stack' },
          ...draft.cols.map((c, i) => h('div', { class: 'row', style: 'gap:8px;align-items:center' },
            h('input', { class: 'in', style: 'flex:1', value: c.name, 'aria-label': 'שם העמודה', oninput: e => { c.name = e.target.value; } }),
            h('button', { class: 'icon-btn', title: 'הזז ימינה', disabled: i === 0 ? true : null, onclick: () => { draft.cols.splice(i - 1, 0, draft.cols.splice(i, 1)[0]); draw(); } }, '↑'),
            h('button', { class: 'btn danger', onclick: () => {
              if (!confirm(`למחוק את העמודה "${c.name}" ואת כל הערכים שבה?`)) return;
              draft.cols.splice(i, 1);
              for (const k in draft.map) if (draft.map[k].col === c.id) draft.map[k].col = '';
              draw();
            } }, 'מחק'))),
          h('button', { class: 'btn', onclick: () => { draft.cols.push({ id: 'n' + uid(), name: 'עמודה חדשה' }); draw(); } }, '➕ הוסף עמודה')),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary big', onclick: async () => {
            delete draft.raw; delete draft.headerRow;
            for (const r of draft.rows) for (const k of Object.keys(r.cells)) if (!draft.cols.some(c => c.id === k)) delete r.cells[k];
            Object.assign(l, draft); delete l.raw; delete l.headerRow;
            if (l.project) DB.setKV('lastProject', l.project.trim());
            await save(l); ui.go(back);
          } }, 'שמור'),
          h('button', { class: 'btn', onclick: () => ui.go(back) }, 'ביטול'),
          h('span', { style: 'flex:1' }),
          h('button', { class: 'btn danger', onclick: async () => {
            if (!confirm(`למחוק את הרשימה "${l.name}"? הסקרים שנפתחו ממנה לא נמחקים.`)) return;
            l.deleted = Date.now(); l.rows = []; l.cols = []; delete l.raw;
            await save(l); ui.go('#/lists');
          } }, 'מחק רשימה')));
    };
    draw();
  }

  async function renderList(l) {
    const ui = U(), { h } = ui;
    const local = new Map((await DB.allSurveys()).map(s => [s.id, s]));
    // סקר שנפתח מהשורה במכשיר אחר, לפני שהרשימה סונכרנה: לפי listRef
    for (const s of local.values()) if (s.listRef && s.listRef.list === l.id && !s.deleted) { const r = l.rows.find(x => x.id === s.listRef.row); if (r && !r.sid) { r.sid = s.id; r.u = Date.now(); save(l); } }
    let idx = new Map();
    // סקר שהסתיים ("סיום סקר"): לפי הטאבלט או לפי האינדקס בענן (סקר שהסתיים במכשיר אחר)
    const stateOf = r => {
      if (!r.sid) return { k: 'todo', t: 'טרם' };
      const a = local.get(r.sid), c = idx.get(r.sid), s = a || c;
      if (!s || s.deleted) return { k: 'todo', t: 'הסקר נמחק' };
      if ((a && a.finished) || (c && c.finished)) return { k: 'done', t: '✓ הסתיים', d: ui.fmtDate(s.date) };
      if (a && a.finishPending) return { k: 'done', t: '✓ הסתיים', d: 'ממתין להעלאה' };
      return { k: 'open', t: 'בעבודה', d: ui.fmtDate(s.date) };
    };
    let filter = 'all';
    const q = h('input', { class: 'in', type: 'search', placeholder: 'חיפוש ברשימה', style: 'flex:1;min-width:160px' });
    const table = h('div', { class: 'wl-wrap' });
    const counts = h('div', { class: 'muted small', role: 'status' });
    const chipsBox = h('div', { class: 'project-chips' });
    const saveSoon = ui.debounce(() => save(l), 600);
    const draw = () => {
      const rs = l.rows.filter(r => !r.deleted);
      const n = { all: rs.length, todo: 0, open: 0, done: 0 };
      for (const r of rs) n[stateOf(r).k]++;
      chipsBox.replaceChildren(...[['all', 'הכל'], ['todo', 'טרם נפתחו'], ['open', 'בעבודה'], ['done', 'הסתיימו']].map(([k, t]) =>
        h('button', { class: 'chip' + (filter === k ? ' on' : ''), onclick: () => { filter = k; draw(); } }, `${t} (${n[k]})`)));
      const words = norm(q.value).split(' ').filter(Boolean);
      const shown = rs.filter(r => (filter === 'all' || stateOf(r).k === filter) && words.every(w => norm(Object.values(r.cells).join(' ')).includes(w)));
      counts.textContent = shown.length === rs.length ? `${rs.length} שורות` : `${shown.length} מתוך ${rs.length} שורות`;
      // רוחב כל עמודה לפי הטקסט הארוך בה (בגבולות), כדי שכתובת שלמה תיראה בלי לגלול בתוך התא
      const width = new Map(l.cols.map(c => [c.id, Math.min(38, Math.max(8, c.name.length, ...rs.map(r => (r.cells[c.id] || '').length)) + 2)]));
      const mapped = new Map(Object.entries(l.map || {}).filter(([k, m]) => m.col && fieldsOf(l).some(f => f.key === k)).map(([k, m]) => [m.col, FIELDS.find(f => f.key === k).label]));
      table.replaceChildren(h('table', { class: 'wl-table' },
        h('thead', {}, h('tr', {}, h('th', { class: 'wl-act' }, 'סקר'), ...l.cols.map(c => h('th', {}, c.name, mapped.has(c.id) ? h('div', { class: 'wl-tag' }, '← ' + mapped.get(c.id)) : null)), h('th', {}))),
        h('tbody', {}, shown.map(r => {
          const st = stateOf(r);
          return h('tr', { class: 'st-' + st.k },
            h('td', { class: 'wl-act' },
              h('button', { class: 'btn ' + (st.k === 'todo' ? 'primary' : ''), onclick: () => openRow(l, r) }, st.k === 'todo' ? 'פתח סקר' : 'פתח'),
              h('div', { class: 'wl-badge ' + st.k }, st.t), st.d ? h('div', { class: 'wl-st small' }, st.d) : null,
              r.sid ? h('button', { class: 'link-btn small', onclick: () => { if (!confirm('לנתק את השורה מהסקר? הסקר עצמו לא נמחק.')) return; delete r.sid; r.u = Date.now(); save(l); draw(); } }, 'נתק') : null),
            ...l.cols.map(c => h('td', {}, h('input', { class: 'wl-cell', value: r.cells[c.id] || '', 'aria-label': c.name, style: `width:${width.get(c.id)}ch`,
              oninput: e => { r.cells[c.id] = e.target.value; r.u = Date.now(); saveSoon(); } }))),
            h('td', {}, h('button', { class: 'icon-btn', title: 'מחק שורה', 'aria-label': 'מחק שורה', onclick: () => {
              if (!confirm('למחוק את השורה מהרשימה?')) return;
              r.deleted = Date.now(); r.u = Date.now(); r.cells = {}; save(l); draw();
            } }, '✕')));
        }))));
    };
    q.addEventListener('input', draw);
    const exportXlsx = async () => {
      const rs = l.rows.filter(r => !r.deleted);
      const rows = [[...l.cols.map(c => c.name), 'סטטוס סקר'], ...rs.map(r => [...l.cols.map(c => { const v = r.cells[c.id] || ''; return /^\d{1,9}$/.test(v) ? +v : v; }), stateOf(r).t])];
      const blob = await Reports.xlsx(rows, { sheet: 'רשימה', widths: [...l.cols.map(() => 20), 18] });
      ui.downloadFile(blob, ui.safeName(l.name || 'רשימה') + '.xlsx');
    };
    ui.app().replaceChildren(ui.bar({ title: l.name || 'רשימה', sub: [l.project ? 'פרויקט ' + l.project : null, Construction.TYPES[l.type || 'safety']].filter(Boolean).join(' · ') }, '#/lists'),
      h('main', { class: 'stack' },
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, q,
          h('button', { class: 'btn', onclick: () => ui.go('#/lists/' + encodeURIComponent(l.id) + '/setup') }, ui.icon('gear'), 'שיוך עמודות והגדרות'),
          h('button', { class: 'btn', onclick: () => { l.rows.push({ id: uid(), cells: {}, u: Date.now() }); save(l); filter = 'all'; q.value = ''; draw(); const ins = table.querySelectorAll('tbody tr:last-child input'); if (ins[0]) ins[0].focus(); } }, '➕ שורה'),
          h('button', { class: 'btn', onclick: exportXlsx }, '⬇ אקסל')),
        chipsBox, counts, table));
    draw();
    // סקרים שנפתחו במכשיר אחר: הסטטוס מהאינדקס בענן
    if (navigator.onLine !== false && await OD.connected()) Sync.cloudIndex().then(list => { idx = new Map(list.map(e => [e.id, e])); if (!table.contains(document.activeElement)) draw(); }).catch(() => {});
    syncThen(async () => { const n = await byId(l.id); if (n) { Object.assign(l, n); draw(); } else ui.go('#/lists'); });
  }

  // גרירת קובץ רשימה (אקסל / CSV) למסכי הרשימות: ייבוא כרשימה חדשה
  (function initDrop() {
    let depth = 0, mark = null;
    const on = () => (location.hash || '').startsWith('#/lists');
    const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    const hide = () => { depth = 0; if (mark) { mark.remove(); mark = null; } };
    window.addEventListener('dragenter', e => {
      if (!hasFiles(e) || !on()) return;
      e.preventDefault(); depth++;
      if (!mark) { mark = document.createElement('div'); mark.className = 'drop-plan'; mark.innerHTML = '<div>📥 שחרר כדי לייבא את הרשימה</div>'; document.body.append(mark); }
    });
    window.addEventListener('dragover', e => { if (hasFiles(e) && on()) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    window.addEventListener('dragleave', () => { if (mark && --depth <= 0) hide(); });
    window.addEventListener('drop', async e => {
      if (!hasFiles(e) || !on()) return;
      e.preventDefault(); hide();
      const f = [...e.dataTransfer.files].find(x => /\.(xlsx|xlsm|csv|xls)$/i.test(x.name));
      if (!f) { U().toast('אפשר לגרור קובץ אקסל (xlsx) או CSV', 3500); return; }
      await importFile(f);
    });
  })();

  root.WorkLists = { render, sync, _t: { norm, streetKey, scoreOf, guessHeader, buildFromRaw, valuesOf, mergeList, parseCsv } };
})(window);

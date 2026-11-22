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

  // שדות הסקר שאפשר לשייך להם עמודה. prev: כשפותחים על בסיס סקר קודם, הערך מהסקר הקודם נשאר (כבוי כברירת מחדל: הפרטים מהרשימה)
  const FIELDS = [
    { key: 'siteName', label: 'שם המוסד / האתר', re: /שם\s*ה?(מוסד|מעון|גן|אתר|בית\s*ספר|בי"ס)|^שם$|^מוסד|^מעון/, safetyOnly: true },
    { key: 'street', label: 'רחוב ומספר', re: /כתובת|רחוב/ },
    { key: 'city', label: 'עיר', re: /^עיר|ישוב|יישוב|רשות|^מקום$/ },
    { key: 'code', label: 'סמל מוסד', re: /סמל/, safetyOnly: true },
    { key: 'manager', label: 'מנהל/ת', re: /מנהל|אחראי|איש\s*קשר/, safetyOnly: true },
    { key: 'gush', label: 'גוש', re: /^גוש/, buildOnly: true },
    { key: 'helka', label: 'חלקה', re: /^חלק/, buildOnly: true },
  ];
  const fieldsOf = l => FIELDS.filter(f => l.type === 'construction' ? !f.safetyOnly : !f.buildOnly);
  // ימי עבודה (1.117): עמודה בשם "יום" מחלקת את הרשימה לימים (מפרידים בטבלה, צ'יפים לכל יום, ובמסלול רק התחנות של היום)
  const dayCol = l => (l.cols || []).find(c => /^יום(\s*עבודה)?$/.test(String(c.name || '').trim())) || null;
  const daysOf = l => { const c = dayCol(l); if (!c) return []; return [...new Set(l.rows.filter(r => !r.deleted).map(r => clean(r.cells[c.id])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he', { numeric: true })); };
  // עמודות מוסתרות (1.117): נשארות ברשימה ובשיוך לשדות, רק לא מוצגות בטבלה
  const visCols = l => (l.cols || []).filter(c => !(l.hide || []).includes(c.id));

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
    if (n.deleted) return n; // מחיקה שבוטלה (שמירה חדשה יותר בלי deleted) מחזירה את הרשימה
    const rows = new Map(o.rows.map(r => [r.id, r]));
    for (const r of n.rows) { const x = rows.get(r.id); rows.set(r.id, !x || (r.u || 0) >= (x.u || 0) ? r : x); }
    const order = [...n.rows.map(r => r.id), ...o.rows.map(r => r.id).filter(id => !n.rows.some(r => r.id === id))];
    const out = Object.assign({}, n, { rows: order.map(id => rows.get(id)) });
    // מסמכים (1.116.0): מתמזגים לפי מסמך, כמו השורות
    const docs = root.ListDocs ? ListDocs.merge(n.docs, o.docs) : n.docs;
    if (docs) out.docs = docs;
    return out;
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
      const col = l.cols.find(c => f.re.test(c.name) && !(f.key === 'siteName' && /מנהל/.test(c.name)) && !Object.values(l.map).some(m => colsOf(m).includes(c.id)));
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
    l.map.city = { col: id, pre: '', prev: false };
  }

  // העמודות של שדה, לפי הסדר (1.118: אפשר כמה, למשל סוג המוסד ואחריו שם המוסד)
  const colsOf = m => m ? [m.col, ...(m.more || [])].filter(Boolean) : [];
  const setCols = (m, arr) => { arr = arr.filter((c, i) => c && arr.indexOf(c) === i); m.col = arr[0] || ''; if (arr.length > 1) m.more = arr.slice(1); else delete m.more; };
  // ערכי הסקר לשורה, לפי השיוך
  function valuesOf(l, r) {
    const out = {};
    for (const f of fieldsOf(l)) {
      const m = l.map[f.key] || {};
      const v = [clean(m.pre), ...colsOf(m).map(c => clean(r.cells[c]))].filter(Boolean).join(' ');
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
    // מוסד עם שני סמלים ("629477 406512"): מספיק שאחד מהם תואם
    const codes = c => String(c || '').split(/[^\d]+/).filter(x => x.length >= 3);
    if (v.code && code && (codes(code).some(x => codes(v.code).includes(x)) || String(code).replace(/\D+/g, '') === String(v.code).replace(/\D+/g, ''))) sc += 10;
    const city = norm(v.city), first = city.split(' ')[0];
    const cityHit = city && (hay.includes(city) || (first.length >= 3 && hasWord(hay, first)));
    if (cityHit) sc += 3;
    const { word, num } = streetKey(v.street);
    const stHit = word && word.length >= 2 && hasWord(hay, word);
    const numHit = !!(stHit && num && hasWord(hay, num));
    if (stHit) sc += numHit ? 4 : 3;
    return { sc, cityHit, stHit, numHit };
  }
  // כל המילים בכל התאים של השורה (בלי טלפונים): לחיפוש ולדירוג. מילים כלליות לא נספרות
  const STOP = new Set(['מעון', 'גן', 'בית', 'ספר', 'סקר', 'עצים', 'יציבות', 'בטיחות', 'של', 'על', 'את', 'עם']);
  function rowWords(l, r, v) {
    const cells = [...Object.values(r.cells || {}), ...Object.values(v)].map(clean).filter(c => c && !/^\+?[\d\s\-()]{7,}$/.test(c));
    const out = new Set();
    for (const c of cells) for (const w of norm(c).split(' ')) {
      if (!w || STOP.has(w)) continue;
      if (/^\d+$/.test(w) ? w.length <= 6 : w.length >= 2) out.add(w);
    }
    return [...out];
  }
  // ציון: סמל מוסד, עיר, רחוב+מספר, ועוד נקודה לכל מילה מהשורה שמופיעה בשם / בתיקייה
  function scoreAll(v, words, text, code) {
    const x = scoreOf(v, text, code);
    const hay = norm(text);
    x.hits = words.filter(w => hasWord(hay, w)).length;
    x.sc += x.hits;
    return x;
  }
  const yearOf = (path, f) => { const yi = path.findIndex(n => /^\s*(19|20)\d\d\s*$/.test(n)); return yi >= 0 ? path[yi].trim() : (f.lastModifiedDateTime || '').slice(0, 4); };
  // קבצים בארכיון (כמו בחיפוש הרגיל), עם התיקייה והשנה, בלי עותקי האפליקציה
  // folder: תיקייה בדרייב של הרשימה (למשל "אמונה 2025"); בלי: תיקיית הארכיון מההגדרות
  async function archiveFiles(terms, folder) {
    const archive = folder || await DB.getKV('gdArchive', null);
    const files = new Map();
    for (const res of await Promise.all(terms.map(t => OD.searchExcel(t, archive && archive.id, folder ? 'gdTreeList' : undefined).catch(() => []))))
      for (const f of res) files.set(f.id, f);
    const list = [...files.values()];
    const paths = await Promise.all(list.map(f => U().pathOf(f).catch(() => [])));
    return list.map((f, i) => ({ kind: 'file', f, path: paths[i], year: yearOf(paths[i], f) }))
      .filter(x => !x.path.some(n => /^גיבוי אפליקציית סקרי עצים$/.test(n)) && !/^טעינת עצים/.test(x.f.name));
  }
  // סקרים באפליקציה (בטאבלט ובאינדקס בענן) ובארכיון (קובצי אקסל, מכל השנים) שמתאימים לשורה
  // כל הסקרים באפליקציה (בטאבלט ובאינדקס בענן) מסוג הרשימה
  async function appEntries(l) {
    const local = await DB.allSurveys();
    let cloud = [];
    const odOn = navigator.onLine !== false && await OD.connected();
    if (odOn) cloud = await Sync.cloudIndex().catch(() => []);
    const ents = new Map(cloud.filter(e => !e.deleted).map(e => [e.id, Object.assign({ kind: 'app' }, e)]));
    for (const s of local) if (!s.deleted) ents.set(s.id, Object.assign({}, ents.get(s.id) || {}, { kind: 'app', id: s.id, local: true, type: s.type, code: s.code, siteName: s.siteName || s.site, street: s.street, city: s.city, site: s.site, manager: s.manager, date: s.date, finished: s.finished, dataId: (ents.get(s.id) || {}).dataId || s.odDataId }));
    const type = l.type === 'construction' ? 'construction' : 'safety';
    return { odOn, list: [...ents.values()].filter(e => (e.type === 'construction' ? 'construction' : 'safety') === type) };
  }
  async function candidates(l, r, v, onArchive) {
    const words = rowWords(l, r, v);
    const { odOn, list } = await appEntries(l);
    const app = list
      .map(e => Object.assign(e, scoreAll(v, words, [e.siteName, e.street, e.city, e.site, e.manager].join(' '), e.code)))
      .filter(e => e.sc >= 10 || (e.cityHit && e.stHit) || (e.cityHit && e.hits >= 3))
      .sort((a, b) => b.sc - a.sc || (b.date || '').localeCompare(a.date || '')).slice(0, 8);
    let arch = [];
    if (odOn && onArchive) {
      onArchive();
      // שאילתות לדרייב: סמל, מילת הרחוב, העיר, ועוד המילים הארוכות מהתאים האחרים (גם בתוך תוכן הקבצים)
      const { word } = streetKey(v.street);
      const extra = words.filter(w => !/^\d+$/.test(w) && w.length >= 3).sort((a, b) => b.length - a.length);
      const codeTerms = String(v.code || '').split(/[^\d]+/).filter(x => x.length >= 3);
      const terms = [...new Set([...(codeTerms.length > 1 ? codeTerms : [v.code || '']), word && word.length >= 2 ? word : '', clean(v.city), ...extra].filter(Boolean))].slice(0, 7);
      arch = (await archiveFiles(terms))
        .map(x => Object.assign(x, scoreAll(v, words, x.f.name.replace(/\.xls[xm]$/i, '') + ' ' + x.path.slice(-2).join(' '), '')))
        .filter(x => x.cityHit || x.numHit || x.hits >= 2)
        .sort((a, b) => b.sc - a.sc || (b.year || '').localeCompare(a.year || '') || (b.f.lastModifiedDateTime || '').localeCompare(a.f.lastModifiedDateTime || '')).slice(0, 15);
    }
    return { app, arch, odOn, words };
  }

  // ---------- פתיחת סקר משורה ----------
  // השדות מהרשימה נכנסים לסקר. בפתיחה על בסיס סקר קודם, שדה שמסומן "מהסקר הקודם" נשאר כמו שהיה שם (אם יש בו ערך)
  function applier(l, r, v, fromPrev) {
    return s => {
      for (const f of fieldsOf(l)) {
        if (!v[f.key]) continue;
        if (fromPrev && (l.map[f.key] || {}).prev && clean(s[f.key])) continue;
        // שני סמלי מוסד בתא אחד: שניהם נכנסים לדוח, מופרדים בפסיק
        s[f.key] = f.key === 'code' && root.Reports ? root.Reports.codeText(v[f.key]) : v[f.key];
      }
      if (l.project) s.project = l.project;
      // שורה שכתוב בה "אורנים" (למשל בהערות): הסקר נפתח כסקר אורנים (חלון פרטי אורנים, תזכורות, אקסל ריכוז)
      if (l.type !== 'construction' && Object.values(r.cells || {}).some(v => /(^|[\s,;(])[הו]?או?רני?ם/.test(String(v || '')))) s.pinesMode = true;
      s.listRef = { list: l.id, row: r.id, name: l.name };
      s.site = U().composeSite(s);
      r.sid = s.id; r.u = Date.now();
      save(l);
    };
  }
  // ---------- קישור שורות לסקרים משנים קודמות (1.109) ----------
  // סקר קודם שבחרת לשורה (בחיפוש): "פתח" ממשיך ממנו ישר
  function prevOf(x) {
    return x.kind === 'file'
      ? { kind: 'file', year: x.year, name: x.f.name.replace(/\.xls[xm]$/i, ''), f: { id: x.f.id, name: x.f.name, parents: x.f.parents, lastModifiedDateTime: x.f.lastModifiedDateTime }, path: x.path, t: Date.now() }
      : { kind: 'app', year: (x.date || '').slice(0, 4), name: x.siteName || x.site || 'סקר', e: { id: x.id, local: !!x.local, type: x.type, dataId: x.dataId, code: x.code, siteName: x.siteName, street: x.street, city: x.city, site: x.site, date: x.date, project: x.project }, t: Date.now() };
  }
  // תיקייה בדרייב לרשימה: שם מחפשים קודם את הסקרים הקודמים
  async function pickListFolder(l, done) {
    const ui = U();
    const start = l.folder || await DB.getKV('gdArchive', null);
    ui.pickDriveFolder(async val => {
      if (val) l.folder = val; else delete l.folder;
      await save(l);
      ui.toast(val ? `החיפוש של הרשימה יהיה בתיקייה "${val.name}"` : 'החיפוש של הרשימה בארכיון הרגיל', 3000);
      if (done) done();
    }, start, 'הסקרים הקודמים של הרשימה יחופשו קודם בתיקייה שתבחר ובכל התיקיות שבתוכה (למשל אמונה 2025)');
  }
  async function openFromPrev(l, r) {
    const ui = U(), v = valuesOf(l, r), p = r.prev, b = ui.h('button');
    ui.toast(`פותח סקר חדש מהיום על בסיס הסקר מ-${p.year || 'שנה קודמת'}: העצים וההערות משם, הפרטים מהרשימה…`, 4000);
    try {
      if (p.kind === 'file') await ui.lists.fromArchive(p.f, p.path || [], b, applier(l, r, v, true));
      else await ui.lists.fromApp(p.e, b, applier(l, r, v, true));
    } catch (e) { ui.toast('הפתיחה מהסקר הקודם נכשלה: ' + e.message + '. בחר סקר אחר.', 5000); openRow(l, r, true); }
  }
  async function openRow(l, r, choose, onLinked) {
    if (!choose && !r.sid && r.prev && !r.prev.none) return openFromPrev(l, r);
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
    const status = ui.h('div', { class: 'muted small' }, 'בחר לפי מה לחפש (אפשר כמה), או הקלד בעצמך, ולחץ חפש. החיפוש כמו ב"חיפוש סקרים בענן": בסקרים באפליקציה ובארכיון בדרייב.');
    const box = ui.h('div', { class: 'stack' });
    const close = () => ov.remove();
    // חיפוש חופשי בארכיון, כמו ב"חיפוש סקרים בענן", אם התוצאה הנכונה לא הופיעה
    const q = ui.h('input', { class: 'in', type: 'search', value: '', placeholder: 'שם, רחוב, עיר, סמל או שם קובץ', style: 'flex:1;min-width:160px' });
    // כפתור לכל עמודה בשורה (סמל, כתובת, שם המוסד…): בחירה מכניסה את הערך שלה לחיפוש
    const colVal = c => { const x = clean(r.cells[c.id]); return c.id === (l.map.street || {}).col ? geoStreet(x) : x; };
    const cols = l.cols.filter(c => colVal(c) && !/^\+?[\d\s\-()]{7,}$/.test(colVal(c)) && !/^\d{1,3}$/.test(colVal(c)));
    const picked = new Set();
    const first = cols.find(c => c.id === (l.map.code || {}).col) || cols.find(c => c.id === (l.map.street || {}).col) || cols[0];
    if (first) picked.add(first.id);
    const chipsEl = ui.h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' });
    const drawChips = () => chipsEl.replaceChildren(ui.h('span', { class: 'small', style: 'font-weight:700' }, 'חפש לפי:'), ...cols.map(c => ui.h('button', { class: 'chip' + (picked.has(c.id) ? ' on' : ''), title: c.name, onclick: () => {
      picked.has(c.id) ? picked.delete(c.id) : picked.add(c.id);
      q.value = cols.filter(x => picked.has(x.id)).map(colVal).join(' ');
      drawChips(); if (q.value) freeSearch();
    } }, ui.h('span', { class: 'muted' }, c.name + ': '), colVal(c))));
    q.value = cols.filter(x => picked.has(x.id)).map(colVal).join(' ');
    drawChips();
    // איפה לחפש בדרייב: בתיקייה של הרשימה (ברירת מחדל, אם נבחרה) או בארכיון הרגיל
    let scope = l.folder ? 'list' : 'all';
    const scopeEl = ui.h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' });
    const drawScope = async () => {
      const arch = await DB.getKV('gdArchive', null);
      const set = v => { scope = v; drawScope(); if (q.value.trim()) freeSearch(); };
      scopeEl.replaceChildren(ui.h('span', { class: 'small', style: 'font-weight:700' }, 'בדרייב:'),
        l.folder ? ui.h('button', { class: 'chip' + (scope === 'list' ? ' on' : ''), onclick: () => set('list') }, '📁 ' + l.folder.name) : null,
        ui.h('button', { class: 'chip' + (scope === 'all' ? ' on' : ''), onclick: () => set('all') }, '🗂 הארכיון הרגיל' + (arch ? ` (${arch.name.split(' / ').pop()})` : ' (כל הדרייב)')),
        ui.h('button', { class: 'link-btn small', onclick: () => pickListFolder(l, () => { scope = 'list'; drawScope(); }) }, l.folder ? 'החלף תיקייה לרשימה' : '📁 בחר תיקייה לרשימה'));
    };
    drawScope();
    const qBtn = ui.h('button', { class: 'btn', onclick: () => freeSearch() }, '🔎 חפש סקר קודם');
    q.addEventListener('keydown', e => { if (e.key === 'Enter') freeSearch(); });
    const ov = ui.h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
      ui.h('div', { class: 'card stack', style: 'max-width:720px;width:96%' },
        ui.h('h2', { style: 'margin:0;font-size:21px' }, 'סקר עבור ' + title),
        ui.h('div', { class: 'muted small' }, [v.code ? 'סמל ' + v.code : null, v.manager ? 'מנהל/ת: ' + v.manager : null, l.project ? 'פרויקט ' + l.project : null].filter(Boolean).join(' · ')),
        ui.h('button', { class: 'btn big block', onclick: () => { close(); ui.lists.blank(l.type || 'safety', applier(l, r, v, false)); } }, '➕ סקר חדש ריק (בלי סקר קודם)'),
        chipsEl, scopeEl,
        ui.h('div', { class: 'row', style: 'gap:8px' }, q, qBtn),
        status, box,
        ui.h('button', { class: 'btn', onclick: close }, 'ביטול')));
    document.body.append(ov);

    const busy = async (btn, fn) => { for (const b of ov.querySelectorAll('button')) b.disabled = true; try { await fn(); } finally { if (document.body.contains(ov)) { close(); } } };
    // רק לקשר (בלי לפתוח עכשיו): "פתח" בטבלה ימשיך מהסקר הזה
    const linkBtn = x => r.sid ? null : ui.h('button', { class: 'btn', title: 'השורה תזכור את הסקר הזה, ו"פתח" ימשיך ממנו', onclick: async () => {
      r.prev = Object.assign(prevOf(x), { manual: true }); r.u = Date.now(); await save(l); close(); ui.toast('השורה קושרה לסקר מ-' + (r.prev.year || 'שנה קודמת'), 2500); if (onLinked) onLinked();
    } }, '🔗 קשר לשורה');
    const recent = e => e.date && (Date.now() - new Date(e.date).getTime()) < 120 * 864e5;
    const appCard = e => {
      const sub = [e.code ? 'סמל ' + e.code : null, [e.street, e.city].filter(Boolean).join(', '), e.finished ? '✓ הסתיים' : null].filter(Boolean).join(' · ');
      const cont = recent(e);
      return ui.h('div', { class: 'card stack wl-cand' + (e.sc >= 7 ? ' best' : '') },
        ui.h('div', { class: 'row', style: 'gap:8px;align-items:center' }, ui.h('span', { class: 'wl-year' }, (e.date || '').slice(0, 4) || '—'),
          ui.h('b', { style: 'flex:1;min-width:0' }, (e.siteName || e.site || 'סקר')), ui.h('span', { class: 'muted small' }, ui.fmtDate(e.date))),
        ui.h('div', { class: 'muted small' }, 'באפליקציה · ' + sub),
        ui.h('div', { class: 'row' },
          cont ? ui.h('button', { class: 'btn primary', onclick: ev => busy(ev.currentTarget, async () => {
            r.sid = e.id; r.u = Date.now(); await save(l);
            if (e.local) ui.go('#/s/' + e.id); else await ui.lists.fromCloud(e, false, ev.currentTarget);
          }) }, 'המשך את הסקר הזה') : null,
          ui.h('button', { class: 'btn' + (cont ? '' : ' primary'), onclick: ev => busy(ev.currentTarget, () => ui.lists.fromApp(e, ev.currentTarget, applier(l, r, v, true))) },
            'סקר חדש מהיום על בסיסו'), linkBtn(e)));
    };
    const fileCard = x => ui.h('div', { class: 'card stack wl-cand' + (x.sc >= 7 ? ' best' : '') },
      ui.h('div', { class: 'row', style: 'gap:8px;align-items:center' }, ui.h('span', { class: 'wl-year' }, x.year || '—'),
        ui.h('b', { style: 'flex:1;min-width:0;overflow-wrap:anywhere' }, '📄 ' + x.f.name.replace(/\.xls[xm]$/i, ''))),
      ui.h('div', { class: 'muted small' }, [x.path.join(' / '), x.f.lastModifiedDateTime ? 'עודכן ' + ui.fmtDate(x.f.lastModifiedDateTime.slice(0, 10)) : ''].filter(Boolean).join(' · ')),
      ui.h('div', { class: 'row' },
        ui.h('button', { class: 'btn primary', onclick: ev => busy(ev.currentTarget, () => ui.lists.fromArchive(x.f, x.path, ev.currentTarget, applier(l, r, v, true))) }, '📂 סקר חדש מהיום (עם העצים והתמונות)'),
        ui.h('a', { class: 'btn', href: 'https://drive.google.com/file/d/' + encodeURIComponent(x.f.id) + '/view', target: '_blank', rel: 'noopener' }, 'הצג את האקסל'), linkBtn(x)));
    // חיפוש חופשי כמו ב"חיפוש סקרים בענן": בסקרים של האפליקציה (שם, סמל, רחוב, עיר, פרויקט) ובארכיון בדרייב
    async function freeSearch() {
      const t = q.value.trim();
      if (!t) return;
      qBtn.disabled = true; status.textContent = 'מחפש…';
      try {
        const words = norm(t).split(' ').filter(Boolean);
        const { odOn, list } = await appEntries(l);
        const app = list.filter(e => { const hay = norm([e.code, e.siteName, e.street, e.city, e.project, e.site, e.manager].join(' ')); return words.every(w => hay.includes(w)); })
          .sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 25).map(e => Object.assign(e, { sc: 0 }));
        let found = [];
        if (odOn) {
          status.textContent = scope === 'list' ? `מחפש גם בתיקייה "${l.folder.name}" בדרייב…` : 'מחפש גם בארכיון בגוגל דרייב…';
          found = (await archiveFiles([t], scope === 'list' ? l.folder : null)).sort((a, b) => (b.year || '').localeCompare(a.year || '') || (b.f.lastModifiedDateTime || '').localeCompare(a.f.lastModifiedDateTime || ''));
        }
        const n = app.length + found.length;
        status.textContent = n ? `${app.length} סקרים באפליקציה ו-${found.length} קבצים בארכיון עבור "${t}" (מהחדש לישן):`
          : `לא נמצא דבר עבור "${t}"` + (odOn ? '' : ' (בלי חיבור לגוגל דרייב החיפוש רק בטאבלט)');
        box.replaceChildren(...app.map(appCard), ...found.slice(0, 40).map(x => fileCard(Object.assign(x, { sc: words.every(w => hasWord(norm(x.f.name), w)) ? 7 : 0 }))));
      } catch (e) { status.textContent = 'החיפוש נכשל: ' + e.message; }
      finally { qBtn.disabled = false; }
    }
  }

  // ---------- מסכים ----------
  async function render(hash) {
    const parts = hash.split('/');
    const id = parts[2] ? decodeURIComponent(parts[2]) : null;
    if (id) {
      const l = await byId(id);
      if (!l) { U().go('#/lists'); return; }
      // 1.109: פרטי הסקר (שם, כתובת, סמל…) תמיד מהרשימה החדשה; העצים וההערות מהסקר הקודם
      if (!l.mapV) { for (const m of Object.values(l.map || {})) if (m) m.prev = false; l.mapV = 2; await save(l); }
      // 1.110: בלי חיבור אוטומטי לסקרים קודמים (רק מה שבחרת בעצמך נשאר)
      if (l.mapV < 3) { for (const r of l.rows) if (r.prev && !r.prev.manual) { delete r.prev; r.u = Date.now(); } l.mapV = 3; await save(l); }
      return parts[3] === 'setup' ? renderSetup(l) : parts[3] === 'route' ? renderRoute(l) : renderList(l);
    }
    return renderLists();
  }
  // אחרי משיכה מהענן שמשנה משהו: מציירים מחדש, אם לא באמצע הקלדה
  function syncThen(redraw) {
    sync(false).then(ch => { if (ch && !(document.activeElement && document.activeElement.matches('input, textarea, select'))) redraw(); }).catch(() => {});
  }

  let listQuery = '';
  async function renderLists() {
    const ui = U(), { h } = ui;
    const lists = (await live()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const pick = h('input', { type: 'file', accept: '.xlsx,.xlsm,.csv,.xls', style: 'display:none' });
    pick.onchange = async () => {
      const f = pick.files[0]; pick.value = '';
      if (f) await importFile(f);
    };
    const local = new Map((await DB.allSurveys()).map(s => [s.id, s]));
    const active = lists.filter(l => !l.finished && !l.offHome), finished = lists.filter(l => l.finished), hidden = lists.filter(l => !l.finished && l.offHome);
    // חיפוש בכל הרשימות (גם שהסתיימו או הוסרו), לפי שם, פרויקט, קובץ או כל תא, כמו "חיפוש סקרים בענן"
    const sq = h('input', { class: 'in', type: 'search', placeholder: 'חיפוש ברשימות: שם, פרויקט, מוסד, סמל, עיר…', style: 'font-size:17px', value: listQuery });
    const found = h('div', { class: 'stack' });
    const normal = h('div', { class: 'stack' });
    const doSearch = () => {
      listQuery = sq.value;
      const words = norm(sq.value).split(' ').filter(Boolean);
      if (!words.length) { found.replaceChildren(); normal.classList.remove('hidden'); return; }
      const hits = lists.map(l => {
        const meta = norm([l.name, l.project, l.file].join(' '));
        const rowsHit = l.rows.filter(r => !r.deleted && words.every(w => (meta + ' ' + norm(Object.values(r.cells).join(' '))).includes(w)));
        return { l, ok: words.every(w => meta.includes(w)) || rowsHit.length, rowsHit };
      }).filter(x => x.ok);
      normal.classList.add('hidden');
      found.replaceChildren(h('div', { class: 'muted small' }, hits.length ? `${hits.length} רשימות` : 'לא נמצאו רשימות'),
        ...hits.map(x => h('div', { class: 'stack', style: 'gap:4px' }, card(x.l),
          x.rowsHit.length && x.rowsHit.length < x.l.rows.filter(r => !r.deleted).length ? h('div', { class: 'muted small', style: 'padding-inline-start:12px' },
            'נמצא בשורות: ' + x.rowsHit.slice(0, 6).map(r => Object.values(r.cells).filter(Boolean).slice(0, 3).join(' ')).join(' · ') + (x.rowsHit.length > 6 ? ' …' : '')) : null)));
    };
    sq.addEventListener('input', doSearch);
    // כמו בסקרים: סיום רשימה, הסרה מהמסך (בלי מחיקה), החזרה ומחיקה (עם ביטול)
    const act = (label, title, fn, cls) => h('button', { class: 'btn ' + (cls || ''), title, onclick: e => { e.stopPropagation(); fn(); }, onkeydown: e => e.stopPropagation() }, label);
    const card = l => {
      const rs = l.rows.filter(r => !r.deleted);
      const doneN = rs.filter(r => { const s = r.sid && local.get(r.sid); return s && (s.finished || s.finishPending); }).length;
      const allDone = rs.length && doneN === rs.length;
      return h('div', { class: 'card survey-item wl-lcard' + (l.finished ? ' fin' : ''), role: 'button', tabindex: 0, onclick: () => ui.go('#/lists/' + encodeURIComponent(l.id)),
        onkeydown: e => { if (e.key === 'Enter') ui.go('#/lists/' + encodeURIComponent(l.id)); } },
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { class: 't' }, l.name || 'רשימה'),
          h('div', { class: 'muted small' }, [l.project ? 'פרויקט ' + l.project : null, `${rs.length} מוסדות`, `${rs.filter(r => r.sid).length} נפתחו`, doneN ? `✓ ${doneN} הסתיימו` : null, l.finished ? 'הרשימה הסתיימה ' + new Date(l.finished).toLocaleDateString('he-IL') : null].filter(Boolean).join(' · ')),
          allDone && !l.finished ? h('div', { class: 'small', style: 'font-weight:700;color:var(--accent);margin-top:4px' }, '✓ כל המוסדות ברשימה הסתיימו') : null,
          h('div', { class: 'row', style: 'gap:6px;margin-top:8px;flex-wrap:wrap' },
            l.finished || l.offHome
              ? act('↩ החזר לפעילות', 'החזר לרשימות הפעילות', () => setState(l, { finished: null, offHome: null }), 'primary')
              : [act('✓ סיום רשימה', 'הרשימה עוברת ל"רשימות שהסתיימו"', () => setState(l, { finished: Date.now() }), allDone ? 'primary' : ''),
                act('הסר מהמסך', 'הרשימה נשמרת ואפשר להחזיר אותה', () => setState(l, { offHome: Date.now() }))],
            act('🗑 מחק', 'מחיקת הרשימה (הסקרים לא נמחקים)', () => removeList(l), 'danger'))),
        h('span', { class: 'arrow', 'aria-hidden': 'true' }, '‹'));
    };
    async function setState(l, ch) {
      for (const [k, v] of Object.entries(ch)) { if (v == null) delete l[k]; else l[k] = v; }
      await save(l);
      ui.toast(ch.finished ? 'הרשימה הסתיימה ועברה ל"רשימות שהסתיימו"' : ch.offHome ? 'הרשימה הוסרה מהמסך ולא נמחקה' : 'הרשימה חזרה לפעילות', 3500,
        ch.finished || ch.offHome ? 'בטל' : null, () => setState(l, { finished: null, offHome: null }));
      renderLists();
    }
    async function removeList(l) {
      if (!confirm(`למחוק את הרשימה "${l.name}"? הסקרים שנפתחו ממנה לא נמחקים.`)) return;
      const copy = JSON.parse(JSON.stringify(l));
      l.deleted = Date.now(); await save(l);
      ui.toast('הרשימה נמחקה', 6000, 'בטל', async () => { Object.assign(l, copy); delete l.deleted; await save(l); renderLists(); });
      renderLists();
    }
    ui.app().replaceChildren(ui.bar('עבודה לפי רשימה', '#/'),
      h('main', { class: 'stack', style: 'max-width:820px;margin:0 auto' },
        h('div', { class: 'card stack' },
          h('div', { class: 'small' }, 'רשימת מוסדות מאקסל (למשל רשימת המעונות מהלקוח): אפשר לערוך את התאים כאן, לבחור איזו עמודה היא הכתובת, העיר, סמל המוסד והמנהל/ת, ולפתוח סקר מכל שורה. לפני הפתיחה האפליקציה מחפשת סקר קודם באותו מקום (גם בארכיון בגוגל דרייב), כדי להתחיל מהסקר של השנה שעברה עם העצים והתמונות.'),
          h('button', { class: 'btn primary big', onclick: () => pick.click() }, '📥 ייבוא רשימה מאקסל'), pick,
          h('div', { class: 'muted small', style: 'text-align:center' }, 'במחשב אפשר גם לגרור את קובץ האקסל לכאן')),
        lists.length ? sq : h('div', { class: 'empty' }, ui.icon('list'), 'עוד אין רשימות. ייבא קובץ אקסל של רשימת מוסדות.'),
        found,
        h('div', { class: 'stack' }, normal),
        ));
    normal.append(...active.map(card),
      finished.length ? h('details', { class: 'wl-sec' }, h('summary', {}, `רשימות שהסתיימו (${finished.length})`), h('div', { class: 'stack' }, finished.map(card))) : '',
      hidden.length ? h('details', { class: 'wl-sec' }, h('summary', {}, `הוסרו מהמסך (${hidden.length}), לא נמחקו`), h('div', { class: 'stack' }, hidden.map(card))) : '');
    if (listQuery) doSearch();
    syncThen(renderLists);
  }

  async function importFile(f) {
    const ui = U();
    try {
      const sheets = (await readFile(f)).filter(s => s.rows.some(r => r.some(v => cellText(v))));
      if (!sheets.length) throw new Error('הקובץ ריק');
      const sh = sheets[0];
      const title = sh.rows.slice(0, guessHeader(sh.rows)).flat().map(cellText).filter(t => t.length > 8).sort((a, b) => b.length - a.length)[0];
      const l = { id: uid(), name: (title || f.name.replace(/\.[^.]+$/, '')).slice(0, 120), file: f.name, project: '', type: 'safety',
        raw: sh.rows.map(r => Array.from(r, v => cellText(v))), headerRow: guessHeader(sh.rows), created: Date.now() };
      buildFromRaw(l);
      await addCityColumn(l);
      // עמודת "סדר נסיעה" (מספרים): סדר המסלול מוכן מהקובץ
      const oc = l.cols.find(c => /^(סדר(\s*(נסיעה|עבודה))?|מס'?\s*בסדר)$/.test(c.name.trim()));
      const live = l.rows.filter(r => !r.deleted);
      l.hide = [];
      if (oc && live.length && live.every(r => /^\d+$/.test(clean(r.cells[oc.id])))) {
        l.route = live.slice().sort((a, b) => +clean(a.cells[oc.id]) - +clean(b.cells[oc.id])).map(r => r.id);
        l.hide.push(oc.id); // המספר מוצג ממילא ליד "פתח סקר"
      }
      // עמודת עיר עם אותה עיר בכל השורות (למשל כולן ירושלים): מוסתרת כדי שיהיה מקום לשאר העמודות. אפשר להחזיר אותה
      const cc = l.map.city && l.map.city.col;
      if (cc && live.length > 1 && new Set(live.map(r => clean(r.cells[cc]))).size === 1) l.hide.push(cc);
      // פרויקט: רק אם שם של פרויקט קיים מופיע בכותרת או בשם הקובץ (למשל "אמונה"), לא הפרויקט האחרון
      const hay = norm(l.name + ' ' + f.name);
      l.project = (await ui.projectsRecent()).filter(p => norm(p).length >= 3).find(p => hasWord(hay, norm(p)) || hay.includes(norm(p))) || '';
      await save(l);
      ui.go('#/lists/' + encodeURIComponent(l.id) + '/setup');
    } catch (e) { ui.toast('הייבוא נכשל: ' + e.message, 5000); }
  }

  // הגדרות הרשימה: שם, פרויקט, סוג הסקר, העמודות (שם, הוספה, מחיקה) והשיוך לשדות הסקר
  async function renderSetup(l) {
    const ui = U(), { h } = ui;
    const projects = await ui.projectsRecent();
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
        const upd = () => { ex.textContent = sample ? 'בשורה הראשונה: ' + ([clean(m.pre), ...colsOf(m).map(c => clean(sample.cells[c]))].filter(Boolean).join(' ') || '—') : ''; };
        upd();
        // כמה עמודות בסדר שבוחרים (למשל "סוג מוסד" ואז "שם המוסד": "גן ילדים אמונה")
        const colsBox = h('div', { class: 'stack', style: 'gap:6px' });
        const drawCols = () => {
          const arr = colsOf(m).length ? colsOf(m) : [''];
          colsBox.replaceChildren(...arr.map((cid, i) => h('div', { class: 'row', style: 'gap:6px;align-items:center' },
            arr.length > 1 ? h('span', { class: 'wl-rnum', style: 'margin:0' }, String(i + 1)) : null,
            h('select', { class: 'in', style: 'flex:1;min-width:160px', 'aria-label': 'עמודה ' + (i + 1), onchange: e => { const a = [...arr]; a[i] = e.target.value; setCols(m, a); drawCols(); upd(); } }, colOpts(cid)),
            arr.length > 1 ? h('button', { class: 'icon-btn', title: 'קודם', 'aria-label': 'הזז קודם', disabled: i === 0 ? true : null, onclick: () => { const a = [...arr]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setCols(m, a); drawCols(); upd(); } }, '↑') : null,
            arr.length > 1 ? h('button', { class: 'icon-btn', title: 'אחר כך', 'aria-label': 'הזז אחר כך', disabled: i === arr.length - 1 ? true : null, onclick: () => { const a = [...arr]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setCols(m, a); drawCols(); upd(); } }, '↓') : null,
            arr.length > 1 ? h('button', { class: 'icon-btn', title: 'הסר', 'aria-label': 'הסר עמודה', onclick: () => { const a = [...arr]; a.splice(i, 1); setCols(m, a); drawCols(); upd(); } }, '✕') : null)),
            m.col ? h('button', { class: 'btn', style: 'align-self:flex-start', onclick: () => {
              const free = draft.cols.find(c => !colsOf(m).includes(c.id));
              if (!free) return;
              setCols(m, [...colsOf(m), free.id]); drawCols(); upd();
            } }, '➕ עוד עמודה לשדה הזה') : null);
        };
        drawCols();
        return h('div', { class: 'card stack wl-map' },
          h('b', {}, f.label),
          h('div', { class: 'row', style: 'gap:8px;align-items:flex-start' },
            h('div', { style: 'flex:2;min-width:200px' }, h('label', { class: 'f' }, 'עמודות ברשימה (לפי הסדר)'), colsBox),
            h('div', { style: 'flex:1;min-width:150px' }, field('טקסט קבוע לפני', h('input', { class: 'in', value: m.pre || '', placeholder: 'למשל: מעון אמונה', oninput: e => { m.pre = e.target.value; upd(); } })))),
          ex, prevEl);
      };
      main.replaceChildren(
        h('div', { class: 'card stack' },
          field('שם הרשימה', h('input', { class: 'in', value: draft.name || '', oninput: e => { draft.name = e.target.value; } })),
          h('div', { class: 'row', style: 'gap:8px;align-items:stretch' },
            h('div', { style: 'flex:1;min-width:200px' }, field('פרויקט לסקרים (למשל: אמונה)', ui.suggestCombo(h('input', { class: 'in', value: draft.project || '', placeholder: 'בחר מהרשימה או כתוב', oninput: e => { draft.project = e.target.value; } }), () => projects, { arrow: true }))),
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
              for (const k in draft.map) setCols(draft.map[k], colsOf(draft.map[k]).filter(x => x !== c.id));
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
    // מיון וסינון לפי עמודה כמו באקסל (נשמר במכשיר הזה לכל רשימה). '_st' = עמודת הסטטוס
    const VKEY = 'wlView:' + l.id;
    const saved = (await DB.getKV(VKEY, null)) || {};
    const view = { sort: saved.sort || (!saved.filt && (l.route || []).length ? { col: '_route', dir: 1 } : null), filt: Object.fromEntries(Object.entries(saved.filt || {}).map(([k, v]) => [k, new Set(v)])) };
    const saveView = () => DB.setKV(VKEY, { sort: view.sort, filt: Object.fromEntries(Object.entries(view.filt).map(([k, v]) => [k, [...v]])) }).catch(() => {});
    const valOf = (r, cid) => cid === '_st' ? stateOf(r).t : cid === '_route' ? ((l.route || []).indexOf(r.id) + 1 ? String((l.route || []).indexOf(r.id) + 1) : '') : clean(r.cells[cid]);
    const cmp = (a, b) => (a === '') - (b === '') || a.localeCompare(b, 'he', { numeric: true, sensitivity: 'base' });
    function colMenu(cid, name, btn) {
      document.querySelectorAll('.wl-pop').forEach(x => x.remove());
      const rs = l.rows.filter(r => !r.deleted);
      const vals = [...new Set(rs.map(r => valOf(r, cid)))].sort(cmp);
      const cur = view.filt[cid];
      const chosen = new Set(cur ? [...cur] : vals);
      const listBox = h('div', { class: 'wl-pop-list' });
      const search = h('input', { class: 'in', type: 'search', placeholder: 'חיפוש', style: 'min-height:40px' });
      const drawVals = () => {
        const w = norm(search.value);
        const vis = vals.filter(v => !w || norm(v).includes(w));
        const all = h('input', { type: 'checkbox', checked: vis.every(v => chosen.has(v)), onchange: e => { for (const v of vis) e.target.checked ? chosen.add(v) : chosen.delete(v); drawVals(); } });
        listBox.replaceChildren(h('label', { class: 'wl-pop-row', style: 'font-weight:700' }, all, '(בחר הכל)'),
          ...vis.map(v => h('label', { class: 'wl-pop-row' }, h('input', { type: 'checkbox', checked: chosen.has(v), onchange: e => { e.target.checked ? chosen.add(v) : chosen.delete(v); } }), v || '(ריקים)')));
      };
      search.addEventListener('input', drawVals);
      drawVals();
      const done = () => { pop.remove(); document.removeEventListener('pointerdown', outside, true); };
      const outside = e => { if (!pop.contains(e.target) && e.target !== btn) done(); };
      const sortBtn = (dir, label) => h('button', { class: 'btn block' + (view.sort && view.sort.col === cid && view.sort.dir === dir ? ' primary' : ''), onclick: () => { view.sort = { col: cid, dir }; saveView(); done(); draw(); } }, label);
      const pop = h('div', { class: 'wl-pop card stack' },
        h('b', {}, cid === '_st' ? 'סטטוס הסקר וסדר הנסיעה' : name),
        cid === '_st' && (l.route || []).length ? h('button', { class: 'btn block' + (view.sort && view.sort.col === '_route' ? ' primary' : ''), onclick: () => { view.sort = { col: '_route', dir: 1 }; saveView(); done(); draw(); } }, '🚗 מיון לפי סדר הנסיעה (1, 2, 3…)') : null,
        cid === '_st' ? null : h('label', { class: 'small', style: 'display:block' }, 'העמודה הזו היא (לפתיחת סקר):',
          h('select', { class: 'in', style: 'margin-top:4px', onchange: e => {
            for (const f of FIELDS) { const m = l.map[f.key] = l.map[f.key] || { col: '', pre: '', prev: !!f.prev }; setCols(m, colsOf(m).filter(x => x !== cid)); }
            if (e.target.value) { const m = l.map[e.target.value]; setCols(m, e.target.value === 'siteName' ? [...colsOf(m), cid] : [cid]); }
            save(l); done(); draw();
            ui.toast(e.target.value ? `"${name}" שויכה ל${FIELDS.find(f => f.key === e.target.value).label}` : `"${name}" לא משויכת לשדה`, 2500);
          } },
            h('option', { value: '' }, '— לא משויכת —'),
            ...fieldsOf(l).map(f => { const cs = colsOf(l.map[f.key]), other = cs.filter(x => x !== cid).map(x => (l.cols.find(c => c.id === x) || {}).name).filter(Boolean);
              return h('option', { value: f.key, selected: cs.includes(cid) ? '' : null }, f.label + (other.length && !cs.includes(cid) ? (f.key === 'siteName' ? ' (בנוסף ל"' + other.join('", "') + '")' : ' (במקום "' + other.join('", "') + '")') : '')); }))),
        sortBtn(1, '↓ מיון מהקטן לגדול (א→ת)'), sortBtn(-1, '↑ מיון מהגדול לקטן (ת→א)'),
        cid === '_st' ? null : h('button', { class: 'btn block', onclick: () => { l.hide = [...new Set([...(l.hide || []), cid])]; save(l); done(); draw(); ui.toast(`העמודה "${name}" הוסתרה. "הצג עמודות מוסתרות" מחזיר אותה`, 3000); } }, '🙈 הסתר את העמודה'),
        search, listBox,
        h('div', { class: 'row', style: 'gap:6px' },
          h('button', { class: 'btn primary', onclick: () => {
            if (vals.every(v => chosen.has(v))) delete view.filt[cid]; else view.filt[cid] = new Set(chosen);
            saveView(); done(); draw();
          } }, 'אישור'),
          h('button', { class: 'btn', onclick: () => { delete view.filt[cid]; if (view.sort && view.sort.col === cid) view.sort = null; saveView(); done(); draw(); } }, 'נקה'),
          h('button', { class: 'btn', onclick: done }, 'ביטול')));
      document.body.append(pop);
      const r = btn.getBoundingClientRect();
      const w = Math.min(300, window.innerWidth - 16);
      pop.style.width = w + 'px';
      pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
      pop.style.top = Math.min(r.bottom + 4, window.innerHeight - 200) + 'px';
      setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    }
    const headBtn = (cid, name) => {
      const on = view.filt[cid], so = view.sort && view.sort.col === cid ? view.sort.dir : 0;
      const b = h('button', { class: 'wl-fbtn' + (on || so ? ' on' : ''), title: 'מיון וסינון', 'aria-label': 'מיון וסינון: ' + name,
        onclick: e => { e.stopPropagation(); colMenu(cid, name, b); } }, (so === 1 ? '↓' : so === -1 ? '↑' : '') + (on ? '⧩' : '▾'));
      return b;
    };
    const q = h('input', { class: 'in', type: 'search', placeholder: 'חיפוש ברשימה', style: 'flex:1;min-width:160px' });
    const clearBox = h('span');
    const hideBox = h('span');
    const dayBox = h('div', { class: 'row project-chips', style: 'gap:6px;flex-wrap:wrap;align-items:center' });
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
      const shown = rs.filter(r => (filter === 'all' || stateOf(r).k === filter) && words.every(w => norm(Object.values(r.cells).join(' ')).includes(w))
        && Object.entries(view.filt).every(([cid, set]) => (cid !== '_st' && !l.cols.some(c => c.id === cid)) || set.has(valOf(r, cid))));
      if (view.sort && (view.sort.col === '_st' || view.sort.col === '_route' || l.cols.some(c => c.id === view.sort.col))) {
        const { col, dir } = view.sort;
        const rn = r => { const k = (l.route || []).indexOf(r.id); return k < 0 ? 1e9 : k; };
        shown.sort((a, b) => { const x = valOf(a, col), y = valOf(b, col); return (x === '') - (y === '') || dir * cmp(x, y) || (col === '_st' ? rn(a) - rn(b) : 0); });
      }
      const dc = dayCol(l), days = daysOf(l);
      const byDay = !!(dc && days.length && view.sort && (view.sort.col === '_route' || view.sort.col === dc.id));
      const dayOn = dc && view.filt[dc.id] && view.filt[dc.id].size === 1 ? [...view.filt[dc.id]][0] : null;
      dayBox.replaceChildren(...(days.length > 1 ? [h('span', { class: 'small muted' }, 'ימים:'),
        h('button', { class: 'chip' + (!dayOn ? ' on' : ''), onclick: () => { delete view.filt[dc.id]; saveView(); draw(); } }, 'כל הימים'),
        ...days.map(d => h('button', { class: 'chip' + (dayOn === d ? ' on' : ''), onclick: () => { view.filt[dc.id] = new Set([d]); if (!view.sort) view.sort = { col: (l.route || []).length ? '_route' : dc.id, dir: 1 }; saveView(); draw(); } },
          `${d} (${l.rows.filter(r => !r.deleted && clean(r.cells[dc.id]) === d).length})`))] : []));
      const hid = (l.hide || []).filter(id => l.cols.some(c => c.id === id));
      hideBox.replaceChildren(hid.length ? h('button', { class: 'btn', onclick: () => { l.hide = []; save(l); draw(); } }, `👁 הצג עמודות מוסתרות (${hid.map(id => l.cols.find(c => c.id === id).name).join(', ')})`) : '');
      const active = Object.keys(view.filt).length || view.sort;
      clearBox.replaceChildren(active ? h('button', { class: 'btn', onclick: () => { view.filt = {}; view.sort = null; saveView(); draw(); } }, '✕ נקה מיון וסינון') : '');
      counts.textContent = shown.length === rs.length ? `${rs.length} שורות` : `${shown.length} מתוך ${rs.length} שורות`;
      // רוחב כל עמודה לפי הטקסט הארוך בה (בגבולות), כדי שכתובת שלמה תיראה בלי לגלול בתוך התא
      const cols = visCols(l);
      const width = new Map(cols.map(c => [c.id, Math.min(38, Math.max(8, c.name.length, ...rs.map(r => (r.cells[c.id] || '').length)) + 2)]));
      const mapped = new Map(Object.entries(l.map || {}).filter(([k]) => fieldsOf(l).some(f => f.key === k)).flatMap(([k, m]) => { const cs = colsOf(m); return cs.map((c, i) => [c, FIELDS.find(f => f.key === k).label + (cs.length > 1 ? ` (${i + 1})` : '')]); }));
      table.replaceChildren(h('table', { class: 'wl-table' },
        h('thead', {}, h('tr', {}, h('th', { class: 'wl-act' }, h('div', { class: 'wl-th' }, h('span', {}, 'סקר'), headBtn('_st', 'סטטוס הסקר'))), ...cols.map(c => h('th', {}, h('div', { class: 'wl-th' }, h('span', {}, c.name), headBtn(c.id, c.name)), mapped.has(c.id) ? h('div', { class: 'wl-tag' }, '← ' + mapped.get(c.id)) : null)), h('th', {}))),
        h('tbody', {}, shown.flatMap((r, i) => {
          const st = stateOf(r);
          // מפריד בין ימים, כשהרשימה ממוינת לפי סדר הנסיעה או לפי היום
          const dv = dc && byDay ? clean(r.cells[dc.id]) : null;
          const sep = dc && byDay && (i === 0 || clean(shown[i - 1].cells[dc.id]) !== dv)
            ? h('tr', { class: 'wl-dayrow' }, h('td', { colspan: cols.length + 2 }, h('span', { class: 'wl-daylbl' }, `${dv || 'בלי יום'} · ${shown.filter(x => clean(x.cells[dc.id]) === dv).length} מוסדות`))) : null;
          return [sep, h('tr', { class: 'st-' + st.k },
            h('td', { class: 'wl-act' },
              (l.route || []).includes(r.id) ? rnumInput(l, r.id, () => { save(l); draw(); }) : null,
              h('button', { class: 'btn ' + (st.k === 'todo' ? 'primary' : ''), title: !r.sid && r.prev && !r.prev.none ? 'סקר חדש מהיום עם העצים וההערות מהסקר הקודם, והפרטים מהרשימה' : null, onclick: () => openRow(l, r) },
                st.k !== 'todo' ? 'פתח' : r.prev && !r.prev.none ? `פתח (מ-${r.prev.year || 'קודם'})` : 'פתח סקר'),
              r.sid ? null : r.prev && !r.prev.none ? h('div', { class: 'wl-prev small' }, '↩ ' + r.prev.name,
                h('button', { class: 'link-btn small', onclick: () => openRow(l, r, true, draw) }, 'החלף'),
                h('button', { class: 'link-btn small', onclick: () => { delete r.prev; r.u = Date.now(); save(l); draw(); } }, 'בטל'))
                : h('button', { class: 'link-btn small wl-find', onclick: () => openRow(l, r, true, draw) }, '🔎 חפש סקר קודם'),
              h('div', { class: 'wl-badge ' + st.k }, st.t), st.d ? h('div', { class: 'wl-st small' }, st.d) : null,
              r.sid ? h('button', { class: 'link-btn small', onclick: () => { if (!confirm('לנתק את השורה מהסקר? הסקר עצמו לא נמחק.')) return; delete r.sid; r.u = Date.now(); save(l); draw(); } }, 'נתק') : null),
            ...cols.map(c => h('td', {}, h('input', { class: 'wl-cell', value: r.cells[c.id] || '', 'aria-label': c.name, style: `width:${width.get(c.id)}ch`,
              oninput: e => { r.cells[c.id] = e.target.value; r.u = Date.now(); saveSoon(); } }))),
            h('td', {}, h('button', { class: 'icon-btn', title: 'מחק שורה', 'aria-label': 'מחק שורה', onclick: () => {
              if (!confirm('למחוק את השורה מהרשימה?')) return;
              r.deleted = Date.now(); r.u = Date.now(); r.cells = {}; save(l); draw();
            } }, '✕')))].filter(Boolean);
        }))));
    };
    q.addEventListener('input', draw);
    const exportXlsx = async () => {
      const rs = l.rows.filter(r => !r.deleted);
      // הרשימה כמו שהועלתה + בסוף (הצד השמאלי) סטטוס: בוצע / בתהליך / לא בוצע, ותאריך
      const st = r => { const x = stateOf(r); return x.k === 'done' ? ['בוצע', x.d || ''] : x.k === 'open' ? ['בתהליך', x.d ? 'נפתח ' + x.d : ''] : ['לא בוצע', x.t === 'הסקר נמחק' ? 'הסקר נמחק' : '']; };
      const rows = [[...l.cols.map(c => c.name), 'סטטוס סקר', 'תאריך / הערה'], ...rs.map(r => [...l.cols.map(c => { const v = r.cells[c.id] || ''; return /^\d{1,9}$/.test(v) ? +v : v; }), ...st(r)])];
      const blob = await Reports.xlsx(rows, { sheet: 'רשימה', widths: [...l.cols.map(() => 20), 20, 18] });
      ui.downloadFile(blob, ui.safeName(l.name || 'רשימה') + '.xlsx');
    };
    // מסמכים של הרשימה (אישורי כניסה וכו'): נפתחים בתוך האפליקציה
    const docs = ListDocs.section(l, save);
    dropDocs = { id: l.id, add: docs.add };
    const missing = fieldsOf(l).filter(f => ['street', 'city'].includes(f.key) && !(l.map[f.key] || {}).col && !clean((l.map[f.key] || {}).pre)).map(f => f.label);
    ui.app().replaceChildren(ui.bar({ title: l.name || 'רשימה', sub: [l.project ? 'פרויקט ' + l.project : null, Construction.TYPES[l.type || 'safety']].filter(Boolean).join(' · ') }, '#/lists'),
      h('main', { class: 'stack' },
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, q,
          h('button', { class: 'btn', onclick: () => ui.go('#/lists/' + encodeURIComponent(l.id) + '/setup') }, ui.icon('gear'), 'שיוך עמודות (כתובת, עיר, סמל…) והגדרות'),
          h('button', { class: 'btn', onclick: () => { l.rows.push({ id: uid(), cells: {}, u: Date.now() }); save(l); filter = 'all'; q.value = ''; draw(); const ins = table.querySelectorAll('tbody tr:last-child input'); if (ins[0]) ins[0].focus(); } }, '➕ שורה'),
          h('button', { class: 'btn', onclick: () => ui.go('#/lists/' + encodeURIComponent(l.id) + '/route') }, '🗺 מסלול ומפה'),
          h('button', { class: 'btn', title: 'הרשימה שהעלית, עם עמודת סטטוס בסוף: בוצע / בתהליך / לא בוצע', onclick: exportXlsx }, '⬇ הורד לאקסל עם סטטוס'),
          h('button', { class: 'btn', onclick: ev => managersReport(l, ev.currentTarget) }, '📊 דוח מנהלים'),
          h('button', { class: 'btn', title: 'סיכום אורנים ומפת עצים לשיתוף מהסקרים של הרשימה (ירושלים)', onclick: () => ui.go('#/summary/' + encodeURIComponent(l.id)) }, '🌲 אורנים ומפות'),
          l.finished ? null : h('button', { class: 'btn', onclick: async () => { l.finished = Date.now(); await save(l); ui.toast('הרשימה הסתיימה ועברה ל"רשימות שהסתיימו"', 3500); ui.go('#/lists'); } }, '✓ סיום רשימה'), clearBox, hideBox),
        l.finished ? h('div', { class: 'card row', style: 'gap:10px;align-items:center;background:var(--accent-soft)' }, h('b', { style: 'flex:1' }, '✓ הרשימה הסתיימה ' + new Date(l.finished).toLocaleDateString('he-IL')),
          h('button', { class: 'btn', onclick: async () => { delete l.finished; delete l.offHome; await save(l); renderList(l); } }, '↩ החזר לפעילות')) : null,
        docs.el,
        h('div', { class: 'row small', style: 'gap:8px;align-items:center;flex-wrap:wrap' },
          h('span', {}, '📁 תיקייה בדרייב לחיפוש סקרים קודמים: ', h('b', {}, l.folder ? l.folder.name : 'הארכיון הרגיל')),
          h('button', { class: 'btn', onclick: () => pickListFolder(l, () => renderList(l)) }, l.folder ? 'החלף' : 'בחר תיקייה'),
          l.folder ? h('button', { class: 'btn', onclick: async () => { delete l.folder; await save(l); renderList(l); } }, 'הארכיון הרגיל') : null),
        missing.length ? h('div', { class: 'card small', style: 'background:#fff2cc;color:#5a4300' }, `⚠ עוד לא נבחרה עמודה ל: ${missing.join(', ')}. לחץ על החץ ▾ בכותרת של העמודה ובחר "העמודה הזו היא", או ב"שיוך עמודות".`) : null,
        dayBox, chipsBox, counts, table));
    draw();

    // סקרים שנפתחו במכשיר אחר: הסטטוס מהאינדקס בענן
    if (navigator.onLine !== false && await OD.connected()) Sync.cloudIndex().then(list => { idx = new Map(list.map(e => [e.id, e])); if (!table.contains(document.activeElement)) draw(); }).catch(() => {});
    syncThen(async () => { const n = await byId(l.id); if (n) { Object.assign(l, n); draw(); docs.redraw(); ListDocs.syncDocs(l, save, docs.redraw); } else ui.go('#/lists'); });
  }


  // ---------- דוח מנהלים (1.98.0): כמו "דו"ח מנהלים, סקר יציבות עצים" של ori: שורה לכל עץ שדורש טיפול בכל מוסד ברשימה ----------
  const xesc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function colL(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  // rows: [[ערך או {v, s}]] s: 1 כותרת ראשית, 2 כותרת טבלה, 3 מודגש
  async function reportXlsx(rows, widths, headRow) {
    const cell = (v, ref) => {
      const o = v && typeof v === 'object' ? v : { v };
      const st = o.s ? ` s="${o.s}"` : (headRow != null ? ' s="4"' : '');
      if (o.v == null || o.v === '') return `<c r="${ref}"${st}/>`;
      if (typeof o.v === 'number') return `<c r="${ref}"${st}><v>${o.v}</v></c>`;
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xesc(o.v)}</t></is></c>`;
    };
    const data = rows.map((r, i) => `<row r="${i + 1}">` + r.map((v, j) => cell(i > headRow ? v : (v && typeof v === 'object' ? v : { v, s: i === headRow ? 2 : 0 }), colL(j + 1) + (i + 1))).join('') + '</row>').join('');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="דוח מנהלים" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="16"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="12"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4472C4"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FF8EA9DB"/></left><right style="thin"><color rgb="FF8EA9DB"/></right><top style="thin"><color rgb="FF8EA9DB"/></top><bottom style="thin"><color rgb="FF8EA9DB"/></bottom></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="5"><xf/><xf fontId="1" applyFont="1"/><xf fontId="2" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf fontId="3" applyFont="1"/><xf borderId="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>');
    const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const last = rows.length;
    zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="${headRow + 1}" topLeftCell="A${headRow + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${data}</sheetData><autoFilter ref="A${headRow + 1}:${colL(widths.length)}${Math.max(last, headRow + 2)}"/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`);
    return new Blob([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  async function managersReport(l, btn) {
    const ui = U();
    const label0 = btn.textContent; btn.disabled = true;
    try {
      const nameCol = l.cols.find(c => /שם\s*ה?(מוסד|מעון|גן|אתר|בית\s*ספר)/.test(c.name)) || null;
      let idx = null;
      const rows = [], missing = [];
      let inst = 0, trees = 0, i = 0;
      const rs = l.rows.filter(r => !r.deleted);
      for (const r of rs) {
        btn.textContent = `טוען סקרים… ${++i}/${rs.length}`;
        if (!r.sid) { missing.push(r); continue; }
        let s = await DB.getSurvey(r.sid);
        if (!s || !s.trees) {
          if (!idx) idx = navigator.onLine !== false && await OD.connected() ? await Sync.cloudIndex().catch(() => []) : [];
          const e = idx.find(x => x.id === r.sid);
          s = e ? await Sync.loadSurvey(e).catch(() => null) : null;
        }
        if (!s || s.deleted) { missing.push(r); continue; }
        const v = valuesOf(l, r);
        const name = (nameCol && clean(r.cells[nameCol.id])) || s.siteName || v.siteName || '';
        const care = Core.sortTrees(s.trees.filter(t => Core.hasContent(t) && Reports.needsCare(t)));
        inst++;
        for (const t of care) {
          trees++;
          const num = String(t.num || '').trim();
          rows.push([s.code || v.code || '', name, s.street || geoStreet(v.street), s.city || v.city || '', /^\d+$/.test(num) ? +num : num, t.species || '', (t.notes || '').trim(), String(t.urgency || '').trim()]);
        }
      }
      if (!inst) { ui.toast('אין עדיין סקרים שנפתחו מהרשימה', 3500); return; }
      const d = new Date(), date = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
      const head = ['סמל מוסד', 'שם המוסד', 'כתובת', 'עיר', 'מספר עץ', 'מין העץ', 'הערות וטיפול מומלץ', 'דחיפות'];
      const out = [
        [{ v: 'בס"ד', s: 0 }, '', '', '', '', '', { v: 'תאריך', s: 3 }, { v: date, s: 3 }],
        [{ v: 'דו"ח מנהלים, סקר יציבות עצים', s: 1 }],
        [{ v: [l.project, l.name].filter(Boolean).join(' - '), s: 3 }],
        [],
        head, ...rows];
      const blob = await reportXlsx(out, [11, 24, 22, 14, 9, 16, 50, 9], 4);
      ui.downloadFile(blob, ui.safeName('דוח מנהלים - ' + (l.project || l.name || 'רשימה')) + ' ' + date.replace(/\//g, '.') + '.xlsx');
      ui.toast(`✓ דוח מנהלים: ${inst} מוסדות, ${trees} עצים לטיפול` + (missing.length ? `. ${missing.length} מוסדות עוד בלי סקר ולא נכללו` : ''), 6000);
    } catch (e) { ui.toast('הדוח נכשל: ' + e.message, 5000); }
    finally { btn.disabled = false; btn.textContent = label0; }
  }

  // שינוי מקום בסדר הנסיעה (מהטבלה, מהרשימה או מהמפה)
  function moveInRoute(l, id, pos) {
    const i = l.route.indexOf(id);
    if (i < 0 || !(pos >= 1)) return false;
    pos = Math.min(Math.round(pos), l.route.length);
    if (pos - 1 === i) return false;
    l.route.splice(i, 1); l.route.splice(pos - 1, 0, id);
    return true;
  }
  const rnumInput = (l, id, onMove) => U().h('input', { class: 'wl-rnum wl-rin', type: 'number', inputmode: 'numeric', min: 1, max: l.route.length, value: l.route.indexOf(id) + 1,
    title: 'המקום בסדר הנסיעה: הקלד מספר אחר כדי להזיז', 'aria-label': 'מקום בסדר הנסיעה',
    onclick: e => { e.stopPropagation(); e.target.select(); },
    onchange: e => { if (moveInRoute(l, id, +e.target.value)) onMove(); else e.target.value = l.route.indexOf(id) + 1; },
    onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); } });
  // ---------- מסלול נסיעה (1.97.0): מפה עם המוסדות ממוספרים, סידור אוטומטי (הדרך הקצרה) או ידני, ופתיחה בגוגל מפות / וייז ----------
  // הכתובת לחיפוש במפה: הרחוב והמספר בלבד ("שכ' טירת צבי רח' חנה סנש 6" -> "חנה סנש 6"), והעיר
  function geoStreet(street) {
    let st = clean(street);
    const parts = st.split(/רח(?:וב|['׳])\s*/);
    if (parts.length > 1) st = parts[parts.length - 1];
    st = st.split(',').map(clean).find(x => /\d/.test(x)) || st.split(',')[0];
    const m = /^(.*?\d+)/.exec(st);
    return clean(m ? m[1] : st);
  }
  // איתור כתובות: כמה שירותים חינמיים בתור. אם אחד חוסם או לא מוצא, עוברים לבא.
  // ArcGIS מכיר טוב כתובות בישראל; Photon ו-OpenStreetMap (Nominatim) לגיבוי. kind='street': רק תוצאה ברמת רחוב/בית
  const NOMI = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=il&accept-language=he&q=';
  const ARC = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&maxLocations=1&countryCode=ISR&langCode=he&outFields=Addr_type&SingleLine=';
  const PHOTON = 'https://photon.komoot.io/api/?limit=1&bbox=34.2,29.4,35.95,33.4&q=';
  let lastGeo = 0, geoQueue = Promise.resolve();
  // Nominatim: לכל היותר בקשה אחת בשנייה (מדיניות השירות), גם כשכמה חיפושים רצים ביחד: בתור
  function nominatim(q) {
    const run = async () => {
      const wait = 1100 - (Date.now() - lastGeo);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      lastGeo = Date.now();
      const res = await fetch(NOMI + encodeURIComponent(q));
      if (!res.ok) throw new Error('OpenStreetMap ' + res.status);
      const j = await res.json();
      return j && j[0] ? { lat: +j[0].lat, lon: +j[0].lon, kind: /^(house|building|residential|road|street|primary|secondary|tertiary|footway|pedestrian)$/.test(j[0].type) || j[0].category === 'building' || j[0].category === 'amenity' ? 'street' : 'place' } : null;
    };
    const p = geoQueue.then(run, run);
    geoQueue = p.catch(() => {});
    return p;
  }
  async function arcgis(q) {
    const res = await fetch(ARC + encodeURIComponent(q));
    if (!res.ok) throw new Error('ArcGIS ' + res.status);
    const j = await res.json();
    if (j.error) throw new Error('ArcGIS ' + (j.error.message || j.error.code));
    const c = j.candidates && j.candidates[0];
    if (!c || c.score < 75) return null;
    const t = (c.attributes && c.attributes.Addr_type) || '';
    return { lat: +c.location.y, lon: +c.location.x, kind: /^(PointAddress|StreetAddress|StreetAddressExt|StreetInt|StreetName|StreetMidBlock|Subaddress|POI|DistanceMarker)$/.test(t) ? 'street' : 'place' };
  }
  async function photon(q) {
    const res = await fetch(PHOTON + encodeURIComponent(q));
    if (!res.ok) throw new Error('Photon ' + res.status);
    const j = await res.json();
    const f = j.features && j.features[0];
    if (!f) return null;
    const t = (f.properties && f.properties.type) || '';
    return { lat: +f.geometry.coordinates[1], lon: +f.geometry.coordinates[0], kind: /^(house|street|other)$/.test(t) ? 'street' : 'place' };
  }
  const GEOS = [['ArcGIS', arcgis], ['Photon', photon], ['OpenStreetMap', nominatim]];
  const geoFails = new Map(); // שירות שנכשל 3 פעמים ברצף: מדלגים עליו עד הטעינה הבאה
  async function geocode(q, kind) {
    const errs = [];
    let tried = 0;
    for (const [name, fn] of GEOS) {
      if ((geoFails.get(name) || 0) >= 3) continue;
      tried++;
      try {
        const g = await fn(q);
        geoFails.set(name, 0);
        if (g && isFinite(g.lat) && isFinite(g.lon) && (kind !== 'street' || g.kind === 'street')) return { lat: g.lat, lon: g.lon };
      } catch (e) { geoFails.set(name, (geoFails.get(name) || 0) + 1); errs.push(e.message); }
    }
    if (!tried || (errs.length && errs.length === tried)) throw new Error('שירותי המפה לא זמינים' + (errs.length ? ' (' + errs.join(', ') + ')' : ''));
    return null;
  }
  // אותה כתובת בכמה שורות (כמה גנים באותו מבנה): מחפשים פעם אחת
  const geoMem = new Map();
  // שמות קצרים של ערים שבשירות המפה מתבלבלים עם מקום אחר (חצור -> חצור אשדוד)
  const CITY_FULL = { 'חצור': 'חצור הגלילית', 'מעלות': 'מעלות תרשיחא', 'קרית מוצקין': 'קריית מוצקין', 'קרית שמונה': 'קריית שמונה', 'קרית גת': 'קריית גת', 'קרית ביאליק': 'קריית ביאליק', 'קרית אתא': 'קריית אתא', 'קרית ים': 'קריית ים', 'קרית מלאכי': 'קריית מלאכי', 'קרית ארבע': 'קריית ארבע', 'קרית טבעון': 'קריית טבעון', 'קרית עקרון': 'קריית עקרון' };
  const fullCity = c => CITY_FULL[clean(c)] || clean(c);
  const cityCenter = new Map();
  async function cityGeo(city) {
    if (!cityCenter.has(city)) cityCenter.set(city, await geocode(city));
    return cityCenter.get(city);
  }
  // מיקום לשורה: נ"צ של עצים בסקר המקושר, אחרת חיפוש הכתובת (נשמר בשורה, ומתחדש כשהכתובת משתנה).
  // תוצאה של רחוב שרחוקה מהעיר (רחוב "טבריה" בירושלים במקום רחוב ירושלים בטבריה) נפסלת ונשאר מרכז העיר
  async function locate(l, r, local) {
    // מיקום שתוקן ביד (גרירה / סימון במפה / חיפוש בכתובת אחרת) נשאר תמיד
    if (r.geo && r.geo.manual) return r.geo;
    const s = r.sid && local.get(r.sid);
    const pts = s ? s.trees.filter(t => typeof t.lat === 'number' && typeof t.lon === 'number') : [];
    if (pts.length) return { lat: pts.reduce((a, t) => a + t.lat, 0) / pts.length, lon: pts.reduce((a, t) => a + t.lon, 0) / pts.length, src: 'gps' };
    const v = valuesOf(l, r);
    const st = geoStreet(v.street), city = fullCity(v.city);
    const key = 'v2|' + st + '|' + city;
    if (r.geo && r.geo.key === key) return r.geo;
    if (geoMem.has(key)) { const m = geoMem.get(key); if (m) r.geo = Object.assign({}, m); return m ? r.geo : null; }
    if (!st && !city) return null;
    let c = null, cErr = null;
    if (city) { try { c = await cityGeo(city); } catch (e) { cErr = e; } }
    const near = g => g && (!c || km(c, g) <= 12);
    let g = null, approx = false;
    if (st && city) { g = await geocode(st + ', ' + city, 'street'); if (!near(g)) g = null; }
    if (!g && st && city) { const w = st.replace(/\s*\d+\s*$/, ''); if (w && w !== st) { g = await geocode(w + ', ' + city, 'street'); if (!near(g)) g = null; } }
    if (!g && c) { g = c; approx = true; }
    if (!g && st && !city) g = await geocode(st);
    if (!g && cErr) throw cErr;
    if (!g) { geoMem.set(key, null); return null; }
    r.geo = { lat: g.lat, lon: g.lon, key, approx };
    geoMem.set(key, r.geo);
    return r.geo;
  }
  // איתור כל התחנות ברקע: ממשיך גם כשיוצאים ממסך המסלול, נשמר כל כמה שורות, ומסך שנפתח שוב מצטרף אליו
  const geoJobs = new Map();
  function geoJob(l, local) {
    let j = geoJobs.get(l.id);
    if (j && !j.done) return j;
    j = { i: 0, n: 0, subs: new Set(), done: false };
    geoJobs.set(l.id, j);
    j.p = (async () => {
      const need = l.route.map(id => l.rows.find(r => r.id === id)).filter(r => r && !r.deleted);
      j.n = need.length;
      let dirty = 0;
      for (const r of need) {
        j.i++;
        const before = JSON.stringify(r.geo || null);
        let g = null;
        try { g = await locate(l, r, local); } catch (e) { j.err = e.message; }
        if (JSON.stringify(r.geo || null) !== before) { r.u = Date.now(); if (++dirty >= 5) { dirty = 0; await save(l); } }
        j.subs.forEach(f => f(r, g));
      }
      if (dirty) await save(l);
      j.done = true;
      j.subs.forEach(f => f(null));
    })();
    return j;
  }
  const rad = d => d * Math.PI / 180;
  function km(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
  }
  // הדרך הקצרה (בקו אווירי) שעוברת בכל הנקודות: שכן קרוב מכל נקודת התחלה + שיפור 2-opt. start: נקודה קבועה בהתחלה (המיקום שלי)
  // cost(i, j): זמן/מרחק נסיעה מנקודה i לנקודה j (i = -1 = נקודת ההתחלה). בלי cost: קו אווירי
  function bestOrder(pts, start, cost) {
    const n = pts.length;
    if (n < 2) return pts.map((_, i) => i);
    const d = cost || ((i, j) => km(i < 0 ? start : pts[i], pts[j]));
    const len = o => (start ? d(-1, o[0]) : 0) + o.slice(1).reduce((a, x, i) => a + d(o[i], x), 0);
    const improve = o => {
      let better = true;
      while (better) {
        better = false;
        for (let i = 0; i < n - 1; i++) for (let k = i + 1; k < n; k++) {
          const nw = [...o.slice(0, i), ...o.slice(i, k + 1).reverse(), ...o.slice(k + 1)];
          if (len(nw) < len(o) - 1e-9) { o = nw; better = true; }
        }
      }
      return o;
    };
    let best = null;
    // בלי נקודת התחלה: מנסים להתחיל מהקצוות (צפון, דרום, מזרח, מערב), ובמסלול קצר מכל נקודה
    const ext = () => { const by = f => pts.reduce((b, p, i) => f(p) > f(pts[b]) ? i : b, 0); return [...new Set([by(p => p.lat), by(p => -p.lat), by(p => p.lon), by(p => -p.lon)])]; };
    const starts = start ? [-1] : n <= 30 ? pts.map((_, i) => i) : ext();
    for (const s0 of starts) {
      const left = new Set(pts.map((_, i) => i));
      const o = [];
      let cur = s0;
      if (cur >= 0) { o.push(cur); left.delete(cur); }
      while (left.size) {
        let bi = -1, bd = Infinity;
        for (const j of left) { const x = d(cur, j); if (x < bd) { bd = x; bi = j; } }
        o.push(bi); left.delete(bi); cur = bi;
      }
      const im = improve(o);
      if (!best || len(im) < len(best)) best = im;
    }
    // בלי נקודת התחלה: מצפון לדרום
    if (!start && pts[best[0]].lat < pts[best[n - 1]].lat) best.reverse();
    return best;
  }
  // נסיעה בכבישים (OSRM, שירות חינמי בלי מפתח): טבלת זמני נסיעה לסידור, ומסלול לציור על המפה
  const OSRM = 'https://router.project-osrm.org/';
  const coordsOf = pts => pts.map(p => p.lon.toFixed(6) + ',' + p.lat.toFixed(6)).join(';');
  async function osrm(path) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch(OSRM + path, { signal: ctl.signal });
      if (!res.ok) throw new Error('שירות הניתוב לא זמין (' + res.status + ')');
      const j = await res.json();
      if (j.code !== 'Ok') throw new Error('שירות הניתוב: ' + (j.message || j.code));
      return j;
    } finally { clearTimeout(t); }
  }
  async function driveTable(pts) {
    const j = await osrm('table/v1/driving/' + coordsOf(pts) + '?annotations=duration');
    return j.durations;
  }
  // מסלול ארוך: בחלקים של עד 80 נקודות (מגבלת השירות), מחוברים
  async function driveRoute(pts) {
    const out = { line: [], km: 0, min: 0 };
    for (let i = 0; i < pts.length - 1; i += 79) {
      const part = pts.slice(i, i + 80);
      const j = await osrm('route/v1/driving/' + coordsOf(part) + '?overview=full&geometries=geojson');
      const r = j.routes[0];
      out.line.push(...r.geometry.coordinates.map(([lo, la]) => [la, lo]));
      out.km += r.distance / 1000; out.min += r.duration / 60;
    }
    return out;
  }

  async function renderRoute(l) {
    const ui = U(), { h } = ui;
    const back = '#/lists/' + encodeURIComponent(l.id);
    const local = new Map((await DB.allSurveys()).map(s => [s.id, s]));
    const live = () => l.rows.filter(r => !r.deleted);
    const done = r => { const s = r.sid && local.get(r.sid); return !!(s && (s.finished || s.finishPending)); };
    if (!Array.isArray(l.route) || !l.route.length) l.route = live().filter(r => !done(r)).map(r => r.id);
    l.route = l.route.filter(id => live().some(r => r.id === id));
    // עבודה שהסתיימה יורדת מהמסלול והמספור מתעדכן (אפשר להחזיר אותה מ"לא במסלול")
    const doneOut = l.route.filter(id => done(l.rows.find(r => r.id === id)));
    if (doneOut.length) { l.route = l.route.filter(id => !doneOut.includes(id)); save(l); setTimeout(() => ui.toast(doneOut.length === 1 ? 'עבודה אחת שהסתיימה ירדה מהמסלול' : `${doneOut.length} עבודות שהסתיימו ירדו מהמסלול`, 3500), 300); }
    const nameCol = l.cols.find(c => /שם\s*ה?(מוסד|מעון|גן|אתר|בית\s*ספר)/.test(c.name)) || null;
    const label = r => { const v = valuesOf(l, r); return { name: (nameCol && clean(r.cells[nameCol.id])) || v.siteName || 'שורה', addr: [geoStreet(v.street), fullCity(v.city)].filter(Boolean).join(', ') }; };
    const geo = new Map();
    const status = h('div', { class: 'muted small', role: 'status' });
    const listBox = h('div', { class: 'stack wl-route-list' });
    const outBox = h('div', { class: 'stack' });
    const mapEl = h('div', { class: 'wl-mapview' });
    // נקודת התחלה לסידור האוטומטי ולקישור לגוגל מפות: בלי / המיקום שלי / כתובת שבוחרים (נשמר ברשימה)
    l.start = l.start || { mode: 'none', addr: '' };
    const startSel = h('select', { class: 'in', style: 'width:auto;min-height:40px', 'aria-label': 'נקודת התחלה', onchange: () => { l.start.mode = startSel.value; startWrap.hidden = startPick.hidden = startSel.value !== 'addr'; persist(); redraw(); if (startSel.value === 'addr') startAddr.focus(); } },
      [['none', 'בלי נקודת התחלה (מצפון לדרום)'], ['me', 'מהמיקום שלי (GPS)'], ['addr', 'מכתובת שאני בוחר…']].map(([v, t]) => h('option', { value: v, selected: l.start.mode === v ? '' : null }, t)));
    const startAddr = h('input', { class: 'in', style: 'min-width:200px', value: l.start.addr || '', placeholder: 'למשל: עינב, או רחוב ועיר', onchange: async () => {
      l.start.addr = clean(startAddr.value); delete l.start.geo; persist();
      const recent = (await DB.getKV('wlStarts', [])) || [];
      if (l.start.addr) DB.setKV('wlStarts', [l.start.addr, ...recent.filter(x => x !== l.start.addr)].slice(0, 12));
      redraw();
    } });
    const startWrap = ui.suggestCombo(startAddr, () => startRecent, { arrow: true });
    let startRecent = (await DB.getKV('wlStarts', [])) || [];
    startWrap.hidden = l.start.mode !== 'addr';
    const startPick = h('button', { class: 'btn', title: 'לחץ ואז לחץ על המפה במקום שממנו יוצאים', onclick: () => {
      l.start.addr = clean(startAddr.value) || 'נקודה במפה'; startAddr.value = l.start.addr;
      pickOnMap('לחץ על המפה במקום שממנו אתה יוצא', ll => { l.start.geo = { lat: ll.lat, lon: ll.lng, key: l.start.addr, manual: true }; persist(); redraw(); ui.toast('נקודת ההתחלה נשמרה', 2500); });
    } }, '📍 סמן במפה');
    startPick.hidden = l.start.mode !== 'addr';
    async function startPoint() {
      if (l.start.mode === 'me') {
        const p = me || await new Promise(res => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lon: p.coords.longitude }), () => res(null), { timeout: 8000, maximumAge: 120000 }) : res(null));
        if (!p) ui.toast('המיקום שלך לא זמין, המסלול מסודר מצפון לדרום', 3500);
        return p;
      }
      if (l.start.mode === 'addr' && l.start.addr) {
        if (l.start.geo && l.start.geo.key === l.start.addr) return l.start.geo;
        const g = await geocode(l.start.addr).catch(() => null);
        if (!g) { ui.toast(`לא מצאתי במפה את "${l.start.addr}". נסה לכתוב גם עיר, או לחץ "📍 סמן במפה" ובחר את המקום`, 6000); return null; }
        l.start.geo = { lat: g.lat, lon: g.lon, key: l.start.addr }; persist();
        return l.start.geo;
      }
      return null;
    }
    const linksBox = h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' });
    let map = null, layer = null, pickAfter = null, userMoved = false;
    const persist = () => save(l);
    // יום עבודה שנבחר (עמודת "יום"): במפה, ברשימה ובקישורים רק התחנות שלו. המספרים נשארים לפי המסלול כולו
    const dc = dayCol(l), days = daysOf(l);
    let day = null;
    try { day = days.includes(sessionStorage.getItem('wlDay:' + l.id)) ? sessionStorage.getItem('wlDay:' + l.id) : null; } catch (_) {}
    const vis = () => day && dc ? l.route.filter(id => { const r = l.rows.find(x => x.id === id); return r && clean(r.cells[dc.id]) === day; }) : l.route;
    const dayBox = h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' });
    const drawDays = () => dayBox.replaceChildren(...(days.length > 1 ? [h('span', { class: 'small muted' }, 'יום:'),
      ...[null, ...days].map(d => h('button', { class: 'chip' + (day === d ? ' on' : ''), onclick: () => {
        day = d; try { sessionStorage.setItem('wlDay:' + l.id, d || ''); } catch (_) {}
        drawDays(); redraw();
      } }, d || 'כל הימים'))] : []));
    const navUrl = r => { const g = geo.get(r.id), lb = label(r); return g && (g.src === 'gps' || g.manual) ? `https://waze.com/ul?ll=${g.lat},${g.lon}&navigate=yes` : 'https://waze.com/ul?q=' + encodeURIComponent(lb.addr) + '&navigate=yes'; };
    const stopOf = r => { const g = geo.get(r.id); return g && (g.src === 'gps' || g.manual) ? `${g.lat.toFixed(6)},${g.lon.toFixed(6)}` : label(r).addr; };
    // גוגל מפות: עד 10 תחנות בקישור, ולכן מסלול ארוך מתחלק לכמה קישורים (כל חלק מתחיל איפה שהקודם נגמר)
    function gmapsLinks() {
      const rs = vis().map(id => l.rows.find(r => r.id === id)).filter(Boolean);
      const stops = rs.map(stopOf);
      // התחלה: כתובת שבחרתי = נקודת המוצא בקישור; המיקום שלי = בלי מוצא (גוגל מפות מתחיל מהמיקום הנוכחי)
      if (l.start.mode === 'addr' && l.start.addr) stops.unshift(l.start.geo && l.start.geo.manual && l.start.geo.key === l.start.addr ? `${l.start.geo.lat.toFixed(6)},${l.start.geo.lon.toFixed(6)}` : l.start.addr);
      if (l.start.mode === 'me' && stops.length) {
        const part = stops.slice(0, 10), out = ['https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(part[part.length - 1]) + (part.length > 1 ? '&waypoints=' + encodeURIComponent(part.slice(0, -1).join('|')) : '')];
        for (let i = 9; i < stops.length - 1; i += 9) {
          const p2 = stops.slice(i, i + 10);
          out.push('https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + encodeURIComponent(p2[0]) + '&destination=' + encodeURIComponent(p2[p2.length - 1]) + (p2.length > 2 ? '&waypoints=' + encodeURIComponent(p2.slice(1, -1).join('|')) : ''));
        }
        return out;
      }
      const out = [];
      for (let i = 0; i < stops.length - 1 || (i === 0 && stops.length === 1); i += 9) {
        const part = stops.slice(i, i + 10);
        if (part.length === 1) { out.push('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(part[0])); break; }
        out.push('https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + encodeURIComponent(part[0]) + '&destination=' + encodeURIComponent(part[part.length - 1])
          + (part.length > 2 ? '&waypoints=' + encodeURIComponent(part.slice(1, -1).join('|')) : ''));
      }
      return out;
    }
    // תיקון מיקום ביד: לחיצה במפה / גרירה / חיפוש כתובת אחרת. נשמר בשורה (manual) ולא נדרס באיתור הבא
    let pickLoc = null;
    function pickOnMap(msg, fn) {
      if (!map) { ui.toast('המפה לא נטענה', 3000); return; }
      pickLoc = fn; mapEl.classList.add('picking');
      mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      ui.toast(msg, 5000);
    }
    function setManual(r, p, q) {
      r.geo = { lat: p.lat, lon: p.lon, key: (r.geo && r.geo.key) || '', manual: true };
      if (q) r.geo.q = q;
      r.u = Date.now(); geo.set(r.id, r.geo); persist(); redraw();
    }
    function fixLoc(r) {
      const lb = label(r), g = geo.get(r.id);
      const q = h('input', { class: 'in', type: 'search', value: (r.geo && r.geo.q) || lb.addr, style: 'flex:1;min-width:180px', placeholder: 'רחוב ומספר, עיר' });
      const msg = h('div', { class: 'muted small' }, 'כתוב את הכתובת אחרת (עם יוד / בלי יוד, שם חדש של הרחוב, שם מקום) ולחץ חפש, או סמן את המקום במפה.');
      const close = () => ov.remove();
      const search = async () => {
        const t = clean(q.value); if (!t) return;
        msg.textContent = 'מחפש…';
        try {
          const p = await geocode(t);
          if (!p) { msg.textContent = `לא מצאתי את "${t}". נסה לכתוב אחרת, או סמן במפה.`; return; }
          close(); setManual(r, p, t);
          if (map) { userMoved = true; map.setView([p.lat, p.lon], 17); }
          ui.toast('נמצא. אם הנקודה לא בדיוק במקום, גרור אותה', 4000);
        } catch (e) { msg.textContent = e.message + '. אפשר לסמן במפה.'; }
      };
      q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
      const ov = h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
        h('div', { class: 'card stack', style: 'max-width:560px;width:96%' },
          h('h2', { style: 'margin:0;font-size:20px' }, '📍 מיקום של ' + lb.name),
          h('div', { class: 'muted small' }, 'בטבלה: ' + (lb.addr || '—') + (g ? (g.manual ? ' · כרגע: מיקום שתיקנת' : g.approx ? ' · כרגע: מיקום משוער' : '') : ' · כרגע: לא נמצא')),
          h('div', { class: 'row', style: 'gap:8px' }, q, h('button', { class: 'btn primary', onclick: search }, '🔎 חפש')),
          msg,
          h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
            h('button', { class: 'btn', onclick: () => { close(); pickOnMap('לחץ על המפה במקום של ' + lb.name, ll => { setManual(r, { lat: ll.lat, lon: ll.lng }); ui.toast('המיקום נשמר', 2500); }); } }, '👆 סמן במפה'),
            r.geo && r.geo.manual ? h('button', { class: 'btn', onclick: async () => { close(); delete r.geo; geo.delete(r.id); r.u = Date.now(); try { const g2 = await locate(l, r, local); if (g2) geo.set(r.id, g2); else geo.set(r.id, null); } catch (e) { ui.toast(e.message, 4000); } persist(); redraw(); } }, '↩ חזור לאיתור האוטומטי') : null,
            h('button', { class: 'btn', onclick: close }, 'ביטול'))));
      document.body.append(ov);
      q.focus(); q.select();
    }
    function drawMap() {
      if (!map || !window.L) return;
      if (layer) layer.remove();
      layer = L.layerGroup().addTo(map);
      const ll = [];
      if (l.start.mode === 'addr' && l.start.geo && l.start.geo.key === l.start.addr)
        L.marker([l.start.geo.lat, l.start.geo.lon], { draggable: true, icon: L.divIcon({ className: 'wl-pin start', html: '🏠', iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(layer)
          .bindPopup('התחלה: ' + l.start.addr.replace(/</g, '&lt;') + '<br><i>אפשר לגרור כדי לדייק</i>')
          .on('dragend', e => { const p = e.target.getLatLng(); l.start.geo = { lat: p.lat, lon: p.lng, key: l.start.addr, manual: true }; persist(); redraw(); });
      vis().forEach(id => {
        const i = l.route.indexOf(id);
        const r = l.rows.find(x => x.id === id), g = geo.get(id);
        if (!r || !g) return;
        const lb = label(r);
        const icon = L.divIcon({ className: 'wl-pin' + (done(r) ? ' done' : '') + (g.approx ? ' approx' : ''), html: String(i + 1), iconSize: [30, 30], iconAnchor: [15, 15] });
        const mv = pos => { if (moveInRoute(l, id, pos)) { persist(); map.closePopup(); redraw(); } };
        const pop = () => h('div', { class: 'wl-popup', dir: 'rtl' },
          h('b', {}, lb.name), h('div', {}, lb.addr), g.approx ? h('i', {}, 'מיקום משוער (מרכז העיר)') : null,
          h('div', { class: 'row', style: 'gap:6px;align-items:center;margin-top:6px' }, 'מקום בסדר:',
            rnumInput(l, id, () => { persist(); map.closePopup(); redraw(); }),
            h('button', { class: 'btn', title: 'מוקדם יותר', disabled: i === 0 ? true : null, onclick: () => mv(i) }, '↑'),
            h('button', { class: 'btn', title: 'מאוחר יותר', disabled: i === l.route.length - 1 ? true : null, onclick: () => mv(i + 2) }, '↓'),
            h('button', { class: 'btn', title: 'שים אחרי התחנה שנבחרה קודם', onclick: () => { if (pickAfter && pickAfter !== id) { const k = l.route.indexOf(pickAfter); mv(k + (k < i ? 2 : 1)); pickAfter = null; } else { pickAfter = id; ui.toast('עכשיו לחץ על התחנה שתבוא מיד אחרי זו, ובחר "שים אחרי…"', 3500); map.closePopup(); } } }, pickAfter && pickAfter !== id ? 'שים אחרי ' + label(l.rows.find(x => x.id === pickAfter)).name : '📌 מה בא אחרי זו?')),
          h('div', { class: 'row', style: 'gap:10px;align-items:center;margin-top:6px' },
            h('button', { class: 'btn', onclick: () => { map.closePopup(); fixLoc(r); } }, '📍 תקן מיקום'),
            h('a', { href: navUrl(r), target: '_blank', rel: 'noopener' }, 'נווט בוויז')),
          h('div', { class: 'muted small' }, g.manual ? 'מיקום שתיקנת ביד' : 'אפשר גם לגרור את הנקודה'));
        L.marker([g.lat, g.lon], { icon, draggable: g.src !== 'gps' }).addTo(layer).bindPopup(pop)
          .on('dragend', e => { const p = e.target.getLatLng(); setManual(r, { lat: p.lat, lon: p.lng }); ui.toast('המיקום של ' + lb.name + ' עודכן', 2500); });
        ll.push([g.lat, g.lon]);
      });
      if (ll.length && !userMoved) map.fitBounds(L.latLngBounds(ll).pad(0.15), { maxZoom: 15 });
      if (ll.length < 2) { drive = null; return; }
      const key = ll.map(x => x.join(',')).join(';');
      const air = L.polyline(ll, { color: '#2e6b33', weight: 3, opacity: .6, dashArray: '6 6' }).addTo(layer);
      const myLayer = layer;
      drive = driveCache.get(key) || null; showStatus();
      (driveCache.has(key) ? Promise.resolve(driveCache.get(key)) : driveRoute(ll.map(([lat, lon]) => ({ lat, lon }))).then(r => { driveCache.set(key, r); return r; }))
        .then(r => {
          if (layer !== myLayer) return;
          air.remove();
          L.polyline(r.line, { color: '#1a73e8', weight: 5, opacity: .8 }).addTo(layer);
          drive = r; showStatus();
        })
        .catch(() => { drive = null; showStatus(); });
    }
    function drawList() {
      const idx = new Map(l.route.map((id, i) => [id, i]));
      let tot = 0, prev = null;
      const vs = vis();
      for (const id of vs) { const g = geo.get(id); if (g && prev) tot += km(prev, g); if (g) prev = g; }
      listBox.replaceChildren(...vs.map((id, k) => {
        const i = l.route.indexOf(id);
        const r = l.rows.find(x => x.id === id); if (!r) return null;
        const lb = label(r), g = geo.get(id);
        // למעלה / למטה: מחליף עם התחנה הסמוכה ברשימה המוצגת (באותו יום)
        const move = dlt => { const o = vs[k + dlt]; if (!o) return; const j = l.route.indexOf(o); [l.route[i], l.route[j]] = [l.route[j], l.route[i]]; persist(); redraw(); };
        return h('div', { class: 'wl-stop' + (done(r) ? ' done' : '') },
          rnumInput(l, id, () => { persist(); redraw(); }),
          h('div', { style: 'flex:1;min-width:0' }, h('b', {}, lb.name), done(r) ? h('span', { class: 'wl-badge done', style: 'margin-inline-start:6px' }, '✓ הסתיים') : null,
            h('div', { class: 'muted small' }, lb.addr + (g ? (g.manual ? ' · מיקום שתיקנת' : g.approx ? ' · מיקום משוער' : '') : geo.has(id) ? ' · לא נמצא במפה, לחץ 📍' : ''))),
          h('button', { class: 'icon-btn', title: 'למעלה', 'aria-label': 'הזז למעלה', disabled: k === 0 ? true : null, onclick: () => move(-1) }, '↑'),
          h('button', { class: 'icon-btn', title: 'למטה', 'aria-label': 'הזז למטה', disabled: k === vs.length - 1 ? true : null, onclick: () => move(1) }, '↓'),
          h('button', { class: 'icon-btn', title: 'תקן מיקום במפה', 'aria-label': 'תקן מיקום', onclick: () => fixLoc(r) }, '📍'),
          h('a', { class: 'btn', href: navUrl(r), target: '_blank', rel: 'noopener' }, 'וייז'),
          h('button', { class: 'icon-btn', title: 'הוצא מהמסלול', 'aria-label': 'הוצא מהמסלול', onclick: () => { l.route.splice(i, 1); persist(); redraw(); } }, '✕'));
      }));
      const out = live().filter(r => !idx.has(r.id));
      outBox.replaceChildren(...(out.length ? [h('b', {}, `לא במסלול (${out.length})`), ...out.map(r => h('div', { class: 'wl-stop out' },
        h('div', { style: 'flex:1;min-width:0' }, label(r).name, done(r) ? ' ✓' : '', h('div', { class: 'muted small' }, label(r).addr)),
        h('button', { class: 'btn', onclick: async () => { l.route.push(r.id); persist(); await locateAll(); redraw(); } }, '➕ הוסף')))] : []));
      const links = gmapsLinks();
      linksBox.replaceChildren(
        links.length > 1 ? h('div', { class: 'muted small', style: 'flex-basis:100%' }, `גוגל מפות מקבל עד 10 תחנות בקישור, ולכן המסלול מחולק ל-${links.length} קישורים לפי הסדר (כל חלק מתחיל איפה שהקודם נגמר):`) : '',
        ...links.map((u, i) => h('a', { class: 'btn primary', href: u, target: '_blank', rel: 'noopener' }, '🧭 גוגל מפות' + (links.length > 1 ? ` ${i + 1}/${links.length}` : ''))),
        h('button', { class: 'btn', title: 'קובץ CSV עם כל התחנות ממוספרות, לייבוא ל-Google My Maps (המפות שלי)', onclick: exportMyMaps }, '⬇ כל התחנות ל-Google My Maps'));
      airKm = tot; showStatus();
    }
    let drive = null, airKm = 0;
    const driveCache = new Map();
    const hm = m => m >= 60 ? `${Math.floor(m / 60)} ש' ${Math.round(m % 60)} דק'` : `${Math.round(m)} דק'`;
    function showStatus() {
      status.textContent = (job && !job.done ? `מאתר כתובות במפה… ${job.i} מתוך ${job.n} (ממשיך גם אם יוצאים מהמסך) · ` : '') + (day ? `${day}: ` : '') + `${vis().length} תחנות במסלול` + (drive ? ` · ${Math.round(drive.km)} ק"מ נסיעה בכבישים · כ-${hm(drive.min)} (בלי עצירות)` : airKm ? ` · כ-${Math.round(airKm)} ק"מ בקו אווירי` : '');
    }
    const redraw = () => { drawList(); drawMap(); };
    // כל התחנות (בלי הגבלה) ממוספרות לפי הסדר: CSV לייבוא ב-Google My Maps (שכבה חדשה > ייבוא, מיקום לפי Latitude/Longitude, כותרת לפי "שם")
    function exportMyMaps() {
      const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const lines = [['מספר', 'שם', 'כתובת', 'Latitude', 'Longitude', 'סטטוס'].map(q).join(',')];
      vis().forEach(id => {
        const r = l.rows.find(x => x.id === id); if (!r) return;
        const i = l.route.indexOf(id) + 1, lb = label(r), g = geo.get(id) || r.geo;
        lines.push([i, `${i}. ${lb.name}`, lb.addr, g ? g.lat.toFixed(6) : '', g ? g.lon.toFixed(6) : '', done(r) ? 'הסתיים' : ''].map(q).join(','));
      });
      ui.downloadFile(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), ui.safeName((l.name || 'רשימה') + ' - מסלול') + '.csv');
      ui.toast('הקובץ הורד. ב-My Maps: שכבה חדשה > ייבוא > בחר את הקובץ > מיקום לפי Latitude ו-Longitude > כותרת לפי "שם"', 8000);
    }
    // האיתור רץ ברקע (geoJob); המסך מתעדכן תוך כדי, כל כמה תחנות
    let lastDraw = 0, job = null;
    function locateAll() {
      job = geoJob(l, local);
      if (!job.subs.has(onGeo)) job.subs.add(onGeo);
      return job.p;
    }
    function onGeo(r, g) {
      if (!document.body.contains(status)) { job && job.subs.delete(onGeo); return; }
      if (r) geo.set(r.id, g);
      if (!r || Date.now() - lastDraw > 2500) { lastDraw = Date.now(); redraw(); }
      if (job.err && r) status.textContent = 'שגיאה באיתור: ' + job.err;
    }
    async function auto() {
      if (l.start.mode === 'addr') { l.start.addr = clean(startAddr.value); }
      const start0 = startPoint(); // נקודת ההתחלה קודם, לפני שאר הכתובות בתור
      const jb = geoJob(l, local);
      if (!jb.done) ui.toast(`מאתר עוד כתובות (${jb.i} מתוך ${jb.n}). הסידור יתבצע מיד כשזה ייגמר`, 4000);
      await locateAll();
      const scope = vis(), slots = scope.map(id => l.route.indexOf(id)); // יום שנבחר: מסדרים רק אותו, במקומות שלו במסלול
      const ids = scope.filter(id => geo.get(id));
      const rest = scope.filter(id => !geo.get(id));
      const start = await start0;
      const pts = ids.map(id => geo.get(id));
      let cost = null;
      if (pts.length > 1 && pts.length < 99) {
        status.textContent = 'מחשב זמני נסיעה בכבישים…';
        try {
          const m = await driveTable(start ? [start, ...pts] : pts), o = start ? 1 : 0;
          if (m && m.every(row => row.every(x => x != null))) cost = (i, j) => m[i + o][j + o];
        } catch (e) { /* בלי שירות ניתוב: קו אווירי */ }
      }
      const ord = bestOrder(pts, start, cost);
      const neu = [...ord.map(i => ids[i]), ...rest];
      if (day) { const r2 = l.route.slice(); slots.forEach((p, k) => { r2[p] = neu[k]; }); l.route = r2; } else l.route = neu;
      persist(); redraw();
      ui.toast(cost ? 'המסלול סודר לפי זמן הנסיעה בכבישים' : 'שירות הניתוב לא זמין: המסלול סודר לפי קו אווירי', 3000);
    }
    // המיקום שלי על המפה (נקודה כחולה כמו בגוגל מפות) + כפתור למרכז אליו
    let me = null, meDot = null, meAcc = null, watch = null, follow = false;
    function showMe() {
      if (!navigator.geolocation || !map) return;
      const Btn = L.Control.extend({ options: { position: 'topleft' }, onAdd: () => {
        const b = L.DomUtil.create('button', 'wl-mebtn');
        b.type = 'button'; b.title = 'המיקום שלי'; b.setAttribute('aria-label', 'המיקום שלי'); b.textContent = '◎';
        L.DomEvent.disableClickPropagation(b);
        b.onclick = () => { follow = true; if (me) map.setView([me.lat, me.lon], Math.max(map.getZoom(), 15)); else ui.toast('מחפש את המיקום שלך…', 2000); };
        return b;
      } });
      new Btn().addTo(map);
      watch = navigator.geolocation.watchPosition(p => {
        me = { lat: p.coords.latitude, lon: p.coords.longitude };
        const ll = [me.lat, me.lon];
        if (!meDot) {
          meAcc = L.circle(ll, { radius: p.coords.accuracy, color: '#1a73e8', weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
          meDot = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map).bindPopup('המיקום שלי');
        } else { meDot.setLatLng(ll); meAcc.setLatLng(ll).setRadius(p.coords.accuracy); }
        if (follow) { map.panTo(ll); follow = false; }
      }, () => {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
      const stop = () => { if (watch != null) navigator.geolocation.clearWatch(watch); watch = null; window.removeEventListener('hashchange', stop); };
      window.addEventListener('hashchange', stop);
    }
    ui.app().replaceChildren(ui.bar({ title: 'מסלול נסיעה', sub: l.name }, back),
      h('main', { class: 'wl-route' },
        mapEl,
        h('div', { class: 'stack' },
          h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:center' },
            h('button', { class: 'btn primary', onclick: ev => { ev.currentTarget.disabled = true; auto().finally(() => { ev.target.disabled = false; }); } }, '⚡ סדר אוטומטי (הכי מהר בכבישים)'),
            h('label', { class: 'row small', style: 'gap:6px;align-items:center' }, 'התחלה:', startSel), startWrap, startPick),
          dayBox, linksBox, status, listBox,
          h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
            h('button', { class: 'btn', onclick: async () => { await DB.setKV('wlView:' + l.id, { sort: { col: '_route', dir: 1 }, filt: {} }); ui.go(back); } }, 'מיין את הטבלה לפי המסלול'),
            h('button', { class: 'btn', onclick: async () => { l.route = live().filter(r => !done(r)).map(r => r.id); persist(); await locateAll(); redraw(); } }, 'כל מה שלא הסתיים')),
          outBox)));
    drawDays();
    drawList();
    try {
      await ui.leaflet();
      map = L.map(mapEl, { zoomControl: true }).setView([32.3, 35.0], 8);
      map.on('dragstart', () => { userMoved = true; });
      map.on('click', e => { if (!pickLoc) return; const f = pickLoc; pickLoc = null; mapEl.classList.remove('picking'); userMoved = true; f(e.latlng); }); mapEl.addEventListener('wheel', () => { userMoved = true; }, { passive: true });
      const g = ui.mapLayers()['גוגל – מפה'];
      L.tileLayer(g[0], g[1]).addTo(map);
      showMe();
    } catch (e) { mapEl.replaceChildren(h('div', { class: 'muted small', style: 'padding:16px' }, 'המפה לא נטענה: ' + e.message)); }
    if (navigator.onLine === false) { status.textContent = 'אין קליטה: אי אפשר לאתר כתובות במפה'; for (const id of l.route) { const r = l.rows.find(x => x.id === id); if (r && r.geo) geo.set(id, r.geo); } redraw(); return; }
    for (const id of l.route) { const r = l.rows.find(x => x.id === id); if (r && r.geo) geo.set(id, r.geo); }
    redraw();
    if (l.start.mode === 'addr' && l.start.addr && !(l.start.geo && l.start.geo.key === l.start.addr)) startPoint().then(g => { if (g) redraw(); });
    locateAll().then(() => { showStatus(); redraw(); if (job && job.err) status.textContent += ' · שגיאה באיתור: ' + job.err; });
  }

  // גרירת קובץ רשימה (אקסל / CSV) למסכי הרשימות: ייבוא כרשימה חדשה. בתוך רשימה: הוספת מסמכים לרשימה
  let dropDocs = null;
  const docsTarget = () => { const m = /^#\/lists\/([^/]+)$/.exec(location.hash || ''); return m && dropDocs && dropDocs.id === decodeURIComponent(m[1]) ? dropDocs : null; };
  (function initDrop() {
    let depth = 0, mark = null;
    const on = () => (location.hash || '').startsWith('#/lists');
    const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    const hide = () => { depth = 0; if (mark) { mark.remove(); mark = null; } };
    window.addEventListener('dragenter', e => {
      if (!hasFiles(e) || !on()) return;
      e.preventDefault(); depth++;
      if (!mark) { mark = document.createElement('div'); mark.className = 'drop-plan'; mark.innerHTML = docsTarget() ? '<div>📁 שחרר כדי להוסיף מסמכים לרשימה</div>' : '<div>📥 שחרר כדי לייבא את הרשימה</div>'; document.body.append(mark); }
    });
    window.addEventListener('dragover', e => { if (hasFiles(e) && on()) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    window.addEventListener('dragleave', () => { if (mark && --depth <= 0) hide(); });
    window.addEventListener('drop', async e => {
      if (!hasFiles(e) || !on()) return;
      e.preventDefault(); hide();
      const dt = docsTarget();
      if (dt) { if (e.dataTransfer.files.length) dt.add([...e.dataTransfer.files]); return; }
      const f = [...e.dataTransfer.files].find(x => /\.(xlsx|xlsm|csv|xls)$/i.test(x.name));
      if (!f) { U().toast('אפשר לגרור קובץ אקסל (xlsx) או CSV', 3500); return; }
      await importFile(f);
    });
  })();

  root.WorkLists = { render, sync, _t: { geoStreet, bestOrder, norm, streetKey, scoreOf, guessHeader, buildFromRaw, valuesOf, mergeList, parseCsv } };
})(window);

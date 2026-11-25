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

  // (1.169, ori) גרירת סימן במפה רק אחרי לחיצה ארוכה (חצי שנייה בלי להזיז את האצבע). נגיעה רגעית
  // תוך כדי הזזת המפה לא גוררת את הסימן; הקשה רגילה עדיין פותחת אותו. בסוף הגרירה נשלח 'dragend' כרגיל
  const HOLD_MS = 500, HOLD_TOL = 8;
  function holdDrag(mk) {
    mk._hold = true;
    mk.on('add', () => { const map = mk._map; if (map && !map._holdOn) holdSetup(map); });
    return mk;
  }
  function holdSetup(map) {
    map._holdOn = true;
    const box = map.getContainer();
    let st = null, eat = false;
    const pt = e => map.mouseEventToContainerPoint(e);
    const end = () => {
      if (!st) return;
      clearTimeout(st.t);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      const s = st; st = null;
      if (s.on) {
        if (s.mk._icon) s.mk._icon.classList.remove('wl-lift');
        map.dragging.enable();
        eat = true; setTimeout(() => { eat = false; }, 400); // לא לפתוח את החלון בשחרור
        if (s.moved) s.mk.fire('dragend', { distance: 1 });
      }
    };
    const move = e => {
      if (!st || e.pointerId !== st.id) return;
      const p = pt(e);
      if (!st.on) { if (p.distanceTo(st.p0) > HOLD_TOL) end(); return; } // זז לפני הזמן = הזזת מפה
      e.preventDefault(); e.stopPropagation();
      st.moved = true;
      st.mk.setLatLng(map.containerPointToLatLng(st.m0.add(p.subtract(st.p0))));
      st.mk.fire('drag');
    };
    const up = e => { if (st && e.pointerId === st.id) end(); };
    box.addEventListener('pointerdown', e => {
      end();
      if (e.isPrimary === false || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const icon = e.target.closest && e.target.closest('.leaflet-marker-icon');
      if (!icon) return;
      let mk = null;
      map.eachLayer(x => { if (x._hold && x._icon === icon) mk = x; });
      if (!mk) return;
      st = { mk, id: e.pointerId, p0: pt(e), m0: map.latLngToContainerPoint(mk.getLatLng()), on: false, moved: false };
      st.t = setTimeout(() => {
        if (!st) return;
        st.on = true;
        map.dragging.disable(); // המפה לא זזה בזמן גרירת הסימן
        mk.closePopup();
        if (mk._icon) mk._icon.classList.add('wl-lift');
        try { navigator.vibrate && navigator.vibrate(30); } catch (_) {}
      }, HOLD_MS);
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', up, true);
      document.addEventListener('pointercancel', up, true);
    }, true);
    box.addEventListener('click', e => { if (eat && e.target.closest && e.target.closest('.leaflet-marker-icon')) { eat = false; e.stopPropagation(); e.preventDefault(); } }, true);
    box.addEventListener('contextmenu', e => { if (st || (e.target.closest && e.target.closest('.leaflet-marker-icon'))) e.preventDefault(); }, true);
  }

  // שדות הסקר שאפשר לשייך להם עמודה. prev: כשפותחים על בסיס סקר קודם, הערך מהסקר הקודם נשאר (כבוי כברירת מחדל: הפרטים מהרשימה)
  const FIELDS = [
    { key: 'siteName', label: 'שם המוסד / האתר', re: /שם\s*ה?(מוסד|מעון|גן|אתר|בית\s*ספר|בי"ס)|^שם$|^מוסד|^מעון/, safetyOnly: true },
    { key: 'street', label: 'רחוב ומספר', re: /כתובת|רחוב/ },
    { key: 'city', label: 'עיר', re: /^עיר|ישוב|יישוב|רשות|^מקום$/ },
    { key: 'code', label: 'סמל מוסד', re: /סמל/, safetyOnly: true },
    { key: 'manager', label: 'מנהל/ת', re: /מנהל|אחראי|איש\s*קשר|גננ/, safetyOnly: true },
    // (1.155, ori) שכונה: תיקייה בתוך תיקיית הפרויקט בדרייב (סקרי עצים / ירושלים / גונן)
    { key: 'hood', label: 'שכונה (תיקייה בדרייב)', re: /שכונ/, safetyOnly: true },
    // (1.163, ori) קב"ט: בירושלים כללי תיקייה לכל קב"ט (הראשון, לפני /) בתוך תיקיית הפרויקט, ובתוכה השכונות
    { key: 'kabat', label: 'קב"ט (תיקייה בדרייב, מעל השכונה)', re: /קב["״'׳]?ט/, safetyOnly: true },
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
  // מילות שם הרחוב (לפני מספר הבית), 3 אותיות ומעלה
  function streetWords(street) {
    const w = norm(street).split(' '), i = w.findIndex(x => /^\d+[א-ת]?$/.test(x));
    return [...new Set((i > 0 ? w.slice(0, i) : w).filter(x => !/\d/.test(x) && x.length >= 3))];
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
    // (1.135) כל מילות הרחוב נבדקות, לא רק זו שלפני המספר: ברשימות הרחוב כתוב לפעמים "בן אליעזר אריה 21" או "רובוביץ אלכסנדר 10",
    // ובשם הקובץ "בן אליעזר 21" / "אלכסנדר רובוביץ 10". stHit: לפחות חצי מהמילים; stFull: כולן
    const { word, num } = streetKey(v.street), sw = streetWords(v.street);
    const got = sw.filter(w => hasWord(hay, w)).length;
    const stHit = sw.length ? got >= Math.ceil(sw.length / 2) : !!(word && word.length >= 2 && hasWord(hay, word));
    const stFull = stHit && got === sw.length;
    const numHit = !!(stHit && num && hasWord(hay, num));
    if (stHit) sc += (numHit ? 4 : 3) - (stFull ? 0 : 0.5);
    return { sc, cityHit, stHit, stFull, numHit };
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
      .filter(x => !x.path.some(n => /^גיבוי אפליקציית סקרי עצים$/.test(n)) && !/^טעינת עצים/.test(x.f.name) && !/דו["״”]?ח\s*מנהלים/.test(x.f.name)); // דוח מנהלים הוא ריכוז, לא סקר
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
      const terms = [...new Set([...(codeTerms.length > 1 ? codeTerms : [v.code || '']), word && word.length >= 2 ? word : '', ...streetWords(v.street), clean(v.city), ...extra].filter(Boolean))].slice(0, 7);
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
        if (f.key === 'hood' && !hoodOn(l)) continue;
        if (f.key === 'kabat') continue; // נכנס לסקר רק השם הראשון (למטה)
        if (fromPrev && (l.map[f.key] || {}).prev && clean(s[f.key])) continue;
        // שני סמלי מוסד בתא אחד: שניהם נכנסים לדוח, מופרדים בפסיק
        s[f.key] = f.key === 'code' && root.Reports ? root.Reports.codeText(v[f.key]) : v[f.key];
      }
      if (l.project) s.project = l.project;
      // (1.155) שכונה: מהעמודה, ואם אין ברשימה הזו מהרשימות האחרות (לפי סמל או כתובת)
      if (!clean(s.hood) && cache && hoodOn(l)) { const ix0 = hoodIx; if (ix0) { const hh = hoodLookup(l, r, ix0); if (hh) s.hood = hh; } }
      // (1.163) קב"ט: תיקייה מעל השכונה, רק בתיקיית הפרויקט של הרשימה הזו. בלי קב"ט: "ללא שיוך"
      if (kabatOn(l)) { s.kabatProj = clean(l.project); s.kabat = kabatOfRow(l, r); }
      // שורה שכתוב בה "אורנים" (למשל בהערות): הסקר נפתח כסקר אורנים (חלון פרטי אורנים, תזכורות, אקסל ריכוז)
      if (l.type !== 'construction' && Object.values(r.cells || {}).some(v => /(^|[\s,;(])[הו]?או?רני?ם/.test(String(v || '')))) s.pinesMode = true;
      if ((l.repl || []).length) s.nameRepl = l.repl;
      s.listRef = { list: l.id, row: r.id, name: l.name };
      s.site = U().composeSite(s);
      r.sid = s.id; r.u = Date.now();
      save(l);
      linkTwinsNow(r, s);
    };
  }

  // ---------- אותו מוסד בכמה רשימות (1.150, ori) ----------
  // סמל מוסד ששייך גם לשורה ברשימה אחרת: שואלים, ואם מאשרים יש סקר אחד לשתי השורות,
  // והדוחות נשמרים גם בתיקיית הפרויקט של הרשימה השנייה (s.extraProjects, ב-Sync.putReportFile)
  const PINES_RE = /(^|[\s,;(])[הו]?או?רני?ם/;
  const codeKeys = (L, r) => Core.codesOf(valuesOf(L, r).code).map(c => c.replace(/\D+/g, '')).filter(c => c.length >= 3);
  async function twinsOf(l, r) {
    const mine = new Set(codeKeys(l, r));
    if (!mine.size) return [];
    const out = [];
    for (const L of await live()) {
      if (L.id === l.id) continue;
      for (const x of L.rows) if (!x.deleted && codeKeys(L, x).some(c => mine.has(c))) out.push({ L, r: x });
    }
    return out;
  }
  // הסקר s של השורה r: כל השורות-התאומות שאושרו (r.twins) מקבלות אותו סקר, והפרויקטים שלהן נכנסים לסקר
  // l = הרשימה של r: כשממשיכים סקר שנפתח ברשימה אחרת, גם הפרויקט שלה נוסף
  function linkTwinsNow(r, s, l) {
    if (!(r.twins || []).length || !cache) return;
    const projs = new Set(s.extraProjects || []);
    if (l && r.sid === s.id && clean(l.project) && clean(l.project) !== clean(s.project)) projs.add(clean(l.project));
    for (const tw of r.twins) {
      const L = cache.find(x => x.id === tw.list && !x.deleted), x = L && L.rows.find(y => y.id === tw.row && !y.deleted);
      if (!x) continue;
      if (!x.sid) { x.sid = s.id; x.u = Date.now(); save(L); }
      if (x.sid !== s.id) continue;
      if (clean(L.project) && clean(L.project) !== clean(s.project)) projs.add(clean(L.project));
      // השורה השנייה היא שורת אורנים: גם הסקר המשותף הוא סקר אורנים
      if (L.type !== 'construction' && Object.values(x.cells || {}).some(v => PINES_RE.test(String(v || '')))) s.pinesMode = true;
    }
    if (projs.size) s.extraProjects = [...projs]; else delete s.extraProjects;
  }
  async function linkTwins(r, sid, l) {
    const s = await DB.getSurvey(sid);
    if (!s || s.deleted) return;
    const before = JSON.stringify(s.extraProjects || []);
    linkTwinsNow(r, s, l);
    if (JSON.stringify(s.extraProjects || []) !== before) await DB.putSurvey(s);
  }
  // לפני פתיחת סקר משורה: אם הסמל נמצא גם ברשימות אחרות, שואלים. מחזיר סקר להמשיך בו, או null
  // (1.168, ori) תיבת סימון לכל שורה (שם הרשימה + המוסד), אפשר לבחור רק חלק. שואלים גם כשלשורה כבר יש סקר
  // (רשימה שעלתה אחרי שהסקר נפתח), ונזכרות רק השורות שלא סומנו (r.twinsNo), כך שרשימה חדשה תישאל שוב
  const twKey = t => t.L.id + ':' + t.r.id;
  async function askTwins(l, r) {
    let mineS = null;
    if (r.sid) { mineS = await DB.getSurvey(r.sid); if (!mineS || mineS.deleted) return null; }
    let tw = await twinsOf(l, r);
    if (!tw.length) return null;
    // שאלה מגרסה קודמת (r.twinsAsked בלי r.twinsNo): הרשימות שכבר היו אז נחשבות כנשאלו
    if (r.twinsAsked && !r.twinsNo) {
      r.twinsNo = tw.filter(t => !(t.L.created > (r.u || 0))).map(twKey);
      r.u = Date.now(); await save(l);
    }
    const linked = new Set((r.twins || []).map(t => t.list + ':' + t.row));
    const no = new Set(r.twinsNo || []);
    tw = tw.filter(t => !linked.has(twKey(t)) && !no.has(twKey(t)) && !(r.sid && t.r.sid === r.sid));
    if (!tw.length) return null;
    const ui = U(), h = ui.h;
    // סקרים שכבר נפתחו בשורות האחרות
    const sv = new Map();
    for (const t of tw) if (t.r.sid && !sv.has(t.r.sid)) { const s = await DB.getSurvey(t.r.sid); sv.set(t.r.sid, s && !s.deleted ? s : null); }
    // לשורה הזו אין סקר: אפשר להמשיך סקר שנפתח בשורה אחרת (הראשון). לשורה יש סקר: רק שורות בלי סקר
    const open = !r.sid && tw.map(t => t.r.sid && sv.get(t.r.sid) ? { t, s: sv.get(t.r.sid) } : null).find(Boolean) || null;
    const can = t => !t.r.sid || (open && t.r.sid === open.s.id);
    const pick = tw.filter(can);
    if (!pick.length) return null;
    const lname = L => `"${L.name || 'רשימה'}"` + (clean(L.project) && clean(L.project) !== clean(l.project) ? ` · פרויקט ${clean(L.project)}` : '');
    const code = codeKeys(l, r).join(', ');
    const choice = await new Promise(resolve => {
      const boxes = new Map();
      const rows = tw.map(t => {
        const ok = can(t), other = !!t.r.sid;
        const cb = h('input', { type: 'checkbox', style: 'width:22px;height:22px;flex:none' });
        cb.checked = ok; cb.disabled = !ok;
        if (ok) boxes.set(t, cb);
        const note = open && t.r.sid === open.s.id ? `כבר נפתח כאן סקר (${open.s.site || 'סקר'} מ-${ui.fmtDate(open.s.date)}), ימשיכו אותו`
          : other ? 'יש בשורה הזו סקר אחר. לשיוך: "📁 שיוך" בפרטי הסקר' : '';
        return h('label', { class: 'card row', style: 'gap:10px;align-items:center;padding:10px;cursor:pointer' + (ok ? '' : ';opacity:.6') }, cb,
          h('div', { style: 'flex:1;min-width:0' }, h('b', {}, 'רשימה ' + lname(t.L)), h('div', { class: 'small' }, labelOf(t.L, t.r)),
            note ? h('div', { class: 'muted small' }, note) : null));
      });
      const done = v => { ov.remove(); resolve(v); };
      const ov = h('div', { class: 'modal' },
        h('div', { class: 'card stack', style: 'max-width:560px;width:94%;max-height:90vh;overflow:auto' },
          h('h2', { style: 'margin:0;font-size:21px' }, `סמל מוסד ${code} נמצא גם ${new Set(tw.map(t => t.L.id)).size > 1 ? 'ב-' + new Set(tw.map(t => t.L.id)).size + ' רשימות נוספות' : 'ברשימה נוספת'}`),
          h('div', { class: 'muted small' }, (r.sid ? 'לסקר הזה' : 'סקר אחד') + ' לכל השורות שתסמן: הקבצים נשמרים בתיקיית הפרויקט של הרשימה הזו' + (clean(l.project) ? ` (${clean(l.project)})` : '') + ', ועותק בתיקיית הפרויקט של כל רשימה מסומנת.'),
          ...rows,
          h('button', { class: 'btn primary big block', onclick: () => done([...boxes].filter(([, cb]) => cb.checked).map(([t]) => t)) }, 'שמור גם ברשימות המסומנות'),
          h('button', { class: 'btn block', onclick: () => done([]) }, r.sid ? 'לא עכשיו (לא ישאל שוב על השורות האלה)' : 'לא, סקר נפרד לרשימה הזו')));
      document.body.append(ov);
    });
    const chosen = new Set(choice.map(twKey));
    r.twinsAsked = true; r.u = Date.now();
    r.twinsNo = [...no, ...pick.filter(t => !chosen.has(twKey(t))).map(twKey)];
    if (!choice.length) { if (!(r.twins || []).length) delete r.twins; await save(l); return null; }
    const join = open && choice.some(t => t.r.sid === open.s.id) ? open : null;
    r.twins = [...(r.twins || []), ...choice.map(t => ({ list: t.L.id, row: t.r.id }))];
    if (join) r.sid = join.s.id;
    await save(l);
    const sid = r.sid;
    if (sid) {
      await linkTwins(r, sid, l);
      const s = await DB.getSurvey(sid);
      if (s && root.Sync && Sync.relocate) Sync.relocate(s).then(n => { if (n) ui.toast(`${n} קבצים הועתקו/הועברו לתיקיות הרשימות`, 3000); }).catch(() => {});
      ui.toast('הסקר ישמר גם ב: ' + [...new Set(choice.map(t => t.L.name || 'רשימה'))].join(', '), 3500);
      return join ? join.s : null;
    }
    return null;
  }
  // שם המוסד בשורה, לחלון השאלה
  function labelOf(L, x) { const v = valuesOf(L, x); return [v.siteName, v.street].filter(Boolean).join(', ') || 'שורה'; }

  // ---------- שכונה (1.155, ori) ----------
  // ברשימה הכללית יש עמודת שכונה. ברשימה בלי שכונה (למשל האורנים) נוספת עמודה "שכונה" שמתמלאת מהרשימות האחרות
  // לפי סמל מוסד, ואם אין סמל תואם לפי אותה כתובת. מה שנכתב ביד בתא לא נדרס
  const addrKey = (L, r) => { const v = valuesOf(L, r), st = norm(v.street).split(' ').filter(Boolean).sort().join(' '); return st && /\d/.test(st) ? st + '|' + norm(v.city) : ''; };
  // (1.156.1, ori: "השיוך חייב להיות אמיתי ונכון") רק מעמודות שכונה מקוריות (לא מעמודה שהאפליקציה מילאה, כדי לא לנחש על ניחוש).
  // אותו סמל / אותה כתובת עם שתי שכונות שונות = לא ברור = בלי שיוך. סמל שנמצא ברשימה אבל בלי שכונה = בלי שיוך (לא עוברים לכתובת)
  async function hoodIndex(l) {
    const code = new Map(), addr = new Map();
    const add = (m, k, h) => { if (!m.has(k)) m.set(k, new Set()); if (h) m.get(k).add(h); };
    for (const L of await live()) {
      if ((l && L.id === l.id) || L.type === 'construction') continue;
      const mapped = colsOf((L.map || {}).hood);
      if (mapped.length && L.hoodAuto && mapped[0] === L.hoodAuto) continue;
      const hc = mapped.length ? null : (L.cols || []).find(c => /שכונ/.test(c.name));
      if (!hc && !mapped.length) continue;
      for (const r of L.rows) {
        if (r.deleted) continue;
        const h = clean(hc ? r.cells[hc.id] : valuesOf(L, r).hood);
        for (const c of codeKeys(L, r)) add(code, c, h);
        const a = addrKey(L, r); if (a) add(addr, a, h);
      }
    }
    return { code, addr, size: code.size + addr.size };
  }
  // מחזיר { h, by } או { h: '', why }
  function hoodMatch(codes, ak, ix) {
    for (const c of codes) if (ix.code.has(c)) {
      const set = ix.code.get(c);
      if (set.size === 1) return { h: [...set][0], by: 'סמל ' + c };
      return { h: '', why: set.size ? `לסמל ${c} יש ${set.size} שכונות שונות` : `לסמל ${c} אין שכונה ברשימה` };
    }
    if (ak && ix.addr.has(ak)) {
      const set = ix.addr.get(ak);
      if (set.size === 1) return { h: [...set][0], by: 'אותה כתובת' };
      return { h: '', why: set.size ? `לכתובת הזו יש ${set.size} שכונות שונות` : 'לכתובת הזו אין שכונה ברשימה' };
    }
    return { h: '', why: 'הסמל והכתובת לא נמצאו ברשימה עם שכונות' };
  }
  const hoodLookup = (l, r, ix) => hoodMatch(codeKeys(l, r), addrKey(l, r), ix).h;
  // (1.155.1, ori) תיקייה לפי שכונה דולקת לכל רשימה בנפרד (l.hoodOn). בלי בחירה: דולקת ברשימות של ירושלים
  const hoodOn = l => !!l && l.type !== 'construction' && (l.hoodOn != null ? !!l.hoodOn : /ירושל/.test(clean(l.project) + ' ' + clean(l.name)));
  async function ensureHood(l) {
    if (!hoodOn(l)) return false;
    l.map = l.map || {};
    let changed = false;
    if (!colsOf(l.map.hood).length) {
      const c = l.cols.find(c => /שכונ/.test(c.name) && !Object.values(l.map).some(m => colsOf(m).includes(c.id)));
      if (c) { l.map.hood = { col: c.id, pre: '', prev: false }; changed = true; }
    }
    if (!colsOf(l.map.hood).length && !l.hoodOff) {
      const ix = await hoodIndex(l);
      if (ix.size) {
        const id = 'hood' + uid(); let found = 0;
        for (const r of l.rows) { if (r.deleted) continue; const h = hoodLookup(l, r, ix); r.cells[id] = h; if (h) { r.hoodA = h; found++; r.u = Date.now(); } }
        if (found) { l.cols.push({ id, name: 'שכונה' }); l.map.hood = { col: id, pre: '', prev: false }; l.hoodAuto = id; changed = true; }
        else for (const r of l.rows) delete r.cells[id];
      }
    } else if (l.hoodAuto && l.map.hood && l.map.hood.col === l.hoodAuto && l.cols.some(c => c.id === l.hoodAuto)) {
      // עמודה שהאפליקציה הוסיפה: מתעדכנת לפי הרשימה עם השכונות (גם אם שם השתנה, או שהשיוך כבר לא ודאי).
      // תא שכתבת ביד (שונה ממה שהאפליקציה מילאה, r.hoodA) לא נדרס
      const ix = await hoodIndex(l);
      for (const r of l.rows) {
        if (r.deleted) continue;
        const cur = clean(r.cells[l.hoodAuto]);
        // שורות שמולאו בגרסה 1.155 (בלי hoodA) נבדקות מחדש; תא שנכתב ביד אחרי המילוי נשאר
        if (cur && r.hoodA != null && cur !== clean(r.hoodA)) continue;
        const h = hoodLookup(l, r, ix);
        if (h !== cur || (h && r.hoodA !== h)) { r.cells[l.hoodAuto] = h; if (h) r.hoodA = h; else delete r.hoodA; r.u = Date.now(); changed = true; }
      }
    }
    if (changed) await save(l);
    return changed;
  }
  // שכונה של שורה: מהעמודה, ואם ריקה מהרשימות האחרות
  async function hoodOfRow(l, r) { return clean(valuesOf(l, r).hood) || hoodLookup(l, r, await hoodIndex(l)); }
  const allHoods = async () => [...new Set((await live()).flatMap(L => L.rows.filter(r => !r.deleted).map(r => clean(valuesOf(L, r).hood)).filter(Boolean)))].sort((a, b) => a.localeCompare(b, 'he'));
  // סקרים קיימים (גם שנעשו לפני 1.155): מקבלים את השכונה מהשורה, והקבצים בדרייב עוברים לתיקיית השכונה
  async function hoodToSurveys(l, local) {
    if (!hoodOn(l)) return;
    for (const r of l.rows) {
      if (r.deleted || !r.sid) continue;
      const s = local.get(r.sid);
      if (!s || s.deleted || s.hoodManual) continue;
      const own = !s.listRef || s.listRef.list === l.id;
      if (clean(s.hood) && !own) continue;
      const h = await hoodOfRow(l, r);
      if (clean(s.hood) === h) continue;
      // (1.156.1) אין שיוך ודאי: סקר שקיבל שכונה אוטומטית חוזר ל"ללא שיוך" (הקבצים חוזרים לתיקיית הפרויקט)
      if (!h && !own) continue;
      if (h) s.hood = h; else delete s.hood;
      await DB.putSurvey(s);
      Sync.relocate(s).then(n => { if (n) U().toast(`${n} קבצים של ${s.siteName || 'הסקר'} הועברו לתיקייה ${h || clean(s.project) + ' (ללא שיוך לשכונה)'}`, 3000); }).catch(() => {});
    }
  }

  // (1.155.1) בכל הפעלה (ואחרי סנכרון הרשימות): שכונה לסקרים שכבר נעשו מרשימות שהשכונה דולקת בהן, והעברת הקבצים
  async function autoHoods() {
    if (!root.DB || !root.Sync) return;
    const local = new Map((await DB.allSurveys()).map(s => [s.id, s]));
    for (const L of await live()) if (hoodOn(L)) { await ensureHood(L).catch(() => {}); await hoodToSurveys(L, local).catch(() => {}); }
    await kabatToSurveys(local).catch(e => console.warn('kabat', e));
  }
  setTimeout(() => { sync(false).catch(() => {}).then(() => mirrorGeoAll().catch(e => console.warn('mirror', e))).then(autoHoods).catch(() => {}); }, 6000);

  // ---------- תיקייה לפי קב"ט (1.163, ori) ----------
  // ירושלים כללי: סקרי עצים / ירושלים / <קב"ט ראשון> / <שכונה>. שורה בלי קב"ט ודאי: "ללא שיוך" / <שכונה>.
  // רק ברשימה שיש בה עמודת קב"ט (l.map.kabat), ואפשר לכבות (l.kabatOn). לא ברשימות האורנים / החדשים
  const NO_KABAT = 'ללא שיוך', KABAT_RE = /קב["״'׳]?ט/;
  const codesIn = v => Core.codesOf(v).map(c => c.replace(/\D+/g, '')).filter(c => c.length >= 3);
  // "און אסרף / דניאל יודורובסקי" -> "און אסרף"; "שלומי כהן {גיבוי}" -> "שלומי כהן"; "-" / "אין" -> ''
  const kabatFirst = v => { const t = clean(String(v || '').split(/[/\\|;,]/)[0].replace(/\{[^}]*\}?|\([^)]*\)?|\[[^\]]*\]?/g, ' ')).replace(/^[-–—.\s]+|[-–—.\s]+$/g, '');
    return /^(אין|ללא|לא ידוע|ללא שיוך|לא משויך|\?)$/.test(t) ? '' : t; };
  // אותו שם בכתיב אחר (אסנת / אוסנת, רווח כפול): תיקייה אחת
  const kabatKey = v => norm(v).replace(/[וי\s]/g, '');
  const kabatOn = l => !!l && l.type !== 'construction' && colsOf((l.map || {}).kabat).length > 0 &&
    (l.kabatOn != null ? !!l.kabatOn : !/אורנ|חדש/.test(clean(l.project) + ' ' + clean(l.name)));
  // הכתיב של כל קב"ט ברשימה: הנפוץ ביותר
  function kabatSpell(l) {
    const cnt = new Map();
    for (const r of l.rows) { if (r.deleted) continue; const n = kabatFirst(valuesOf(l, r).kabat); if (!n) continue; const k = kabatKey(n); if (!cnt.has(k)) cnt.set(k, new Map()); cnt.get(k).set(n, (cnt.get(k).get(n) || 0) + 1); }
    return new Map([...cnt].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
  }
  function kabatOfRow(l, r, sp) {
    const n = kabatFirst(valuesOf(l, r).kabat);
    return n ? (sp || kabatSpell(l)).get(kabatKey(n)) || n : '';
  }
  // ---------- צבע סמנים לפי קב"ט (1.174, ori) ----------
  // הקב"ט של שורה: מהעמודה שלה, ואם אין בה עמודה (רשימת האורנים / החדשים) לפי סמל המוסד מרשימה שיש בה עמודת קב"ט.
  // הצבע של כל קב"ט נשמר בכל רשימה שיש בה קב"ט (L.kabatColors {מפתח: צבע}), אז הוא אותו צבע בכל מפה, ראשית או משנית, ובכל מכשיר.
  // ההפעלה לכל רשימה (L.kabatPins) נשמרת ברשימה עצמה: אותו דבר כשהיא ראשית וכשהיא משנית. (מוכן לעבור לכלל בכישור של ירושלים)
  const KABAT_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00897b', '#f4511e', '#3949ab', '#c0ca33', '#6d4c41', '#d81b60', '#00acc1', '#5e35b1', '#7cb342'];
  const hasKabatCol = L => !!L && !L.deleted && colsOf((L.map || {}).kabat).length > 0;
  function kabatIndex(lists) {
    const byCode = new Map(), colors = new Map(), names = new Map(), sp = new Map();
    for (const L of lists) {
      if (!hasKabatCol(L)) continue;
      const spl = kabatSpell(L); sp.set(L.id, spl);
      for (const [k, c] of Object.entries(L.kabatColors || {})) if (/^#[0-9a-f]{6}$/i.test(c) && !colors.has(k)) colors.set(k, c);
      for (const r of L.rows) {
        if (r.deleted) continue;
        const n = kabatOfRow(L, r, spl); if (!n) continue;
        const k = kabatKey(n); if (!names.has(k)) names.set(k, n);
        for (const c of codeKeys(L, r)) if (!byCode.has(c)) byCode.set(c, k);
      }
    }
    // קב"ט בלי צבע שמור: הצבע הפנוי הבא (לפי א-ב, כדי שבכל מכשיר ייצא אותו דבר)
    const used = new Set([...colors.values()].map(c => c.toLowerCase()));
    for (const k of [...names.keys()].sort((a, b) => names.get(a).localeCompare(names.get(b), 'he'))) {
      if (colors.has(k)) continue;
      const c = KABAT_COLORS.find(x => !used.has(x)) || KABAT_COLORS[colors.size % KABAT_COLORS.length];
      colors.set(k, c); used.add(c);
    }
    return { byCode, colors, names, sp };
  }
  function rowKabatKey(L, r, ix) {
    if (hasKabatCol(L)) { let spl = ix.sp.get(L.id); if (!spl) { spl = kabatSpell(L); ix.sp.set(L.id, spl); } const n = kabatOfRow(L, r, spl); return n ? kabatKey(n) : ''; }
    for (const c of codeKeys(L, r)) { const k = ix.byCode.get(c); if (k) return k; }
    return '';
  }
  const kabatCapable = (L, ix) => hasKabatCol(L) || L.rows.some(r => !r.deleted && codeKeys(L, r).some(c => ix.byCode.has(c)));
  // צבע לקב"ט: נשמר בכל הרשימות שיש בהן קב"ט
  async function setKabatColor(k, c, lists, ix) {
    ix.colors.set(k, c);
    for (const L of lists) if (hasKabatCol(L)) { L.kabatColors = Object.assign({}, L.kabatColors || {}, { [k]: c }); await save(L); }
  }
  // סקרים שנפתחו מהרשימה (גם כרשימה נוספת של סקר משותף): הקב"ט לסקר והעברת הקבצים. רשימה שכובתה / שורה שהוסרה: הסקר חוזר לתיקיית הפרויקט / שכונה
  let kabatRun = Promise.resolve();
  async function kabatToSurveys(local) {
    const lists = await live(), want = new Map();
    for (const L of lists) {
      if (!kabatOn(L)) continue;
      const sp = kabatSpell(L);
      for (const r of L.rows) if (!r.deleted && r.sid && !want.has(r.sid)) want.set(r.sid, { proj: clean(L.project), kabat: kabatOfRow(L, r, sp) });
    }
    const projs = new Set(lists.map(L => clean(L.project)));
    const changed = [];
    for (const s of local.values()) {
      if (!s || s.deleted || Construction.isConstruction(s)) continue;
      const w = want.get(s.id);
      if (w) {
        // רק אם הסקר באמת שייך לפרויקט של הרשימה (ראשי או נוסף)
        if (![s.project, ...(s.extraProjects || [])].some(p => clean(p) === w.proj)) continue;
        if (s.kabatProj === w.proj && clean(s.kabat) === w.kabat) continue;
        s.kabatProj = w.proj; s.kabat = w.kabat;
      } else if (s.kabatProj != null && projs.has(s.kabatProj)) { delete s.kabatProj; delete s.kabat; }
      else continue;
      await DB.putSurvey(s);
      changed.push(s);
    }
    if (!changed.length) return 0;
    // אחד אחרי השני (כדי שתיקיות חדשות ייווצרו פעם אחת)
    kabatRun = kabatRun.then(async () => {
      let n = 0;
      for (const s of changed) n += await Sync.relocate(s).catch(e => { console.warn('kabat relocate', e); return 0; }) || 0;
      if (n) U().toast(`${n} קבצים הועברו לתיקיות לפי קב"ט ושכונה`, 3500);
    });
    return changed.length;
  }
  // הערך לכל שורה ברשימה מגיליון בקובץ: { ok, none: [תיאור], set: Map(שורה -> ערך) }
  function colPlan(l, sh, vi) {
    const ci = sh.code.i;
    const isK = KABAT_RE.test(sh.head[vi] || '');
    const si = sh.head.findIndex(n => /כתובת|רחוב/.test(n)), ni = sh.head.findIndex(n => /מס['׳]?\s*ה?בית|^מספר\s*בית/.test(n));
    const akey = (st, city) => { const t = norm(st).split(' ').filter(Boolean).sort().join(' '); return t && /\d/.test(t) ? t + '|' + norm(city || 'ירושלים') : ''; };
    const fAddr = r => si < 0 ? '' : akey(clean(r[si]) + (ni >= 0 && !/\d/.test(r[si]) ? ' ' + clean(r[ni]) : ''), '');
    const byCode = new Map();
    for (const r of sh.rows) for (const c of codesIn(r[ci])) { if (!byCode.has(c)) byCode.set(c, []); byCode.get(c).push(r); }
    const cmp = v => isK ? kabatKey(kabatFirst(v)) : norm(v);
    // מחזיר ערך אחד, או '' כשאין / לא חד-משמעי
    const pick = rs => { const vals = rs.map(r => clean(r[vi])).filter(v => cmp(v)); const keys = new Set(vals.map(cmp)); if (keys.size !== 1) return { v: '', why: keys.size ? 'ערכים שונים' : 'ריק בקובץ' }; const same = new Set(vals); return { v: same.size === 1 ? vals[0] : isK ? kabatFirst(vals[0]) : vals[0] }; };
    const res = { ok: 0, none: [], set: new Map() };
    for (const r of l.rows) {
      if (r.deleted) continue;
      const v = valuesOf(l, r), myA = akey(v.street, '');
      let rs = codeKeys(l, r).flatMap(c => byCode.get(c) || []), m = rs.length ? pick(rs) : null;
      // אותו סמל לכמה מוסדות עם ערכים שונים / בלי סמל תואם: לפי הכתובת (רחוב ומספר)
      if ((!m || !m.v) && myA) { const ra = (rs.length ? rs : sh.rows).filter(x => fAddr(x) === myA); if (ra.length) { const m2 = pick(ra); if (m2.v || !m) m = m2; } }
      if (m && m.v) { res.set.set(r.id, m.v); res.ok++; }
      else res.none.push([v.code ? 'סמל ' + v.code : 'בלי סמל', v.siteName, v.street].filter(Boolean).join(' · ') + ' (' + (m ? m.why : 'לא נמצא בקובץ') + ')');
    }
    return res;
  }

  // עמודה מקובץ אחר (1.163): למשל עמודת הקב"טים מהאקסל המקורי, לפי סמל המוסד (ואם הסמל לא חד-משמעי לפי הכתובת)
  async function addColumnFromFile(l, file, after) {
    const ui = U(), { h } = ui;
    const sheets = (await readFile(file)).map(sh => {
      const hr = guessHeader(sh.rows), head = (sh.rows[hr] || []).map(cellText);
      return { name: sh.name, hr, head, rows: sh.rows.slice(hr + 1).map(r => (r || []).map(cellText)).filter(r => r.some(Boolean)) };
    }).filter(sh => sh.head.filter(Boolean).length >= 2 && sh.rows.length);
    if (!sheets.length) { ui.toast('לא נמצאה טבלה בקובץ', 3500); return; }
    const myCodes = new Set(l.rows.filter(r => !r.deleted).flatMap(r => codeKeys(l, r)));
    // עמודת הסמל: זו שהכי הרבה מהסמלים שלה ברשימה
    const codeColOf = sh => { let best = -1, bi = -1; sh.head.forEach((_, i) => { const n = sh.rows.filter(r => codesIn(r[i]).some(c => myCodes.has(c))).length; if (n > best) { best = n; bi = i; } }); return { i: bi, n: best }; };
    sheets.forEach(sh => { sh.code = codeColOf(sh); });
    sheets.sort((a, b) => b.code.n - a.code.n);
    const sheetSel = h('select', { class: 'in' }, sheets.map((sh, i) => h('option', { value: i }, `${sh.name} (${sh.rows.length} שורות, ${sh.code.n} סמלים תואמים)`)));
    const colSel = h('select', { class: 'in' });
    const nameIn = h('input', { class: 'in', placeholder: 'שם העמודה ברשימה' });
    const out = h('div', { class: 'small stack', style: 'gap:4px' });
    let plan = null;
    const sheet = () => sheets[+sheetSel.value];
    function fillCols() {
      const sh = sheet();
      colSel.replaceChildren(...sh.head.map((n, i) => n && i !== sh.code.i ? h('option', { value: i }, n) : null).filter(Boolean));
      const k = sh.head.findIndex((n, i) => i !== sh.code.i && KABAT_RE.test(n));
      if (k >= 0) colSel.value = k;
      calc();
    }
    function calc() {
      const sh = sheet(), vi = +colSel.value, isK = KABAT_RE.test(sh.head[vi] || '');
      nameIn.value = isK ? 'קב"ט' : sh.head[vi] || '';
      const res = colPlan(l, sh, vi);
      plan = res;
      out.replaceChildren(h('b', {}, `✓ ${res.ok} שורות קיבלו ערך` + (res.none.length ? `, ${res.none.length} נשארות ריקות${isK ? ' (יישמרו ב"' + NO_KABAT + '")' : ''}:` : '')),
        ...res.none.slice(0, 40).map(t => h('div', { class: 'muted' }, '• ' + t)), ...(res.none.length > 40 ? [h('div', { class: 'muted' }, `ועוד ${res.none.length - 40}…`)] : []));
    }
    sheetSel.onchange = fillCols; colSel.onchange = calc;
    const close = () => ov.remove();
    const ok = h('button', { class: 'btn primary big', onclick: async () => {
      if (!plan) return;
      const name = clean(nameIn.value) || 'עמודה חדשה';
      const id = 'x' + uid();
      l.cols.push({ id, name });
      for (const r of l.rows) { if (r.deleted) continue; r.cells[id] = plan.set.get(r.id) || ''; r.u = Date.now(); }
      const f = l.type === 'construction' ? null : FIELDS.find(f => f.key === 'kabat' && f.re.test(name));
      l.map = l.map || {};
      if (f && f.key === 'kabat' && !colsOf(l.map.kabat).length) { l.map.kabat = { col: id, pre: '', prev: false }; delete l.kabatOn; }
      await save(l);
      close();
      ui.toast(`העמודה "${name}" נוספה (${plan.ok} שורות)` + (kabatOn(l) ? '. הסקרים עוברים לתיקיות לפי קב"ט' : ''), 4500);
      if (after) after();
    } }, '➕ הוסף את העמודה');
    const ov = h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
      h('div', { class: 'card stack', style: 'max-width:640px;width:96%;max-height:90vh;overflow:auto' },
        h('h2', { style: 'margin:0;font-size:20px' }, '➕ עמודה מקובץ: ' + file.name),
        h('div', { class: 'muted small' }, 'הערך לכל שורה נלקח מהשורה בקובץ עם אותו סמל מוסד. סמל שמופיע בקובץ עם ערכים שונים, או שורה בלי סמל: לפי אותה כתובת. מה שלא חד-משמעי נשאר ריק.'),
        h('label', { class: 'small' }, 'גיליון: ', sheetSel), h('label', { class: 'small' }, 'העמודה להוספה: ', colSel), h('label', { class: 'small' }, 'שם ברשימה: ', nameIn),
        out, h('div', { class: 'row', style: 'gap:8px' }, ok, h('button', { class: 'btn', onclick: close }, 'ביטול'))));
    document.body.append(ov);
    fillCols();
  }

  // ---------- סטטוס מוסד: "לא קיים" / "לבדיקה" (1.155, ori) ----------
  // r.flag = 'gone' (יורד מהמפה ומהמסלול) או 'check' (נשאר במפה בצהוב, דורש התייחסות), r.flagNote = מה לבדוק.
  // חל גם על אותו מוסד ברשימות האחרות (אותו סמל מוסד או אותו סקר)
  const FLAGS = { gone: 'לא קיים', check: 'לבדיקה' };
  const flagOf = r => r && FLAGS[r.flag] ? r.flag : null;
  async function sameInst(l, r) {
    const out = [{ L: l, r }], keys = new Set(codeKeys(l, r));
    for (const L of await live()) for (const x of L.rows) {
      if (x.deleted || x === r) continue;
      if ((r.sid && x.sid === r.sid) || codeKeys(L, x).some(c => keys.has(c))) out.push({ L, r: x });
    }
    return out;
  }
  // ---------- אותו מוסד בכמה רשימות: תיקון עובר לכולן (1.170, ori) ----------
  // מיקום שתיקנת במפה (גרירה / סימון / חיפוש / "המיקום נכון") ותיקון בתא של שדה משויך (כתובת, שם, עיר, מנהל, שכונה…)
  // עוברים לשורות של אותו מוסד בשאר הרשימות: אותו סמל מוסד או אותו סקר. סמל המוסד עצמו לא מועתק (הוא מה שמזהה את המוסד)
  async function peersOf(l, r) {
    const keys = new Set(codeKeys(l, r)), out = [];
    if (!keys.size && !r.sid) return out;
    for (const L of await live()) {
      if (L.id === l.id) continue;
      for (const x of L.rows) if (!x.deleted && ((r.sid && x.sid === r.sid) || codeKeys(L, x).some(c => keys.has(c)))) out.push({ L, r: x });
    }
    return out;
  }
  const oneCol = (L, key) => { const cs = colsOf((L.map || {})[key]); return cs.length === 1 ? cs[0] : null; };
  // מיקום ידני של r לכל השורות של אותו מוסד ברשימות האחרות. מחזיר את השורות שעודכנו ({ L, r })
  async function mirrorGeo(l, r) {
    if (!r.geo || !r.geo.manual) return [];
    const done = [], lists = new Set();
    for (const p of await peersOf(l, r)) {
      const g = p.r.geo;
      if (g && g.manual && g.lat === r.geo.lat && g.lon === r.geo.lon) continue;
      p.r.geo = Object.assign({}, r.geo, { key: (g && g.key) || '' });
      p.r.u = Date.now(); lists.add(p.L); done.push(p);
    }
    for (const L of lists) await save(L);
    return done;
  }
  // תא שנערך ברשימה l: אם העמודה משויכת לשדה (לא סמל מוסד), אותו ערך עובר לעמודה של אותו שדה ברשימות האחרות
  async function mirrorCell(l, r, colId) {
    const f = fieldsOf(l).find(f => f.key !== 'code' && oneCol(l, f.key) === colId);
    if (!f) return 0;
    const v = r.cells[colId] || '', lists = new Set();
    let n = 0;
    for (const p of await peersOf(l, r)) {
      const c = oneCol(p.L, f.key);
      if (!c || (p.r.cells[c] || '') === v) continue;
      p.r.cells[c] = v; p.r.u = Date.now(); lists.add(p.L); n++;
    }
    for (const L of lists) await save(L);
    return n;
  }
  // פעם אחת (ואחרי כל סנכרון רשימות): מיקום שתוקן ביד באחת הרשימות נכנס לשורות של אותו מוסד ברשימות האחרות שאין להן מיקום ידני
  async function mirrorGeoAll() {
    const lists = await live(), changed = new Set();
    const byKey = new Map();
    const add = (k, it) => { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(it); };
    for (const L of lists) for (const x of L.rows) {
      if (x.deleted) continue;
      const it = { L, r: x };
      codeKeys(L, x).forEach(c => add('c' + c, it));
      if (x.sid) add('s' + x.sid, it);
    }
    for (const grp of byKey.values()) {
      const man = grp.filter(it => it.r.geo && it.r.geo.manual).sort((a, b) => ((b.r.geo.at || 0) - (a.r.geo.at || 0)) || (b.r.u || 0) - (a.r.u || 0));
      if (!man.length) continue;
      const src = man[0];
      for (const it of grp) {
        if (it.L.id === src.L.id || (it.r.geo && it.r.geo.manual)) continue;
        it.r.geo = Object.assign({}, src.r.geo, { key: (it.r.geo && it.r.geo.key) || '' });
        it.r.u = Date.now(); changed.add(it.L);
      }
    }
    for (const L of changed) await save(L);
    return changed.size;
  }
  async function setFlag(l, r, flag, note) {
    const all = await sameInst(l, r), lists = new Set();
    for (const { L, r: x } of all) {
      if (flag) { x.flag = flag; x.flagAt = Date.now(); if (note != null) { if (clean(note)) x.flagNote = clean(note); else delete x.flagNote; } }
      else { delete x.flag; delete x.flagNote; delete x.flagAt; }
      // לא קיים: יורד מהמסלול. חזר לרגיל: חוזר לסוף המסלול (אם יש מסלול)
      if (flag === 'gone' && Array.isArray(L.route)) L.route = L.route.filter(id => id !== x.id);
      if (!flag && Array.isArray(L.route) && L.route.length && !L.route.includes(x.id)) L.route.push(x.id);
      x.u = Date.now(); lists.add(L);
    }
    for (const L of lists) await save(L);
    return all.length;
  }
  function flagDialog(l, r, after) {
    const ui = U(), { h } = ui, v = valuesOf(l, r), cur = flagOf(r);
    const note = h('input', { class: 'in', value: r.flagNote || '', placeholder: 'מה לבדוק? (לא חובה)', style: 'flex:1;min-width:180px' });
    const close = () => ov.remove();
    const pick = async f => {
      close();
      const n = await setFlag(l, r, f, f === 'check' ? note.value : f ? '' : null);
      ui.toast((f ? `סומן "${FLAGS[f]}"` : 'הסימון הוסר') + (n > 1 ? ` (גם ב-${n - 1} שורות של אותו מוסד ברשימות האחרות)` : '') + (f === 'gone' ? '. ירד מהמפה ומהמסלול' : ''), 3500);
      if (after) after(f);
    };
    const ov = h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
      h('div', { class: 'card stack', style: 'max-width:520px;width:96%' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'סטטוס: ' + ([v.siteName, v.street].filter(Boolean).join(', ') || 'שורה')),
        h('div', { class: 'muted small' }, 'חל גם על אותו מוסד (אותו סמל) ברשימות האחרות.'),
        h('div', { class: 'stack wl-flag-opt check' + (cur === 'check' ? ' on' : '') },
          h('b', {}, '🟡 לבדיקה'), h('div', { class: 'small' }, 'נשאר במפה ובמסלול בצהוב, כדי שתדע שזה דורש התייחסות.'),
          h('div', { class: 'row', style: 'gap:8px' }, note, h('button', { class: 'btn primary', onclick: () => pick('check') }, cur === 'check' ? 'עדכן' : 'סמן לבדיקה'))),
        h('div', { class: 'stack wl-flag-opt gone' + (cur === 'gone' ? ' on' : '') },
          h('b', {}, '⛔ לא קיים'), h('div', { class: 'small' }, 'יורד מהמפה ומהמסלול (נשאר בטבלה באפור, ואפשר להחזיר).'),
          h('div', { class: 'row' }, h('button', { class: 'btn danger', disabled: cur === 'gone' ? true : null, onclick: () => pick('gone') }, 'סמן לא קיים'))),
        cur ? h('button', { class: 'btn', onclick: () => pick(null) }, '↩ החזר לרגיל (בלי סימון)') : null,
        h('button', { class: 'btn', onclick: close }, 'ביטול')));
    document.body.append(ov);
  }
  const flagBadge = (r, h) => flagOf(r) ? h('span', { class: 'wl-badge flag-' + r.flag, title: r.flagNote || null }, (r.flag === 'gone' ? '⛔ ' : '🟡 ') + FLAGS[r.flag] + (r.flagNote ? ': ' + r.flagNote : '')) : null;

  // ---------- שיוך סקר לרשימות, לפרויקט ולשכונה (1.155, ori) ----------
  // סקר אחד יכול להיות משויך לשורות בכמה רשימות (אותו מוסד). הרשימה הראשית קובעת את הפרויקט (התיקייה הראשית),
  // והפרויקטים של שאר הרשימות מקבלים עותק (s.extraProjects). בתוך כל תיקיית פרויקט: תיקיית השכונה.
  // שמירה מעבירה את הקבצים שכבר עלו לדרייב (Sync.relocate)
  async function linkedRows(sid) {
    const out = [];
    for (const L of await live()) for (const x of L.rows) if (!x.deleted && x.sid === sid) out.push({ L, r: x });
    return out;
  }
  async function surveyFor(sid) {
    const s = await DB.getSurvey(sid);
    if (s && !s.deleted) return s;
    return null;
  }
  async function assignBySid(sid, after) {
    const s = await surveyFor(sid);
    const ui = U();
    if (!s) {
      ui.toast('הסקר לא נמצא במכשיר הזה. פותח אותו, ואז לחץ "📁 שיוך לרשימות ותיקייה" בפרטי הסקר', 5000);
      const idx = navigator.onLine !== false && await OD.connected() ? await Sync.cloudIndex().catch(() => []) : [];
      const e = idx.find(x => x.id === sid && !x.deleted);
      if (e) await ui.lists.fromCloud(e, false, ui.h('button'));
      return;
    }
    return assignDialog(s, after);
  }
  async function assignDialog(s, after) {
    const ui = U(), { h } = ui;
    const linked = await linkedRows(s.id);
    // השורות שמסומנות להיות משויכות לסקר (Set של "רשימה|שורה"), והראשית
    const K = (L, r) => L.id + '|' + r.id;
    const sel = new Map(linked.map(x => [K(x.L, x.r), x]));
    let main = linked.find(x => s.listRef && x.L.id === s.listRef.list && x.r.id === s.listRef.row) || linked.find(x => clean(x.L.project) === clean(s.project)) || linked[0] || null;
    // מועמדים: אותו סמל מוסד ברשימות אחרות
    const codes = new Set(Core.codesOf(s.code || '').map(c => c.replace(/\D+/g, '')).filter(c => c.length >= 3));
    for (const x of linked) codeKeys(x.L, x.r).forEach(c => codes.add(c));
    const cands = [];
    for (const L of await live()) for (const x of L.rows) if (!x.deleted && !sel.has(K(L, x)) && codeKeys(L, x).some(c => codes.has(c))) cands.push({ L, r: x });
    const extra = new Map(); // שורות שנוספו מחיפוש
    // 1.162 (ori): שם ותאריך של הסקר האחר שמחובר לשורה, וסמל הסקר הפתוח (אזהרה כשהשורה נערכה לסמל אחר)
    const fmtD = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[3]}.${+m[2]}.${m[1]}` : ''; };
    const sLabel = x => [x.siteName || x.site || 'סקר', x.code ? 'סמל ' + x.code : '', fmtD(x.date)].filter(Boolean).join(' · ');
    const otherName = new Map();
    const loadOthers = async xs => { for (const x of xs) if (x.r.sid && x.r.sid !== s.id && !otherName.has(x.r.sid)) { const o = await surveyFor(x.r.sid); otherName.set(x.r.sid, o ? sLabel(o) : ''); } };
    const sCodes = new Set(Core.codesOf(s.code || '').map(c => c.replace(/\D+/g, '')).filter(c => c.length >= 3));
    await loadOthers(cands);
    const hoods = await allHoods();
    const rowHood = async () => { for (const x of [main, ...sel.values()].filter(Boolean)) { const hh = await hoodOfRow(x.L, x.r); if (hh) return hh; } return ''; };
    const hoodIn = h('input', { class: 'in', value: clean(s.hood), placeholder: 'למשל: גונן, עיר דוד', style: 'flex:1;min-width:160px' });
    const hoodWrap = ui.suggestCombo(hoodIn, () => hoods, { arrow: true });
    const fromRow = h('button', { class: 'btn', onclick: async () => { hoodIn.value = await rowHood(); drawPaths(); } }, 'מהרשימה');
    hoodIn.addEventListener('input', () => drawPaths());
    hoodIn.addEventListener('change', () => drawPaths());
    const rowsBox = h('div', { class: 'stack', style: 'gap:6px' });
    const paths = h('div', { class: 'small wl-paths' });
    const root0 = (await DB.getKV('odRoot', 'סקרי עצים')) || 'סקרי עצים';
    const projOf = x => clean(x.L.project) || clean(s.project) || 'ללא פרויקט';
    // (1.163) רשימה עם קב"ט (ירושלים כללי): תיקיית הקב"ט מעל השכונה בפרויקט שלה
    const kabRow = () => [...sel.values()].find(x => kabatOn(x.L)) || null;
    const kabOf = p => { const x = kabRow(); return x && projOf(x) === p ? kabatOfRow(x.L, x.r) || NO_KABAT : ''; };
    function drawPaths() {
      const hood = clean(hoodIn.value);
      const mp = main ? projOf(main) : clean(s.project) || 'ללא פרויקט';
      const ps = [mp, ...new Set([...sel.values()].filter(x => x !== main).map(projOf).filter(p => p !== mp))];
      paths.replaceChildren(h('b', {}, 'הקבצים יהיו ב:'), ...ps.map((p, i) => h('div', {}, `📁 ${[root0, p, kabOf(p), hood].filter(Boolean).join(' / ')}` + (i ? ' (עותק)' : ' (ראשי)'))));
    }
    const rowLine = (x, on) => {
      const v = valuesOf(x.L, x.r), k = K(x.L, x.r), other = x.r.sid && x.r.sid !== s.id;
      return h('div', { class: 'wl-stop' + (on ? '' : ' out') },
        h('div', { style: 'flex:1;min-width:0' }, h('b', {}, x.L.name || 'רשימה'), clean(x.L.project) ? h('span', { class: 'muted small' }, ' · פרויקט ' + clean(x.L.project)) : null,
          h('div', { class: 'small' }, [v.code ? 'סמל ' + v.code : '', v.siteName, v.street].filter(Boolean).join(' · ')),
          other ? h('div', { class: 'small', style: 'color:#8a5200' }, (otherName.get(x.r.sid) ? `לשורה הזו משויך עכשיו הסקר "${otherName.get(x.r.sid)}". ` : 'לשורה הזו כבר משויך סקר אחר. ') + (on ? 'ב"שמור שיוך" היא תעבור לסקר הזה' : 'שיוך כאן יעביר אותה לסקר הזה') + ' (הסקר האחר לא נמחק)') : null,
          on && sCodes.size && codeKeys(x.L, x.r).length && !codeKeys(x.L, x.r).some(c => sCodes.has(c)) ? h('div', { class: 'small', style: 'color:#c62828;font-weight:700' }, `⚠ הסמל בשורה שונה מהסמל של הסקר הזה (${s.code}). אם ערכת את השורה למוסד אחר: לחץ "הסר" כאן, ושייך אותה מחלון השיוך של הסקר הנכון`) : null),
        on ? h('label', { class: 'row small', style: 'gap:4px;align-items:center;white-space:nowrap' }, h('input', { type: 'radio', name: 'wlmain', checked: main === x, onchange: () => { main = x; drawPaths(); } }), 'תיקייה ראשית') : null,
        on ? h('button', { class: 'btn', onclick: () => { sel.delete(k); if (main === x) main = [...sel.values()][0] || null; drawRows(); } }, '✕ הסר')
          : h('button', { class: 'btn primary', onclick: () => { sel.set(k, x); if (!main) main = x; drawRows(); } }, '➕ שייך'));
    };
    function drawRows() {
      const out = [...cands, ...extra.values()].filter(x => !sel.has(K(x.L, x.r)));
      rowsBox.replaceChildren(h('b', {}, `משויך לרשימות (${sel.size}):`),
        ...(sel.size ? [...sel.values()].map(x => rowLine(x, true)) : [h('div', { class: 'muted small' }, 'לא משויך לאף שורה ברשימה')]),
        ...(out.length ? [h('b', { style: 'margin-top:6px' }, 'אפשר לשייך גם ל:'), ...out.map(x => rowLine(x, false))] : []));
      drawPaths();
    }
    // חיפוש שורה בכל הרשימות (כשאין סמל תואם)
    const q = h('input', { class: 'in', type: 'search', placeholder: 'חפש שורה בכל הרשימות: שם, רחוב או סמל', style: 'flex:1;min-width:180px' });
    const found = h('div', { class: 'stack', style: 'gap:6px' });
    const search = async () => {
      const words = norm(q.value).split(' ').filter(Boolean);
      if (!words.length) { found.replaceChildren(); return; }
      const res = [];
      for (const L of await live()) for (const x of L.rows) {
        if (x.deleted || sel.has(K(L, x))) continue;
        const hay = norm(Object.values(x.cells || {}).join(' ') + ' ' + (L.name || ''));
        if (words.every(w => hay.includes(w))) res.push({ L, r: x });
      }
      await loadOthers(res.slice(0, 12));
      found.replaceChildren(...(res.length ? res.slice(0, 12).map(x => { const ln = rowLine(x, false); ln.querySelector('.btn').onclick = () => { sel.set(K(x.L, x.r), x); if (!main) main = x; found.replaceChildren(); q.value = ''; drawRows(); }; return ln; })
        : [h('div', { class: 'muted small' }, 'לא נמצאה שורה')]));
    };
    q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
    const close = () => ov.remove();
    const saveBtn = h('button', { class: 'btn primary big', onclick: async () => {
      const others = [...sel.values()].filter(x => x.r.sid && x.r.sid !== s.id);
      if (others.length && !confirm(`ל-${others.length} מהשורות כבר משויך סקר אחר. לשייך אותן לסקר הזה במקום? (הסקר האחר לא נמחק)`)) return;
      saveBtn.disabled = true;
      const changedL = new Set();
      // שורות שהוסרו
      for (const x of linked) if (!sel.has(K(x.L, x.r))) { delete x.r.sid; delete x.r.twins; x.r.u = Date.now(); changedL.add(x.L); }
      const rows = [...sel.values()];
      for (const x of rows) {
        x.r.sid = s.id; x.r.twinsAsked = true;
        const tw = rows.filter(y => y !== x).map(y => ({ list: y.L.id, row: y.r.id }));
        if (tw.length) x.r.twins = tw; else delete x.r.twins;
        x.r.u = Date.now(); changedL.add(x.L);
      }
      for (const L of changedL) await save(L);
      if (main) {
        s.listRef = { list: main.L.id, row: main.r.id, name: main.L.name };
        if (clean(main.L.project)) s.project = clean(main.L.project);
      } else delete s.listRef;
      const projs = [...new Set(rows.filter(x => x !== main).map(x => clean(x.L.project)).filter(p => p && p !== clean(s.project)))];
      if (projs.length) s.extraProjects = projs; else delete s.extraProjects;
      if (rows.some(x => x.L.type !== 'construction' && Object.values(x.r.cells || {}).some(v => PINES_RE.test(String(v || ''))))) s.pinesMode = true;
      const hood = clean(hoodIn.value), rh = await rowHood();
      if (hood) s.hood = hood; else delete s.hood;
      if (hood !== rh) s.hoodManual = true; else delete s.hoodManual;
      const kx = kabRow();
      if (kx) { s.kabatProj = clean(kx.L.project); s.kabat = kabatOfRow(kx.L, kx.r); } else { delete s.kabatProj; delete s.kabat; }
      s.site = ui.composeSite(s);
      await DB.putSurvey(s);
      close();
      ui.toast('השיוך נשמר' + (s.odReportDir ? '. מעביר את הקבצים בדרייב…' : ''), 3000);
      if (after) after(s);
      Sync.relocate(s).then(n => ui.toast(n ? `${n} קבצים הועברו לתיקייה ${[s.project, s.kabatProj != null && clean(s.kabatProj) === clean(s.project) ? clean(s.kabat) || NO_KABAT : '', s.hood].filter(Boolean).join(' / ')}` : 'הקבצים בדרייב כבר במקום הנכון (הבאים יישמרו לפי השיוך)', 3500))
        .catch(e => ui.toast('העברת הקבצים בדרייב נכשלה: ' + e.message + '. ינסה שוב בהעלאה הבאה', 5000));
    } }, 'שמור שיוך');
    const ov = h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
      h('div', { class: 'card stack', style: 'max-width:640px;width:96%' },
        h('h2', { style: 'margin:0;font-size:20px' }, '📁 שיוך: ' + (s.siteName || s.site || 'סקר')),
        h('div', { class: 'small', style: 'font-weight:700' }, 'הסקר הפתוח: ' + [sLabel(s), clean(s.street)].filter(Boolean).join(' · ')),
        h('div', { class: 'muted small' }, 'לאיזו רשימה הסקר שייך ובאיזו תיקייה הקבצים. לסקר אחד לכמה רשימות: הקבצים בתיקייה הראשית ועותק בתיקיית הפרויקט של כל רשימה נוספת.'),
        rowsBox,
        h('div', { class: 'row', style: 'gap:8px' }, q, h('button', { class: 'btn', onclick: search }, '🔎')), found,
        h('label', { class: 'small', style: 'font-weight:700' }, 'שכונה (תיקייה בתוך תיקיית הפרויקט):'),
        h('div', { class: 'row', style: 'gap:8px;align-items:center' }, hoodWrap, fromRow),
        paths,
        h('div', { class: 'row', style: 'gap:8px' }, saveBtn, h('button', { class: 'btn', onclick: close }, 'ביטול'))));
    document.body.append(ov);
    drawRows();
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
  let hoodIx = null;
  async function openRow(l, r, choose, onLinked) {
    if (l.type !== 'construction') hoodIx = await hoodIndex(l).catch(() => null);
    const joined = await askTwins(l, r);
    if (joined) { U().go('#/s/' + joined.id); return; }
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
            r.sid = e.id; r.u = Date.now(); await save(l); await linkTwins(r, e.id, l);
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
    // (1.157, ori) כפתור מפה רק לרשימה ראשית: רשימה שמשויכת כמשנית לרשימה אחרת (ולא נפתחה לה מפה משלה) בלי כפתור
    const sideOf = new Map();
    lists.forEach(o => (Array.isArray(o.sides) ? o.sides.map(c => c && c.id) : o.side ? [o.side] : []).forEach(id => { if (id && id !== o.id && !sideOf.has(id)) sideOf.set(id, o); }));
    const isMain = l => !sideOf.has(l.id) || !!l.mapAt || (Array.isArray(l.sides) && l.sides.length > 0);
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
          !isMain(l) ? h('div', { class: 'muted small', style: 'margin-top:4px' }, `🗺 מוצגת במפה של "${sideOf.get(l.id).name || 'רשימה'}"`) : null,
          h('div', { class: 'row', style: 'gap:6px;margin-top:8px;flex-wrap:wrap' },
            isMain(l) && !l.finished ? act('🗺 מפה', 'מסלול ומפה של הרשימה', () => ui.go('#/lists/' + encodeURIComponent(l.id) + '/route'), 'primary') : null,
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
          h('button', { class: 'btn big', title: 'רשימה ריקה בלי קובץ, לעבודות שונות באותו יום. יש לה טבלה, מפה ומסלול כמו לכל רשימה', onclick: () => newTempList() }, '➕ רשימה זמנית (בלי קובץ)'),
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

  // (1.172, ori) רשימה זמנית: עבודות לא קשורות שרוצים לעשות באותו יום. רשימה ריקה עם עמודות בסיס משויכות,
  // ומשם הכל כמו ברשימה רגילה: ➕ שורה, הוספה / הסתרה / מחיקה של עמודות (הגדרות), מפה ומסלול, סיום רשימה
  async function newTempList() {
    const ui = U(), d = new Date();
    const cols = [['siteName', 'שם המוסד / האתר'], ['street', 'כתובת'], ['city', 'עיר'], ['code', 'סמל מוסד'], ['manager', 'איש קשר'], [null, 'טלפון'], [null, 'הערות']]
      .map(([key, name], i) => ({ key, id: 'c' + i, name }));
    const l = { id: uid(), temp: true, name: `רשימה זמנית ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`, file: '', project: '', type: 'safety',
      cols: cols.map(c => ({ id: c.id, name: c.name })), rows: [], map: {}, hide: [], mapV: 3, created: Date.now() };
    for (const f of FIELDS) { const c = cols.find(x => x.key === f.key); l.map[f.key] = { col: c ? c.id : '', pre: '', prev: false }; }
    l.rows.push({ id: uid(), cells: {}, u: Date.now() });
    await save(l);
    ui.toast('נפתחה רשימה זמנית. ממלאים שורה לכל עבודה (➕ שורה), ובהגדרות הרשימה אפשר לשנות שם, פרויקט ועמודות', 5000);
    ui.go('#/lists/' + encodeURIComponent(l.id));
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
    // החלפות בשם הקובץ (1.128): ראשי תיבות עם גרשיים (גנ"י, בי"ס) נכתבים בשם הקובץ כמו שבוחרים. בדוח עצמו השם נשאר כמו ברשימה
    draft.repl = (draft.repl || []).map(x => ({ from: x.from, to: x.to }));
    const replFound = () => {
      const out = new Set();
      for (const r of draft.rows) if (!r.deleted) for (const k of ['siteName', 'street']) for (const c of colsOf(draft.map[k])) for (const w of clean(r.cells[c]).split(/\s+/)) if (/[^\s"״”“'׳’]["״”“'׳’][^\s"״”“'׳’]/.test(w)) out.add(w.replace(/^[({\[]+|[)}\].,;:]+$/g, ''));
      return [...out].filter(w => !draft.repl.some(x => x.from === w));
    };
    const replCard = () => h('div', { class: 'card stack' },
      h('div', { class: 'muted small' }, 'מילה עם גרשיים או סימן שלא נוח בשם קובץ (למשל גנ"י או בי"ס) תיכתב בשם הקובץ כמו שתרשום כאן (למשל גן, בית ספר). זה משפיע רק על שמות הקבצים של הסקרים מהרשימה. כללי השמות של ירושלים וויצו נשארים כמו שהם.'),
      ...draft.repl.map((x, i) => h('div', { class: 'row', style: 'gap:8px;align-items:center' },
        h('input', { class: 'in', style: 'flex:1;min-width:90px', value: x.from, placeholder: 'כתוב ברשימה (גנ"י)', 'aria-label': 'מה להחליף', oninput: e => { x.from = e.target.value; } }),
        h('span', {}, '←'),
        h('input', { class: 'in', style: 'flex:1;min-width:90px', value: x.to, placeholder: 'בשם הקובץ (גן)', 'aria-label': 'במה להחליף', oninput: e => { x.to = e.target.value; } }),
        h('button', { class: 'icon-btn', title: 'הסר', 'aria-label': 'הסר החלפה', onclick: () => { draft.repl.splice(i, 1); draw(); } }, '✕'))),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' },
        replFound().length ? h('span', { class: 'small' }, 'נמצאו ברשימה:') : null,
        ...replFound().slice(0, 12).map(w => h('button', { class: 'chip', onclick: () => { draft.repl.push({ from: w, to: '' }); draw(); const ins = main.querySelectorAll('input[aria-label="במה להחליף"]'); if (ins.length) ins[ins.length - 1].focus(); } }, w)),
        h('button', { class: 'btn', onclick: () => { draft.repl.push({ from: '', to: '' }); draw(); } }, '➕ הוסף החלפה')));
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
        h('h2', { class: 'proj-head' }, 'החלפות בשם הקובץ'),
        replCard(),
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
            draft.repl = draft.repl.map(x => ({ from: clean(x.from), to: clean(x.to) })).filter(x => x.from);
            Object.assign(l, draft); delete l.raw; delete l.headerRow;
            if (l.project) DB.setKV('lastProject', l.project.trim());
            // סקרים שכבר נפתחו מהרשימה מקבלים את ההחלפות המעודכנות
            for (const sv of await DB.allSurveys()) if (sv.listRef && sv.listRef.list === l.id && JSON.stringify(sv.nameRepl || []) !== JSON.stringify(l.repl)) { if (l.repl.length) sv.nameRepl = l.repl; else delete sv.nameRepl; await DB.putSurvey(sv); }
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
    // (1.155) עמודת שכונה (גם מהרשימות האחרות), והשכונה לסקרים שכבר נפתחו מהרשימה
    await ensureHood(l).catch(() => {});
    hoodToSurveys(l, local).catch(() => {}).then(() => kabatToSurveys(local)).catch(() => {});
    // סקר שנפתח מהשורה במכשיר אחר, לפני שהרשימה סונכרנה: לפי listRef
    for (const s of local.values()) if (s.listRef && s.listRef.list === l.id && !s.deleted) { const r = l.rows.find(x => x.id === s.listRef.row); if (r && !r.sid) { r.sid = s.id; r.u = Date.now(); save(l); } }
    let idx = new Map();
    // סקר שהסתיים ("סיום סקר"): לפי הטאבלט או לפי האינדקס בענן (סקר שהסתיים במכשיר אחר)
    const stateOf = r => {
      // (1.155) סימון ידני: לא קיים / לבדיקה
      if (r.flag === 'gone') return { k: 'gone', t: '⛔ לא קיים', d: r.flagNote || '' };
      if (r.flag === 'check') return { k: 'check', t: '🟡 לבדיקה', d: r.flagNote || '' };
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
    const view = { sort: saved.sort || (!saved.filt && (l.route || []).length ? { col: '_route', dir: 1 } : null), filt: Object.fromEntries(Object.entries(saved.filt || {}).map(([k, v]) => [k, new Set(v)])),
      // (1.146, ori) רוחב עמודה שנקבע ביד (גרירה) או אוטומטית (לחיצה כפולה), בפיקסלים, במכשיר הזה
      w: Object.assign({}, saved.w || {}) };
    const saveView = () => DB.setKV(VKEY, { sort: view.sort, filt: Object.fromEntries(Object.entries(view.filt).map(([k, v]) => [k, [...v]])), w: view.w }).catch(() => {});
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
    // (1.146) חיפוש על כל הטבלה: כל העמודות (גם מוסתרות), הסטטוס ומספר במסלול. התאים שנמצאו מסומנים
    const q = h('input', { class: 'in wl-search', type: 'search', placeholder: '🔎 חיפוש בכל הטבלה (שם, כתובת, סמל, מנהל, טלפון…)', 'aria-label': 'חיפוש בכל הטבלה', style: 'flex:1;min-width:200px' });
    const qInfo = h('span', { class: 'small muted' });
    // רוחב עמודות: גרירת הקו בצד הכותרת = ביד, לחיצה כפולה עליו = לפי הטקסט הארוך בעמודה
    const meas = document.createElement('canvas').getContext('2d');
    const textW = (t, bold) => { meas.font = (bold ? '700 ' : '400 ') + '15px Arimo, Arial, sans-serif'; return meas.measureText(String(t || '')).width; };
    const fitW = cid => { const c = l.cols.find(x => x.id === cid); const rs = l.rows.filter(r => !r.deleted);
      return Math.round(Math.min(900, Math.max(60, textW(c ? c.name : '', true) + 34, ...rs.map(r => textW(r.cells[cid]))) + 20)); };
    const tableEl = () => table.querySelector('table');
    const setW = (cid, px) => { view.w[cid] = Math.round(px); const t = tableEl(); if (t) t.style.setProperty('--w-' + cid, view.w[cid] + 'px'); };
    function resizer(cid) {
      let x0 = 0, w0 = 0, moved = false, lastUp = 0;
      const el = h('div', { class: 'wl-rsz', title: 'גרור כדי לשנות רוחב · לחיצה כפולה = רוחב לפי התוכן', 'aria-hidden': 'true' });
      el.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId);
        const inp = table.querySelector(`td[data-c="${cid}"] .wl-cell`), th = el.parentElement;
        x0 = e.clientX; w0 = view.w[cid] || (inp ? inp.getBoundingClientRect().width : th.getBoundingClientRect().width); moved = false;
        el.classList.add('on');
      });
      el.addEventListener('pointermove', e => {
        if (!el.hasPointerCapture(e.pointerId)) return;
        // מימין לשמאל: גרירה שמאלה מרחיבה
        const dx = (document.dir === 'ltr' ? 1 : -1) * (e.clientX - x0);
        if (Math.abs(dx) > 3) moved = true;
        if (moved) setW(cid, Math.max(50, w0 + dx));
      });
      const up = e => {
        if (!el.hasPointerCapture || !el.classList.contains('on')) return;
        el.classList.remove('on');
        if (moved) { saveView(); return; }
        // לחיצה כפולה (גם באצבע): רוחב לפי הטקסט הארוך בעמודה
        const now = Date.now();
        if (now - lastUp < 400) { setW(cid, fitW(cid)); saveView(); lastUp = 0; } else lastUp = now;
      };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      el.addEventListener('click', e => e.stopPropagation());
      return el;
    }
    const clearBox = h('span');
    const widthBox = h('span', { class: 'row', style: 'gap:8px;flex-wrap:wrap' });
    const hideBox = h('span');
    const dayBox = h('div', { class: 'row project-chips', style: 'gap:6px;flex-wrap:wrap;align-items:center' });
    const table = h('div', { class: 'wl-wrap' });
    const counts = h('div', { class: 'muted small', role: 'status' });
    const chipsBox = h('div', { class: 'project-chips' });
    const saveSoon = ui.debounce(() => save(l), 600);
    const draw = () => {
      const rs = l.rows.filter(r => !r.deleted);
      const n = { all: rs.length, todo: 0, open: 0, done: 0, check: 0, gone: 0 };
      for (const r of rs) n[stateOf(r).k]++;
      chipsBox.replaceChildren(...[['all', 'הכל'], ['todo', 'טרם נפתחו'], ['open', 'בעבודה'], ['done', 'הסתיימו'], ['check', '🟡 לבדיקה'], ['gone', '⛔ לא קיים']].filter(([k]) => !['check', 'gone'].includes(k) || n[k] || filter === k).map(([k, t]) =>
        h('button', { class: 'chip' + (filter === k ? ' on' : ''), onclick: () => { filter = k; draw(); } }, `${t} (${n[k]})`)));
      const words = norm(q.value).split(' ').filter(Boolean);
      const hay = r => norm([...Object.values(r.cells), stateOf(r).t, valOf(r, '_route')].join(' '));
      const shown = rs.filter(r => (filter === 'all' || stateOf(r).k === filter) && (!words.length || ((t) => words.every(w => t.includes(w)))(hay(r)))
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
      qInfo.textContent = words.length ? (shown.length ? `נמצאו ${shown.length}` : 'לא נמצא') : '';
      const hit = v => words.length && words.some(w => norm(v).includes(w));
      // רוחב כל עמודה לפי הטקסט הארוך בה (בגבולות), כדי שכתובת שלמה תיראה בלי לגלול בתוך התא
      const cols = visCols(l);
      const width = new Map(cols.map(c => [c.id, Math.min(38, Math.max(8, c.name.length, ...rs.map(r => (r.cells[c.id] || '').length)) + 2)]));
      const mapped = new Map(Object.entries(l.map || {}).filter(([k]) => fieldsOf(l).some(f => f.key === k)).flatMap(([k, m]) => { const cs = colsOf(m); return cs.map((c, i) => [c, FIELDS.find(f => f.key === k).label + (cs.length > 1 ? ` (${i + 1})` : '')]); }));
      const fixed = cols.filter(c => view.w[c.id]);
      const autoBtn = h('button', { class: 'btn', title: 'כל עמודה ברוחב של הטקסט הארוך בה', onclick: () => { cols.forEach(c => setW(c.id, fitW(c.id))); saveView(); draw(); } }, '↔ התאם רוחב לכל העמודות');
      widthBox.replaceChildren(autoBtn, ...(fixed.length ? [h('button', { class: 'btn', onclick: () => { view.w = {}; saveView(); draw(); } }, '↺ רוחב עמודות רגיל')] : []));
      table.replaceChildren(h('table', { class: 'wl-table', style: cols.filter(c => view.w[c.id]).map(c => `--w-${c.id}:${view.w[c.id]}px`).join(';') },
        h('thead', {}, h('tr', {}, h('th', { class: 'wl-act' }, h('div', { class: 'wl-th' }, h('span', {}, 'סקר'), headBtn('_st', 'סטטוס הסקר'))), ...cols.map(c => h('th', { class: 'wl-thr' }, h('div', { class: 'wl-th' }, h('span', {}, c.name), headBtn(c.id, c.name)), mapped.has(c.id) ? h('div', { class: 'wl-tag' }, '← ' + mapped.get(c.id)) : null, resizer(c.id))), h('th', {}))),
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
              // שורה משויכת (1.136): רק "משויך" ו"בטל שיוך" בשורה אחת. שם הקובץ והתיקייה ברמז (ריחוף / לחיצה ארוכה), השאר בחלון "סקרים קודמים"
              r.sid ? null : r.prev && !r.prev.none ? h('div', { class: 'wl-prev small', title: (r.prev.kind === 'file' ? r.prev.f.name : r.prev.name) + '\n' + prevPath(r.prev) },
                '↩ משויך' + (r.prev.kind === 'file' && pIdx[r.prev.f.id] ? ' ✓' : '') + ' · ',
                h('button', { class: 'link-btn small', onclick: () => { delete r.prev; r.u = Date.now(); save(l); draw(); } }, 'בטל שיוך'))
                : h('button', { class: 'link-btn small wl-find', onclick: () => openRow(l, r, true, draw) }, '🔎 חפש סקר קודם'),
              h('div', { class: 'wl-badge ' + st.k }, st.t), st.d ? h('div', { class: 'wl-st small' }, st.d) : null,
              h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
                h('button', { class: 'link-btn small', title: 'לא קיים / לבדיקה', onclick: () => flagDialog(l, r, () => draw()) }, flagOf(r) ? 'סטטוס ▾' : '⚑ סמן'),
                r.sid ? h('button', { class: 'link-btn small', title: 'לאיזו רשימה הסקר שייך, שכונה ותיקייה בדרייב', onclick: () => assignBySid(r.sid, () => renderList(l)) }, '📁 שיוך') : null,
                r.sid ? h('button', { class: 'link-btn small', onclick: () => { if (!confirm('לנתק את השורה מהסקר? הסקר עצמו לא נמחק.')) return; delete r.sid; r.u = Date.now(); save(l); draw(); } }, 'נתק') : null)),
            ...cols.map(c => h('td', { 'data-c': c.id }, h('input', { class: 'wl-cell' + (hit(r.cells[c.id] || '') ? ' wl-hit' : ''), value: r.cells[c.id] || '', 'aria-label': c.name, style: `width:var(--w-${c.id}, ${width.get(c.id)}ch)`, title: (r.cells[c.id] || '').length > 20 ? r.cells[c.id] : null,
              oninput: e => { r.cells[c.id] = e.target.value; r.u = Date.now(); saveSoon(); },
              // (1.170) בסיום העריכה: אותו שדה גם בשורות של אותו מוסד ברשימות האחרות
              onchange: async () => { const n = await mirrorCell(l, r, c.id).catch(() => 0); if (n) ui.toast(`עודכן גם ב-${n} ${n > 1 ? 'שורות' : 'שורה'} של אותו מוסד ברשימות האחרות`, 2500); } }))),
            h('td', {}, h('button', { class: 'icon-btn', title: 'מחק שורה', 'aria-label': 'מחק שורה', onclick: () => {
              if (!confirm('למחוק את השורה מהרשימה?')) return;
              r.deleted = Date.now(); r.u = Date.now(); r.cells = {}; save(l); draw();
            } }, '✕')))].filter(Boolean);
        }))));
    };
    q.addEventListener('input', draw);
    // "אורנים ומפות" רק ברשימת אורנים: שורה שכתוב בה אורנים, או סקר של הרשימה ש"ריכוז אורנים" דולק בו
    const pinesList = l.type !== 'construction' && (l.rows.some(r => !r.deleted && Object.values(r.cells || {}).some(v => /(^|[\s,;(])[הו]?או?רני?ם/.test(String(v || '')))) || [...local.values()].some(s => Core.pinesOn(s) && ((s.listRef && s.listRef.list === l.id) || l.rows.some(r => r.sid === s.id))));
    const pIdx = await prevIndex();
    const exportXlsx = async () => {
      const rs = l.rows.filter(r => !r.deleted);
      // הרשימה כמו שהועלתה + בסוף (הצד השמאלי) סטטוס: בוצע / בתהליך / לא בוצע, ותאריך
      const st = r => { const x = stateOf(r); if (x.k === 'gone' || x.k === 'check') return [FLAGS[r.flag], r.flagNote || '']; return x.k === 'done' ? ['בוצע', x.d || ''] : x.k === 'open' ? ['בתהליך', x.d ? 'נפתח ' + x.d : ''] : ['לא בוצע', x.t === 'הסקר נמחק' ? 'הסקר נמחק' : '']; };
      const rows = [[...l.cols.map(c => c.name), 'סטטוס סקר', 'תאריך / הערה'], ...rs.map(r => [...l.cols.map(c => { const v = r.cells[c.id] || ''; return /^\d{1,9}$/.test(v) ? +v : v; }), ...st(r)])];
      const blob = await Reports.xlsx(rows, { sheet: 'רשימה', widths: [...l.cols.map(() => 20), 20, 18] });
      ui.downloadFile(blob, ui.safeName(l.name || 'רשימה') + '.xlsx');
    };
    // מסמכים של הרשימה (אישורי כניסה וכו'): נפתחים בתוך האפליקציה
    const docs = ListDocs.section(l, save, async () => (await live()).filter(x => x.id !== l.id && !x.finished));
    dropDocs = { id: l.id, add: docs.add };
    const missing = fieldsOf(l).filter(f => ['street', 'city'].includes(f.key) && !(l.map[f.key] || {}).col && !clean((l.map[f.key] || {}).pre)).map(f => f.label);
    ui.app().replaceChildren(ui.bar({ title: l.name || 'רשימה', sub: [l.project ? 'פרויקט ' + l.project : null, Construction.TYPES[l.type || 'safety']].filter(Boolean).join(' · ') }, '#/lists'),
      h('main', { class: 'stack' },
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
          h('button', { class: 'btn', onclick: () => ui.go('#/lists/' + encodeURIComponent(l.id) + '/setup') }, ui.icon('gear'), 'שיוך עמודות (כתובת, עיר, סמל…) והגדרות'),
          h('button', { class: 'btn', onclick: () => { const nr = { id: uid(), cells: {}, u: Date.now() }; l.rows.push(nr); if (Array.isArray(l.route) && l.route.length) l.route.push(nr.id); save(l); filter = 'all'; q.value = ''; draw(); const ins = table.querySelectorAll('tbody tr:last-child input'); if (ins[0]) ins[0].focus(); } }, '➕ שורה'),
          h('button', { class: 'btn', onclick: () => ui.go('#/lists/' + encodeURIComponent(l.id) + '/route') }, '🗺 מסלול ומפה'),
          h('button', { class: 'btn', title: 'הרשימה שהעלית, עם עמודת סטטוס בסוף: בוצע / בתהליך / לא בוצע', onclick: exportXlsx }, '⬇ הורד לאקסל עם סטטוס'),
          h('button', { class: 'btn', title: 'שיוך סקרים משנים קודמות לשורות, הצגת הקבצים והורדה מראש', onclick: () => prevManager(l, draw) }, '📎 סקרים קודמים'),
          h('button', { class: 'btn', onclick: ev => managersReport(l, ev.currentTarget) }, '📊 דוח מנהלים'),
          pinesList ? h('button', { class: 'btn', title: 'סיכום אורנים ומפת עצים לשיתוף מהסקרים של הרשימה (ירושלים)', onclick: () => ui.go('#/summary/' + encodeURIComponent(l.id)) }, '🌲 אורנים ומפות') : null,
          l.finished ? null : h('button', { class: 'btn', onclick: async () => { l.finished = Date.now(); await save(l); ui.toast('הרשימה הסתיימה ועברה ל"רשימות שהסתיימו"', 3500); ui.go('#/lists'); } }, '✓ סיום רשימה'), clearBox, hideBox),
        l.finished ? h('div', { class: 'card row', style: 'gap:10px;align-items:center;background:var(--accent-soft)' }, h('b', { style: 'flex:1' }, '✓ הרשימה הסתיימה ' + new Date(l.finished).toLocaleDateString('he-IL')),
          h('button', { class: 'btn', onclick: async () => { delete l.finished; delete l.offHome; await save(l); renderList(l); } }, '↩ החזר לפעילות')) : null,
        docs.el,
        h('div', { class: 'row small', style: 'gap:8px;align-items:center;flex-wrap:wrap' },
          h('span', {}, '📁 תיקייה בדרייב לחיפוש סקרים קודמים: ', h('b', {}, l.folder ? l.folder.name : 'הארכיון הרגיל')),
          h('button', { class: 'btn', onclick: () => pickListFolder(l, () => renderList(l)) }, l.folder ? 'החלף' : 'בחר תיקייה'),
          l.folder ? h('button', { class: 'btn', onclick: async () => { delete l.folder; await save(l); renderList(l); } }, 'הארכיון הרגיל') : null),
        // (1.155.1) תיקייה לפי שכונה: דולק/כבוי לרשימה הזו
        l.type === 'construction' ? null : h('label', { class: 'row small', style: 'gap:8px;align-items:center' },
          h('input', { type: 'checkbox', checked: hoodOn(l), onchange: async e => {
            l.hoodOn = e.target.checked; await save(l);
            U().toast(l.hoodOn ? 'מעכשיו כל סקר מהרשימה נשמר בתיקייה של השכונה שלו (גם סקרים שכבר נעשו)' : 'סקרים חדשים מהרשימה יישמרו ישר בתיקיית הפרויקט (סקרים קיימים נשארים במקומם)', 4000);
            renderList(l);
          } }),
          '📁 תיקייה לפי שכונה בתוך תיקיית הפרויקט' + (hoodOn(l) && colsOf((l.map || {}).hood).length ? ` (עמודה: ${(l.cols.find(c => c.id === l.map.hood.col) || {}).name || 'שכונה'})` : hoodOn(l) ? ' (לא נמצאה עמודת שכונה, ולא נמצאו שכונות לפי סמל ברשימות האחרות)' : '')),
        // (1.163) תיקייה לפי קב"ט (מעל השכונה), ועמודה מקובץ אחר (למשל הקב"טים מהאקסל המקורי)
        l.type === 'construction' ? null : h('div', { class: 'row small', style: 'gap:8px;align-items:center;flex-wrap:wrap' },
          colsOf((l.map || {}).kabat).length ? h('label', { class: 'row', style: 'gap:8px;align-items:center' },
            h('input', { type: 'checkbox', checked: kabatOn(l), onchange: async e => {
              l.kabatOn = e.target.checked; await save(l);
              U().toast(l.kabatOn ? `מעכשיו: ${clean(l.project) || 'הפרויקט'} / קב"ט / שכונה. סקרים בלי קב"ט ב"${NO_KABAT}". הסקרים הקיימים עוברים` : 'הסקרים חוזרים לתיקיית הפרויקט / שכונה', 4500);
              kabatToSurveys(new Map((await DB.allSurveys()).map(s => [s.id, s]))).catch(() => {});
              renderList(l);
            } }), `📁 תיקייה לפי קב"ט (הראשון) ובתוכה לפי שכונה (עמודה: ${(l.cols.find(c => c.id === l.map.kabat.col) || {}).name || 'קב"ט'})`) : null,
          h('label', { class: 'btn', title: 'עמודה מאקסל אחר לפי סמל המוסד (למשל עמודת הקב"טים)' }, '➕ עמודה מקובץ',
            h('input', { type: 'file', accept: '.xlsx,.xlsm,.csv', style: 'display:none', onchange: e => { const f = e.target.files[0]; e.target.value = ''; if (f) addColumnFromFile(l, f, () => renderList(l)).catch(err => U().toast('קריאת הקובץ נכשלה: ' + err.message, 5000)); } }))),
        missing.length ? h('div', { class: 'card small', style: 'background:#fff2cc;color:#5a4300' }, `⚠ עוד לא נבחרה עמודה ל: ${missing.join(', ')}. לחץ על החץ ▾ בכותרת של העמודה ובחר "העמודה הזו היא", או ב"שיוך עמודות".`) : null,
        dayBox, chipsBox,
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:center' }, q, qInfo, widthBox),
        counts, table));
    draw();
    prevAuto(l, draw);

    // סקרים שנפתחו במכשיר אחר: הסטטוס מהאינדקס בענן
    if (navigator.onLine !== false && await OD.connected()) Sync.cloudIndex().then(list => { idx = new Map(list.map(e => [e.id, e])); if (!table.contains(document.activeElement)) draw(); }).catch(() => {});
    syncThen(async () => { const n = await byId(l.id); if (n) { Object.assign(l, n); draw(); docs.redraw(); ListDocs.syncDocs(l, save, docs.redraw); prevAuto(l, draw); } else ui.go('#/lists'); });
  }


  // ---------- סקרים קודמים של הרשימה (1.128): שיוך אוטומטי רק לפי בקשה ועם אישור, הצגת הקובץ והתיקייה, הורדה מראש ----------
  // קובץ שהורד מראש נשמר בטאבלט (KV wlPrev:<id>), ו"פתח" משתמש בו בלי להוריד שוב. wlPrevIdx: מה הורד
  const PKEY = id => 'wlPrev:' + id;
  let prevIdx = null;
  async function prevIndex() { if (!prevIdx) prevIdx = (await DB.getKV('wlPrevIdx', {})) || {}; return prevIdx; }
  async function prevBlob(f) {
    let b = await DB.getKV(PKEY(f.id), null);
    if (b) return b;
    b = await OD.download(f.id);
    if (!b) throw new Error('הקובץ לא נמצא בדרייב');
    await DB.setKV(PKEY(f.id), b);
    const ix = await prevIndex(); ix[f.id] = { size: b.size, t: Date.now() }; await DB.setKV('wlPrevIdx', ix);
    return b;
  }
  // הורדה מראש שסומנה במכשיר אחר (r.prev.pre): מורידים ברקע את מה שחסר במכשיר הזה, לכל הרשימות, מיד כשהאפליקציה נפתחת (1.130)
  // קובץ אחרי קובץ, כדי לא להכביד. אפשר להשהות (נשמר במכשיר: KV wlPreOff) ולהמשיך
  const pre = { run: false, off: false, hide: false, i: 0, n: 0, bad: 0, el: null, done: null, loaded: false };
  const preTodo = async () => {
    const ix = await prevIndex(), seen = new Set(), out = [];
    for (const l of await live()) for (const r of l.rows || [])
      if (!r.deleted && !r.sid && r.prev && r.prev.pre && r.prev.kind === 'file' && r.prev.f && !ix[r.prev.f.id] && !seen.has(r.prev.f.id)) { seen.add(r.prev.f.id); out.push(r.prev.f); }
    return out;
  };
  function prePill() {
    const { h } = U();
    if (!pre.el) { pre.el = h('div', { class: 'wl-prepill', role: 'status' }); document.body.append(pre.el); }
    const left = pre.n - pre.i;
    pre.el.hidden = pre.hide || (!pre.run && !(pre.off && left > 0));
    if (pre.el.hidden) return;
    pre.el.replaceChildren(
      h('span', {}, pre.off ? `הורדת סקרים קודמים מושהית (נשארו ${left})` : `מוריד סקרים קודמים ${Math.min(pre.i + 1, pre.n)} מתוך ${pre.n}`),
      pre.off ? h('button', { class: 'btn', onclick: () => preSet(false) }, '▶ המשך') : h('button', { class: 'btn', onclick: () => preSet(true) }, '⏸ השהה'),
      h('button', { class: 'icon-btn', title: 'הסתר', 'aria-label': 'הסתר', onclick: () => { pre.hide = true; prePill(); } }, '✕'));
  }
  async function preSet(off) { pre.off = off; pre.hide = false; await DB.setKV('wlPreOff', off); prePill(); if (!off) prevAuto(null, pre.done); }
  async function prevAuto(l, done) {
    if (done) pre.done = done;
    if (!pre.loaded) { pre.off = !!(await DB.getKV('wlPreOff', false)); pre.loaded = true; }
    if (pre.run) return;
    pre.run = true;
    try {
      let fs = await preTodo();
      pre.i = 0; pre.n = fs.length; pre.bad = 0;
      if (!fs.length || pre.off || navigator.onLine === false || !(await OD.connected())) return;
      prePill();
      let ok = 0;
      for (const f of fs) {
        if (pre.off || navigator.onLine === false) break;
        prePill();
        try { await prevBlob(f); ok++; } catch (e) { pre.bad++; /* ננסה שוב בפתיחה הבאה */ }
        pre.i++;
      }
      if (ok) { if (!pre.off) U().toast(`${ok} סקרים קודמים הורדו מראש` + (pre.bad ? `, ${pre.bad} נכשלו` : ''), 4000); if (pre.done) try { pre.done(); } catch (e) { /* המסך כבר נסגר */ } }
    } catch (e) { /* בלי רשת או בלי דרייב: בפעם הבאה */ } finally { pre.run = false; prePill(); }
  }
  // מתחיל לבד: כשהאפליקציה נפתחת, כשחוזרים אליה, וכשהרשת חוזרת. קודם סנכרון הרשימות, כדי לקבל סימונים ממכשיר אחר
  const preKick = () => { if (document.visibilityState === 'hidden') return; sync(false).catch(() => {}).then(() => prevAuto()); };
  setTimeout(preKick, 3500);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') preKick(); });
  window.addEventListener('online', preKick);
  const prevPath = p => p && p.kind === 'file' ? (p.path || []).join(' / ') : 'סקר באפליקציה';
  // פתיחת הקובץ של הסקר הקודם: אקסל (הקובץ עצמו), או PDF באותו שם שנמצא לידו בדרייב
  async function openPrevFile(p, mode) {
    const ui = U();
    if (!p || p.kind !== 'file') { ui.toast('הסקר הזה שמור באפליקציה, לא כקובץ בדרייב', 3500); return; }
    try {
      if (mode === 'pdf') {
        const base = p.f.name.replace(/\.xls[xm]?$/i, ''), parent = (p.f.parents || [])[0];
        const pf = parent ? await OD.findFile(parent, base + '.pdf').catch(() => null) : null;
        if (!pf) { ui.toast('אין קובץ PDF באותו שם ליד האקסל בדרייב', 7000, 'הצג את האקסל בדרייב', () => window.open('https://drive.google.com/file/d/' + encodeURIComponent(p.f.id) + '/view', '_blank', 'noopener')); return; }
        ui.toast('מוריד את ה-PDF…', 2000);
        const b = await OD.download(pf.id);
        if (b) ui.downloadFile(b, base + '.pdf');
        return;
      }
      ui.toast('פותח את האקסל…', 2000);
      ui.downloadFile(await prevBlob(p.f), p.f.name);
    } catch (e) { ui.toast('נכשל: ' + e.message, 4500); }
  }
  // הצעת סקר קודם לשורה: קודם לפי סמל המוסד (גם בתוך הקובץ), ואם אין, לפי רחוב ומספר. sure: התאמה חד-משמעית
  async function proposePrev(l, r) {
    const v = valuesOf(l, r), words = rowWords(l, r, v);
    const score = xs => xs.map(x => Object.assign(x, scoreAll(v, words, x.f.name.replace(/\.xls[xm]$/i, '') + ' ' + x.path.slice(-2).join(' '), '')))
      .sort((a, b) => b.sc - a.sc || (b.year || '').localeCompare(a.year || '') || (b.f.lastModifiedDateTime || '').localeCompare(a.f.lastModifiedDateTime || ''));
    const codes = String(v.code || '').split(/[^\d]+/).filter(x => x.length >= 4);
    // קבצים שהמשתמש ביקש להתעלם מהם (מילים בשם הקובץ, למשל "פירוט ביצוע")
    const skip = (l.prevSkip || []).map(norm).filter(Boolean);
    // r.prevNo (1.137): קבצים שסימנת לשורה הזו כ"לא מתאים", לא מוצעים לה שוב
    const no = new Set(r.prevNo || []);
    const keep = xs => xs.filter(x => !no.has(x.f.id) && !skip.some(w => norm(x.f.name).includes(w)));
    // קובץ שבשם שלו יש סמל של מוסד אחר (כמה גנים באותה כתובת) לא מוצע
    // (1.133) קובץ כזה כן מוצע, אבל אחרי קבצים בלי סמל אחר, ואף פעם לא מסומן מראש: אולי הסמל השתנה ואולי זה מוסד אחר באותה כתובת
    const otherCode = x => (x.f.name.match(/\d{5,7}/g) || []).find(n => !codes.includes(n)) || '';
    // סמל של שורה אחרת ברשימה הזו: הקובץ שייך למוסד ההוא, לא מוצע כאן
    // (1.139) לפי רחוב ומספר קובץ כזה כן מוצע (withSib), אחרון ולא מסומן, עם שם השורה שהסמל שייך לה: לפעמים סקר אחד כיסה כמה גנים באותו מתחם
    const listCodes = new Map(); l.rows.filter(q => !q.deleted && q !== r).forEach(q => { const qv = valuesOf(l, q); String(qv.code || '').split(/[^\d]+/).filter(x => x.length >= 4).forEach(c => listCodes.set(c, qv.siteName || '')); });
    const sibOf = x => (x.f.name.match(/\d{5,7}/g) || []).find(n => listCodes.has(n) && !codes.includes(n)) || '';
    const own = (xs, withSib) => { xs.forEach(x => { x.oc = otherCode(x); x.sib = sibOf(x); }); if (!withSib) xs = xs.filter(x => !x.sib); return [...xs.filter(x => !x.oc), ...xs.filter(x => x.oc && !x.sib), ...xs.filter(x => x.sib)]; };
    const ocWhy = x => x.sib ? ' · לא סומן: הסמל שבשם הקובץ (' + x.sib + ') שייך לשורה אחרת ברשימה' + (listCodes.get(x.sib) ? ' (' + listCodes.get(x.sib) + ')' : '') + '. מתאים רק אם אותו סקר כיסה גם את המוסד הזה'
      : ' · לא סומן: בשם הקובץ יש סמל מוסד אחר (' + x.oc + '), כדאי לבדוק שזה אותו מוסד';
    // אותו קובץ בכמה תיקיות (אותו שם ואותו גודל) נחשב קובץ אחד; שאר המקומות נשמרים ב-dups להצגה
    const uniq = xs => { const m = new Map(), out = []; for (const x of xs) { const k = x.f.size ? x.f.name + '|' + x.f.size : 'id' + x.f.id, a = m.get(k); if (a) (a.dups = a.dups || []).push(x); else { m.set(k, x); out.push(x); } } return out; };
    const tie = xs => ' · לא סומן: יש עוד קובץ שמתאים באותה מידה (ב"' + (xs[1].path.slice(-2).join(' / ') || 'דרייב') + '"), אפשר לראות ולבחור למטה';
    // התאמת שם המוסד (1.137): המילים הארוכות (לפחות חצי מהן), וכל הסימנים הקצרים שמבדילים בין מוסדות ("גילה ב", "ארנונה 3 4"),
    // ושסוג המוסד לא סותר: שורה של גן לא תואמת קובץ של בית ספר / תיכון, ולהפך
    const nmAll = [...new Set(norm(v.siteName || '').split(' ').filter(w => w && !STOP.has(w)))];
    const nm = { big: nmAll.filter(w => w.length >= 3 && !/\d/.test(w)), small: nmAll.filter(w => w.length < 3 || /\d/.test(w)) };
    const TYPES = [['גן', /(^| )(גן|גני|גנון)( |$)/], ['ביס', /(^| )(ביס|בית ספר|יסודי|תיכון|חטב|חטיבה|ממד|ממלכתי|אולפנה|ישיבה)( |$)/], ['מעון', /(^| )(מעון|מעונות)( |$)/]];
    const typesOf = t => TYPES.filter(x => x[1].test(t)).map(x => x[0]);
    const rowTypes = typesOf(norm(v.siteName || ''));
    const nameOk = hay => { const ft = typesOf(hay);
      return nm.big.length > 0 && nm.big.filter(w => hasWord(hay, w)).length >= Math.ceil(nm.big.length / 2) && nm.small.every(w => hasWord(hay, w))
        && !(rowTypes.length && ft.length && !rowTypes.some(t => ft.includes(t))); };
    const by = {
      async code() {
        if (!codes.length) return null;
        const xs = uniq(keep(score(await archiveFiles(codes, l.folder || null))));
        if (xs.length) xs[0].alts = xs;
        if (xs.length === 1) return Object.assign(xs[0], { sure: true, byCode: true, why: 'לפי סמל המוסד' });
        if (!xs.length) return null;
        xs[0].byCode = true; const t = xs[0];
        const named = !!(t.stHit || t.hits >= 2), ahead = t.sc > xs[1].sc || (t.sc > (xs[1].sc || 0) - 1e-9 && (t.year || '') > (xs[1].year || ''));
        return Object.assign(t, { sure: named && ahead, why: `לפי סמל המוסד (${xs.length} קבצים, נבחר המתאים ביותר)` + (!named ? ' · לא סומן: שם הקובץ לא מזכיר את הכתובת או את שם המוסד' : !ahead ? tie(xs) : '') });
      },
      async street() {
        const { word, num } = streetKey(v.street);
        if (!word || word.length < 2 || !num) return null;
        const xs = own(uniq(keep(score(await archiveFiles([...new Set([word, ...streetWords(v.street)])], l.folder || null))).filter(x => x.stHit && x.numHit && (!clean(v.city) || x.cityHit || l.folder))), true);
        if (!xs.length) return null;
        xs[0].alts = xs;
        const clear = xs.length === 1 || xs[0].sc > xs[1].sc || !!xs[1].oc, sure = clear && !xs[0].oc && xs[0].stFull;
        return Object.assign(xs[0], { sure, why: 'לפי רחוב ומספר' + (xs[0].oc ? ocWhy(xs[0]) : !clear ? tie(xs) : !xs[0].stFull ? ' · לא סומן: רק חלק משם הרחוב מופיע בשם הקובץ' : '') });
      },
      // שם המוסד: כל המילים של השם (בלי מילים כלליות ומספרים) צריכות להופיע בשם הקובץ
      async name() {
        const ws = nm.big;
        if (!ws.length || ws.join('').length < 4) return null;
        const long = ws.slice().sort((a, b) => b.length - a.length)[0];
        const xs = own(uniq(keep(score(await archiveFiles([long], l.folder || null))).filter(x => nameOk(norm(x.f.name)))));
        if (!xs.length) return null;
        xs[0].alts = xs;
        const clear = xs.length === 1 || xs[0].sc > xs[1].sc || !!xs[1].oc, sure = clear && !xs[0].oc;
        return Object.assign(xs[0], { sure, why: 'לפי שם המוסד' + (xs[0].oc ? ocWhy(xs[0]) : clear ? '' : tie(xs)) });
      },
    };
    for (const k of prevBy(l)) {
      const x = by[k] ? await by[k]() : null;
      if (!x) continue;
      // מה תואם ומה לא בין השורה לקובץ, בכל הבדיקות (גם אלה שלא לפיהן נמצא): להשוואה לפני אישור. null = אין מה לבדוק בשורה
      for (const y of x.alts || [x]) { const hay = norm(y.f.name);
        y.m = { code: codes.length ? k === 'code' || codes.some(c => y.f.name.includes(c)) : null,
          street: streetKey(v.street).word ? !!(y.stHit && y.numHit) : null,
          name: nm.big.length ? nameOk(hay) : null }; }
      x.alts = (x.alts || [x]).slice(0, 8);
      return x;
    }
    return null;
  }
  // לפי מה משייכים ובאיזה סדר (1.129): l.prevBy, ברירת מחדל סמל מוסד ואחריו רחוב ומספר
  const PREV_BY = [['code', 'סמל מוסד'], ['street', 'רחוב ומספר'], ['name', 'שם המוסד']];
  const prevBy = l => Array.isArray(l.prevBy) ? l.prevBy.filter(k => PREV_BY.some(x => x[0] === k)) : ['code', 'street'];
  async function prevManager(l, redrawTable) {
    const ui = U(), { h } = ui;
    const nameCol = l.cols.find(c => /שם\s*ה?(מוסד|מעון|גן|אתר|בית\s*ספר)/.test(c.name)) || null;
    const nm = r => { const v = valuesOf(l, r); return { name: v.siteName || (nameCol && clean(r.cells[nameCol.id])) || 'שורה', sub: [v.code ? 'סמל ' + v.code : null, geoStreet(v.street), v.city].filter(Boolean).join(' · ') }; };
    const rows = () => l.rows.filter(r => !r.deleted && !r.sid);
    const ix = await prevIndex();
    const prop = new Map(), sel = new Set(), ok = new Set(), bad = new Set(), open = new Set(), view = { f: 'all', s: 'list' };
    function verdict(r, x, v) {
      ok.delete(r.id); bad.delete(r.id);
      const had = (r.prevNo || []).includes(x.f.id);
      if (v === 'ok') ok.add(r.id);
      if (v === 'bad') { bad.add(r.id); if (!had) r.prevNo = [...new Set([...(r.prevNo || []), x.f.id, ...(x.dups || []).map(d => d.f.id)])].slice(-40); } // גם העותקים הזהים שלו
      else if (had) { const out = new Set([x.f.id, ...(x.dups || []).map(d => d.f.id)]); r.prevNo = r.prevNo.filter(id => !out.has(id)); if (!r.prevNo.length) delete r.prevNo; }
      if (had !== (r.prevNo || []).includes(x.f.id)) { r.u = Date.now(); save(l); }
      draw();
    }
    const fltBox = h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:center' });
    const status = h('div', { class: 'muted small', role: 'status' });
    const box = h('div', { class: 'stack' });
    const close = () => { ov.remove(); if (redrawTable) redrawTable(); };
    const linked = () => rows().filter(r => r.prev && !r.prev.none);
    const filesOf = () => linked().filter(r => sel.has(r.id) && r.prev.kind === 'file');
    const btnAuto = h('button', { class: 'btn primary', onclick: () => run(btnAuto, auto) }, '🔗 שיוך אוטומטי לשורות בלי סקר');
    const btnOk = h('button', { class: 'btn primary', hidden: true, onclick: () => run(btnOk, confirmProps) }, 'אשר את ההצעות המסומנות');
    const btnGet = h('button', { class: 'btn', onclick: () => run(btnGet, preload) }, '⬇ הורד מראש (גם לטאבלט)');
    const btnZip = h('button', { class: 'btn', onclick: () => run(btnZip, zip) }, '💾 שמור כקבצים (ZIP)');
    // לפי מה לשייך: סימון = להתייחס, הסדר = העדיפות (הראשון שמוצא קובץ קובע)
    const byBox = h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:center' });
    const setBy = ks => { l.prevBy = ks; save(l); prop.clear(); ok.clear(); drawBy(); draw(); };
    function drawBy() {
      const on = prevBy(l), order = [...on, ...PREV_BY.map(x => x[0]).filter(k => !on.includes(k))];
      byBox.replaceChildren(h('b', { class: 'small' }, 'לשייך לפי:'), ...order.map(k => {
        const i = on.indexOf(k), name = PREV_BY.find(x => x[0] === k)[1];
        return h('span', { class: 'chip' + (i >= 0 ? ' on' : ''), style: 'display:inline-flex;align-items:center;gap:6px' },
          h('label', { style: 'display:inline-flex;align-items:center;gap:6px;cursor:pointer' },
            h('input', { type: 'checkbox', checked: i >= 0, onchange: e => setBy(e.target.checked ? [...on, k] : on.filter(x => x !== k)) }), (i >= 0 ? (i + 1) + '. ' : '') + name),
          i > 0 ? h('button', { class: 'link-btn', title: 'העלה בעדיפות', 'aria-label': 'העלה בעדיפות את ' + name, onclick: () => { const ks = on.slice(); ks.splice(i - 1, 2, ks[i], ks[i - 1]); setBy(ks); } }, '⬆') : null);
      }));
    }
    const skipInp = h('input', { type: 'text', value: (l.prevSkip || []).join(', '), placeholder: 'למשל: פירוט ביצוע, הצעת מחיר', style: 'flex:1;min-width:180px',
      onchange: e => { l.prevSkip = e.target.value.split(/[,،;\n]+/).map(x => x.trim()).filter(Boolean); if (!l.prevSkip.length) delete l.prevSkip; save(l); } });
    const allBox = h('input', { type: 'checkbox', onchange: () => { linked().forEach(r => allBox.checked ? sel.add(r.id) : sel.delete(r.id)); draw(); } });
    async function run(btn, fn) { const all = [btnAuto, btnOk, btnGet, btnZip]; all.forEach(b => { b.disabled = true; }); try { await fn(); } catch (e) { status.textContent = 'נכשל: ' + e.message; } finally { all.forEach(b => { b.disabled = false; }); draw(); } }
    async function auto() {
      if (navigator.onLine === false || !(await OD.connected())) { status.textContent = 'צריך חיבור לגוגל דרייב כדי לחפש סקרים קודמים.'; return; }
      if (!prevBy(l).length) { status.textContent = 'סמן לפחות דבר אחד לשייך לפיו.'; return; }
      const todo = rows().filter(r => !(r.prev && !r.prev.none));
      prop.clear(); ok.clear(); bad.clear();
      let i = 0, found = 0;
      const next = async () => { while (todo.length) { const r = todo.shift(); const x = await proposePrev(l, r).catch(() => null); i++; if (x) { prop.set(r.id, x); found++; if (x.sure) ok.add(r.id); } status.textContent = `מחפש… ${i} שורות נבדקו, ${found} הצעות`; if (i % 4 === 0) draw(); } };
      await Promise.all([next(), next(), next()]);
      // אותו קובץ הוצע לכמה שורות: לא מסומן, כדי שתבדוק
      const cnt = new Map(); for (const x of prop.values()) cnt.set(x.f.id, (cnt.get(x.f.id) || 0) + 1);
      const byCode = new Set([...prop.values()].filter(x => x.byCode).map(x => x.f.id));
      for (const [id, x] of [...prop]) if (cnt.get(x.f.id) > 1) {
        if (x.byCode) continue;
        if (byCode.has(x.f.id)) { x.sure = false; ok.delete(id); continue; } // הקובץ שייך לשורה אחרת לפי הסמל: נשאר כהצעה לבדיקה (ההסבר כבר ב-why, 1.139)
        x.sure = false; x.why += ' · אותו קובץ הוצע לכמה שורות'; ok.delete(id);
      }
      status.textContent = found ? `נמצאו ${found} הצעות (${ok.size} מסומנות). לכל הצעה לחץ "מתאים" או "לא מתאים", ואז "אשר את ההצעות המסומנות". שום דבר לא נשמר עד שתאשר.` : 'לא נמצאו הצעות. אפשר לחפש לכל שורה בנפרד עם "חפש".';
    }
    async function confirmProps() {
      let n = 0;
      for (const [id, x] of prop) if (ok.has(id) && !bad.has(id)) { const r = l.rows.find(q => q.id === id); if (!r) continue; r.prev = Object.assign(prevOf(x), { manual: true }); r.u = Date.now(); sel.add(id); n++; }
      for (const id of [...prop.keys()]) if (!bad.has(id)) prop.delete(id); // מה שסומן "לא מתאים" נשאר לתצוגה
      ok.clear();
      await save(l);
      status.textContent = `${n} שורות שויכו. עכשיו אפשר להוריד אותן מראש.`;
    }
    async function preload() {
      const fs = filesOf();
      if (!fs.length) { status.textContent = 'סמן שורות עם קובץ משויך.'; return; }
      let i = 0, bad = 0;
      // הסימון נשמר בשורה ומסתנכרן: כל מכשיר אחר (הטאבלט) מוריד את הקבצים האלה לבד כשהרשימה נפתחת בו
      for (const r of fs) if (!r.prev.pre) { r.prev.pre = true; r.u = Date.now(); }
      await save(l);
      for (const r of fs) { status.textContent = `מוריד… ${++i} מתוך ${fs.length}`; try { await prevBlob(r.prev.f); } catch (e) { bad++; } draw(); }
      status.textContent = `הורדו ${fs.length - bad} קבצים למכשיר הזה. בטאבלט ובטלפון הם יורדו לבד בפעם הבאה שהרשימה תיפתח שם עם קליטה.` + (bad ? ` ${bad} נכשלו.` : '');
    }
    async function zip() {
      const fs = filesOf();
      if (!fs.length) { status.textContent = 'סמן שורות עם קובץ משויך.'; return; }
      const z = new JSZip(), used = new Set();
      let i = 0;
      for (const r of fs) { status.textContent = `מכין… ${++i} מתוך ${fs.length}`; let n = r.prev.f.name; for (let k = 2; used.has(n); k++) n = r.prev.f.name.replace(/(\.[^.]+)?$/, ` (${k})$1`); used.add(n); z.file(n, await (await prevBlob(r.prev.f)).arrayBuffer()); }
      ui.downloadFile(new Blob([await z.generateAsync({ type: 'uint8array' })], { type: 'application/zip' }), ui.safeName((l.name || 'רשימה') + ' - סקרים קודמים') + '.zip');
      status.textContent = `${fs.length} קבצים נשמרו בקובץ ZIP.`;
    }
    function draw() {
      btnOk.hidden = !prop.size;
      btnOk.textContent = `אשר את ההצעות המסומנות (${ok.size})`;
      const ls = linked();
      allBox.checked = ls.length > 0 && ls.every(r => sel.has(r.id));
      const fileLine = (p, extra) => h('div', { class: 'small wl-pfile' }, h('span', { class: 'muted' }, '📁 ' + prevPath(p) + (p.kind === 'file' ? ' / ' : '')), p.kind === 'file' ? h('b', {}, p.f.name) : h('b', {}, ' ' + p.name), extra || null);
      // סינון ומיון (1.134): מצב השורה, וכמה מהבדיקות (סמל, רחוב, שם) תואמות בהצעה
      const kindOf = r => r.prev && !r.prev.none ? 'linked' : prop.has(r.id) ? (bad.has(r.id) ? 'bad' : ok.has(r.id) ? 'ok' : 'check') : 'none';
      const hitsOf = r => { const x = prop.get(r.id); return x && x.m ? Object.values(x.m).filter(v => v === true).length : -1; };
      const all = rows(), cnt = k => all.filter(r => kindOf(r) === k).length;
      const FL = [['all', 'הכול', all.length], ['ok', 'הצעות מסומנות', cnt('ok')], ['check', 'הצעות לבדיקה', cnt('check')], ['bad', 'לא מתאים', cnt('bad')], ['linked', 'משויכים', cnt('linked')], ['none', 'בלי שיוך ובלי הצעה', cnt('none')]];
      if (!FL.some(f => f[0] === view.f && (f[2] || f[0] === 'all'))) view.f = 'all';
      fltBox.replaceChildren(h('b', { class: 'small' }, 'הצג:'), ...FL.filter(f => f[2] || f[0] === 'all').map(f => h('button', { class: 'chip' + (view.f === f[0] ? ' on' : ''), 'aria-pressed': String(view.f === f[0]), onclick: () => { view.f = f[0]; draw(); } }, `${f[1]} (${f[2]})`)),
        h('label', { class: 'row small', style: 'gap:6px;align-items:center;margin-inline-start:auto' }, 'מיון:',
          h('select', { onchange: e => { view.s = e.target.value; draw(); } }, ...[['list', 'לפי סדר הרשימה'], ['most', 'הכי הרבה התאמות קודם'], ['least', 'הכי פחות התאמות קודם'], ['state', 'לפי מצב: לבדיקה, מסומנות, בלי שיוך, משויכים']].map(o => h('option', { value: o[0], selected: view.s === o[0] }, o[1])))));
      let shown = all.filter(r => view.f === 'all' || kindOf(r) === view.f);
      const ST = { check: 0, ok: 1, bad: 2, none: 3, linked: 4 }, idx = new Map(all.map((r, i) => [r.id, i]));
      if (view.s === 'most') shown = shown.slice().sort((a, b) => hitsOf(b) - hitsOf(a) || idx.get(a.id) - idx.get(b.id));
      else if (view.s === 'least') shown = shown.slice().sort((a, b) => (hitsOf(a) < 0) - (hitsOf(b) < 0) || hitsOf(a) - hitsOf(b) || idx.get(a.id) - idx.get(b.id));
      else if (view.s === 'state') shown = shown.slice().sort((a, b) => ST[kindOf(a)] - ST[kindOf(b)] || idx.get(a.id) - idx.get(b.id));
      box.replaceChildren(...shown.map(r => {
        const n = nm(r), p = r.prev && !r.prev.none ? r.prev : null, x = prop.get(r.id);
        return h('div', { class: 'wl-stop wl-prow' + (x ? ' prop' : '') },
          p ? h('input', { type: 'checkbox', 'aria-label': 'בחר', checked: sel.has(r.id), onchange: e => { e.target.checked ? sel.add(r.id) : sel.delete(r.id); draw(); } })
            : h('span', { style: 'width:4px' }),
          h('div', { style: 'flex:1;min-width:0' }, h('b', {}, n.name), h('div', { class: 'muted small' }, n.sub),
            p ? fileLine(p, p.kind === 'file' && ix[p.f.id] ? h('span', { class: 'wl-badge done', style: 'margin-inline-start:6px' }, '✓ הורד') : null)
              : x ? h('div', {}, fileLine(prevOf(x)),
                h('div', { class: 'small wl-match' }, 'בקובץ הקודם: ', ...PREV_BY.filter(c => x.m && x.m[c[0]] != null).map(c => h('span', { class: x.m[c[0]] ? 'yes' : 'no' }, (x.m[c[0]] ? '✓ ' : '✗ ') + c[1] + (x.m[c[0]] ? ' תואם' : ' שונה')))),
                h('div', { class: 'small', style: 'color:#8a5200' }, (x.sure ? 'הצעה: ' : 'הצעה לבדיקה: ') + x.why + (x.year ? ' · ' + x.year : '')),
                (x.dups || []).length ? h('div', { class: 'small muted' }, 'אותו קובץ בדיוק (אותו שם וגודל) נמצא גם ב: ' + x.dups.map(d => d.path.join(' / ') || 'דרייב').join(' ; ')) : null,
                (x.alts || []).length > 1 ? h('details', { class: 'wl-alts', open: open.has(r.id), ontoggle: e => { e.target.open ? open.add(r.id) : open.delete(r.id); } },
                  h('summary', {}, `כל ${x.alts.length} הקבצים שמתאימים`),
                  ...x.alts.map(y => h('div', { class: 'wl-alt' + (y === x ? ' on' : '') },
                    h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 'wl-pfile' }, h('span', { class: 'muted' }, '📁 ' + (y.path.join(' / ') || 'דרייב') + ' / '), h('b', {}, y.f.name)),
                      h('div', { class: 'muted' }, [y.f.lastModifiedDateTime ? 'עודכן ' + ui.fmtDate(y.f.lastModifiedDateTime.slice(0, 10)) : null, y.f.size ? Math.max(1, Math.round(y.f.size / 1024)) + ' KB' : null, (y.dups || []).length ? 'עוד ' + y.dups.length + ' עותקים זהים' : null].filter(Boolean).join(' · '))),
                    h('a', { class: 'btn', href: 'https://drive.google.com/file/d/' + encodeURIComponent(y.f.id) + '/view', target: '_blank', rel: 'noopener' }, 'הצג'),
                    y === x ? h('span', { class: 'wl-badge done' }, 'נבחר') : h('button', { class: 'btn', onclick: () => { prop.set(r.id, Object.assign(y, { alts: x.alts, byCode: x.byCode, sure: true, why: 'בחרת את הקובץ הזה' })); ok.add(r.id); draw(); } }, 'בחר את זה')))) : null)
              : h('div', { class: 'muted small' }, 'אין סקר קודם משויך', (r.prevNo || []).length ? h('span', {}, ` · סימנת ${r.prevNo.length} קבצים כלא מתאימים `, h('button', { class: 'link-btn small', onclick: () => { delete r.prevNo; r.u = Date.now(); save(l); draw(); } }, 'נקה')) : null)),
          p && p.kind === 'file' ? h('button', { class: 'btn', onclick: () => openPrevFile(p, 'xlsx').then(draw) }, 'אקסל') : null,
          p && p.kind === 'file' ? h('button', { class: 'btn', onclick: () => openPrevFile(p, 'pdf') }, 'PDF') : null,
          // הצעה: שלושה מצבים. מתאים (ייכנס לאישור) / לא מתאים (נשמר לשורה, לא יוצע לה שוב) / בלי החלטה = לבדיקה
          x && !p ? h('div', { class: 'wl-verdict' },
            h('button', { class: 'btn' + (ok.has(r.id) && !bad.has(r.id) ? ' yes' : ''), 'aria-pressed': String(ok.has(r.id) && !bad.has(r.id)), onclick: () => verdict(r, x, ok.has(r.id) && !bad.has(r.id) ? '' : 'ok') }, '✓ מתאים'),
            h('button', { class: 'btn' + (bad.has(r.id) ? ' no' : ''), 'aria-pressed': String(bad.has(r.id)), onclick: () => verdict(r, x, bad.has(r.id) ? '' : 'bad') }, '✗ לא מתאים')) : null,
          x && !p ? h('a', { class: 'btn', href: 'https://drive.google.com/file/d/' + encodeURIComponent(x.f.id) + '/view', target: '_blank', rel: 'noopener' }, 'הצג') : null,
          h('button', { class: 'btn', onclick: () => { ov.remove(); openRow(l, r, true, () => prevManager(l, redrawTable)); } }, p ? 'החלף' : 'חפש'),
          p ? h('button', { class: 'icon-btn', title: 'בטל שיוך', 'aria-label': 'בטל שיוך', onclick: () => { delete r.prev; r.u = Date.now(); sel.delete(r.id); save(l); draw(); } }, '✕') : null);
      }));
    }
    const ov = h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
      h('div', { class: 'card stack', style: 'max-width:860px;width:96%' },
        h('h2', { style: 'margin:0;font-size:21px' }, '📎 סקרים קודמים של הרשימה'),
        h('div', { class: 'muted small' }, 'החיפוש ב: ' + (l.folder ? 'התיקייה "' + l.folder.name + '"' : 'הארכיון הרגיל') + '. שיוך אוטומטי רק מציע: שום סקר לא נפתח ושום דבר לא נשמר עד שתאשר. שורות שכבר נפתח להן סקר לא מופיעות כאן.'),
        byBox,
        h('div', { class: 'muted small' }, 'הסדר הוא העדיפות: קודם מחפשים לפי 1, ורק אם לא נמצא קובץ עוברים ל-2. מה שלא מסומן לא נבדק.'),
        h('label', { class: 'row small', style: 'gap:8px;align-items:center;flex-wrap:wrap' }, 'להתעלם מקבצים שבשם שלהם יש:', skipInp),
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, btnAuto, btnOk),
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:center' }, h('label', { class: 'row small', style: 'gap:6px;align-items:center' }, allBox, 'בחר את כל המשויכים'), btnGet, btnZip),
        status, fltBox, box,
        h('button', { class: 'btn', onclick: close }, 'סגור')));
    document.body.append(ov);
    drawBy(); draw();
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
  const NOMI = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=il&accept-language=he&q=';
  const ARC = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&maxLocations=5&countryCode=ISR&langCode=he&outFields=Addr_type&SingleLine=';
  const PHOTON = 'https://photon.komoot.io/api/?limit=5&bbox=34.2,29.4,35.95,33.4&q=';
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
      return (j || []).map(x => ({ lat: +x.lat, lon: +x.lon, label: x.display_name || '', kind: /^(house|building|residential|road|street|primary|secondary|tertiary|footway|pedestrian)$/.test(x.type) || x.category === 'building' || x.category === 'amenity' ? 'street' : 'place' }));
    };
    const p = geoQueue.then(run, run);
    geoQueue = p.catch(() => {});
    return p;
  }
  // c: מרכז המפה, כדי שחיפוש חופשי יעדיף תוצאות קרובות
  async function arcgis(q, c) {
    const res = await fetch(ARC + encodeURIComponent(q) + (c ? `&location=${c.lng},${c.lat}` : ''));
    if (!res.ok) throw new Error('ArcGIS ' + res.status);
    const j = await res.json();
    if (j.error) throw new Error('ArcGIS ' + (j.error.message || j.error.code));
    return (j.candidates || []).filter(c => c.score >= 75).map(c => { const t = (c.attributes && c.attributes.Addr_type) || '';
      return { lat: +c.location.y, lon: +c.location.x, label: c.address || '', kind: /^(PointAddress|StreetAddress|StreetAddressExt|StreetInt|StreetName|StreetMidBlock|Subaddress|POI|DistanceMarker)$/.test(t) ? 'street' : 'place' }; });
  }
  async function photon(q, c) {
    const res = await fetch(PHOTON + encodeURIComponent(q) + (c ? `&lat=${c.lat}&lon=${c.lng}` : ''));
    if (!res.ok) throw new Error('Photon ' + res.status);
    const j = await res.json();
    return (j.features || []).map(f => { const pp = f.properties || {}, t = pp.type || '';
      return { lat: +f.geometry.coordinates[1], lon: +f.geometry.coordinates[0], label: [pp.street || pp.name, pp.housenumber, pp.city].filter(Boolean).join(' '), kind: /^(house|street|other)$/.test(t) ? 'street' : 'place' }; });
  }
  const GEOS = [['ArcGIS', arcgis], ['Photon', photon], ['OpenStreetMap', nominatim]];
  const geoFails = new Map(); // שירות שנכשל 3 פעמים ברצף: מדלגים עליו עד הטעינה הבאה
  async function geocode(q, kind, ok) {
    const errs = [];
    let tried = 0, fb = null;
    // (1.140) כל שירות מחזיר עד 5 תוצאות. נבחרת הראשונה שבה מופיעות כל מילות הרחוב ומספר הבית שביקשנו;
    // אם באף שירות אין כזו, חוזרת התוצאה הראשונה שנמצאה עם fit=false (המיקום יסומן משוער)
    const part = norm(String(q).split(',')[0]).split(' '), ws = part.filter(w => w.length >= 3 && !/\d/.test(w)), num = (part.find(w => /^\d+/.test(w)) || '').replace(/\D+/g, '');
    const fits = c => { const lab = norm(c.label || ''); return ws.every(w => hasWord(lab, w)) && (!num || hasWord(lab, num)); };
    for (const [name, fn] of GEOS) {
      if ((geoFails.get(name) || 0) >= 3) continue;
      tried++;
      try {
        const cs = ((await fn(q)) || []).filter(g => isFinite(g.lat) && isFinite(g.lon) && (kind !== 'street' || g.kind === 'street') && (!ok || ok(g)));
        geoFails.set(name, 0);
        const g = cs.find(fits);
        if (g) return { lat: g.lat, lon: g.lon, label: g.label || '', fit: true };
        if (!fb && cs[0]) fb = { lat: cs[0].lat, lon: cs[0].lon, label: cs[0].label || '', fit: false };
      } catch (e) { geoFails.set(name, (geoFails.get(name) || 0) + 1); errs.push(e.message); }
    }
    if (!fb && (!tried || (errs.length && errs.length === tried))) throw new Error('שירותי המפה לא זמינים' + (errs.length ? ' (' + errs.join(', ') + ')' : ''));
    return fb;
  }
  // (1.142) חיפוש חופשי במפת המסלול: כמה תוצאות מכמה שירותים, קרובות למרכז המפה קודם
  async function searchAll(q, c) {
    const out = [], errs = [];
    for (const [, fn] of GEOS) {
      if (out.length >= 3) break;
      try { for (const g of (await fn(q, c)) || []) if (isFinite(g.lat) && isFinite(g.lon) && !out.some(o => km(o, g) < 0.03)) out.push({ lat: g.lat, lon: g.lon, label: g.label || q }); }
      catch (e) { errs.push(e.message); }
    }
    if (!out.length && errs.length === GEOS.length) throw new Error('שירותי המפה לא זמינים (' + errs.join(', ') + ')');
    return out.slice(0, 8);
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
  const approxTxt = g => 'מיקום משוער (' + (g.note || 'מרכז העיר') + ')';
  async function locate(l, r, local) {
    // מיקום שתוקן ביד (גרירה / סימון במפה / חיפוש בכתובת אחרת) נשאר תמיד
    if (r.geo && r.geo.manual) return r.geo;
    const s = r.sid && local.get(r.sid);
    const pts = s ? s.trees.filter(t => typeof t.lat === 'number' && typeof t.lon === 'number') : [];
    if (pts.length) return { lat: pts.reduce((a, t) => a + t.lat, 0) / pts.length, lon: pts.reduce((a, t) => a + t.lon, 0) / pts.length, src: 'gps' };
    const v = valuesOf(l, r);
    const st = geoStreet(v.street), city = fullCity(v.city);
    const key = 'v4|' + st + '|' + city; // v4 (1.140): בחירה מתוך כמה תוצאות; v3 (1.138): בודקים שהכתובת שהשירות מצא היא באמת הרחוב והמספר שביקשנו
    if (r.geo && r.geo.key === key) return r.geo;
    if (geoMem.has(key)) { const m = geoMem.get(key); if (m) r.geo = Object.assign({}, m); return m ? r.geo : null; }
    if (!st && !city) return null;
    let c = null, cErr = null;
    if (city) { try { c = await cityGeo(city); } catch (e) { cErr = e; } }
    const near = g => g && (!c || km(c, g) <= 12);
    let g = null, approx = false, note = '';
    // מדויק (ירוק) רק כשבכתובת שהשירות החזיר מופיעים שם הרחוב וגם מספר הבית. אחרת המיקום מסומן משוער (כתום) עם הסיבה
    const check = x => {
      const lab = norm(x.label || ''), ws = streetWords(st), num = streetKey(st).num;
      if (!/[א-ת]/.test(lab)) return 'לא אומת מול שם הרחוב';
      if (ws.length && !ws.every(w => hasWord(lab, w))) return (ws.some(w => hasWord(lab, w)) ? 'שם הרחוב תואם רק בחלקו, נמצא: ' : 'נמצא רחוב אחר: ') + clean(x.label).split(',')[0];
      if (num && !hasWord(lab, num)) return 'נמצא הרחוב, בלי מספר הבית';
      return '';
    };
    if (st && city) { g = await geocode(st + ', ' + city, 'street', near); if (!near(g)) g = null; else { note = check(g); approx = !!note; } }
    if ((!g || /^נמצא רחוב אחר/.test(note)) && st && city) {
      const w = st.replace(/\s*\d+\s*$/, '');
      if (w && w !== st) { const g2 = await geocode(w + ', ' + city, 'street', near); if (near(g2)) { const n2 = check(g2); if (!g || !/^נמצא רחוב אחר/.test(n2)) { g = g2; note = n2 || 'נמצא הרחוב, בלי מספר הבית'; approx = true; } } }
    }
    if (!g && c) { g = c; approx = true; note = 'מרכז העיר'; }
    if (!g && st && !city) { g = await geocode(st); if (g) { note = check(g); approx = !!note; } }
    if (!g && cErr) throw cErr;
    if (!g) { geoMem.set(key, null); return null; }
    r.geo = { lat: g.lat, lon: g.lon, key, approx };
    if (note) r.geo.note = note;
    geoMem.set(key, r.geo);
    return r.geo;
  }
  // איתור כל התחנות ברקע: ממשיך גם כשיוצאים ממסך המסלול, נשמר כל כמה שורות, ומסך שנפתח שוב מצטרף אליו
  const geoJobs = new Map();
  function geoJob(l, local, allRows) {
    const jk = l.id + (allRows ? '|all' : '');
    let j = geoJobs.get(jk);
    if (j && !j.done) return j;
    j = { i: 0, n: 0, subs: new Set(), done: false };
    geoJobs.set(jk, j);
    j.p = (async () => {
      const need = allRows ? l.rows.filter(r => !r.deleted) : l.route.map(id => l.rows.find(r => r.id === id)).filter(r => r && !r.deleted);
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
        // העברת תחנה או 2-3 תחנות סמוכות למקום אחר במסלול (גם הפוך): מונע חזרה מאוחרת לאזור שכבר עברנו בו
        for (let L = 1; L <= Math.min(3, n - 1); L++) for (let i = 0; i + L <= n; i++) {
          const seg = o.slice(i, i + L), rest = [...o.slice(0, i), ...o.slice(i + L)];
          for (let p = 0; p <= rest.length; p++) {
            if (p === i) continue;
            for (const sg of L > 1 ? [seg, seg.slice().reverse()] : [seg]) {
              const nw = [...rest.slice(0, p), ...sg, ...rest.slice(p)];
              if (len(nw) < len(o) - 1e-9) { o = nw; better = true; }
            }
          }
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
    // מוסדות צמודים ברצף (1.131): תחנה שיש לה שכנה עד 300 מ' אבל במסלול היא רחוקה ממנה (נאספת "בדרך הלוך" והשכנה "בדרך חזור")
    // עוברת להיות צמודה לשכנה, אם זה כמעט לא מאריך את הדרך (עד 1% לכל העברה, 3% בסך הכול, בלי הקטע מנקודת ההתחלה)
    const inner = o => len(o) - (start ? d(-1, o[0]) : 0);
    const base = len(best), tol = inner(best) * 0.01;
    for (let pass = 0, moved = true; moved && pass < n; pass++) {
      moved = false;
      for (let i = 0; i < n && !moved; i++) {
        const a = best[i], near = j => j !== a && km(pts[a], pts[j]) <= 0.3;
        if (!pts.some((_, j) => near(j)) || (i > 0 && near(best[i - 1])) || (i < n - 1 && near(best[i + 1]))) continue;
        const rest = best.filter(x => x !== a);
        let top = null;
        for (let p = 0; p <= rest.length; p++) {
          if (!((p > 0 && near(rest[p - 1])) || (p < rest.length && near(rest[p])))) continue;
          const nw = [...rest.slice(0, p), a, ...rest.slice(p)], ln = len(nw);
          if (!top || ln < top.ln) top = { nw, ln };
        }
        if (top && top.ln <= len(best) + tol && top.ln <= base + tol * 3) { best = top.nw; moved = true; }
      }
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
    // (1.155) "לא קיים" לא במפה ולא במסלול. "לבדיקה" נשאר, בצהוב
    const gone = r => !!(r && r.flag === 'gone');
    const isCheck = r => !!(r && r.flag === 'check');
    if (!Array.isArray(l.route) || !l.route.length) l.route = live().filter(r => !done(r) && !gone(r)).map(r => r.id);
    l.route = l.route.filter(id => live().some(r => r.id === id && !gone(r)));
    // סימון מכל מקום במסך: אחרי שינוי מציירים מחדש, ומה שחזר למסלול מאותר במפה
    const flagIt = (L, r) => flagDialog(L, r, () => { redraw(); locateAll().then(redraw).catch(() => {}); });
    const flagBtn = (L, r, after) => h('button', { class: 'btn', title: 'לא קיים / לבדיקה', onclick: e => { e.stopPropagation(); if (after) after(); flagIt(L, r); } }, flagOf(r) ? 'סטטוס ▾' : '⚑ סמן');
    const assignBtn = (r, after) => r.sid ? h('button', { class: 'btn', title: 'לאיזו רשימה הסקר שייך, שכונה ותיקייה בדרייב', onclick: e => { e.stopPropagation(); if (after) after(); assignBySid(r.sid); } }, '📁 שיוך') : null;
    // עבודה שהסתיימה יורדת מהמסלול והמספור מתעדכן (אפשר להחזיר אותה מ"לא במסלול")
    const doneOut = l.route.filter(id => done(l.rows.find(r => r.id === id)));
    if (doneOut.length) { l.route = l.route.filter(id => !doneOut.includes(id)); save(l); setTimeout(() => ui.toast(doneOut.length === 1 ? 'עבודה אחת שהסתיימה ירדה מהמסלול' : `${doneOut.length} עבודות שהסתיימו ירדו מהמסלול`, 3500), 300); }
    const nameColOf = L => L.cols.find(c => /שם\s*ה?(מוסד|מעון|גן|אתר|בית\s*ספר)/.test(c.name)) || null;
    const labelIn = (L, r) => { const v = valuesOf(L, r), nc = nameColOf(L); return { name: (nc && clean(r.cells[nc.id])) || v.siteName || 'שורה', addr: [geoStreet(v.street), fullCity(v.city)].filter(Boolean).join(', ') }; };
    const label = r => labelIn(l, r);
    // (1.148, ori) סמל מוסד ושם המנהל/ת (גננת) ליד שם המוסד
    // (1.148, ori) תגית בצבע הרשימה: מאיזו רשימה המוסד
    const srcTag = (name, css) => h('span', { class: 'wl-badge wl-src', style: css }, name);
    // (1.156, ori) גם סוג המוסד (גן / בית ספר / תיכון…) מעמודה "סוג מוסד" / "סוג"
    const typeCol = L => (L.cols || []).find(c => /^סוג(\s*(ה?מוסד|מסגרת))?$/.test(String(c.name || '').trim())) || null;
    const metaIn = (L, r) => { const v = valuesOf(L, r), tc = typeCol(L), t = tc ? clean(r.cells[tc.id]) : ''; return [t, v.code ? 'סמל ' + v.code : '', v.manager || ''].filter(Boolean).join(' · '); };
    const geo = new Map();
    // רשימות משניות (l.sides, 1.145 ori): רשימות נפרדות לגמרי שהמוסדות שלהן מוצגים במפה, כדי לראות מי מהם קרוב לתחנה במסלול.
    // לכל רשימה מרחק "קרוב" וצבע סמנים משלה: [{ id, m, color }]. l.side / l.sideM נשארים = הראשונה, בשביל גרסאות ישנות במכשיר אחר
    const SIDE_COLORS = ['#7a3fc4', '#d81b60', '#0097a7', '#3949ab', '#6d4c41', '#455a64', '#ef6c00'];
    const okC = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c : null;
    const textOn = c => { const n = parseInt(c.slice(1), 16), y = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return y > 0.62 ? '#111' : '#fff'; };
    if (!Array.isArray(l.sides)) l.sides = l.side ? [{ id: l.side, m: +l.sideM || 150 }] : [];
    l.sides = l.sides.filter((c, i, a) => c && c.id && c.id !== l.id && a.findIndex(o => o && o.id === c.id) === i);
    const freeColor = () => SIDE_COLORS.find(c => !l.sides.some(s => s.color === c)) || SIDE_COLORS[l.sides.length % SIDE_COLORS.length];
    l.sides.forEach(c => { if (!okC(c.color)) c.color = freeColor(); });
    const syncOld = () => { const f = l.sides[0]; if (f) { l.side = f.id; l.sideM = f.m; } else { delete l.side; delete l.sideM; } };
    const otherLists = (await all()).filter(x => !x.deleted && x.id !== l.id);
    const SIDES = [];
    for (const c of l.sides) { const L2 = otherLists.find(x => x.id === c.id); if (L2) SIDES.push({ c, L: L2, geo: new Map(), pins: new Map() }); }
    const mOf = S => S.self ? +l.selfM || 150 : +S.c.m || 150;
    // (1.174, ori) הצבע שייך לרשימה עצמה (L.mapColor): אותו צבע כשהיא ראשית וכשהיא משנית בכל מפה אחרת. צבע ישן של השיוך עובר לרשימה פעם אחת
    const MAIN_DEF = '#2e6b33';
    for (const S of SIDES) if (!okC(S.L.mapColor) && okC(S.c.color)) { S.L.mapColor = S.c.color; save(S.L); }
    const mainCol = () => okC(l.mapColor) || MAIN_DEF;
    const colOf = S => S.self ? okC(S.c.color) : okC(S.L.mapColor) || okC(S.c.color) || SIDE_COLORS[0];
    // (1.174, ori) צבע לפי קב"ט (L.kabatPins), הצבעים משותפים לכל הרשימות
    const allLists = (await all()).filter(x => !x.deleted);
    let kix = kabatIndex(allLists);
    const kabCol = k => kix.colors.get(k) || null;
    const kabOn = L => !!L.kabatPins && kabatCapable(L, kix);
    const pinKab = (L, r) => kabOn(L) ? rowKabatKey(L, r, kix) : '';
    const sideDone = r => { const s = r.sid && local.get(r.sid); return !!(s && (s.finished || s.finishPending)); };
    const rowsOf = S => S.L.rows.filter(r => !r.deleted && !sideDone(r) && !gone(r));
    // מוסדות מכל רשימה משנית שקרובים לתחנה (אותה כתובת או עד המרחק של אותה רשימה): [{ S, rs }]
    const nearIn = (S, id) => { const g = geo.get(id); return g ? rowsOf(S).filter(r => { const x = S.geo.get(r.id); return x && km(g, x) * 1000 <= mOf(S); }) : []; };
    // (1.164, ori) גם תחנות אחרות מאותה רשימה ראשית שקרובות (לא באותה נקודה בדיוק, אלה כבר מופיעות כ"באותה נקודה"): l.selfM מטר, 0 = כבוי
    if (l.selfM == null) l.selfM = 150;
    const SELF = { self: true, c: { color: '#222222' }, L: l, geo, pins: new Map() };
    const pkOf = g => g ? g.lat.toFixed(5) + ',' + g.lon.toFixed(5) : '';
    const nearSelf = id => {
      const g = geo.get(id), m = +l.selfM || 0; if (!g || !m) return [];
      const k0 = pkOf(g);
      return l.route.filter(x => x !== id).map(x => l.rows.find(r => r.id === x)).filter(r => { if (!r || r.deleted) return false; const x = geo.get(r.id); return x && pkOf(x) !== k0 && km(g, x) * 1000 <= m; });
    };
    const nearOf = id => { const out = SIDES.map(S => ({ S, rs: nearIn(S, id) })).filter(x => x.rs.length), me = nearSelf(id); return me.length ? [{ S: SELF, rs: me }, ...out] : out; };
    const nearTxt = n => n === 1 ? '➕ מוסד קרוב אחד' : `➕ ${n} מוסדות קרובים`;
    const chipCss = S => `background:${colOf(S)};color:${textOn(colOf(S))};border-color:${colOf(S)}`;
    // כפתור לכל רשימה שיש בה מוסדות קרובים, בצבע שלה
    const nearChips = (id, cls, after) => nearOf(id).map(({ S, rs }) => h('button', { class: cls, style: chipCss(S), title: S.self ? 'תחנות אחרות במסלול של הרשימה הזו שקרובות לתחנה הזו' : 'מוסדות מהרשימה "' + S.L.name + '" שקרובים לתחנה הזו',
      onclick: e => { e.stopPropagation(); if (after) after(); showNear(id, S); } }, nearTxt(rs.length) + (S.self ? ' · מאותה רשימה' : SIDES.length > 1 || after ? ' · ' + (S.L.name || 'רשימה') : '')));
    // (1.144, ori) מעבר ל-50/150/300: "מרחק אחר…" = כל מספר מטרים. (1.145) לכל רשימה משנית בנפרד
    const PRESET_M = [50, 150, 300];
    // (1.174, ori) "צבע לפי קב"ט" לרשימה (נשמר ברשימה עצמה, אז גם כשהיא משנית במפה אחרת)
    function kabToggle(L) {
      if (!kabatCapable(L, kix)) return null;
      return h('label', { class: 'row small', style: 'gap:4px;align-items:center', title: 'כל קב"ט בצבע משלו. רשימה בלי עמודת קב"ט: לפי סמל המוסד ברשימה שיש בה קב"ט' },
        h('input', { type: 'checkbox', checked: !!L.kabatPins, onchange: e => { if (e.target.checked) L.kabatPins = true; else delete L.kabatPins; save(L); drawSideCtl(); redraw(); } }), 'צבע לפי קב"ט');
    }
    // מקרא הקב"טים שבמפה, עם אפשרות לשנות צבע (משותף לכל הרשימות)
    function kabLegend() {
      const shown = [l, ...SIDES.map(S => S.L)].filter(kabOn);
      if (!shown.length) return null;
      const keys = new Map();
      for (const L of shown) for (const r of L.rows) { if (r.deleted) continue; const k = rowKabatKey(L, r, kix); if (k) keys.set(k, (keys.get(k) || 0) + 1); }
      let noK = 0; for (const L of shown) noK += L.rows.filter(r => !r.deleted && !rowKabatKey(L, r, kix)).length;
      const ks = [...keys.keys()].sort((a, b) => (kix.names.get(a) || a).localeCompare(kix.names.get(b) || b, 'he'));
      return h('div', { class: 'stack wl-kab-legend', style: 'gap:6px' },
        h('div', { class: 'small' }, 'צבעים לפי קב"ט (לחיצה על הצבע משנה אותו בכל הרשימות):'),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, ...ks.map(k => {
          const inp = h('input', { type: 'color', class: 'wl-color', value: kabCol(k), 'aria-label': 'צבע הקב"ט ' + (kix.names.get(k) || k),
            onchange: async () => { if (!okC(inp.value)) return; await setKabatColor(k, inp.value, allLists, kix); drawSideCtl(); redraw(); } });
          return h('label', { class: 'row wl-kab', style: `gap:4px;align-items:center;border-inline-start:6px solid ${kabCol(k)}` }, inp, h('span', { class: 'small' }, `${kix.names.get(k) || k} (${keys.get(k)})`));
        })),
        noK ? h('div', { class: 'muted small' }, `${noK} מוסדות בלי קב"ט מופיעים בצבע של הרשימה שלהם`) : null);
    }
    // (1.174, ori) שתי רשימות באותו צבע במפה: הערה, ובחירה למי לשנות ולאיזה צבע
    function clashBox() {
      const items = [{ L: l, c: mainCol(), set: v => { l.mapColor = v; persist(); } }, ...SIDES.map(S => ({ L: S.L, c: colOf(S), set: v => { S.c.color = v; S.L.mapColor = v; save(S.L); persist(); } }))];
      const by = new Map(); items.forEach(it => { const k = it.c.toLowerCase(); by.set(k, [...(by.get(k) || []), it]); });
      const dup = [...by.values()].filter(a => a.length > 1);
      if (!dup.length) return null;
      const usedC = new Set(items.map(it => it.c.toLowerCase()));
      const free = () => [...SIDE_COLORS, ...KABAT_COLORS].find(c => !usedC.has(c.toLowerCase())) || '#000000';
      return h('div', { class: 'stack wl-clash', style: 'gap:6px;padding:8px 10px;border-radius:10px;background:#fff4d6;border:1px solid #e0b000;color:#5a4300' },
        ...dup.map(a => h('div', { class: 'stack', style: 'gap:6px' },
          h('b', { class: 'small' }, `⚠ ${a.length} רשימות באותו צבע במפה: ${a.map(it => it.L.name || 'רשימה').join(', ')}. בחר לאיזו לשנות ולאיזה צבע:`),
          ...a.map(it => { const inp = h('input', { type: 'color', class: 'wl-color', value: free(), 'aria-label': 'צבע חדש ל' + (it.L.name || 'רשימה') });
            return h('div', { class: 'row', style: 'gap:6px;align-items:center;flex-wrap:wrap' }, h('span', { class: 'small', style: 'min-width:120px' }, it.L.name || 'רשימה'), inp,
              h('button', { class: 'btn', style: 'min-height:36px', onclick: () => { if (!okC(inp.value)) return; it.set(inp.value); drawSideCtl(); redraw(); } }, 'שנה את הצבע של הרשימה הזו')); }))),
        h('div', { class: 'muted small' }, 'הצבע נשמר ברשימה עצמה, אז הוא משתנה גם בכל מפה אחרת שהיא מופיעה בה.'));
    }
    function sideRowCtl(S) {
      const c = S.c, cur = mOf(S), pre = PRESET_M.includes(cur);
      const num = h('input', { class: 'in', type: 'number', inputmode: 'numeric', min: 1, max: 5000, step: 1, style: 'width:90px;min-height:40px', 'aria-label': 'מרחק במטרים', placeholder: 'מטר',
        value: pre ? '' : cur, hidden: pre ? true : null,
        onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); },
        onchange: () => { const m = Math.round(+num.value); if (!(m >= 1 && m <= 5000)) { num.value = mOf(S); ui.toast('מרחק בין 1 ל-5000 מטר', 3000); return; } c.m = m; syncOld(); persist(); redraw(); } });
      const mu = h('span', { class: 'small', hidden: pre ? true : null }, "מ'");
      const sel = h('select', { class: 'in', style: 'width:auto;min-height:40px', 'aria-label': 'מרחק שנחשב קרוב לרשימה ' + S.L.name, onchange: () => {
          if (sel.value === 'x') { num.hidden = mu.hidden = false; num.value = PRESET_M.includes(mOf(S)) ? '' : mOf(S); num.focus(); return; }
          num.hidden = mu.hidden = true; c.m = +sel.value; syncOld(); persist(); redraw(); } },
        PRESET_M.map(m => h('option', { value: m, selected: cur === m ? '' : null }, `קרוב = עד ${m} מ'`)),
        h('option', { value: 'x', selected: pre ? null : '' }, 'מרחק אחר…'));
      const wrap = h('div', { class: 'row wl-side-ctl', style: `gap:6px;align-items:center;flex-wrap:wrap;border-inline-start:6px solid ${colOf(S)}` });
      const color = h('input', { type: 'color', class: 'wl-color', value: colOf(S), title: 'צבע הסמנים של הרשימה במפה', 'aria-label': 'צבע הסמנים של ' + S.L.name,
        oninput: () => { wrap.style.borderInlineStartColor = color.value; },
        onchange: () => { if (!okC(color.value)) return; c.color = color.value; S.L.mapColor = color.value; save(S.L); persist(); drawSideCtl(); redraw(); } });
      const rm = h('button', { class: 'icon-btn', title: 'הסר את הרשימה המשנית מהמסלול (הרשימה עצמה לא נמחקת)', 'aria-label': 'הסר את ' + S.L.name, onclick: async () => {
        l.sides = l.sides.filter(x => x !== c); syncOld(); await persist(); renderRoute(l); } }, '✕');
      wrap.append(...[color, h('b', { class: 'small', style: 'max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, S.L.name || 'רשימה'), sel, num, mu, kabToggle(S.L), rm].filter(Boolean));
      return wrap;
    }
    const sideCtl = h('div', { class: 'stack', style: 'gap:6px' });
    function drawSideCtl() {
      const used = new Set(l.sides.map(c => c.id)), free = otherLists.filter(x => !used.has(x.id));
      const add = h('select', { class: 'in', style: 'width:auto;min-height:40px;max-width:280px', 'aria-label': 'צרף רשימה משנית', onchange: async () => {
          if (!add.value) return; const L2 = otherLists.find(x => x.id === add.value);
          l.sides.push({ id: add.value, m: 150, color: (L2 && okC(L2.mapColor)) || freeColor() }); syncOld(); await persist(); renderRoute(l); } },
        h('option', { value: '' }, SIDES.length ? '➕ צרף עוד רשימה משנית…' : 'בלי רשימה משנית (➕ צרף…)'), ...free.map(x => h('option', { value: x.id }, x.name || 'רשימה')));
      // (1.164, ori) קרובים מאותה רשימה ראשית
      const selfSel = h('select', { class: 'in', style: 'width:auto;min-height:40px', 'aria-label': 'מרחק שנחשב קרוב בתוך אותה רשימה', onchange: () => { l.selfM = +selfSel.value; persist(); redraw(); } },
        [[0, 'בלי'], ...PRESET_M.map(m => [m, `עד ${m} מ'`])].concat(PRESET_M.includes(+l.selfM) || !+l.selfM ? [] : [[+l.selfM, `עד ${+l.selfM} מ'`]])
          .map(([v, t]) => h('option', { value: v, selected: +l.selfM === v ? '' : null }, t)));
      const selfRow = h('div', { class: 'row wl-side-ctl', style: 'gap:6px;align-items:center;flex-wrap:wrap;border-inline-start:6px solid #222' }, h('b', { class: 'small' }, 'קרובים מאותה רשימה:'), selfSel);
      // (1.174) צבע הרשימה הראשית עצמה + צבע לפי קב"ט
      const mc = h('input', { type: 'color', class: 'wl-color', value: mainCol(), title: 'צבע הסמנים של הרשימה הזו במפה', 'aria-label': 'צבע הסמנים של ' + (l.name || 'הרשימה'),
        onchange: () => { if (!okC(mc.value)) return; l.mapColor = mc.value; persist(); drawSideCtl(); redraw(); } });
      const mainRow = h('div', { class: 'row wl-side-ctl', style: `gap:6px;align-items:center;flex-wrap:wrap;border-inline-start:6px solid ${mainCol()}` },
        mc, h('b', { class: 'small' }, 'הרשימה הזו: ' + (l.name || 'רשימה')), okC(l.mapColor) ? h('button', { class: 'btn', style: 'min-height:36px', title: 'חזרה לירוק הרגיל', onclick: () => { delete l.mapColor; persist(); drawSideCtl(); redraw(); } }, '↺ רגיל') : null, kabToggle(l));
      sideCtl.replaceChildren(...[mainRow, clashBox(), kabLegend()].filter(Boolean), selfRow, h('div', { class: 'small' }, SIDES.length > 1 ? `רשימות משניות (מוסדות קרובים, ${SIDES.length}):` : 'רשימה משנית (מוסדות קרובים):'),
        ...SIDES.map(sideRowCtl), ...(free.length ? [add] : []));
    }
    const sideBox = h('div', { class: 'stack' });
    function showNear(id, only) {
      const r0 = l.rows.find(x => x.id === id), groups = nearOf(id).filter(x => !only || x.S === only);
      const pk = g => g ? g.lat.toFixed(5) + ',' + g.lon.toFixed(5) : '', k0 = pk(geo.get(id));
      const here = vis().map(x => l.rows.find(r => r.id === x)).filter(r => r && !r.deleted && (r.id === id || (k0 && pk(geo.get(r.id)) === k0)));
      const close = () => ov.remove();
      const ov = h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
        h('div', { class: 'card stack', style: 'max-width:560px;width:96%' },
          h('h2', { style: 'margin:0;font-size:20px' }, `קרובים ל${label(r0).name}`),
          // (1.148, ori) קודם כל המוסדות של הרשימה הראשית שעל אותה נקודה במפה (אותו מספר), ואחריהם הקרובים מהרשימות המשניות
          h('div', { class: 'stack', style: 'gap:6px;border-inline-start:6px solid var(--accent);padding-inline-start:8px' },
            h('div', { class: 'muted small' }, here.length > 1 ? `ברשימה "${l.name || 'הראשית'}", ${here.length} מוסדות בנקודה הזו במפה` : `ברשימה "${l.name || 'הראשית'}"`),
            ...here.map(r => { const lb = label(r), mt = metaIn(l, r), n = l.route.indexOf(r.id) + 1; return h('div', { class: 'wl-stop' },
              h('div', { style: 'flex:1;min-width:0' }, h('b', {}, (n ? n + '. ' : '') + lb.name + (done(r) ? ' ✓' : '')), srcTag(l.name || 'ראשית', 'background:var(--accent);color:var(--accent-ink)'), flagBadge(r, h), mt ? h('div', { class: 'small' }, mt) : null, h('div', { class: 'muted small' }, lb.addr)),
              flagBtn(l, r, close),
              h('button', { class: 'btn', onclick: () => { close(); jumpTo(r.id); } }, 'במפה'),
              h('button', { class: 'btn primary', onclick: () => { close(); openRow(l, r); } }, 'פתח סקר')); })),
          ...groups.map(({ S, rs }) => h('div', { class: 'stack', style: `gap:6px;border-inline-start:6px solid ${colOf(S)};padding-inline-start:8px` },
            h('div', { class: 'muted small' }, S.self ? `תחנות קרובות מאותה רשימה "${l.name || 'הראשית'}", עד ${mOf(S)} מ' מהתחנה` : `מהרשימה "${S.L.name}", עד ${mOf(S)} מ' מהתחנה`),
            ...rs.map(r => { const lb = labelIn(S.L, r), d = Math.round(km(geo.get(id), S.geo.get(r.id)) * 1000), n = S.self ? l.route.indexOf(r.id) + 1 : 0; return h('div', { class: 'wl-stop side', style: `border-color:${colOf(S)}` },
              h('div', { style: 'flex:1;min-width:0' }, h('b', {}, (n ? n + '. ' : '') + lb.name + (S.self && done(r) ? ' ✓' : '')), srcTag(S.self ? (l.name || 'ראשית') : (S.L.name || 'רשימה'), S.self ? 'background:var(--accent);color:var(--accent-ink)' : chipCss(S)), flagBadge(r, h), metaIn(S.L, r) ? h('div', { class: 'small' }, metaIn(S.L, r)) : null, h('div', { class: 'muted small' }, lb.addr + (d < 15 ? ' · באותו מקום' : ` · ${d} מ'`))),
              flagBtn(S.L, r, close),
              h('button', { class: 'btn', onclick: () => { close(); S.self ? jumpTo(r.id) : jumpSide(S, r.id); } }, 'במפה'),
              h('button', { class: 'btn primary', onclick: () => { close(); S.self ? openRow(l, r) : openRow(S.L, r, true); } }, 'פתח סקר')); }))),
          only && nearOf(id).length > 1 ? h('button', { class: 'btn', onclick: () => { close(); showNear(id); } }, 'הצג קרובים מכל הרשימות') : null,
          h('button', { class: 'btn', onclick: close }, 'סגור')));
      document.body.append(ov);
    }
    function drawSide() {
      const opened = new Set([...sideBox.querySelectorAll('details[open]')].map(d => d.dataset.sid));
      const nearIds = new Map(SIDES.map(S => [S, new Set()]));
      vis().forEach(id => nearOf(id).forEach(({ S, rs }) => { if (!S.self) rs.forEach(r => nearIds.get(S).add(r.id)); }));
      // (1.144) replaceChildren כותב null כטקסט: רק כשיש מה להציג
      sideBox.replaceChildren(...SIDES.map(S => {
        const rs = rowsOf(S), C = colOf(S), near = nearIds.get(S);
        const bad = rs.filter(r => !S.geo.get(r.id) || S.geo.get(r.id).approx);
        const row = r => { const lb = labelIn(S.L, r), g = S.geo.get(r.id); return h('div', { class: 'wl-stop side', style: `border-color:${C}` },
          h('div', { class: 'wl-stop-go', style: 'flex:1;min-width:0', role: 'button', tabindex: '0', title: 'הצג במפה', onclick: () => jumpSide(S, r.id) }, h('b', {}, lb.name), flagBadge(r, h), near.has(r.id) ? h('span', { class: 'wl-badge near', style: `margin-inline-start:6px;${chipCss(S)}` }, 'קרוב לתחנה') : null,
            h('div', { class: 'muted small' }, lb.addr + (g ? (g.manual ? ' · מיקום שתיקנת' : g.approx ? ' · ' + approxTxt(g) : '') : S.geo.has(r.id) ? ' · לא נמצא במפה, לחץ 📍' : ' · מאתר…'))),
          h('button', { class: 'icon-btn', title: 'תקן מיקום במפה', 'aria-label': 'תקן מיקום', onclick: () => fixLoc(r, S) }, '📍'),
          flagBtn(S.L, r),
          h('button', { class: 'btn', onclick: () => openRow(S.L, r, true) }, 'פתח סקר')); };
        return h('div', { class: 'stack', style: `border-inline-start:6px solid ${C};padding-inline-start:10px` },
          h('b', {}, `רשימה משנית: ${S.L.name} (${rs.length} מוסדות, ${near.size} קרובים לתחנות במסלול, עד ${mOf(S)} מ')`),
          ...(bad.length ? [h('div', { class: 'small', style: 'color:#8a5200' }, `${bad.length} מוסדות לא אותרו או במיקום משוער. תקן אותם עם 📍:`)] : []),
          ...bad.map(row),
          h('details', { open: opened.has(S.L.id) ? true : null, 'data-sid': S.L.id }, h('summary', { class: 'small', style: 'cursor:pointer' }, 'כל המוסדות ברשימה ' + S.L.name), h('div', { class: 'stack', style: 'margin-top:8px' }, ...rs.filter(r => !bad.includes(r)).map(row))));
      }));
    }
    function jumpSide(S, id) {
      const mk = S.pins.get(id);
      if (!map || !mk) { ui.toast('המוסד הזה עוד לא אותר במפה. לחץ 📍 כדי לסמן אותו', 3500); return; }
      userMoved = true; mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      map.setView(mk.getLatLng(), Math.max(map.getZoom(), 17)); mk.openPopup();
    }
    function drawSidePins() {
      for (const S of SIDES) {
        S.pins.clear();
        if (!map) continue;
        const C0 = colOf(S);
        for (const r of rowsOf(S)) {
          const g = S.geo.get(r.id); if (!g) continue;
          const lb = labelIn(S.L, r);
          // (1.174) צבע לפי קב"ט: המילוי בצבע הקב"ט והמסגרת בצבע הרשימה
          const kk = pinKab(S.L, r), C = (kk && kabCol(kk)) || C0, bord = kk ? `border:2.5px solid ${C0};` : '';
          // מיקום משוער: מסגרת מקווקוות וסימן שאלה (הצבע נשאר של הרשימה)
          const ck = isCheck(r);
          const mk = L.marker([g.lat, g.lon], { zIndexOffset: ck ? 200 : -500, icon: L.divIcon({ className: 'wl-pin side' + (g.approx ? ' approx' : '') + (ck ? ' check' : ''), html: ck ? `<span class="wl-sp" style="border-color:${C}">!</span>` : `<span class="wl-sp" style="background:${C};color:${textOn(C)};${bord}">${g.approx ? '?' : '+'}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }) });
          if (g.src !== 'gps') holdDrag(mk);
          mk.addTo(layer);
          mk.bindPopup(() => h('div', { class: 'wl-popup', dir: 'rtl' },
            h('b', {}, lb.name), h('div', {}, lb.addr), h('div', { class: 'small', style: `color:${C0};font-weight:700` }, 'רשימה משנית: ' + S.L.name + (kk ? ' · קב"ט ' + (kix.names.get(kk) || kk) : '')), flagBadge(r, h), g.approx ? h('i', {}, approxTxt(g)) : null,
            h('div', { class: 'row', style: 'gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap' },
              h('button', { class: 'btn primary', onclick: () => { map.closePopup(); openRow(S.L, r, true); } }, 'פתח סקר'),
              flagBtn(S.L, r, () => map.closePopup()), assignBtn(r, () => map.closePopup()),
              h('button', { class: 'btn', onclick: () => { map.closePopup(); fixLoc(r, S); } }, '📍 תקן מיקום'),
              h('a', { href: g.src === 'gps' || g.manual ? `https://waze.com/ul?ll=${g.lat},${g.lon}&navigate=yes` : 'https://waze.com/ul?q=' + encodeURIComponent(lb.addr) + '&navigate=yes', target: '_blank', rel: 'noopener' }, 'וייז')),
            h('div', { class: 'muted small' }, g.manual ? 'מיקום שתיקנת ביד' : 'אפשר גם להזיז: לחיצה ארוכה על הנקודה ואז גרירה')), { minWidth: 220 })
            .on('dragend', e => { const p = e.target.getLatLng(); setManual(r, { lat: p.lat, lon: p.lng }, null, S); ui.toast('המיקום של ' + lb.name + ' עודכן', 2500); });
          S.pins.set(r.id, mk);
        }
      }
    }
    const status = h('div', { class: 'muted small', role: 'status' });
    const listBox = h('div', { class: 'stack wl-route-list' });
    // (1.147, ori) ליד "סדר אוטומטי": כמה מוסדות עוד נשאר לאתר מתוך כמה, לרשימה הראשית ולכל רשימה משנית
    const geoCount = h('div', { class: 'row small wl-geo-count', role: 'status', style: 'gap:6px;flex-wrap:wrap;align-items:center' });
    function showGeoCount() {
      const one = (name, ids, gm, css) => {
        const tot = ids.length, tried = ids.filter(id => gm.has(id)).length, found = ids.filter(id => gm.get(id)).length, left = tot - tried;
        const txt = left ? `📍 ${name}נשארו לאתר ${left} מתוך ${tot}` : found === tot ? `✓ ${name}כל ${tot} המוסדות אותרו` : `✓ ${name}אותרו ${found} מתוך ${tot}, ${tot - found} לא נמצאו`;
        return h('span', { class: 'wl-badge' + (left ? ' busy' : ''), style: css || '' }, txt);
      };
      const named = SIDES.length > 0;
      geoCount.replaceChildren(
        one(named ? (l.name || 'ראשית') + ': ' : '', l.route.filter(id => l.rows.some(r => r.id === id && !r.deleted)), geo),
        ...SIDES.map(S => one((S.L.name || 'רשימה') + ': ', rowsOf(S).map(r => r.id), S.geo, chipCss(S))));
    }
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
        // לסידור מסלול מספיק מיקום גס: המיקום האחרון מה-GPS המשותף (עד 2 דקות), אחרת עד 8 שניות
        const p = me || (window.Geo && (Geo.last(120000) || await Geo.get({ good: 100, ok: 1000, settle: 2000, timeout: 8000 })));
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
    let map = null, layer = null, pickAfter = null, userMoved = false, extras = null;
    const persist = () => save(l);
    // (1.157, ori) מי שפתח לה מפה משלה היא רשימה ראשית: כפתור המפה במסך הרשימות יופיע לה גם אם היא משויכת כמשנית לרשימה אחרת
    if (!l.mapAt) { l.mapAt = Date.now(); persist(); }
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
    // S: רשימה משנית ({ L, geo }); בלי S: הרשימה של המסלול
    // (1.170) מיקום שתוקן עובר לאותו מוסד ברשימות האחרות, וגם הסיכות שלהן במפה הזו מתעדכנות
    async function mirrorHere(LL, rows) {
      let n = 0;
      for (const r of rows) for (const p of await mirrorGeo(LL, r).catch(() => [])) {
        n++;
        if (p.L.id === l.id) geo.set(p.r.id, p.r.geo);
        for (const S of SIDES) if (S.L.id === p.L.id) S.geo.set(p.r.id, p.r.geo);
      }
      if (n) { ui.toast(`המיקום עודכן גם ב-${n} ${n > 1 ? 'שורות' : 'שורה'} של אותו מוסד ברשימות האחרות`, 3000); redraw(); }
    }
    function setManual(r, p, q, S) {
      r.geo = { lat: p.lat, lon: p.lon, key: (r.geo && r.geo.key) || '', manual: true, at: Date.now() };
      if (q) r.geo.q = q;
      r.u = Date.now(); (S ? S.geo : geo).set(r.id, r.geo);
      // (1.139.1) שאר השורות באותה כתובת בדיוק (כמה גנים במתחם אחד) עוברות יחד, אם לא תוקנו ביד בעצמן ואין להן נ"צ מעצים
      const LL = S ? S.L : l, G = S ? S.geo : geo, ak = x => { const v = valuesOf(LL, x); return norm(v.street) + '|' + norm(v.city); }, k = ak(r);
      let n = 0;
      if (norm(valuesOf(LL, r).street)) for (const x of LL.rows) if (x !== r && !x.deleted && !(x.geo && (x.geo.manual || x.geo.src === 'gps')) && !(G.get(x.id) && G.get(x.id).src === 'gps') && ak(x) === k) {
        x.geo = { lat: p.lat, lon: p.lon, key: (x.geo && x.geo.key) || '', manual: true, at: Date.now() }; if (q) x.geo.q = q; x.u = Date.now(); G.set(x.id, x.geo); n++; }
      if (n) ui.toast(`המיקום עודכן גם ל-${n} שורות נוספות באותה כתובת`, 3500);
      save(LL); redraw();
      mirrorHere(LL, [r]);
    }
    function fixLoc(r, S) {
      const LL = S ? S.L : l, G = S ? S.geo : geo;
      const lb = labelIn(LL, r), g = G.get(r.id);
      const q = h('input', { class: 'in', type: 'search', value: (r.geo && r.geo.q) || lb.addr, style: 'flex:1;min-width:180px', placeholder: 'רחוב ומספר, עיר' });
      const msg = h('div', { class: 'muted small' }, 'כתוב את הכתובת אחרת (עם יוד / בלי יוד, שם חדש של הרחוב, שם מקום) ולחץ חפש, או סמן את המקום במפה.');
      const close = () => ov.remove();
      const search = async () => {
        const t = clean(q.value); if (!t) return;
        msg.textContent = 'מחפש…';
        try {
          const p = await geocode(t);
          if (!p) { msg.textContent = `לא מצאתי את "${t}". נסה לכתוב אחרת, או סמן במפה.`; return; }
          const use = () => { close(); setManual(r, p, t, S);
            if (map) { userMoved = true; map.setView([p.lat, p.lon], 17); }
            ui.toast('נמצא. אם הנקודה לא בדיוק במקום, לחץ עליה לחיצה ארוכה וגרור', 4000); };
          // התוצאה לא מכילה את כל מה שכתבת (רחוב אחר / בלי מספר): לא מזיזים לבד, מראים מה נמצא ואתה מחליט
          if (!p.fit) { msg.textContent = ''; msg.append(`לא מצאתי בדיוק את "${t}". הכי קרוב שנמצא: "${clean(p.label) || 'בלי שם'}". אם זה לא המקום, נסה כתיב אחר או סמן במפה. `,
            h('button', { class: 'btn', onclick: use }, 'השתמש בזה בכל זאת')); return; }
          use();
        } catch (e) { msg.textContent = e.message + '. אפשר לסמן במפה.'; }
      };
      q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
      const ov = h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
        h('div', { class: 'card stack', style: 'max-width:560px;width:96%' },
          h('h2', { style: 'margin:0;font-size:20px' }, '📍 מיקום של ' + lb.name),
          h('div', { class: 'muted small' }, 'בטבלה: ' + (lb.addr || '—') + (g ? (g.manual ? ' · כרגע: מיקום שתיקנת' : g.approx ? ' · כרגע: ' + approxTxt(g) : '') : ' · כרגע: לא נמצא')),
          h('div', { class: 'row', style: 'gap:8px' }, q, h('button', { class: 'btn primary', onclick: search }, '🔎 חפש')),
          msg,
          h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
            // מיקום משוער שבדקת במפה והוא נכון: מאשרים, והוא נשמר כמיקום שלך (גם לשאר המוסדות באותה כתובת)
            g && g.approx && !g.manual && g.note !== 'מרכז העיר' ? h('button', { class: 'btn primary', onclick: () => {
              close();
              const same = LL.rows.filter(x => !x.deleted && x.geo && x.geo.key === g.key && x.geo.approx && !x.geo.manual);
              (same.length ? same : [r]).forEach(x => setManual(x, g, null, S));
              ui.toast(same.length > 1 ? `המיקום אושר ל-${same.length} מוסדות באותה כתובת` : 'המיקום אושר', 2500);
            } }, '✓ המיקום נכון') : null,
            h('button', { class: 'btn', onclick: () => { close(); pickOnMap('לחץ על המפה במקום של ' + lb.name, ll => { setManual(r, { lat: ll.lat, lon: ll.lng }, null, S); ui.toast('המיקום נשמר', 2500); }); } }, '👆 סמן במפה'),
            r.geo && r.geo.manual ? h('button', { class: 'btn', onclick: async () => { close(); delete r.geo; G.delete(r.id); r.u = Date.now(); try { const g2 = await locate(LL, r, local); G.set(r.id, g2 || null); } catch (e) { ui.toast(e.message, 4000); } save(LL); redraw(); } }, '↩ חזור לאיתור האוטומטי') : null,
            h('button', { class: 'btn', onclick: close }, 'ביטול'))));
      document.body.append(ov);
      q.focus(); q.select();
    }
    // סיכות המפה לפי תחנה, לקפיצה מהרשימה; pinDraws: ציור מחדש של הסיכות כשהזום משתנה
    const pinOf = new Map();
    let pinDraws = [], hlPin = null, zoomBand = null;
    function jumpTo(id) {
      const mk = pinOf.get(id);
      if (!map || !mk) { ui.toast(geo.get(id) ? 'המפה עוד לא מוכנה' : 'התחנה הזו עוד לא אותרה במפה. לחץ 📍 כדי לסמן אותה', 3500); return; }
      userMoved = true;
      mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      map.setView(mk.getLatLng(), Math.max(map.getZoom(), 17));
      hlPin = mk; pinDraws.forEach(f => f());
      mk._one = mk._grp.find(m => m.id === id) || null;
      mk.openPopup();
    }
    function drawMap() {
      if (!map || !window.L) return;
      if (layer) layer.remove();
      layer = L.layerGroup().addTo(map);
      const ll = [];
      if (l.start.mode === 'addr' && l.start.geo && l.start.geo.key === l.start.addr)
        holdDrag(L.marker([l.start.geo.lat, l.start.geo.lon], { icon: L.divIcon({ className: 'wl-pin start', html: '🏠', iconSize: [30, 30], iconAnchor: [15, 15] }) })).addTo(layer)
          .bindPopup('התחלה: ' + l.start.addr.replace(/</g, '&lt;') + '<br><i>לחיצה ארוכה ואז גרירה כדי לדייק</i>')
          .on('dragend', e => { const p = e.target.getLatLng(); l.start.geo = { lat: p.lat, lon: p.lng, key: l.start.addr, manual: true }; persist(); redraw(); });
      // כמה מוסדות באותה כתובת: סיכה אחת. מרחוק המספר הראשון (ונקודה קטנה שמסמנת שיש עוד), ובקירוב כל המספרים (1-2)
      const groups = new Map();
      vis().forEach(id => {
        const r = l.rows.find(x => x.id === id), g = geo.get(id);
        if (!r || !g) return;
        const k = g.lat.toFixed(5) + ',' + g.lon.toFixed(5);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push({ id, r, g, i: l.route.indexOf(id) });
        ll.push([g.lat, g.lon]);
      });
      pinOf.clear(); pinDraws = [];
      const popOf = (m, mk) => {
        const { id, r, g, i } = m, lb = label(r);
        const mv = pos => { if (moveInRoute(l, id, pos)) { persist(); map.closePopup(); redraw(); } };
        return h('div', { class: 'wl-popup', dir: 'rtl' },
          h('b', {}, `${i + 1}. ${lb.name}`), flagBadge(r, h), metaIn(l, r) ? h('div', { class: 'small' }, metaIn(l, r)) : null, h('div', {}, lb.addr), g.approx ? h('i', {}, approxTxt(g)) : null,
          h('div', { class: 'row', style: 'gap:6px;align-items:center;margin-top:6px' }, 'מקום בסדר:',
            rnumInput(l, id, () => { persist(); map.closePopup(); redraw(); }),
            h('button', { class: 'btn', title: 'מוקדם יותר', disabled: i === 0 ? true : null, onclick: () => mv(i) }, '↑'),
            h('button', { class: 'btn', title: 'מאוחר יותר', disabled: i === l.route.length - 1 ? true : null, onclick: () => mv(i + 2) }, '↓'),
            h('button', { class: 'btn', title: 'שים אחרי התחנה שנבחרה קודם', onclick: () => { if (pickAfter && pickAfter !== id) { const k = l.route.indexOf(pickAfter); mv(k + (k < i ? 2 : 1)); pickAfter = null; } else { pickAfter = id; ui.toast('עכשיו לחץ על התחנה שתבוא מיד אחרי זו, ובחר "שים אחרי…"', 3500); map.closePopup(); } } }, pickAfter && pickAfter !== id ? 'שים אחרי ' + label(l.rows.find(x => x.id === pickAfter)).name : '📌 מה בא אחרי זו?')),
          h('div', { class: 'row', style: 'gap:10px;align-items:center;margin-top:6px;flex-wrap:wrap' },
            // (1.146, ori) פתיחת הסקר ישר מהנקודה במפה, כמו "פתח סקר" בטבלה
            h('button', { class: 'btn primary', onclick: () => { map.closePopup(); openRow(l, r); } }, done(r) ? 'פתח סקר ✓' : 'פתח סקר'),
            h('button', { class: 'btn', onclick: () => { map.closePopup(); fixLoc(r); } }, '📍 תקן מיקום'),
            flagBtn(l, r, () => map.closePopup()), assignBtn(r, () => map.closePopup()),
            h('a', { href: navUrl(r), target: '_blank', rel: 'noopener' }, 'נווט בוויז')),
          h('div', { class: 'muted small' }, g.manual ? 'מיקום שתיקנת ביד' : 'אפשר גם להזיז: לחיצה ארוכה על הנקודה ואז גרירה'),
          ...nearChips(id, 'btn wl-near-btn', () => map.closePopup()),
          mk && mk._grp.length > 1 ? h('button', { class: 'btn', style: 'margin-top:6px', onclick: e => { e.stopPropagation(); setTimeout(() => { mk._one = null; mk.setPopupContent(mk._pop()); }, 0); } }, `↩ כל ${mk._grp.length} המוסדות בכתובת הזו`) : null);
      };
      for (const ms of groups.values()) {
        ms.sort((a, b) => a.i - b.i);
        const g = ms[0].g, nums = ms.map(m => m.i + 1);
        const consec = nums.every((n, k) => !k || n === nums[k - 1] + 1);
        const full = ms.length === 1 ? String(nums[0]) : consec ? nums[0] + '-' + nums[nums.length - 1] : nums.join(',');
        const cls = 'wl-pin' + (ms.every(m => done(m.r)) ? ' done' : '') + (g.approx ? ' approx' : '') + (ms.length > 1 ? ' multi' : '') + (ms.some(m => nearOf(m.id).length) ? ' hasnear' : '') + (ms.some(m => isCheck(m.r)) ? ' check' : '');
        // טבעת בצבע של כל רשימה משנית שיש בה מוסד קרוב (כמה רשימות = כמה טבעות)
        const rings = [...new Set(ms.flatMap(m => nearOf(m.id).map(x => colOf(x.S))))];
        const ringHtml = rings.length ? `<b class="wl-ring" style="box-shadow:${rings.map((c, k) => `0 0 0 ${3 * (k + 1)}px ${c}`).join(',')}"></b>` : '';
        // (1.174) צבע הרשימה / צבע הקב"ט (לא במיקום משוער / לבדיקה, שיש להם צבע משלהם)
        const mk0 = pinKab(l, ms[0].r), pc = (mk0 && kabCol(mk0)) || mainCol();
        const bgHtml = pc !== MAIN_DEF && !g.approx && !ms.some(m => isCheck(m.r)) ? `<b class="wl-bg" style="background:${pc}"></b>` : '';
        const txtCss = bgHtml ? ` style="color:${textOn(pc)}"` : '';
        const iconFor = hl => {
          const z = map.getZoom(), near = z >= 15, big = z >= 17;
          const txt = near ? full : String(nums[0]);
          const hgt = big ? 38 : 30, w = Math.max(hgt, Math.round(txt.length * (big ? 12 : 9.5)) + 14);
          return L.divIcon({ className: cls + (near ? ' near' : '') + (big ? ' big' : '') + (hl ? ' hl' : ''), html: bgHtml + ringHtml + `<span dir="ltr"${txtCss}>${txt}</span>` + (!near && ms.length > 1 ? `<i>+${ms.length - 1}</i>` : ''), iconSize: [w, hgt], iconAnchor: [w / 2, hgt / 2] });
        };
        const mk = L.marker([g.lat, g.lon], { icon: iconFor(false) });
        if (g.src !== 'gps') holdDrag(mk);
        mk._grp = ms; mk._one = null; mk._icon2 = iconFor;
        mk._pop = () => mk._one || ms.length === 1 ? popOf(mk._one || ms[0], mk) : h('div', { class: 'wl-popup', dir: 'rtl' },
          h('b', {}, `${ms.length} מוסדות באותה כתובת`), h('div', {}, label(ms[0].r).addr), h('div', { class: 'muted small' }, 'בחר מוסד כדי לפתוח את הסקר שלו:'),
          // (1.154, ori) כמו בחלון "קרובים": לכל מוסד שם, תגית הרשימה, סמל, גננת/מנהל וכתובת, ופתח סקר ישר מכאן
          ...ms.map(m => { const lb = label(m.r), mt = metaIn(l, m.r), one = e => { e.stopPropagation(); setTimeout(() => { mk._one = m; mk.setPopupContent(mk._pop()); }, 0); };
            return h('div', { class: 'wl-stop wl-pop-item', style: 'margin-top:6px' },
              h('div', { style: 'flex:1;min-width:0' }, h('b', {}, `${m.i + 1}. ${lb.name}` + (done(m.r) ? ' ✓' : '')), srcTag(l.name || 'ראשית', 'background:var(--accent);color:var(--accent-ink)'), flagBadge(m.r, h),
                mt ? h('div', { class: 'small' }, mt) : null, h('div', { class: 'muted small' }, lb.addr)),
              h('div', { class: 'stack', style: 'gap:4px' },
                h('button', { class: 'btn primary', onclick: e => { e.stopPropagation(); map.closePopup(); openRow(l, m.r); } }, 'פתח סקר'),
                flagBtn(l, m.r, () => map.closePopup()),
                h('button', { class: 'btn', title: 'מקום בסדר, תיקון מיקום, ניווט וקרובים', onclick: one }, 'עוד…'))); }),
          ...[...new Set(ms.flatMap(m => nearOf(m.id).map(x => x.S)))].map(S => { const m = ms.find(x => nearOf(x.id).some(y => y.S === S)); return nearChips(m.id, 'btn wl-near-btn', () => map.closePopup()).find((_, k) => nearOf(m.id)[k].S === S); }),
          h('div', { class: 'muted small', style: 'margin-top:6px' }, 'לחיצה ארוכה וגרירת הנקודה מזיזה את כולם יחד'));
        mk.addTo(layer).bindPopup(() => mk._pop(), { minWidth: 220, maxWidth: 360 })
          .on('popupclose', () => { mk._one = null; })
          .on('dragend', e => { const p = e.target.getLatLng(); ms.forEach(m => { m.r.geo = { lat: p.lat, lon: p.lng, key: (m.r.geo && m.r.geo.key) || '', manual: true, at: Date.now() }; m.r.u = Date.now(); geo.set(m.id, m.r.geo); }); persist(); redraw(); mirrorHere(l, ms.map(m => m.r)); ui.toast(ms.length > 1 ? `המיקום של ${ms.length} המוסדות עודכן` : 'המיקום של ' + label(ms[0].r).name + ' עודכן', 2500); });
        ms.forEach(m => pinOf.set(m.id, mk));
        pinDraws.push(() => mk.setIcon(iconFor(hlPin === mk)));
      }
      drawSidePins();
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
        return h('div', { class: 'wl-stop' + (done(r) ? ' done' : '') + (isCheck(r) ? ' check' : '') },
          rnumInput(l, id, () => { persist(); redraw(); }),
          h('div', { class: 'wl-stop-go', style: 'flex:1;min-width:0', role: 'button', tabindex: '0', title: 'הצג במפה', onclick: () => jumpTo(id), onkeydown: e => { if (e.key === 'Enter') jumpTo(id); } }, h('b', {}, lb.name), done(r) ? h('span', { class: 'wl-badge done', style: 'margin-inline-start:6px' }, '✓ הסתיים') : null, flagBadge(r, h),
            h('div', { class: 'muted small' }, lb.addr + (g ? (g.manual ? ' · מיקום שתיקנת' : g.approx ? ' · ' + approxTxt(g) : '') : geo.has(id) ? ' · לא נמצא במפה, לחץ 📍' : '')),
            nearOf(id).length ? h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, ...nearChips(id, 'chip wl-near')) : null),
          h('button', { class: 'icon-btn', title: 'למעלה', 'aria-label': 'הזז למעלה', disabled: k === 0 ? true : null, onclick: () => move(-1) }, '↑'),
          h('button', { class: 'icon-btn', title: 'למטה', 'aria-label': 'הזז למטה', disabled: k === vs.length - 1 ? true : null, onclick: () => move(1) }, '↓'),
          h('button', { class: 'icon-btn', title: 'תקן מיקום במפה', 'aria-label': 'תקן מיקום', onclick: () => fixLoc(r) }, '📍'),
          h('a', { class: 'btn', href: navUrl(r), target: '_blank', rel: 'noopener' }, 'וייז'),
          h('button', { class: 'icon-btn', title: 'לא קיים / לבדיקה', 'aria-label': 'סמן לא קיים או לבדיקה', onclick: () => flagIt(l, r) }, '⚑'),
          h('button', { class: 'icon-btn', title: 'הוצא מהמסלול', 'aria-label': 'הוצא מהמסלול', onclick: () => { l.route.splice(i, 1); persist(); redraw(); } }, '✕'));
      }));
      const out = live().filter(r => !idx.has(r.id) && !gone(r)), gn = live().filter(gone);
      outBox.replaceChildren(...(out.length ? [h('b', {}, `לא במסלול (${out.length})`), ...out.map(r => h('div', { class: 'wl-stop out' + (isCheck(r) ? ' check' : '') },
        h('div', { style: 'flex:1;min-width:0' }, label(r).name, done(r) ? ' ✓' : '', flagBadge(r, h), h('div', { class: 'muted small' }, label(r).addr)),
        h('button', { class: 'btn', onclick: async () => { l.route.push(r.id); persist(); await locateAll(); redraw(); } }, '➕ הוסף')))] : []),
        // (1.155) "לא קיים": לא במפה, אפשר להחזיר מכאן
        ...(gn.length ? [h('details', {}, h('summary', { class: 'small', style: 'cursor:pointer' }, `⛔ לא קיימים (${gn.length}), לא מוצגים במפה`),
          h('div', { class: 'stack', style: 'margin-top:8px' }, ...gn.map(r => h('div', { class: 'wl-stop out' },
            h('div', { style: 'flex:1;min-width:0' }, label(r).name, h('div', { class: 'muted small' }, label(r).addr)),
            h('button', { class: 'btn', onclick: () => flagIt(l, r) }, 'סטטוס ▾')))))] : []));
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
    const redraw = () => { drawList(); drawMap(); drawSide(); showGeoCount(); };
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
      showGeoCount();
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
      if (!navigator.geolocation || !window.Geo || !map) return;
      const Btn = L.Control.extend({ options: { position: 'topleft' }, onAdd: () => {
        const b = L.DomUtil.create('button', 'wl-mebtn');
        b.type = 'button'; b.title = 'המיקום שלי'; b.setAttribute('aria-label', 'המיקום שלי'); b.textContent = '◎';
        L.DomEvent.disableClickPropagation(b);
        b.onclick = () => { follow = true; if (me) map.setView([me.lat, me.lon], Math.max(map.getZoom(), 15)); else ui.toast('מחפש את המיקום שלך…', 2000); };
        return b;
      } });
      new Btn().addTo(map);
      // GPS משותף (js/geo.js): אם הוא כבר חם, הנקודה מופיעה מיד
      const onFix = f => {
        if (!f) return;
        me = { lat: f.lat, lon: f.lon };
        const ll = [me.lat, me.lon];
        if (!meDot) {
          meAcc = L.circle(ll, { radius: f.acc, color: '#1a73e8', weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
          meDot = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map).bindPopup('המיקום שלי');
        } else { meDot.setLatLng(ll); meAcc.setLatLng(ll).setRadius(f.acc); }
        if (follow) { map.panTo(ll); follow = false; }
      };
      const key = {};
      watch = Geo.on(onFix); Geo.hold(key);
      const f0 = Geo.last(60000); if (f0) onFix(f0);
      const stop = () => { if (watch != null) { watch(); Geo.release(key); } watch = null; window.removeEventListener('hashchange', stop); };
      window.addEventListener('hashchange', stop);
    }
    ui.app().replaceChildren(ui.bar({ title: 'מסלול נסיעה', sub: l.name }, back),
      h('main', { class: 'wl-route' },
        h('div', { class: 'wl-route-mapcol' }, mapEl,
          h('div', { class: 'row', style: 'gap:8px;align-items:center' },
            h('button', { class: 'btn small wl-route-docs', title: 'המסמכים של הרשימה (אישורי כניסה וכו\')', onclick: () => ListDocs.popup(l, back) }, `📁 מסמכים (${ListDocs.count(l)})`))),
        h('div', { class: 'stack' },
          h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:center' },
            h('button', { class: 'btn primary', onclick: ev => { ev.currentTarget.disabled = true; auto().finally(() => { ev.target.disabled = false; }); } }, '⚡ סדר אוטומטי (הכי מהר בכבישים)'),
            h('label', { class: 'row small', style: 'gap:6px;align-items:center' }, 'התחלה:', startSel), startWrap, startPick),
          geoCount,
          sideCtl,
          dayBox, linksBox, status, listBox,
          h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
            h('button', { class: 'btn', onclick: async () => { await DB.setKV('wlView:' + l.id, { sort: { col: '_route', dir: 1 }, filt: {} }); ui.go(back); } }, 'מיין את הטבלה לפי המסלול'),
            h('button', { class: 'btn', onclick: async () => { l.route = live().filter(r => !done(r) && !gone(r)).map(r => r.id); persist(); await locateAll(); redraw(); } }, 'כל מה שלא הסתיים')),
          outBox, sideBox)));
    drawDays();
    drawSideCtl();
    drawList();
    try {
      await ui.leaflet();
      map = L.map(mapEl, { zoomControl: true }).setView([32.3, 35.0], 8);
      map.on('dragstart', () => { userMoved = true; });
      map.on('zoomend', () => { const z = map.getZoom(), b = z >= 17 ? 2 : z >= 15 ? 1 : 0; if (b !== zoomBand) { zoomBand = b; pinDraws.forEach(f => f()); } });
      map.on('popupclose', () => { if (hlPin) { hlPin = null; pinDraws.forEach(f => f()); } });
      map.on('click', e => { if (!pickLoc) return; const f = pickLoc; pickLoc = null; mapEl.classList.remove('picking'); userMoved = true; f(e.latlng); }); mapEl.addEventListener('wheel', () => { userMoved = true; }, { passive: true });
      const g = ui.mapLayers()['גוגל – מפה'];
      L.tileLayer(g[0], g[1]).addTo(map);
      // (1.142) חיפוש חופשי + חניות חינם (js/mapextras.js)
      if (root.MapExtras) extras = root.MapExtras.attach(map, { ui, search: searchAll, onMoved: () => { userMoved = true; } });
      showMe();
    } catch (e) { mapEl.replaceChildren(h('div', { class: 'muted small', style: 'padding:16px' }, 'המפה לא נטענה: ' + e.message)); }
    for (const S of SIDES) for (const r of rowsOf(S)) if (r.geo) S.geo.set(r.id, r.geo);
    if (navigator.onLine === false) { status.textContent = 'אין קליטה: אי אפשר לאתר כתובות במפה'; for (const id of l.route) { const r = l.rows.find(x => x.id === id); if (r && r.geo) geo.set(id, r.geo); } redraw(); return; }
    for (const id of l.route) { const r = l.rows.find(x => x.id === id); if (r && r.geo) geo.set(id, r.geo); }
    redraw();
    if (l.start.mode === 'addr' && l.start.addr && !(l.start.geo && l.start.geo.key === l.start.addr)) startPoint().then(g => { if (g) redraw(); });
    let lastS = 0;
    for (const S of SIDES) {
      const sj = geoJob(S.L, local, true);
      const onS = (r, g) => { if (!document.body.contains(status)) { sj.subs.delete(onS); return; } if (r) S.geo.set(r.id, g || null); showGeoCount(); if (!r || Date.now() - lastS > 2500) { lastS = Date.now(); redraw(); } };
      sj.subs.add(onS);
    }
    if (SIDES.length) redraw();
    locateAll().then(() => { showStatus(); redraw(); if (job && job.err) status.textContent += ' · שגיאה באיתור: ' + job.err; if (extras) extras.prefetch([...geo.values()]); });
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

  root.WorkLists = { render, sync,
    // (1.155) מתוך מסך הסקר: שיוך לרשימות/תיקייה, וסימון המוסד ברשימה
    assign: (s, after) => assignDialog(s, after),
    // (1.155.1) הצעת שכונה לסקר: מהשורה ברשימה, ואם אין לפי סמל המוסד או הכתובת ברשימות שהשכונה דולקת בהן
    suggestHood: async s => {
      if (!s || Construction.isConstruction(s)) return null;
      const lists = await live();
      const rows = lists.flatMap(L => L.rows.filter(r => !r.deleted && r.sid === s.id).map(r => ({ L, r })));
      if (s.listRef) { const L = lists.find(x => x.id === s.listRef.list), r = L && L.rows.find(x => x.id === s.listRef.row); if (r) rows.unshift({ L, r }); }
      for (const { L, r } of rows) if (hoodOn(L)) { const hh = await hoodOfRow(L, r); if (hh) return { hood: hh, src: `הרשימה "${L.name || 'רשימה'}"`, auto: true }; }
      const codes = Core.codesOf(s.code || '').map(c => c.replace(/\D+/g, '')).filter(c => c.length >= 3);
      const st = norm(s.street).split(' ').filter(Boolean).sort().join(' ');
      const m = hoodMatch(codes, st && /\d/.test(st) ? st + '|' + norm(s.city) : '', await hoodIndex(null));
      if (m.h) return { hood: m.h, src: m.by + ' ברשימות', auto: false };
      return null;
    },
    flagRow: async (lid, rid, after) => { const L = await byId(lid), r = L && L.rows.find(x => x.id === rid && !x.deleted); if (!r) { U().toast('השורה לא נמצאה ברשימה', 3000); return; } flagDialog(L, r, after); },
    _t: { mirrorGeo, mirrorCell, mirrorGeoAll, peersOf, kabatFirst, kabatKey, kabatOn, kabatOfRow, kabatSpell, kabatToSurveys, colPlan, ensureHood, hoodIndex, hoodLookup, hoodMatch, addrKey, codeKeys, setFlag, searchAll, geoStreet, streetWords, bestOrder, norm, streetKey, scoreOf, guessHeader, buildFromRaw, valuesOf, mergeList, parseCsv } };
})(window);

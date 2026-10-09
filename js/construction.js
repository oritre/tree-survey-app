// סקר עצים להיתר בנייה: אותן נוסחאות כמו בתבנית "סקר עצים להיתר בניה" (גיליון סקר + הגדרות בגיליון חד גזעי),
// ומילוי התבנית עצמה (template/construction.xltm) לקובץ אקסל. סטטוס מוצע (BC) ממולא ידנית באקסל אחר כך.
(function (root) {
  'use strict';
  const TYPES = { safety: 'סקר יציבות עצים', construction: 'סקר עצים לבנייה' };
  const typeOf = s => (s && s.type) || 'safety';
  const isConstruction = s => typeOf(s) === 'construction';
  const D = root.ConstructionData;

  // ---------- טבלאות מהתבנית ----------
  const SPECIES = new Map(D.SPECIES.map(([name, r, s, v]) => [name, { r, s, v }]));
  // שם כפי שנכתב בטאבלט -> השם המדויק ברשימה. ברשימה יש שמות עם רווח בסוף ושמות עם רווח קשיח (NBSP),
  // והאקסל משווה בדיוק, ולכן תמיד נשמר השם כמו שהוא ברשימה
  const clean = v => String(v || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');
  const key = v => clean(v).replace(/[\u00a0\s]+/g, ' ').trim().toLowerCase();
  const byKey = new Map(D.SPECIES.map(([name]) => [key(name), name]));
  const canonSpecies = name => { const n = clean(name); return SPECIES.has(n) ? n : (byKey.get(key(n)) || n.replace(/\u00a0/g, ' ')); };
  const ALWAYS_EXEMPT = new Set(D.ALWAYS_EXEMPT);
  const PALMS = new Map(Object.entries(D.PALMS));
  const COLUMNAR = new Set(D.COLUMNAR);
  const OLIVE_CAROB = ['זית אירופי', 'חרוב מצוי'];

  // ---------- הגדרות הסקר ('חד גזעי'!AM2:AM7, AN7) ----------
  const SETTINGS = [
    { key: 'repl10', cell: 'AM2', def: false, label: 'ערך חליפי מ-10 ס"מ', help: 'כן: שווי לעצים שגזע 1 שלהם 10 ס"מ ומעלה. לא: רק מ-20 ס"מ.' },
    { key: 'root4', cell: 'AM3', def: true, label: "אזור שורשים עד 4 מ'", help: "אזור השורשים המוגן לא עולה על 4 מ'." },
    { key: 'columnar', cell: 'AM4', def: false, label: 'אזור שורשים מוגן מיוחד לעצים צריפיים', help: 'לעצים צריפיים (ברושים, ארזים וכו\'): חצי מגובה העץ במקום לפי הקוטר.' },
    { key: 'resExempt', cell: 'AM5', def: true, label: 'פטור מרישיון בתכנית בייעוד מגורים', help: 'דקלים מהרשימה מקבלים סך ערך 0 (פטורים).' },
    { key: 'openArea', cell: 'AM6', def: false, label: 'אזור שורשים מוגן בשטח פתוח', help: 'אזור השורשים 15% מקוטר הגזע במקום 10%.' },
    { key: 'oliveCarob', cell: 'AM7', def: false, label: 'זית וחרוב בכל קוטר', help: 'זית אירופי וחרוב מצוי מקבלים שווי מהקוטר שנקבע כאן.' },
  ];
  const settingsOf = s => {
    const st = Object.assign({}, ...SETTINGS.map(x => ({ [x.key]: x.def })), { oliveDiam: '', embedPhotos: true }, (s && s.cset) || {});
    return st;
  };

  // ---------- שדות לכל עץ ----------
  // מה שממלאים בשטח (העמודה בגיליון סקר בסוגריים). כל השאר מחושב
  const MEASURES = [['qty', 'כמות עצים', 'D'], ['height', "גובה עץ (מ')", 'E'], ['f1', 'גזע 1 (ס"מ)', 'F'], ['f2', 'גזע 2', 'G'], ['f3', 'גזע 3', 'H']];
  const SCORES = [['health', 'מצב בריאותי', 'J'], ['loc', 'מקום העץ', 'K'], ['canopy', 'חופת העץ', 'M']];
  // היתכנות העתקה (Q): רק אחד מאלה, ברירת מחדל ריק
  const TRANSPLANT = ['נמוכה', 'בינונית', 'גבוהה', '-'];
  const transplantOf = t => TRANSPLANT.includes(t.transplant) ? t.transplant : '';
  const FIELDS = MEASURES.map(m => m[0]).concat(SCORES.map(s => s[0]), ['transplant']);

  const num = v => (v == null || v === '' || isNaN(+v)) ? null : Number(v);
  const z = v => num(v) || 0; // תא ריק באקסל = 0
  const area = d => 3.14 * (d / 2) * (d / 2);

  function category(n) {
    if (n == null) return '';
    return n > 16 ? 'גבוה מאוד' : n > 13 ? 'גבוה' : n > 6 ? 'בינונית' : 'נמוכה';
  }

  // חישוב שורה, נוסחה אחר נוסחה כמו בגיליון "סקר" (BC = סטטוס מוצע ריק, כי ממלאים אותו אחר כך)
  function compute(t, st) {
    st = st || settingsOf(null);
    const name = canonSpecies(t.species);
    const sp = SPECIES.get(name);
    const qty = z(t.qty), E = z(t.height), F = z(t.f1), G = z(t.f2), H = z(t.f3);
    const J = z(t.health), K = z(t.loc), M = z(t.canopy);
    const I = F + G / 2 + H / 2;                                     // קוטר גזע
    const L = sp ? sp.v : null;                                      // ערך מין 0-5
    let N;                                                           // סך ערך 0-20
    if (ALWAYS_EXEMPT.has(name)) N = 0;
    else if (st.resExempt && PALMS.has(name)) N = 0;
    else N = L == null ? null : J + K + L + M;
    // שווי: עץ רגיל לפי שטח הגזעים, דקל לפי הגובה
    const AG = sp ? (st.resExempt ? sp.s : sp.r) : null;
    const AF = AG == null ? null : (area(F) + area(G) + area(H)) * AG * (J * 0.2) * (K * 0.2) * 20;
    const pv = PALMS.has(name) ? PALMS.get(name) : null;
    const V = pv != null ? pv * E * (J * 0.2) * (0.2 * K) * 1500 : AF;
    const W = V == null ? null : (qty === 0 ? V : qty * V);
    const Zv = st.oliveCarob && OLIVE_CAROB.includes(name) && z(st.oliveDiam) <= F ? W : 0;
    let P;                                                           // שווי עץ (₪)
    if (E < 2) P = 0;
    else if (Zv > 0) P = Zv;
    else if (N == null) P = null;
    else if (N === 0) P = 0;
    else if (!st.repl10) P = F > 19 ? W : 0;
    else P = F > 9 ? W : 0;
    // אזור שורשים מוגן: כשאין שווי, רק לעץ בסטטוס שימור (נקבע באקסל), ולכן כאן 0
    const fac = st.openArea ? 0.15 : 0.1;
    let T;
    if (P == null) T = null;
    else if (P === 0) T = 0;
    else if (st.columnar) T = COLUMNAR.has(name) ? E * 0.5 : I * fac;
    else T = J === 0 ? 0 : I * fac;
    const O = T == null ? null : st.root4 ? Math.min(T, 4) : T;
    return { name, known: !!sp, I, L, N, O, P, palm: PALMS.has(name), exempt: ALWAYS_EXEMPT.has(name), columnar: COLUMNAR.has(name), cat: category(N) };
  }

  function warnings(s) {
    const w = [];
    const trees = s.trees.filter(Core.hasContent);
    if (trees.length > TREE_ROWS.length) w.push(`יש ${trees.length} עצים, ובתבנית יש מקום ל-${TREE_ROWS.length} בלבד.`);
    const covered = coveredNums(trees);
    for (const t of Core.sortTrees(trees)) {
      const name = 'עץ ' + (t.num || t.species);
      // מין ריק מותר (התא נשאר ריק באקסל)
      if ((t.species || '').trim() && !SPECIES.has(canonSpecies(t.species))) w.push(`${name}: "${t.species}" לא ברשימת המינים של התבנית, ולכן אין ערך מין ושווי.`);
      if (num(t.height) == null) w.push(`${name}: אין גובה.`);
      if (num(t.f1) == null) w.push(`${name}: אין קוטר גזע 1.`);
      const miss = SCORES.filter(([k]) => num(t[k]) == null).map(x => x[1]);
      if (miss.length) w.push(`${name}: חסר ניקוד ${miss.join(', ')}.`);
      if (!(t.photos || []).length && !covered.has(Core.firstNum(t.num))) w.push(`${name}: אין תמונה.`);
      if (t.lat == null) w.push(`${name}: אין נ"צ.`);
    }
    return w;
  }

  // ---------- מילוי התבנית ----------
  // שורות העצים בגיליון סקר: עמוד 1 שורות 11-35, ואז 18 עמודים של 32 עצים (53-84, 99-130, ...)
  const TREE_ROWS = [];
  for (let r = 11; r <= 35; r++) TREE_ROWS.push(r);
  for (let k = 0; k < 18; k++) for (let r = 53 + 46 * k; r <= 84 + 46 * k; r++) TREE_ROWS.push(r);
  // עמוד נוסף k (0..17) תופס את השורות 45+46k עד 90+46k, מוסתרות בתבנית
  const pagesFor = n => Math.min(18, Math.max(0, Math.ceil((n - 25) / 32)));

  // ---------- נספח תמונות (עמודות BF:BK) ----------
  // בכל עמוד 2 שורות של 6 משבצות. לכל משבצת: תווית (מספר העץ), תא תמונה ממוזג, ושרשרת נוסחאות
  // (מספר -> נתיב Pictures -> העתק) שהמאקרו ReplacePathWithImage הופך לתמונה במחשב
  const PHOTO_COLS = ['BF', 'BG', 'BH', 'BI', 'BJ', 'BK'];
  const PHOTO_ROWS = [{ label: 4, img: 8, chain: [5, 6, 7] }, { label: 23, img: 24, chain: [41, 42, 43] }];
  for (let k = 0; k < 18; k++) {
    const b = 46 * k;
    PHOTO_ROWS.push({ label: 50 + b, img: 51 + b, chain: [46 + b, 47 + b, 48 + b] }, { label: 68 + b, img: 69 + b, chain: [86 + b, 87 + b, 88 + b] });
  }
  const SLOT_CELLS = PHOTO_ROWS.flatMap(r => PHOTO_COLS.map(c => ({ label: c + r.label, img: c + r.img, chain: r.chain.map(x => c + x) })));
  // תמונות שסומנו לדוח, לפי סדר העצים (כמו בסקר יציבות: פצל = משבצת לכל מספר בטווח)
  function photoSlots(trees) {
    const slots = [];
    for (const t of Core.sortTrees(trees).filter(Core.hasContent).slice(0, TREE_ROWS.length)) {
      const photos = (t.photos || []).filter(p => p.inReport);
      if (Core.splitActive(t)) {
        for (const n of Core.expandNum(t.num)) for (const p of photos.filter(x => x.sub === n)) slots.push({ tree: t, sub: n, label: String(n), photo: p });
      } else {
        // תמונה אחת לכמה עצים: "עצים בתמונה" (למשל 7-9) היא התווית בנספח
        for (const p of photos) slots.push({ tree: t, sub: null, label: String((p.trees || '').trim() || t.num || t.species || ''), photo: p });
      }
    }
    return slots.slice(0, SLOT_CELLS.length).map((x, i) => Object.assign(x, { index: i + 1 }));
  }
  // שם קובץ התמונה כמו בנוסחה של התבנית: מה שלפני "--" או ",", אחרת כל התווית (7-9 -> 7-9.jpg)
  const pictureName = label => { const l = String(label || ''); return l.includes('--') ? l.split('--')[0] : l.includes(',') ? l.split(',')[0] : l; };
  // מספרי עצים שמופיעים בתמונה של עץ אחר ("עצים בתמונה")
  function coveredNums(trees) {
    const set = new Set();
    for (const t of trees) for (const p of t.photos || []) if (p.inReport && (p.trees || '').trim()) for (const n of Core.expandNum(p.trees) || []) set.add(n);
    return set;
  }
  // דף התבנית שמכיל את משבצת i (0 = עמוד ראשון), כדי לפתוח את השורות המוסתרות
  const photoPagesFor = n => n <= 12 ? 0 : Math.min(18, Math.ceil((n - 12) / 12));

  // תמונות בתוך התא: בתבנית כבר יש 2 ערכי rich (שגיאות של FILTER), מוסיפים אחריהם
  const RD = 'http://schemas.microsoft.com/office/spreadsheetml/2017/richdata';
  async function addCellImages(zip, images) {
    if (!images.length) return;
    const base = 2, n = images.length;
    images.forEach((b, i) => zip.file(`xl/media/survey_photo_${i + 1}.jpg`, b));
    let rv = await zip.file('xl/richData/rdrichvalue.xml').async('string');
    const baseCount = +/count="(\d+)"/.exec(rv)[1];
    if (baseCount !== base) throw new Error('מבנה התבנית השתנה (richData)');
    rv = rv.replace(/count="\d+"/, `count="${base + n}"`).replace('</rvData>', images.map((_, i) => `<rv s="2"><v>${i}</v><v>5</v></rv>`).join('') + '</rvData>');
    zip.file('xl/richData/rdrichvalue.xml', rv);
    let st = await zip.file('xl/richData/rdrichvaluestructure.xml').async('string');
    st = st.replace(/count="\d+"/, 'count="3"').replace('</rvStructures>', '<s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>');
    zip.file('xl/richData/rdrichvaluestructure.xml', st);
    let md = await zip.file('xl/metadata.xml').async('string');
    md = md.replace(/<futureMetadata name="XLRICHVALUE" count="\d+">([\s\S]*?)<\/futureMetadata>/, (m, inner) => `<futureMetadata name="XLRICHVALUE" count="${base + n}">` + inner +
      images.map((_, i) => `<bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="${base + i}"/></ext></extLst></bk>`).join('') + '</futureMetadata>');
    md = md.replace(/<valueMetadata count="\d+">([\s\S]*?)<\/valueMetadata>/, (m, inner) => `<valueMetadata count="${base + n}">` + inner +
      images.map((_, i) => `<bk><rc t="2" v="${base + i}"/></bk>`).join('') + '</valueMetadata>');
    zip.file('xl/metadata.xml', md);
    zip.file('xl/richData/richValueRel.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      images.map((_, i) => `<rel r:id="rId${i + 1}"/>`).join('') + '</richValueRels>');
    zip.file('xl/richData/_rels/richValueRel.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      images.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/survey_photo_${i + 1}.jpg"/>`).join('') + '</Relationships>');
    let rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    rels = rels.replace('</Relationships>', '<Relationship Id="rIdRvr" Type="http://schemas.microsoft.com/office/2022/10/relationships/richValueRel" Target="richData/richValueRel.xml"/></Relationships>');
    zip.file('xl/_rels/workbook.xml.rels', rels);
    let ct = await zip.file('[Content_Types].xml').async('string');
    if (!/Extension="jpg"/i.test(ct)) ct = ct.replace('<Default Extension="png"', '<Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png"');
    ct = ct.replace('</Types>', '<Override PartName="/xl/richData/richValueRel.xml" ContentType="application/vnd.ms-excel.richvaluerel+xml"/></Types>');
    zip.file('[Content_Types].xml', ct);
  }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colNum = l => { let n = 0; for (const ch of l) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };

  // גיליון גדול (3.5MB): מפרקים פעם אחת לשורות ועורכים כל שורה לבד
  class RowSheet {
    constructor(xml) {
      const a = xml.indexOf('<sheetData>') + '<sheetData>'.length, b = xml.indexOf('</sheetData>');
      this.head = xml.slice(0, a); this.tail = xml.slice(b);
      this.rows = xml.slice(a, b).match(/<row [^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || [];
      this.idx = new Map(this.rows.map((x, i) => [+/ r="(\d+)"/.exec(x)[1], i]));
    }
    row(r) {
      const i = this.idx.get(r);
      if (i == null) throw new Error('row ' + r + ' missing');
      if (this.rows[i].endsWith('/>')) this.rows[i] = this.rows[i].slice(0, -2) + '></row>';
      return i;
    }
    // fn(style, oldCellXml) -> תא חדש
    edit(ref, fn) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      const i = this.row(+m[2]);
      const row = this.rows[i];
      const cm = new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)').exec(row);
      if (cm) {
        const s = /\ss="(\d+)"/.exec(cm[1]);
        this.rows[i] = row.replace(cm[0], fn(s ? s[1] : null, cm[2] || '', cm[0]));
      } else {
        const target = colNum(m[1]);
        const after = [...row.matchAll(/<c r="([A-Z]+)\d+"/g)].find(c => colNum(c[1]) > target);
        const xml = fn(null, '', '');
        this.rows[i] = after ? row.slice(0, after.index) + xml + row.slice(after.index) : row.replace('</row>', xml + '</row>');
      }
    }
    set(ref, v) {
      this.edit(ref, s => {
        const st = s ? ` s="${s}"` : '';
        if (v == null || v === '') return `<c r="${ref}"${st}/>`;
        if (typeof v === 'number') return `<c r="${ref}"${st}><v>${v}</v></c>`;
        return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      });
    }
    // ערך מחושב שמור לתא נוסחה (אקסל מחשב שוב בפתיחה; זה למציגים שלא מחשבים)
    cached(ref, v) {
      this.edit(ref, (s, inner, whole) => {
        const f = (/<f[\s\S]*?(?:\/>|<\/f>)/.exec(inner) || [''])[0];
        if (!f) return whole;
        const st = s ? ` s="${s}"` : '';
        if (v == null) return `<c r="${ref}"${st} t="e">${f}<v>#N/A</v></c>`;
        if (typeof v === 'number') return `<c r="${ref}"${st}>${f}<v>${v}</v></c>`;
        return `<c r="${ref}"${st} t="str">${f}<v>${esc(v)}</v></c>`;
      });
    }
    unhide(r) {
      const i = this.idx.get(r);
      if (i != null) this.rows[i] = this.rows[i].replace(/^(<row [^>]*?) hidden="1"/, '$1');
    }
    toXml() { return this.head + this.rows.join('') + this.tail; }
  }

  const numOrText = v => { const s = String(v == null ? '' : v).trim(); return s === '' ? null : /^\d+(\.\d+)?$/.test(s) ? Number(s) : s; };
  function dateSerial(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  }

  // getPhoto(id) -> Blob של התמונה (או null)
  async function buildWorkbook(templateBytes, survey, getPhoto) {
    const zip = await JSZip.loadAsync(templateBytes);
    const st = settingsOf(survey);
    const sheet = new RowSheet(await zip.file('xl/worksheets/sheet1.xml').async('string'));   // סקר
    const params = new RowSheet(await zip.file('xl/worksheets/sheet4.xml').async('string'));  // חד גזעי

    // כותרת: B3 גוש וחלקה, B7 כתובת, Q1 תאריך קבוע (בתבנית NOW() שמתעדכן)
    const gh = [survey.gush ? 'גוש ' + survey.gush : '', survey.helka ? 'חלקה ' + survey.helka : ''].filter(Boolean).join(' ');
    sheet.set('B3', gh || null);
    sheet.set('B7', survey.site || null);
    if (survey.date) sheet.set('Q1', dateSerial(survey.date));

    // הגדרות הסקר
    for (const x of SETTINGS) params.set(x.cell, st[x.key] ? 'כן' : 'לא');
    params.set('AN7', num(st.oliveDiam));

    // עצים
    const trees = Core.sortTrees(survey.trees).filter(Core.hasContent).slice(0, TREE_ROWS.length);
    trees.forEach((t, i) => {
      const r = TREE_ROWS[i];
      const c = compute(t, st);
      sheet.set('B' + r, numOrText(t.num));
      sheet.set('C' + r, c.name.trim() ? c.name : null);
      for (const [k, , col] of MEASURES) sheet.set(col + r, num(t[k]));
      for (const [k, , col] of SCORES) sheet.set(col + r, num(t[k]));
      sheet.set('Q' + r, transplantOf(t) || null);
      sheet.set('R' + r, (t.notes || '').trim() || null);
      sheet.cached('I' + r, c.I); sheet.cached('L' + r, c.L); sheet.cached('N' + r, c.N);
      sheet.cached('O' + r, c.O); sheet.cached('P' + r, c.P);
    });
    // נספח תמונות: תוויות לפי מספר העץ. עם "צרף תמונות" התמונות עצמן נכנסות לתאים,
    // ובלי — נשארות נוסחאות הנתיב של התבנית (C:\\Users\\origr\\Pictures\\<מספר>.jpg) למאקרו במחשב
    const slots = photoSlots(survey.trees);
    const images = [];
    if (st.embedPhotos) for (const c of SLOT_CELLS) { for (const x of c.chain) sheet.set(x, null); sheet.set(c.img, null); }
    for (const slot of slots) {
      const c = SLOT_CELLS[slot.index - 1];
      sheet.set(c.label, numOrText(slot.label));
      if (!st.embedPhotos || !getPhoto) continue;
      const blob = await getPhoto(slot.photo.id);
      if (!blob) continue;
      images.push(blob);
      const vm = 2 + images.length;
      sheet.edit(c.img, s => `<c r="${c.img}"${s ? ` s="${s}"` : ''} t="e" vm="${vm}"><v>#VALUE!</v></c>`);
    }
    await addCellImages(zip, images);
    const pages = Math.max(pagesFor(trees.length), photoPagesFor(slots.length));
    if (pages) for (let r = 45; r <= 90 + 46 * (pages - 1); r++) sheet.unhide(r);

    zip.file('xl/worksheets/sheet1.xml', sheet.toXml());
    zip.file('xl/worksheets/sheet4.xml', params.toXml());
    // חישוב מלא בפתיחה
    let wb = await zip.file('xl/workbook.xml').async('string');
    wb = wb.replace(/<calcPr([^>]*?)\s*\/>/, (m, a) => `<calcPr${a.replace(/\sfullCalcOnLoad="\d"/, '')} fullCalcOnLoad="1"/>`);
    zip.file('xl/workbook.xml', wb);
    let ct = await zip.file('[Content_Types].xml').async('string');
    ct = ct.replace('application/vnd.ms-excel.template.macroEnabled.main+xml', 'application/vnd.ms-excel.sheet.macroEnabled.main+xml');
    zip.file('[Content_Types].xml', ct);
    for (const [p, f] of Object.entries(zip.files)) if (f.dir) delete zip.files[p];
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12' });
  }

  root.Construction = {
    TYPES, typeOf, TRANSPLANT, transplantOf, isConstruction, SETTINGS, settingsOf, MEASURES, SCORES, FIELDS, SPECIES, canonSpecies,
    compute, category, warnings, buildWorkbook, TREE_ROWS, pagesFor, photoSlots, SLOT_CELLS, pictureName, coveredNums,
  };
})(this);

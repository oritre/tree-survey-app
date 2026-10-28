// ייבוא סקרי בטיחות עצים ישנים מקובצי אקסל (התבנית "סקר בטיחות עצים", מהתוכנה במחשב או מהאפליקציה),
// כדי שאפשר יהיה לפתוח אותם באפליקציה ולהתחיל מהם סקר חדש בשנה הבאה
(function (root) {
  'use strict';
  const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const clean = v => String(v == null ? '' : v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

  function colNum(ref) { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
  function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

  async function xml(zip, path) {
    const f = zip.file(path);
    return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null;
  }
  const textOf = el => [...el.getElementsByTagNameNS(MAIN, 't')].map(t => t.textContent).join('');

  // כל הגיליונות: [{name, cells: Map('A1' -> ערך)}]
  async function readSheets(zip) {
    const ssDoc = await xml(zip, 'xl/sharedStrings.xml');
    const ss = ssDoc ? [...ssDoc.getElementsByTagNameNS(MAIN, 'si')].map(textOf) : [];
    const wb = await xml(zip, 'xl/workbook.xml');
    const rels = await xml(zip, 'xl/_rels/workbook.xml.rels');
    if (!wb || !rels) return [];
    const target = {};
    for (const r of rels.getElementsByTagName('Relationship')) target[r.getAttribute('Id')] = r.getAttribute('Target');
    const out = [];
    for (const sh of wb.getElementsByTagNameNS(MAIN, 'sheet')) {
      const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let t = target[rid]; if (!t) continue;
      t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
      const doc = await xml(zip, t);
      if (!doc) continue;
      const cells = new Map(), vms = new Map();
      for (const c of doc.getElementsByTagNameNS(MAIN, 'c')) {
        const type = c.getAttribute('t');
        if (c.getAttribute('vm')) vms.set(c.getAttribute('r'), +c.getAttribute('vm'));
        const v = c.getElementsByTagNameNS(MAIN, 'v')[0];
        let val;
        if (type === 's') val = v ? ss[+v.textContent] : '';
        else if (type === 'inlineStr') val = textOf(c);
        else if (type === 'str' || type === 'e') val = v ? v.textContent : '';
        else if (type === 'b') val = v ? v.textContent === '1' : '';
        else val = v ? +v.textContent : '';
        if (val !== '' && val != null) cells.set(c.getAttribute('r'), val);
      }
      out.push({ name: sh.getAttribute('name'), cells, vms, path: t, doc });
    }
    return out;
  }

  function serialToIso(n) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  function toIsoDate(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) return serialToIso(v);
    const m = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(clean(v));
    if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    return '';
  }
  const numText = v => typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : clean(v);
  const isTreeNum = s => /^[\d\s,\-–]+$/.test(s) && /\d/.test(s);

  const HEAD_NUM = /^מספר( ה?עץ)?$/, HEAD_SP = /^מין\s*ה?עץ$/;
  const TITLE = /סקר\s*(בטיחות|יציבות)\s*(ה)?עצים/;

  // ---------- תמונות מתוך קובץ האקסל ----------
  // נתיב יחסי בקובץ (../media/x.jpeg) -> נתיב מלא בתוך ה-zip
  const resolve = (base, target) => {
    if (target.startsWith('/')) return target.slice(1);
    const parts = base.split('/'); parts.pop();
    for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
    return parts.join('/');
  };
  async function relsOf(zip, path) {
    const i = path.lastIndexOf('/');
    const doc = await xml(zip, path.slice(0, i) + '/_rels/' + path.slice(i + 1) + '.rels');
    const out = {};
    if (doc) for (const r of doc.getElementsByTagName('Relationship')) out[r.getAttribute('Id')] = resolve(path, r.getAttribute('Target'));
    return out;
  }
  // תמונות העצים: בדרך כלל jpg, לפעמים png/jfif. לוגו וחותמת (png/tiff) נמצאים מחוץ לנספח ומסוננים לפי העמודה
  const PHOTO_EXT = /\.(jpe?g|jfif|png|gif|webp|bmp)$/i;
  // כל התמונות בגיליון: [{col, row, path}] — תמונות בתוך תא (Excel 365) ותמונות צפות (עוגן לפי התא העליון-ימני)
  async function sheetImages(zip, sh) {
    const out = [];
    if (sh.vms.size) {
      const meta = await xml(zip, 'xl/metadata.xml');
      const rv = await xml(zip, 'xl/richData/rdrichvalue.xml');
      const rel = await xml(zip, 'xl/richData/richValueRel.xml');
      const struct = await xml(zip, 'xl/richData/rdrichvaluestructure.xml');
      if (meta && rv && rel) {
        const fut = [...meta.getElementsByTagName('futureMetadata')].find(f => f.getAttribute('name') === 'XLRICHVALUE');
        const rvbs = fut ? [...fut.getElementsByTagName('bk')].map(b => { const x = b.getElementsByTagName('*'); const r = [...x].find(e => e.localName === 'rvb'); return r ? +r.getAttribute('i') : -1; }) : [];
        const vmeta = [...meta.getElementsByTagName('valueMetadata')][0];
        const vbk = vmeta ? [...vmeta.getElementsByTagName('bk')].map(b => { const rc = b.getElementsByTagName('rc')[0]; return rc ? +rc.getAttribute('v') : -1; }) : [];
        // מיקום המפתח של התמונה בכל מבנה (בדרך כלל הראשון)
        const keyPos = struct ? [...struct.getElementsByTagName('s')].map(st => Math.max(0, [...st.getElementsByTagName('k')].findIndex(k => /LocalImageIdentifier/.test(k.getAttribute('n'))))) : [];
        const rvs = [...rv.getElementsByTagName('rv')].map(r => { const v = [...r.getElementsByTagName('v')]; const kp = keyPos[+r.getAttribute('s')] || 0; return v[kp] ? +v[kp].textContent : -1; });
        const rels = await relsOf(zip, 'xl/richData/richValueRel.xml');
        const relIds = [...rel.getElementsByTagName('*')].filter(e => e.localName === 'rel').map(e => e.getAttribute('r:id') || e.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
        for (const [ref, vm] of sh.vms) {
          const fi = vbk[vm - 1]; const ri = fi >= 0 ? rvbs[fi] : -1; const li = ri >= 0 ? rvs[ri] : -1;
          const path = li >= 0 ? rels[relIds[li]] : null;
          if (path) out.push({ col: colNum(ref), row: +ref.replace(/\D+/g, ''), path });
        }
      }
    }
    const srels = await relsOf(zip, sh.path);
    const XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
    const colW = colWidths(sh.doc);
    const num = (el, tag) => { const e = el && el.getElementsByTagNameNS(XDR, tag)[0]; return e ? +e.textContent : 0; };
    for (const d of sh.doc.getElementsByTagNameNS(MAIN, 'drawing')) {
      const dpath = srels[d.getAttribute('r:id') || d.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')];
      const ddoc = dpath && await xml(zip, dpath);
      if (!ddoc) continue;
      const drels = await relsOf(zip, dpath);
      for (const a of [...ddoc.getElementsByTagNameNS(XDR, 'twoCellAnchor'), ...ddoc.getElementsByTagNameNS(XDR, 'oneCellAnchor')]) {
        const from = a.getElementsByTagNameNS(XDR, 'from')[0], to = a.getElementsByTagNameNS(XDR, 'to')[0];
        const blip = [...a.getElementsByTagName('*')].find(e => e.localName === 'blip');
        if (!from || !blip) continue;
        const id = blip.getAttribute('r:embed') || blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
        const path = drels[id];
        if (!path || !PHOTO_EXT.test(path)) continue;
        // תמונה צפה שהוזזה קצת ונגעה בעמודה הסמוכה: העמודה שבה רוב התמונה (ולא העמודה שבה היא מתחילה)
        let col = num(from, 'col') + 1;
        const c2 = to ? num(to, 'col') + 1 : 0;
        if (c2 > col) {
          let best = colW(col) - num(from, 'colOff'), bestCol = col;
          for (let c = col + 1; c < c2; c++) if (colW(c) > best) { best = colW(c); bestCol = c; }
          if (num(to, 'colOff') > best) bestCol = c2;
          col = bestCol;
        }
        out.push({ col, row: num(from, 'row') + 1, path, floating: true });
      }
    }
    return out;
  }
  // רוחב כל עמודה ב-EMU (לפי <cols> בגיליון), כדי לדעת באיזו עמודה נמצאת רוב התמונה
  function colWidths(doc) {
    const fmt = doc.getElementsByTagNameNS(MAIN, 'sheetFormatPr')[0];
    const chars = fmt && fmt.getAttribute('defaultColWidth') ? +fmt.getAttribute('defaultColWidth') : (fmt && fmt.getAttribute('baseColWidth') ? +fmt.getAttribute('baseColWidth') + 0.71 : 8.43);
    const emu = w => Math.round(w * 7 + 5) * 9525;
    const ranges = [...doc.getElementsByTagNameNS(MAIN, 'col')].map(c => [+c.getAttribute('min'), +c.getAttribute('max'), +c.getAttribute('width') || chars]);
    return c => { const r = ranges.find(([a, b]) => c >= a && c <= b); return emu(r ? r[2] : chars); };
  }
  // לכל תמונה: העץ לפי התווית שמעליה באותה עמודה (מספר העץ, או המין בעץ בלי מספר).
  // התבניות שונות בין השנים (התווית של העמוד השני בשורה 29, 32 וכו'), אז מחפשים את התווית מעל כל תמונה ולא לפי שורות קבועות:
  // עולים מהתמונה ומדלגים על תאים ריקים, על תאי התמונות (#VALUE!), על נתיבי C:\...\Pictures ועל מספר התמונה שמעליהם.
  // כמה עצים עם אותה תווית (למשל ארבעה "אורנים" בלי מספר): התווית ה-k בסדר הנספח שייכת לעץ ה-k עם התווית הזו
  async function attachImages(zip, sh, trees, warnings) {
    let imgs;
    try { imgs = await sheetImages(zip, sh); } catch (e) { warnings.push('התמונות בקובץ לא נקראו'); return; }
    const add = (m, k, t) => { if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(t)) m.get(k).push(t); };
    const exact = new Map(), part = new Map(), bySp = new Map();
    for (const t of trees) {
      if (t.num) {
        add(exact, t.num, t); add(exact, Core.normNum(t.num), t);
        for (const n of Core.expandNum(t.num) || []) add(part, String(n), t);
      } else if (t.species) add(bySp, t.species, t);
    }
    const lookup = k => exact.get(k) || exact.get(Core.normNum(k)) || part.get(k) || bySp.get(k) || null;
    const cell = (c, r) => sh.cells.get(colName(c) + r);
    const blank = v => v == null || v === '' || v === 0 || v === false;
    const PATH = /\\|\.jpe?g$/i;
    const appendix = [...sh.cells.values()].some(v => typeof v === 'string' && /נספח תמונות/.test(v));
    const labelOf = (col, row) => {
      let sawPath = false, sawNum = false;
      for (let r = row - 1; r >= Math.max(1, row - 10); r--) {
        const v = cell(col, r);
        if (blank(v)) continue;
        const k = numText(v);
        if (/^#/.test(k)) continue; // תא של תמונה בתוך תא
        if (PATH.test(k)) { sawPath = true; continue; }
        if (sawPath && !sawNum && /^\d+$/.test(k)) { sawNum = true; continue; } // מספר התמונה, מתחת לתווית
        return { row: r, key: k };
      }
      return null;
    };
    // סדר התווית בנספח: לפי מספר התמונה שמתחתיה (בתבנית הנוכחית, כי העמודות המוסתרות O:V ממשיכות אחרי העמוד השני), אחרת לפי שורה ועמודה
    const orderOf = (col, row) => {
      for (const r of [row + 1, row + 2]) { const v = cell(col, r); if (typeof v === 'number' && v > 0) return v; }
      return 1e6 + row * 100 + col;
    };
    let lost = 0;
    const placed = [];
    for (const im of imgs) {
      // מחוץ לנספח (לוגו, חותמת, חתימה): רק jpg נחשב תמונת עץ, כמו קודם
      if (appendix && im.col < 11) continue;
      if (!appendix && !/\.jpe?g$/i.test(im.path)) continue;
      const lb = labelOf(im.col, im.row);
      if (!lb || !lookup(lb.key)) { lost++; continue; }
      placed.push(Object.assign({}, im, { imgRow: im.row, row: lb.row, key: lb.key }));
    }
    // כל התוויות בשורות התוויות שנמצאו (גם בלי תמונה), כדי לספור נכון את הסדר של תוויות כפולות
    const labelRows = [...new Set(placed.map(p => p.row))];
    const cols = [...new Set(placed.map(p => p.col))];
    const allCols = appendix ? Array.from({ length: 12 }, (_, i) => 11 + i) : cols;
    const labels = [];
    for (const r of labelRows) for (const c of allCols) {
      const v = cell(c, r);
      if (blank(v)) continue;
      const k = numText(v);
      if (lookup(k)) labels.push({ row: r, col: c, key: k, order: orderOf(c, r) });
    }
    labels.sort((a, b) => a.order - b.order);
    const owner = new Map(), count = new Map();
    for (const l of labels) {
      const list = lookup(l.key), j = count.get(l.key) || 0;
      count.set(l.key, j + 1);
      owner.set(l.row + ':' + l.col, list[Math.min(j, list.length - 1)]);
    }
    placed.sort((a, b) => orderOf(a.col, a.row) - orderOf(b.col, b.row) || a.imgRow - b.imgRow);
    const seen = new Set();
    for (const im of placed) {
      const tree = owner.get(im.row + ':' + im.col) || lookup(im.key)[0];
      const sub = /^\d+$/.test(im.key) && Core.normNum(tree.num) !== im.key ? +im.key : null;
      const key = trees.indexOf(tree) + '|' + im.path;
      if (seen.has(key)) continue; // אותה תמונה פעמיים (תא התמונה ותא ההדפסה)
      seen.add(key);
      const f = zip.file(im.path);
      if (!f) continue;
      const ext = (/\.(\w+)$/.exec(im.path) || [])[1].toLowerCase();
      const type = { png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }[ext] || 'image/jpeg';
      (tree.images || (tree.images = [])).push({ blob: new Blob([await f.async('uint8array')], { type }), sub });
    }
    // עץ עם טווח (4--6) שהתמונות שלו בנספח לפי מספר (4, 5, 6): כמו "פצל" באפליקציה, כדי שכל תמונה תישאר עם המספר שלה
    for (const t of trees) if (!t.split && t.images && new Set(t.images.map(i => i.sub).filter(x => x != null)).size > 1) t.split = true;
    if (lost) warnings.push(`${lost} תמונות בלי עץ מתאים`);
  }

  // מחזיר {survey, trees, warnings} או null אם הקובץ לא נראה כמו סקר עצים.
  // שתי תבניות: הנוכחית (xlsm, כותרות טבלה בשורות 22/61/115, סמל ב-B5, שם ב-F9, כתובת ב-D10, תאריך ב-F2)
  // והישנה (xlsx 2018-2025: "סקר בטיחות עצים <שם>" בשורה 9, כתובת מתחת, טבלה מתחת לשורת "מספר העץ"/"מספר")
  async function parse(buffer, fileName, opts) {
    const zip = await JSZip.loadAsync(buffer);
    const sheets = await readSheets(zip);
    const rowsOf = sh => {
      const byRow = new Map();
      for (const [ref, v] of sh.cells) { const r = +ref.replace(/\D+/g, ''); if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push([colNum(ref), v]); }
      for (const cs of byRow.values()) cs.sort((a, b) => a[0] - b[0]);
      return byRow;
    };
    const isHead = cs => cs.some(([, v]) => HEAD_NUM.test(clean(v))) && cs.some(([, v]) => HEAD_SP.test(clean(v)));
    let main = null, byRow = null;
    for (const sh of sheets) { const br = rowsOf(sh); if ([...br.values()].some(isHead)) { main = sh; byRow = br; break; } }
    // מכתב אישור בלי טבלת עצים: מספיק שיש כותרת "סקר בטיחות עצים"
    if (!main) for (const sh of sheets) { const br = rowsOf(sh); if ([...br.entries()].some(([r, cs]) => r <= 20 && cs.some(([, v]) => TITLE.test(clean(v))))) { main = sh; byRow = br; break; } }
    if (!main) return null;
    const warnings = [];
    const get = ref => main.cells.get(ref);
    const heads = [...byRow.entries()].filter(([, cs]) => isHead(cs)).map(([r]) => r).sort((a, b) => a - b);
    const trees = [];
    let std = false;
    if (heads.length) {
      const h0 = byRow.get(heads[0]);
      const colOf = (re, def) => { const f = h0.find(([, v]) => re.test(clean(v))); return f ? f[0] : def; };
      const cNum = colOf(HEAD_NUM, 1), cSp = colOf(HEAD_SP, 2), cNotes = colOf(/^הערות/, 4), cUrg = colOf(/^דחיפות/, 0);
      const cJ = cUrg ? cUrg + 1 : 0;
      const maxRow = Math.max(...byRow.keys());
      // בתבנית הנוכחית: רק שורות העצים שלה, כי בשורות אחרות יש טקסט קבוע (המלצות, חתימה)
      std = heads[0] === 22 && cNum === 1;
      const rows = [];
      if (std) rows.push(...Core.TREE_ROWS);
      else for (let i = 0; i < heads.length; i++) { const end = i + 1 < heads.length ? heads[i + 1] : maxRow + 1; for (let r = heads[i] + 1; r < end; r++) rows.push(r); }
      for (const r of rows) {
        const at = c => c ? main.cells.get(colName(c) + r) : '';
        const num = numText(at(cNum)), species = clean(at(cSp));
        if (!num && !species) continue;
        if (num && !isTreeNum(num)) continue; // שורת טקסט (חתימה, המלצה כללית)
        if (!num && (species.length > 40 || (!std && !at(cNotes) && !at(cUrg)))) continue;
        const jv = clean(at(cJ));
        const pm = /(\d+(?:\.\d+)?)/.exec(jv);
        const notes = clean(at(cNotes));
        // עץ בלי מספר שההערה שלו "תקין" = דחיפות תקין, כמו באפליקציה
        const urgency = clean(at(cUrg)) || (!num && /^תקין/.test(notes) ? Core.OK : '');
        trees.push({ num, species, notes, urgency, pines: pm ? pm[1] : '', split: /פצל/.test(jv) });
        if (!num && !urgency) warnings.push(`עץ בלי מספר (${species})`);
      }
    }
    // פרטי המוסד
    let name = '', address = '', code = '', manager = '', date = '';
    const textCells = r => (byRow.get(r) || []).map(([c, v]) => [c, clean(v)]).filter(([, v]) => v && !/^=/.test(v) && !/^[\d\s.]+$/.test(v) && !/נספח תמונות/.test(v));
    if (std || clean(get('F9'))) {
      name = clean(get('F9')); address = clean(get('D10'));
      code = numText(get('B5')); manager = clean(get('B6'));
      date = toIsoDate(get('F2')) || toIsoDate(get('B14'));
    }
    if (!name && !std) {
      // תבנית ישנה: "סקר בטיחות עצים <שם>" (או הכותרת בתא אחד והשם בתא הבא), והכתובת בשורה שמתחת
      const tr = [...byRow.keys()].filter(r => r <= 20).sort((a, b) => a - b).find(r => textCells(r).some(([, v]) => TITLE.test(v)));
      if (tr) {
        const cs = textCells(tr);
        const k = cs.findIndex(([, v]) => TITLE.test(v));
        name = clean(cs[k][1].replace(TITLE, '').replace(/^[\s\-–:,]+/, ''));
        if (!name) name = cs.filter((_, i) => i !== k).map(([, v]) => v).join(' ');
        if (!address) address = textCells(tr + 1).map(([, v]) => v).filter(v => !/תאריך/.test(v) && !toIsoDate(v)).join(' ');
      }
    }
    if (/^[\d.]+$/.test(address)) address = '';
    // תאריך: תא עם "תאריך" (הערך באותו תא או בתא שלידו), אחרת כל תאריך בראש הדף
    if (!date) {
      for (const [r, cs] of [...byRow.entries()].filter(([r]) => r <= 20).sort((a, b) => a[0] - b[0])) {
        const k = cs.findIndex(([, v]) => /תאריך/.test(clean(v)));
        if (k < 0) continue;
        date = toIsoDate(cs[k][1]) || (cs[k + 1] && toIsoDate(cs[k + 1][1])) || (cs[k - 1] && toIsoDate(cs[k - 1][1])) || '';
        if (date) break;
      }
    }
    if (!date) for (const [r, cs] of byRow) if (r <= 12) for (const [, v] of cs) { const d = typeof v === 'number' ? toIsoDate(v) : ''; if (d) { date = d; break; } }
    // סמל מוסד: תא "סמל מוסד" ולידו הערך, או מספר בתחילת שם הקובץ
    if (!code) for (const cs of byRow.values()) { const k = cs.findIndex(([, v]) => /סמל/.test(clean(v))); if (k >= 0 && cs[k + 1] && /^\d{3,8}$/.test(numText(cs[k + 1][1]))) { code = numText(cs[k + 1][1]); break; } }
    if (!code && fileName) { const m = /^\s*(\d{5,7})\s/.exec(fileName); if (m) code = m[1]; }
    let street = '', city = '';
    if (address) { const p = address.split(',').map(clean).filter(Boolean); city = p.length > 1 ? p.pop() : ''; street = p.join(', '); }
    else if (name.includes(',')) { const p = name.split(',').map(clean).filter(Boolean); name = p.shift(); city = p.length ? p.pop() : ''; street = p.join(', '); }
    if (!name) warnings.push('לא נמצא שם מוסד');
    if (!date) warnings.push('לא נמצא תאריך (נלקח תאריך הקובץ)');
    if (!heads.length) warnings.push('אין טבלת עצים (מכתב אישור)');
    else if (!trees.length) warnings.push('אין עצים בטבלה');
    const survey = { siteName: name, street, city, code, manager, date };
    // קובץ שהאפליקציה הפיקה: גיליון "נתוני שטח" עם נ"צ לכל עץ
    const field = sheets.find(sh => sh.name === 'נתוני שטח');
    if (field) {
      for (let r = 2; r < 200; r++) {
        const n = numText(field.cells.get('A' + r)); if (!n) continue;
        const lat = field.cells.get('E' + r), lon = field.cells.get('F' + r);
        const t = trees.find(x => x.num === n);
        if (t && typeof lat === 'number' && typeof lon === 'number') { t.lat = lat; t.lon = lon; t.gpsSrc = 'import'; }
      }
    }
    if (opts && opts.photos) await attachImages(zip, main, trees, warnings);
    return { survey, trees, warnings: [...new Set(warnings)] };
  }

  root.Importer = { parse, toIsoDate };
})(self);

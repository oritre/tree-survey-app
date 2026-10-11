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
    for (const d of sh.doc.getElementsByTagNameNS(MAIN, 'drawing')) {
      const dpath = srels[d.getAttribute('r:id') || d.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')];
      const ddoc = dpath && await xml(zip, dpath);
      if (!ddoc) continue;
      const drels = await relsOf(zip, dpath);
      for (const a of [...ddoc.getElementsByTagNameNS(XDR, 'twoCellAnchor'), ...ddoc.getElementsByTagNameNS(XDR, 'oneCellAnchor')]) {
        const from = a.getElementsByTagNameNS(XDR, 'from')[0];
        const blip = [...a.getElementsByTagName('*')].find(e => e.localName === 'blip');
        if (!from || !blip) continue;
        const id = blip.getAttribute('r:embed') || blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
        const path = drels[id];
        if (!path || !/\.jpe?g$/i.test(path)) continue; // לוגו, חותמת וכו' הם png/tiff; תמונות העצים jpg
        out.push({ col: +from.getElementsByTagNameNS(XDR, 'col')[0].textContent + 1, row: +from.getElementsByTagNameNS(XDR, 'row')[0].textContent + 1, path });
      }
    }
    return out;
  }
  // לכל תמונה: העץ לפי התווית שמעליה באותה עמודה (מספר העץ, או המין בעץ בלי מספר)
  async function attachImages(zip, sh, trees, warnings) {
    let imgs;
    try { imgs = await sheetImages(zip, sh); } catch (e) { warnings.push('התמונות בקובץ לא נקראו'); return; }
    const byKey = new Map();
    for (const t of trees) {
      if (t.num) for (const n of (root.Core ? Core.expandNum(t.num) : [t.num])) if (!byKey.has(String(n))) byKey.set(String(n), t);
      if (t.num && !byKey.has(t.num)) byKey.set(t.num, t);
      if (!t.num && t.species && !byKey.has(t.species)) byKey.set(t.species, t);
    }
    let lost = 0;
    const seen = new Set();
    imgs.sort((a, b) => a.row - b.row || b.col - a.col);
    // בתבנית (הנוכחית ושל האפליקציה): התווית של כל משבצת בשורות 10/32/62/85/116/140, בעמודות K עד V.
    // בתבניות אחרות: התא הראשון מעל התמונה שיש בו מספר עץ או מין
    const LABEL_ROWS = [10, 32, 62, 85, 116, 140];
    const std = std0 => im => im.col >= 11 && im.col <= 22 && im.row > 10 && std0;
    const isStd = std(sh.cells.has('K9') || sh.cells.has('K10'));
    for (const im of imgs) {
      let tree = null, sub = null;
      const rows = isStd(im) ? [LABEL_ROWS.filter(r => r < im.row).pop()] : Array.from({ length: Math.min(8, im.row - 1) }, (_, i) => im.row - 1 - i);
      for (const r of rows) {
        if (tree) break;
        const v = sh.cells.get(colName(im.col) + r);
        if (v == null || v === '' || v === 0 || v === false) continue;
        const k = numText(v);
        if (byKey.has(k)) { tree = byKey.get(k); sub = /^\d+$/.test(k) && tree.num !== k ? +k : null; }
      }
      if (!tree) { lost++; continue; }
      const key = tree.num + '|' + im.path;
      if (seen.has(key)) continue; // אותה תמונה פעמיים (תא התמונה ותא ההדפסה)
      seen.add(key);
      const f = zip.file(im.path);
      if (!f) continue;
      const type = /\.png$/i.test(im.path) ? 'image/png' : 'image/jpeg';
      (tree.images || (tree.images = [])).push({ blob: new Blob([await f.async('uint8array')], { type }), sub });
    }
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
        trees.push({ num, species, notes: clean(at(cNotes)), urgency: clean(at(cUrg)), pines: pm ? pm[1] : '', split: /פצל/.test(jv) });
        if (!num) warnings.push(`עץ בלי מספר (${species})`);
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

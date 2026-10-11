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
      const cells = new Map();
      for (const c of doc.getElementsByTagNameNS(MAIN, 'c')) {
        const type = c.getAttribute('t');
        const v = c.getElementsByTagNameNS(MAIN, 'v')[0];
        let val;
        if (type === 's') val = v ? ss[+v.textContent] : '';
        else if (type === 'inlineStr') val = textOf(c);
        else if (type === 'str' || type === 'e') val = v ? v.textContent : '';
        else if (type === 'b') val = v ? v.textContent === '1' : '';
        else val = v ? +v.textContent : '';
        if (val !== '' && val != null) cells.set(c.getAttribute('r'), val);
      }
      out.push({ name: sh.getAttribute('name'), cells });
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

  // מחזיר {survey, trees, warnings} או null אם הקובץ לא נראה כמו סקר עצים.
  // שתי תבניות: הנוכחית (xlsm, כותרות טבלה בשורות 22/61/115, סמל ב-B5, שם ב-F9, כתובת ב-D10, תאריך ב-F2)
  // והישנה (xlsx 2018-2025: "סקר בטיחות עצים <שם>" בשורה 9, כתובת מתחת, טבלה מתחת לשורת "מספר העץ"/"מספר")
  async function parse(buffer, fileName) {
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
    return { survey, trees, warnings: [...new Set(warnings)] };
  }

  root.Importer = { parse, toIsoDate };
})(self);

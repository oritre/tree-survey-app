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

  // מחזיר {survey, trees} או null אם הקובץ לא נראה כמו סקר בטיחות עצים
  async function parse(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const sheets = await readSheets(zip);
    const main = sheets.find(sh => [...sh.cells.values()].some(v => clean(v) === 'מספר העץ'));
    if (!main) return null;
    const get = ref => main.cells.get(ref);
    // שורות הכותרת של טבלאות העצים, והעמודות לפי הכותרות
    const byRow = new Map();
    for (const [ref, v] of main.cells) { const r = +ref.replace(/\D+/g, ''); if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push([colNum(ref), v]); }
    const heads = [...byRow.entries()].filter(([, cs]) => cs.some(([, v]) => clean(v) === 'מספר העץ')).map(([r]) => r).sort((a, b) => a - b);
    const h0 = byRow.get(heads[0]);
    const colOf = (re, def) => { const f = h0.find(([, v]) => re.test(clean(v))); return f ? f[0] : def; };
    const cNum = colOf(/^מספר העץ$/, 1), cSp = colOf(/^מין/, 2), cNotes = colOf(/^הערות/, 4), cUrg = colOf(/^דחיפות/, 9);
    const cJ = cUrg + 1;
    const maxRow = Math.max(...byRow.keys());
    const trees = [];
    // התבנית הרגילה (כותרות בשורות 22, 61, 115): רק שורות העצים שלה, כי בשורות אחרות יש טקסט קבוע (המלצות, חתימה)
    const std = heads[0] === 22 && cNum === 1;
    const rows = [];
    if (std) rows.push(...Core.TREE_ROWS);
    else for (let i = 0; i < heads.length; i++) { const end = i + 1 < heads.length ? heads[i + 1] : maxRow + 1; for (let r = heads[i] + 1; r < end; r++) rows.push(r); }
    {
      for (const r of rows) {
        const at = c => main.cells.get(colName(c) + r);
        const num = numText(at(cNum)), species = clean(at(cSp));
        if (!num && !species) continue;
        if (num && !isTreeNum(num)) continue; // שורת טקסט (חתימה, הערה כללית)
        if (!num && (species.length > 40 || (!std && !at(cNotes) && !at(cUrg)))) continue;
        const jv = clean(at(cJ));
        const pm = /(\d+(?:\.\d+)?)/.exec(jv);
        trees.push({ num, species, notes: clean(at(cNotes)), urgency: clean(at(cUrg)), pines: pm ? pm[1] : '', split: /פצל/.test(jv) });
      }
    }
    // מוסד, כתובת, סמל, מנהל ותאריך
    let name = clean(get('F9')), address = clean(get('D10'));
    if (/^\s*=/.test(address) || /^[\d.]+$/.test(address)) address = '';
    let street = '', city = '';
    if (address) { const p = address.split(',').map(clean).filter(Boolean); city = p.length > 1 ? p.pop() : ''; street = p.join(', '); }
    else if (name.includes(',')) { const p = name.split(',').map(clean).filter(Boolean); name = p.shift(); city = p.length ? p.pop() : ''; street = p.join(', '); }
    const survey = { siteName: name, street, city, code: numText(get('B5')), manager: clean(get('B6')), date: toIsoDate(get('F2')) || toIsoDate(get('B14')) };
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
    return { survey, trees };
  }

  root.Importer = { parse, toIsoDate };
})(self);

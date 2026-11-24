// סיכומים: ריכוז אורנים (אקסל לסקר אחד או לכמה מוסדות), ומפת עצים לשיתוף (דף אינטרנט אחד)
(function (root) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

  // ---------- קובץ xlsx פשוט (גיליון אחד או כמה, מימין לשמאל) ----------
  function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  // סגנונות: 0 רגיל, 1 כותרת טבלה (מודגש, רקע ירוק, מסגרת), 2 קישור, 3 מודגש, 4 כותרת גדולה, 5 תא בטבלה (מסגרת), 6 קישור בטבלה, 7 מיושר לימין
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="4"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Arial"/></font><font><b/><sz val="15"/><name val="Arial"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2EFDA"/></patternFill></fill></fills>'
    + '<borders count="2"><border/><border><left style="thin"><color rgb="FFA6A6A6"/></left><right style="thin"><color rgb="FFA6A6A6"/></right><top style="thin"><color rgb="FFA6A6A6"/></top><bottom style="thin"><color rgb="FFA6A6A6"/></bottom></border></borders>'
    + '<cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="8"><xf/>'
    + '<xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>'
    + '<xf fontId="2" applyFont="1"/><xf fontId="1" applyFont="1"/><xf fontId="3" applyFont="1"/>'
    + '<xf borderId="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top" horizontal="right"/></xf>'
    + '<xf fontId="2" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="right"/></xf><xf applyAlignment="1"><alignment horizontal="right"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  // תא: ערך, או { v, link, s }. sheet: { name, rows, widths, head (מספר שורת הכותרת של הטבלה, מ-0), table (עד איזו שורה יש מסגרת), boldLast, styles: { rowIndex: s } }
  function sheetXml(sh) {
    const rows = sh.rows, head = sh.head || 0, links = [];
    const tableEnd = sh.table != null ? sh.table : -1;
    const sheetRows = rows.map((r, i) => `<row r="${i + 1}">` + r.map((c, j) => {
      const ref = colName(j + 1) + (i + 1);
      const o = c != null && typeof c === 'object' ? c : { v: c };
      const inTable = i > head && i <= tableEnd;
      let st = o.s != null ? o.s : i === head || (sh.boldLast && i === rows.length - 1) ? 1 : (sh.styles && sh.styles[i] != null) ? sh.styles[i] : inTable ? 5 : 0;
      if (o.link) { links.push({ ref, url: o.link }); if (o.s == null) st = inTable ? 6 : 2; }
      const sa = st ? ` s="${st}"` : '';
      const v = o.v;
      if (v == null || v === '') return `<c r="${ref}"${sa}/>`;
      if (typeof v === 'number') return `<c r="${ref}"${sa}><v>${v}</v></c>`;
      return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('') + '</row>').join('');
    const cols = (sh.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const width = Math.max(1, ...rows.map(r => r.length));
    const lastData = sh.boldLast ? rows.length - 1 : rows.length;
    const filter = (sh.head != null || !sh.noFilter) && lastData > head ? `<autoFilter ref="A${head + 1}:${colName((rows[head] || []).length || width)}${lastData}"/>` : '';
    const hl = links.length ? '<hyperlinks>' + links.map((l, k) => `<hyperlink ref="${l.ref}" r:id="rIdL${k + 1}"/>`).join('') + '</hyperlinks>' : '';
    const merges = (sh.merges || []).length ? `<mergeCells count="${sh.merges.length}">` + sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('') + '</mergeCells>' : '';
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView rightToLeft="1" workbookViewId="0">${sh.freeze === false ? '' : `<pane ySplit="${head + 1}" topLeftCell="A${head + 2}" activePane="bottomLeft" state="frozen"/>`}</sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${sheetRows}</sheetData>${filter}${merges}${hl}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
    const rels = links.length ? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + links.map((l, k) => `<Relationship Id="rIdL${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(l.url)}" TargetMode="External"/>`).join('') + '</Relationships>' : null;
    return { xml, rels };
  }
  async function book(sheets) {
    const zip = new JSZip();
    const n = sheets.length;
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    const sname = (sh, i) => esc(String(sh.name || sh.sheet || 'סיכום ' + (i + 1)).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
    zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>`
      + sheets.map((sh, i) => `<sheet name="${sname(sh, i)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>'
      + (sheets.some((sh, i) => sh.head != null || !sh.noFilter) ? '<definedNames>' + sheets.map((sh, i) => {
        const head = sh.head || 0, last = sh.boldLast ? sh.rows.length - 1 : sh.rows.length;
        return last > head ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${sname(sh, i).replace(/'/g, "''")}'!$A$${head + 1}:$${colName((sh.rows[head] || []).length || 1)}$${last}</definedName>` : '';
      }).join('') + '</definedNames>' : '') + '</workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    zip.file('xl/styles.xml', STYLES);
    sheets.forEach((sh, i) => {
      const r = sheetXml(sh);
      zip.file(`xl/worksheets/sheet${i + 1}.xml`, r.xml);
      if (r.rels) zip.file(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, r.rels);
    });
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  // גיליון אחד (כמו קודם): rows[0] = כותרות
  function xlsx(rows, opts) { return book([Object.assign({ name: (opts || {}).sheet }, opts || {}, { rows })]); }

  // ---------- מוסדות ----------
  // מוסד מזוהה לפי סמל מוסד, ואם אין — לפי שם + כתובת
  function placeKey(s) {
    if ((s.code || '').trim()) return 'code:' + s.code.trim();
    const p = Core.placeOf(s);
    return 'place:' + (p.name + '|' + p.address).replace(/\s+/g, ' ').trim();
  }

  // כשיש כמה סקרים לאותו מוסד, משאירים רק את האחרון (כדי לא לספור את אותם עצים פעמיים)
  function latestPerPlace(surveys) {
    const m = new Map();
    for (const s of surveys) {
      const k = placeKey(s), o = m.get(k);
      if (!o || (s.date || '') > (o.date || '') || ((s.date || '') === (o.date || '') && (s.updated || 0) > (o.updated || 0))) m.set(k, s);
    }
    return [...m.values()];
  }

  // ---------- ריכוז אורנים (1.116) ----------
  // כל אורן בשורה משלו: מיקום, גובה, קוטרי הגזעים, נ"צ ברשת ישראל ובגוגל, וקישור שפותח את המקום בגוגל מפות
  const num = v => v == null || v === '' || isNaN(+v) ? '' : +v;
  const gmaps = (lat, lon) => `https://www.google.com/maps/search/?api=1&query=${(+lat).toFixed(6)},${(+lon).toFixed(6)}`;
  // סמלי מוסד: "629477 406512" / "629477/406512" -> "629477, 406512"
  const codesOf = code => Core.codesOf(code);
  const codeText = code => codesOf(code).join(', ');
  // העצים עם אורנים בסקר, לפי סדר העצים
  function pineTrees(s) {
    return Core.sortTrees((s.trees || []).filter(t => Core.hasContent(t) && !Core.pineRef(t) && (Core.isPine(t.species) || (t.pineList || []).length || Core.pineCount(t))));
  }
  function pineTotal(s) { return pineTrees(s).reduce((a, t) => a + (Core.pineCount(t) || 0), 0); }
  const PINE_HEAD = ['מס\' אורן', 'מספר העץ בסקר', 'מין העץ', 'מיקום', 'גובה (מ\')', 'מספר גזעים', 'קוטרי הגזעים (ס"מ)', 'קוטר העץ (סכום הגזעים)', 'X רשת ישראל', 'Y רשת ישראל', 'קו רוחב', 'קו אורך', 'גוגל מפות'];
  const PINE_W = [9, 12, 16, 34, 10, 10, 18, 14, 13, 13, 12, 12, 16];
  function pineLines(s, k0) {
    const out = [];
    let k = k0 || 0;
    for (const t of pineTrees(s)) {
      const list = (t.pineList || []).length ? t.pineList : Array.from({ length: Core.pineCount(t) || 1 }, () => ({}));
      for (const p of list) {
        const trunks = (p.trunks || []).filter(x => x != null && x !== '' && !isNaN(+x)).map(Number);
        const lat = p.lat != null ? p.lat : null, lon = p.lon != null ? p.lon : null;
        out.push([++k, String(t.num || '').trim() || (Core.isOk(t) ? 'תקין' : ''), (t.species || '').trim(), (p.loc || '').trim(), num(p.h),
          trunks.length || '', trunks.length === 1 ? trunks[0] : trunks.join(', '), trunks.length ? Math.round(trunks.reduce((x, y) => x + y, 0) * 10) / 10 : '',
          p.itmX != null ? Math.round(p.itmX * 10) / 10 : '', p.itmY != null ? Math.round(p.itmY * 10) / 10 : '',
          lat != null ? +(+lat).toFixed(6) : '', lon != null ? +(+lon).toFixed(6) : '',
          lat != null ? { v: 'פתח בגוגל מפות', link: gmaps(lat, lon) } : '']);
      }
    }
    return out;
  }
  // קובץ לסקר אחד: פרטי המוסד למעלה, ומתחת טבלת האורנים
  function pinesSheet(s) {
    const p = Core.placeOf(s);
    const lines = pineLines(s);
    const info = [
      [{ v: 'ריכוז אורנים', s: 4 }],
      [{ v: 'שם המוסד:', s: 3 }, '', '', { v: p.name, s: 7 }],
      [{ v: codesOf(s.code).length > 1 ? 'סמלי מוסד:' : 'סמל מוסד:', s: 3 }, '', '', ...codesOf(s.code).map(c => ({ v: /^\d+$/.test(c) ? +c : c, s: 7 }))],
      [{ v: 'כתובת:', s: 3 }, '', '', { v: p.address, s: 7 }],
      [{ v: 'מנהל/ת:', s: 3 }, '', '', { v: (s.manager || '').trim(), s: 7 }],
      [{ v: 'תאריך הסקר:', s: 3 }, '', '', { v: fmtDate(s.date), s: 7 }],
      [{ v: 'מספר אורנים:', s: 3 }, '', '', { v: lines.length, s: 7 }],
      []];
    const head = info.length;
    return { name: 'ריכוז אורנים', rows: [...info, PINE_HEAD, ...lines], head, table: head + lines.length, widths: PINE_W, freeze: false,
      merges: info.slice(1, 7).map((_, i) => `A${i + 2}:C${i + 2}`) };
  }
  async function surveyPinesXlsx(s) { return book([pinesSheet(s)]); }

  // כמה מוסדות (מסך "אורנים ומפות"): גיליון מוסדות (שורה לכל מוסד), וגיליון כל האורנים עם פרטי המוסד בכל שורה
  // כמה סמלי מוסד לכל היותר במוסד אחד: כל סמל בעמודה משלו (סמל מוסד, סמל מוסד 2…)
  const codeCols = surveys => Math.max(1, ...surveys.map(s => codesOf(s.code).length));
  const codeHead = n => Array.from({ length: n }, (_, i) => i ? 'סמל מוסד ' + (i + 1) : 'סמל מוסד');
  const codeCells = (s, n) => Array.from({ length: n }, (_, i) => { const c = codesOf(s.code)[i] || ''; return /^\d+$/.test(c) ? +c : c; });
  // לכל מוסד (1.162): מספר אורנים, גובה ממוצע וקוטר ממוצע (עץ עם כמה גזעים = סכום הגזעים, 40+40=80), ופירוט כל אורן בתא אחד
  const avg = v => { const x = v.filter(n => n !== '' && n != null); return x.length ? Math.round(x.reduce((a, b) => a + b, 0) / x.length * 10) / 10 : ''; };
  const sortPlaces = surveys => surveys.slice().sort((a, b) => Core.placeOf(a).name.localeCompare(Core.placeOf(b).name, 'he'));
  function pineRows(surveys) {
    const nc = codeCols(surveys);
    const head = [...codeHead(nc), 'שם המוסד', 'כתובת', 'מנהל/ת', 'תאריך הסקר', 'מספר אורנים', "גובה ממוצע (מ')", 'קוטר ממוצע (ס"מ)', 'פירוט: גובה / קוטר לכל אורן', 'סה"כ עצים בסקר (כל המינים)'];
    const allH = [], allD = [];
    const rows = sortPlaces(surveys).map(s => {
      const p = Core.placeOf(s);
      const trees = (s.trees || []).filter(Core.hasContent);
      const lines = pineLines(s);
      const hs = lines.map(l => l[4]), ds = lines.map(l => l[7]);
      allH.push(...hs); allD.push(...ds);
      const detail = lines.map(l => `אורן ${l[0]}: ${l[4] !== '' ? l[4] + " מ'" : '?'} / ${l[7] !== '' ? l[7] + ' ס"מ' : '?'}`).join('\n');
      return [...codeCells(s, nc), p.name, p.address, (s.manager || '').trim(), fmtDate(s.date), lines.length, avg(hs), avg(ds), detail, trees.length];
    });
    const sum = i => rows.reduce((a, r) => a + (+r[i + nc] || 0), 0);
    return [head, ...rows, ['סה"כ', ...Array(nc - 1).fill(''), `${rows.length} מוסדות`, '', '', sum(4), avg(allH), avg(allD), '', sum(8)]];
  }
  async function pinesXlsx(surveys) {
    const inst = pineRows(surveys), nc = codeCols(surveys);
    const head = [...codeHead(nc), 'שם המוסד', 'כתובת', ...PINE_HEAD];
    let k = 0;
    const all = sortPlaces(surveys).flatMap(s => { const p = Core.placeOf(s); return pineLines(s).map(l => [...codeCells(s, nc), p.name, p.address, ++k, ...l.slice(1)]); });
    return book([
      { name: 'מוסדות', rows: inst, widths: [...Array(nc).fill(12), 30, 30, 18, 12, 11, 12, 12, 30, 14], boldLast: true, table: inst.length - 2 },
      { name: 'כל האורנים', rows: [head, ...all], widths: [...Array(nc).fill(12), 26, 26, ...PINE_W], table: all.length }]);
  }

  // ---------- מפה לשיתוף ----------
  // עץ "דורש טיפול" (אדום): יש דחיפות, או הערה שאינה "תקין"
  function needsCare(t) {
    if (Core.isOk(t)) return false;
    if ((t.urgency || '').trim()) return true;
    const n = (t.notes || '').trim();
    return !!n && !/^תקין/.test(n);
  }

  const URG = { 'כ': 'כריתה', '1': '1 - טיפול מיידי', '2': '2 - טיפול בתוך חצי שנה' };

  // getThumb(survey, photo) -> Blob או null
  async function mapHtml(surveys, title, getThumb) {
    const toData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.onerror = () => r(null); f.readAsDataURL(b); });
    const points = [], sites = [];
    let noGps = 0;
    for (const s of surveys) {
      const p = Core.placeOf(s);
      const trees = (s.trees || []).filter(Core.hasContent);
      let n = 0;
      for (const t of trees) {
        if (t.lat == null || t.lon == null) { noGps++; continue; }
        const ph = (t.photos || []).find(x => x.inReport) || (t.photos || [])[0];
        let img = null;
        if (ph && getThumb) { try { const b = await getThumb(s, ph); if (b) img = await toData(b); } catch (_) {} }
        points.push({ la: +t.lat.toFixed(7), lo: +t.lon.toFixed(7), n: t.num || '', sp: t.species || '', no: t.notes || '',
          u: URG[(t.urgency || '').trim()] || (t.urgency || ''), pi: Core.pineCount(t) || '', bad: needsCare(t) ? 1 : 0,
          si: p.name, ad: p.address, co: s.code || '', d: fmtDate(s.date), img });
        n++;
      }
      sites.push(p.name + (n < trees.length ? ` (${trees.length - n} בלי נ"צ)` : ''));
    }
    const data = JSON.stringify({ title, made: new Date().toLocaleDateString('he-IL'), points }).replace(/</g, '\\u003c');
    const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
<style>
html,body{height:100%;margin:0;font-family:Arial,Helvetica,sans-serif}
#map{position:absolute;inset:56px 0 0 0}
header{height:56px;display:flex;align-items:center;gap:12px;padding:0 14px;background:#fff;color:#1b3d1b;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.25);position:relative;z-index:1000}
header h1{font-size:18px;margin:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lg{display:flex;gap:10px;font-size:14px;align-items:center}
.lg label{display:flex;gap:4px;align-items:center;cursor:pointer;white-space:nowrap}
.dot{display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid #fff}
.leaflet-container{direction:ltr}
.pp{direction:rtl;text-align:right;font-size:14px;min-width:200px}
.pp b{font-size:16px}.pp .r{color:#c62828;font-weight:bold}.pp .g{color:#2e7d32;font-weight:bold}
.pp img{display:block;max-width:240px;max-height:240px;margin-top:6px;border-radius:6px}
.pp .m{color:#666;font-size:12px;margin-top:4px}
</style></head><body>
<header><h1>${esc(title)}</h1><div class="lg">
<label><input type="checkbox" id="fg" checked><span class="dot" style="background:#2e7d32"></span>תקין (<span id="cg"></span>)</label>
<label><input type="checkbox" id="fr" checked><span class="dot" style="background:#d32f2f"></span>לטיפול (<span id="cr"></span>)</label>
</div></header><div id="map"></div>
<script>
const D=${data};
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const map=L.map('map',{maxZoom:21});
const quad=(x,y,z)=>{let q='';for(let i=z;i>0;i--){let d=0;const m=1<<(i-1);if(x&m)d++;if(y&m)d+=2;q+=d;}return q;};
const Bing=L.TileLayer.extend({getTileUrl(c){return 'https://ecn.t'+((c.x+c.y)%4)+'.tiles.virtualearth.net/tiles/a'+quad(c.x,c.y,c.z)+'.jpeg?g=1';}});
const base={
 'תצלום אוויר (גוגל)':L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&hl=iw&x={x}&y={y}&z={z}',{subdomains:'0123',maxZoom:21,attribution:'© Google'}),
 'תצלום אוויר (Bing)':new Bing('',{maxZoom:21,maxNativeZoom:19,attribution:'© Microsoft'}),
 'תצלום אוויר (Esri)':L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:21,maxNativeZoom:19,attribution:'© Esri, Vantor'}),
 'מפת רחובות (גוגל)':L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&hl=iw&x={x}&y={y}&z={z}',{subdomains:'0123',maxZoom:21,attribution:'© Google'})};
base['תצלום אוויר (גוגל)'].addTo(map);
L.control.layers(base,null,{position:'topleft'}).addTo(map);
const gG=L.layerGroup().addTo(map),gR=L.layerGroup().addTo(map);let ng=0,nr=0;
for(const p of D.points){
 const m=L.circleMarker([p.la,p.lo],{radius:8,color:'#fff',weight:2,fillColor:p.bad?'#d32f2f':'#2e7d32',fillOpacity:1});
 m.bindTooltip(esc(p.n),{direction:'top',offset:[0,-6]});
 m.bindPopup('<div class="pp"><b>'+(p.n?'עץ '+esc(p.n):'עץ ללא מספר')+'</b> · '+esc(p.sp)+'<br>'+(p.bad?'<span class="r">דורש טיפול</span>':'<span class="g">תקין</span>')+
  (p.no&&!/^תקין\.?$/.test(p.no.trim())?'<br>'+esc(p.no):'')+(p.u?'<br>דחיפות: '+esc(p.u):'')+(p.pi?'<br>אורנים: '+esc(p.pi):'')+
  (p.img?'<img src="'+p.img+'" alt="">':'')+'<div class="m">'+esc(p.si)+(p.ad?', '+esc(p.ad):'')+(p.co?' · סמל '+esc(p.co):'')+' · '+esc(p.d)+'</div></div>',{maxWidth:280});
 (p.bad?gR:gG).addLayer(m);p.bad?nr++:ng++;
}
document.getElementById('cg').textContent=ng;document.getElementById('cr').textContent=nr;
document.getElementById('fg').onchange=e=>e.target.checked?gG.addTo(map):gG.remove();
document.getElementById('fr').onchange=e=>e.target.checked?gR.addTo(map):gR.remove();
if(D.points.length)map.fitBounds(D.points.map(p=>[p.la,p.lo]),{padding:[30,30],maxZoom:19});else map.setView([31.77,35.21],12);
</script></body></html>`;
    return { blob: new Blob([html], { type: 'text/html' }), points: points.length, noGps, sites };
  }

  root.Reports = { xlsx, book, pinesXlsx, pineRows, surveyPinesXlsx, pineTrees, pineTotal, codesOf, codeText, gmaps, mapHtml, latestPerPlace, placeKey, needsCare };
})(self);

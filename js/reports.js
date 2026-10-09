// סיכומים על פני כמה סקרים: מספר האורנים בכל מוסד (קובץ אקסל), ומפת עצים לשיתוף (דף אינטרנט אחד)
(function (root) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

  // ---------- קובץ xlsx פשוט (גיליון אחד, מימין לשמאל) ----------
  function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  async function xlsx(rows, opts) {
    opts = opts || {};
    const sheetRows = rows.map((r, i) => `<row r="${i + 1}">` + r.map((v, j) => {
      const ref = colName(j + 1) + (i + 1);
      const st = (i === 0 || (opts.boldLast && i === rows.length - 1)) ? ' s="1"' : '';
      if (v == null || v === '') return `<c r="${ref}"${st}/>`;
      if (typeof v === 'number') return `<c r="${ref}"${st}><v>${v}</v></c>`;
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('') + '</row>').join('');
    const cols = (opts.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(opts.sheet || 'סיכום')}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2EFDA"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>');
    zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${sheetRows}</sheetData><autoFilter ref="A1:${colName(rows[0].length)}${rows.length - (opts.boldLast ? 1 : 0)}"/></worksheet>`);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

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

  // ---------- סיכום אורנים ----------
  function pineRows(surveys) {
    const head = ['פרויקט', 'סמל מוסד', 'שם המוסד', 'כתובת', 'תאריך הסקר', 'מספר אורנים', 'עצי אורן בלי כמות', 'עצים בסקר'];
    const rows = surveys.map(s => {
      const p = Core.placeOf(s);
      const trees = (s.trees || []).filter(Core.hasContent);
      let pines = 0, missing = 0;
      for (const t of trees) {
        if (t.pines != null && t.pines !== '' && !isNaN(+t.pines)) pines += +t.pines;
        else if (Core.isPine(t.species)) missing++;
      }
      return [s.project || '', (s.code || '').trim(), p.name, p.address, fmtDate(s.date), pines, missing || '', trees.length];
    }).sort((a, b) => a[0].localeCompare(b[0], 'he') || a[2].localeCompare(b[2], 'he'));
    const sum = i => rows.reduce((a, r) => a + (+r[i] || 0), 0);
    return [head, ...rows, ['סה"כ', '', `${rows.length} מוסדות`, '', '', sum(5), sum(6) || '', sum(7)]];
  }

  async function pinesXlsx(surveys) {
    return xlsx(pineRows(surveys), { sheet: 'אורנים', widths: [14, 12, 30, 30, 12, 13, 16, 11], boldLast: true });
  }

  // ---------- מפה לשיתוף ----------
  // עץ "דורש טיפול" (אדום): יש דחיפות, או הערה שאינה "תקין"
  function needsCare(t) {
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
          u: URG[(t.urgency || '').trim()] || (t.urgency || ''), pi: t.pines || '', bad: needsCare(t) ? 1 : 0,
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
 'מפת רחובות (גוגל)':L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&hl=iw&x={x}&y={y}&z={z}',{subdomains:'0123',maxZoom:21,attribution:'© Google'})};
base['תצלום אוויר (גוגל)'].addTo(map);
L.control.layers(base,null,{position:'topleft'}).addTo(map);
const gG=L.layerGroup().addTo(map),gR=L.layerGroup().addTo(map);let ng=0,nr=0;
for(const p of D.points){
 const m=L.circleMarker([p.la,p.lo],{radius:8,color:'#fff',weight:2,fillColor:p.bad?'#d32f2f':'#2e7d32',fillOpacity:1});
 m.bindTooltip(esc(p.n),{direction:'top',offset:[0,-6]});
 m.bindPopup('<div class="pp"><b>עץ '+esc(p.n)+'</b> · '+esc(p.sp)+'<br>'+(p.bad?'<span class="r">דורש טיפול</span>':'<span class="g">תקין</span>')+
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

  root.Reports = { xlsx, pinesXlsx, pineRows, mapHtml, latestPerPlace, placeKey, needsCare };
})(self);

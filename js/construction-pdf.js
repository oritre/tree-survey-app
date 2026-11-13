// סקר עצים לבנייה: דוח PDF מלא מתוך האפליקציה, כמו ה-PDF שמפיקים מהאקסל (ori, 1.82.0):
// טבלת הסקר (בלי גזע 1-3), טבלה מסכמת של ערכיות העצים, טבלת מידע מרכזת (עם הייעוד), טבלה מסכמת של הסטאטוס,
// ונספח התמונות (ReportPrint.photosPdf). הערכים מחושבים כמו בנוסחאות של התבנית (Construction.compute),
// והעמודים נבנים ב-HTML ונכתבים כ-PDF וקטורי (PdfVec), כמו שאר הדוחות באפליקציה.
(function (root) {
  'use strict';
  const PW = 842, PH = 595;                // A4 לרוחב, בנקודות
  const C = () => root.Construction;
  const CAT_BG = { 'גבוה מאוד': '#FF0000', 'גבוה': '#92D050', 'בינונית': '#A6A6A6', 'נמוכה': '#FFFF00' };
  const ST = { 'שימור': ['#FF0000', '#000'], 'כריתה': ['#FFFF00', '#000'], 'העתקה': ['#FFC000', '#000'], 'לא נדרש ברישיון': ['#0070C0', '#fff'] };
  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = v => (v == null || v === '' || isNaN(+v)) ? null : Number(v);
  const fmtN = (v, d = 2) => v == null ? '' : String(Math.round(v * 10 ** d) / 10 ** d);
  const money = v => v == null ? '#N/A' : v === 0 ? '0 ₪' : Math.round(v).toLocaleString('en-US') + ' ₪';
  // סכום בשורת "סה"כ ערך חליפי": 0 מוצג כמקף, כמו בעיצוב החשבונאי של האקסל
  const moneyAcc = v => !v ? '- ₪' : Math.round(v).toLocaleString('en-US') + ' ₪';
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '0%';
  const fmtDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

  const CSS = `
#cpdfRoot{position:fixed;left:-100000px;top:0}
#cpdfRoot .pg{position:relative;width:${PW}pt;height:${PH}pt;overflow:hidden;background:#fff;font-family:RepArial,Arial,sans-serif;color:#000;direction:rtl;box-sizing:border-box}
#cpdfRoot .abs{position:absolute}
#cpdfRoot .bsd{top:16pt;right:30pt;font-size:8pt}
#cpdfRoot .logo{top:8pt;left:28pt;width:84pt}
#cpdfRoot .foot{bottom:10pt;left:${PW * 0.125}pt;width:${PW * 0.75}pt}
#cpdfRoot .body{position:absolute;top:66pt;left:30pt;right:30pt;bottom:42pt}
#cpdfRoot h1,#cpdfRoot h2{margin:0;text-align:center;font-weight:700}
#cpdfRoot h1{font-size:15pt;line-height:1.25}
#cpdfRoot h2{font-size:13pt;margin-bottom:4pt}
#cpdfRoot table{border-collapse:collapse;margin:0 auto;table-layout:fixed}
#cpdfRoot td,#cpdfRoot th{border:0.75pt solid #000;padding:0 2pt;font-size:8.5pt;line-height:1.2;overflow:hidden;text-align:center;vertical-align:middle;font-weight:400}
#cpdfRoot th{background:#00B0F0;vertical-align:bottom;line-height:1.15}
#cpdfRoot td.r{text-align:right}
#cpdfRoot td.nw{white-space:nowrap}
#cpdfRoot td.n{color:#9C0006}
#cpdfRoot .ltr{direction:ltr;unicode-bidi:isolate;white-space:nowrap}
#cpdfRoot .date{position:absolute;top:0;left:120pt;font-size:9pt}
#cpdfRoot .notes{margin-top:8pt;font-size:8.5pt;text-align:center;line-height:1.45}
#cpdfRoot .sig{position:absolute;bottom:0;left:40pt;width:62pt}
#cpdfRoot table.sum td,#cpdfRoot table.sum th{height:15pt;font-size:9pt}
#cpdfRoot table.sum th{vertical-align:middle}
#cpdfRoot td.cap{font-weight:700;font-size:12pt;border-bottom:0.75pt solid #000}
`;

  // ---------- הנתונים (כמו בגיליון סקר) ----------
  function data(s) {
    const st = C().settingsOf(s);
    const trees = Core.sortTrees(s.trees).filter(Core.hasContent).filter(t => !t.ref);
    const rows = trees.map(t => {
      const c = C().compute(t, st);
      const name = c.name.trim() ? c.name : '';
      const D = num(t.qty) || 0;
      // AU: כמות לטבלאות המסכמות (עץ עם מין: לפחות 1)
      const qty = name ? (D < 2 ? 1 : D) : 0;
      return { t, c, name, qty, status: c.status, cat: c.N == null ? null : c.cat };
    });
    // סדר המינים בטבלאות המסכמות: כמו ברשימת המינים בתבנית ('חד גזעי'!P), רק מינים שיש בסקר
    const order = new Map(root.ConstructionData.SPECIES.map(([n], i) => [n, i]));
    const species = [...new Set(rows.filter(r => r.name && C().SPECIES.has(r.name)).map(r => r.name))].sort((a, b) => order.get(a) - order.get(b));
    return { st, rows, species };
  }

  function chrome(inner, opts) {
    return `<div class="pg"><div class="abs bsd">בס"ד</div><img class="abs logo" src="template/build-logo.png">` +
      `<div class="body">${inner}</div>` + `<img class="abs foot" src="template/build-footer.png">` + (opts && opts.after || '') + '</div>';
  }

  // ---------- טבלת הסקר (A:R בלי F:H) ----------
  const MAIN_COLS = [
    ['מספר<br>עץ', 30], ['מין העץ', 118], ['כמות<br>עצים', 30], ['גובה<br>עץ<br>(מ\')', 30], ['קוטר<br>גזע<br>(ס"מ)', 34],
    ['מצב<br>בריאותי<br>(0-5)', 42], ['מקום<br>העץ<br>(0-5)', 36], ['ערך<br>מין<br>(0-5)', 32], ['חופת<br>העץ<br>(0-5)', 34], ['סך ערך<br>(0-20)', 38],
    ['אזור<br>שורשים<br>מוגן (מ\')', 46], ['שווי עץ (₪)', 70], ['היתכנות<br>העתקה', 50], ['הערות', 190]];
  const colgroup = cols => '<colgroup>' + cols.map(c => `<col style="width:${c[1]}pt">`).join('') + '</colgroup>';
  const head = cols => '<tr>' + cols.map(c => `<th>${c[0]}</th>`).join('') + '</tr>';
  // שורות לפי גובה (הערה ארוכה נשברת לכמה שורות)
  const lines = r => Math.max(1, Math.ceil(String(r.t.notes || '').trim().length / 52));
  function paginate(rows, first, rest) {
    const pages = [];
    let cur = [], cap = first, used = 0;
    for (const r of rows) {
      const L = lines(r);
      if (cur.length && used + L > cap) { pages.push(cur); cur = []; used = 0; cap = rest; }
      cur.push(r); used += L;
    }
    pages.push(cur);
    return pages;
  }
  function mainRow(r) {
    const t = r.t, c = r.c;
    const nCell = c.N == null ? '<td class="n">#N/A</td>' : `<td class="n" style="background:${CAT_BG[c.cat] || '#fff'}">${c.N}</td>`;
    return '<tr>' +
      `<td class="nw">${esc(t.num)}</td><td class="r nw">${esc(r.name)}</td><td>${esc(num(t.qty) == null ? '' : num(t.qty))}</td><td>${esc(fmtN(num(t.height) || 0))}</td>` +
      `<td>${esc(fmtN(c.I))}</td><td>${esc(num(t.health) || 0)}</td><td>${esc(num(t.loc) || 0)}</td><td>${c.L == null ? '#N/A' : c.L}</td><td>${esc(num(t.canopy) || 0)}</td>` +
      nCell + `<td>${c.O == null ? '#N/A' : esc(fmtN(c.O))}</td><td class="nw" style="text-align:left"><span class="ltr">${money(c.P)}</span></td>` +
      `<td>${esc(C().transplantOf(t))}</td><td class="r">${esc((t.notes || '').trim())}</td></tr>`;
  }
  function mainPages(s, d) {
    const gush = String(s.gush || '').trim(), helka = String(s.helka || '').trim();
    const title = `<div class="date">תאריך: <span class="ltr">${esc(fmtDate(s.date))}</span></div>` +
      `<h1>סקר  עצים להיתר בניה</h1><h1>גוש ${esc(gush)}${gush ? ' ' : '  '}חלקה ${esc(helka)}</h1><h1 style="margin-bottom:6pt">${esc(s.site || '')}</h1>`;
    const notes = `<div class="notes">` +
      (d.st.root4 ? 'אזור שורשים מוגן חושב לעד 4 מ\', לכל היותר, כפי המקובל.<br>' : '') +
      'העצים המסומנים בכחול במפת המדידה, אינם עצים/ אינם קיימים/ אינם עצים בוגרים כהגדרתם בתיקון 89 לחוק התכנון והבניה.<br>' +
      '<b>ממצאי הבדיקה נכונים לזמן הבדיקה בלבד. הסקר אינו סקר בטיחות עצים</b><br>בברכה, אגרונום B.Sc.Agr<br>יערן עירוני וגוזם מומחה, אורי אייגנר</div>';
    const sig = root.Sig && root.Sig.has ? `<img class="sig" src="${root.Sig.src}">` : '';
    return paginate(d.rows, 22, 31).map((rows, i) =>
      chrome((i === 0 ? title : '') + `<table>${colgroup(MAIN_COLS)}${head(MAIN_COLS)}${rows.map(mainRow).join('')}</table>` +
        (i === 0 ? notes + sig : '')));
  }

  // ---------- טבלת מידע מרכזת (AS:BC) ----------
  const CENTRAL_COLS = [['מספר<br>עץ', 32], ['מין העץ', 130], ['כמות<br>עצים', 34], ['גובה עץ<br>(מ\')', 40], ['גזע 1', 34], ['גזע 2', 34], ['גזע 3', 34],
    ['קוטר<br>משוקלל', 44], ['סך ערך<br>(0-20)', 54], ['ערכיות העץ', 70], ['סטאטוס מוצע', 92]];
  function centralRow(r) {
    const t = r.t, c = r.c, sc = ST[r.status];
    return '<tr>' + `<td class="nw">${esc(t.num)}</td><td class="r nw">${esc(r.name)}</td><td>${r.qty}</td><td>${esc(fmtN(num(t.height) || 0))}</td>` +
      `<td>${esc(num(t.f1) || 0)}</td><td>${esc(num(t.f2) || 0)}</td><td>${esc(num(t.f3) || 0)}</td><td>${esc(fmtN(c.I))}</td>` +
      `<td style="background:#A6A6A6">${c.N == null ? '#N/A' : c.N}</td>` +
      `<td style="background:${r.cat ? CAT_BG[r.cat] : '#fff'}">${r.cat == null ? '#N/A' : esc(r.cat)}</td>` +
      `<td class="nw" style="${sc ? `background:${sc[0]};color:${sc[1]}` : ''}">${esc(r.status)}</td></tr>`;
  }
  function centralPages(d) {
    const hd = CENTRAL_COLS.map((c, i) => `<th style="${i >= 4 && i <= 7 ? 'background:#FFFF00' : ''}">${c[0]}</th>`).join('');
    return paginate(d.rows.map(r => Object.assign({}, r, { t: Object.assign({}, r.t, { notes: '' }) })), 28, 31).map((rows, i) =>
      chrome((i === 0 ? '<h2>טבלת מידע מרכזת</h2>' : '') + `<table>${colgroup(CENTRAL_COLS)}<tr>${hd}</tr>${rows.map(centralRow).join('')}</table>`));
  }

  // ---------- טבלאות מסכמות ----------
  // כותרת: שם הטבלה מעל עמודות הערכים, ומימין עמודת "מין העץ" (כמו בתבנית)
  function sumTable(title, cols, rowsHtml, w) {
    return `<table class="sum">${colgroup([['', w[0]], ...cols.map(c => ['', c[2] || w[1]])])}` +
      `<tr><td rowspan="2" style="vertical-align:middle">מין העץ</td><td class="cap" colspan="${cols.length}">${esc(title)}</td></tr>` +
      '<tr>' + cols.map(c => `<th style="background:${c[1]};color:${c[3] || '#000'}">${c[0]}</th>`).join('') + '</tr>' + rowsHtml + '</table>';
  }
  function valuePage(d) {
    const cats = [['ערכיות גבוהה מאוד', 'גבוה מאוד', '#FF0000', '#963634'], ['ערכיות גבוהה', 'גבוה', '#92D050', '#76933C'],
      ['ערכיות בינונית', 'בינונית', '#BFBFBF', '#808080'], ['ערכיות נמוכה', 'נמוכה', '#FFFF00', '#FFC000']];
    const cnt = (sp, cat) => d.rows.filter(r => r.name === sp && r.cat === cat).reduce((a, r) => a + r.qty, 0);
    let body = '';
    for (const sp of d.species) {
      const v = cats.map(c => cnt(sp, c[1])), tot = v.reduce((a, b) => a + b, 0);
      body += `<tr><td class="r nw">${esc(sp)}</td>${v.map(x => `<td>${x || ''}</td>`).join('')}<td>${tot}</td></tr>`;
    }
    body += `<tr><td></td>${cats.map(() => '<td></td>').join('')}<td></td></tr>`.repeat(2);
    // הסיכום רק על המינים שבטבלה (מין שלא ברשימה לא נספר, כמו באקסל)
    const tots = cats.map(c => d.species.reduce((a, sp) => a + cnt(sp, c[1]), 0)), all = tots.reduce((a, b) => a + b, 0);
    body += `<tr><td class="r"><b>סה"כ עצים</b></td>${tots.map((x, i) => `<td style="background:${cats[i][2]}">${x}</td>`).join('')}<td style="background:#00B0F0">${all}</td></tr>`;
    body += `<tr><td class="r">אחוזים מכלל העצים</td>${tots.map((x, i) => `<td style="background:${cats[i][3]}">${pct(x, all)}</td>`).join('')}<td style="background:#31869B">${all ? '100%' : '0%'}</td></tr>`;
    return chrome(sumTable('טבלה מסכמת - קביעת ערכיות העצים', cats.map(c => [c[0], c[2]]).concat([['סה"כ', '#fff']]), body, [130, 78]));
  }
  function statusPage(d) {
    const sts = [['שימור', '#FF0000', '#963634', '#fff'], ['כריתה', '#FFFF00', '#FFFF00'], ['העתקה', '#FFC000', '#E26B0A'], ['לא נדרש ברישיון', '#0070C0', '#31869B', '#fff']];
    const cnt = (sp, k) => d.rows.filter(r => r.name === sp && r.status === k).reduce((a, r) => a + r.qty, 0);
    let body = '';
    for (const sp of d.species) {
      const v = sts.map(x => cnt(sp, x[0])), tot = v.reduce((a, b) => a + b, 0);
      body += `<tr><td class="r nw">${esc(sp)}</td>${v.map(x => `<td>${x || ''}</td>`).join('')}<td>${tot}</td></tr>`;
    }
    body += `<tr><td></td>${sts.map(() => '<td></td>').join('')}<td></td></tr>`.repeat(2);
    const tots = sts.map(x => d.species.reduce((a, sp) => a + cnt(sp, x[0]), 0)), all = tots.reduce((a, b) => a + b, 0);
    // ערך חליפי: סכום השווי לפי סטאטוס (שימור, כריתה, העתקה; ללא "לא נדרש ברישיון", כמו בתבנית)
    const val = sts.map((x, i) => i < 3 ? d.rows.filter(r => r.status === x[0]).reduce((a, r) => a + (r.c.P || 0), 0) : null);
    const vAll = val.reduce((a, b) => a + (b || 0), 0);
    body += `<tr><td class="r">סה"כ כמות עצים</td>${tots.map(x => `<td style="background:#92D050">${x}</td>`).join('')}<td style="background:#FFFF00">${all}</td></tr>`;
    body += `<tr><td class="r">סה"כ ערך חליפי</td>${val.map((x, i) => `<td class="nw" style="background:${sts[i][1]};color:${sts[i][3] || '#000'}">${x == null ? '' : `<span class="ltr">${moneyAcc(x)}</span>`}</td>`).join('')}` +
      `<td class="nw" style="background:#0070C0;color:#fff"><span class="ltr">${moneyAcc(vAll)}</span></td></tr>`;
    body += `<tr><td class="r">אחוזים מכלל העצים</td>${tots.map((x, i) => `<td style="background:${sts[i][2]};color:${i === 0 || i === 3 ? '#fff' : '#000'}">${pct(x, all)}</td>`).join('')}<td style="background:#0070C0;color:#fff">${all ? '100%' : '0%'}</td></tr>`;
    // עמודות רחבות מספיק לסכום שלם (בלי ### כמו באקסל): לפי הסכום הארוך ביותר
    const longest = Math.max(...val.concat(vAll).map(v => moneyAcc(v || 0).length));
    const w = Math.max(78, Math.ceil(longest * 6.2 + 12));
    return chrome(sumTable('טבלה מסכמת - קביעת סטאטוס עצים', sts.map(x => [x[0], x[1], w, x[3]]).concat([['סה"כ', '#00B0F0', w]]), body, [130, w]));
  }

  // ---------- כל הדוח ----------
  // getPhotoBlob(id) -> Blob. onProgress(text)
  async function build(s, getPhotoBlob, onProgress) {
    const say = m => onProgress && onProgress(m);
    if (root.Sig) await root.Sig.load().catch(() => null);
    const d = data(s);
    say('מכין את הטבלאות…');
    const pages = [...mainPages(s, d), valuePage(d), ...centralPages(d), statusPage(d)];
    await root.ReportPrint.preloadFonts();
    const tables = await root.PdfVec.fromHtml(pages, { rootId: 'cpdfRoot', css: CSS, widthPt: PW });
    const items = C().photoSlots(s.trees).map(sl => ({ label: sl.label, id: sl.photo.id }));
    if (!items.length) return { blob: tables, pages: pages.length };
    const photos = await root.ReportPrint.photosPdf(items, getPhotoBlob, (i, n) => say(`מכין את התמונות… ${i}/${n}`));
    // שני הקבצים לקובץ אחד
    const { PDFDocument } = root.PDFLib;
    const out = await PDFDocument.create();
    let n = 0;
    for (const b of [tables, photos]) {
      const src = await PDFDocument.load(await b.arrayBuffer());
      for (const p of await out.copyPages(src, src.getPageIndices())) { out.addPage(p); n++; }
    }
    return { blob: new Blob([await out.save()], { type: 'application/pdf' }), pages: n };
  }

  root.ConstructionPdf = { build, data, CSS };
})(self);

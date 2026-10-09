// הפקת PDF של הדוח, כמו "הפק PDF" בתוכנה במחשב (שם זה ייצוא של אקסל):
// מכתב + טבלה + נספח תמונות, שורות צהובות מוסתרות, ורק עמודים שיש בהם משהו.
// סקר בלי אף עץ יוצא כמכתב אישור קצר, כמו "אישורי תקינות".
// הציור נעשה ב-HTML לפי מבנה התבנית (template/layout.json, נוצר ב-tools/extract_layout.py),
// ומומר לקובץ PDF בתוך האפליקציה (toPdf).
(function (root) {
  'use strict';
  // מדידות מתוך PDF אמיתי שאקסל הפיק מהתבנית (184838 גן בית הכרם)
  const PAGE_W = 595.2, PAGE_H = 841.68;
  const PT_PER_CHAR = 5.868; // רוחב עמודה: נקודות לכל יחידת רוחב של אקסל
  const Y0 = 90.7, KY = 0.918; // שורה 1 מתחילה ב-90.7 נק', וגובה שורה מודפס = 0.918 מהגובה בגיליון
  const PAGE_STARTS = [56, 111, 164];
  const SHEET_PAGE_H = 759; // כמה גובה גיליון נכנס בעמוד
  const RIGHT_EDGE = 578; // הקצה הימני של עמודה A / K
  const FONT_K = 0.93; // גודל הגופן המודפס ביחס לגודל בגיליון
  const PAD = 2.2;

  let layoutP = null;
  const getLayout = () => layoutP || (layoutP = fetch('template/layout.json').then(r => r.json()));

  const colLetter = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };

  // הערכים שהאפליקציה כותבת לגיליון (כמו excel.js), לפי כתובת תא
  function sheetValues(survey, slots) {
    const v = {}, imgs = {};
    const place = Core.placeOf(survey);
    if (survey.code) v.B5 = survey.code; else v.A5 = ''; // בלי סמל מוסד / מנהל: גם הכותרת לא מודפסת
    if (survey.manager) v.B6 = survey.manager; else v.A6 = '';
    if (place.name) v.F9 = place.name;
    if (place.address) v.D10 = place.address;
    if (survey.date) { v.F2 = fmtDate(survey.date); v.B14 = fmtDate(survey.date); }
    const trees = Core.sortTrees(survey.trees).filter(Core.hasContent).slice(0, Core.MAX_TREES);
    trees.forEach((t, i) => {
      const r = Core.TREE_ROWS[i];
      v['A' + r] = String(t.num || '').trim();
      v['B' + r] = (t.species || '').trim();
      v['D' + r] = (t.notes || '').trim();
      v['I' + r] = (t.urgency || '').trim();
    });
    const SR = SurveyExcel.SLOT_ROWS;
    slots.forEach((slot, i) => {
      const block = Math.floor(i / 4), col = colLetter(11 + (i % 4));
      v[col + SR[block].label] = slot.label;
      imgs[col + SR[block].img] = slot.photo.id;
    });
    return { v, imgs, trees };
  }

  // כמו בתוכנה במחשב: שורות צהובות לא מודפסות; עמוד 2/3 נפתחים לפי כמות העצים והתמונות (כמו באקסל)
  // כל אזור נפתח לפי מה שיש בו: טבלת העצים (A:I) לפי מספר העצים, הנספח (K:N) לפי מספר התמונות,
  // כדי שלא יודפס עמוד טבלה ריק רק בגלל שיש הרבה תמונות (ולהפך)
  function visibleRows(L, n, per2, per3) {
    const show = {};
    for (let r = 1; r <= L.lastRow; r++) show[r] = !L.rows[r][1];
    if (n > per2) SurveyExcel.PAGE2_ROWS.forEach(r => { show[r] = true; });
    if (n > per3) SurveyExcel.PAGE3_ROWS.forEach(r => { show[r] = true; });
    for (const r of L.yellow) show[r] = false;
    return show;
  }

  function borderCss(spec) {
    if (!spec) return null;
    const [style, color] = spec;
    const w = { hair: 0.4, thin: 0.6, medium: 1.3, thick: 2, double: 2, dashed: 0.6, dotted: 0.6, mediumDashed: 1.3 }[style] || 0.6;
    const st = /dash/i.test(style) ? 'dashed' : /dot/i.test(style) ? 'dotted' : style === 'double' ? 'double' : 'solid';
    return { w, css: `${w}pt ${st} #${color || '000'}` };
  }

  function textHtml(cell, value, style) {
    if (value != null) return esc(value);
    if (cell && cell.rt) {
      return cell.rt.map(([t, f]) => {
        const st = [];
        if (f && f.b) st.push('font-weight:700'); else if (f) st.push('font-weight:400');
        if (f && f.sz) st.push(`font-size:${f.sz * FONT_K}pt`);
        return `<span style="${st.join(';')}">${esc(t)}</span>`;
      }).join('');
    }
    if (cell && cell.t != null) return esc(cell.t);
    return '';
  }

  // מצייר אזור הדפסה אחד (A:I או K:N) לעמודים
  function renderArea(L, area, show, vals, photoUrls) {
    const [c0, c1] = area;
    // עמודה J לא מודפסת, אבל המיזוגים A:J (ההמלצות) ממורכזים עליה. בדוחות של אורי J ברוחב 6.375
    const colW = c => (c === 10 ? 6.375 : (L.cols[c] || 9.05)) * PT_PER_CHAR;
    // מיקום הקצה הימני של כל עמודה (הגיליון מימין לשמאל)
    const xRight = {};
    let x = RIGHT_EDGE;
    for (let c = c0; c <= c1 + 1; c++) { xRight[c] = x; x -= colW(c); }
    const areaLeft = xRight[c1] - colW(c1);
    const PAGE_LEFT = L.margins.left || 18; // טקסט שגולש מעבר לאזור ההדפסה עדיין מודפס (כמו באקסל), עד שולי הדף

    const merges = new Map(); const inMerge = new Map();
    for (const m of L.merges) {
      const [r0, mc0, r1, mc1] = m;
      merges.set(colLetter(mc0) + r0, m);
      for (let r = r0; r <= r1; r++) for (let c = mc0; c <= mc1; c++) inMerge.set(colLetter(c) + r, m);
    }
    const cellAt = ref => L.cells[ref];
    const valueOf = ref => {
      if (vals.v[ref] != null) return vals.v[ref];
      const cell = cellAt(ref);
      if (!cell) return null;
      if (cell.fx) return null; // נוסחאות של התבנית: האפליקציה ממלאת את מה שצריך בעצמה
      return null;
    };
    const hasText = ref => {
      if (vals.v[ref] != null && vals.v[ref] !== '') return true;
      const cell = cellAt(ref);
      return !!(cell && (cell.t != null || cell.rt));
    };

    // חלוקה לעמודים
    const rows = [];
    for (let r = 1; r <= L.lastRow; r++) if (show[r]) rows.push(r);
    const pages = [];
    let page = [], acc = 0;
    for (const r of rows) {
      const hh = L.rows[r][0];
      // כל עמוד בתבנית (שורות 1-55, 56-110, 111-163) מתחיל עמוד חדש, כמו שהתבנית בנויה
      if (page.length && (acc + hh > SHEET_PAGE_H || PAGE_STARTS.includes(r))) { pages.push(page); page = []; acc = 0; }
      page.push(r); acc += hh;
    }
    if (page.length) pages.push(page);

    const out = [];
    for (const pr of pages) {
      const top = {}, bottom = {};
      let y = 0;
      for (const r of pr) { top[r] = Y0 + KY * y; y += L.rows[r][0]; bottom[r] = Y0 + KY * y; }
      const onPage = new Set(pr);
      const parts = [];
      let content = false;

      // רקע ומסגרות לכל תא
      for (const r of pr) for (let c = c0; c <= c1; c++) {
        const ref = colLetter(c) + r;
        const cell = cellAt(ref);
        const st = cell && cell.s != null ? L.styles[cell.s] : null;
        if (!st) continue;
        const x1 = xRight[c], x0 = x1 - colW(c), y0 = top[r], y1 = bottom[r];
        if (st.bg) { parts.push(`<div class="pf" style="left:${x0}pt;top:${y0}pt;width:${x1 - x0}pt;height:${y1 - y0}pt;background:#${st.bg}"></div>`); content = true; }
        if (st.b) {
          // בגיליון מימין לשמאל, "שמאל" ו"ימין" של המסגרת מתהפכים
          const sides = { t: st.b.t, b: st.b.b, r: st.b.l, l: st.b.r };
          const mm = inMerge.get(ref);
          for (const [side, spec] of Object.entries(sides)) {
            const b = borderCss(spec);
            if (!b) continue;
            // בתוך תא ממוזג אין קווים פנימיים
            if (mm && ((side === 't' && r > mm[0]) || (side === 'b' && r < mm[2]) || (side === 'r' && c > mm[1]) || (side === 'l' && c < mm[3]))) continue;
            content = true;
            if (side === 't' || side === 'b') {
              const yy = side === 't' ? y0 : y1;
              parts.push(`<div class="pb" style="left:${x0}pt;top:${yy - b.w / 2}pt;width:${x1 - x0}pt;height:0;border-top:${b.css}"></div>`);
            } else {
              const xx = side === 'r' ? x1 : x0;
              parts.push(`<div class="pb" style="left:${xx - b.w / 2}pt;top:${y0}pt;width:0;height:${y1 - y0}pt;border-left:${b.css}"></div>`);
            }
          }
        }
      }

      // טקסט ותמונות
      for (const r of pr) for (let c = c0; c <= c1; c++) {
        const ref = colLetter(c) + r;
        const m = inMerge.get(ref);
        if (m && (m[0] !== r && onPage.has(m[0]) || m[1] !== c)) continue; // לא התא הראשי של המיזוג
        const cell = cellAt(ref);
        const st = (cell && cell.s != null ? L.styles[cell.s] : null) || { f: {} };
        let x1 = xRight[c], x0 = x1 - colW(c), y0 = top[r], y1 = bottom[r];
        if (m) {
          x1 = xRight[m[1]];
          x0 = xRight[m[3]] - colW(m[3]);
          const mr = pr.filter(rr => rr >= m[0] && rr <= m[2]);
          y0 = top[mr[0]]; y1 = bottom[mr[mr.length - 1]];
        }
        const photoId = vals.imgs[ref];
        if (photoId && photoUrls[photoId]) {
          content = true;
          parts.push(`<div class="pi" style="left:${x0 + 1.5}pt;top:${y0 + 1.5}pt;width:${x1 - x0 - 3}pt;height:${y1 - y0 - 3}pt"><img src="${photoUrls[photoId]}"></div>`);
          continue;
        }
        if (st.nf === ';;;') continue;
        const html = textHtml(cell, valueOf(ref), st);
        if (!html) continue;
        content = true;
        const h = st.h || 'right';
        // טקסט שלא נכנס גולש לתאים ריקים שלידו (כמו באקסל), עד גבול אזור ההדפסה
        if (!m && !st.w) {
          const free = dir => { // dir=+1 שמאלה (עמודות הבאות), -1 ימינה
            let cc = c + dir, edge = dir > 0 ? x0 : x1;
            while (cc >= c0 && cc <= c1 && !hasText(colLetter(cc) + r) && !inMerge.get(colLetter(cc) + r)) {
              edge = dir > 0 ? xRight[cc] - colW(cc) : xRight[cc]; cc += dir;
            }
            if (dir > 0 && cc > c1) edge = PAGE_LEFT;
            return edge;
          };
          if (h === 'right' || h === 'general') x0 = free(1);
          else if (h === 'left') x1 = free(-1);
          else if (h === 'center' || h === 'centerContinuous') {
            const l = free(1), rr = free(-1), cx = (x0 + x1) / 2, half = Math.min(cx - l, rr - cx);
            x0 = cx - half; x1 = cx + half;
          }
        }
        x0 = Math.max(x0, PAGE_LEFT); x1 = Math.min(x1, RIGHT_EDGE);
        const f = st.f || {};
        const css = [`left:${x0}pt`, `top:${y0}pt`, `width:${x1 - x0}pt`, `height:${y1 - y0}pt`,
          `font-size:${(f.sz || 11) * FONT_K}pt`, f.b ? 'font-weight:700' : '', f.i ? 'font-style:italic' : '', f.u ? 'text-decoration:underline' : '',
          f.c ? `color:#${f.c}` : '',
          `justify-content:${{ left: 'flex-end', center: 'center', centerContinuous: 'center' }[h] || 'flex-start'}`,
          `align-items:${{ top: 'flex-start', center: 'center' }[st.v] || 'flex-end'}`,
          st.w ? 'white-space:pre-wrap' : 'white-space:pre'].filter(Boolean).join(';');
        parts.push(`<div class="pt" style="${css}"><span style="text-align:${{ left: 'left', center: 'center' }[h] || 'right'}">${html}</span></div>`);
      }

      // חותמת ותמונות שמעוגנות בגיליון
      for (const a of L.anchors) {
        if (!onPage.has(a.row) || a.col < c0 || a.col > c1) continue;
        const xr = xRight[a.col] - a.colOff * KY, yt = top[a.row] + a.rowOff * KY;
        parts.push(`<img class="pa" src="template/${a.img}.png" style="left:${xr - a.w * KY}pt;top:${yt}pt;width:${a.w * KY}pt;height:${a.h * KY}pt">`);
      }

      if (content) out.push(parts.join(''));
    }
    return out;
  }

  function pageHtml(L, inner) {
    const lh = L.images.letterhead, ft = L.images.footer;
    const mL = (L.margins.left || 18), hdr = (L.margins.header || 21.6), ftr = (L.margins.footer || 21.6);
    return `<section class="pg">` +
      (lh ? `<img class="pa" src="template/letterhead.png" style="left:${mL - 1}pt;top:${hdr}pt;width:${lh.w}pt;height:${lh.h}pt">` : '') +
      inner +
      (ft ? `<img class="pa" src="template/footer.png" style="left:${(PAGE_W - ft.w) / 2}pt;top:${PAGE_H - ftr - ft.h}pt;width:${ft.w}pt;height:${ft.h}pt">` : '') +
      `</section>`;
  }

  // מכתב אישור לסקר בלי עצים, כמו HealthySurveyPdfGenerator בתוכנה במחשב
  function letterHtml(L, survey) {
    const place = Core.placeOf(survey);
    const t = ref => { const c = L.cells[ref]; return c ? (c.t != null ? c.t : c.rt ? c.rt.map(x => x[0]).join('') : '') : ''; };
    const date = fmtDate(survey.date);
    const line = (txt, top, opts) => {
      opts = opts || {};
      return `<div class="pt" style="left:${opts.left || 30}pt;top:${top}pt;width:${opts.width || 535}pt;height:16pt;font-size:${opts.sz || 10.6}pt;${opts.b ? 'font-weight:700;' : ''}justify-content:${opts.align || 'center'};align-items:flex-end;white-space:pre"><span>${esc(txt)}</span></div>`;
    };
    const parts = [];
    parts.push(line('בס"ד', 104 - 13, { left: 400, width: 175.8, align: 'flex-start' }));
    parts.push(line('תאריך: ' + date, 117 - 13, { left: 200, width: 160, align: 'flex-start' }));
    let y = 156;
    if (survey.code) { parts.push(line('סמל מוסד: ' + survey.code, y - 13, { left: 300, width: 275.8, align: 'flex-start' })); y += 14; }
    if (survey.manager) parts.push(line('מנהל/ת: ' + survey.manager, y - 13, { left: 300, width: 275.8, align: 'flex-start' }));
    parts.push(line(`סקר בטיחות עצים  ${place.name}`.trim(), 216 - 17, { sz: 17.3, b: 1, left: 20, width: 555.2 }));
    if (place.address) parts.push(line(place.address, 241 - 17, { sz: 17.3, b: 1, left: 20, width: 555.2 }));
    y = 258;
    const body = [t('C14').replace(/^\s+|\s+$/g, ''), t('E15')];
    parts.push(line(`בתאריך ${date} ${body[0]}`, y - 12, { left: 70, width: 530 }));
    y += 14;
    parts.push(line(body[1], y - 12, { left: 70, width: 530 }));
    y += 14;
    for (const ref of ['E16', 'E17']) { parts.push(line(t(ref), y - 12, { b: 1, sz: 11.5, left: 70, width: 530 })); y += 14; }
    // המלצות (שורות 48 ואילך בתבנית) ממורכזות, ואז "ממצאי הבדיקה", חתימה וחותמת
    y = PAGE_H - 176;
    for (const ref of ['A48', 'A49', 'A50', 'A51']) { const s = t(ref); if (s) { parts.push(line(s, y - 12, { left: 38, width: 549 })); y += 13; } }
    parts.push(line(t('E52'), y - 12, { b: 1, sz: 11.5 })); y += 14;
    parts.push(line(t('E53'), y - 12));
    parts.push(`<img class="pa" src="template/stamp.png" style="left:67.2pt;top:${PAGE_H - 111.3 - 49.7}pt;width:58.8pt;height:49.7pt">`);
    return pageHtml(L, parts.join(''));
  }

  async function buildPages(survey, photoUrls) {
    const L = await getLayout();
    const slots = Core.reportSlots(survey.trees).slice(0, Core.MAX_PRINTED);
    const vals = sheetValues(survey, slots);
    if (!vals.trees.length) return [letterHtml(L, survey)];
    const shows = [visibleRows(L, vals.trees.length, 22, 62), visibleRows(L, slots.length, 8, 16)];
    const pages = [];
    L.areas.forEach((area, i) => { for (const inner of renderArea(L, area, shows[i], vals, photoUrls)) pages.push(pageHtml(L, inner)); });
    return pages;
  }

  const CSS = `
@font-face{font-family:RepArial;src:url(fonts/arimo-hebrew-400-normal.woff2) format('woff2');font-display:swap;font-weight:400;unicode-range:U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F}
@font-face{font-family:RepArial;src:url(fonts/arimo-latin-400-normal.woff2) format('woff2');font-display:swap;font-weight:400;unicode-range:U+0000-00FF,U+2000-206F}
@font-face{font-family:RepArial;src:url(fonts/arimo-hebrew-700-normal.woff2) format('woff2');font-display:swap;font-weight:700;unicode-range:U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F}
@font-face{font-family:RepArial;src:url(fonts/arimo-latin-700-normal.woff2) format('woff2');font-display:swap;font-weight:700;unicode-range:U+0000-00FF,U+2000-206F}
#printRoot{display:none}
#printRoot .pg{position:relative;width:${PAGE_W}pt;height:${PAGE_H}pt;overflow:hidden;background:#fff;page-break-after:always;break-after:page;font-family:RepArial,Arial,sans-serif;color:#000;direction:rtl}
#printRoot .pg:last-child{page-break-after:auto;break-after:auto}
#printRoot .pa,#printRoot .pf,#printRoot .pb,#printRoot .pt,#printRoot .pi{position:absolute;box-sizing:border-box}
#printRoot .pt{display:flex;overflow:hidden;padding:0 ${PAD}pt 0.6pt;line-height:1.08;direction:rtl}
#printRoot .pi{display:flex;align-items:center;justify-content:center}
#printRoot .pi img{max-width:100%;max-height:100%;object-fit:contain}
@media print{
  @page{size:A4;margin:0}
  html,body{margin:0!important;padding:0!important;background:#fff!important}
  body>*:not(#printRoot){display:none!important}
  #printRoot{display:block}
}`;

  // הגופן נטען מראש כשהאפליקציה עולה, כדי שההדפסה תהיה מיידית
  function ensureStyle() {
    let style = document.getElementById('printStyle');
    if (!style) { style = document.createElement('style'); style.id = 'printStyle'; style.textContent = CSS; document.head.append(style); }
  }
  function preloadFonts() {
    ensureStyle();
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all(['400 10pt RepArial', '700 10pt RepArial'].map(f => document.fonts.load(f, 'אבג abc 123').catch(() => {})));
  }

  // ---------- קובץ PDF אמיתי ----------
  // כל עמוד מצויר לתמונה (SVG עם HTML בתוכו -> canvas -> JPEG) ונארז לקובץ PDF.
  // כך ה-PDF נוצר בתוך האפליקציה, בלי חלון הדפסה, ואפשר להעלות אותו ל-OneDrive ליד האקסל.
  const SCALE = 2; // ~190 DPI: חד בהדפסה, וקובץ קטן
  const PX = 96 / 72;
  const dataUrlCache = {};
  const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  const urlToDataUrl = u => dataUrlCache[u] || (dataUrlCache[u] = fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.blob(); }).then(blobToDataUrl));

  async function fontCss() {
    const faces = [['hebrew', 400], ['latin', 400], ['hebrew', 700], ['latin', 700]];
    const urls = await Promise.all(faces.map(([sub, w]) => urlToDataUrl(`fonts/arimo-${sub}-${w}-normal.woff2`)));
    return faces.map(([sub, w], i) => `@font-face{font-family:RepArial;src:url(${urls[i]}) format('woff2');font-weight:${w};unicode-range:${sub === 'hebrew' ? 'U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F' : 'U+0000-00FF,U+2000-206F'}}`).join('');
  }

  // תמונה קטנה יותר לדוח: התא בנספח ברוחב ~5 ס"מ, אין טעם לשמור 4000 פיקסלים
  async function shrink(blob, maxSide) {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  }

  function loadImg(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('ציור העמוד נכשל')); im.src = src; });
  }

  async function pageToJpeg(xhtml, css) {
    const W = PAGE_W * PX, H = PAGE_H * PX;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" id="printRoot" style="display:block"><style>${css}</style>${xhtml}</div></foreignObject></svg>`;
    // data: ולא blob: — אחרת כרום מסמן את הציור כ"לא בטוח" ולא מאפשר לשמור אותו
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    {
      const im = await loadImg(url);
      await new Promise(r => setTimeout(r, 30));
      const c = document.createElement('canvas');
      c.width = Math.round(W * SCALE); c.height = Math.round(H * SCALE);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(im, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height };
    }
  }

  // כותב PDF פשוט: עמוד A4 לכל תמונה
  function makePdf(images) {
    const enc = new TextEncoder();
    const chunks = []; let len = 0; const offs = [];
    const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
    const obj = (n, body) => { offs[n] = len; put(`${n} 0 obj\n`); body(); put('\nendobj\n'); };
    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const n = images.length, kids = [];
    for (let i = 0; i < n; i++) kids.push(`${3 + i * 3} 0 R`);
    obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => put(`<< /Type /Pages /Count ${n} /Kids [${kids.join(' ')}] >>`));
    images.forEach((im, i) => {
      const pg = 3 + i * 3, cs = pg + 1, xo = pg + 2;
      obj(pg, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /XObject << /Im0 ${xo} 0 R >> >> /Contents ${cs} 0 R >>`));
      const content = `q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /Im0 Do Q`;
      obj(cs, () => put(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
      obj(xo, () => { put(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`); put(im.bytes); put('\nendstream'); });
    });
    const total = 3 + n * 3;
    const xref = len;
    let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let k = 1; k < total; k++) x += String(offs[k]).padStart(10, '0') + ' 00000 n \n';
    put(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(chunks, { type: 'application/pdf' });
  }

  // מפיק את הדוח כקובץ PDF. getPhotoBlob(id) מחזיר את התמונה (מהטאבלט או מהענן)
  async function toPdf(survey, getPhotoBlob, onProgress) {
    const photoUrls = {};
    const slots = Core.reportSlots(survey.trees).slice(0, Core.MAX_PRINTED);
    for (const s of slots) {
      if (photoUrls[s.photo.id]) continue;
      const b = await getPhotoBlob(s.photo.id);
      if (b) photoUrls[s.photo.id] = await blobToDataUrl(await shrink(b, 900));
    }
    const pages = await buildPages(survey, photoUrls);
    const imgs = {};
    for (const n of ['letterhead', 'footer', 'stamp']) imgs[`template/${n}.png`] = await urlToDataUrl(`template/${n}.png`);
    const css = (await fontCss()) + CSS.replace(/@font-face\{[^}]*\}/g, '').replace('#printRoot{display:none}', '');
    const holder = document.createElement('div');
    const out = [];
    for (let i = 0; i < pages.length; i++) {
      if (onProgress) onProgress(i + 1, pages.length);
      holder.innerHTML = pages[i].replace(/src="(template\/[a-z]+\.png)"/g, (m, u) => `src="${imgs[u]}"`);
      const xhtml = new XMLSerializer().serializeToString(holder.firstElementChild);
      out.push(await pageToJpeg(xhtml, css));
    }
    return { blob: makePdf(out), pages: pages.length };
  }

  // העמודים של PDF שהאפליקציה יצרה (כל עמוד הוא תמונת JPEG אחת), לתצוגה בתוך האפליקציה
  async function pdfPages(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    const re = /\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/g;
    const out = [];
    let m;
    while ((m = re.exec(text))) {
      const start = m.index + m[0].length, n = +m[1];
      out.push(new Blob([bytes.subarray(start, start + n)], { type: 'image/jpeg' }));
      re.lastIndex = start + n;
    }
    return out;
  }

  function fileTitle(survey) {
    const place = Core.placeOf(survey);
    return (place.name ? `${survey.code ? survey.code + ' ' : ''}${place.name}` : 'סקר בטיחות עצים').replace(/[\\/:*?"<>|]+/g, ' ');
  }

  root.ReportPrint = { toPdf, pdfPages, buildPages, preloadFonts, fileTitle, CSS };
})(self);

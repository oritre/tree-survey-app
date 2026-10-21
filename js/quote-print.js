// PDF של הצעת מחיר: מצייר את מסמך ה-Word (כותרת עליונה, פסקאות, רשימות, תמונות, כותרת תחתונה) בעמודי A4
// ומשתמש באותו מנגנון של דוח הסקר (ReportPrint) כדי להפוך את העמודים לקובץ PDF
(function (root) {
  'use strict';
  const EMU = 12700, TW = 20; // EMU / טוויפים -> נקודות
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const unesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const attr = (xml, tag, name) => { const m = new RegExp(`<w:${tag}\\b[^>]*\\bw:${name}="([^"]*)"`).exec(xml || ''); return m ? m[1] : null; };
  const has = (xml, tag) => { const m = new RegExp(`<w:${tag}(?:\\s[^>]*)?/?>`).exec(xml || ''); return !!m && !/w:val="(0|false)"/.test(m[0]); };
  const pPrOf = xml => (/^<w:p\b[^>]*>\s*(<w:pPr>[\s\S]*?<\/w:pPr>)/.exec(xml) || [])[1] || '';
  const rPrOf = s => (/^\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(s) || [])[1] || '';

  const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

  // ---------- קריאת התבנית ----------
  async function context(zip) {
    const read = async n => { const f = zip.file(n); return f ? f.async('string') : ''; };
    const styles = await read('word/styles.xml');
    const ctx = { styles: {}, num: {}, defSz: 22, defAfter: 0, defLine: 240 };
    const dd = /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(styles);
    if (dd) {
      const sz = attr(dd[0], 'sz', 'val'); if (sz) ctx.defSz = +sz;
      const sp = /<w:pPrDefault>[\s\S]*?<\/w:pPrDefault>/.exec(dd[0]);
      if (sp) { const a = attr(sp[0], 'spacing', 'after'), l = attr(sp[0], 'spacing', 'line'); if (a) ctx.defAfter = +a; if (l) ctx.defLine = +l; }
    }
    for (const m of styles.matchAll(/<w:style\b[^>]*w:type="paragraph"[^>]*>[\s\S]*?<\/w:style>/g)) {
      const id = attr(m[0], 'style', 'styleId');
      ctx.styles[id] = { xml: m[0], base: attr(m[0], 'basedOn', 'val'), def: /w:default="1"/.test(m[0]) };
      if (ctx.styles[id].def) ctx.defStyle = id;
    }
    const numXml = await read('word/numbering.xml');
    const abs = {};
    for (const m of numXml.matchAll(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g)) {
      const id = attr(m[0], 'abstractNum', 'abstractNumId');
      const lvl = /<w:lvl w:ilvl="0"[\s\S]*?<\/w:lvl>/.exec(m[0]);
      if (lvl) abs[id] = { fmt: attr(lvl[0], 'numFmt', 'val'), text: attr(lvl[0], 'lvlText', 'val') || '', left: +(attr(lvl[0], 'ind', 'left') || attr(lvl[0], 'ind', 'start') || 0), hanging: +(attr(lvl[0], 'ind', 'hanging') || 0), start: +(attr(lvl[0], 'start', 'val') || 1) };
    }
    for (const m of numXml.matchAll(/<w:num w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId w:val="(\d+)"/g)) ctx.num[m[1]] = abs[m[2]];
    // תמונות לפי קובץ קשרים (rels) של כל חלק
    ctx.media = {};
    ctx.rels = async part => {
      const r = await read(part.replace(/^word\//, 'word/_rels/') + '.rels');
      const map = {};
      for (const m of r.matchAll(/<Relationship\b([^>]*)\/>/g)) {
        const id = /Id="([^"]+)"/.exec(m[1])[1], target = /Target="([^"]+)"/.exec(m[1])[1];
        if (!/image/.test(m[1])) continue;
        const path = 'word/' + target.replace(/^\.?\//, '');
        if (!ctx.media[path] && zip.file(path)) {
          const ext = path.split('.').pop().toLowerCase();
          const type = { png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext];
          if (!type) { (ctx.unsupported = ctx.unsupported || new Set()).add(ext); continue; } // EMF / WMF: הדפדפן לא יודע לצייר
          const blob = new Blob([await zip.file(path).async('uint8array')], { type });
          ctx.media[path] = await blobToDataUrl(blob);
        }
        map[id] = ctx.media[path];
      }
      return map;
    };
    const doc = await read('word/document.xml');
    const sect = /<w:sectPr\b[\s\S]*?<\/w:sectPr>(?![\s\S]*<w:sectPr)/.exec(doc);
    const s = sect ? sect[0] : '';
    ctx.page = {
      w: +(attr(s, 'pgSz', 'w') || 11906) / TW, h: +(attr(s, 'pgSz', 'h') || 16838) / TW,
      top: +(attr(s, 'pgMar', 'top') || 1440) / TW, bottom: +(attr(s, 'pgMar', 'bottom') || 1440) / TW,
      left: +(attr(s, 'pgMar', 'left') || 1440) / TW, right: +(attr(s, 'pgMar', 'right') || 1440) / TW,
      header: +(attr(s, 'pgMar', 'header') || 708) / TW, footer: +(attr(s, 'pgMar', 'footer') || 708) / TW,
    };
    const docRels = await read('word/_rels/document.xml.rels');
    const part = (type, kind) => {
      const id = (new RegExp(`<w:${type}Reference w:type="${kind || 'default'}" r:id="([^"]+)"`).exec(s) || [])[1];
      const t = id && (new RegExp(`Id="${id}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${id}"`).exec(docRels) || []);
      return t ? 'word/' + (t[1] || t[2]) : null;
    };
    ctx.headerPart = part('header'); ctx.footerPart = part('footer');
    ctx.headerXml = ctx.headerPart ? await read(ctx.headerPart) : '';
    ctx.footerXml = ctx.footerPart ? await read(ctx.footerPart) : '';
    ctx.docRels = await ctx.rels('word/document.xml');
    ctx.headerRels = ctx.headerPart ? await ctx.rels(ctx.headerPart) : {};
    ctx.footerRels = ctx.footerPart ? await ctx.rels(ctx.footerPart) : {};
    // כותרת שונה לעמוד הראשון
    if (/<w:titlePg\/>|<w:titlePg w:val="(1|true)"\/>/.test(s)) {
      const fh = part('header', 'first'), ff = part('footer', 'first');
      ctx.first = {
        headerXml: fh ? await read(fh) : '', headerRels: fh ? await ctx.rels(fh) : {},
        footerXml: ff ? await read(ff) : '', footerRels: ff ? await ctx.rels(ff) : {},
      };
    }
    return ctx;
  }

  // מאפייני פסקה אפקטיביים: ברירת מחדל <- סגנון (כולל basedOn) <- מספור <- הפסקה עצמה
  function paraProps(ctx, xml) {
    const pPr = pPrOf(xml);
    const sid = attr(pPr, 'pStyle', 'val') || ctx.defStyle;
    const chain = [];
    for (let id = sid, n = 0; id && ctx.styles[id] && n < 10; id = ctx.styles[id].base, n++) chain.unshift(ctx.styles[id].xml);
    const p = { style: sid, bidi: false, jc: null, left: 0, right: 0, hanging: 0, first: 0, after: ctx.defAfter, before: 0, line: ctx.defLine, ctx: false, sz: ctx.defSz, b: false };
    const apply = src => {
      const ppr = (/<w:pPr>[\s\S]*?<\/w:pPr>/.exec(src) || [''])[0];
      const rpr = (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(src.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, '')) || [''])[0];
      if (attr(ppr, 'jc', 'val')) p.jc = attr(ppr, 'jc', 'val');
      if (/<w:bidi\/>/.test(ppr)) p.bidi = true; else if (/<w:bidi w:val="(0|false)"\/>/.test(ppr)) p.bidi = false;
      if (/<w:ind\b/.test(ppr)) {
        const l = attr(ppr, 'ind', 'left') || attr(ppr, 'ind', 'start'), r = attr(ppr, 'ind', 'right') || attr(ppr, 'ind', 'end');
        if (l != null) p.left = +l; if (r != null) p.right = +r;
        const hg = attr(ppr, 'ind', 'hanging'), fl = attr(ppr, 'ind', 'firstLine');
        if (hg != null) { p.hanging = +hg; p.first = 0; } if (fl != null) { p.first = +fl; p.hanging = 0; }
      }
      if (/<w:spacing\b/.test(ppr)) {
        const a = attr(ppr, 'spacing', 'after'), b = attr(ppr, 'spacing', 'before'), l = attr(ppr, 'spacing', 'line');
        if (a != null) p.after = +a; if (b != null) p.before = +b; if (l != null) p.line = +l;
      }
      if (/<w:contextualSpacing\/>/.test(ppr)) p.ctx = true;
      if (rpr) { const sz = attr(rpr, 'sz', 'val'); if (sz) p.sz = +sz; if (/<w:b\/>/.test(rpr)) p.b = true; }
    };
    chain.forEach(apply);
    const numId = attr(pPr, 'numId', 'val');
    p.numDef = numId && numId !== '0' ? ctx.num[numId] : null;
    p.numId = numId;
    if (p.numDef) { p.left = p.numDef.left; p.hanging = p.numDef.hanging; p.first = 0; }
    // הפסקה עצמה (בלי rPr של סימן הפסקה, שהוא רק לפסקה ריקה)
    const own = pPr.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, '');
    apply('<w:pPr>' + own.replace(/^<w:pPr>|<\/w:pPr>$/g, '') + '</w:pPr>');
    const mark = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(pPr);
    p.markSz = mark && attr(mark[0], 'sz', 'val') ? +attr(mark[0], 'sz', 'val') : p.sz;
    return p;
  }

  // תוכן הפסקה: ריצות טקסט ותמונות
  function paraRuns(xml, p, rels) {
    const out = [], anchors = [];
    // תוכן חלופי (mc:Fallback) הוא עותק ישן של אותה תמונה
    xml = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');
    let inField = 0, fieldShow = true;
    for (const m of xml.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
      const body = m[1], rpr = rPrOf(body);
      const fc = attr(body, 'fldChar', 'fldCharType');
      if (fc === 'begin') { inField++; fieldShow = false; continue; }
      if (fc === 'separate') { fieldShow = true; continue; }
      if (fc === 'end') { inField = Math.max(0, inField - 1); fieldShow = true; continue; }
      if (inField && !fieldShow) continue;
      const sz = attr(rpr, 'sz', 'val') ? +attr(rpr, 'sz', 'val') : p.sz;
      const b = /<w:b\/>|<w:b w:val="(1|true)"\/>/.test(rpr) || (p.b && !/<w:b w:val="(0|false)"\/>/.test(rpr));
      const u = attr(rpr, 'u', 'val'); const color = attr(rpr, 'color', 'val');
      const style = `font-size:${sz / 2}pt;${b ? 'font-weight:700;' : ''}${u && u !== 'none' ? 'text-decoration:underline;' : ''}${color && color !== 'auto' ? `color:#${color};` : ''}`;
      let txt = '';
      for (const t of body.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:drawing>([\s\S]*?)<\/w:drawing>|<w:pict>([\s\S]*?)<\/w:pict>/g)) {
        if (t[0].startsWith('<w:pict')) {
          // תמונה בפורמט הישן של וורד (VML)
          const d = t[3], id = /<v:imagedata\b[^>]*r:id="([^"]+)"/.exec(d), st = (/<v:shape\b[^>]*style="([^"]*)"/.exec(d) || [])[1] || '';
          if (!id || !rels[id[1]]) continue;
          const num = k => { const m = new RegExp(`(?:^|;)\\s*${k}:\\s*([\\d.]+)(pt|in|cm|mm|px)?`).exec(st); if (!m) return null; return +m[1] * ({ in: 72, cm: 28.35, mm: 2.835, px: 0.75 }[m[2]] || 1); };
          const w = num('width'), hh = num('height');
          if (txt) { out.push(`<span style="${style}">${esc(txt)}</span>`); txt = ''; }
          out.push(`<img src="${rels[id[1]]}" style="${w ? `width:${w}pt;` : ''}${hh ? `height:${hh}pt;` : ''}vertical-align:bottom" />`);
          continue;
        }
        if (t[0].startsWith('<w:tab')) txt += '  ';
        else if (t[0].startsWith('<w:br')) txt += '\n';
        else if (t[0].startsWith('<w:drawing')) {
          const d = t[2], ext = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(d), emb = /r:embed="([^"]+)"/.exec(d);
          if (!ext || !emb || !rels[emb[1]]) continue;
          const w = +ext[1] / EMU, hh = +ext[2] / EMU;
          if (/<wp:anchor\b/.test(d)) {
            const ph = /<wp:positionH relativeFrom="(\w+)">\s*(?:<wp:posOffset>(-?\d+)<\/wp:posOffset>|<wp:align>(\w+)<\/wp:align>)/.exec(d) || [];
            const pv = /<wp:positionV relativeFrom="(\w+)">\s*(?:<wp:posOffset>(-?\d+)<\/wp:posOffset>|<wp:align>(\w+)<\/wp:align>)/.exec(d) || [];
            anchors.push({ src: rels[emb[1]], w, h: hh, hRel: ph[1], hOff: ph[2] != null ? +ph[2] / EMU : null, hAlign: ph[3], vRel: pv[1], vOff: pv[2] != null ? +pv[2] / EMU : 0, behind: /behindDoc="1"/.test(d) });
          } else { if (txt) { out.push(`<span style="${style}">${esc(txt)}</span>`); txt = ''; } out.push(`<img src="${rels[emb[1]]}" style="width:${w}pt;height:${hh}pt;vertical-align:bottom" />`); }
        } else txt += unesc(t[1]);
      }
      if (txt) out.push(`<span style="${style}">${esc(txt)}</span>`);
    }
    return { html: out.join(''), anchors };
  }

  // פסקה -> HTML (החישוב של מספור הרשימות נעשה לפי הסדר)
  function paraHtml(ctx, xml, counters, nextP, rels) {
    const p = paraProps(ctx, xml);
    const r = paraRuns(xml, p, rels);
    let prefix = '';
    if (p.numDef) {
      const n = counters[p.numId] = (counters[p.numId] || p.numDef.start - 1) + 1;
      const label = p.numDef.fmt === 'bullet' ? '•' : p.numDef.fmt === 'none' ? '' : p.numDef.text.replace('%1', String(n));
      prefix = `<span style="display:inline-block;width:${p.hanging / TW}pt;font-size:${p.sz / 2}pt">${esc(label)}</span>`;
    }
    // רווח אחרי פסקה: ברשימה (contextualSpacing) אין רווח בין פסקאות באותו סגנון
    let after = p.after / TW, before = p.before / TW;
    if (p.ctx && nextP && nextP.ctx && nextP.style === p.style) after = 0;
    const lh = p.line / 240 * 1.15;
    const empty = !r.html;
    // בפסקה מימין לשמאל (bidi) וורד הופך: left = צד ההתחלה (ימין), right = צד הסוף (שמאל)
    const jc = p.bidi ? ({ center: 'center', both: 'justify', distribute: 'justify', left: 'right', right: 'left', start: 'right', end: 'left' }[p.jc] || 'right')
      : ({ center: 'center', both: 'justify', distribute: 'justify', left: 'left', right: 'right', start: 'left', end: 'right' }[p.jc] || 'left');
    const style = `padding:${before}pt ${p.left / TW}pt ${after}pt ${p.right / TW}pt;text-indent:${-(p.hanging - p.first) / TW}pt;` +
      `text-align:${jc};line-height:${lh};font-size:${(empty ? p.markSz : p.sz) / 2}pt;white-space:pre-wrap;overflow-wrap:break-word`;
    return { html: `<div class="qp" style="${style}">${prefix}${r.html || '​'}</div>`, anchors: r.anchors, props: p };
  }

  // טבלה מהתבנית (למשל חתימה ושם בשתי עמודות): עמודות, גבולות, ופסקאות בכל תא
  function tableHtml(ctx, xml, rels) {
    const tblPr = (/<w:tblPr>[\s\S]*?<\/w:tblPr>/.exec(xml) || [''])[0];
    const rtl = has(tblPr, 'bidiVisual');
    const grid = [...((/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/.exec(xml) || [''])[0]).matchAll(/<w:gridCol w:w="(\d+)"/g)].map(m => +m[1] / TW);
    const bVal = (src, side) => {
      const m = new RegExp(`<w:${side}\\b([^>]*)/?>`).exec(src || '');
      if (!m) return null;
      const v = (/w:val="([^"]+)"/.exec(m[1]) || [])[1] || 'single', sz = (/w:sz="(\d+)"/.exec(m[1]) || [])[1], c = (/w:color="([0-9A-Fa-f]{6})"/.exec(m[1]) || [])[1];
      return { on: !/^(nil|none)$/.test(v), sz: sz ? Math.max(0.25, +sz / 8) : 0.5, color: c ? '#' + c : '#000' };
    };
    const tb = (/<w:tblBorders>[\s\S]*?<\/w:tblBorders>/.exec(tblPr) || [''])[0];
    const counters = {};
    const trs = xml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
    const rows = trs.map((tr, ri) => {
      const cells = tr.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [];
      return '<tr>' + cells.map((tc, ci) => {
        const tcPr = (/<w:tcPr>[\s\S]*?<\/w:tcPr>/.exec(tc) || [''])[0];
        const span = +(attr(tcPr, 'gridSpan', 'val') || 1);
        const w = attr(tcPr, 'tcW', 'w') && attr(tcPr, 'tcW', 'type') === 'dxa' ? +attr(tcPr, 'tcW', 'w') / TW : null;
        const merged = /<w:vMerge\/>|<w:vMerge w:val="continue"/.test(tcPr);
        const tcb = (/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/.exec(tcPr) || [''])[0];
        // צד בתא: מה שהוגדר בתא, אחרת הגבול של הטבלה (חיצוני או פנימי)
        const first = ci === 0, last = ci === cells.length - 1;
        const startSide = rtl ? 'right' : 'left', endSide = rtl ? 'left' : 'right';
        const sides = [
          ['top', bVal(tcb, 'top') || bVal(tb, ri === 0 ? 'top' : 'insideH')],
          ['bottom', bVal(tcb, 'bottom') || bVal(tb, ri === trs.length - 1 ? 'bottom' : 'insideH')],
          [startSide, bVal(tcb, 'start') || bVal(tcb, startSide) || bVal(tb, first ? 'start' : 'insideV') || (first ? bVal(tb, startSide) : null)],
          [endSide, bVal(tcb, 'end') || bVal(tcb, endSide) || bVal(tb, last ? 'end' : 'insideV') || (last ? bVal(tb, endSide) : null)],
        ];
        const bs = sides.map(([sd, b]) => b && b.on ? `border-${sd}:${b.sz}pt solid ${b.color};` : '').join('');
        const paras = merged ? [] : (tc.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []);
        const inner = paras.map((x, i) => {
          const r = paraHtml(ctx, x, counters, paras[i + 1] && paraProps(ctx, paras[i + 1]), rels);
          // תמונה צפה בתוך תא (חתימה, חותמת): מוצגת בתוך התא
          return r.anchors.length ? r.html.replace(/<\/div>$/, r.anchors.map(a => `<img src="${a.src}" style="width:${a.w}pt;height:${a.h}pt;vertical-align:bottom" />`).join('') + '</div>') : r.html;
        }).join('');
        return `<td colspan="${span}" style="${w ? `width:${w}pt;` : ''}${bs}padding:0 5.4pt;vertical-align:top">${inner}</td>`;
      }).join('') + '</tr>';
    });
    const jc = attr(tblPr, 'jc', 'val');
    const total = grid.reduce((a, b) => a + b, 0);
    return { html: `<div class="qp"><table dir="${rtl ? 'rtl' : 'ltr'}" style="border-collapse:collapse;table-layout:fixed;${total ? `width:${total}pt;` : ''}${jc === 'center' ? 'margin:0 auto;' : ''}">` +
      (grid.length ? `<colgroup>${grid.map(g => `<col style="width:${g}pt">`).join('')}</colgroup>` : '') + rows.join('') + '</table></div>', anchors: [], props: null };
  }

  function partHtml(ctx, xml, rels) {
    const body = (/<w:(?:hdr|ftr)\b[^>]*>([\s\S]*)<\/w:(?:hdr|ftr)>/.exec(xml) || [])[1] || '';
    const paras = (body.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []);
    const counters = {};
    return paras.map((x, i) => paraHtml(ctx, x, counters, paras[i + 1] && paraProps(ctx, paras[i + 1]), rels));
  }

  const CSS = `.qpg{position:relative;width:595.3pt;height:841.9pt;overflow:hidden;background:#fff;color:#000;font-family:RepArial,Arial,sans-serif;direction:rtl}
.qbox{position:absolute}.qp{margin:0}.qa{position:absolute}`;

  // מיקום תמונה צפה (לוגו, חותמת) ביחס לעמוד
  function anchorStyle(a, page, paraTopPt) {
    const mL = page.left, cw = page.w - page.left - page.right;
    let x;
    if (a.hOff != null) x = (a.hRel === 'page' ? 0 : mL) + a.hOff;
    else if (a.hAlign === 'right') x = (a.hRel === 'page' ? page.w : mL + cw) - a.w;
    else if (a.hAlign === 'center') x = (a.hRel === 'page' ? page.w / 2 : mL + cw / 2) - a.w / 2;
    else x = a.hRel === 'page' ? 0 : mL;
    const y = (a.vRel === 'page' ? 0 : a.vRel === 'margin' ? page.top : paraTopPt) + (a.vOff || 0);
    return `left:${x}pt;top:${y}pt;width:${a.w}pt;height:${a.h}pt;${a.behind ? 'z-index:0' : 'z-index:2'}`;
  }

  // מודד גבהים במסמך האמיתי (אותו גופן), כדי לחלק לעמודים
  function measure(htmls, widthPt) {
    const box = document.createElement('div');
    box.className = 'qpg';
    box.style.cssText = `position:absolute;left:-10000px;top:0;visibility:hidden;height:auto;width:${widthPt}pt`;
    box.innerHTML = htmls.join('');
    document.body.append(box);
    const k = 72 / 96;
    const res = [...box.children].map(el => ({ top: el.offsetTop * k, h: el.offsetHeight * k }));
    const total = box.scrollHeight * k;
    box.remove();
    return { res, total };
  }

  function ensureCss() {
    if (document.getElementById('quotePrintCss')) return;
    const s = document.createElement('style'); s.id = 'quotePrintCss'; s.textContent = CSS; document.head.append(s);
  }

  // בונה את העמודים (HTML) של ההצעה
  async function pages(bytes, q) {
    ensureCss();
    if (root.ReportPrint) await ReportPrint.preloadFonts();
    const zip = await JSZip.loadAsync(bytes);
    const ctx = await context(zip);
    const pg = ctx.page, cw = pg.w - pg.left - pg.right;
    const isP = x => /^<w:p\b/.test(x);
    const parts = Quotes.finalParts(q).filter(x => isP(x) || /<w:tbl\b/.test(x));
    const counters = {};
    const props = parts.map(x => isP(x) ? paraProps(ctx, x) : null);
    const paras = parts.map((x, i) => isP(x) ? paraHtml(ctx, x, counters, props[i + 1], ctx.docRels) : tableHtml(ctx, x, ctx.docRels));
    // כותרת עליונה ותחתונה: ברירת המחדל, ובעמוד הראשון אחרת אם הוגדרה כך בוורד
    const hf = (hx, hr, fx, fr) => {
      const hdr = partHtml(ctx, hx, hr), ftr = partHtml(ctx, fx, fr);
      return { hdr, ftr, hm: measure(hdr.map(x => x.html), cw), fm: measure(ftr.map(x => x.html), cw) };
    };
    const main = hf(ctx.headerXml, ctx.headerRels, ctx.footerXml, ctx.footerRels);
    const first = ctx.first ? hf(ctx.first.headerXml, ctx.first.headerRels, ctx.first.footerXml, ctx.first.footerRels) : main;
    const bodyTop = Math.max(pg.top, pg.header + main.hm.total, pg.header + first.hm.total);
    const bodyBottom = Math.min(pg.h - pg.bottom, pg.h - pg.footer - main.fm.total, pg.h - pg.footer - first.fm.total);
    const avail = bodyBottom - bodyTop;
    const m = measure(paras.map(x => x.html), cw).res;
    // חלוקה לעמודים
    const pageList = [];
    let curPage = null, start = 0;
    paras.forEach((p, i) => {
      const top = m[i].top - start;
      if (!curPage || (top + m[i].h > avail && curPage.items.length)) { curPage = { items: [] }; pageList.push(curPage); start = m[i].top; }
      curPage.items.push({ p, top: m[i].top - start });
    });
    const hfHtml = ({ hdr, ftr, hm, fm }) => {
      const ftrTop = pg.h - pg.footer - fm.total;
      return [`<div class="qbox" style="left:${pg.left}pt;top:${pg.header}pt;width:${cw}pt">${hdr.map(x => x.html).join('')}</div>` +
        hdr.flatMap((x, i) => x.anchors.map(a => `<img class="qa" src="${a.src}" style="${anchorStyle(a, pg, pg.header + hm.res[i].top)}" />`)).join(''),
        `<div class="qbox" style="left:${pg.left}pt;top:${ftrTop}pt;width:${cw}pt">${ftr.map(x => x.html).join('')}</div>` +
        ftr.flatMap((x, i) => x.anchors.map(a => `<img class="qa" src="${a.src}" style="${anchorStyle(a, pg, ftrTop + fm.res[i].top)}" />`)).join('')];
    };
    const mainHf = hfHtml(main), firstHf = ctx.first ? hfHtml(first) : mainHf;
    // עמוד אחרון שיש בו רק שורות ריקות לא נכנס ל-PDF
    while (pageList.length > 1 && pageList[pageList.length - 1].items.every(x => !x.p.anchors.length && /<div class="qp"[^>]*>\u200B<\/div>$/.test(x.p.html))) pageList.pop();
    return pageList.map((page, pi) => `<section class="qpg" style="width:${pg.w}pt;height:${pg.h}pt">${(pi ? mainHf : firstHf)[0]}` +
      `<div class="qbox" style="left:${pg.left}pt;top:${bodyTop}pt;width:${cw}pt">${page.items.map(x => x.p.html).join('')}</div>` +
      page.items.flatMap(x => x.p.anchors.map(a => `<img class="qa" src="${a.src}" style="${anchorStyle(a, pg, bodyTop + x.top)}" />`)).join('') +
      `${(pi ? mainHf : firstHf)[1]}</section>`);

  }

  // data: ההצעה עצמה נשמרת בתוך ה-PDF, כדי שאפשר יהיה לפתוח אותה לעריכה מהדרייב
  async function toPdf(bytes, q) {
    return PdfVec.fromHtml(await pages(bytes, q), { css: CSS, data: JSON.stringify({ app: 'tree-survey-quote', v: 1, quote: q }) });
  }

  root.QuotePrint = { pages, toPdf, CSS };
})(self);

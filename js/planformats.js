// קבצי מדידה נוספים מלבד DWG: DXF (קורא משלנו), PDF (קווים מהשרטוט, או תמונה כשזו סריקה), DWFx (XPS) ותמונות.
// DXF שומר את הקואורדינטות של המדידה. PDF, DWFx ותמונה הם שרטוט על דף, בלי קואורדינטות: מכיילים אותם בשתי נקודות (planview).
(function (root) {
  'use strict';
  const D2R = Math.PI / 180;

  // ---------- DXF (טקסט) ----------
  function decodeText(bytes) {
    const u8 = new Uint8Array(bytes);
    let s = new TextDecoder('utf-8').decode(u8);
    // קבצים ישנים (לפני 2007) בקידוד של חלונות
    // הבתים 0x80-0x9F נשמרים כמו שהם: בשרטוטים ישנים אלה אותיות עבריות בקידוד DOS (Plan.decodeHeb)
    if (s.includes('\uFFFD')) {
      try {
        const td = new TextDecoder('windows-1255'), map = [];
        for (let b = 0; b < 256; b++) map[b] = b < 0x80 ? String.fromCharCode(b) : b < 0xA0 ? String.fromCharCode(b) : td.decode(new Uint8Array([b]));
        let o = '';
        for (let k = 0; k < u8.length; k += 8192) o += Array.from(u8.subarray(k, k + 8192), b => map[b]).join('');
        s = o;
      } catch (_) {}
    }
    return s;
  }
  function pairs(text) {
    const lines = text.split(/\r?\n/), out = [];
    for (let i = 0; i + 1 < lines.length; i += 2) out.push([parseInt(lines[i], 10), lines[i + 1].replace(/\s+$/, '')]);
    return out;
  }
  // DXF -> מבנה כמו של libredwg-web (entities, tables.BLOCK_RECORD, tables.LAYER), כדי להשתמש באותו Plan.extract
  function parseDxf(bytes) {
    if (/^AutoCAD Binary DXF/.test(new TextDecoder('latin1').decode(new Uint8Array(bytes).subarray(0, 22)))) throw new Error('DXF בינארי לא נתמך. שמור אותו כ-DXF רגיל (ASCII) או כ-DWG');
    const P = pairs(decodeText(bytes));
    const layers = [], blocks = [], entities = [], ltypes = [], styles = [], header = {};
    let i = 0;
    const num = v => parseFloat(v);
    // ישות אחת: אוסף הקודים עד הקוד 0 הבא
    function readEnt() {
      const type = P[i][1], g = [];
      i++;
      while (i < P.length && P[i][0] !== 0) { g.push(P[i]); i++; }
      return { type, g };
    }
    const get = (g, c, d) => { const x = g.find(p => p[0] === c); return x ? x[1] : d; };
    const getN = (g, c, d) => { const x = g.find(p => p[0] === c); return x ? num(x[1]) : d; };
    // שדות משותפים: שכבה, צבע, סוג קו
    function common(e) {
      const g = e.g, tc = get(g, 420, null);
      return { type: e.type, layer: get(g, 8, '0'), isVisible: getN(g, 60, 0) !== 1, handle: get(g, 5, ''),
        colorIndex: getN(g, 62, 256), color: tc != null ? (parseInt(tc, 10) & 0xFFFFFF) : undefined, lineType: get(g, 6, ''), lineTypeScale: getN(g, 48, 1) };
    }
    // טקסט / תכונה: [קוד יישור אנכי] שונה בין TEXT (73) ל-ATTRIB (74)
    const textOf = (g, vaCode) => ({ text: get(g, 1, ''), styleName: get(g, 7, ''), startPoint: { x: getN(g, 10, 0), y: getN(g, 20, 0) }, endPoint: { x: getN(g, 11, 0), y: getN(g, 21, 0) },
      textHeight: getN(g, 40, 0), rotation: getN(g, 50, 0) * D2R, xScale: getN(g, 41, 1), halign: getN(g, 72, 0), valign: getN(g, vaCode, 0) });
    // מילוי: הקודים באים ברצף, ולכן קוראים אותם לפי הסדר
    function hatch(g, base) {
      let k = 0;
      const n = () => num(g[k++][1]);
      const out = Object.assign(base, { patternName: get(g, 2, ''), solidFill: getN(g, 70, 0), boundaryPaths: [], definitionLines: [] });
      while (k < g.length && g[k][0] !== 91) k++;
      if (k >= g.length) return out;
      const np = n();
      for (let pI = 0; pI < np && k < g.length; pI++) {
        while (k < g.length && g[k][0] !== 92) k++;
        if (k >= g.length) break;
        const flag = n(), bp = { boundaryPathTypeFlag: flag };
        if (flag & 2) {
          let hasB = 0, nv = 0; bp.vertices = []; bp.isClosed = true;
          while (k < g.length && g[k][0] !== 93) { if (g[k][0] === 72) hasB = num(g[k][1]); if (g[k][0] === 73) bp.isClosed = num(g[k][1]) !== 0; k++; }
          nv = n();
          for (let v = 0; v < nv && k < g.length; v++) {
            const vx = { x: 0, y: 0, bulge: 0 };
            if (g[k][0] === 10) vx.x = n(); if (k < g.length && g[k][0] === 20) vx.y = n(); if (hasB && k < g.length && g[k][0] === 42) vx.bulge = n();
            bp.vertices.push(vx);
          }
        } else {
          while (k < g.length && g[k][0] !== 93) k++;
          const ne = n(); bp.edges = [];
          for (let q = 0; q < ne && k < g.length; q++) {
            while (k < g.length && g[k][0] !== 72) k++;
            const t = n(), ed = { type: t };
            const rd = c => { while (k < g.length && g[k][0] !== c) k++; return n(); };
            if (t === 1) { ed.start = { x: rd(10), y: rd(20) }; ed.end = { x: rd(11), y: rd(21) }; }
            else if (t === 2) { ed.center = { x: rd(10), y: rd(20) }; ed.radius = rd(40); ed.startAngle = rd(50) * D2R; ed.endAngle = rd(51) * D2R; ed.isCCW = rd(73) !== 0; }
            else if (t === 3) { ed.center = { x: rd(10), y: rd(20) }; ed.end = { x: rd(11), y: rd(21) }; ed.lengthOfMinorAxis = rd(40); ed.startAngle = rd(50) * D2R; ed.endAngle = rd(51) * D2R; ed.isCCW = rd(73) !== 0; }
            else if (t === 4) {
              ed.controlPoints = [];
              while (k < g.length && g[k][0] !== 72 && g[k][0] !== 97 && g[k][0] !== 92 && g[k][0] !== 75) {
                if (g[k][0] === 10) { const x = n(); const y = k < g.length && g[k][0] === 20 ? n() : 0; ed.controlPoints.push({ x, y }); } else k++;
              }
            }
            bp.edges.push(ed);
          }
        }
        out.boundaryPaths.push(bp);
      }
      // קווי הדוגמה
      while (k < g.length && g[k][0] !== 78) k++;
      if (k < g.length) {
        const nl = n();
        for (let q = 0; q < nl && k < g.length; q++) {
          while (k < g.length && g[k][0] !== 53) k++;
          if (k >= g.length) break;
          const dl = { angle: n() * D2R, base: { x: 0, y: 0 }, offset: { x: 0, y: 0 }, dashLengths: [] };
          if (g[k] && g[k][0] === 43) dl.base.x = n(); if (g[k] && g[k][0] === 44) dl.base.y = n();
          if (g[k] && g[k][0] === 45) dl.offset.x = n(); if (g[k] && g[k][0] === 46) dl.offset.y = n();
          const nd = g[k] && g[k][0] === 79 ? n() : 0;
          for (let d = 0; d < nd && k < g.length && g[k][0] === 49; d++) dl.dashLengths.push(n());
          out.definitionLines.push(dl);
        }
      }
      return out;
    }
    function toEnt(e, more) {
      const g = e.g, base = common(e);
      switch (e.type) {
        case 'LINE': return Object.assign(base, { startPoint: { x: getN(g, 10, 0), y: getN(g, 20, 0) }, endPoint: { x: getN(g, 11, 0), y: getN(g, 21, 0) } });
        case 'LWPOLYLINE': {
          const v = [];
          for (const [c, val] of g) {
            if (c === 10) v.push({ x: num(val), y: 0, bulge: 0 });
            else if (c === 20 && v.length) v[v.length - 1].y = num(val);
            else if (c === 42 && v.length) v[v.length - 1].bulge = num(val);
          }
          return Object.assign(base, { flag: getN(g, 70, 0), vertices: v });
        }
        case 'POLYLINE': {
          const v = (more || []).filter(x => x.type === 'VERTEX').map(x => ({ x: getN(x.g, 10, 0), y: getN(x.g, 20, 0), bulge: getN(x.g, 42, 0) }));
          return Object.assign(base, { type: 'POLYLINE2D', flag: getN(g, 70, 0), vertices: v });
        }
        case 'CIRCLE': return Object.assign(base, { center: { x: getN(g, 10, 0), y: getN(g, 20, 0) }, radius: getN(g, 40, 0) });
        case 'ARC': return Object.assign(base, { center: { x: getN(g, 10, 0), y: getN(g, 20, 0) }, radius: getN(g, 40, 0), startAngle: getN(g, 50, 0) * D2R, endAngle: getN(g, 51, 0) * D2R });
        case 'ELLIPSE': return Object.assign(base, { center: { x: getN(g, 10, 0), y: getN(g, 20, 0) }, majorAxisEndPoint: { x: getN(g, 11, 0), y: getN(g, 21, 0) }, axisRatio: getN(g, 40, 1), startAngle: getN(g, 41, 0), endAngle: getN(g, 42, Math.PI * 2) });
        case 'POINT': return Object.assign(base, { position: { x: getN(g, 10, 0), y: getN(g, 20, 0) } });
        case 'SOLID': case 'TRACE': return Object.assign(base, { corner1: { x: getN(g, 10, 0), y: getN(g, 20, 0) }, corner2: { x: getN(g, 11, 0), y: getN(g, 21, 0) },
          corner3: { x: getN(g, 12, 0), y: getN(g, 22, 0) }, corner4: { x: getN(g, 13, getN(g, 12, 0)), y: getN(g, 23, getN(g, 22, 0)) } });
        case 'TEXT': return Object.assign(base, textOf(g, 73));
        case 'MTEXT': {
          // הטקסט מחולק לקודי 3 ובסוף קוד 1
          const parts = g.filter(p => p[0] === 3).map(p => p[1]).join('') + get(g, 1, '');
          const dx = getN(g, 11, null), dy = getN(g, 21, 0);
          return Object.assign(base, { text: parts, styleName: get(g, 7, ''), insertionPoint: { x: getN(g, 10, 0), y: getN(g, 20, 0) }, textHeight: getN(g, 40, 0),
            attachmentPoint: getN(g, 71, 1), direction: dx != null ? { x: dx, y: dy } : null, rotation: getN(g, 50, 0) * D2R });
        }
        case 'HATCH': return hatch(g, base);
        case 'INSERT': return Object.assign(base, { name: get(g, 2, ''), insertionPoint: { x: getN(g, 10, 0), y: getN(g, 20, 0) }, xScale: getN(g, 41, 1), yScale: getN(g, 42, 1), rotation: getN(g, 50, 0) * D2R,
          attribs: (more || []).filter(x => x.type === 'ATTRIB').map(x => Object.assign(common(x), { tag: get(x.g, 2, ''), flags: getN(x.g, 70, 0), text: textOf(x.g, 74) })) });
        default: return null;
      }
    }
    // ישויות ברצף: POLYLINE עם VERTEX, ו-INSERT עם ATTRIB, עד SEQEND
    function readEntities(stop, into) {
      while (i < P.length && !(P[i][0] === 0 && stop.includes(P[i][1]))) {
        if (P[i][0] !== 0) { i++; continue; }
        const e = readEnt();
        let more = null;
        if ((e.type === 'POLYLINE') || (e.type === 'INSERT' && getN(e.g, 66, 0) === 1)) {
          more = [];
          while (i < P.length && P[i][0] === 0 && P[i][1] !== 'SEQEND' && (P[i][1] === 'VERTEX' || P[i][1] === 'ATTRIB')) more.push(readEnt());
          if (i < P.length && P[i][1] === 'SEQEND') readEnt();
        }
        const x = toEnt(e, more);
        if (x) into.push(x);
      }
    }
    while (i < P.length) {
      if (P[i][0] === 0 && P[i][1] === 'SECTION') {
        const name = (P[i + 1] || [])[1];
        i += 2;
        if (name === 'ENTITIES') readEntities(['ENDSEC'], entities);
        else if (name === 'HEADER') {
          while (i < P.length && !(P[i][0] === 0 && P[i][1] === 'ENDSEC')) {
            if (P[i][0] === 9 && (P[i][1] === '$LTSCALE' || P[i][1] === '$CELTSCALE') && P[i + 1]) header[P[i][1].slice(1)] = num(P[i + 1][1]);
            i++;
          }
        }
        else if (name === 'BLOCKS') {
          while (i < P.length && !(P[i][0] === 0 && P[i][1] === 'ENDSEC')) {
            if (P[i][0] === 0 && P[i][1] === 'BLOCK') {
              const b = readEnt();
              const blk = { name: get(b.g, 2, ''), basePoint: { x: getN(b.g, 10, 0), y: getN(b.g, 20, 0) }, entities: [] };
              readEntities(['ENDBLK'], blk.entities);
              blocks.push(blk);
            } else i++;
          }
        } else if (name === 'TABLES') {
          while (i < P.length && !(P[i][0] === 0 && P[i][1] === 'ENDSEC')) {
            if (P[i][0] === 0 && P[i][1] === 'LAYER') {
              const l = readEnt();
              const nm = get(l.g, 2, null), tc = get(l.g, 420, null);
              if (nm != null) layers.push({ name: nm, frozen: (getN(l.g, 70, 0) & 1) === 1, off: false, colorIndex: getN(l.g, 62, 7), lineType: get(l.g, 6, 'CONTINUOUS'),
                color: tc != null ? parseInt(tc, 10) & 0xFFFFFF : undefined });
            } else if (P[i][0] === 0 && P[i][1] === 'LTYPE') {
              const l = readEnt();
              ltypes.push({ name: get(l.g, 2, ''), pattern: l.g.filter(p => p[0] === 49).map(p => ({ elementLength: num(p[1]) })) });
            } else if (P[i][0] === 0 && P[i][1] === 'STYLE') {
              const l = readEnt();
              styles.push({ name: get(l.g, 2, ''), font: get(l.g, 3, '') });
            } else i++;
          }
        }
      } else i++;
    }
    return { entities, header, tables: { BLOCK_RECORD: { entries: blocks }, LAYER: { entries: layers }, LTYPE: { entries: ltypes }, STYLE: { entries: styles } } };
  }

  // ---------- גאומטריה של דף (PDF, DWFx) ----------
  // paths: מערכים של [x0,y0,x1,y1,...] במילימטרים על הדף, ציר y למעלה
  function paperGeom(paths, w, h, extra) {
    const r2 = v => Math.round(v * 100) / 100;
    const P = [];
    let total = 0;
    for (const p of paths) {
      if (p.length < 4) continue;
      const flat = [];
      for (let k = 0; k < p.length; k++) flat.push(r2(p[k]));
      total += flat.length;
      if (total > 1200000) break; // שרטוט ענק: מספיק לסימון
      P.push(flat);
    }
    return Object.assign({ v: 1, crs: 'paper', ox: 0, oy: 0, view: [0, 0, r2(w), r2(h)], paths: P, inserts: {}, treeBlock: '', upm: 4 }, extra || {});
  }

  // ---------- PDF ----------
  let pdfP = null;
  function loadPdfJs() {
    if (pdfP) return pdfP;
    const base = new URL('vendor/pdfjs/', root.location.href).href;
    pdfP = import(base + 'pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs'; return m; })
      .catch(e => { pdfP = null; throw new Error('לא הצלחתי לטעון את קורא ה-PDF (צריך קליטה בפעם הראשונה): ' + e.message); });
    return pdfP;
  }
  const MM = 25.4 / 72;
  async function parsePdf(bytes) {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const W = vp.width, H = vp.height;
    const ops = await page.getOperatorList();
    const O = pdfjs.OPS;
    // מטריצת הדף: ממערכת ה-PDF לנקודות על הדף המוצג (כולל סיבוב), ואז y למעלה ובמילימטרים
    const V = vp.transform; // [a,b,c,d,e,f] ל-y למטה
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const paths = [];
    const pt = (x, y) => { const a = ctm, X = a[0] * x + a[2] * y + a[4], Y = a[1] * x + a[3] * y + a[5]; const sx = V[0] * X + V[2] * Y + V[4], sy = V[1] * X + V[3] * Y + V[5]; return [sx * MM, (H - sy) * MM]; };
    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k], args = ops.argsArray[k];
      if (fn === O.save) stack.push(ctm);
      else if (fn === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === O.transform) ctm = mul(ctm, args);
      else if (fn === O.paintFormXObjectBegin) { stack.push(ctm); if (args[0]) ctm = mul(ctm, args[0]); }
      else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === O.constructPath) {
        const [pops, coords] = args;
        let c = 0, cur = null, start = null, last = null;
        const flush = () => { if (cur && cur.length >= 4) paths.push(cur); cur = null; };
        for (const op of pops) {
          if (op === O.moveTo) { flush(); last = start = [coords[c++], coords[c++]]; cur = pt(...last); }
          else if (op === O.lineTo) { last = [coords[c++], coords[c++]]; (cur = cur || pt(...start || last)).push(...pt(...last)); }
          else if (op === O.curveTo) {
            const p1 = [coords[c++], coords[c++]], p2 = [coords[c++], coords[c++]], p3 = [coords[c++], coords[c++]];
            cur = cur || pt(...(last || p1));
            const p0 = last || p1;
            for (let s = 1; s <= 8; s++) {
              const t = s / 8, u = 1 - t;
              cur.push(...pt(u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]));
            }
            last = p3;
          } else if (op === O.curveTo2 || op === O.curveTo3) { last = [coords[c + 2], coords[c + 3]]; c += 4; (cur = cur || pt(...last)).push(...pt(...last)); }
          else if (op === O.closePath) { if (cur && start) cur.push(...pt(...start)); last = start; }
          else if (op === O.rectangle) {
            flush();
            const x = coords[c++], y = coords[c++], w = coords[c++], h = coords[c++];
            paths.push([...pt(x, y), ...pt(x + w, y), ...pt(x + w, y + h), ...pt(x, y + h), ...pt(x, y)]);
          }
        }
        flush();
      }
    }
    const Wmm = W * MM, Hmm = H * MM;
    // תמונה של הדף, עם הצבעים והטקסט (שמות רחובות, מספרים) שלא נכנסים לקווים. הקווים מצוירים מעליה, חדים גם בזום עמוק.
    // סריקה (כמעט בלי קווים): רק התמונה
    const scale = Math.min(6, 4096 / Math.max(W, H));
    const v2 = page.getViewport({ scale });
    const cv = document.createElement('canvas'); cv.width = Math.round(v2.width); cv.height = Math.round(v2.height);
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: cx, viewport: v2 }).promise;
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
    cv.width = cv.height = 0;
    return { geom: paperGeom(paths.length < 20 ? [] : paths, Wmm, Hmm, { image: { w: Wmm, h: Hmm } }), image: blob };
  }

  // ---------- DWFx (XPS) ----------
  // דף ראשון (FixedPage): Path עם Data / PathGeometry, Canvas עם RenderTransform. יחידות XPS = 1/96 אינץ'
  async function parseDwfx(bytes) {
    const zip = await root.JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter(n => /\.fpage$/i.test(n)).sort();
    if (!names.length) throw new Error('לא נמצא דף בקובץ ה-DWFx');
    const xml = new DOMParser().parseFromString(await zip.file(names[0]).async('string'), 'application/xml');
    const pageEl = xml.documentElement;
    const W = parseFloat(pageEl.getAttribute('Width')) || 1000, H = parseFloat(pageEl.getAttribute('Height')) || 1000;
    const U = 25.4 / 96;
    const paths = [];
    const parseM = s => { const a = String(s || '').split(/[\s,]+/).filter(Boolean).map(Number); return a.length === 6 ? a : null; };
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    function data(d, M) {
      const tk = String(d).match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
      let i = 0, cmd = 'M', x = 0, y = 0, sx = 0, sy = 0, cur = null;
      const T = (px, py) => [(M[0] * px + M[2] * py + M[4]) * U, (H - (M[1] * px + M[3] * py + M[5])) * U];
      const n = () => parseFloat(tk[i++]);
      const flush = () => { if (cur && cur.length >= 4) paths.push(cur); cur = null; };
      while (i < tk.length) {
        if (/[A-Za-z]/.test(tk[i])) { cmd = tk[i++]; if (cmd === 'F') { i++; continue; } }
        const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
        if (C === 'M') { flush(); x = n() + (rel ? x : 0); y = n() + (rel ? y : 0); sx = x; sy = y; cur = T(x, y); cmd = rel ? 'l' : 'L'; }
        else if (C === 'L') { x = n() + (rel ? x : 0); y = n() + (rel ? y : 0); (cur = cur || T(sx, sy)).push(...T(x, y)); }
        else if (C === 'H') { x = n() + (rel ? x : 0); (cur = cur || T(sx, sy)).push(...T(x, y)); }
        else if (C === 'V') { y = n() + (rel ? y : 0); (cur = cur || T(sx, sy)).push(...T(x, y)); }
        else if (C === 'C' || C === 'S' || C === 'Q') { const k = C === 'C' ? 6 : 4; const a = []; for (let j = 0; j < k; j++) a.push(n()); x = a[k - 2] + (rel ? x : 0); y = a[k - 1] + (rel ? y : 0); (cur = cur || T(sx, sy)).push(...T(x, y)); }
        else if (C === 'A') { for (let j = 0; j < 5; j++) n(); x = n() + (rel ? x : 0); y = n() + (rel ? y : 0); (cur = cur || T(sx, sy)).push(...T(x, y)); }
        else if (C === 'Z') { if (cur) cur.push(...T(sx, sy)); x = sx; y = sy; flush(); }
        else i++;
      }
      flush();
    }
    function walk(el, M) {
      for (const c of el.children) {
        const local = c.localName;
        let m = M;
        const rt = parseM(c.getAttribute('RenderTransform'));
        if (rt) m = mul(M, rt);
        if (local === 'Path') {
          const d = c.getAttribute('Data');
          if (d && !d.startsWith('{')) data(d, m);
          for (const fig of c.getElementsByTagNameNS('*', 'PathFigure')) {
            let s = 'M ' + (fig.getAttribute('StartPoint') || '0,0');
            for (const seg of fig.children) {
              const pts = seg.getAttribute('Points') || seg.getAttribute('Point');
              if (pts) s += ' L ' + pts.trim().split(/\s+/).join(' L ');
            }
            if (fig.getAttribute('IsClosed') === 'true') s += ' Z';
            data(s, m);
          }
        } else if (local === 'Canvas' || local === 'FixedPage') walk(c, m);
      }
    }
    walk(pageEl, [1, 0, 0, 1, 0, 0]);
    if (!paths.length) throw new Error('לא נמצאו קווים בקובץ ה-DWFx');
    return { geom: paperGeom(paths, W * U, H * U) };
  }

  // ---------- תמונה ----------
  async function parseImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('התמונה לא נפתחה')); im.src = url; });
      // תמונה גדולה מאוד מוקטנת (זיכרון הטאבלט)
      const k = Math.min(1, 6000 / Math.max(img.naturalWidth, img.naturalHeight));
      let blob = file;
      if (k < 1) {
        const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88));
      }
      // יחידה = מ"מ בדף A3 לרוחב (בערך), כדי שהזום וגודל הנקודות יתאימו לשרטוט
      const w = 420, h = 420 * img.naturalHeight / img.naturalWidth;
      return { geom: paperGeom([], w, h, { image: { w, h } }), image: blob };
    } finally { URL.revokeObjectURL(url); }
  }

  root.PlanFormats = { parseDxf, parsePdf, parseDwfx, parseImage, loadPdfJs };
})(typeof self !== 'undefined' ? self : globalThis);

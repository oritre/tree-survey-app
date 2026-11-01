// מדידה (DWG/DXF) לסקר לבנייה: קריאת הקובץ בדפדפן, עצי המודד, המרה לרשת ישראל, ומיקום המספרים לגיליון "מדידה" באקסל.
// הגאומטריה נקראת פעם אחת (vendor/libredwg, WebAssembly) ונשמרת כקובץ JSON קטן, כך שבשטח לא צריך את הקורא עצמו.
(function (root) {
  'use strict';

  // רשת ישראל החדשה (ITM)
  const ITM = '+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,-0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs';

  // ייעוד (עמודה BC "סטטוס מוצע") וצבעו, כמו בעיצוב המותנה בתבנית "סקר עצים להיתר בניה"
  const STATUSES = [
    { key: 'לא נדרש ברישיון', color: '#0070C0', aci: 5, layer: 'TREES_LO_NIDRASH' },
    { key: 'העתקה', color: '#FFC000', aci: 30, layer: 'TREES_HAATAKA' },
    { key: 'שימור', color: '#FF0000', aci: 1, layer: 'TREES_SHIMUR' },
    { key: 'כריתה', color: '#FFFF00', aci: 2, layer: 'TREES_KRITA' },
  ];
  const NO_STATUS = { key: '', color: '#2e7d32', aci: 3, layer: 'TREES_NO_STATUS' };
  // הטקסט בתא יכול להכיל יותר ממילה (למשל "כריתה - עץ מת"): כמו באקסל, הכלל הראשון שמתאים קובע
  function statusOf(text) {
    const s = String(text || '');
    return STATUSES.find(x => s.includes(x.key)) || NO_STATUS;
  }

  // בלוק של עץ אצל המודד: קוד מפ"י 1502 (M1502), או שם עם "tree"/"עץ"
  const TREE_BLOCK_RE = /^(m?150[0-9]|.*tree.*|.*עץ.*)$/i;
  const LABEL_TAGS = ['NAME', 'NUM', 'NO', 'NUMBER', 'ID', 'MARK', 'PNT', 'POINT'];

  // ---------- קריאת הקובץ ----------
  let libP = null;
  function loadLib() {
    if (libP) return libP;
    const base = new URL('vendor/libredwg/', root.location.href).href;
    libP = import(base + 'dist/libredwg-web.js').then(m => m.LibreDwg.create(base + 'wasm/'))
      .catch(e => { libP = null; throw new Error('לא הצלחתי לטעון את קורא ה-DWG (צריך קליטה בפעם הראשונה): ' + e.message); });
    return libP;
  }

  async function parseFile(bytes, fileName) {
    const lib = await loadLib();
    const dxf = /\.dxf$/i.test(fileName || '');
    const data = lib.dwg_read_data(new Uint8Array(bytes), dxf ? 1 : 0);
    if (!data) throw new Error('הקובץ לא נקרא. אולי הוא לא DWG תקין');
    let db;
    try { db = lib.convert(data); } finally { try { lib.dwg_free(data); } catch (_) {} }
    const g = extract(db);
    g.name = String(fileName || 'מדידה').replace(/\.(dwg|dxf)$/i, '');
    return g;
  }

  // ---------- מהקובץ לגאומטריה ----------
  // מטריצה [a,b,c,d,e,f]: x' = a*x + c*y + e, y' = b*x + d*y + f
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const ID = [1, 0, 0, 1, 0, 0];

  function arcPts(cx, cy, r, a0, a1) {
    while (a1 <= a0) a1 += Math.PI * 2;
    const n = Math.max(4, Math.min(48, Math.ceil((a1 - a0) / (Math.PI / 12))));
    const out = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return out;
  }
  // קטע מעוגל בפוליליין (bulge)
  function bulgePts(p, q, b) {
    const th = 4 * Math.atan(b), dx = q[0] - p[0], dy = q[1] - p[1], c = Math.hypot(dx, dy);
    if (!c) return [];
    const r = c / (2 * Math.sin(th / 2)), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    const h = r * Math.cos(th / 2), nx = -dy / c, ny = dx / c;
    const cx = mx + nx * h, cy = my + ny * h;
    const a0 = Math.atan2(p[1] - cy, p[0] - cx), n = Math.max(2, Math.ceil(Math.abs(th) / (Math.PI / 12)));
    const out = [];
    for (let i = 1; i < n; i++) { const a = a0 + th * i / n; out.push([cx + Math.abs(r) * Math.cos(a), cy + Math.abs(r) * Math.sin(a)]); }
    return out;
  }

  function attrLabel(e) {
    const at = (e.attribs || []).map(a => ({ tag: String(a.tag || '').toUpperCase(), v: String((a.text && a.text.text) || a.text || '').trim() })).filter(a => a.v);
    for (const t of LABEL_TAGS) { const a = at.find(x => x.tag === t); if (a) return a.v; }
    const a = at.find(x => !/HEIGHT|ELEV|LEVEL|Z$/.test(x.tag) && !/^-?\d+\.\d+$/.test(x.v));
    return a ? a.v : '';
  }

  function extract(db) {
    const blocks = new Map();
    for (const b of ((db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) || [])) blocks.set(b.name, b);
    const hidden = new Set(((db.tables && db.tables.LAYER && db.tables.LAYER.entries) || []).filter(l => l.off || l.frozen || l.colorIndex < 0).map(l => l.name));
    const paths = [], inserts = {};
    const add = (pts, closed) => { if (pts.length > 1) paths.push({ pts, closed: !!closed }); };

    function walk(list, M, depth, inBlock) {
      for (const e of list || []) {
        if (e.isVisible === false || (!inBlock && hidden.has(e.layer))) continue;
        try {
          switch (e.type) {
            case 'LINE': add([ap(M, e.startPoint.x, e.startPoint.y), ap(M, e.endPoint.x, e.endPoint.y)]); break;
            case 'LWPOLYLINE': case 'POLYLINE2D': case 'POLYLINE3D': {
              const v = e.vertices || [], closed = (e.flag & 1) === 1, pts = [];
              for (let i = 0; i < v.length; i++) {
                const p = [v[i].x, v[i].y];
                pts.push(ap(M, p[0], p[1]));
                const q = v[i + 1] || (closed ? v[0] : null);
                if (q && v[i].bulge) for (const b of bulgePts(p, [q.x, q.y], v[i].bulge)) pts.push(ap(M, b[0], b[1]));
              }
              add(closed && pts.length ? pts.concat([pts[0]]) : pts); break;
            }
            case 'CIRCLE': add(arcPts(e.center.x, e.center.y, e.radius, 0, Math.PI * 2).map(p => ap(M, p[0], p[1]))); break;
            case 'ARC': add(arcPts(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle).map(p => ap(M, p[0], p[1]))); break;
            case 'ELLIPSE': {
              const mx = e.majorAxisEndPoint.x, my = e.majorAxisEndPoint.y, r1 = Math.hypot(mx, my), r2 = r1 * e.axisRatio, rot = Math.atan2(my, mx);
              let a0 = e.startAngle || 0, a1 = e.endAngle || Math.PI * 2;
              if (a1 <= a0) a1 += Math.PI * 2;
              const n = 36, pts = [];
              for (let i = 0; i <= n; i++) {
                const a = a0 + (a1 - a0) * i / n, x = r1 * Math.cos(a), y = r2 * Math.sin(a);
                pts.push(ap(M, e.center.x + x * Math.cos(rot) - y * Math.sin(rot), e.center.y + x * Math.sin(rot) + y * Math.cos(rot)));
              }
              add(pts); break;
            }
            case 'INSERT': {
              const p = ap(M, e.insertionPoint.x, e.insertionPoint.y);
              if (depth === 0) (inserts[e.name] = inserts[e.name] || []).push([String(e.handle || ''), p[0], p[1], attrLabel(e)]);
              if (TREE_BLOCK_RE.test(e.name) || depth > 3) break; // עצים מצוירים באפליקציה עצמה
              const b = blocks.get(e.name);
              if (!b || !b.entities || !b.entities.length) break;
              const r = (e.rotation || 0), sx = e.xScale || 1, sy = e.yScale || 1, bp = b.basePoint || { x: 0, y: 0 };
              const T = [Math.cos(r) * sx, Math.sin(r) * sx, -Math.sin(r) * sy, Math.cos(r) * sy, e.insertionPoint.x, e.insertionPoint.y];
              walk(b.entities, mul(M, mul(T, [1, 0, 0, 1, -bp.x, -bp.y])), depth + 1, true);
              break;
            }
          }
        } catch (_) { /* ישות פגומה: מדלגים */ }
      }
    }
    walk(db.entities, ID, 0, false);

    // עצי המודד: הבלוק שמתאים לשם של עץ ויש ממנו הכי הרבה
    const cands = Object.keys(inserts).filter(n => TREE_BLOCK_RE.test(n)).sort((a, b) => inserts[b].length - inserts[a].length);
    const treeBlock = cands[0] || '';

    // אזור העבודה: העצים, ואם אין אז 2%-98% מהנקודות (יש בקבצים קווים בודדים רחוקים מאוד)
    let xs = [], ys = [];
    if (treeBlock) for (const r of inserts[treeBlock]) { xs.push(r[1]); ys.push(r[2]); }
    if (xs.length < 2) { xs = []; ys = []; for (const p of paths) for (const q of p.pts) { xs.push(q[0]); ys.push(q[1]); } }
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const pc = (a, f) => a.length ? a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * f)))] : 0;
    const cut = xs.length > 50 ? 0.02 : 0;
    const view = [pc(xs, cut), pc(ys, cut), pc(xs, 1 - cut), pc(ys, 1 - cut)];
    const ox = Math.round((view[0] + view[2]) / 2), oy = Math.round((view[1] + view[3]) / 2);

    // שומרים יחסית לנקודת האמצע, בדיוק של ס"מ (קובץ קטן). קווים רחוקים מאוד מהאזור נזרקים
    const span = Math.max(view[2] - view[0], view[3] - view[1], 50);
    const far = (x, y) => Math.abs(x - ox) > span * 20 || Math.abs(y - oy) > span * 20;
    const r2 = v => Math.round(v * 100) / 100;
    const P = [];
    for (const p of paths) {
      if (p.pts.every(q => far(q[0], q[1]))) continue;
      const flat = [];
      for (const q of p.pts) flat.push(r2(q[0] - ox), r2(q[1] - oy));
      P.push(flat);
    }
    const ins = {};
    for (const [n, list] of Object.entries(inserts)) ins[n] = list.filter(r => !far(r[1], r[2])).map(r => [r[0], r2(r[1] - ox), r2(r[2] - oy), r[3]]);
    const itm = ox > 100000 && ox < 300000 && oy > 350000 && oy < 820000;
    return { v: 1, crs: itm ? 'itm' : 'local', ox, oy, view: view.map((v, i) => r2(v - (i % 2 ? oy : ox))), paths: P, inserts: ins, treeBlock };
  }

  // עצי המודד: [{h, x, y, name}] בקואורדינטות המקוריות
  function surveyorTrees(g, block) {
    const b = block == null ? g.treeBlock : block;
    return ((g.inserts || {})[b] || []).map(r => ({ h: r[0], x: r[1] + g.ox, y: r[2] + g.oy, name: r[3] }));
  }
  const toLL = (x, y) => { const p = root.proj4(ITM, 'WGS84', [x, y]); return [p[1], p[0]]; };
  const fromLL = (lat, lon) => root.proj4('WGS84', ITM, [lon, lat]);

  // ---------- גיליון "מדידה" באקסל ----------
  // גובה המספרים בשרטוט (מטר), כמו טקסט המודד (0.5 מ' = 2 מ"מ בקנה מידה 1:250)
  const TXT_H = 0.5, MARK_R = 0.45;
  // מיקום המספר של כל עץ בשרטוט: ליד הנקודה במקום פנוי, ואם צפוף אז רחוק יותר (הפקודה ב-BricsCAD מותחת קו מוביל).
  // others: נקודות נוספות שאסור לכסות (עצי המודד). מחזיר Map(tree -> [x, y]) של מרכז המספר
  function layoutLabels(trees, others) {
    const occ = [];
    const box = (x, y, w, h) => ({ x, y, w, h });
    const over = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const pts = trees.filter(t => t.px != null);
    for (const t of pts) occ.push(box(t.px - MARK_R, t.py - MARK_R, MARK_R * 2, MARK_R * 2));
    for (const o of others || []) occ.push(box(o.x - 0.2, o.y - 0.2, 0.4, 0.4));
    const DIRS = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    const out = new Map();
    for (const t of pts) {
      const w = String(t.num || '').length * TXT_H * 0.75 + 0.2, h = TXT_H + 0.2;
      let best = null;
      for (const d of [MARK_R + 0.1, MARK_R + 0.8, MARK_R + 1.6, MARK_R + 2.6, MARK_R + 3.8]) {
        for (const [dx, dy] of DIRS) {
          const f = dx && dy ? 0.7 : 1;
          const x = dx > 0 ? t.px + d * f : dx < 0 ? t.px - d * f - w : t.px - w / 2;
          const y = dy > 0 ? t.py + d * f : dy < 0 ? t.py - d * f - h : t.py - h / 2;
          const b = box(x, y, w, h);
          let o = 0;
          for (const q of occ) if (q.self !== t) o += over(b, q);
          if (!best || o < best.o) best = { b, o };
          if (!o) break;
        }
        if (best && !best.o) break;
      }
      best.b.self = t;
      occ.push(best.b);
      out.set(t, [best.b.x + best.b.w / 2, best.b.y + best.b.h / 2]);
    }
    return out;
  }

  const SHEET_HEAD = ['מספר העץ', 'X', 'Y', 'X מספר', 'Y מספר', 'מספר המודד', 'ייעוד', 'מזהה עץ המודד', 'קוד'];
  // עצי המודד מהמדידה ששמורה במכשיר (או בגוגל דרייב), כדי שהמספרים לא יכסו אותם
  async function othersFor(survey) {
    try {
      const p = survey.plan;
      if (!p || !root.DB) return [];
      let d = await root.DB.getPhoto('plan:' + p.id);
      if (!(d && d.geom) && p.odGeoId && root.OD) {
        const blob = await root.OD.download(p.odGeoId);
        if (blob) { d = { id: 'plan:' + p.id, geom: JSON.parse(await blob.text()) }; await root.DB.putPhoto(d); }
      }
      if (!(d && d.geom)) return [];
      const used = new Set(survey.trees.map(t => t.pref).filter(Boolean));
      return surveyorTrees(d.geom, p.treeBlock).filter(o => !used.has(o.h));
    } catch (_) { return []; }
  }
  // הגיליון עצמו (XML). עמודה G = הייעוד מעמודה BC בגיליון "סקר" לפי מספר העץ, כך שהפקודה ב-BricsCAD קוראת גיליון אחד
  async function sheetXml(survey) {
    const trees = root.Core.sortTrees(survey.trees.filter(t => t.px != null && String(t.num || '').trim()));
    const polys = (survey.planPolys || []).filter(p => p.pts && p.pts.length >= 3);
    if (!trees.length && !polys.length) return null;
    const lab = layoutLabels(trees, await othersFor(survey));
    const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const col = i => String.fromCharCode(65 + i);
    const tcell = (c, r, v) => v ? `<c r="${c}${r}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>` : '';
    const cell = (i, r, v) => v == null || v === '' ? '' : typeof v === 'number'
      ? `<c r="${col(i)}${r}"><v>${v}</v></c>` : `<c r="${col(i)}${r}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    const rows = [`<row r="1">${SHEET_HEAD.map((t, i) => cell(i, 1, t)).join('')}${tcell('J', 1, 'תחום')}${tcell('K', 1, 'נקודות התחום (X,Y;X,Y;...)')}</row>`];
    const r3 = v => Math.round(v * 1000) / 1000;
    // תחומים בעמודות J:K, באותן שורות (שורה 2 והלאה)
    const n = Math.max(trees.length, polys.length);
    for (let i = 0; i < n; i++) {
      const r = i + 2, t = trees[i], p = polys[i];
      let x = '';
      if (t) {
        const num = String(t.num).trim(), L = lab.get(t);
        x += cell(0, r, /^\d+$/.test(num) ? Number(num) : num) + cell(1, r, r3(t.px)) + cell(2, r, r3(t.py)) +
          cell(3, r, r3(L[0])) + cell(4, r, r3(L[1])) + cell(5, r, t.pname || '') +
          `<c r="G${r}" t="str"><f>IFERROR(""&amp;INDEX('סקר'!$BC:$BC,MATCH(A${r},'סקר'!$B:$B,0)),"")</f><v></v></c>` +
          cell(7, r, t.pref || '') +
          // קוד הייעוד (לפקודה ב-BricsCAD): 1 לא נדרש ברישיון, 2 העתקה, 3 שימור, 4 כריתה, 0 בלי. באותו סדר כמו הצבעים באקסל
          `<c r="I${r}"><f>IF(G${r}="",0,IF(ISNUMBER(SEARCH("לא נדרש ברישיון",G${r})),1,IF(ISNUMBER(SEARCH("העתקה",G${r})),2,IF(ISNUMBER(SEARCH("שימור",G${r})),3,IF(ISNUMBER(SEARCH("כריתה",G${r})),4,0)))))</f><v>0</v></c>`;
      }
      if (p) x += tcell('J', r, p.name || 'תחום ' + (i + 1)) + tcell('K', r, p.pts.map(q => r3(q[0]) + ',' + r3(q[1])).join(';'));
      rows.push(`<row r="${r}">${x}</row>`);
    }
    const widths = [10, 13, 13, 13, 13, 12, 18, 14, 6, 14, 60];
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>' +
      '<sheetData>' + rows.join('') + '</sheetData></worksheet>';
  }
  // מוסיף את הגיליון לקובץ האקסל (JSZip פתוח)
  async function addSheet(zip, survey) {
    const xml = await sheetXml(survey);
    if (!xml) return false;
    const nums = Object.keys(zip.files).map(f => /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(f)).filter(Boolean).map(m => +m[1]);
    const n = Math.max(0, ...nums) + 1, path = `worksheets/sheet${n}.xml`;
    zip.file('xl/' + path, xml);
    let wb = await zip.file('xl/workbook.xml').async('string');
    const id = Math.max(0, ...[...wb.matchAll(/sheetId="(\d+)"/g)].map(m => +m[1])) + 1;
    wb = wb.replace('</sheets>', `<sheet name="מדידה" sheetId="${id}" r:id="rIdPlan"/></sheets>`);
    zip.file('xl/workbook.xml', wb);
    let rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    rels = rels.replace('</Relationships>', `<Relationship Id="rIdPlan" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${path}"/></Relationships>`);
    zip.file('xl/_rels/workbook.xml.rels', rels);
    let ct = await zip.file('[Content_Types].xml').async('string');
    ct = ct.replace('</Types>', `<Override PartName="/xl/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
    zip.file('[Content_Types].xml', ct);
    return true;
  }

  // ---------- גאומטריה ----------
  function centroid(pts) {
    let x = 0, y = 0;
    for (const p of pts) { x += p[0]; y += p[1]; }
    return [x / pts.length, y / pts.length];
  }
  function inside(pt, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  root.Plan = { ITM, STATUSES, NO_STATUS, statusOf, parseFile, extract, surveyorTrees, toLL, fromLL, layoutLabels, sheetXml, addSheet, centroid, inside, loadLib };
})(typeof self !== 'undefined' ? self : globalThis);

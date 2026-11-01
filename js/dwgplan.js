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

  // קובץ מדידה -> { geom, image? }. DWG דרך libredwg, ושאר הפורמטים ב-js/planformats.js
  const FORMATS = /\.(dwg|dxf|pdf|dwfx|jpe?g|png|webp)$/i;
  async function parseFile(file) {
    const name = file.name || 'מדידה', ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1] || '';
    const F = root.PlanFormats;
    let out;
    if (/^dwf$/i.test(ext)) throw new Error('קובץ DWF (הישן) לא נקרא בדפדפן. ב-BricsCAD אפשר לשמור אותו כ-DWG, DXF או PDF');
    if (/^dwg$/i.test(ext)) {
      const lib = await loadLib();
      const data = lib.dwg_read_data(new Uint8Array(await file.arrayBuffer()), 0);
      if (!data) throw new Error('הקובץ לא נקרא. אולי הוא לא DWG תקין');
      let db;
      try { db = lib.convert(data); } finally { try { lib.dwg_free(data); } catch (_) {} }
      out = { geom: extract(db) };
    } else if (/^dxf$/i.test(ext)) out = { geom: extract(F.parseDxf(await file.arrayBuffer())) };
    else if (/^pdf$/i.test(ext)) out = await F.parsePdf(await file.arrayBuffer());
    else if (/^dwfx$/i.test(ext)) out = await F.parseDwfx(await file.arrayBuffer());
    else if (/^(jpe?g|png|webp)$/i.test(ext) || /^image\//.test(file.type)) out = await F.parseImage(file);
    else throw new Error('סוג קובץ לא נתמך: ' + (ext || file.type));
    out.geom.name = name.replace(/\.[a-z0-9]+$/i, '');
    return out;
  }

  // ---------- קואורדינטות ----------
  // שרטוט על דף (PDF, DWFx, תמונה) נמדד במ"מ. בלי כיול: לפי קנה המידה (1:250 -> 1 מ"מ = 0.25 מ'), כך שב-BricsCAD
  // רק מזיזים לפי נקודת בסיס. עם כיול בשתי נקודות (plan.cal): ישר לקואורדינטות של המדידה
  const isPaper = p => !!p && p.crs === 'paper';
  function world(p, x, y) {
    if (!isPaper(p)) return [x, y];
    const c = p.cal;
    if (c) return [c[0] * x + c[2] * y + c[4], c[1] * x + c[3] * y + c[5]];
    const k = (p.scale || 250) / 1000;
    return [x * k, y * k];
  }
  function fromWorld(p, X, Y) {
    if (!isPaper(p)) return [X, Y];
    const c = p.cal;
    if (c) { const det = c[0] * c[3] - c[1] * c[2], dx = X - c[4], dy = Y - c[5]; return [(c[3] * dx - c[2] * dy) / det, (-c[1] * dx + c[0] * dy) / det]; }
    const k = (p.scale || 250) / 1000;
    return [X / k, Y / k];
  }
  // יחידות שרטוט במטר (לגודל הנקודות והמספרים במסך)
  function upm(p) {
    if (!isPaper(p)) return 1;
    const c = p.cal;
    if (c) return 1 / Math.hypot(c[0], c[1]);
    return 1000 / (p.scale || 250);
  }
  // כיול משתי נקודות: [x,y] בשרטוט -> [X,Y] במדידה (הזזה, סיבוב וקנה מידה)
  function calibrate(a, A, b, B) {
    const dx = b[0] - a[0], dy = b[1] - a[1], DX = B[0] - A[0], DY = B[1] - A[1];
    const d2 = dx * dx + dy * dy;
    if (!d2 || !(DX || DY)) return null;
    const ca = (dx * DX + dy * DY) / d2, sa = (dx * DY - dy * DX) / d2;
    return [ca, sa, -sa, ca, A[0] - (ca * a[0] - sa * a[1]), A[1] - (sa * a[0] + ca * a[1])];
  }
  // מיקום עץ ברשת ישראל (ל-GPS ולמפות), אם יש
  function itmOf(p, x, y) {
    if (!p) return null;
    if (p.crs === 'itm') return [x, y];
    if (isPaper(p) && p.cal) { const w = world(p, x, y); return w[0] > 100000 && w[0] < 300000 && w[1] > 350000 && w[1] < 820000 ? w : null; }
    return null;
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

  // ---------- צבעים, סוגי קו וטקסט כמו ב-BricsCAD ----------
  // פלטת הצבעים של AutoCAD (ACI). 7 (לבן/שחור) נשמר כ-1- ומצויר לפי צבע הרקע
  const ACI = (() => {
    const t = [0, 0xFF0000, 0xFFFF00, 0x00FF00, 0x00FFFF, 0x0000FF, 0xFF00FF, -1, 0x808080, 0xC0C0C0];
    const V = [1, 0.8, 0.6, 0.5, 0.3];
    for (let i = 10; i < 250; i++) {
      const hue = Math.floor((i - 10) / 10) * 15, j = i % 10, v = V[j >> 1], sat = j & 1 ? 0.5 : 1;
      const f = n => { const k = (n + hue / 60) % 6; return Math.round(255 * v * (1 - sat * Math.max(0, Math.min(k, 4 - k, 1)))); };
      t[i] = (f(5) << 16) | (f(3) << 8) | f(1);
    }
    [0x333333, 0x505050, 0x696969, 0x828282, 0xBEBEBE, -1].forEach((c, k) => { t[250 + k] = c; });
    return t;
  })();
  const aci = i => (i > 0 && i < 256 ? ACI[i] : -1);

  // טקסט עברי בשרטוטים ישנים: גופן hebtxt.shx ממפה את הבתים 0x80-0x9A לאותיות (קידוד DOS 862), והקורא מפענח אותם כ-Windows-1252.
  // הטקסט שמור בסדר חזותי (משמאל לימין, כמו שהוא מצויר), ולכן הוא מצויר בכפייה משמאל לימין
  const W1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
    0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A };
  function decodeHeb(str) {
    let out = '';
    for (const ch of String(str)) {
      const c = ch.charCodeAt(0), b = c >= 0x80 && c <= 0x9A ? c : W1252[c];
      out += b != null && b >= 0x80 && b <= 0x9A ? String.fromCharCode(0x5D0 + b - 0x80) : ch;
    }
    return out;
  }
  // גופנים כמו miryl.shx: עברית מוקלדת במקלדת אנגלית (t=א, c=ב...), והגופן מצייר מימין לשמאל
  const KBD = { t: 'א', c: 'ב', d: 'ג', s: 'ד', v: 'ה', u: 'ו', z: 'ז', j: 'ח', y: 'ט', h: 'י', l: 'ך', f: 'כ', k: 'ל', o: 'ם', n: 'מ', i: 'ן', b: 'נ', x: 'ס', g: 'ע',
    ';': 'ף', p: 'פ', '.': 'ץ', m: 'צ', e: 'ק', r: 'ר', a: 'ש', ',': 'ת', w: "'", q: '/', "'": ',', '/': '.' };
  const KBD_FONT = /miryl/i;
  function cleanText(t, font) {
    t = String(t || '').replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, x) => String.fromCharCode(parseInt(x, 16)));
    if (KBD_FONT.test(font || '')) {
      // סדר חזותי: הגופן מצייר מימין לשמאל, אז הופכים
      return [...String(t || '').replace(/\\P/g, '\n').replace(/%%[a-zA-Z]/g, '')].map(c => KBD[c] || c).reverse().join('').split('\n').reverse().join('\n').replace(/^\s+|\s+$/g, '');
    }
    return decodeHeb(String(t || '')
      .replace(/\\P/g, '\n').replace(/\\~/g, ' ')
      .replace(/\\[ACFHQTWfhqtwacp][^;\\]*;/g, '').replace(/\\[LlOoKkNn]/g, '').replace(/\\S([^;]*);/g, (m, x) => x.replace(/[\^#/]/, '/'))
      .replace(/[{}]/g, '').replace(/\\\\/g, '\\')
      .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoOkK]/g, '').replace(/%%%/g, '%'))
      .replace(/\s+$/g, '');
  }

  // ---------- מילוי (HATCH) ----------
  // לולאות הגבול של מילוי: מערך של [[x,y],...] במערכת של הישות
  function hatchLoops(e) {
    const loops = [];
    for (const bp of e.boundaryPaths || []) {
      const pts = [];
      if (bp.vertices) {
        const v = bp.vertices, n = v.length;
        for (let i = 0; i < n; i++) {
          pts.push([v[i].x, v[i].y]);
          const q = v[(i + 1) % n];
          if (v[i].bulge && (i < n - 1 || bp.isClosed !== false)) for (const b of bulgePts([v[i].x, v[i].y], [q.x, q.y], v[i].bulge)) pts.push(b);
        }
      } else for (const ed of bp.edges || []) {
        if (ed.type === 1) { pts.push([ed.start.x, ed.start.y], [ed.end.x, ed.end.y]); }
        else if (ed.type === 2) {
          // קשת: בכיוון השעון הזוויות שמורות במהופך
          let a0 = ed.startAngle, a1 = ed.endAngle;
          if (ed.isCCW === false || ed.isCCW === 0) { a0 = -a0; a1 = -a1; [a0, a1] = [a1, a0]; const ar = arcPts(ed.center.x, ed.center.y, ed.radius, a0, a1).reverse(); pts.push(...ar); }
          else pts.push(...arcPts(ed.center.x, ed.center.y, ed.radius, a0, a1));
        } else if (ed.type === 3) {
          const mx = ed.end.x, my = ed.end.y, r1 = Math.hypot(mx, my), r2 = r1 * (ed.lengthOfMinorAxis || 1), rot = Math.atan2(my, mx);
          let a0 = ed.startAngle, a1 = ed.endAngle, ccw = !(ed.isCCW === false || ed.isCCW === 0);
          if (!ccw) { a0 = -a0; a1 = -a1; }
          let sw = a1 - a0; if (ccw && sw <= 0) sw += Math.PI * 2; if (!ccw && sw >= 0) sw -= Math.PI * 2;
          for (let k = 0; k <= 24; k++) {
            const a = a0 + sw * k / 24, x = r1 * Math.cos(a), y = r2 * Math.sin(a);
            pts.push([ed.center.x + x * Math.cos(rot) - y * Math.sin(rot), ed.center.y + x * Math.sin(rot) + y * Math.cos(rot)]);
          }
        } else if (ed.type === 4) {
          for (const c of (ed.fitDatum && ed.fitDatum.length ? ed.fitDatum : ed.controlPoints) || []) pts.push([c.x, c.y]);
        }
      }
      if (pts.length > 2) loops.push(pts);
    }
    return loops;
  }
  // קווי הדוגמה של המילוי, חתוכים בגבול (זוגי-אי-זוגי). מחזיר מערך של קטעים [x0,y0,x1,y1] (נקודה: אורך 0)
  function hatchLines(e, loops, budget) {
    const out = [];
    const edges = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const L of loops) for (let i = 0; i < L.length; i++) {
      const p = L[i], q = L[(i + 1) % L.length];
      edges.push([p[0], p[1], q[0], q[1]]);
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
    if (!edges.length) return out;
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
    for (const dl of e.definitionLines || []) {
      const ang = dl.angle || 0, dx = Math.cos(ang), dy = Math.sin(ang);
      const bx = dl.base ? dl.base.x : 0, by = dl.base ? dl.base.y : 0;
      const ox = dl.offset ? dl.offset.x : 0, oy = dl.offset ? dl.offset.y : 0;
      const nx = -dy, ny = dx, step = ox * nx + oy * ny;   // המרחק בין הקווים בניצב
      const shift = ox * dx + oy * dy;                    // הזזה לאורך הקו בין קו לקו
      if (Math.abs(step) < 1e-6) continue;
      const ds = corners.map(c => ((c[0] - bx) * nx + (c[1] - by) * ny) / step);
      const k0 = Math.ceil(Math.min(...ds)), k1 = Math.floor(Math.max(...ds));
      if (k1 - k0 > 4000) continue;
      const dash = (dl.dashLengths || []).filter(v => v != null);
      const tot = dash.reduce((a, v) => a + Math.abs(v), 0);
      for (let k = k0; k <= k1; k++) {
        const px = bx + ox * k, py = by + oy * k;
        // חיתוכים של הקו עם הגבול
        const ts = [];
        for (const [ax, ay, cx2, cy2] of edges) {
          const ex = cx2 - ax, ey = cy2 - ay, den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-12) continue;
          const wx = ax - px, wy = ay - py;
          const u = (wx * dy - wy * dx) / den;          // מיקום על צלע הגבול
          if (u < 0 || u >= 1) continue;
          ts.push((wx * ey - wy * ex) / den);
        }
        if (ts.length < 2) continue;
        ts.sort((a, b) => a - b);
        for (let i = 0; i + 1 < ts.length; i += 2) {
          const t0 = ts[i], t1 = ts[i + 1];
          if (!dash.length || tot < 1e-9) { out.push([px + dx * t0, py + dy * t0, px + dx * t1, py + dy * t1]); }
          else {
            // מקווקו: הדוגמה מתחילה בנקודת הבסיס של הקו
            const ph0 = k * shift;
            let t = t0 - ((((t0 - ph0) % tot) + tot) % tot);
            let n = 0;
            while (t < t1 && n++ < 5000) {
              for (const v of dash) {
                const len = Math.abs(v);
                if (v >= 0) {
                  const a = Math.max(t, t0), b = Math.min(t + len, t1);
                  if (b >= a && a <= t1 && t + len >= t0) out.push([px + dx * a, py + dy * a, px + dx * b, py + dy * b]);
                }
                t += len;
                if (t >= t1) break;
              }
            }
          }
          if (out.length > budget) return out;
        }
      }
    }
    return out;
  }

  function extract(db) {
    const blocks = new Map();
    for (const b of ((db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) || [])) blocks.set(b.name, b);
    const layerList = (db.tables && db.tables.LAYER && db.tables.LAYER.entries) || [];
    const hidden = new Set(layerList.filter(l => l.off || l.frozen || l.colorIndex < 0).map(l => l.name));
    const layers = new Map(layerList.map(l => [l.name, l]));
    const ltypes = new Map(((db.tables && db.tables.LTYPE && db.tables.LTYPE.entries) || []).map(l => [String(l.name || '').toUpperCase(), l]));
    const fonts = new Map(((db.tables && db.tables.STYLE && db.tables.STYLE.entries) || []).map(st => [String(st.name || '').toUpperCase(), String(st.font || '')]));
    const hdr = db.header || {};
    const LTS = (+hdr.LTSCALE > 0 ? +hdr.LTSCALE : 1) * (+hdr.CELTSCALE > 0 ? +hdr.CELTSCALE : 1);

    // סגנונות: [צבע, אינדקס קווקוו]. צבע = RGB, או 1- ללבן/שחור
    const styles = [], styleIdx = new Map(), dashes = [], dashIdx = new Map();
    const styleOf = (col, d) => { const k = col + '|' + d; let i = styleIdx.get(k); if (i == null) { i = styles.length; styles.push([col, d]); styleIdx.set(k, i); } return i; };
    function dashOf(name, scale) {
      const lt = ltypes.get(name);
      const pat = lt && (lt.pattern || []).map(p => p.elementLength).filter(v => typeof v === 'number');
      if (!pat || !pat.length || !pat.some(v => v < 0)) return -1;
      const k = name + '|' + scale;
      let i = dashIdx.get(k);
      if (i == null) { i = dashes.length; dashes.push(pat.map(v => Math.round(v * scale * 1e4) / 1e4)); dashIdx.set(k, i); }
      return i;
    }
    const colOf = (e, L) => {
      if (e.color != null && e.color >= 0 && e.colorIndex !== 256 && e.colorIndex !== 0 && e.color !== 0xFFFFFF) return e.color & 0xFFFFFF;
      return null;
    };
    // הצבע וסוג הקו של ישות. ישות בשכבה 0 בתוך בלוק מקבלת את השכבה של הבלוק, ו-BYBLOCK את הצבע של הבלוק
    function resolve(e, P) {
      const layName = e.layer === '0' && P.inBlock ? P.layer : e.layer;
      const L = layers.get(layName) || { colorIndex: 7, lineType: 'CONTINUOUS' };
      const ci = e.colorIndex == null ? 256 : e.colorIndex;
      let col = colOf(e, L);
      if (col == null) col = ci === 256 ? (L.color != null && L.colorIndex === 257 ? L.color : aci(Math.abs(L.colorIndex))) : ci === 0 ? P.col : aci(ci);
      let lt = String(e.lineType || 'BYLAYER').toUpperCase();
      if (lt === 'BYLAYER') lt = String(L.lineType || 'CONTINUOUS').toUpperCase();
      else if (lt === 'BYBLOCK') lt = P.lt;
      return { layer: layName, col, lt, lts: e.lineTypeScale > 0 ? e.lineTypeScale : 1 };
    }

    const paths = [], texts = [], fills = [], inserts = {};
    let budget = 400000;
    const add = (pts, R, closed) => {
      if (pts.length > 1) paths.push({ pts, closed: !!closed, s: styleOf(R.col, dashOf(R.lt, LTS * R.lts)) });
    };
    const scaleOf = M => Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
    // טקסט: נקודה, גובה, זווית, יישור (0 שמאל 1 מרכז 2 ימין; 0 קו בסיס 1 תחתית 2 אמצע 3 עליון), רוחב
    function addText(M, R, x, y, h, rot, str, ha, va, wf, style) {
      const font = fonts.get(String(style || '').toUpperCase()) || '';
      const t = cleanText(str, font);
      if (!t.trim() || !(h > 0)) return;
      const p = ap(M, x, y), sc = scaleOf(M), r = rot + Math.atan2(M[1], M[0]);
      // גופן SHX מצייר את התווים כמו שהם שמורים (סדר חזותי). גופן TrueType: טקסט רגיל (סדר לוגי)
      const logical = /\.(ttf|otf|ttc)$/i.test(font) || /^(arial|david|miriam|narkisim|tahoma|calibri|segoe|times|gisha|levenim|frank|rod|aharoni)/i.test(font);
      texts.push({ x: p[0], y: p[1], h: h * sc, r, t, s: styleOf(R.col, -1), ha, va, wf: wf && wf > 0 && wf !== 1 ? wf : 1, lg: logical ? 1 : 0 });
    }
    function textEnt(M, R, e, T) {
      // TEXT / ATTRIB: נקודת היישור (endPoint) כשיש יישור, אחרת נקודת ההתחלה
      T = T || e;
      let ha = T.halign || 0, va = T.valign || 0;
      if (ha === 4) { ha = 1; va = 2; }
      if (ha === 3 || ha === 5) { ha = 0; va = 0; }
      const useEnd = (ha || va) && T.endPoint && (T.endPoint.x || T.endPoint.y);
      const p = useEnd ? T.endPoint : T.startPoint || T.insertionPoint;
      if (!p) return;
      addText(M, R, p.x, p.y, T.textHeight, T.rotation || 0, T.text, ha > 2 ? 0 : ha, va, T.xScale, T.styleName);
    }

    function walk(list, M, depth, P) {
      for (const e of list || []) {
        if (e.isVisible === false) continue;
        const R = resolve(e, P);
        if (hidden.has(R.layer)) continue;
        try {
          switch (e.type) {
            case 'LINE': add([ap(M, e.startPoint.x, e.startPoint.y), ap(M, e.endPoint.x, e.endPoint.y)], R); break;
            case 'LWPOLYLINE': case 'POLYLINE2D': case 'POLYLINE3D': {
              const v = e.vertices || [], closed = (e.flag & 1) === 1, pts = [];
              for (let i = 0; i < v.length; i++) {
                const p = [v[i].x, v[i].y];
                pts.push(ap(M, p[0], p[1]));
                const q = v[i + 1] || (closed ? v[0] : null);
                if (q && v[i].bulge) for (const b of bulgePts(p, [q.x, q.y], v[i].bulge)) pts.push(ap(M, b[0], b[1]));
              }
              add(closed && pts.length ? pts.concat([pts[0]]) : pts, R); break;
            }
            case 'CIRCLE': add(arcPts(e.center.x, e.center.y, e.radius, 0, Math.PI * 2).map(p => ap(M, p[0], p[1])), R); break;
            case 'ARC': add(arcPts(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle).map(p => ap(M, p[0], p[1])), R); break;
            case 'ELLIPSE': {
              const mx = e.majorAxisEndPoint.x, my = e.majorAxisEndPoint.y, r1 = Math.hypot(mx, my), r2 = r1 * e.axisRatio, rot = Math.atan2(my, mx);
              let a0 = e.startAngle || 0, a1 = e.endAngle || Math.PI * 2;
              if (a1 <= a0) a1 += Math.PI * 2;
              const n = 36, pts = [];
              for (let i = 0; i <= n; i++) {
                const a = a0 + (a1 - a0) * i / n, x = r1 * Math.cos(a), y = r2 * Math.sin(a);
                pts.push(ap(M, e.center.x + x * Math.cos(rot) - y * Math.sin(rot), e.center.y + x * Math.sin(rot) + y * Math.cos(rot)));
              }
              add(pts, R); break;
            }
            case 'POINT': if (e.position) { const p = ap(M, e.position.x, e.position.y); add([p, p], R); } break;
            case 'SOLID': case 'TRACE': {
              const c = e.corner1 && [e.corner1, e.corner2, e.corner4 || e.corner3, e.corner3].filter(Boolean);
              if (c && c.length >= 3) fills.push({ s: styleOf(R.col, -1), loops: [c.map(p => ap(M, p.x, p.y))] });
              break;
            }
            case 'HATCH': {
              const loops = hatchLoops(e);
              if (!loops.length) break;
              const s = styleOf(R.col, -1);
              if (e.solidFill === 1 || /^SOLID$/i.test(e.patternName || '')) { fills.push({ s, loops: loops.map(L => L.map(p => ap(M, p[0], p[1]))) }); break; }
              if (budget <= 0) break;
              const segs = hatchLines(e, loops, Math.min(budget, 60000));
              budget -= segs.length;
              for (const g of segs) paths.push({ pts: [ap(M, g[0], g[1]), ap(M, g[2], g[3])], s });
              break;
            }
            case 'TEXT': textEnt(M, R, e); break;
            case 'MTEXT': {
              const ap1 = (e.attachmentPoint || 1) - 1;
              const dir = e.direction && (e.direction.x || e.direction.y) ? Math.atan2(e.direction.y, e.direction.x) : (e.rotation || 0);
              const p = e.insertionPoint;
              if (p) addText(M, R, p.x, p.y, e.textHeight, dir, e.text, ap1 % 3, 3 - Math.floor(ap1 / 3), 1, e.styleName);
              break;
            }
            case 'INSERT': {
              const p = ap(M, e.insertionPoint.x, e.insertionPoint.y);
              if (depth === 0) (inserts[e.name] = inserts[e.name] || []).push([String(e.handle || ''), p[0], p[1], attrLabel(e)]);
              // ערכי התכונות (ATTRIB) כבר במיקום הסופי שלהם, במערכת של מי שמכיל את הבלוק
              const PI = { inBlock: true, layer: R.layer, col: R.col, lt: R.lt };
              for (const a of e.attribs || []) {
                if (a.isVisible === false || (a.flags & 1)) continue;
                const RA = resolve(a, PI);
                if (!hidden.has(RA.layer)) textEnt(M, RA, a, a.text && typeof a.text === 'object' ? a.text : a);
              }
              if (depth > 4) break;
              const b = blocks.get(e.name);
              if (!b || !b.entities || !b.entities.length) break;
              const r = (e.rotation || 0), sx = e.xScale || 1, sy = e.yScale || 1, bp = b.basePoint || { x: 0, y: 0 };
              const T = [Math.cos(r) * sx, Math.sin(r) * sx, -Math.sin(r) * sy, Math.cos(r) * sy, e.insertionPoint.x, e.insertionPoint.y];
              walk(b.entities, mul(M, mul(T, [1, 0, 0, 1, -bp.x, -bp.y])), depth + 1, PI);
              break;
            }
          }
        } catch (_) { /* ישות פגומה: מדלגים */ }
      }
    }
    walk(db.entities, ID, 0, { inBlock: false, layer: '0', col: -1, lt: 'CONTINUOUS' });

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

    // שומרים יחסית לנקודת האמצע, בדיוק של מ"מ (קובץ קטן). קווים רחוקים מאוד מהאזור נזרקים
    const span = Math.max(view[2] - view[0], view[3] - view[1], 50);
    const far = (x, y) => Math.abs(x - ox) > span * 20 || Math.abs(y - oy) > span * 20;
    const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
    const P = [], PS = [];
    for (const p of paths) {
      if (p.pts.every(q => far(q[0], q[1]))) continue;
      const flat = [];
      for (const q of p.pts) flat.push(r3(q[0] - ox), r3(q[1] - oy));
      P.push(flat); PS.push(p.s);
    }
    const TX = texts.filter(t => !far(t.x, t.y)).map(t => [r3(t.x - ox), r3(t.y - oy), r3(t.h), Math.round(t.r * 1e4) / 1e4, t.t, t.s, t.ha, t.va, Math.round(t.wf * 100) / 100, t.lg]);
    const FL = fills.filter(f => !f.loops.every(L => L.every(q => far(q[0], q[1]))))
      .map(f => [f.s, ...f.loops.map(L => { const o = []; for (const q of L) o.push(r3(q[0] - ox), r3(q[1] - oy)); return o; })]);
    const ins = {};
    for (const [n, list] of Object.entries(inserts)) ins[n] = list.filter(r => !far(r[1], r[2])).map(r => [r[0], r2(r[1] - ox), r2(r[2] - oy), r[3]]);
    const itm = ox > 100000 && ox < 300000 && oy > 350000 && oy < 820000;
    return { v: 2, crs: itm ? 'itm' : 'local', ox, oy, view: view.map((v, i) => r2(v - (i % 2 ? oy : ox))), paths: P, ps: PS, st: styles, dash: dashes, texts: TX, fills: FL, inserts: ins, treeBlock };
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
    const W = (x, y) => world(survey.plan, x, y);
    // עצים ותחומים בקואורדינטות של המדידה (שרטוט על דף: לפי קנה המידה או הכיול)
    const trees = root.Core.sortTrees(survey.trees.filter(t => t.px != null && String(t.num || '').trim()))
      .map(t => { const w = W(t.px, t.py); return Object.assign({}, t, { px: w[0], py: w[1] }); });
    const polys = (survey.planPolys || []).filter(p => p.pts && p.pts.length >= 3).map(p => Object.assign({}, p, { pts: p.pts.map(q => W(q[0], q[1])) }));
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

  root.Plan = { ITM, STATUSES, NO_STATUS, statusOf, parseFile, extract, FORMATS, world, fromWorld, upm, calibrate, itmOf, isPaper, surveyorTrees, decodeHeb, ACI, toLL, fromLL, layoutLabels, sheetXml, addSheet, centroid, inside, loadLib };
})(typeof self !== 'undefined' ? self : globalThis);

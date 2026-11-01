// מסך המדידה בסקר לבנייה: המדידה של המודד, נגיעה בעץ של המודד או במקום ריק מסמנת עץ עם מספר משלי,
// עריכה בשטח (מספר, הזזה של עץ שלי בלבד, ביטול סימון, ביטול פעולה), תחימת קטעים בפוליגון, ומיקום GPS.
// מספרי העצים נפרשים כך שלא יעלו זה על זה, עם קו מוביל לנקודה, ומתעדכנים לפי הזום.
(function (root) {
  'use strict';

  const MY = '#1565c0';      // עץ שלי בלי ייעוד (בשטח)
  const SURV = '#6b6b6b';    // עץ של המודד שעוד לא סומן
  const box = (x, y, w, hh) => ({ x, y, w, h: hh });
  const over = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  // כיווני המספר סביב הנקודה (מסך: y למטה), קודם למעלה
  const DIRS = [[1, -1], [-1, -1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, -1], [0, 1]];

  async function open(ctx) {
    const { survey: s, h, toast } = ctx;
    const g = ctx.geom;
    const L = root.L;
    const itm = g.crs === 'itm' && !!root.proj4;
    const toMap = (x, y) => itm ? L.latLng(...root.Plan.toLL(x, y)) : L.latLng(y - g.oy, x - g.ox);
    const fromMap = ll => itm ? root.Plan.fromLL(ll.lat, ll.lng) : [ll.lng + g.ox, ll.lat + g.oy];

    s.planPolys = s.planPolys || [];
    const surveyor = root.Plan.surveyorTrees(g, s.plan.treeBlock);
    const svByH = new Map(surveyor.map(t => [t.h, t]));

    // ---------- מצב ----------
    let mode = 'mark';          // mark | area
    let selId = null;           // עץ נבחר
    let selPoly = null;         // תחום נבחר
    let moving = false;         // ממתין לנגיעה במיקום החדש
    let drawing = null;         // נקודות של תחום בציור
    let aerial = await DB.getKV('planAerial', false);
    // רקע שחור כמו ב-BricsCAD, כשיש בקובץ צבעים (DWG, DXF)
    const hasStyle = !!(g.st && g.st.length);
    let dark = hasStyle && await DB.getKV('planDark', true);
    // מספרי המודד: בקובץ עם תכונות גלויות הם כבר בשרטוט עצמו
    let showSurv = await DB.getKV('planShowSurv', !hasStyle);
    const undo = [];
    let gpsWatch = null, gpsPos = null;

    // ---------- מסך ----------
    const mapEl = h('div', { class: 'map-box plan-map' });
    const hint = h('div', { class: 'plan-hint' });
    const sheet = h('div', { class: 'plan-sheet hidden' });
    const legend = h('div', { class: 'plan-legend' });
    const btn = (label, title, on, cls) => h('button', { class: 'txt ' + (cls || ''), title: title || null, 'aria-label': title || null, onclick: on }, label);
    const markBtn = btn('סימון עצים', 'נגיעה בעץ של המודד או במקום ריק', () => setMode('mark'));
    const areaBtn = btn('תחימה', 'תחימת קטע בפוליגון', () => setMode('area'));
    const undoBtn = btn('↶', 'בטל פעולה אחרונה', doUndo);
    // GPS: במדידה ברשת ישראל, או בשרטוט על דף אחרי כיול
    const canGps = () => itm || !!(root.proj4 && root.Plan.isPaper(s.plan) && s.plan.cal);
    const gpsBtn = btn('📍', 'המיקום שלי', toggleGps);
    gpsBtn.hidden = !canGps();
    const layersBtn = btn('⋯', 'תצוגה', showLayers);
    const ov = h('div', { class: 'annot map-ov plan-ov' },
      h('div', { class: 'annot-bar' },
        h('span', { class: 'sp', style: 'font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, s.plan.name || 'מדידה'),
        h('div', { class: 'grp' }, markBtn, areaBtn),
        undoBtn, gpsBtn, layersBtn,
        btn('סגור', null, () => close(), 'save')),
      h('div', { class: 'annot-stage', style: 'position:relative;padding:0' }, mapEl, hint, legend, sheet));
    document.body.append(ov);
    const $$ = sel => [...document.querySelectorAll(sel)];

    // ---------- מפה ----------
    const map = L.map(mapEl, itm
      ? { maxZoom: 24, zoomSnap: 0.25, zoomDelta: 0.5, attributionControl: false, zoomControl: true, doubleClickZoom: false }
      : { crs: L.CRS.Simple, minZoom: -6, maxZoom: 9, zoomSnap: 0.25, zoomDelta: 0.5, attributionControl: false, zoomControl: true, doubleClickZoom: false });
    // נגיעות מהירות זו אחר זו מסמנות עצים, ולכן אין הגדלה בנגיעה כפולה
    let base = null;
    async function setBase() {
      if (base) { map.removeLayer(base); base = null; }
      mapEl.classList.toggle('plan-white', !(aerial && itm) && !dark);
      mapEl.classList.toggle('plan-dark', !(aerial && itm) && dark);
      if (!(aerial && itm)) return;
      const pref = await DB.getKV('mapLayer', 'גוגל – לוויין');
      base = ctx.tileLayer(pref).addTo(map);
      base.bringToBack && base.bringToBack();
    }
    // השרטוט עצמו מצויר בקנבס של העצים (drawCad), עם הצבעים, סוגי הקו, המילויים והטקסטים מהקובץ
    const cad = prepCad(g);
    // שרטוט שהוא תמונה (סריקה, צילום)
    if (g.image && ctx.imageUrl) L.imageOverlay(ctx.imageUrl, [toMap(0, 0), toMap(g.image.w, g.image.h)], { interactive: false }).addTo(map).bringToBack();
    const v = g.view;
    const fit = L.latLngBounds([toMap(v[0] + g.ox, v[1] + g.oy), toMap(v[2] + g.ox, v[3] + g.oy)]);
    // חוזרים למקום האחרון שבו עבדו על הסקר הזה
    const last = await DB.getKV('planView:' + s.id, null);
    const focus = ctx.focusId && s.trees.find(t => t.id === ctx.focusId && t.px != null);
    if (focus) { map.setView(toMap(focus.px, focus.py), Math.max(last ? last.z : 0, itm ? 21 : 4)); selId = focus.id; }
    else if (last) map.setView(last.c, last.z); else map.fitBounds(fit, { padding: [20, 20] });
    await setBase();
    map.setMinZoom(Math.floor(map.getBoundsZoom(fit) - 3));
    // בשרטוט על דף: עד פי 64 מהדף כולו (מעבר לזה רואים רק פיקסלים)
    if (!itm) map.setMaxZoom(Math.ceil(map.getBoundsZoom(fit) + 6));

    // ---------- שכבת עצים, מספרים ותחומים (קנבס אחד שמצויר מחדש בכל תזוזה) ----------
    const llCache = new Map();
    const llOf = (key, x, y) => { const k = key + ':' + x + ':' + y; let r = llCache.get(k); if (!r) { r = toMap(x, y); llCache.set(k, r); } return r; };
    const myTrees = () => s.trees.filter(t => t.px != null);
    const linked = () => new Set(s.trees.filter(t => t.pref).map(t => t.pref));
    let hits = [];   // [{kind, id, x, y, r}] לנגיעה
    let boxes = [];  // מלבני מספרים: נגיעה במספר בוחרת את העץ שלו

    const Overlay = L.Layer.extend({
      onAdd(m) {
        this._c = L.DomUtil.create('canvas', 'plan-canvas leaflet-zoom-animated');
        m.getPane('overlayPane').appendChild(this._c);
        m.on('moveend zoomend viewreset resize', this.redraw, this);
        if (m._zoomAnimated) m.on('zoomanim', this._anim, this);
        this.redraw();
      },
      onRemove(m) { m.off('moveend zoomend viewreset resize', this.redraw, this); m.off('zoomanim', this._anim, this); this._c.remove(); },
      _anim(e) {
        const sc = map.getZoomScale(e.zoom, map.getZoom());
        const off = map._latLngBoundsToNewLayerBounds(map.getBounds(), e.zoom, e.center).min;
        L.DomUtil.setTransform(this._c, off.subtract(this._pad.multiplyBy(sc)), sc);
      },
      redraw() {
        const size = map.getSize(), pad = size.multiplyBy(0.3).round();
        this._pad = pad;
        const c = this._c, dpr = root.devicePixelRatio || 1, W = size.x + pad.x * 2, H = size.y + pad.y * 2;
        c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
        L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]).subtract(pad));
        const cx = c.getContext('2d');
        cx.setTransform(dpr, 0, 0, dpr, pad.x * dpr, pad.y * dpr);
        drawCad(cx, size, pad, dpr);
        draw(cx, size, pad);
      },
    });
    const overlay = new Overlay().addTo(map);
    const redraw = () => overlay.redraw();

    // פיקסלים למטר בזום הנוכחי
    function ppm() {
      const c = map.getCenter(), p = map.latLngToContainerPoint(c);
      const m = fromMap(c), q = map.latLngToContainerPoint(toMap(m[0] + 1, m[1]));
      // פיקסלים ליחידת שרטוט, כפול יחידות למטר (בשרטוט על דף: לפי קנה המידה)
      return Math.max(0.01, Math.hypot(q.x - p.x, q.y - p.y) * root.Plan.upm(s.plan));
    }

    // ---------- ציור השרטוט ----------
    function onDark() { return dark && !(aerial && itm); }
    function drawCad(cx, size, pad, dpr) {
      if (!cad.n) return;
      // מטריצה מקואורדינטות השרטוט (יחסית ל-ox,oy) לפיקסלים במסך. האזור קטן, אז ההיטל כמעט ליניארי
      const c = fromMap(map.getCenter()), P = ll => map.latLngToContainerPoint(ll), d0 = 10 / root.Plan.upm(s.plan);
      const p0 = P(toMap(c[0], c[1])), p1 = P(toMap(c[0] + d0, c[1])), p2 = P(toMap(c[0], c[1] + d0));
      const a = (p1.x - p0.x) / d0, b = (p1.y - p0.y) / d0, cc = (p2.x - p0.x) / d0, dd = (p2.y - p0.y) / d0;
      const wx = c[0] - g.ox, wy = c[1] - g.oy, e = p0.x - a * wx - cc * wy, f = p0.y - b * wx - dd * wy;
      const sc = Math.hypot(a, b);   // פיקסלים ליחידת שרטוט
      // האזור שבמסך, ביחידות השרטוט
      const det = a * dd - b * cc;
      const inv = (X, Y) => [(dd * (X - e) - cc * (Y - f)) / det, (-b * (X - e) + a * (Y - f)) / det];
      const cs = [inv(-pad.x, -pad.y), inv(size.x + pad.x, -pad.y), inv(-pad.x, size.y + pad.y), inv(size.x + pad.x, size.y + pad.y)];
      const vx0 = Math.min(...cs.map(q => q[0])), vx1 = Math.max(...cs.map(q => q[0])), vy0 = Math.min(...cs.map(q => q[1])), vy1 = Math.max(...cs.map(q => q[1]));
      const fg = onDark() ? '#fff' : '#000';
      const css = col => col < 0 ? fg : '#' + col.toString(16).padStart(6, '0');
      const W = () => cx.setTransform(dpr * a, dpr * b, dpr * cc, dpr * dd, dpr * (e + pad.x), dpr * (f + pad.y));
      const S = () => cx.setTransform(dpr, 0, 0, dpr, pad.x * dpr, pad.y * dpr);
      const vis = i => !(cad.bb[i * 4 + 2] < vx0 || cad.bb[i * 4] > vx1 || cad.bb[i * 4 + 3] < vy0 || cad.bb[i * 4 + 1] > vy1);
      cx.save();
      // מילויים
      for (const fl of g.fills || []) {
        cx.beginPath(); W();
        for (let k = 1; k < fl.length; k++) { const L2 = fl[k]; for (let i = 0; i < L2.length; i += 2) i ? cx.lineTo(L2[i], L2[i + 1]) : cx.moveTo(L2[i], L2[i + 1]); cx.closePath(); }
        S(); cx.fillStyle = css(g.st[fl[0]][0]); cx.fill('evenodd');
      }
      // קווים, לפי סגנון (צבע וקווקוו)
      cx.lineWidth = 1; cx.lineCap = 'round'; cx.lineJoin = 'round';
      if (!hasStyle) { cx.globalAlpha = g.image ? 0.45 : 0.9; }
      for (const [si, list] of cad.groups) {
        const st = hasStyle ? g.st[si] : [0x333333, -1];
        cx.beginPath(); W();
        let any = false;
        for (const i of list) {
          if (!vis(i)) continue;
          const p = g.paths[i];
          cx.moveTo(p[0], p[1]);
          if (p.length === 4 && p[0] === p[2] && p[1] === p[3]) { cx.lineTo(p[0] + 0.5 / sc, p[1]); any = true; continue; }
          for (let k = 2; k < p.length; k += 2) cx.lineTo(p[k], p[k + 1]);
          any = true;
        }
        S();
        if (!any) continue;
        const dash = st[1] >= 0 && g.dash && g.dash[st[1]];
        if (dash) {
          let px = dash.map(v => Math.max(v === 0 ? 1 : 0.5, Math.abs(v) * sc));
          if (dash[0] < 0) px = px.slice(1).concat(px[0]);
          if (px.length % 2) px = px.concat(px);
          cx.setLineDash(px.reduce((x, y) => x + y, 0) < 4 ? [] : px);
        } else cx.setLineDash([]);
        cx.strokeStyle = g.image ? '#000' : css(st[0]); cx.stroke();
      }
      cx.setLineDash([]); cx.globalAlpha = 1;
      // טקסטים: גובה הטקסט בקובץ הוא גובה האותיות, ובקנבס גודל הגופן גדול בערך פי 1.4
      cx.textAlign = 'left'; cx.textBaseline = 'alphabetic';
      for (const t of g.texts || []) {
        const [x, y, hh, r, str, si, ha, va, wf, lg] = t;
        const hp = hh * sc;
        if (hp < 2.2) continue;
        if (x + hh * str.length < vx0 - hh * 2 || x - hh * str.length > vx1 + hh * 2 || y + hh * 4 < vy0 || y - hh * 4 > vy1) continue;
        const X = a * x + cc * y + e, Y = b * x + dd * y + f;
        const ang = Math.atan2(b * Math.cos(r) + dd * Math.sin(r), a * Math.cos(r) + cc * Math.sin(r));
        const lines = str.split('\n');
        const fsz = hp * 1.38;
        cx.setTransform(dpr, 0, 0, dpr, pad.x * dpr, pad.y * dpr);
        cx.translate(X, Y); cx.rotate(ang); if (wf !== 1) cx.scale(wf, 1);
        cx.font = `${fsz.toFixed(1)}px Arimo, Arial, sans-serif`;
        cx.fillStyle = css(g.st[si][0]);
        const lh = hp * 1.667, tot = hp + (lines.length - 1) * lh;
        let y0 = va === 3 ? hp : va === 2 ? hp - tot / 2 : va === 1 ? -(lines.length - 1) * lh : -(lines.length - 1) * lh;
        if (lines.length === 1 && va === 2) y0 = hp / 2;
        for (const ln of lines) {
          // גופן SHX: הטקסט שמור בסדר חזותי ומצויר כמו שהוא, משמאל לימין. גופן TrueType: עברית רגילה מימין לשמאל
          const txt = /[\u0590-\u05FF]/.test(ln) ? (lg ? '\u202B' : '\u202D') + ln + '\u202C' : ln;
          const w = ha ? cx.measureText(txt).width : 0;
          cx.fillText(txt, ha === 1 ? -w / 2 : ha === 2 ? -w : 0, y0);
          y0 += lh;
        }
      }
      cx.restore();
      S();
    }

    function draw(cx, size, pad) {
      hits = []; boxes = [];
      const P = ll => map.latLngToContainerPoint(ll);
      const k = ppm();
      const inView = p => p.x > -pad.x && p.y > -pad.y && p.x < size.x + pad.x && p.y < size.y + pad.y;

      // תחומים
      for (const poly of s.planPolys) {
        const pts = poly.pts.map(q => P(llOf('a', q[0], q[1])));
        if (pts.length < 3) continue;
        cx.beginPath(); pts.forEach((p, i) => i ? cx.lineTo(p.x, p.y) : cx.moveTo(p.x, p.y)); cx.closePath();
        const on = selPoly === poly.id;
        cx.fillStyle = on ? 'rgba(156,39,176,.22)' : 'rgba(156,39,176,.10)'; cx.fill();
        cx.lineWidth = on ? 3 : 2; cx.strokeStyle = '#9c27b0'; cx.setLineDash([8, 5]); cx.stroke(); cx.setLineDash([]);
        // שם התחום מעל הקודקוד העליון, כדי לא לכסות את העצים שבתוכו
        const top = pts.reduce((a, p) => p.y < a.y ? p : a, pts[0]);
        const n = myTrees().filter(t => root.Plan.inside([t.px, t.py], poly.pts)).length;
        label(cx, top.x, top.y - 16, [poly.name || 'תחום', n + ' עצים'].join(' · '), { bg: 'rgba(255,255,255,.9)', fg: '#6a1b9a', size: 13 });
      }
      if (drawing) {
        const pts = drawing.map(q => P(llOf('a', q[0], q[1])));
        cx.beginPath(); pts.forEach((p, i) => i ? cx.lineTo(p.x, p.y) : cx.moveTo(p.x, p.y));
        cx.lineWidth = 2.5; cx.strokeStyle = '#9c27b0'; cx.stroke();
        for (const p of pts) { cx.beginPath(); cx.arc(p.x, p.y, 6, 0, 7); cx.fillStyle = '#fff'; cx.fill(); cx.lineWidth = 2; cx.stroke(); }
      }

      // גודל הנקודות לפי הזום: עץ ברוחב כמטר, אבל לא פחות מ-4 ולא יותר מ-11 פיקסלים
      const rS = Math.max(3.5, Math.min(8, 0.35 * k)), rM = Math.max(5, Math.min(11, 0.5 * k));
      const used = linked();
      const occ = [];
      // עצים של המודד שעוד לא סומנו
      const svPts = [];
      for (const t of surveyor) {
        if (used.has(t.h)) continue;
        const p = P(llOf('s', t.x, t.y));
        if (!inView(p)) continue;
        cx.beginPath(); cx.arc(p.x, p.y, rS, 0, 7);
        if (hasStyle) { cx.lineWidth = 1.2; cx.strokeStyle = onDark() ? 'rgba(0,229,255,.7)' : 'rgba(0,120,160,.75)'; cx.stroke(); }
        else { cx.fillStyle = 'rgba(255,255,255,.85)'; cx.fill(); cx.lineWidth = 1.5; cx.strokeStyle = SURV; cx.stroke(); }
        hits.push({ kind: 'sv', id: t.h, x: p.x, y: p.y, r: rS });
        occ.push(box(p.x - rS, p.y - rS, rS * 2, rS * 2));
        svPts.push({ t, p });
      }
      // העצים שלי
      const mine = root.Core.sortTrees(myTrees());
      const myPts = [];
      for (const t of mine) {
        const p = P(llOf('t', t.px, t.py));
        myPts.push({ t, p });
        if (!inView(p)) continue;
        const st = root.Plan.statusOf(t.status);
        const col = t.status ? st.color : MY;
        cx.beginPath(); cx.arc(p.x, p.y, rM, 0, 7); cx.fillStyle = col; cx.fill();
        cx.lineWidth = 2; cx.strokeStyle = t.pref ? '#111' : '#fff'; cx.stroke();
        if (t.pref) { cx.beginPath(); cx.arc(p.x, p.y, Math.max(1.5, rM * 0.3), 0, 7); cx.fillStyle = '#111'; cx.fill(); }
        if (t.id === selId) { cx.beginPath(); cx.arc(p.x, p.y, rM + 6, 0, 7); cx.lineWidth = 3; cx.strokeStyle = '#ff1744'; cx.stroke(); }
        hits.push({ kind: 'my', id: t.id, x: p.x, y: p.y, r: rM });
        occ.push(box(p.x - rM, p.y - rM, rM * 2, rM * 2));
      }
      // מספרים שלי: במקום פנוי ליד הנקודה, ואם צפוף אז רחוק יותר עם קו מוביל.
      // בזום רחוק (פחות מ-4 פיקסלים למטר) רק מספרים שיש להם מקום ליד הנקודה, כדי שלא ייווצר כוכב של קווים
      const fs = Math.round(Math.max(13, Math.min(17, 11 + k * 0.12)));
      cx.font = `700 ${fs}px Arimo, Arial, sans-serif`;
      const placed = [];
      let hidden = 0;
      for (const { t, p } of myPts) {
        if (!inView(p)) continue;
        const txt = String(t.num || '?');
        const w = cx.measureText(txt).width + 10, hh = fs + 6;
        const spot = place(p, w, hh, rM, occ.concat(placed), k < 4);
        if (!spot) { hidden++; continue; }
        placed.push(spot.b);
        const st = root.Plan.statusOf(t.status);
        if (spot.lead) {
          const e = edgePoint(spot.b, p);
          cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(e.x, e.y); cx.lineWidth = 1.5; cx.strokeStyle = '#111'; cx.stroke();
        }
        rounded(cx, spot.b.x, spot.b.y, w, hh, 5);
        cx.fillStyle = t.id === selId ? '#fff59d' : '#fff'; cx.fill();
        cx.lineWidth = 2; cx.strokeStyle = t.status ? st.color : MY; cx.stroke();
        cx.fillStyle = '#111'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(txt, spot.b.x + w / 2, spot.b.y + hh / 2 + 1);
        boxes.push({ id: t.id, b: spot.b });
      }
      if (hidden) label(cx, size.x / 2, 120, `${hidden} מספרים מוסתרים, הגדל כדי לראות`, { bg: 'rgba(17,17,17,.75)', fg: '#fff', size: 13 });
      // מספרי המודד: קטנים, רק כשיש מקום (בזום קרוב), ולא על חשבון המספרים שלי
      if (showSurv && k > 6) {
        cx.font = `400 11px Arimo, Arial, sans-serif`;
        const all = occ.concat(placed);
        for (const { t, p } of svPts) {
          if (!t.name) continue;
          const w = cx.measureText(t.name).width + 4, hh = 13;
          const spot = place(p, w, hh, rS, all, true);
          if (!spot) continue;
          all.push(spot.b);
          cx.fillStyle = 'rgba(255,255,255,.75)'; cx.fillRect(spot.b.x, spot.b.y, w, hh);
          cx.fillStyle = '#555'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
          cx.fillText(t.name, spot.b.x + w / 2, spot.b.y + hh / 2 + 1);
        }
      }
      // מיקום GPS
      if (gpsPos) {
        const p = P(gpsLL()), r = Math.max(8, gpsPos.acc * k);
        cx.beginPath(); cx.arc(p.x, p.y, r, 0, 7); cx.fillStyle = 'rgba(33,150,243,.15)'; cx.fill();
        cx.beginPath(); cx.arc(p.x, p.y, 7, 0, 7); cx.fillStyle = '#2196f3'; cx.fill(); cx.lineWidth = 3; cx.strokeStyle = '#fff'; cx.stroke();
      }
    }

    // מקום למספר: טבעות סביב הנקודה, 8 כיוונים. strict: רק מקום פנוי לגמרי בטבעת הראשונה, אחרת לא מציגים
    function place(p, w, hh, r, occ, strict) {
      const rings = strict ? [r + 2] : [r + 3, r + 18, r + 34, r + 54, r + 78];
      let best = null;
      for (let ri = 0; ri < rings.length; ri++) {
        const d = rings[ri];
        for (const [dx, dy] of DIRS) {
          const x = dx > 0 ? p.x + d * (dy ? 0.7 : 1) : dx < 0 ? p.x - d * (dy ? 0.7 : 1) - w : p.x - w / 2;
          const y = dy > 0 ? p.y + d * (dx ? 0.7 : 1) : dy < 0 ? p.y - d * (dx ? 0.7 : 1) - hh : p.y - hh / 2;
          const b = box(x, y, w, hh);
          let o = 0;
          for (const q of occ) { o += over(b, q); if (o > 0 && !strict && best && o >= best.o) break; }
          if (!o) return { b, lead: ri > 0 };
          if (!best || o < best.o) best = { b, o, lead: ri > 0 };
        }
      }
      return strict ? null : best;
    }
    function edgePoint(b, p) {
      return { x: Math.max(b.x, Math.min(p.x, b.x + b.w)), y: Math.max(b.y, Math.min(p.y, b.y + b.h)) };
    }
    function rounded(cx, x, y, w, hh, r) {
      cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + hh, r); cx.arcTo(x + w, y + hh, x, y + hh, r);
      cx.arcTo(x, y + hh, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath();
    }
    function label(cx, x, y, txt, o) {
      cx.font = `600 ${o.size}px Arimo, Arial, sans-serif`;
      const w = cx.measureText(txt).width + 12, hh = o.size + 8;
      rounded(cx, x - w / 2, y - hh / 2, w, hh, 6); cx.fillStyle = o.bg; cx.fill();
      cx.fillStyle = o.fg; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(txt, x, y + 1);
    }

    // ---------- נגיעות ----------
    function hitAt(pt) {
      for (const b of boxes) if (pt.x >= b.b.x - 4 && pt.x <= b.b.x + b.b.w + 4 && pt.y >= b.b.y - 4 && pt.y <= b.b.y + b.b.h + 4) return { kind: 'my', id: b.id };
      let best = null, bd = Infinity;
      for (const t of hits) {
        const d = Math.hypot(t.x - pt.x, t.y - pt.y) - t.r;
        // העצים שלי קודמים לעצי המודד כשהם באותו מקום
        const dd = d - (t.kind === 'my' ? 4 : 0);
        if (d < 16 && dd < bd) { bd = dd; best = t; }
      }
      return best;
    }
    map.on('click', e => {
      const pt = e.containerPoint, xy = fromMap(e.latlng);
      if (calStep) return calTap(xy);
      if (mode === 'area') return areaTap(pt, xy);
      if (moving) return moveTo(xy);
      const hit = hitAt(pt);
      if (hit && hit.kind === 'my') return select(hit.id);
      if (hit && hit.kind === 'sv') return markSurveyor(svByH.get(hit.id));
      addAt(xy);
    });

    function nearestNum() { return root.Core.nextNum(s.trees); }
    function setXY(t, x, y) {
      t.px = Math.round(x * 100) / 100; t.py = Math.round(y * 100) / 100;
      const w = root.proj4 && root.Plan.itmOf(s.plan, t.px, t.py);
      if (w) { const ll = root.Plan.toLL(w[0], w[1]); t.lat = ll[0]; t.lon = ll[1]; t.acc = null; t.gpsSrc = 'plan'; t.gpsTime = Date.now(); }
    }
    function markSurveyor(sv) {
      const t = ctx.makeTree();
      t.num = nearestNum();
      t.pref = sv.h; t.pname = sv.name || '';
      setXY(t, sv.x, sv.y);
      s.trees.push(t);
      undo.push({ what: `סימון עץ ${t.num}`, run: () => removeTree(t, true) });
      changed(); select(t.id, true);
      flash(`עץ ${t.num}` + (sv.name ? ` (מודד ${sv.name})` : ''));
    }
    function addAt(xy) {
      const t = ctx.makeTree();
      t.num = nearestNum();
      setXY(t, xy[0], xy[1]);
      s.trees.push(t);
      undo.push({ what: `עץ חדש ${t.num}`, run: () => removeTree(t, true) });
      changed(); select(t.id, true);
      flash(`עץ חדש ${t.num}`);
    }
    function moveTo(xy) {
      const t = s.trees.find(x => x.id === selId);
      moving = false;
      if (!t || t.pref) { renderSheet(); return; }
      const old = [t.px, t.py, t.lat, t.lon, t.gpsSrc];
      setXY(t, xy[0], xy[1]);
      undo.push({ what: `הזזת עץ ${t.num}`, run: () => { [t.px, t.py, t.lat, t.lon, t.gpsSrc] = old; } });
      changed(); renderSheet();
    }
    function hasData(t) {
      return (t.photos || []).length || (t.notes || '').trim() || (!t.speciesAuto && (t.species || '').trim())
        || ['height', 'qty', 'trunk1', 'trunk2', 'trunk3', 'health', 'location', 'canopy', 'transplant'].some(k => t[k] != null && t[k] !== '');
    }
    async function removeTree(t, quiet) {
      if (!quiet && hasData(t) && !confirm(`לעץ ${t.num || ''} כבר יש פרטים${(t.photos || []).length ? ' ו-' + t.photos.length + ' תמונות' : ''}. לבטל את הסימון ולמחוק גם אותם?`)) return false;
      const photos = (t.photos || []).length;
      for (const p of t.photos || []) await DB.deletePhoto(p.id);
      const i = s.trees.indexOf(t);
      if (i < 0) return false;
      s.trees.splice(i, 1);
      if (!quiet) {
        // בלי תמונות אפשר להחזיר
        if (!photos) undo.push({ what: `ביטול סימון עץ ${t.num}`, run: () => { s.trees.splice(Math.min(i, s.trees.length), 0, t); } });
        else undo.length = 0;
      }
      if (selId === t.id) selId = null;
      changed(); renderSheet();
      return true;
    }
    function doUndo() {
      const u = undo.pop();
      if (!u) { flash('אין מה לבטל'); return; }
      u.run();
      if (selId && !s.trees.find(t => t.id === selId)) selId = null;
      changed(); renderSheet();
      flash('בוטל: ' + u.what);
    }

    // ---------- בחירה וגיליון פעולות ----------
    function select(id, fresh) {
      selId = id; selPoly = null; moving = false;
      renderSheet(); redraw();
      if (!fresh) { const t = s.trees.find(x => x.id === id); if (t) flash(`עץ ${t.num || ''}`); }
    }
    function renderSheet() {
      updateBar();
      if (mode === 'area') return renderAreaSheet();
      const t = selId && s.trees.find(x => x.id === selId);
      if (!t) { sheet.classList.add('hidden'); hint.textContent = moving ? '' : 'נגיעה בעץ של המודד מסמנת אותו. נגיעה במקום ריק מוסיפה עץ.'; hint.classList.toggle('hidden', false); return; }
      hint.textContent = moving ? 'גע במיקום החדש של העץ' : '';
      hint.classList.toggle('hidden', !moving);
      const st = t.status ? root.Plan.statusOf(t.status) : null;
      sheet.classList.remove('hidden');
      sheet.replaceChildren(
        h('div', { class: 'plan-sheet-head' },
          h('b', { style: 'font-size:20px' }, 'עץ ' + (t.num || '—')),
          t.pref ? h('span', { class: 'muted small' }, 'עץ של המודד' + (t.pname ? ' ' + t.pname : '') + ' · נעול במקום') : h('span', { class: 'muted small' }, 'עץ שהוספתי'),
          st ? h('span', { class: 'plan-chip', style: `--c:${st.color}` }, t.status) : null,
          (t.species || '').trim() && !t.speciesAuto ? h('span', { class: 'muted small' }, t.species) : null,
          h('button', { class: 'icon-btn plan-x', 'aria-label': 'סגור', onclick: () => { selId = null; moving = false; renderSheet(); redraw(); } }, '✕')),
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
          h('button', { class: 'btn', onclick: () => renumber(t) }, 'מספר'),
          t.pref ? null : h('button', { class: 'btn' + (moving ? ' primary' : ''), onclick: () => { moving = !moving; renderSheet(); } }, moving ? 'ביטול הזזה' : 'הזז'),
          h('button', { class: 'btn', onclick: () => removeTree(t) }, 'בטל סימון'),
          h('button', { class: 'btn primary', onclick: () => close(t.id) }, 'פרטי העץ')));
    }
    async function renumber(t) {
      const n = await ctx.askNumber(`מספר לעץ ${t.num || ''}`, t.pname ? `מספר המודד: ${t.pname}` : null);
      if (n == null) return;
      const v = String(n);
      if (s.trees.some(x => x !== t && root.Core.normNum(x.num) === v) && !confirm(`כבר יש עץ ${v}. לתת את אותו מספר גם לעץ הזה?`)) return;
      const old = t.num;
      t.num = v;
      undo.push({ what: `מספר ${old} ← ${v}`, run: () => { t.num = old; } });
      changed(); renderSheet();
    }

    // ---------- תחומים ----------
    function setMode(m) {
      mode = m; moving = false; drawing = null; selPoly = null;
      if (m === 'area') selId = null;
      renderSheet(); redraw();
    }
    function areaTap(pt, xy) {
      if (drawing) { drawing.push([Math.round(xy[0] * 100) / 100, Math.round(xy[1] * 100) / 100]); renderSheet(); redraw(); return; }
      const hit = [...s.planPolys].reverse().find(p => root.Plan.inside(xy, p.pts));
      selPoly = hit ? hit.id : null;
      renderSheet(); redraw();
    }
    function renderAreaSheet() {
      sheet.classList.remove('hidden'); hint.classList.add('hidden');
      if (drawing) {
        sheet.replaceChildren(
          h('div', { class: 'plan-sheet-head' }, h('b', {}, 'תחום חדש'), h('span', { class: 'muted small' }, `גע בפינות התחום לפי הסדר (${drawing.length} נקודות)`)),
          h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
            h('button', { class: 'btn', disabled: drawing.length ? null : '', onclick: () => { drawing.pop(); renderSheet(); redraw(); } }, 'בטל נקודה'),
            h('button', { class: 'btn', onclick: () => { drawing = null; renderSheet(); redraw(); } }, 'ביטול'),
            h('button', { class: 'btn primary', disabled: drawing.length >= 3 ? null : '', onclick: finishPoly }, 'סיום')));
        return;
      }
      const poly = s.planPolys.find(p => p.id === selPoly);
      if (!poly) {
        sheet.replaceChildren(
          h('div', { class: 'plan-sheet-head' }, h('b', {}, 'תחימה'), h('span', { class: 'muted small' }, s.planPolys.length ? 'נגיעה בתחום בוחרת אותו' : 'עוד אין תחומים')),
          h('div', { class: 'row', style: 'gap:8px' }, h('button', { class: 'btn primary', onclick: () => { drawing = []; renderSheet(); } }, '+ תחום חדש')));
        return;
      }
      const n = myTrees().filter(t => root.Plan.inside([t.px, t.py], poly.pts));
      sheet.replaceChildren(
        h('div', { class: 'plan-sheet-head' }, h('b', {}, poly.name || 'תחום'),
          h('span', { class: 'muted small' }, `${n.length} עצים` + (n.length ? ': ' + root.Core.sortTrees(n).map(t => t.num).join(', ') : '')),
          h('button', { class: 'icon-btn plan-x', 'aria-label': 'סגור', onclick: () => { selPoly = null; renderSheet(); redraw(); } }, '✕')),
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
          h('button', { class: 'btn', onclick: () => { const v = prompt('שם התחום', poly.name || ''); if (v == null) return; const old = poly.name; poly.name = v.trim(); undo.push({ what: 'שם תחום', run: () => { poly.name = old; } }); changed(); renderSheet(); } }, 'שם'),
          h('button', { class: 'btn', onclick: () => {
            if (!confirm(`למחוק את התחום "${poly.name || 'תחום'}"? (העצים לא נמחקים)`)) return;
            const i = s.planPolys.indexOf(poly); s.planPolys.splice(i, 1); selPoly = null;
            undo.push({ what: 'מחיקת תחום', run: () => { s.planPolys.splice(i, 0, poly); } });
            changed(); renderSheet();
          } }, 'מחק תחום'),
          h('button', { class: 'btn primary', onclick: () => { drawing = []; selPoly = null; renderSheet(); } }, '+ תחום חדש')));
    }
    function finishPoly() {
      const name = prompt('שם התחום (לא חובה)', `קטע ${s.planPolys.length + 1}`);
      if (name == null) return;
      const poly = { id: ctx.uid(), pts: drawing, name: name.trim() };
      s.planPolys.push(poly);
      drawing = null; selPoly = poly.id;
      undo.push({ what: 'תחום חדש', run: () => { const i = s.planPolys.indexOf(poly); if (i >= 0) s.planPolys.splice(i, 1); } });
      changed(); renderSheet();
    }

    // ---------- תצוגה ומיקום ----------
    function showLayers() {
      const row = (label, val, set) => h('label', { class: 'row', style: 'gap:10px;align-items:center;font-size:17px;padding:6px 0' },
        h('input', { type: 'checkbox', checked: val ? '' : null, style: 'width:22px;height:22px', onchange: e => set(e.target.checked) }), label);
      const box = h('div', { class: 'modal', onclick: e => { if (e.target === box) box.remove(); } },
        h('div', { class: 'card stack', style: 'max-width:380px;width:92%' },
          h('h2', { style: 'margin:0;font-size:20px' }, 'תצוגה'),
          itm ? row('תצלום אוויר מתחת למדידה (צריך קליטה)', aerial, v => { aerial = v; DB.setKV('planAerial', v); setBase(); redraw(); }) : null,
          hasStyle ? row('רקע שחור (כמו ב-BricsCAD)', dark, v => { dark = v; DB.setKV('planDark', v); setBase(); redraw(); }) : null,
          surveyor.length ? row('מספרי המודד (בזום קרוב)', showSurv, v => { showSurv = v; DB.setKV('planShowSurv', v); redraw(); }) : null,
          root.Plan.isPaper(s.plan) ? paperBox(() => box) : null,
          h('button', { class: 'btn', onclick: () => { map.fitBounds(fit, { padding: [20, 20] }); box.remove(); } }, 'כל המדידה'),
          h('div', { class: 'muted small' }, `${surveyor.length} עצים של המודד, ${myTrees().length} מסומנים`),
          h('button', { class: 'btn primary', onclick: () => box.remove() }, 'סגור')));
      document.body.append(box);
    }
    // ---------- שרטוט על דף: קנה מידה וכיול ----------
    // מיקום GPS במפה: רשת ישראל, ובשרטוט מכויל דרך הכיול ההפוך
    function gpsLL() {
      if (itm) return L.latLng(gpsPos.lat, gpsPos.lon);
      const w = root.Plan.fromLL(gpsPos.lat, gpsPos.lon), q = root.Plan.fromWorld(s.plan, w[0], w[1]);
      return toMap(q[0], q[1]);
    }
    function paperBox(getBox) {
      const close = () => getBox().remove();
      const p = s.plan;
      const sc = h('input', { class: 'in', inputmode: 'numeric', value: p.scale || 250, style: 'max-width:110px;text-align:center',
        onchange: e => { const v = parseFloat(String(e.target.value).replace(/^1\s*:\s*/, '')); if (v > 0) { p.scale = v; refreshLL(); changed(); } } });
      return h('div', { class: 'stack', style: 'border-top:1px solid var(--line, #ddd);padding-top:10px' },
        h('b', {}, 'שרטוט בלי קואורדינטות'),
        h('label', { class: 'row', style: 'gap:8px;align-items:center' }, 'קנה מידה 1:', sc),
        h('div', { class: 'muted small' }, p.cal ? '✓ מכויל: העצים יוצאים באקסל בקואורדינטות של המדידה.' : 'בלי כיול העצים יוצאים באקסל במטרים לפי קנה המידה, וב-BricsCAD מזיזים אותם לפי נקודת בסיס.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { close(); startCal(); } }, p.cal ? 'כיול מחדש' : 'כיול בשתי נקודות'),
          p.cal ? h('button', { class: 'btn', onclick: () => { p.cal = null; refreshLL(); changed(); gpsBtn.hidden = !canGps(); close(); flash('הכיול בוטל'); } }, 'בטל כיול') : null));
    }
    let calStep = 0, calA = null;
    function startCal() {
      calStep = 1; calA = null; selId = null; moving = false; drawing = null;
      sheet.classList.add('hidden');
      hint.classList.remove('hidden'); hint.textContent = 'כיול: גע בנקודה ראשונה שהקואורדינטות שלה ידועות (צלב רשת, נקודת מדידה)';
    }
    function askXY(n) {
      const v = prompt(`הקואורדינטות של נקודה ${n} (X,Y)`, '');
      if (v == null) return null;
      const m = String(v).match(/-?\d+(?:\.\d+)?/g);
      if (!m || m.length < 2) { alert('צריך שני מספרים: X ואז Y, למשל 220150.5, 632900.2'); return askXY(n); }
      return [+m[0], +m[1]];
    }
    function calTap(xy) {
      const W = askXY(calStep);
      if (!W) { calStep = 0; renderSheet(); return; }
      if (calStep === 1) { calA = [xy, W]; calStep = 2; hint.textContent = 'כיול: עכשיו גע בנקודה שנייה, רחוקה מהראשונה'; return; }
      const c = root.Plan.calibrate(calA[0], calA[1], xy, W);
      calStep = 0;
      if (!c) { alert('הנקודות זהות. נסה שוב עם שתי נקודות רחוקות זו מזו'); renderSheet(); return; }
      const old = s.plan.cal;
      s.plan.cal = c;
      undo.push({ what: 'כיול', run: () => { s.plan.cal = old; refreshLL(); gpsBtn.hidden = !canGps(); } });
      refreshLL(); gpsBtn.hidden = !canGps(); changed(); renderSheet();
      flash(`מכויל · קנה מידה 1:${Math.round(1000 / root.Plan.upm(s.plan))}`);
    }
    // אחרי שינוי קנה מידה או כיול: נ"צ של העצים שמיקומם מהשרטוט
    function refreshLL() { for (const t of myTrees()) if (t.lat == null || t.gpsSrc === 'plan') { delete t.lat; delete t.lon; setXY(t, t.px, t.py); } }

    function toggleGps() {
      if (gpsWatch != null) { navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; gpsPos = null; gpsBtn.classList.remove('on'); redraw(); return; }
      if (!navigator.geolocation) { toast('אין GPS בדפדפן הזה'); return; }
      gpsBtn.classList.add('on');
      let first = true;
      gpsWatch = navigator.geolocation.watchPosition(p => {
        gpsPos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
        if (first) { first = false; map.panTo(gpsLL()); }
        redraw();
      }, err => { toast(err.code === 1 ? 'צריך לאשר גישה למיקום בדפדפן' : 'אין מיקום כרגע', 3000); }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
    }

    function legendHtml() {
      const used = new Set(myTrees().map(t => t.status ? root.Plan.statusOf(t.status).key : ''));
      const items = root.Plan.STATUSES.filter(x => used.has(x.key)).map(x => [x.color, x.key]);
      if (used.has('')) items.push([MY, 'עץ מסומן']);
      items.push(['#fff', 'עץ של המודד']);
      legend.replaceChildren(...items.map(([c, t]) => h('span', {}, h('i', { style: `background:${c}` }), t)));
    }
    function updateBar() {
      markBtn.classList.toggle('on', mode === 'mark'); areaBtn.classList.toggle('on', mode === 'area');
      undoBtn.disabled = !undo.length;
      legendHtml();
    }
    let flashT = null;
    function flash(msg) {
      const el = h('div', { class: 'plan-flash' }, msg);
      $$('.plan-flash').forEach(x => x.remove());
      ov.append(el); clearTimeout(flashT); flashT = setTimeout(() => el.remove(), 1400);
    }
    function changed() { ctx.save(); redraw(); updateBar(); }

    renderSheet();
    setTimeout(() => { map.invalidateSize(); redraw(); }, 50);

    let done;
    function close(openId) {
      if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch);
      DB.setKV('planView:' + s.id, { c: map.getCenter(), z: map.getZoom() });
      map.remove(); ov.remove();
      $$('.plan-flash').forEach(x => x.remove());
      done(openId || null);
    }
    return new Promise(r => { done = r; });
  }

  // הכנה לציור: קבוצות קווים לפי סגנון, ומלבן חוסם לכל קו
  function prepCad(g) {
    const n = (g.paths || []).length, bb = new Float32Array(n * 4), groups = new Map();
    for (let i = 0; i < n; i++) {
      const p = g.paths[i];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < p.length; k += 2) { const x = p[k], y = p[k + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      bb[i * 4] = x0; bb[i * 4 + 1] = y0; bb[i * 4 + 2] = x1; bb[i * 4 + 3] = y1;
      const si = g.ps ? g.ps[i] : 0;
      let L = groups.get(si); if (!L) groups.set(si, L = []);
      L.push(i);
    }
    return { n: n + ((g.texts || []).length) + ((g.fills || []).length), bb, groups };
  }

  root.PlanView = { open };
})(self);

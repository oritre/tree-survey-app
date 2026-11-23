// תוספות למפת מסלול הנסיעה (1.142.0):
// 1. חיפוש חופשי במפה (כתובת, מקום, עסק), כמו בגוגל, עם ניווט מהתוצאה
// 2. שכבת חניות חינם: חניונים מ-OpenStreetMap (fee=no), שמורים במכשיר לעבודה בלי קליטה,
//    וחניות שלך שאתה מוסיף / עורך / מוחק (מסונכרנות בין המכשירים דרך ההגדרות המשותפות בגוגל דרייב)
(function (root) {
  'use strict';
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  const CELL = 0.1; // משבצת של כ-10 ק"מ: נטענת פעם אחת ונשמרת
  const MAX_AGE = 30 * 864e5; // משבצת ישנה מ-30 יום נטענת שוב כשיש קליטה
  const MIN_ZOOM = 12;
  const KINDS = { free: 'חינם', open: 'שטח פתוח / חנייה לא רשמית', temp: 'חניון זמני (עירייה)', hours: 'חינם בשעות / ימים מסוימים', cheap: 'בתשלום זול', paid: 'בתשלום' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const cellKey = (la, lo) => Math.floor(la / CELL) + '_' + Math.floor(lo / CELL);
  const cellBox = k => { const [a, b] = k.split('_').map(Number); return [a * CELL, b * CELL, (a + 1) * CELL, (b + 1) * CELL]; };
  // (ori) חניות בישראל בלבד: משבצות מחוץ לגבולות האלה לא נטענות
  const IL = [29.45, 34.2, 33.35, 35.95];
  function cellsIn(s, w, n, e) {
    s = Math.max(s, IL[0]); w = Math.max(w, IL[1]); n = Math.min(n, IL[2]); e = Math.min(e, IL[3]);
    const out = [];
    if (s > n || w > e) return out;
    for (let a = Math.floor(s / CELL); a <= Math.floor(n / CELL); a++) for (let b = Math.floor(w / CELL); b <= Math.floor(e / CELL); b++) out.push(a + '_' + b);
    return out;
  }

  // סיווג חניון לפי התגיות של OpenStreetMap: free = רשום שבחינם, maybe = פתוח לציבור ולא ידוע אם בתשלום, null = בתשלום / פרטי
  function classify(t) {
    const fee = String(t.fee || '').trim().toLowerCase(), acc = String(t.access || '').trim().toLowerCase();
    if (/^(private|no|permit|delivery|employees|residents)$/.test(acc)) return null;
    if (fee === 'no' || fee === 'free') return acc === 'customers' ? 'maybe' : 'free';
    // (1.143, ori) רחבות / שטחי עפר / חניה לא רשמית / חניון זמני: כמעט תמיד בלי תשלום, מוצגים כ"שטח פתוח"
    if (!fee && acc !== 'customers' && (t.informal === 'yes' || (t.temporary && t.temporary !== 'no') || /^(unpaved|dirt|gravel|fine_gravel|ground|compacted|earth|sand|grass|pebblestone|mud)$/.test(String(t.surface || '').toLowerCase()))) return 'open';
    if (!fee) return 'maybe';
    return null; // fee=yes / מחיר
  }
  function slim(e) {
    const t = e.tags || {}, lat = e.lat != null ? e.lat : e.center && e.center.lat, lon = e.lon != null ? e.lon : e.center && e.center.lon;
    if (lat == null || lon == null) return null;
    const c = classify(t);
    if (!c) return null;
    const o = { id: e.type[0] + e.id, lat: +lat.toFixed(6), lon: +lon.toFixed(6), c };
    for (const [k, v] of [['n', t['name:he'] || t.name], ['cap', t.capacity], ['p', t.parking], ['ms', t.maxstay], ['fc', t['fee:conditional']], ['oh', t.opening_hours], ['acc', t.access]]) if (v) o[k] = v;
    if (t.amenity === 'motorcycle_parking') o.moto = 1;
    if (t.informal === 'yes') o.inf = 1;
    if (t.temporary && t.temporary !== 'no') o.tmp = 1;
    if (t.surface) o.sf = t.surface;
    return o;
  }
  async function overpass(box) {
    const q = `[out:json][timeout:60];nwr["amenity"~"^(parking|motorcycle_parking)$"](${box.join(',')});out center tags;`;
    const errs = [];
    for (const u of OVERPASS) {
      const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 70000);
      try {
        const r = await fetch(u, { method: 'POST', body: new URLSearchParams({ data: q }), signal: ac.signal });
        if (!r.ok) throw new Error(r.status);
        const j = await r.json();
        return (j.elements || []).map(slim).filter(Boolean);
      } catch (e) { errs.push(e.name === 'AbortError' ? 'timeout' : e.message); }
      finally { clearTimeout(tm); }
    }
    throw new Error('OpenStreetMap לא זמין (' + errs.join(', ') + ')');
  }

  // ---------- החניות שלך: KV myParking = [{ id, lat, lon, name, note, kind, u, del? }], ו-{ id: 'osm:<id>', hide: true } לחניון OSM שהסתרת ----------
  async function mine() { return (await DB.getKV('myParking', [])) || []; }
  async function saveMine(arr) {
    await DB.setKV('myParking', arr);
    if (root.Sync && root.Sync.parkingChanged) root.Sync.parkingChanged();
  }
  async function upsert(rec) {
    const arr = await mine(), i = arr.findIndex(x => x.id === rec.id);
    rec.u = Date.now();
    if (i >= 0) arr[i] = rec; else arr.push(rec);
    await saveMine(arr);
  }
  // מיזוג בין מכשירים: לפי id, מה שעודכן אחרון מנצח (גם מחיקה, שנשארת כסימון del)
  function merge(a, b) {
    const m = new Map();
    for (const x of [...(a || []), ...(b || [])]) { const y = m.get(x.id); if (!y || (x.u || 0) > (y.u || 0)) m.set(x.id, x); }
    return [...m.values()];
  }

  // ---------- משבצות OSM שמורות במכשיר ----------
  const mem = new Map();
  async function cell(k) {
    if (!mem.has(k)) mem.set(k, await DB.getKV('park2:' + k, null));
    return mem.get(k);
  }
  let loading = null;
  // טוען משבצות שחסרות / ישנות (כשיש קליטה). מחזיר כמה נטענו
  async function fetchCells(keys, force) {
    if (navigator.onLine === false) return 0;
    const need = [];
    for (const k of keys) { const c = await cell(k); if (force || !c || Date.now() - c.t > MAX_AGE) need.push(k); }
    let n = 0;
    for (const k of need.slice(0, 12)) {
      const items = await overpass(cellBox(k));
      const v = { t: Date.now(), items };
      mem.set(k, v); await DB.setKV('park2:' + k, v); n++;
    }
    return n;
  }

  // ---------- חיפוש ----------
  // search(q, center) מחזיר [{ lat, lon, label }] (מגיע מהמסך: אותם שירותי איתור של הרשימות)
  function attach(map, opts) {
    const ui = opts.ui, { h } = ui, mapEl = map.getContainer();
    let on = false, showMaybe = false, layer = null, tmp = null, picking = null, redrawT = 0;

    // ---- תיבת החיפוש בפינת המפה ----
    const inp = h('input', { class: 'in', type: 'search', placeholder: '🔎 חיפוש: כתובת, מקום, עסק', 'aria-label': 'חיפוש במפה', enterkeyhint: 'search' });
    const res = h('div', { class: 'mx-res', hidden: true });
    const go = h('button', { class: 'btn primary', type: 'button', 'aria-label': 'חפש' }, 'חפש');
    const searchBox = h('div', { class: 'mx-search' }, h('div', { class: 'row', style: 'gap:4px' }, inp, go), res);
    const pBtn = h('button', { class: 'btn mx-pbtn', type: 'button', title: 'חניות חינם' }, '🅿 חניות');
    const addBtn = h('button', { class: 'btn mx-pbtn', type: 'button', title: 'הוסף חנייה שלך', hidden: true }, '➕ חנייה');
    const maybeBtn = h('label', { class: 'mx-maybe', hidden: true }, h('input', { type: 'checkbox' }), ' גם לא ידוע');
    const pStat = h('div', { class: 'mx-stat', hidden: true });
    const box = h('div', { class: 'mx-box', dir: 'rtl' }, searchBox, h('div', { class: 'row', style: 'gap:4px;flex-wrap:wrap;align-items:center' }, pBtn, addBtn, maybeBtn), pStat);
    const Ctl = L.Control.extend({ onAdd() { return box; } });
    new Ctl({ position: 'topright' }).addTo(map);
    L.DomEvent.disableClickPropagation(box); L.DomEvent.disableScrollPropagation(box);
    ['keydown', 'keyup', 'keypress'].forEach(ev => box.addEventListener(ev, e => e.stopPropagation()));

    const navLinks = (lat, lon) => h('div', { class: 'row', style: 'gap:6px;margin-top:6px;flex-wrap:wrap' },
      h('a', { class: 'btn', href: `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`, target: '_blank', rel: 'noopener' }, '🚗 וייז'),
      h('a', { class: 'btn', href: `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${lat},${lon}`, target: '_blank', rel: 'noopener' }, 'גוגל מפות'));
    function showFound(p) {
      if (tmp) tmp.remove();
      tmp = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'mx-found', html: '📍', iconSize: [30, 30], iconAnchor: [15, 28] }), zIndexOffset: 900 }).addTo(map);
      const name = String(p.label || '').split(',')[0];
      tmp.bindPopup(() => h('div', { class: 'wl-popup', dir: 'rtl' }, h('b', {}, name || 'נמצא'), h('div', { class: 'muted small' }, p.label || ''), navLinks(p.lat, p.lon),
        h('div', { class: 'row', style: 'gap:6px;margin-top:6px;flex-wrap:wrap' },
          h('button', { class: 'btn', onclick: () => { map.closePopup(); editSpot({ lat: p.lat, lon: p.lon, name, kind: 'free' }); } }, '➕ שמור כחנייה שלי'),
          h('button', { class: 'btn', onclick: () => { tmp.remove(); tmp = null; } }, '✕ הסר סימון'))));
      if (opts.onMoved) opts.onMoved();
      map.setView([p.lat, p.lon], Math.max(map.getZoom(), 16));
      tmp.openPopup();
    }
    async function doSearch() {
      const t = inp.value.trim();
      if (!t) { res.hidden = true; return; }
      res.hidden = false; res.replaceChildren(h('div', { class: 'muted small' }, 'מחפש…'));
      // קודם במקומות שלך (חניות), אחר כך בשירותי המפה
      const words = t.split(/\s+/).filter(Boolean);
      const own = (await mine()).filter(x => !x.del && !x.hide && words.every(w => ((x.name || '') + ' ' + (x.note || '')).includes(w))).slice(0, 3)
        .map(x => ({ lat: x.lat, lon: x.lon, label: '🅿 ' + (x.name || 'חנייה שלי') + (x.note ? ', ' + x.note : '') }));
      let found = [];
      try { found = await opts.search(t, map.getCenter()); } catch (e) { if (!own.length) { res.replaceChildren(h('div', { class: 'muted small' }, e.message)); return; } }
      const all = [...own, ...found];
      if (!all.length) { res.replaceChildren(h('div', { class: 'muted small' }, `לא נמצא "${t}". נסה לכתוב אחרת (עם העיר)`)); return; }
      if (all.length === 1) { res.hidden = true; showFound(all[0]); return; }
      res.replaceChildren(...all.map(p => h('button', { class: 'mx-item', type: 'button', onclick: () => { res.hidden = true; showFound(p); } }, p.label || `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`)),
        h('button', { class: 'mx-item muted', type: 'button', onclick: () => { res.hidden = true; } }, 'סגור'));
    }
    go.onclick = doSearch;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } else if (e.key === 'Escape') res.hidden = true; });
    inp.addEventListener('search', () => { if (!inp.value) { res.hidden = true; if (tmp) { tmp.remove(); tmp = null; } } });

    // ---- חניות ----
    const icon = (cls, txt) => L.divIcon({ className: 'mx-park ' + cls, html: txt, iconSize: [24, 24], iconAnchor: [12, 12] });
    function osmPopup(o, rec) {
      const lines = [];
      lines.push(o.c === 'free' ? '<b style="color:#1e7d32">חינם</b> (לפי OpenStreetMap)' : o.c === 'open' ? '<b style="color:#1e7d32">' + (o.tmp ? 'חניון זמני' : o.inf ? 'חנייה לא רשמית' : 'שטח פתוח / עפר') + '</b>, כנראה בלי תשלום' : '<b style="color:#8a6d00">לא ידוע אם בתשלום</b>' + (o.acc === 'customers' ? ' · ללקוחות' : ''));
      if (o.cap) lines.push('מקומות: ' + esc(o.cap));
      if (o.p) lines.push({ surface: 'חניון פתוח', underground: 'חניון תת-קרקעי', 'multi-storey': 'חניון קומות', street_side: 'בצד הרחוב', lane: 'לאורך הרחוב', rooftop: 'על הגג' }[o.p] || esc(o.p));
      if (o.ms) lines.push('זמן מרבי: ' + esc(o.ms));
      if (o.fc) lines.push('תשלום: ' + esc(o.fc));
      if (o.oh) lines.push('שעות: ' + esc(o.oh));
      if (o.moto) lines.push('חניית אופנועים');
      const d = h('div', { class: 'wl-popup', dir: 'rtl' }, h('b', {}, o.n || (o.moto ? 'חניית אופנועים' : 'חניון')));
      const info = h('div', { class: 'small' }); info.innerHTML = lines.join('<br>'); d.append(info, navLinks(o.lat, o.lon),
        h('div', { class: 'row', style: 'gap:6px;margin-top:6px;flex-wrap:wrap' },
          h('button', { class: 'btn', onclick: () => { map.closePopup(); editSpot({ lat: o.lat, lon: o.lon, name: o.n || '', kind: o.c === 'free' ? 'free' : o.c === 'open' ? (o.tmp ? 'temp' : 'open') : 'hours', from: o.id }); } }, '⭐ שמור כשלי'),
          h('button', { class: 'btn', title: 'לא חינם / לא מתאים: לא יוצג יותר', onclick: async () => { map.closePopup(); await upsert({ id: 'osm:' + o.id, hide: true }); draw(); ui.toast('החניון הוסתר. אפשר להחזיר מ"חניות שהסתרת" ברשימת החניות', 3500); } }, '🚫 הסתר')));
      if (rec) d.append(h('div', { class: 'muted small' }, 'נתונים מ-OpenStreetMap, ייתכן שלא מעודכנים'));
      return d;
    }
    function minePopup(x) {
      return h('div', { class: 'wl-popup', dir: 'rtl' }, h('b', {}, '🅿 ' + (x.name || 'חנייה שלי')),
        h('div', { class: 'small' }, KINDS[x.kind] || ''), x.note ? h('div', { class: 'small', style: 'white-space:pre-wrap' }, x.note) : null,
        navLinks(x.lat, x.lon),
        h('div', { class: 'row', style: 'gap:6px;margin-top:6px;flex-wrap:wrap' },
          h('button', { class: 'btn', onclick: () => { map.closePopup(); editSpot(x); } }, '✏️ ערוך'),
          h('button', { class: 'btn', onclick: () => { map.closePopup(); ui.toast('גרור את הסימון למקום המדויק', 3000); const mk = mineMk.get(x.id); if (mk) mk.dragging.enable(); } }, '✥ הזז')));
    }
    const mineMk = new Map();
    async function draw() {
      if (layer) { layer.remove(); layer = null; }
      mineMk.clear();
      if (!on) return;
      layer = L.layerGroup().addTo(map);
      const my = (await mine()).filter(x => !x.del);
      const hidden = new Set(my.filter(x => x.hide).map(x => x.id.slice(4)));
      const savedFrom = new Set(my.filter(x => x.from).map(x => x.from));
      for (const x of my) {
        if (x.hide) continue;
        const mk = L.marker([x.lat, x.lon], { icon: icon('mine k-' + (x.kind || 'free'), 'P'), zIndexOffset: 500 }).addTo(layer).bindPopup(() => minePopup(x));
        mk.on('dragend', async e => { const p = e.target.getLatLng(); mk.dragging.disable(); await upsert(Object.assign({}, x, { lat: +p.lat.toFixed(6), lon: +p.lng.toFixed(6) })); ui.toast('המיקום נשמר', 2000); draw(); });
        mineMk.set(x.id, mk);
      }
      const z = map.getZoom();
      if (z < MIN_ZOOM) { stat(my.some(x => !x.hide) ? 'התקרב כדי לראות את חניוני OpenStreetMap' : 'התקרב כדי לראות חניות'); return; }
      const b = map.getBounds().pad(0.2);
      let nf = 0, nm = 0, missing = 0;
      const seen = new Set(); // חניון על גבול בין משבצות מגיע בשתיהן
      for (const k of cellsIn(b.getSouth(), b.getWest(), b.getNorth(), b.getEast())) {
        const c = await cell(k);
        if (!c) { missing++; continue; }
        for (const o of c.items) {
          if (seen.has(o.id) || hidden.has(o.id) || savedFrom.has(o.id) || !b.contains([o.lat, o.lon])) continue;
          seen.add(o.id);
          if (o.c === 'maybe' && !showMaybe) continue;
          if (o.c === 'maybe' && z < 14) continue;
          L.marker([o.lat, o.lon], { icon: icon(o.c, o.moto ? '🛵' : 'P') }).addTo(layer).bindPopup(() => osmPopup(o, true));
          o.c === 'maybe' ? nm++ : nf++;
        }
      }
      stat(`${nf} חינם / שטח פתוח` + (showMaybe ? ` · ${nm} לא ידוע` : '') + (missing ? (navigator.onLine === false ? ' · אזור שלא נשמר (אין קליטה)' : ' · טוען…') : ''));
    }
    const stat = t => { pStat.textContent = t; pStat.hidden = !on || !t; };
    async function refresh(force) {
      if (!on) return;
      await draw();
      if (map.getZoom() < MIN_ZOOM || loading) return;
      const b = map.getBounds().pad(0.2);
      loading = fetchCells(cellsIn(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()), force)
        .then(n => { if (n) draw(); })
        .catch(e => stat('לא נטען: ' + e.message))
        .finally(() => { loading = null; });
    }
    map.on('moveend', () => { clearTimeout(redrawT); redrawT = setTimeout(() => refresh(), 400); });
    async function setOn(v) {
      on = v; pBtn.classList.toggle('primary', on); addBtn.hidden = maybeBtn.hidden = listBtn.hidden = !on; pStat.hidden = !on;
      await DB.setKV('parkOn', on);
      if (on) refresh(); else draw();
    }
    pBtn.onclick = () => setOn(!on);
    maybeBtn.querySelector('input').onchange = e => { showMaybe = e.target.checked; DB.setKV('parkMaybe', showMaybe); draw(); };
    addBtn.onclick = () => {
      picking = true; mapEl.classList.add('picking');
      ui.toast('לחץ על המפה במקום החנייה', 4000);
    };
    map.on('click', e => { if (!picking) return; picking = null; mapEl.classList.remove('picking'); editSpot({ lat: +e.latlng.lat.toFixed(6), lon: +e.latlng.lng.toFixed(6), kind: 'free' }); });

    function editSpot(x0) {
      const x = Object.assign({}, x0), isNew = !x.id;
      const name = h('input', { class: 'in', value: x.name || '', placeholder: 'שם (למשל: חניון ליד הגן, רחוב...)' });
      const kind = h('select', { class: 'in' }, Object.entries(KINDS).map(([k, v]) => h('option', { value: k, selected: (x.kind || 'free') === k ? '' : null }, v)));
      const note = h('textarea', { class: 'in', rows: 3, placeholder: 'הערה: שעות, כמה מקומות, איך נכנסים…' }); note.value = x.note || '';
      const close = () => ov.remove();
      const ov = h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
        h('div', { class: 'card stack', style: 'max-width:480px;width:96%' },
          h('h2', { style: 'margin:0;font-size:20px' }, isNew ? '🅿 חנייה חדשה' : '🅿 עריכת חנייה'),
          name, kind, note,
          h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
            h('button', { class: 'btn primary', onclick: async () => {
              const rec = { id: x.id || uid(), lat: x.lat, lon: x.lon, name: name.value.trim(), kind: kind.value, note: note.value.trim() };
              if (x.from) rec.from = x.from;
              await upsert(rec); close();
              if (!on) await setOn(true); else draw();
              ui.toast('החנייה נשמרה', 2000);
            } }, 'שמור'),
            !isNew ? h('button', { class: 'btn danger', onclick: async () => { await upsert({ id: x.id, del: true }); close(); draw(); ui.toast('החנייה נמחקה', 2000); } }, '🗑 מחק') : null,
            h('button', { class: 'btn', onclick: close }, 'ביטול'))));
      document.body.append(ov);
      name.focus();
    }

    // רשימת החניות שלך + חניונים שהסתרת (להחזרה)
    async function listDialog() {
      const my = (await mine()).filter(x => !x.del);
      const close = () => ov.remove();
      const ov = h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
        h('div', { class: 'card stack', style: 'max-width:560px;width:96%;max-height:86vh;overflow:auto' },
          h('h2', { style: 'margin:0;font-size:20px' }, '🅿 החניות שלי'),
          my.filter(x => !x.hide).length ? null : h('div', { class: 'muted small' }, 'עוד אין. לחץ "➕ חנייה" ואז על המפה, או "⭐ שמור כשלי" על חניון ירוק.'),
          ...my.filter(x => !x.hide).map(x => h('div', { class: 'wl-stop' },
            h('div', { style: 'flex:1;min-width:0' }, h('b', {}, x.name || 'חנייה'), h('div', { class: 'muted small' }, [KINDS[x.kind], x.note].filter(Boolean).join(' · '))),
            h('button', { class: 'btn', onclick: () => { close(); if (opts.onMoved) opts.onMoved(); map.setView([x.lat, x.lon], 17); setTimeout(() => { const mk = mineMk.get(x.id); if (mk) mk.openPopup(); }, 400); } }, 'במפה'))),
          my.some(x => x.hide) ? h('div', { class: 'muted small' }, `חניונים שהסתרת: ${my.filter(x => x.hide).length}`) : null,
          my.some(x => x.hide) ? h('button', { class: 'btn', onclick: async () => { const arr = await mine(); arr.forEach(x => { if (x.hide && !x.del) { x.del = true; x.u = Date.now(); } }); await saveMine(arr); close(); draw(); } }, 'החזר את כל החניונים שהסתרת') : null,
          h('div', { class: 'small' }, 'מקרא: P כחול = חניון רשום כחינם · P ירוק = שטח פתוח / עפר / חנייה לא רשמית / חניון זמני · P אפור = לא ידוע אם בתשלום · P סגול = שלך'),
          h('div', { class: 'muted small' }, 'החניונים הכחולים, הירוקים והאפורים מגיעים מ-OpenStreetMap ונשמרים במכשיר. ' + (navigator.onLine === false ? '' : 'כדי לעבוד בלי קליטה, הם נשמרים אוטומטית סביב התחנות במסלול ובכל מקום שפתחת במפה.')),
          h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
            h('button', { class: 'btn', onclick: async e => { const b = map.getBounds(); e.target.disabled = true; e.target.textContent = 'טוען…'; try { const n = await fetchCells(cellsIn(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()), true); ui.toast(n ? 'החניונים באזור עודכנו' : 'אין קליטה', 2500); draw(); } catch (err) { ui.toast(err.message, 4000); } close(); } }, '⟳ רענן חניונים באזור המפה'),
            h('button', { class: 'btn', onclick: close }, 'סגור'))));
      document.body.append(ov);
    }
    pStat.onclick = listDialog;
    pStat.title = 'החניות שלי';
    const listBtn = h('button', { class: 'btn mx-pbtn', type: 'button', title: 'החניות שלי', hidden: true, onclick: listDialog }, '☰');
    addBtn.after(listBtn);

    (async () => {
      showMaybe = !!(await DB.getKV('parkMaybe', false)); maybeBtn.querySelector('input').checked = showMaybe;
      if (await DB.getKV('parkOn', false)) await setOn(true);
    })();

    return {
      // שומר מראש את החניונים סביב הנקודות (התחנות במסלול), כדי שיהיו גם בלי קליטה
      async prefetch(pts) {
        if (!(await DB.getKV('parkOn', false)) || navigator.onLine === false) return;
        const ks = new Set();
        for (const p of pts) if (p && isFinite(p.lat)) cellsIn(p.lat - 0.02, p.lon - 0.02, p.lat + 0.02, p.lon + 0.02).forEach(k => ks.add(k));
        try { if (await fetchCells([...ks])) draw(); } catch (e) { /* ינסה שוב בפעם הבאה */ }
      },
    };
  }

  root.MapExtras = { attach, merge, mine, _t: { classify, slim, cellKey, cellsIn, cellBox, merge } };
})(window);

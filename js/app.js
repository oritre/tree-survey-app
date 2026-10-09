// אפליקציית סקר בטיחות עצים לטאבלט
(function () {
  'use strict';
  const APP_VERSION = '1.1.1';

  const SPECIES_SEED = ['אורן ירושלים', 'אורן קנרי', 'אורן ברוטיה', 'אורן הצנובר', 'ברוש מצוי', 'פיקוס השדרות', 'פיקוס בנימינה',
    'פיקוס קדוש', 'פיקוס התאנה', 'מכנף נאה', 'צאלון נאה', 'ברכיכיטון אדרי', 'אזדרכת מצויה', 'תות לבן', 'שיטה מכחילה',
    'אילנטה בלוטית', 'פרקינסוניה שיכנית', 'וושינגטוניה חסונה', 'תמר מצוי', 'דקל קנרי', 'זית אירופי', 'חרוב מצוי',
    'אלון מצוי', 'אלה אטלנטית', 'כליל החורש', 'מילה סורית', 'דולב מזרחי', 'אקליפטוס המקור', 'קזוארינה',
    "ג'קרנדה עלי-מימוזה", 'טיפואנה', 'ליגוסטרום יפני', 'אלביציה צהבהבה', 'שקד מצוי', 'רימון מצוי', 'תאנה', 'הדר', 'צפצפה', 'ערבה', 'סיגלון'];
  const PHRASE_SEED = ['גיזום ענפים יבשים', 'הרמת נוף', 'דילול נוף', 'גיזום ענפים הנוגעים במבנה', 'גיזום ענפים מעל אזור משחק',
    'הסרת ענף שבור', 'הסרת ענפים תלויים', 'כריתה', 'כריתה ועקירת גדם', 'הסרת מכבדים', 'הדברה כנגד תהלוכן האורן',
    'קשירת ענפים', 'תקין, ללא טיפול'];

  // ---------- עזרים ----------
  const $ = (s, el) => (el || document).querySelector(s);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fmtDate = iso => iso ? iso.split('-').reverse().join('/') : '';
  function toast(msg, ms) {
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), ms || 2600);
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  const safeName = s => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

  // ---------- מצב ----------
  let cur = null; // הסקר הפתוח
  let curTreeId = null;
  let tab = 'trees';
  const thumbUrls = new Map();
  const saveSoon = debounce(() => { if (cur) { DB.putSurvey(cur); Sync.kick(); } }, 400);
  const saveNow = () => cur && DB.putSurvey(cur);

  async function thumbUrl(photoId) {
    if (thumbUrls.has(photoId)) return thumbUrls.get(photoId);
    const p = await DB.getPhoto(photoId);
    if (!p) return '';
    const u = URL.createObjectURL(p.thumb || p.blob);
    thumbUrls.set(photoId, u);
    return u;
  }

  // ---------- ניווט ----------
  window.addEventListener('hashchange', route);
  async function route() {
    const hash = location.hash || '#/';
    const m = /^#\/s\/([^/]+)(?:\/(\w+))?(?:\/t\/(.+))?/.exec(hash);
    if (m) {
      if (!cur || cur.id !== m[1]) {
        await saveNow();
        cur = await DB.getSurvey(m[1]);
        if (!cur) { location.hash = '#/'; return; }
        for (const t of cur.trees) { delete t._gpsBusy; Core.normalizePhotos(t); }
        refreshSuggestions();
      }
      tab = m[2] || 'trees';
      if (m[3]) curTreeId = decodeURIComponent(m[3]);
      if (!cur.trees.find(t => t.id === curTreeId)) curTreeId = (Core.sortTrees(cur.trees)[0] || {}).id || null;
      return renderSurvey();
    }
    await saveNow();
    // יציאה מסקר: הדוח ב-OneDrive מתעדכן מיד ולא מחכה 5 דקות
    if (cur) Sync.now({ report: true });
    cur = null;
    if (hash.startsWith('#/settings')) return renderSettings();
    return renderHome();
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  function bar(title, back, ...right) {
    return h('header', { class: 'bar' },
      back ? h('button', { class: 'icon-btn', 'aria-label': 'חזרה', onclick: () => go(back) }, '→') : null,
      h('h1', {}, title), h('button', { class: 'sync-pill icon-btn', id: 'syncPill', onclick: () => go('#/settings') }, syncText()), ...right);
  }

  // מצב הגיבוי בפינה: כמה ממתינות לטלגרם / OneDrive
  function syncText() {
    const st = Sync.state;
    if (st.odNeedsLogin) return '☁ OneDrive: להתחבר מחדש';
    if (st.offline) return (st.tgPending + st.odPending) ? `⏸ אין קליטה · ${st.tgPending + st.odPending} ממתינים` : '⏸ אין קליטה';
    if (st.busy) return '⟳ מגבה…';
    if (st.error) return '⚠ ' + st.error.slice(0, 40);
    const n = st.tgPending + st.odPending;
    return n ? `☁ ${n} ממתינים` : '☁ מגובה';
  }
  Sync.onChange(() => { const el = $('#syncPill'); if (el) el.textContent = syncText(); });

  window.App = {
    live: id => (cur && cur.id === id ? cur : null),
    onSynced: () => { if (cur && tab === 'trees') renderPhotos(); },
    buildReport,
  };

  // ---------- מסך הבית ----------
  let projectFilter = null;
  async function renderHome() {
    const app = $('#app');
    const surveys = (await DB.allSurveys()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const projects = [...new Set(surveys.map(s => s.project || ''))].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, 'he'));
    if (projectFilter != null && !projects.includes(projectFilter)) projectFilter = null;
    const card = s => {
      const n = s.trees.filter(Core.hasContent).length;
      const ph = s.trees.reduce((a, t) => a + (t.photos || []).length, 0);
      return h('div', { class: 'card survey-item', role: 'button', tabindex: 0, onclick: () => go('#/s/' + s.id) },
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { class: 't' }, s.site || 'סקר ללא שם'),
          h('div', { class: 'muted small' }, [s.code ? 'סמל ' + s.code : null, fmtDate(s.date)].filter(Boolean).join(' · ')),
          h('div', { class: 'small' }, `${n} עצים · ${ph} תמונות`)),
        h('span', { class: 'muted', 'aria-hidden': 'true' }, '←'));
    };
    const shown = projectFilter == null ? projects : [projectFilter];
    const list = surveys.length ? shown.map(pr => h('section', {},
      h('h2', { class: 'proj-head' }, (pr || 'ללא פרויקט') + ` (${surveys.filter(s => (s.project || '') === pr).length})`),
      h('div', { class: 'grid-list' }, surveys.filter(s => (s.project || '') === pr).map(card))))
      : h('div', { class: 'empty' }, 'עוד אין סקרים. לחץ על "סקר חדש" כדי להתחיל.');
    const chips = projects.length > 1 ? h('div', { class: 'project-chips', role: 'group', 'aria-label': 'סינון לפי פרויקט' },
      h('button', { class: 'chip' + (projectFilter == null ? ' on' : ''), onclick: () => { projectFilter = null; renderHome(); } }, 'כל הפרויקטים'),
      projects.map(pr => h('button', { class: 'chip' + (projectFilter === pr ? ' on' : ''), onclick: () => { projectFilter = pr; renderHome(); } }, pr || 'ללא פרויקט'))) : null;

    app.replaceChildren(
      bar('סקרי עצים', null, h('button', { class: 'icon-btn', onclick: () => go('#/settings') }, '⚙ הגדרות')),
      h('main', { class: 'stack' },
        h('button', { class: 'btn primary big block', onclick: newSurvey }, '+ סקר חדש'),
        chips, list,
        h('p', { class: 'muted small', style: 'text-align:center' }, 'הנתונים נשמרים בטאבלט, ומגובים לטלגרם ול-OneDrive כשיש קליטה. גרסה ' + APP_VERSION)));
  }

  async function newSurvey() {
    const project = projectFilter != null ? projectFilter : await DB.getKV('lastProject', '');
    const s = { id: uid(), project, site: '', code: '', manager: '', date: today(), trees: [], created: Date.now() };
    await DB.putSurvey(s);
    go('#/s/' + s.id + '/details');
  }

  // ---------- מסך הסקר ----------
  function renderSurvey() {
    const app = $('#app');
    const tabs = [['trees', 'עצים'], ['details', 'פרטי הסקר'], ['export', 'הפקת דוח']];
    const body = h('main', {});
    app.replaceChildren(
      bar(cur.site || 'סקר חדש', '#/'),
      h('nav', { class: 'tabs' }, tabs.map(([k, label]) =>
        h('button', { class: 'tab' + (tab === k ? ' on' : ''), onclick: () => go(`#/s/${cur.id}/${k}`) }, label))),
      body);
    if (tab === 'details') renderDetails(body);
    else if (tab === 'export') renderExport(body);
    else renderTrees(body);
  }

  function field(label, input) { return h('div', {}, h('label', { class: 'f' }, label), input); }

  function renderDetails(body) {
    const inp = (key, attrs) => h('input', Object.assign({
      class: 'in', value: cur[key] || '',
      oninput: e => {
        cur[key] = e.target.value; saveSoon();
        if (key === 'site') $('.bar h1').textContent = cur.site || 'סקר חדש';
        if (key === 'project') DB.setKV('lastProject', cur.project.trim());
      },
    }, attrs));
    const projList = h('datalist', { id: 'projectList' });
    DB.allSurveys().then(all => projList.replaceChildren(...[...new Set(all.map(x => x.project).filter(Boolean))].map(p => h('option', { value: p }))));
    body.append(h('div', { class: 'card stack', style: 'max-width:720px;margin:0 auto' },
      projList,
      field('פרויקט (למשל: ירושלים)', inp('project', { list: 'projectList', placeholder: 'לניהול וסינון הסקרים, לא מופיע בדוח' })),
      field('שם האתר / כתובת (מופיע בכותרת הדוח)', inp('site', { placeholder: 'למשל: גן חצב, רחוב הנרקיס 5' })),
      h('div', { class: 'row', style: 'align-items:stretch' },
        h('div', { style: 'flex:1;min-width:200px' }, field('סמל מוסד (אם יש)', inp('code', { inputmode: 'numeric' }))),
        h('div', { style: 'flex:1;min-width:200px' }, field('תאריך הסקר', inp('date', { type: 'date' })))),
      field('מנהל/ת', inp('manager')),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary big', onclick: () => go(`#/s/${cur.id}/trees`) }, 'המשך לעצים'),
        h('span', { style: 'flex:1' }),
        h('button', { class: 'btn danger', onclick: deleteSurvey }, 'מחק סקר'))));
  }

  async function deleteSurvey() {
    if (!confirm('למחוק את כל הסקר, כולל התמונות? אי אפשר לבטל.')) return;
    for (const t of cur.trees) for (const p of t.photos || []) await DB.deletePhoto(p.id);
    await DB.deleteSurvey(cur.id);
    cur = null;
    go('#/');
  }

  // ---------- עצים ----------
  function treeById(id) { return cur.trees.find(t => t.id === id); }

  function renderTrees(body) {
    const listPane = h('section', { class: 'list-pane', 'aria-label': 'רשימת העצים' });
    const edPane = h('section', { class: 'editor', 'aria-label': 'עריכת עץ' });
    body.append(h('div', { class: 'split' }, listPane, edPane));
    renderTreeList(listPane);
    renderEditor(edPane);
  }

  function treeRow(t) {
    const pineMissing = Core.isPine(t.species) && (t.pines == null || t.pines === '');
    return h('button', { class: 'tree-row' + (t.id === curTreeId ? ' on' : ''), 'data-id': t.id, onclick: () => selectTree(t.id) },
      h('span', { class: 'n' }, t.num || '—'),
      h('span', { style: 'min-width:0' },
        h('div', { class: 'sp' }, t.species || 'ללא מין'),
        h('div', { class: 'meta' }, t.notes || '')),
      h('span', { class: 'badges' },
        t.urgency ? h('span', { class: 'badge u-' + t.urgency }, t.urgency) : null,
        pineMissing ? h('span', { class: 'badge alert', title: 'חסרה כמות אורנים' }, 'אורנים?') : null,
        h('span', { class: 'badge', title: 'תמונות' }, '📷' + (t.photos || []).length),
        t.lat != null ? h('span', { class: 'badge', title: 'יש נ"צ' }, '📍') : null));
  }

  function renderTreeList(pane) {
    pane = pane || $('.list-pane');
    if (!pane) return;
    const trees = Core.sortTrees(cur.trees);
    const n = trees.filter(Core.hasContent).length;
    pane.replaceChildren(
      h('button', { class: 'btn primary big block', onclick: addTree }, '+ עץ חדש'),
      h('div', { class: 'muted small' }, `${n} עצים בסקר` + (n > Core.MAX_TREES ? ` (בתבנית יש מקום ל-${Core.MAX_TREES})` : '')),
      trees.length ? h('div', { class: 'tree-list' }, trees.map(treeRow)) : h('div', { class: 'empty' }, 'עוד אין עצים'));
    const on = $('.tree-row.on', pane);
    if (on) on.scrollIntoView({ block: 'nearest' });
  }

  function refreshRow(t) {
    const old = $(`.tree-row[data-id="${t.id}"]`);
    if (old) old.replaceWith(treeRow(t));
  }

  function selectTree(id) {
    saveNow();
    curTreeId = id;
    history.replaceState(null, '', `#/s/${cur.id}/trees/t/${encodeURIComponent(id)}`);
    renderTreeList();
    renderEditor();
    if (window.innerWidth < 900) $('.editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function addTree() {
    refreshSuggestions();
    const t = { id: uid(), num: Core.nextNum(cur.trees), species: '', notes: '', urgency: '', pines: null, split: false, photos: [], created: Date.now() };
    cur.trees.push(t);
    selectTree(t.id);
    await saveNow();
    if (await DB.getKV('autoGps', true)) captureGps(t, true);
  }

  let sugCache = { speciesAll: SPECIES_SEED, speciesTop: SPECIES_SEED.slice(0, 10), phrasesTop: PHRASE_SEED };
  function refreshSuggestions() { suggestions().then(s => { sugCache = s; }).catch(() => {}); }

  async function suggestions() {
    const all = await DB.allSurveys();
    const sp = new Map(), ph = new Map();
    for (const s of all) for (const t of s.trees) {
      const k = (t.species || '').trim();
      if (k) sp.set(k, (sp.get(k) || 0) + 1);
      for (const part of (t.notes || '').split(/[,.;\n]+/)) {
        const p = part.trim();
        if (p.length > 2) ph.set(p, (ph.get(p) || 0) + 1);
      }
    }
    const custom = await DB.getKV('species', null);
    const phrases = await DB.getKV('phrases', null);
    const top = m => [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    const uniq = a => [...new Set(a)];
    return {
      speciesAll: uniq(top(sp).concat(custom || SPECIES_SEED)),
      speciesTop: uniq(top(sp).concat(custom || SPECIES_SEED)).slice(0, 10),
      phrasesTop: uniq(top(ph).filter(p => ph.get(p) > 1).concat(phrases || PHRASE_SEED)).slice(0, 16),
    };
  }

  function renderEditor(pane) {
    pane = pane || $('.editor');
    if (!pane) return;
    const t = treeById(curTreeId);
    if (!t) {
      pane.replaceChildren(h('div', { class: 'card empty' }, 'לחץ על "עץ חדש" כדי להוסיף עץ, או בחר עץ מהרשימה.'));
      return;
    }
    const sug = sugCache;
    const changed = () => { saveSoon(); refreshRow(t); };

    // מספר העץ + פיצול
    const splitWrap = h('label', { class: 'row', style: 'margin-top:8px;cursor:pointer' },
      h('input', { type: 'checkbox', checked: t.split, style: 'width:24px;height:24px', onchange: e => { t.split = e.target.checked; changed(); renderPhotos(); } }),
      h('span', {}, 'פצל: תמונה נפרדת לכל עץ בטווח'));
    const showSplit = () => splitWrap.classList.toggle('hidden', !/[-,–]/.test(t.num || '') && !t.split);
    const numIn = h('input', { class: 'in', value: t.num || '', inputmode: 'text', 'aria-label': 'מספר העץ',
      oninput: e => { t.num = e.target.value; showSplit(); changed(); }, onchange: () => { renderTreeList(); renderPhotos(); } });
    showSplit();

    // מין העץ + אורנים
    const pineIn = h('input', { class: 'in', type: 'number', inputmode: 'numeric', min: 0, value: t.pines == null ? '' : t.pines,
      oninput: e => { t.pines = e.target.value === '' ? null : Number(e.target.value); markPine(); changed(); } });
    const pineWrap = field('כמה אורנים?', pineIn);
    const markPine = () => {
      const pine = Core.isPine(t.species);
      pineWrap.classList.toggle('hidden', !pine && (t.pines == null || t.pines === ''));
      pineIn.classList.toggle('alert', pine && (t.pines == null || t.pines === ''));
    };
    const spIn = h('input', { class: 'in', value: t.species || '', list: 'speciesList', 'aria-label': 'מין עץ',
      oninput: e => { t.species = e.target.value; markPine(); changed(); } });
    markPine();
    const spChips = h('div', { class: 'chips' }, sug.speciesTop.map(s => h('button', { class: 'chip', type: 'button',
      onclick: () => { t.species = s; spIn.value = s; markPine(); changed(); } }, s)));

    // הערות
    const notesIn = h('textarea', { class: 'in', 'aria-label': 'הערות וטיפול מומלץ', oninput: e => { t.notes = e.target.value; changed(); } });
    notesIn.value = t.notes || '';
    const notesChips = h('div', { class: 'chips' }, sug.phrasesTop.map(p => h('button', { class: 'chip', type: 'button',
      onclick: () => {
        const cur0 = notesIn.value.trim();
        notesIn.value = cur0 ? cur0.replace(/[,.]$/, '') + ', ' + p : p;
        t.notes = notesIn.value; changed();
      } }, p)));

    // דחיפות
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'דחיפות' }, [['', 'ללא'], ['כ', 'כ - כריתה'], ['1', '1 - מיידי'], ['2', '2 - חצי שנה']].map(([v, label]) =>
      h('button', { type: 'button', class: (t.urgency || '') === v ? 'on' : '', onclick: e => {
        t.urgency = v; changed();
        [...seg.children].forEach(b => b.classList.toggle('on', b === e.currentTarget));
      } }, label)));

    // נ"צ
    const gpsBox = h('div', { class: 'gps', id: 'gpsBox' });
    renderGps(t, gpsBox);

    const photosBox = h('div', { id: 'photosBox' });

    pane.replaceChildren(
      h('datalist', { id: 'speciesList' }, sug.speciesAll.map(s => h('option', { value: s }))),
      h('div', { class: 'card stack' },
        h('div', { class: 'grid2' },
          h('div', {}, field('מספר העץ', numIn), splitWrap),
          h('div', {}, field('מין עץ', spIn))),
        spChips,
        pineWrap,
        field('הערות וטיפול מומלץ', notesIn),
        notesChips,
        field('דחיפות', seg),
        field('נ"צ', gpsBox),
        h('div', {},
          h('label', { class: 'f' }, 'תמונות'),
          h('div', { class: 'row', style: 'margin-bottom:10px' },
            h('button', { class: 'btn primary big', onclick: () => pickPhoto('camInput') }, '📷 צלם'),
            h('button', { class: 'btn big', onclick: () => pickPhoto('galInput') }, '🖼 מהגלריה')),
          photosBox),
        h('div', { class: 'row', style: 'justify-content:space-between;margin-top:20px' },
          h('button', { class: 'btn danger', onclick: deleteTree }, 'מחק עץ'),
          h('button', { class: 'btn primary', onclick: addTree }, '+ עץ הבא'))));
    renderPhotos();
  }

  async function deleteTree() {
    const t = treeById(curTreeId);
    if (!confirm(`למחוק את עץ ${t.num || ''}${t.photos.length ? ' ואת ' + t.photos.length + ' התמונות שלו' : ''}?`)) return;
    for (const p of t.photos) await DB.deletePhoto(p.id);
    cur.trees = cur.trees.filter(x => x !== t);
    curTreeId = (Core.sortTrees(cur.trees)[0] || {}).id || null;
    await saveNow();
    renderTreeList();
    renderEditor();
  }

  // ---------- GPS ----------
  function renderGps(t, box) {
    box = box || $('#gpsBox');
    if (!box || t.id !== curTreeId) return;
    const has = t.lat != null;
    box.replaceChildren(
      h('span', { class: 'coords' }, t._gpsBusy ? 'מאתר מיקום…' : has ? h('bdi', {}, `${t.lat.toFixed(6)}, ${t.lon.toFixed(6)}`) : 'אין מיקום',
        has && t.acc != null ? h('span', { class: 'muted small' }, ` (דיוק ${Math.round(t.acc)} מ')`) : null),
      h('button', { class: 'btn', onclick: () => captureGps(t) }, has ? 'עדכן למיקום הנוכחי' : 'מיקום נוכחי'),
      has ? h('a', { class: 'btn', href: `https://www.google.com/maps?q=${t.lat},${t.lon}`, target: '_blank', rel: 'noopener' }, 'מפה') : null,
      has ? h('button', { class: 'btn', onclick: () => { if (confirm('למחוק את הנ"צ של העץ?')) { t.lat = t.lon = t.acc = null; saveSoon(); refreshRow(t); renderGps(t); } } }, 'נקה') : null);
  }

  // מאזין עד 8 שניות ולוקח את הקריאה המדויקת ביותר
  function captureGps(t, quiet) {
    if (!navigator.geolocation) { toast('אין GPS בדפדפן הזה'); return; }
    t._gpsBusy = true; renderGps(t);
    let best = null, done = false;
    const finish = () => {
      if (done) return; done = true;
      navigator.geolocation.clearWatch(wid);
      t._gpsBusy = false;
      if (best) {
        t.lat = best.coords.latitude; t.lon = best.coords.longitude; t.acc = best.coords.accuracy; t.gpsTime = best.timestamp;
        saveSoon(); refreshRow(t);
      }
      renderGps(t);
    };
    const wid = navigator.geolocation.watchPosition(pos => {
      if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
      if (best.coords.accuracy <= 5) finish();
    }, err => {
      if (!best) {
        t._gpsBusy = false; renderGps(t); done = true; navigator.geolocation.clearWatch(wid);
        if (!quiet || err.code === 1) toast(err.code === 1 ? 'צריך לאשר גישה למיקום בדפדפן' : 'לא הצלחתי לקבל מיקום. נסה שוב בשטח פתוח.');
      }
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    setTimeout(finish, 8000);
  }

  // ---------- תמונות ----------
  let pickTarget = null;
  function pickPhoto(inputId) {
    pickTarget = curTreeId;
    const inp = $('#' + inputId);
    inp.value = '';
    inp.click();
  }
  for (const id of ['camInput', 'galInput']) {
    document.getElementById(id).addEventListener('change', async e => {
      const files = [...e.target.files];
      const t = cur && treeById(pickTarget);
      if (!t || !files.length) return;
      toast(files.length > 1 ? `שומר ${files.length} תמונות…` : 'שומר תמונה…', 1500);
      for (const f of files) {
        try {
          const p = await processImage(f);
          await DB.putPhoto({ id: p.id, blob: p.blob, thumb: p.thumb, w: p.w, h: p.h });
          // בעץ מפוצל: התמונה עוברת למספר הראשון שעוד אין לו תמונה
          let sub = null;
          if (Core.splitActive(t)) {
            const nums = Core.expandNum(t.num);
            sub = nums.find(n => !t.photos.some(x => x.sub === n)) || nums[0];
          }
          const np = { id: p.id, w: p.w, h: p.h, sub, inReport: false, note: '', taken: Date.now() };
          // הראשונה בקבוצה נכנסת לדוח, השאר לא (אפשר לשנות)
          np.inReport = !t.photos.some(x => Core.groupKey(t, x) === Core.groupKey(t, np));
          t.photos.push(np);
        } catch (err) {
          console.error(err);
          toast('לא הצלחתי לשמור את התמונה: ' + err.message);
        }
      }
      await saveNow();
      refreshRow(t);
      if (t.id === curTreeId) renderPhotos();
      Sync.kick(true);
      // צילום ראשון בלי נ"צ: לוקח מיקום
      if (t.lat == null && !t._gpsBusy && await DB.getKV('autoGps', true)) captureGps(t, true);
    });
  }

  async function processImage(file) {
    const maxSide = await DB.getKV('photoMax', 2000);
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (_) {
      src = await new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('קובץ תמונה לא נתמך')); img.src = URL.createObjectURL(file); });
    }
    const sw = src.width, sh = src.height;
    const draw = (max, q) => {
      const s = Math.min(1, max / Math.max(sw, sh));
      const c = document.createElement('canvas');
      c.width = Math.round(sw * s); c.height = Math.round(sh * s);
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      return new Promise(r => c.toBlob(b => r({ blob: b, w: c.width, h: c.height }), 'image/jpeg', q));
    };
    const big = await draw(maxSide, 0.85);
    const th = await draw(320, 0.7);
    return { id: uid(), blob: big.blob, thumb: th.blob, w: big.w, h: big.h };
  }

  async function renderPhotos() {
    const box = $('#photosBox');
    const t = treeById(curTreeId);
    if (!box || !t) return;
    const split = Core.splitActive(t);
    const nums = split ? Core.expandNum(t.num) : [];
    if (!t.photos.length) { box.replaceChildren(h('div', { class: 'muted' }, 'אין תמונות לעץ הזה')); return; }
    const items = await Promise.all(t.photos.map(async p => {
      const url = await thumbUrl(p.id);
      const noteIn = h('input', { class: 'in note-in', value: p.note || '', placeholder: 'שם / פרטים (לטלגרם בלבד)',
        oninput: e => { p.note = e.target.value; saveSoon(); Sync.kick(); } });
      return h('div', { class: 'ph-card' + (p.inReport ? ' in-report' : '') },
        h('div', { class: 'ph' },
          h('img', { src: url, alt: 'תמונה של עץ ' + Core.photoLabel(t, p), onclick: () => openPhoto(p.id) }),
          h('span', { class: 'sync' },
            p.tgMsgId ? h('span', { class: 'tg', title: 'גובתה בטלגרם' }, 'TG ✓') : h('span', { class: 'tg pending', title: 'ממתינה לשליחה לטלגרם' }, 'TG …'),
            p.odId ? h('span', { class: 'od', title: 'נשמרה ב-OneDrive' }, 'OD ✓') : null),
          h('button', { class: 'del', title: 'מחק', 'aria-label': 'מחק תמונה', onclick: async () => {
            if (!confirm('למחוק את התמונה מהסקר? אם כבר נשלחה, היא נשארת בטלגרם.')) return;
            const key = Core.groupKey(t, p);
            t.photos = t.photos.filter(x => x !== p);
            Core.ensureReportPhoto(t, key);
            await DB.deletePhoto(p.id);
            await saveNow(); refreshRow(t); renderPhotos();
          } }, '🗑')),
        h('label', { class: 'row in-report-toggle' },
          h('input', { type: 'checkbox', checked: !!p.inReport, onchange: e => { p.inReport = e.target.checked; saveSoon(); renderPhotos(); } }),
          'בדוח'),
        split ? h('select', { class: 'in', 'aria-label': 'לאיזה עץ', onchange: e => {
          const old = Core.groupKey(t, p);
          p.sub = Number(e.target.value);
          p.inReport = !t.photos.some(x => x !== p && x.inReport && Core.groupKey(t, x) === p.sub);
          Core.ensureReportPhoto(t, old);
          saveSoon(); renderPhotos(); Sync.kick();
        } }, nums.map(n => h('option', { value: n, selected: p.sub === n ? 'selected' : null }, 'עץ ' + n))) : null,
        noteIn);
    }));
    const hint = h('div', { class: 'muted small', style: 'margin-top:6px' },
      'כל התמונות מגובות בטלגרם. רק המסומנות "בדוח" נכנסות לנספח התמונות.');
    box.replaceChildren(h('div', { class: 'photos' }, items), hint);
  }

  async function openPhoto(id) {
    const p = await DB.getPhoto(id);
    if (!p) return;
    const url = URL.createObjectURL(p.blob);
    const ov = h('div', { style: 'position:fixed;inset:0;background:#000;z-index:60;display:flex;align-items:center;justify-content:center', onclick: () => { ov.remove(); URL.revokeObjectURL(url); } },
      h('img', { src: url, style: 'max-width:100%;max-height:100%;object-fit:contain' }));
    document.body.append(ov);
  }

  // ---------- הפקה ----------
  async function renderExport(body) {
    const warns = Core.warnings(cur);
    const embed = await DB.getKV('embedPhotos', true);
    const rs = Core.reportSlots(cur.trees);
    const status = h('div', { class: 'small muted', role: 'status' });
    const syncBox = h('div', { class: 'small', role: 'status' });
    const tgOn = !!(await DB.getKV('tgChat', ''));
    const odOn = await OD.connected();
    const drawSync = () => {
      const all = cur.trees.flatMap(t => t.photos || []);
      const tgLeft = all.filter(p => !p.tgMsgId).length, odLeft = all.filter(p => !p.odId).length;
      syncBox.replaceChildren(
        h('div', {}, tgOn ? (tgLeft ? `טלגרם: ${tgLeft} מתוך ${all.length} תמונות ממתינות לגיבוי.` : `טלגרם: כל ${all.length} התמונות מגובות.`) : 'טלגרם לא מחובר.'),
        h('div', {}, odOn ? (odLeft ? `OneDrive: ${odLeft} תמונות ממתינות.` : 'OneDrive: התמונות שמורות.') + (cur.odReportAt ? ` הדוח עודכן לאחרונה ב-${new Date(cur.odReportAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}.` : '') : 'OneDrive לא מחובר.'),
        Sync.state.error ? h('div', { style: 'color:var(--danger)' }, Sync.state.error) : null);
    };
    drawSync();

    body.append(h('div', { class: 'stack', style: 'max-width:820px;margin:0 auto' },
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'דוח אקסל'),
        h('div', { class: 'muted small' }, 'קובץ בתבנית "סקר יציבות ירושלים - טאבלט אורנים", כמו היום, עם גיליון נוסף של נ"צ. אפשר לפתוח אותו באקסל בטאבלט ולהדפיס ל-PDF, או במחשב.'),
        h('label', { class: 'row', style: 'cursor:pointer' },
          h('input', { type: 'checkbox', checked: embed, style: 'width:24px;height:24px', onchange: e => { DB.setKV('embedPhotos', e.target.checked); } }),
          'להכניס את התמונות שסומנו "בדוח" לנספח בתוך הקובץ'),
        embed ? h('div', { class: 'small muted' }, `${rs.length} תמונות מסומנות לדוח` + (rs.length > Core.MAX_PRINTED ? `, ובנספח יש מקום ל-${Core.MAX_PRINTED}.` : '.'))
          : h('div', { class: 'note small' }, 'בלי התמונות, הנספח עובד כמו בתבנית: תמונה אחת לכל עץ מתיקיית Pictures, דרך המאקרו במחשב. את התמונות לתיקייה מורידים מ"תמונות בקובץ ZIP".'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary big', onclick: () => exportExcel(status) }, 'הפק אקסל'),
          h('button', { class: 'btn big', onclick: () => exportZip(status) }, 'תמונות בקובץ ZIP')),
        status),
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'גיבוי וסנכרון'),
        syncBox,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => { Sync.now({ report: true }); toast('מגבה עכשיו…'); } }, 'גבה עכשיו'),
          (!tgOn || !odOn) ? h('button', { class: 'btn', onclick: () => go('#/settings') }, 'להגדרות') : null)),
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'שכבת GIS'),
        h('div', { class: 'muted small' }, `${cur.trees.filter(t => t.lat != null).length} עצים עם נ"צ. GeoJSON נפתח ב-QGIS וב-ArcGIS, ו-KML בגוגל ארת'.`),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => deliver(new Blob([Gis.geojson([cur])], { type: 'application/geo+json' }), fileBase() + '.geojson') }, 'GeoJSON'),
          h('button', { class: 'btn', onclick: () => deliver(new Blob([Gis.kml([cur], cur.site)], { type: 'application/vnd.google-earth.kml+xml' }), fileBase() + '.kml') }, 'KML'))),
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'בדיקה לפני הפקה'),
        warns.length ? h('ul', { class: 'warn-list' }, warns.map(w => h('li', {}, w))) : h('div', { class: 'okbox' }, 'הכול מלא.'))));
    const off = Sync.onChange(() => { if (!document.body.contains(syncBox)) { if (off) off(); return; } drawSync(); });
  }

  async function templateBytes() {
    const res = await fetch('template/survey.xltm');
    if (!res.ok) throw new Error('לא נמצאה התבנית');
    return new Uint8Array(await res.arrayBuffer());
  }

  function fileBase(s) {
    s = s || cur;
    return safeName(`סקר בטיחות עצים - ${s.site || 'ללא שם'} - ${fmtDate(s.date).replace(/\//g, '.')}`);
  }

  async function deliver(blob, name) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && await DB.getKV('shareFiles', false)) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  // בונה את קובץ האקסל של סקר (משמש גם להורדה וגם ל-OneDrive)
  async function buildReport(s) {
    const embed = await DB.getKV('embedPhotos', true);
    const r = await SurveyExcel.buildWorkbook(await templateBytes(), s, async id => {
      const p = await DB.getPhoto(id);
      return p ? { blob: p.blob, w: p.w, h: p.h } : null;
    }, { embedPhotos: embed });
    return { blob: new Blob([r.bytes], { type: 'application/vnd.ms-excel.sheet.macroEnabled.12' }), name: fileBase(s) + '.xlsm', placed: r.placed };
  }

  async function exportExcel(status) {
    await saveNow();
    status.textContent = 'מפיק את הקובץ…';
    try {
      const r = await buildReport(cur);
      await deliver(r.blob, r.name);
      status.textContent = `הקובץ הורד. ${cur.trees.filter(Core.hasContent).length} עצים, ${r.placed.length} תמונות בנספח.`;
    } catch (e) {
      console.error(e);
      status.textContent = 'ההפקה נכשלה: ' + e.message;
    }
  }

  async function exportZip(status) {
    await saveNow();
    status.textContent = 'אורז את התמונות…';
    try {
      const zip = new JSZip();
      const used = new Set();
      // מספור כמו בנספח: עם תמונות בקובץ, לפי התמונות שסומנו; בלי, לפי משבצות התבנית
      const embed = await DB.getKV('embedPhotos', true);
      const pairs = embed ? Core.reportSlots(cur.trees).map(sl => [sl.index, sl.photo])
        : Core.slotsOf(cur.trees).map(sl => [sl.index, Core.photoForSlot(sl)]);
      for (const [n, p] of pairs) {
        if (!p) continue;
        const d = await DB.getPhoto(p.id);
        if (d) { zip.file(n + '.jpg', d.blob); used.add(p.id); }
      }
      // שאר התמונות בתיקייה extra, לפי מספר העץ (שמות באנגלית כדי שווינדוס יפתח את ה-ZIP בלי ג'יבריש)
      for (const t of Core.sortTrees(cur.trees)) {
        let k = 1;
        for (const p of t.photos || []) {
          if (used.has(p.id)) continue;
          const d = await DB.getPhoto(p.id);
          if (d) zip.file(`extra/tree_${String(t.num || 'x').replace(/[^0-9,-]+/g, '') || 'x'}${p.sub ? '_' + p.sub : ''}_${k++}.jpg`, d.blob);
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      await deliver(blob, fileBase() + ' - תמונות.zip');
      status.textContent = 'קובץ התמונות הורד. התמונות ממוספרות לפי סדר הנספח, כמו בתיקיית Pictures במחשב.';
    } catch (e) {
      status.textContent = 'נכשל: ' + e.message;
    }
  }

  // ---------- הגדרות וגיבוי ----------
  async function renderSettings() {
    const app = $('#app');
    const token = await DB.getKV('tgToken', '');
    const chatName = await DB.getKV('tgChatName', '');
    const chat = await DB.getKV('tgChat', '');
    const tgStatus = h('div', { class: 'small', role: 'status' }, chat ? `✓ מחובר לצ'אט: ${chatName || chat}` : '');
    const tokenIn = h('input', { class: 'in', value: token, placeholder: '123456:ABC…', dir: 'ltr', autocomplete: 'off' });
    const chk = (key, def, label) => h('label', { class: 'row', style: 'cursor:pointer' },
      h('input', { type: 'checkbox', style: 'width:24px;height:24px', checked: undefined, onchange: e => DB.setKV(key, e.target.checked), oncreate: null }), label);
    const autoGps = chk('autoGps', true, 'לקחת נ"צ אוטומטית בעץ חדש ובתמונה הראשונה');
    autoGps.firstChild.checked = await DB.getKV('autoGps', true);
    const shareFiles = chk('shareFiles', false, 'במקום הורדה, לפתוח את תפריט השיתוף (לשליחה לדרייב, וואטסאפ וכו\')');
    shareFiles.firstChild.checked = await DB.getKV('shareFiles', false);
    const speciesTa = h('textarea', { class: 'in', style: 'min-height:140px' });
    speciesTa.value = (await DB.getKV('species', null) || SPECIES_SEED).join('\n');
    const phrasesTa = h('textarea', { class: 'in', style: 'min-height:140px' });
    phrasesTa.value = (await DB.getKV('phrases', null) || PHRASE_SEED).join('\n');
    const backupStatus = h('div', { class: 'small', role: 'status' });
    const odClientIn = h('input', { class: 'in', value: await DB.getKV('odClientId', ''), dir: 'ltr', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', autocomplete: 'off' });
    const odRootIn = h('input', { class: 'in', value: await DB.getKV('odRoot', 'סקרי עצים') });
    const odConnected = await OD.connected();
    const odUser = await DB.getKV('odUser', '');
    const odStatus = h('div', { class: 'small', role: 'status' },
      Sync.state.odNeedsLogin ? 'צריך להתחבר מחדש (החיבור של אפליקציית דפדפן תקף ליממה).' : odConnected ? `✓ מחובר${odUser ? ' כ-' + odUser : ''}` : '');

    app.replaceChildren(
      bar('הגדרות', '#/'),
      h('main', { class: 'stack', style: 'max-width:820px;margin:0 auto' },
        h('div', { class: 'card stack' },
          h('h2', { style: 'margin:0;font-size:20px' }, 'בוט טלגרם'),
          h('ol', { class: 'small', style: 'margin:0;padding-inline-start:20px' },
            h('li', {}, 'מדביקים כאן את הטוקן של tree_survey_bot (אותו טוקן כמו בתוכנה במחשב).'),
            h('li', {}, 'שולחים לבוט בטלגרם הודעה כלשהי, למשל /start, מהחשבון או מהקבוצה שאליה התמונות צריכות להגיע.'),
            h('li', {}, 'לוחצים "חבר".')),
          field('טוקן הבוט', tokenIn),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', onclick: async () => {
              const tk = tokenIn.value.trim();
              if (!tk) return;
              tgStatus.textContent = 'בודק…';
              try {
                const me = await TG.getMe(tk);
                const c = await TG.findChat(tk);
                if (!c) { tgStatus.textContent = `הבוט @${me.username} תקין, אבל לא מצאתי הודעה אליו. שלח לו /start ולחץ שוב.`; return; }
                await DB.setKV('tgToken', tk); await DB.setKV('tgChat', c.id); await DB.setKV('tgChatName', c.name || '');
                await TG.sendText(tk, c.id, '✓ אפליקציית סקר העצים מחוברת. כל תמונה שמצלמים באפליקציה תגובה לכאן.');
                Sync.kick(true);
                tgStatus.textContent = `✓ מחובר לצ'אט: ${c.name || c.id} דרך @${me.username}`;
              } catch (e) { tgStatus.textContent = 'החיבור נכשל: ' + e.message; }
            } }, 'חבר'),
            token ? h('button', { class: 'btn', onclick: async () => { await DB.setKV('tgToken', ''); await DB.setKV('tgChat', ''); renderSettings(); } }, 'נתק') : null),
          tgStatus),
        h('div', { class: 'card stack' },
          h('h2', { style: 'margin:0;font-size:20px' }, 'OneDrive'),
          h('div', { class: 'muted small' }, 'כשיש קליטה, כל סקר נשמר בתיקייה משלו: התיקייה הראשית / הפרויקט / תאריך ושם האתר. בתוכה דוח האקסל (מתעדכן כל 5 דקות בזמן עבודה), תמונות, שכבת GIS ונתוני הסקר.'),
          field('מזהה האפליקציה ב-Microsoft (Client ID)', odClientIn),
          field('תיקייה ראשית ב-OneDrive', odRootIn),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', onclick: async () => {
              await DB.setKV('odClientId', odClientIn.value.trim()); await DB.setKV('odRoot', odRootIn.value.trim() || 'סקרי עצים');
              if (!odClientIn.value.trim()) { odStatus.textContent = 'חסר מזהה אפליקציה.'; return; }
              if (!navigator.onLine) { odStatus.textContent = 'צריך קליטה כדי להתחבר.'; return; }
              await saveNow();
              try { await OD.beginLogin(); } catch (e) { odStatus.textContent = e.message; }
            } }, odConnected && !Sync.state.odNeedsLogin ? 'התחבר מחדש' : 'התחבר ל-OneDrive'),
            odConnected ? h('button', { class: 'btn', onclick: async () => { await OD.logout(); renderSettings(); } }, 'נתק') : null,
            h('button', { class: 'btn', onclick: async () => { await DB.setKV('odRoot', odRootIn.value.trim() || 'סקרי עצים'); toast('נשמר'); } }, 'שמור תיקייה')),
          odStatus),
        h('div', { class: 'card stack' },
          h('h2', { style: 'margin:0;font-size:20px' }, 'עבודה בשטח'),
          autoGps, shareFiles),
        h('div', { class: 'card stack' },
          h('h2', { style: 'margin:0;font-size:20px' }, 'רשימות בחירה'),
          h('div', { class: 'muted small' }, 'שורה לכל פריט. האפליקציה מוסיפה אוטומטית גם מה שכבר כתבת בסקרים.'),
          field('מיני עצים', speciesTa),
          field('משפטי טיפול', phrasesTa),
          h('button', { class: 'btn primary', onclick: async () => {
            const lines = ta => ta.value.split('\n').map(s => s.trim()).filter(Boolean);
            await DB.setKV('species', lines(speciesTa)); await DB.setKV('phrases', lines(phrasesTa));
            toast('נשמר');
          } }, 'שמור רשימות')),
        h('div', { class: 'card stack' },
          h('h2', { style: 'margin:0;font-size:20px' }, 'גיבוי'),
          h('div', { class: 'muted small' }, 'כל הסקרים והתמונות בקובץ אחד. כדאי לשמור אותו בדרייב מדי פעם, ובטח לפני החלפת טאבלט או ניקוי של כרום.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', onclick: () => backup(backupStatus) }, 'גיבוי מלא'),
            h('button', { class: 'btn', onclick: () => { $('#restoreInput').value = ''; $('#restoreInput').click(); } }, 'שחזור מגיבוי')),
          backupStatus),
        h('p', { class: 'muted small', style: 'text-align:center' }, 'גרסה ' + APP_VERSION)));
  }

  async function backup(status) {
    status.textContent = 'מכין גיבוי…';
    const zip = new JSZip();
    const surveys = await DB.allSurveys();
    zip.file('data.json', JSON.stringify({ app: 'tree-survey', version: APP_VERSION, surveys }, null, 1));
    let n = 0;
    for (const s of surveys) for (const t of s.trees) for (const p of t.photos || []) {
      const d = await DB.getPhoto(p.id);
      if (d) { zip.file('photos/' + p.id + '.jpg', d.blob); n++; }
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    await deliver(blob, `גיבוי סקרי עצים ${fmtDate(today()).replace(/\//g, '.')}.zip`);
    status.textContent = `גובו ${surveys.length} סקרים ו-${n} תמונות.`;
  }

  $('#restoreInput').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const zip = await JSZip.loadAsync(f);
      const data = JSON.parse(await zip.file('data.json').async('string'));
      const existing = new Set((await DB.allSurveys()).map(s => s.id));
      let added = 0, skipped = 0;
      for (const s of data.surveys) {
        if (existing.has(s.id) && !confirm(`הסקר "${s.site}" כבר קיים בטאבלט. להחליף אותו בגרסה מהגיבוי?`)) { skipped++; continue; }
        for (const t of s.trees) for (const p of t.photos || []) {
          const pf = zip.file('photos/' + p.id + '.jpg');
          if (!pf) continue;
          const blob = new Blob([await pf.async('uint8array')], { type: 'image/jpeg' });
          await DB.putPhoto({ id: p.id, blob, thumb: null, w: p.w, h: p.h });
        }
        await DB.putSurvey(s); added++;
      }
      toast(`שוחזרו ${added} סקרים` + (skipped ? `, ${skipped} דולגו` : ''), 4000);
    } catch (err) { toast('השחזור נכשל: ' + err.message, 4000); }
  });

  // ---------- הפעלה ----------
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  OD.handleRedirect().then(r => {
    if (r) { toast(r.ok ? '✓ מחובר ל-OneDrive' : 'החיבור ל-OneDrive נכשל: ' + r.message, 4000); Sync.state.odNeedsLogin = false; }
    route();
    Sync.kick(true);
  });
})();

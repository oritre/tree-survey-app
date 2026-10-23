// אפליקציית סקר בטיחות עצים לטאבלט
(function () {
  'use strict';
  const APP_VERSION = '1.24.2';

  const SPECIES_SEED = ['אורן ירושלים', 'אורן קנרי', 'אורן ברוטיה', 'אורן הצנובר', 'ברוש מצוי', 'פיקוס השדרות', 'פיקוס בנימינה',
    'פיקוס קדוש', 'פיקוס התאנה', 'מכנף נאה', 'צאלון נאה', 'ברכיכיטון אדרי', 'אזדרכת מצויה', 'תות לבן', 'שיטה מכחילה',
    'אילנטה בלוטית', 'פרקינסוניה שיכנית', 'וושינגטוניה חסונה', 'תמר מצוי', 'דקל קנרי', 'זית אירופי', 'חרוב מצוי',
    'אלון מצוי', 'אלה אטלנטית', 'כליל החורש', 'מילה סורית', 'דולב מזרחי', 'אקליפטוס המקור', 'קזוארינה',
    "ג'קרנדה עלי-מימוזה", 'טיפואנה', 'ליגוסטרום יפני', 'אלביציה צהבהבה', 'שקד מצוי', 'רימון מצוי', 'תאנה', 'הדר', 'צפצפה', 'ערבה', 'סיגלון'];
  // הערות קבועות לסקר לבנייה (ניתן לערוך בהגדרות)
  const CONSTRUCTION_NOTES_SEED = ['לא בוגר', 'לא קיים', 'מיקום מקורב', 'פטור מרישיון'];
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
  // אייקונים (SVG בקו, 24x24): נראים אותו דבר בכל טאבלט, בניגוד לאמוג'י שתלוי בגופן המכשיר
  const ICONS = {
    plus: 'M12 5v14M5 12h14',
    search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
    tree: 'M12 2l6 9h-3.5l4.5 7H5l4.5-7H6zM12 18v4',
    money: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 10h.01M18 14h.01',
    gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 8h.01',
    file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
    camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M16 9h.01',
    pin: 'M12 21s-6-6.2-6-11a6 6 0 1 1 12 0c0 4.8-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    photo: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4',
    check: 'M5 12l5 5L20 7',
    cloud: 'M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 11.3 1.5A3.5 3.5 0 0 1 17.5 18z',
    back: 'M5 12h14M13 6l6 6-6 6',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    next: 'M19 12H5M11 6l-6 6 6 6',
    sprout: 'M12 21v-8M12 13c0-4 3-7 8-7 0 4-3 7-8 7zM12 13c0-3-2-5-6-5 0 3 2 5 6 5z',
  };
  function icon(name, cls) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', '2'); el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('aria-hidden', 'true'); el.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ICONS[name] || ''); el.append(p);
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
  // שם קובץ לשיתוף (וואטסאפ וכו'): וואטסאפ משבש שמות עם גרשיים עבריים, אז ״ -> '' ו-׳ -> '
  // ori: שמות קבצים בלי גרשיים בכלל (ליד"ה -> לידה), כי וואטסאפ משבש שמות איתם
  const QUOTES = /["'\u05F3\u05F4\u201C\u201D\u2018\u2019]/g;
  const shareName = s => String(s || '').replace(QUOTES, '');
  const safeName = s => String(s || '').replace(QUOTES, '').replace(/[\\/:*?<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

  // ---------- מצב ----------
  let cur = null; // הסקר הפתוח
  let curTreeId = null;
  let tab = 'trees';
  const thumbUrls = new Map();
  const saveSoon = debounce(() => { if (cur) { DB.putSurvey(cur); Sync.kick(); } }, 400);
  const saveNow = () => cur && DB.putSurvey(cur);

  // תמונה מלאה: מהטאבלט, ואם כבר פונתה אחרי "סיום סקר" — מגוגל דרייב
  async function photoBlob(s, id) {
    const d = await DB.getPhoto(id);
    if (d && d.blob) return d.blob;
    const meta = (s || cur).trees.flatMap(t => t.photos || []).find(p => p.id === id);
    if (!meta || !meta.odId) return null;
    return OD.download(meta.odId);
  }

  async function thumbUrl(photoId) {
    if (thumbUrls.has(photoId)) return thumbUrls.get(photoId);
    const p = await DB.getPhoto(photoId);
    if (!p) return '';
    if (!p.thumb && !p.blob) { // סקר שנפתח מהענן: התמונה הממוזערת נוצרת פעם אחת ונשמרת
      try {
        const big = await photoBlob(cur, photoId);
        if (!big) return '';
        p.thumb = await makeThumb(big);
        await DB.putPhoto(p);
      } catch (_) { return ''; }
    }
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
        const next = await onOpenSurvey(cur);
        if (next !== cur) { cur = null; go('#/s/' + next.id + '/details'); return; }
        migrateSite(cur);
        for (const t of cur.trees) { delete t._gpsBusy; Core.normalizePhotos(t); }
        refreshSuggestions();
      }
      tab = m[2] || 'trees';
      if (m[3]) curTreeId = decodeURIComponent(m[3]);
      if (!cur.trees.find(t => t.id === curTreeId)) curTreeId = (Core.sortTrees(cur.trees)[0] || {}).id || null;
      return renderSurvey();
    }
    await saveNow();
    // יציאה מסקר: נתוני הסקר עולים לענן מיד
    if (cur) Sync.now();
    cur = null;
    if (hash.startsWith('#/cloud')) return renderCloud();
    if (hash.startsWith('#/health')) return renderHealth();
    if (hash.startsWith('#/summary')) return renderSummary();
    if (hash.startsWith('#/import')) return renderImport();
    if (hash.startsWith('#/settings')) return renderSettings();
    if (hash.startsWith('#/quotes')) return QuotesUI.render(hash);
    return renderHome();
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  // סרגל עליון. title: טקסט, או {title, sub} לכותרת עם שורת משנה (למשל פרויקט ותאריך הסקר)
  function bar(title, back, ...right) {
    const t = title && typeof title === 'object' && !title.nodeType ? title : { title };
    return h('header', { class: 'bar' },
      back ? h('button', { class: 'icon-btn back', 'aria-label': 'חזרה', onclick: () => go(back) }, icon('back')) : null,
      back ? homeBtn() : null,
      h('h1', {}, h('span', { class: 't' }, t.title), t.sub ? h('span', { class: 'sub' }, t.sub) : null),
      h('button', { class: 'sync-pill icon-btn ' + syncClass(), id: 'syncPill', title: 'מצב הגיבוי (לחיצה: בקרת גיבוי)', onclick: () => go('#/health') }, h('span', { class: 'dot' }), h('span', { class: 'txt' }, syncText())), ...right,
      powerBtn());
  }

  // כפתור בית: חזרה למסך הראשי מכל מסך
  function homeBtn() {
    const b = h('button', { class: 'icon-btn home-btn', title: 'מסך הבית', 'aria-label': 'מסך הבית', onclick: () => go('#/') });
    b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/></svg>';
    return b;
  }

  // כפתור כיבוי: ציור SVG (התו ⏻ לא קיים בגופן של רוב הטאבלטים)
  function powerBtn() {
    const b = h('button', { class: 'icon-btn power-btn', title: 'כיבוי', 'aria-label': 'כיבוי האפליקציה', onclick: shutdown });
    b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>';
    return b;
  }

  // מצב הגיבוי בפינה: כמה ממתינות לטלגרם / גוגל דרייב
  function syncText() {
    const st = Sync.state;
    if (st.odNeedsLogin) return 'גוגל דרייב: להתחבר מחדש';
    if (st.offline) return (st.tgPending + st.odPending) ? `אין קליטה · ${st.tgPending + st.odPending} ממתינים` : 'אין קליטה';
    if (st.busy) return 'מגבה…';
    if (st.error) return st.error.slice(0, 40);
    const n = st.tgPending + st.odPending;
    return n ? `${n} ממתינים` : 'מגובה';
  }
  // צבע הנקודה בפינה: ירוק מגובה, צהוב ממתין/מגבה, אפור בלי קליטה, אדום תקלה
  function syncClass() {
    const st = Sync.state;
    if (st.odNeedsLogin || st.error) return 'err';
    if (st.offline) return 'off';
    if (st.busy) return 'busy';
    return (st.tgPending + st.odPending) ? 'pending' : 'ok';
  }
  Sync.onChange(() => { const el = $('#syncPill'); if (el) { $('.txt', el).textContent = syncText(); el.className = 'sync-pill icon-btn ' + syncClass(); } });

  window.App = {
    live: id => (cur && cur.id === id ? cur : null),
    onSynced: () => { if (cur && tab === 'trees') renderPhotos(); },
    buildReport, buildPdf,
    // עזרים למסכים שבקבצים אחרים (הצעות מחיר)
    ui: { h, icon, bar, go, toast, askChoice: (...a) => askChoice(...a), downloadFile: (...a) => downloadFile(...a), debounce, safeName, shareName, today, fmtDate },
  };

  // ---------- מסך הבית ----------
  let projectFilter = null;
  async function renderHome() {
    const app = $('#app');
    // במסך הבית: רק סקרים שעבדו עליהם היום, וכל סקר שעוד לא גובה במלואו לענן (כדי שלא ייעלם לפני שעלה).
    // סקרים קודמים נמצאים ב"חיפוש סקרים בענן"
    const all = (await DB.allSurveys()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const odOn = await OD.connected();
    // סקר שעוד לא לחצו בו "סיום סקר" נשאר במסך הבית גם בימים הבאים (ממשיכים אותו מכאן), והתמונות שלו נשארות בטאבלט
    // סקרים שיובאו מאקסל ישן לא מוצגים כאן (הם בחיפוש בענן), אלא אם עבדו עליהם היום
    const surveys = all.filter(s => dayOf(s.updated || s.created) === today() || (!s.imported && (!inCloud(s, odOn) || !s.finished)));
    const hiddenN = all.length - surveys.length;
    cleanupOld(all.filter(s => !surveys.includes(s)));
    const projects = [...new Set(surveys.map(s => s.project || ''))].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, 'he'));
    if (projectFilter != null && !projects.includes(projectFilter)) projectFilter = null;
    const card = s => {
      const n = s.trees.filter(Core.hasContent).length;
      const ph = s.trees.reduce((a, t) => a + (t.photos || []).length, 0);
      const status = s.finished ? h('span', { class: 'status-chip done' }, icon('check'), 'הסתיים, בענן')
        : s.finishPending ? h('span', { class: 'status-chip wait' }, 'ממתין להעלאה')
        : dayOf(s.updated || s.created) !== today() ? h('span', { class: 'status-chip open' }, 'בתהליך') : null;
      return h('div', { class: 'card survey-item', role: 'button', tabindex: 0, onclick: () => go('#/s/' + s.id),
        onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('#/s/' + s.id); } } },
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { class: 't' }, s.site || 'סקר ללא שם', Construction.isConstruction(s) ? h('span', { class: 'badge type-badge' }, 'לבנייה') : null),
          h('div', { class: 'muted small' }, [s.code ? 'סמל ' + s.code : null, fmtDate(s.date)].filter(Boolean).join(' · ')),
          h('div', { class: 'meta' },
            h('span', {}, icon('tree'), `${n} עצים`),
            h('span', {}, icon('camera'), `${ph} תמונות`),
            status)),
        h('span', { class: 'arrow', 'aria-hidden': 'true' }, '‹'));
    };
    const shown = projectFilter == null ? projects : [projectFilter];
    const list = surveys.length ? shown.map(pr => h('section', {},
      h('h2', { class: 'proj-head' }, (pr || 'ללא פרויקט') + ` (${surveys.filter(s => (s.project || '') === pr).length})`),
      h('div', { class: 'grid-list' }, surveys.filter(s => (s.project || '') === pr).map(card))))
      : h('div', { class: 'empty' }, icon('sprout'), all.length ? 'אין סקרים מהיום. סקרים קודמים נמצאים ב"חיפוש סקרים בענן".' : 'עוד אין סקרים. לחץ על "סקר חדש" כדי להתחיל.');
    const chips = projects.length > 1 ? h('div', { class: 'project-chips', role: 'group', 'aria-label': 'סינון לפי פרויקט' },
      h('button', { class: 'chip' + (projectFilter == null ? ' on' : ''), onclick: () => { projectFilter = null; renderHome(); } }, 'כל הפרויקטים'),
      projects.map(pr => h('button', { class: 'chip' + (projectFilter === pr ? ' on' : ''), onclick: () => { projectFilter = pr; renderHome(); } }, pr || 'ללא פרויקט'))) : null;

    app.replaceChildren(
      bar('סקרי עצים', null, h('button', { class: 'icon-btn', title: 'הגדרות', 'aria-label': 'הגדרות', onclick: () => go('#/settings') }, icon('gear'))),
      h('main', { class: 'stack' },
        h('div', { class: 'home-actions' },
          h('button', { class: 'tile primary', onclick: newSurvey }, icon('plus'), 'סקר חדש'),
          h('button', { class: 'tile', onclick: () => go('#/cloud') }, icon('search'), 'חיפוש סקרים בענן'),
          h('button', { class: 'tile', onclick: () => go('#/summary') }, icon('tree'), 'אורנים ומפות'),
          h('button', { class: 'tile', onclick: () => go('#/quotes') }, icon('money'), 'הצעות מחיר')),
        chips, list,
        hiddenN ? h('div', { class: 'muted small', style: 'text-align:center' }, `עוד ${hiddenN} סקרים מימים קודמים שמורים בענן. `,
          h('a', { href: '#/cloud' }, 'לחיפוש סקרים בענן')) : null,
        h('p', { class: 'muted small', style: 'text-align:center', id: 'homeFoot' }, 'סקר פתוח נשמר בטאבלט (כדי לעבוד גם בלי קליטה) ומגובה לטלגרם ולגוגל דרייב. אחרי "סיום סקר" התמונות מפונות מהטאבלט ונשארות בענן. גרסה ' + APP_VERSION)));
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => {
      const el = $('#homeFoot'); if (el && e.usage != null) el.append(` · בשימוש בטאבלט: ${(e.usage / 1048576).toFixed(0)} MB`);
    }).catch(() => {});
  }

  const dayOf = t => { const d = new Date(t || 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // הסקר כולו בענן: נתונים ותמונות בגוגל דרייב (ובטלגרם אם מחובר), בלי "סיום סקר" שממתין
  function inCloud(s, odOn) {
    if (!odOn) return false;
    if (s.finishPending || s.odDataHash !== Sync.hashSurvey(s)) return false;
    return Sync.allInCloud(s);
  }
  // סקרים מימים קודמים שכבר בענן: התמונות המלאות מפונות מהטאבלט (הנתונים עצמם קטנים ונשארים)
  let cleaning = false; const freedIds = new Set();
  async function cleanupOld(list) {
    if (cleaning) return; cleaning = true;
    try {
      for (const s of list) if (!freedIds.has(s.id)) {
        await Sync.freeLocal(s); freedIds.add(s.id);
        // ה-PDF השמור לצפייה ושליחה נמחק מהטאבלט אחרי שבוע (עותק שלו נמצא בגוגל דרייב)
        if (Date.now() - (s.updated || 0) > 7 * 864e5) await DB.delKV('pdf:' + s.id);
      }
    } catch (_) {} finally { cleaning = false; }
  }

  // חלון בחירה: מחזיר את value של הכפתור שנלחץ
  function askChoice(title, sub, options) {
    return new Promise(resolve => {
      const ov = h('div', { class: 'modal' },
        h('div', { class: 'card stack', style: 'max-width:440px;width:92%' },
          h('h2', { style: 'margin:0;font-size:21px' }, title),
          sub ? h('div', { class: 'muted small' }, sub) : null,
          ...options.map(o => h('button', { class: 'btn big block' + (o.primary ? ' primary' : ''), style: 'text-align:right', onclick: () => { ov.remove(); resolve(o.value); } },
            o.label, o.hint ? h('div', { class: 'small', style: 'font-weight:400;opacity:.8' }, o.hint) : null))));
      document.body.append(ov);
    });
  }

  // פתיחת סקר קיים מיום אחר: שואלים אם לעדכן את התאריך. עדכון תאריך = סקר חדש, והסקר הקודם נשאר כמו שהוא
  async function onOpenSurvey(s) {
    const t = today();
    if (s.date && s.date !== t && s.dateAskedDay !== t) {
      const choice = await askChoice('לעדכן את תאריך הסקר להיום?', `הסקר מתאריך ${fmtDate(s.date)}. הסקר הקודם לא יידרס בשום מקרה.`, [
        { value: 'keep', label: `לא, להמשיך את הסקר מ-${fmtDate(s.date)}`, hint: 'הגרסה הקודמת נשמרת בענן לפני העריכה' },
        { value: 'new', primary: true, label: `כן, סקר חדש בתאריך ${fmtDate(t)}`, hint: 'העצים, ההערות והתמונות מועתקים (סקר חוזר)' },
      ]);
      if (choice !== 'keep') {
        const n = await copySurvey(s, true);
        toast(`נפתח סקר חדש בתאריך ${fmtDate(t)}. הסקר מ-${fmtDate(s.date)} נשאר כמו שהוא.`, 4000);
        return n;
      }
      s.dateAskedDay = t;
    }
    // פתיחה ביום אחר מהיום שבו הסקר נוצר: לפני העריכה של היום, הגרסה שבענן (נתונים, אקסל, PDF) נשמרת ב"גרסאות קודמות".
    // פעם אחת בכל יום, בלי קשר לזמן העדכון האחרון (שמשתנה גם מהגיבוי עצמו)
    if (s.odDataId && dayOf(s.created) !== t && s.snapDay !== t && !s.snapshotFrom) { s.snapshotFrom = t; s.snapDay = t; }
    await DB.putSurvey(s, false);
    return s;
  }

  // סקר חדש להיום על בסיס סקר קיים. withPhotos: התמונות מועתקות (בטאבלט, או קישור לקובץ שכבר בגוגל דרייב)
  async function copySurvey(old, withPhotos) {
    const keep = ['num', 'species', 'notes', 'urgency', 'pines', 'split', 'lat', 'lon', 'acc', 'gpsTime', 'gpsSrc', ...Construction.FIELDS];
    const s = { id: uid(), type: Construction.typeOf(old), project: old.project || '', siteName: old.siteName != null ? old.siteName : (old.site || ''), street: old.street || '', city: old.city || '',
      code: old.code || '', manager: old.manager || '', gush: old.gush || '', helka: old.helka || '', cset: old.cset ? Object.assign({}, old.cset) : undefined, warnGps: !!old.warnGps, date: today(), created: Date.now(), prev: { id: old.id, date: old.date }, odLayout: 2, trees: [] };
    for (const t of old.trees || []) {
      const nt = Object.assign({ id: uid(), photos: [], created: Date.now() }, Object.fromEntries(keep.filter(k => t[k] !== undefined).map(k => [k, t[k]])));
      if (withPhotos) for (const p of t.photos || []) {
        // תמונה מהסקר הקודם: מסומנת בתאריך שלו, לא נשלחת שוב לטלגרם, ונכנסת לדוח עד שמצלמים תמונה חדשה לאותו עץ
        const np = Object.assign({}, p, { id: uid(), fromOld: p.fromOld || old.date || '' });
        delete np.odName; delete np.tgMsgId; delete np.tgVer;
        const d = await DB.getPhoto(p.id);
        if (d && d.blob) { delete np.odId; delete np.odVer; delete np.odShared; await DB.putPhoto(Object.assign({}, d, { id: np.id })); } // יעלה לתיקיית הסקר החדש
        else if (p.odId) { np.odShared = true; await DB.putPhoto({ id: np.id, thumb: d && d.thumb, w: p.w, h: p.h, cloud: true }); } // נשאר בקובץ של הסקר הקודם בענן, נטען כשצריך
        else continue;
        nt.photos.push(np);
      }
      s.trees.push(nt);
    }
    s.site = composeSite(s);
    await DB.putSurvey(s);
    return s;
  }

  // תמונות שהוצאו מקובץ אקסל ישן (Importer.parse עם photos) -> לעצים של הסקר החדש, לפי מספר העץ (או המין בעץ בלי מספר)
  async function addOldPhotos(s, parsedTrees, oldDate) {
    let n = 0;
    // כמה עצים עם אותו מספר או אותו מין (בלי מספר): העץ ה-k מהקובץ הוא העץ ה-k בסקר
    const keyOf = x => x.num ? '#' + x.num : '~' + (x.species || '');
    const seen = new Map();
    for (const pt of parsedTrees) {
      const k = keyOf(pt), j = seen.get(k) || 0;
      seen.set(k, j + 1);
      if (!pt.images || !pt.images.length) continue;
      const t = s.trees.filter(x => keyOf(x) === k)[j];
      if (!t) continue;
      for (const im of pt.images) {
        const p = await processImage(im.blob);
        await DB.putPhoto({ id: p.id, blob: p.blob, thumb: p.thumb, w: p.w, h: p.h });
        const sub = im.sub != null && Core.splitActive(t) ? im.sub : null;
        const np = { id: p.id, w: p.w, h: p.h, sub, inReport: false, note: '', taken: Date.now(), fromOld: oldDate || '' };
        np.inReport = !t.photos.some(x => Core.groupKey(t, x) === Core.groupKey(t, np));
        t.photos.push(np); n++;
      }
    }
    await DB.putSurvey(s);
    return n;
  }

  // ---------- בקרת גיבוי ----------
  async function renderHealth() {
    const app = $('#app');
    const tgOn = !!((await DB.getKV('tgToken', '')) && (await DB.getKV('tgChat', '')));
    const odOn = await OD.connected();
    const surveys = (await DB.allSurveys()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const L = (await DB.getKV('syncLog', [])).slice().reverse();
    const st = Sync.state;
    const ago = t => { if (!t) return 'אף פעם'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'עכשיו' : m < 60 ? `לפני ${m} דק'` : new Date(t).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
    const checks = [
      [odOn, odOn ? 'גוגל דרייב מחובר' : 'גוגל דרייב לא מחובר: הסקרים לא מגובים לענן'],
      [!st.odNeedsLogin, st.odNeedsLogin ? 'גוגל דרייב: צריך להתחבר מחדש (בהגדרות)' : 'ההתחברות לגוגל דרייב תקפה'],
      [tgOn, tgOn ? 'טלגרם מחובר' : 'טלגרם לא מחובר: התמונות לא מגובות לטלגרם'],
      [!st.offline, st.offline ? 'אין קליטה כרגע: הכל נשמר בטאבלט ויעלה כשתחזור' : 'יש קליטה'],
      [!st.error, st.error ? 'שגיאה אחרונה: ' + st.error : 'אין שגיאות בגיבוי האחרון'],
      [!!st.lastOk && Date.now() - st.lastOk < 30 * 60000 || !(st.tgPending + st.odPending), `גיבוי מלא אחרון: ${ago(st.lastOk)}`],
    ];
    let persisted = null;
    try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (_) {}
    if (persisted === false) checks.push([false, 'הדפדפן לא אישר אחסון קבוע: מומלץ להתקין את האפליקציה למסך הבית']);
    app.replaceChildren(bar('בקרת גיבוי', '#/'),
      h('main', { class: 'stack', style: 'max-width:820px;margin:0 auto' },
        h('div', { class: 'card stack' },
          h('h2', { style: 'margin:0;font-size:20px' }, 'מצב כללי'),
          h('ul', { class: 'checks' }, checks.map(([ok, txt]) => h('li', { class: ok ? 'ok' : 'bad' }, (ok ? '✓ ' : '⚠ ') + txt))),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', onclick: () => { Sync.now(); toast('מגבה עכשיו…'); setTimeout(renderHealth, 4000); } }, 'גבה עכשיו'),
            h('button', { class: 'btn', onclick: () => go('#/settings') }, 'הגדרות'))),
        h('div', { class: 'card stack' },
          h('h2', { style: 'margin:0;font-size:20px' }, 'סקרים בטאבלט'),
          surveys.length ? h('table', { class: 'htable' },
            h('tr', {}, h('th', {}, 'סקר'), h('th', {}, 'נתונים בענן'), h('th', {}, 'תמונות בגוגל דרייב'), h('th', {}, 'תמונות בטלגרם'), h('th', {}, 'אקסל / PDF')),
            surveys.map(s => {
              const p = Sync.pendingOf(s, tgOn, odOn);
              const mark = (ok, txt) => h('td', { class: ok ? 'ok' : 'bad' }, txt);
              return h('tr', {},
                h('td', {}, h('a', { href: '#/s/' + s.id + '/export' }, s.site || 'סקר ללא שם'), h('div', { class: 'muted small' }, fmtDate(s.date))),
                odOn ? mark(p.data, p.data ? '✓' : 'ממתין') : h('td', {}, '—'),
                odOn ? mark(!p.od, p.od ? `${p.photos - p.od}/${p.photos}` : `✓ ${p.photos}`) : h('td', {}, '—'),
                tgOn ? mark(!p.tg, p.tg ? `${p.photos - p.tg}/${p.photos}` : `✓ ${p.photos}`) : h('td', {}, '—'),
                h('td', {}, s.finished ? '✓ הסתיים' : s.finishPending ? 'ממתין להעלאה' : s.odReportAt ? 'אקסל ' + ago(s.odReportAt) : '—'));
            })) : h('div', { class: 'muted' }, 'אין סקרים בטאבלט.')),
        h('div', { class: 'card stack' },
          h('h2', { style: 'margin:0;font-size:20px' }, 'יומן גיבוי'),
          L.length ? h('ul', { class: 'log' }, L.slice(0, 100).map(e => h('li', { class: e.level },
            h('span', { class: 'muted small' }, new Date(e.t).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' '),
            (e.level === 'error' ? '⚠ ' : e.level === 'ok' ? '✓ ' : '') + e.msg + (e.n > 1 ? ` (×${e.n})` : '') + (e.survey ? ' · ' + e.survey : ''))))
            : h('div', { class: 'muted' }, 'אין אירועים.'))));
  }

  // ---------- כיבוי ----------
  // שומר הכל בטאבלט, מנסה להעלות את מה שממתין (עד דקה וחצי), ואז סוגר
  // כיבוי: שומר, מחכה לגיבוי (עד דקה וחצי), ואז עוצר את הגיבוי ומנסה לסגור את החלון.
  // אנדרואיד לא תמיד מרשה לאתר לסגור את עצמו, ולכן במקרה כזה מוצג מסך "כבוי" מלא, שאפשר פשוט להשאיר.
  async function shutdown() {
    await saveNow();
    const msg = h('div', {}, 'שומר ומגבה…');
    const closeBtn = h('button', { class: 'btn primary block', onclick: () => finish(true) }, 'סגור עכשיו');
    const ov = h('div', { class: 'modal', style: 'z-index:100' }, h('div', { class: 'card stack', style: 'max-width:420px;width:92%' },
      h('h2', { style: 'margin:0;font-size:21px' }, 'כיבוי'), msg, closeBtn));
    document.body.append(ov);
    let done = false;
    const finish = () => {
      if (done) return; done = true; off();
      const st = Sync.state, n = st.tgPending + st.odPending;
      Sync.log(n ? 'info' : 'ok', n ? `כיבוי: ${n} פריטים ממתינים לגיבוי, יעלו בפתיחה הבאה` : 'כיבוי: הכל גובה');
      Sync.stop();
      const text = n
        ? `הכל שמור בטאבלט. ${n} פריטים עוד לא עלו לענן${st.offline ? ' (אין קליטה)' : ''}, והם יעלו לבד בפעם הבאה שהאפליקציה תיפתח עם קליטה.`
        : 'הכל שמור בטאבלט ובענן.';
      // מסך כבוי מלא: מחליף את כל האפליקציה, כך שגם אם החלון לא נסגר אי אפשר לגעת בסקר בטעות
      $('#app').replaceChildren();
      ov.replaceWith(h('div', { class: 'off-screen' },
        h('div', { class: 'off-icon', 'aria-hidden': 'true' }),
        h('h2', {}, 'האפליקציה כבויה'),
        h('p', {}, '✓ ' + text),
        h('p', { class: 'muted small' }, 'אפשר לסגור את החלון (החלקה למעלה ממסך האפליקציות האחרונות) או פשוט להשאיר אותו כך.'),
        h('button', { class: 'btn', onclick: () => location.reload() }, 'הפעל מחדש')));
      document.querySelector('.off-screen .off-icon').innerHTML = powerBtn().innerHTML;
      window.close();
    };
    const check = st => {
      if (done) return;
      const n = st.tgPending + st.odPending;
      if (st.offline || st.odNeedsLogin) return finish();
      msg.textContent = st.busy ? `מגבה… ${n ? n + ' ממתינים' : ''}` : 'בודק…';
      if (!st.busy && !n && started) finish();
    };
    let started = false;
    const off = Sync.onChange(check);
    Sync.now(); setTimeout(() => { started = true; check(Sync.state); }, 1500);
    setTimeout(finish, 90000);
  }


  // ---------- דיוק נ"צ במפה ----------
  let leafletP = null;
  // proj4: המרה לרשת ישראל החדשה (לתצלום של עיריית ירושלים)
  let proj4P = null;
  function loadProj4() {
    if (window.proj4) return Promise.resolve();
    return proj4P || (proj4P = new Promise((res, rej) => {
      const sc = h('script', { src: 'vendor/proj4.min.js' });
      sc.onload = res; sc.onerror = () => { proj4P = null; rej(new Error('proj4')); };
      document.head.append(sc);
    }));
  }
  function loadLeaflet() {
    if (window.L) return loadProj4().catch(() => {});
    return leafletP || (leafletP = new Promise((res, rej) => {
      document.head.append(h('link', { rel: 'stylesheet', href: 'vendor/leaflet/leaflet.css' }));
      const sc = h('script', { src: 'vendor/leaflet/leaflet.js' });
      sc.onload = () => loadProj4().catch(() => {}).then(res); sc.onerror = () => { leafletP = null; rej(new Error('טעינת המפה נכשלה')); };
      document.head.append(sc);
    }));
  }
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  // תצלומי אוויר של עיריות (חדים מאוד, רק בתחום העיר). מחוץ לתחום רואים את Esri מתחת
  const CITY_ORTHO = [
    ['https://gisn.tel-aviv.gov.il/arcgis/rest/services/WM/IView2Ortho2026WM/MapServer/tile/{z}/{y}/{x}', [[32.0265, 34.6711], [32.1484, 34.9179]], '© עיריית תל אביב-יפו'],
    ['https://tiles.arcgis.com/tiles/BtqYDIRT3FCK6rgL/arcgis/rest/services/city_ortho/MapServer/tile/{z}/{y}/{x}', [[29.4864, 34.8992], [29.6014, 34.9801]], '© עיריית אילת'],
    ['https://tiles.arcgis.com/tiles/7gJtYYpezyRvI0Jk/arcgis/rest/services/OldJerusalem20062024WML21/MapServer/tile/{z}/{y}/{x}', [[31.7665, 35.2148], [31.7952, 35.2535]], '© רשות העתיקות'],
  ];
  // עיריית ירושלים: תצלום אוויר 05/2026, עד 3 ס"מ לפיקסל, ברשת ישראל החדשה (ITM). כל אריח של המפה מצויר מאריחי ITM
  const JLM = { url: 'https://gisviewer.jerusalem.muni.il/arcgis/rest/services/Ortho052026/MapServer/tile/', ox: 205000, oy: 645000,
    res: [67.73346880027094, 33.86673440013547, 16.933367200067735, 8.466683600033868, 4.233341800016934, 2.116670900008467, 1.0583354500042335, 0.5291677250021167, 0.26458386250105836, 0.13229193125052918, 0.06614596562526459, 0.033072982812632296],
    bounds: [[31.5877, 35.0253], [32.0723, 35.5393]] };
  const ITM = '+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,-0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs';
  function itmLayer(L) {
    return L.GridLayer.extend({
      createTile(c, done) {
        const cv = document.createElement('canvas'); cv.width = cv.height = 256;
        const map = this._map, P = ll => window.proj4('WGS84', ITM, [ll.lng, ll.lat]);
        const px = c.scaleBy(L.point(256, 256));
        const tl = P(map.unproject(px, c.z)), tr = P(map.unproject(px.add([256, 0]), c.z)), bl = P(map.unproject(px.add([0, 256]), c.z)), br = P(map.unproject(px.add([256, 256]), c.z));
        // ITM -> פיקסלים באריח (מטריצה הפוכה של שני צלעות האריח)
        const ux = tr[0] - tl[0], uy = tr[1] - tl[1], vx = bl[0] - tl[0], vy = bl[1] - tl[1], det = ux * vy - vx * uy;
        const m11 = 256 * vy / det, m12 = -256 * vx / det, m21 = -256 * uy / det, m22 = 256 * ux / det;
        const need = Math.hypot(ux, uy) / 256; // מטר לפיקסל במפה
        let lv = JLM.res.findIndex(r => r <= need * 1.15); if (lv < 0) lv = JLM.res.length - 1;
        const r = JLM.res[lv], S = r * 256;
        const xs = [tl[0], tr[0], bl[0], br[0]], ys = [tl[1], tr[1], bl[1], br[1]];
        const c0 = Math.floor((Math.min(...xs) - JLM.ox) / S), c1 = Math.floor((Math.max(...xs) - JLM.ox) / S);
        const r0 = Math.floor((JLM.oy - Math.max(...ys)) / S), r1 = Math.floor((JLM.oy - Math.min(...ys)) / S);
        const ctx = cv.getContext('2d'); let left = 0;
        const finish = () => { if (--left <= 0) done(null, cv); };
        for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
          if (row < 0 || col < 0) continue;
          left++;
          const img = new Image();
          img.onload = () => {
            const dx = JLM.ox + col * S - tl[0], dy = JLM.oy - row * S - tl[1];
            ctx.setTransform(m11 * r, m21 * r, -m12 * r, -m22 * r, m11 * dx + m12 * dy, m21 * dx + m22 * dy);
            ctx.drawImage(img, 0, 0, 256.6, 256.6); // חפיפה קטנה, בלי קווים דקים בין האריחים
            finish();
          };
          img.onerror = finish;
          img.src = JLM.url + lv + '/' + row + '/' + col;
        }
        if (!left) setTimeout(() => done(null, cv), 0);
        return cv;
      },
    });
  }
  const EMPTY_TILE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  // תצלומי אוויר: גוגל (הכי חד בישראל) ו-Bing (ב-zoom עמוק ממשיך להגדיל את התמונה האחרונה במקום להיעלם)
  const LAYERS = {
    'גוגל – לוויין': ['https://mt{s}.google.com/vt/lyrs=y&hl=iw&x={x}&y={y}&z={z}', { subdomains: '0123', maxZoom: 22, maxNativeZoom: 21, attribution: '© Google' }],
    'Bing – תצלום אוויר': ['bing', { maxZoom: 22, maxNativeZoom: 19, attribution: '© Microsoft' }],
    'Esri – תצלום אוויר': [ESRI, { maxZoom: 22, maxNativeZoom: 19, attribution: '© Esri, Vantor' }],
    'עירייה – תצלום אוויר': ['city', { maxZoom: 22 }],
    'גוגל – מפה': ['https://mt{s}.google.com/vt/lyrs=m&hl=iw&x={x}&y={y}&z={z}', { subdomains: '0123', maxZoom: 22, maxNativeZoom: 21, attribution: '© Google' }],
  };
  function tileLayer(url, o) {
    const L = window.L;
    if (url === 'city') return L.layerGroup([L.tileLayer(ESRI, { maxZoom: 22, maxNativeZoom: 19, attribution: '© Esri, Vantor' }),
      ...CITY_ORTHO.map(([u, b, a]) => L.tileLayer(u, { bounds: b, maxZoom: 22, maxNativeZoom: 21, minZoom: 12, errorTileUrl: EMPTY_TILE, attribution: a })),
      ...(window.proj4 ? [new (itmLayer(L))({ bounds: JLM.bounds, minZoom: 13, maxZoom: 22, attribution: '© עיריית ירושלים' })] : [])]);
    if (url !== 'bing') return L.tileLayer(url, o);
    const quad = (x, y, z) => { let q = ''; for (let i = z; i > 0; i--) { const m = 1 << (i - 1); q += ((x & m) ? 1 : 0) + ((y & m) ? 2 : 0); } return q; };
    const Bing = L.TileLayer.extend({ getTileUrl: c => `https://ecn.t${(c.x + c.y) % 4}.tiles.virtualearth.net/tiles/a${quad(c.x, c.y, c.z)}.jpeg?g=1` });
    return new Bing('', o);
  }
  async function refineOnMap(t) {
    if (!navigator.onLine) { toast('אין קליטה: המפה צריכה אינטרנט', 3000); return; }
    try { await loadLeaflet(); } catch (e) { toast(e.message, 3000); return; }
    const others = cur.trees.filter(x => x !== t && x.lat != null);
    let start = t.lat != null ? [t.lat, t.lon] : others.length ? [others[0].lat, others[0].lon] : null;
    if (!start) start = await new Promise(r => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => r([p.coords.latitude, p.coords.longitude]), () => r([31.7683, 35.2137]), { timeout: 5000, maximumAge: 60000 }) : r([31.7683, 35.2137]));
    const mapEl = h('div', { class: 'map-box' });
    const info = h('div', { class: 'small' }, 'הזז את המפה כך שהעץ יהיה מתחת לצלב, ולחץ "שמור מיקום".');
    const ov = h('div', { class: 'annot map-ov' },
      h('div', { class: 'annot-bar' },
        h('span', { class: 'sp', style: 'font-weight:600' }, `נ"צ לעץ ${t.num || ''}`),
        h('button', { class: 'txt', onclick: () => close() }, 'ביטול'),
        h('button', { class: 'txt save', onclick: () => { const c = map.getCenter(); close([c.lat, c.lng]); } }, 'שמור מיקום')),
      h('div', { class: 'annot-stage', style: 'position:relative;padding:0' }, mapEl, h('div', { class: 'crosshair' })),
      h('div', { class: 'map-info' }, info));
    document.body.append(ov);
    const map = window.L.map(mapEl, { zoomControl: true, attributionControl: true, maxZoom: 22 }).setView(start, t.lat != null ? 20 : 18);
    const base = {};
    for (const [name, [url, o]] of Object.entries(LAYERS)) base[name] = tileLayer(url, o);
    const pref = await DB.getKV('mapLayer', 'גוגל – לוויין');
    (base[pref] || base['גוגל – לוויין']).addTo(map);
    window.L.control.layers(base, null, { position: 'topleft', collapsed: false }).addTo(map);
    map.on('baselayerchange', e => DB.setKV('mapLayer', e.name));
    for (const o of others) window.L.circleMarker([o.lat, o.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#2e7d32', fillOpacity: 1 }).bindTooltip('עץ ' + (o.num || ''), { permanent: true, direction: 'top', offset: [0, -6] }).addTo(map);
    if (t.lat != null) window.L.circleMarker([t.lat, t.lon], { radius: 6, color: '#ffd400', weight: 3, fillOpacity: 0 }).bindTooltip('המיקום הנוכחי').addTo(map);
    setTimeout(() => map.invalidateSize(), 50);
    let close;
    const res = await new Promise(r => { close = r; });
    map.remove(); ov.remove();
    if (!res) return;
    t.lat = res[0]; t.lon = res[1]; t.acc = null; t.gpsSrc = 'map'; t.gpsTime = Date.now();
    saveSoon(); refreshRow(t); renderGps(t);
    toast('המיקום עודכן מהמפה', 2000);
  }

  // ---------- חיפוש סקרים בענן ----------
  // כל הסקרים שעלו לגוגל דרייב, מכל מכשיר. אפשר לפתוח סקר כמו שהוא, או להתחיל ממנו סקר חדש (למשל בשנה הבאה)
  let cloudCache = null;
  async function renderCloud() {
    const app = $('#app');
    const q = h('input', { class: 'in', type: 'search', placeholder: 'סמל מוסד, שם, רחוב, עיר או פרויקט', style: 'font-size:18px' });
    const list = h('div', { class: 'stack' });
    const msg = h('div', { class: 'muted small', role: 'status' });
    const arch = h('div', { class: 'stack' });
    const archBtn = h('button', { class: 'btn primary', onclick: () => searchArchive(q.value, arch, archBtn) }, '🔎 חפש גם בארכיון בגוגל דרייב (קובצי אקסל)');
    const archive = await DB.getKV('gdArchive', null);
    const archWhere = h('div', { class: 'muted small' }, 'הארכיון: ' + (archive ? 'התיקייה "' + archive.name + '" ותתי התיקיות שלה' : 'כל הדרייב') + ' · ',
      h('a', { href: '#/settings' }, 'שינוי בהגדרות'));
    q.addEventListener('keydown', e => { if (e.key === 'Enter') searchArchive(q.value, arch, archBtn); });
    app.replaceChildren(bar('חיפוש סקרים בענן', '#/'), h('main', { class: 'stack', style: 'max-width:820px;margin:0 auto' }, q,
      h('div', { class: 'row' }, archBtn, h('button', { class: 'btn', onclick: () => go('#/import') }, '📥 ייבוא סקרים ישנים מאקסל')), archWhere, arch, msg, list));
    if (!(await OD.connected())) { msg.textContent = 'צריך לחבר את גוגל דרייב בהגדרות כדי לחפש בענן.'; return; }
    if (archive && navigator.onLine) OD.folderTree(archive.id).catch(() => {}); // מכין מראש את מבנה התיקיות של הארכיון, כדי שהחיפוש יהיה מהיר
    const local = new Map((await DB.allSurveys()).map(s => [s.id, s]));
    const draw = () => {
      const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const hay = e => [e.code, e.siteName, e.street, e.city, e.project, e.site, e.manager].join(' ').toLowerCase();
      const found = (cloudCache || []).filter(e => words.every(w => hay(e).includes(w)))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      msg.textContent = cloudCache ? `${found.length} סקרים` + (words.length ? ` מתוך ${cloudCache.length}` : '') : '';
      list.replaceChildren(...found.slice(0, 100).map(e => h('div', { class: 'card stack' },
        h('div', { class: 't', style: 'font-weight:600' }, e.siteName || e.site || 'סקר ללא שם'),
        h('div', { class: 'muted small' }, [e.code ? 'סמל ' + e.code : null, [e.street, e.city].filter(Boolean).join(', '), e.project, fmtDate(e.date)].filter(Boolean).join(' · ')),
        h('div', { class: 'small' }, `${e.trees} עצים · ${e.photos} תמונות` + (e.finished ? ' · ✓ הסתיים' : '')),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: ev => fromCloud(e, true, ev.currentTarget) }, 'סקר חדש על בסיסו'),
          h('button', { class: 'btn', onclick: ev => local.has(e.id) ? go('#/s/' + e.id) : fromCloud(e, false, ev.currentTarget) }, local.has(e.id) ? 'פתח (נמצא בטאבלט)' : 'פתח את הסקר הזה'),
          e.folderId ? h('button', { class: 'btn', onclick: ev => showVersions(e, ev.currentTarget) }, 'גרסאות קודמות') : null))));
    };
    q.addEventListener('input', draw);
    draw();
    msg.textContent = 'טוען מהענן…';
    try { cloudCache = await Sync.cloudIndex(); draw(); setTimeout(() => q.focus(), 50); }
    catch (e) { msg.textContent = (e instanceof OD.AuthError ? 'צריך להתחבר מחדש לגוגל דרייב בהגדרות. ' : 'הטעינה נכשלה: ') + e.message; }
  }

  // ---------- הארכיון בגוגל דרייב: כל קובצי האקסל של הסקרים (גם מהתוכנה במחשב) ----------
  // חיפוש לפי שם הקובץ או תוכן (שם מוסד, סמל), ופתיחה כסקר חדש להיום עם העצים, ההערות והתמונות מהקובץ
  const pathCache = new Map();
  async function pathOf(f) {
    const pid = f.parents && f.parents[0];
    if (!pid) return [];
    if (!pathCache.has(pid)) pathCache.set(pid, OD.folderPath(pid, 5).catch(() => []));
    return pathCache.get(pid);
  }
  async function searchArchive(text, box, btn) {
    text = text.trim();
    if (!text) { toast('כתוב שם מוסד, סמל או רחוב'); return; }
    if (!navigator.onLine) { toast('אין קליטה'); return; }
    btn.disabled = true;
    box.replaceChildren(h('div', { class: 'muted small' }, 'מחפש בארכיון…'));
    try {
      const archive = await DB.getKV('gdArchive', null);
      const files = await OD.searchExcel(text, archive && archive.id);
      const paths = await Promise.all(files.map(pathOf)); // במקביל
      const rows = files.map((f, i) => ({ f, path: paths[i] }))
        .filter(r => !r.path.some(n => /^גיבוי אפליקציית סקרי עצים$/.test(n))); // עותקים של האפליקציה עצמה מופיעים למעלה
      box.replaceChildren(h('div', { class: 'muted small' }, rows.length ? `${rows.length} קבצים בארכיון` : 'לא נמצאו קבצים בארכיון'),
        ...rows.slice(0, 40).map(({ f, path }) => h('div', { class: 'card stack' },
          h('div', { class: 't', style: 'font-weight:600;overflow-wrap:anywhere' }, '📄 ' + f.name.replace(/\.xls[xm]$/i, '')),
          h('div', { class: 'muted small' }, [path.join(' / '), f.lastModifiedDateTime ? fmtDate(f.lastModifiedDateTime.slice(0, 10)) : ''].filter(Boolean).join(' · ')),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', onclick: ev => fromArchive(f, path, ev.currentTarget) }, '📂 סקר חדש מהיום (עם העצים והתמונות)'),
            h('button', { class: 'btn', onclick: ev => fromArchive(f, path, ev.currentTarget, true) }, '✏️ ערוך את הסקר המקורי (בתאריך שלו)'),
            // הורדה אחרי המתנה לרשת נחסמת בדפדפן בטלפון, אז פותחים את הקובץ בגוגל דרייב (משם אפשר להוריד)
            h('a', { class: 'btn', href: 'https://drive.google.com/file/d/' + encodeURIComponent(f.id) + '/view', target: '_blank', rel: 'noopener' }, 'הצג את האקסל בדרייב')))));
    } catch (e) { box.replaceChildren(h('div', {}, (e instanceof OD.AuthError ? 'צריך להתחבר מחדש לגוגל דרייב בהגדרות. ' : 'החיפוש נכשל: ') + e.message)); }
    finally { btn.disabled = false; }
  }
  // keepDate: עריכה של הסקר המקורי בתאריך שלו (הקובץ בארכיון לא משתנה; הסקר נשמר כקובץ של האפליקציה בתאריך המקורי)
  async function fromArchive(f, path, btn, keepDate) {
    btn.disabled = true; const label = btn.textContent;
    try {
      btn.textContent = 'מוריד…';
      const b = await OD.download(f.id);
      if (!b) throw new Error('הקובץ לא נמצא');
      btn.textContent = 'קורא את הקובץ…';
      const r = await Importer.parse(await b.arrayBuffer(), f.name, { photos: true });
      if (!r) throw new Error('הקובץ לא נראה כמו סקר בטיחות עצים');
      const yi = path.findIndex(n => /^\s*(19|20)\d\d\s*$/.test(n));
      const old = Object.assign({}, r.survey, { id: 'file', project: (yi >= 0 && path[yi + 1]) || path[path.length - 1] || '', date: r.survey.date || (f.lastModifiedDateTime || '').slice(0, 10) });
      old.trees = r.trees.map(t => Object.assign({ id: uid(), photos: [] }, t));
      const s = await copySurvey(old, false);
      if (keepDate) { delete s.prev; s.date = old.date || s.date; s.source = { file: f.name, fileId: f.id }; s.dateAskedDay = today(); } // בלי השאלה על עדכון התאריך
      else s.prev = { file: f.name, fileId: f.id, date: old.date };
      btn.textContent = 'מוסיף את התמונות…';
      const n = await addOldPhotos(s, r.trees, old.date);
      const w = r.warnings.filter(x => !/^עץ בלי מספר/.test(x));
      toast((keepDate ? `נפתח הסקר המקורי ${f.name} בתאריך ${fmtDate(s.date)}: ${s.trees.length} עצים, ${n} תמונות. הקובץ בארכיון לא משתנה.`
        : `נפתח סקר חדש להיום על בסיס ${f.name} (${fmtDate(old.date)}): ${s.trees.length} עצים, ${n} תמונות.`) + (w.length ? ' ' + w.join('; ') : ''), 6000);
      go('#/s/' + s.id + '/details');
    } catch (e) { toast('נכשל: ' + e.message, 5000); btn.textContent = label; btn.disabled = false; }
  }

  // גרסאות קודמות של סקר (נשמרות לפני עריכה ביום אחר): שחזור כסקר נפרד, או הורדה של האקסל/PDF הישן
  async function showVersions(e, btn) {
    const card = btn.closest('.card');
    let box = card.querySelector('.versions');
    if (box) { box.remove(); return; }
    box = h('div', { class: 'versions stack small' }, 'טוען…');
    card.append(box);
    try {
      const kids = await OD.children(e.folderId);
      const vf = kids.find(x => x.folder && x.name === 'גרסאות קודמות');
      const files = vf ? (await OD.children(vf.id)).filter(f => f.file) : [];
      if (!files.length) { box.replaceChildren('אין גרסאות קודמות לסקר הזה.'); return; }
      files.sort((a, b) => b.name.localeCompare(a.name, 'he'));
      box.replaceChildren(...files.map(f => h('div', { class: 'row', style: 'align-items:center' },
        h('span', { style: 'flex:1;min-width:0;overflow-wrap:anywhere' }, f.name),
        /\.json$/i.test(f.name)
          ? h('button', { class: 'btn', onclick: ev => restoreVersion(f, ev.currentTarget) }, 'שחזר כסקר נפרד')
          : h('button', { class: 'btn', onclick: async ev => {
            ev.currentTarget.disabled = true;
            try { const b = await OD.download(f.id); if (b) downloadFile(b, f.name); } catch (err) { toast('נכשל: ' + err.message, 4000); }
            finally { ev.currentTarget.disabled = false; }
          } }, 'הורד'))));
    } catch (err) { box.replaceChildren('הטעינה נכשלה: ' + err.message); }
  }
  // הגרסה הישנה נפתחת כסקר נוסף, עם התאריך והתמונות שלה. הסקר הנוכחי לא משתנה
  async function restoreVersion(f, btn) {
    btn.disabled = true;
    try {
      const b = await OD.download(f.id);
      if (!b) throw new Error('הקובץ לא נמצא');
      const old = JSON.parse(await b.text());
      const s = await copySurvey(old, true);
      s.date = old.date || s.date; s.restoredFrom = { id: old.id, file: f.name }; s.dateAskedDay = today(); // בלי השאלה על עדכון התאריך
      await DB.putSurvey(s);
      toast(`הגרסה שוחזרה כסקר נפרד מ-${fmtDate(s.date)}. הסקר הנוכחי לא השתנה.`, 5000);
      go('#/s/' + s.id + '/trees');
    } catch (err) { toast('השחזור נכשל: ' + err.message, 5000); }
    finally { btn.disabled = false; }
  }

  // ---------- ייבוא סקרים ישנים מאקסל ----------
  // מקור: תיקייה במחשב (למשל גוגל דרייב), או תיקייה בגוגל דרייב. רק קובצי אקסל נקראים, ובתיקייה המקורית לא משתנה כלום.
  // כל סקר נשמר ישר בגיבוי בגוגל דרייב (נתונים + עותק של האקסל המקורי, עם התמונות שבתוכו), בלי להישאר בטאבלט,
  // ואחר כך מופיע בחיפוש בענן. בסוף: דוח בקרה (מה יובא, מה עם אזהרות ומה נכשל ולמה), שנשמר וגם יורד כאקסל
  const XL = /\.xls[xm]$/i;
  // מזהה קבוע לכל קובץ מקור: ייבוא חוזר של אותו קובץ מעדכן את אותו סקר ולא יוצר כפול
  function srcId(key) {
    let a = 0x811c9dc5, b = 0x9e3779b9;
    for (let i = 0; i < key.length; i++) { const c = key.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 2246822519) ^ (b >>> 13); }
    return 'imp' + (a >>> 0).toString(36) + (b >>> 0).toString(36);
  }
  // פרויקט לפי מיקום הקובץ: מדלגים על תיקיות שנה (2018…) ולוקחים את התיקייה הבאה (למשל האזור)
  const projectFromPath = (path, rootName) => path.find(p => !/^\s*(19|20)\d\d\s*$/.test(p)) || rootName;

  async function renderImport() {
    const app = $('#app');
    const main = h('main', { class: 'stack', style: 'max-width:820px;margin:0 auto' });
    app.replaceChildren(bar('ייבוא סקרים ישנים', '#/cloud'), main);
    if (!(await OD.connected())) { main.append(h('div', { class: 'card' }, 'צריך לחבר את גוגל דרייב בהגדרות.')); return; }
    const box = h('div', { class: 'stack' });
    const last = await DB.getKV('importLog', null);
    // תיקייה במחשב: הדפדפן נותן רק לקרוא את הקבצים, אין לו גישה לשנות בה משהו
    const pick = h('input', { type: 'file', webkitdirectory: '', multiple: true, style: 'display:none' });
    pick.onchange = () => {
      const all = [...pick.files];
      if (!all.length) return;
      const rootName = (all[0].webkitRelativePath || '').split('/')[0] || 'תיקייה';
      const files = all.filter(f => !/^~\$/.test(f.name) && /\.xls[xm]?$/i.test(f.name)).map(f => {
        const segs = (f.webkitRelativePath || f.name).split('/');
        const path = segs.slice(1, -1);
        return { key: 'loc:' + segs.slice(1).join('/') + '|' + f.size, name: f.name, path, size: f.size, when: f.lastModified || Date.now(), project: projectFromPath(path, rootName), get: async () => f, src: () => ({ blob: f, name: f.name }) };
      });
      choose(files, rootName, all.length - files.length);
      pick.value = '';
    };
    main.append(
      h('div', { class: 'card stack' },
        h('b', {}, '💻 מתיקייה במחשב (גם גוגל דרייב)'),
        h('div', { class: 'small' }, 'בכרום במחשב: בוחרים תיקייה (למשל "יציבות עצים" או תיקייה של שנה אחת). נקראים רק קובצי האקסל, כולל בתתי-התיקיות. קובצי PDF ושאר הקבצים לא נקראים, ובתיקייה לא משתנה כלום. כרום ישאל אם לאשר "העלאה" של הקבצים לאתר: זו רק קריאה שלהם בתוך האפליקציה.'),
        h('button', { class: 'btn primary big', onclick: () => pick.click() }, '📂 בחר תיקייה במחשב'), pick),
      h('div', { class: 'card stack' },
        h('b', {}, '☁️ מתיקייה בגוגל דרייב'),
        h('button', { class: 'btn big', onclick: () => browse() }, 'בחר תיקייה בגוגל דרייב')),
      last ? h('button', { class: 'btn', onclick: () => showReport(last) }, `📋 דוח הבקרה של הייבוא האחרון (${new Date(last.at).toLocaleDateString('he-IL')})`) : null,
      box);

    const trail = [{ id: null, name: 'גוגל דרייב' }];
    const browse = async () => {
      const here = trail[trail.length - 1];
      box.replaceChildren(h('div', { class: 'muted small' }, 'טוען…'));
      let items;
      try { items = await OD.children(here.id); } catch (e) { box.replaceChildren(h('div', {}, 'הטעינה נכשלה: ' + e.message)); return; }
      const dirs = items.filter(x => x.folder).sort((a, b) => a.name.localeCompare(b.name, 'he'));
      const xl = items.filter(x => x.file && XL.test(x.name)).length;
      box.replaceChildren(
        h('div', { class: 'card stack' },
          h('div', { class: 'row', style: 'align-items:center;flex-wrap:wrap;gap:4px' }, ...trail.map((t, i) => h('button', { class: 'chip' + (i === trail.length - 1 ? ' on' : ''), onclick: () => { trail.length = i + 1; browse(); } }, t.name))),
          h('div', { class: 'muted small' }, `${dirs.length} תיקיות${xl ? `, ${xl} קובצי אקסל` : ''} כאן`),
          here.id ? h('button', { class: 'btn primary big', onclick: () => scan(here) }, `🔎 סרוק את "${here.name}"`) : null),
        h('div', { class: 'stack' }, dirs.map(d => h('button', { class: 'btn', style: 'justify-content:flex-start', onclick: () => { trail.push({ id: d.id, name: d.name }); browse(); } }, '📁 ' + d.name))));
    };
    const scan = async here => {
      const status = h('div', { class: 'small', role: 'status' }, 'סורק…');
      box.replaceChildren(h('div', { class: 'card stack' }, status));
      const files = [];
      let other = 0;
      const walk = async (id, path, depth) => {
        for (const it of await OD.children(id)) {
          if (it.folder && depth < 6) await walk(it.id, path.concat(it.name), depth + 1);
          else if (it.file && /\.xls[xm]?$/i.test(it.name) && !/^~\$/.test(it.name)) files.push({ key: 'od:' + it.id, name: it.name, path, size: it.size || 0, when: it.lastModifiedDateTime ? new Date(it.lastModifiedDateTime).getTime() : Date.now(), project: projectFromPath(path, here.name), get: () => OD.download(it.id), src: () => ({ odId: it.id, name: it.name }) });
          else if (it.file) other++;
        }
        status.textContent = `סורק… נמצאו ${files.length} קובצי אקסל`;
      };
      try { await walk(here.id, [], 0); } catch (e) { status.textContent = 'הסריקה נכשלה: ' + e.message; return; }
      choose(files, here.name, other);
    };

    // בחירה לפי פרויקט (אלפי קבצים: לא מציגים כל קובץ, רק כמה יש בכל פרויקט)
    const choose = async (files, rootName, skipped) => {
      const done = await DB.getKV('importedSrc', {});
      const groups = new Map();
      for (const f of files) { if (!groups.has(f.project)) groups.set(f.project, []); groups.get(f.project).push(f); }
      const sel = new Set(groups.keys());
      let redo = false;
      const proj = h('input', { class: 'in', placeholder: 'פרויקט אחד לכל הקבצים (ריק = לפי התיקיות, כמו ברשימה)' });
      const go1 = h('button', { class: 'btn primary big' });
      const list = h('div', { class: 'stack small' });
      const todo = () => files.filter(f => sel.has(f.project) && (redo || !done[f.key]));
      const draw = () => {
        const n = todo().length;
        go1.textContent = `📥 ייבא ${n} קבצים`; go1.disabled = !n;
        list.replaceChildren(...[...groups].sort((a, b) => a[0].localeCompare(b[0], 'he')).map(([p, fs]) => {
          const old = fs.filter(f => done[f.key]).length;
          return h('label', { class: 'row', style: 'gap:8px;align-items:center' },
            h('input', { type: 'checkbox', checked: sel.has(p), onchange: e => { e.target.checked ? sel.add(p) : sel.delete(p); draw(); } }),
            h('span', {}, h('b', {}, p), ` · ${fs.length} קבצים` + (old ? ` (${old} יובאו כבר)` : '')));
        }));
      };
      box.replaceChildren(h('div', { class: 'card stack' },
        h('div', {}, `נמצאו ${files.length} קובצי אקסל ב"${rootName}"` + (skipped ? ` (${skipped} קבצים אחרים, כמו PDF, לא ייקראו)` : '') + '.'),
        files.length ? h('div', { class: 'muted small' }, 'הפרויקט של כל סקר נקבע לפי התיקייה שלו (תיקיות של שנה מדולגות, למשל 2023/ירושלים → ירושלים).') : null,
        files.length ? proj : null,
        files.length ? h('label', { class: 'row small', style: 'gap:8px' }, h('input', { type: 'checkbox', onchange: e => { redo = e.target.checked; draw(); } }), 'לייבא מחדש גם קבצים שכבר יובאו (מעדכן אותם, לא יוצר כפולים)') : null,
        files.length ? go1 : null, list));
      go1.onclick = () => runImport(todo(), f => proj.value.trim() || f.project);
      draw();
    };

    const runImport = async (files, projectOf) => {
      if (!navigator.onLine) { toast('אין אינטרנט'); return; }
      let stopReq = false;
      const status = h('div', { role: 'status' });
      const stopBtn = h('button', { class: 'btn', onclick: () => { stopReq = true; stopBtn.disabled = true; stopBtn.textContent = 'עוצר אחרי הקבצים שבטיפול…'; } }, '⏹ עצור');
      const lines = h('div', { class: 'stack small' });
      box.replaceChildren(h('div', { class: 'card stack' }, status, h('div', { class: 'muted small' }, 'אפשר לעצור ולהמשיך אחר כך: קבצים שיובאו לא ייובאו שוב. המסך צריך להישאר פתוח.'), stopBtn, lines));
      let lock = null;
      try { lock = await navigator.wakeLock.request('screen'); } catch (_) {}
      const done = await DB.getKV('importedSrc', {});
      const items = [];
      const seen = new Map(); // שם+תאריך שכבר יובאו בריצה הזו: אזהרה על קובץ כפול
      let pending = [], i = 0, next = 0;
      const flush = async () => {
        const batch = pending; pending = [];
        await Sync.flushImported(batch);
        await DB.setKV('importedSrc', done);
      };
      const one = async f => {
        const it = { file: f.name, path: f.path.join(' / '), project: projectOf(f), status: 'ok', msg: '', site: '', date: '', trees: 0, code: '' };
        try {
          if (/\.xls$/i.test(f.name)) throw new Error('פורמט xls ישן לא נתמך (אפשר לשמור אותו מחדש כ-xlsx)');
          let r, lastErr;
          const blob = await f.get();
          if (!blob) throw new Error('הקובץ לא נמצא');
          try { r = await Importer.parse(await blob.arrayBuffer(), f.name); }
          catch (e) { throw new Error('הקובץ לא נפתח (אולי פגום או מוגן בסיסמה)'); }
          if (!r) throw new Error('לא נראה כמו סקר בטיחות עצים');
          const s = Object.assign({ id: srcId(f.key), project: it.project, date: '' }, r.survey);
          if (!s.date) s.date = dayOf(f.when);
          s.site = composeSite(s);
          s.trees = r.trees.map((t, k) => Object.assign({ id: s.id + 't' + k, photos: [], created: f.when }, t));
          Object.assign(s, { created: f.when, odLayout: 2, finished: true, finishedAt: f.when, imported: { file: f.name, path: f.path.join('/'), at: Date.now() }, odSrcName: f.name, updated: Math.min(f.when, new Date(s.date + 'T12:00').getTime() || f.when) });
          const warn = r.warnings.slice();
          const dk = (s.siteName + '|' + s.date).trim();
          if (s.siteName && seen.has(dk)) warn.push('ייתכן שזה אותו סקר כמו ' + seen.get(dk));
          seen.set(dk, f.path.concat(f.name).join(' / '));
          // גוגל דרייב עמוס: מחכים ומנסים שוב
          for (let a = 0; ; a++) {
            try { pending.push(await Sync.importSurvey(s, f.src())); break; }
            catch (e) { lastErr = e; if (a >= 4 || !/עמוס|נסה שוב|Failed to fetch|NetworkError/i.test(e.message)) throw e; await new Promise(res => setTimeout(res, 5000 * (a + 1))); }
          }
          done[f.key] = s.id;
          Object.assign(it, { site: s.site || s.siteName, date: s.date, trees: s.trees.length, code: s.code, status: warn.length ? 'warn' : 'ok', msg: warn.join('; ') });
        } catch (e) { it.status = 'fail'; it.msg = e.message; }
        items.push(it);
        if (it.status !== 'ok') lines.prepend(reportLine(it));
      };
      const worker = async () => {
        while (!stopReq && next < files.length) {
          const f = files[next++];
          await one(f);
          i++;
          const c = count(items);
          status.textContent = `${i} מתוך ${files.length} · ✓ ${c.ok} · ⚠️ ${c.warn} · ✗ ${c.fail}`;
          if (pending.length >= 20) await flush();
        }
      };
      try { await Promise.all([worker(), worker(), worker()]); await flush(); }
      catch (e) { toast('שמירת האינדקס נכשלה: ' + e.message, 6000); }
      if (lock) lock.release().catch(() => {});
      const c = count(items);
      const log = { at: Date.now(), total: files.length, stopped: stopReq && i < files.length, items };
      await DB.setKV('importLog', log);
      Sync.log(c.fail ? 'error' : 'ok', `ייבוא סקרים ישנים: ${c.ok + c.warn} יובאו` + (c.warn ? ` (${c.warn} עם אזהרות)` : '') + (c.fail ? `, ${c.fail} נכשלו` : '') + (log.stopped ? ', נעצר באמצע' : ''));
      showReport(log);
    };
    const count = items => ({ ok: items.filter(x => x.status === 'ok').length, warn: items.filter(x => x.status === 'warn').length, fail: items.filter(x => x.status === 'fail').length });
    const ST = { ok: '✓', warn: '⚠️', fail: '✗' };
    const reportLine = it => h('div', { style: it.status === 'fail' ? 'color:var(--danger)' : '' }, `${ST[it.status]} `, h('b', {}, it.site || it.file),
      it.status !== 'fail' ? ` · ${fmtDate(it.date)} · ${it.trees} עצים` : '', ` · ${it.path || it.project}`, it.site ? h('span', { class: 'muted' }, ` · ${it.file}`) : null, it.msg ? h('div', { class: 'muted' }, it.msg) : null);

    // דוח בקרה: סיכום, רשימת הבעיות (או הכל), והורדה כאקסל
    function showReport(log) {
      const c = count(log.items);
      let filter = c.warn + c.fail ? 'bad' : 'all';
      const list = h('div', { class: 'stack small' });
      const chips = h('div', { class: 'row', style: 'gap:4px;flex-wrap:wrap' });
      const draw = () => {
        const shown = log.items.filter(x => filter === 'all' || (filter === 'bad' ? x.status !== 'ok' : x.status === filter));
        chips.replaceChildren(...[['bad', `בעיות (${c.warn + c.fail})`], ['fail', `נכשלו (${c.fail})`], ['warn', `אזהרות (${c.warn})`], ['all', `הכל (${log.items.length})`]]
          .map(([k, t]) => h('button', { class: 'chip' + (filter === k ? ' on' : ''), onclick: () => { filter = k; draw(); } }, t)));
        list.replaceChildren(...shown.slice(0, 500).map(reportLine), ...(shown.length > 500 ? [h('div', { class: 'muted' }, `ועוד ${shown.length - 500}… (כולם בקובץ האקסל)`)] : []));
      };
      const dl = async () => {
        const rows = [['מצב', 'שם המוסד', 'תאריך', 'עצים', 'סמל', 'פרויקט', 'קובץ', 'תיקייה', 'בעיה']].concat(
          log.items.slice().sort((a, b) => ({ fail: 0, warn: 1, ok: 2 })[a.status] - ({ fail: 0, warn: 1, ok: 2 })[b.status])
            .map(x => [({ ok: 'יובא', warn: 'יובא עם אזהרה', fail: 'נכשל' })[x.status], x.site, fmtDate(x.date), x.status === 'fail' ? '' : x.trees, x.code, x.project, x.file, x.path, x.msg]));
        downloadFile(await Reports.xlsx(rows, { sheet: 'בקרת ייבוא', widths: [14, 32, 11, 7, 10, 16, 36, 40, 50] }), `בקרת ייבוא ${today()}.xlsx`);
      };
      box.replaceChildren(h('div', { class: 'card stack' },
        h('b', {}, `דוח בקרה · ${new Date(log.at).toLocaleString('he-IL')}`),
        h('div', {}, `✓ ${c.ok} יובאו תקין · ⚠️ ${c.warn} יובאו עם אזהרה · ✗ ${c.fail} נכשלו` + (log.stopped ? ` · נעצר אחרי ${log.items.length} מתוך ${log.total}` : '')),
        c.ok + c.warn ? h('div', { class: 'muted small' }, 'הסקרים שיובאו נמצאים בגיבוי בגוגל דרייב ומופיעים בחיפוש בענן. כדאי לעבור על האזהרות (למשל שם או תאריך שלא נמצאו) ולבדוק את הסקר בחיפוש.') : null,
        h('button', { class: 'btn', onclick: dl }, '⬇️ הורד את הדוח כאקסל'), chips, list));
      draw();
    }
  }

  // asNew=true: סקר חדש עם אותם פרטי מוסד ואותם עצים (מספר, מין, הערות, אורנים, נ"צ), בתאריך של היום ובלי תמונות
  async function fromCloud(e, asNew, btn) {
    btn.disabled = true;
    try {
      if (!e.dataId) throw new Error('לסקר הזה אין עדיין נתונים בענן');
      const blob = await OD.download(e.dataId);
      if (!blob) throw new Error('קובץ נתוני הסקר לא נמצא בגוגל דרייב');
      const old = JSON.parse(await blob.text());
      if (!asNew) {
        // פתיחת אותו סקר: הנתונים יורדים לטאבלט, והתמונות נשארות בענן ונטענות כשצריך
        for (const t of old.trees) for (const p of t.photos || []) {
          if (!(await DB.getPhoto(p.id))) await DB.putPhoto({ id: p.id, thumb: null, w: p.w, h: p.h, cloud: true });
        }
        await DB.putSurvey(old);
        go('#/s/' + old.id);
        return;
      }
      const s = await copySurvey(old, true);
      // סקר שיובא מאקסל ישן: התמונות נמצאות רק בתוך קובץ האקסל המקורי שבתיקיית הגיבוי
      if (old.imported && old.odFolderId && old.odSrcName && !s.trees.some(t => t.photos.length)) {
        btn.textContent = 'מוציא את התמונות מהאקסל…';
        try {
          const f = await OD.findFile(old.odFolderId, old.odSrcName);
          const b = f && await OD.download(f.id);
          if (b) await addOldPhotos(s, (await Importer.parse(await b.arrayBuffer(), old.odSrcName, { photos: true })).trees, old.date);
        } catch (err) { toast('התמונות מהאקסל הישן לא נקראו: ' + err.message, 5000); }
      }
      toast(`נפתח סקר חדש על בסיס הסקר מ-${fmtDate(old.date)}, עם התמונות שלו. עדכן את העצים והוסף תמונות חדשות.`, 5000);
      go('#/s/' + s.id + '/details');
    } catch (err) { toast('נכשל: ' + err.message, 5000); }
    finally { btn.disabled = false; }
  }

  // ---------- אורנים ומפות: סיכום על פני כמה סקרים ----------
  // תמונה ממוזערת לעץ במפה: מהטאבלט אם יש, אחרת מגוגל דרייב
  async function mapThumb(s, p) {
    const rec = await DB.getPhoto(p.id);
    if (rec && (rec.thumb || rec.blob)) return rec.thumb || await makeThumb(rec.blob);
    return p.odId && navigator.onLine && await OD.connected() ? OD.thumb(p.odId) : null;
  }
  // מפה כדף אינטרנט אחד: מורידים/משתפים, ונשמרת גם בתיקיית הפרויקט בגוגל דרייב. מחזיר הודעה למשתמש
  async function shareMap(surveys, title, onProgress) {
    const r = await Reports.mapHtml(surveys, title, mapThumb);
    if (!r.points) throw new Error('אין עצים עם נ"צ בסקרים שנבחרו');
    const name = safeName(`מפת עצים - ${title} - ${fmtDate(today()).replace(/\//g, '.')}`) + '.html';
    await deliver(r.blob, name);
    let msg = `✓ המפה הורדה: ${r.points} עצים` + (r.noGps ? ` (${r.noGps} עצים בלי נ"צ לא מופיעים)` : '') + '. אפשר לשלוח את הקובץ בוואטסאפ או במייל, והוא נפתח בכל דפדפן.';
    const saved = await saveSummaryToCloud(surveys, name, r.blob);
    if (saved) msg += ` נשמרה גם בגוגל דרייב: ${saved}.`;
    return msg;
  }
  // קובץ סיכום לתיקיית הדוחות בגוגל דרייב (תיקיית הפרויקט אם כולם מאותו פרויקט)
  async function saveSummaryToCloud(surveys, name, blob) {
    try {
      if (!navigator.onLine || !(await OD.connected())) return '';
      const root = await OD.folder(null, (await DB.getKV('odRoot', 'סקרי עצים')) || 'סקרי עצים');
      const projects = [...new Set(surveys.map(s => s.project || 'ללא פרויקט'))];
      const dir = projects.length === 1 ? await OD.folder(root, projects[0]) : root;
      await OD.upload(dir, name, blob, true);
      const path = ((await DB.getKV('odRoot', 'סקרי עצים')) || 'סקרי עצים') + (projects.length === 1 ? '/' + projects[0] : '');
      Sync.log('ok', 'קובץ סיכום נשמר בגוגל דרייב: ' + name);
      return path;
    } catch (e) { Sync.log('error', 'שמירת קובץ סיכום בגוגל דרייב נכשלה: ' + e.message); return ''; }
  }

  async function renderSummary() {
    const app = $('#app');
    const msg = h('div', { class: 'muted small', role: 'status' });
    const status = h('div', { class: 'small', role: 'status' });
    const q = h('input', { class: 'in', type: 'search', placeholder: 'סינון: פרויקט, סמל, שם, רחוב, עיר' });
    const latest = h('input', { type: 'checkbox', checked: true });
    const list = h('div', { class: 'stack' });
    const sel = new Set();
    let entries = [];
    const btnP = h('button', { class: 'btn primary big', disabled: true }, '🌲 סיכום אורנים (אקסל)');
    const btnM = h('button', { class: 'btn primary big', disabled: true }, '🗺 מפה לשיתוף');
    app.replaceChildren(bar('אורנים ומפות', '#/'), h('main', { class: 'stack', style: 'max-width:820px;margin:0 auto' },
      h('div', { class: 'card stack' },
        h('div', { class: 'small' }, 'בחר פרויקט שלם או כמה סקרים. סיכום האורנים יוצא כאקסל: שורה לכל מוסד (לפי סמל מוסד, ובלי סמל לפי שם וכתובת). המפה היא דף אינטרנט: נקודה ירוקה לעץ תקין, אדומה לעץ שדורש טיפול, ולחיצה על נקודה מציגה את פרטי העץ.'),
        h('label', { class: 'row small', style: 'gap:8px' }, latest, 'רק הסקר האחרון בכל מוסד (כדי לא לספור פעמיים)'),
        h('div', { class: 'row' }, btnP, btnM), status),
      q, msg, list));
    const key = e => e.id;
    const hay = e => [e.code, e.siteName, e.street, e.city, e.project, e.site].join(' ').toLowerCase();
    const upd = () => {
      btnP.disabled = btnM.disabled = !sel.size;
      msg.textContent = entries.length ? `נבחרו ${sel.size} סקרים מתוך ${entries.length}` : msg.textContent;
    };
    const draw = () => {
      const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const shown = entries.filter(e => words.every(w => hay(e).includes(w)));
      const groups = new Map();
      for (const e of shown) { const pr = e.project || 'ללא פרויקט'; if (!groups.has(pr)) groups.set(pr, []); groups.get(pr).push(e); }
      const names = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'he'));
      list.replaceChildren(...names.map(pr => {
        const es = groups.get(pr).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const all = h('input', { type: 'checkbox', checked: es.every(e => sel.has(key(e))), onchange: ev => {
          for (const e of es) ev.target.checked ? sel.add(key(e)) : sel.delete(key(e));
          draw();
        } });
        return h('div', { class: 'card stack' },
          h('label', { class: 'row', style: 'gap:10px;font-weight:600;font-size:18px' }, all, `${pr} (${es.length})`),
          ...es.map(e => h('label', { class: 'row small', style: 'gap:10px;align-items:flex-start' },
            h('input', { type: 'checkbox', checked: sel.has(key(e)), onchange: ev => { ev.target.checked ? sel.add(key(e)) : sel.delete(key(e)); draw(); } }),
            h('span', {}, h('b', {}, e.siteName || e.site || 'סקר ללא שם'), ' · ',
              [e.code ? 'סמל ' + e.code : null, [e.street, e.city].filter(Boolean).join(', '), fmtDate(e.date), `${e.trees || 0} עצים`].filter(Boolean).join(' · ')))));
      }));
      upd();
    };
    q.addEventListener('input', draw);
    // רשימת הסקרים: מהאינדקס בענן, ובנוסף סקרים שבטאבלט ועוד לא עלו
    msg.textContent = 'טוען…';
    const local = await DB.allSurveys();
    const fromLocal = s => ({ id: s.id, project: s.project, code: s.code, siteName: s.siteName || s.site, street: s.street, city: s.city, site: s.site, date: s.date, trees: s.trees.filter(Core.hasContent).length, updated: s.updated });
    let cloud = [];
    if (await OD.connected() && navigator.onLine) {
      try { cloud = await Sync.cloudIndex(); } catch (e) { msg.textContent = 'הטעינה מהענן נכשלה (' + e.message + '). מוצגים רק הסקרים שבטאבלט.'; }
    }
    const byId = new Map(cloud.map(e => [e.id, e]));
    for (const s of local) byId.set(s.id, Object.assign({}, byId.get(s.id) || {}, fromLocal(s)));
    entries = [...byId.values()];
    if (!entries.length) msg.textContent = 'אין סקרים.';
    draw();

    async function chosen() {
      const out = [];
      let i = 0;
      for (const e of entries.filter(e => sel.has(key(e)))) {
        status.textContent = `טוען סקרים… ${++i} מתוך ${sel.size}`;
        const s = await Sync.loadSurvey(e);
        if (s) out.push(s);
      }
      return latest.checked ? Reports.latestPerPlace(out) : out;
    }
    const titleOf = list => {
      const pr = [...new Set(list.map(s => s.project || ''))].filter(Boolean);
      return list.length === 1 ? (list[0].site || 'סקר עצים') : pr.length === 1 ? pr[0] : `${list.length} סקרים`;
    };
    const run = (btn, fn) => async () => {
      btnP.disabled = btnM.disabled = true;
      try { status.textContent = await fn(); } catch (err) { console.error(err); status.textContent = 'נכשל: ' + err.message; }
      finally { upd(); }
    };
    btnP.onclick = run(btnP, async () => {
      const list = await chosen();
      const rows = Reports.pineRows(list);
      const name = safeName(`סיכום אורנים - ${titleOf(list)} - ${fmtDate(today()).replace(/\//g, '.')}`) + '.xlsx';
      const blob = await Reports.pinesXlsx(list);
      await deliver(blob, name);
      const tot = rows[rows.length - 1];
      let m = `✓ האקסל הורד: ${list.length} מוסדות, ${tot[5]} אורנים` + (tot[6] ? ` (${tot[6]} עצי אורן בלי כמות)` : '') + '.';
      const saved = await saveSummaryToCloud(list, name, blob);
      if (saved) m += ` נשמר גם בגוגל דרייב: ${saved}.`;
      return m;
    });
    btnM.onclick = run(btnM, async () => {
      const list = await chosen();
      status.textContent = 'מכין מפה (טוען תמונות קטנות)…';
      return shareMap(list, titleOf(list));
    });
  }

  // סקר חדש: קודם בוחרים סוג (יציבות / לבנייה)
  function chooseType() {
    return new Promise(resolve => {
      const close = v => { ov.remove(); resolve(v); };
      const opt = (type, title, sub) => h('button', { class: 'btn big type-opt', onclick: () => close(type) },
        h('div', { style: 'font-size:20px;font-weight:700' }, title), h('div', { class: 'muted small' }, sub));
      const ov = h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(null); } },
        h('div', { class: 'card stack', style: 'max-width:440px;width:92%' },
          h('h2', { style: 'margin:0;font-size:22px' }, 'איזה סקר?'),
          opt('safety', '🌳 ' + Construction.TYPES.safety, 'דחיפות טיפול, אורנים, דוח בטיחות ומכתב אישור'),
          opt('construction', '🏗 ' + Construction.TYPES.construction, 'לפי התבנית "סקר עצים להיתר בניה": גובה, גזעים, ניקוד, סך ערך, אזור שורשים ושווי'),
          h('button', { class: 'btn', onclick: () => close(null) }, 'ביטול')));
      document.body.append(ov);
    });
  }

  async function newSurvey() {
    const type = await chooseType();
    if (!type) return;
    const project = projectFilter != null ? projectFilter : await DB.getKV('lastProject', '');
    const s = { id: uid(), type, project, site: '', siteName: '', street: '', city: await DB.getKV('lastCity', ''), code: '', manager: '', date: today(), trees: [], created: Date.now() };
    s.site = composeSite(s);
    await DB.putSurvey(s);
    go('#/s/' + s.id + '/details');
  }

  // ---------- מסך הסקר ----------
  function renderSurvey() {
    const app = $('#app');
    const tabs = [['trees', 'עצים', 'tree'], ['details', 'פרטי הסקר', 'info'], ['export', 'הפקת דוח', 'file']];
    const body = h('main', {});
    const n = cur.trees.filter(Core.hasContent).length;
    app.replaceChildren(
      bar({ title: cur.site || 'סקר חדש', sub: [cur.project, fmtDate(cur.date), n ? `${n} עצים` : null, Construction.isConstruction(cur) ? 'סקר לבנייה' : null].filter(Boolean).join(' · ') }, '#/'),
      h('nav', { class: 'tabs', 'aria-label': 'חלקי הסקר' }, tabs.map(([k, label, ic]) =>
        h('button', { class: 'tab' + (tab === k ? ' on' : ''), 'aria-current': tab === k ? 'page' : null, onclick: () => go(`#/s/${cur.id}/${k}`) }, icon(ic), label))),
      body);
    if (tab === 'details') renderDetails(body);
    else if (tab === 'export') renderExport(body);
    else renderTrees(body);
  }

  // שם המוסד, רחוב ועיר נשמרים בנפרד, ובכותרת הדוח (F9) מופיעים יחד: "שם, רחוב, עיר"
  const composeSite = s => [Construction.isConstruction(s) ? '' : s.siteName, s.street, s.city].map(x => (x || '').trim()).filter(Boolean).join(', ');
  function migrateSite(s) {
    if (s.siteName == null && s.street == null && s.city == null) { s.siteName = s.site || ''; s.street = ''; s.city = ''; }
  }

  function field(label, input) { return h('div', {}, h('label', { class: 'f' }, label), input); }

  function renderDetails(body) {
    const build = Construction.isConstruction(cur);
    if (build) cur.site = composeSite(cur);
    const inp = (key, attrs) => h('input', Object.assign({
      class: 'in', value: cur[key] || '',
      oninput: e => {
        cur[key] = e.target.value; saveSoon();
        if (key === 'siteName' || key === 'street' || key === 'city') {
          cur.site = composeSite(cur);
          $('.bar h1').textContent = cur.site || 'סקר חדש';
          if (key === 'city') DB.setKV('lastCity', cur.city.trim());
        }
        if (key === 'project') DB.setKV('lastProject', cur.project.trim());
      },
    }, attrs));
    const projList = h('datalist', { id: 'projectList' });
    const cityList = h('datalist', { id: 'cityList' });
    const streetList = h('datalist', { id: 'streetList' });
    const opts = (all, k) => [...new Set(all.map(x => (x[k] || '').trim()).filter(Boolean))].map(v => h('option', { value: v }));
    DB.allSurveys().then(all => {
      projList.replaceChildren(...opts(all, 'project'));
      cityList.replaceChildren(...opts(all, 'city'));
      streetList.replaceChildren(...opts(all, 'street'));
    });
    body.append(h('div', { class: 'card stack', style: 'max-width:720px;margin:0 auto' },
      projList, cityList, streetList,
      field('סוג הסקר', h('select', { class: 'in', onchange: e => { cur.type = e.target.value; cur.site = composeSite(cur); saveSoon(); renderSurvey(); } },
        Object.entries(Construction.TYPES).map(([k, v]) => h('option', { value: k, selected: Construction.typeOf(cur) === k ? '' : null }, v)))),
      field('פרויקט (למשל: ירושלים)', inp('project', { list: 'projectList', placeholder: 'לניהול וסינון הסקרים, לא מופיע בדוח' })),
      build ? null : field('שם המוסד / האתר', inp('siteName', { placeholder: 'למשל: גן חצב' })),
      h('div', { class: 'row', style: 'align-items:stretch' },
        h('div', { style: 'flex:2;min-width:200px' }, field('רחוב ומספר', inp('street', { list: 'streetList', placeholder: 'למשל: הנרקיס 5' }))),
        h('div', { style: 'flex:1;min-width:160px' }, field('עיר', inp('city', { list: 'cityList', placeholder: 'למשל: ירושלים' })))),
      h('div', { class: 'muted small' }, build ? 'בכותרת האקסל (B7): רחוב ועיר.' : 'בכותרת הדוח: שם המוסד בשורה הראשונה, ומתחתיו רחוב ועיר.'),
      h('div', { class: 'row', style: 'align-items:stretch' },
        build ? null : h('div', { style: 'flex:1;min-width:200px' }, field('סמל מוסד (אם יש)', inp('code', { inputmode: 'numeric' }))),
        h('div', { style: 'flex:1;min-width:200px' }, field('תאריך הסקר', inp('date', { type: 'date' })))),
      build ? constructionDetails(inp) : field('מנהל/ת', inp('manager')),
      // התראה על עצים בלי נ"צ בבדיקה לפני הפקה: לפי סקר, כבויה כברירת מחדל
      h('label', { class: 'set-row' },
        h('input', { type: 'checkbox', checked: !!cur.warnGps, onchange: e => { cur.warnGps = e.target.checked; saveSoon(); } }),
        h('span', {}, h('b', {}, 'להתריע על עצים בלי נ"צ'), h('div', { class: 'muted small' }, 'בבדיקה לפני הפקה תופיע הערה לכל עץ שאין לו נ"צ.'))),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary big', onclick: () => go(`#/s/${cur.id}/trees`) }, 'המשך לעצים'),
        h('span', { style: 'flex:1' }),
        h('button', { class: 'btn danger', onclick: deleteSurvey }, 'מחק סקר'))));
  }

  // פרטי סקר לבנייה: גוש וחלקה (B3), והגדרות הסקר מגיליון "חד גזעי"
  function constructionDetails(inp) {
    cur.cset = Construction.settingsOf(cur);
    const toggle = x => h('label', { class: 'set-row' },
      h('input', { type: 'checkbox', checked: !!cur.cset[x.key], onchange: e => { cur.cset[x.key] = e.target.checked; saveSoon(); if (x.key === 'oliveCarob') diam.classList.toggle('hidden', !e.target.checked); } }),
      h('span', {}, h('b', {}, x.label), h('div', { class: 'muted small' }, x.help)));
    const diam = h('div', { class: cur.cset.oliveCarob ? '' : 'hidden', style: 'margin-inline-start:36px' },
      field('קוטר נדרש לזית וחרוב (ס"מ)', h('input', { class: 'in', inputmode: 'decimal', value: cur.cset.oliveDiam || '', style: 'max-width:160px',
        oninput: e => { cur.cset.oliveDiam = e.target.value.trim(); saveSoon(); } })));
    return h('div', { class: 'stack' },
      h('div', { class: 'row', style: 'align-items:stretch' },
        h('div', { style: 'flex:1;min-width:160px' }, field('גוש', inp('gush', { inputmode: 'numeric' }))),
        h('div', { style: 'flex:1;min-width:160px' }, field('חלקה', inp('helka', { inputmode: 'numeric' })))),
      h('div', { class: 'card stack', style: 'background:var(--surface-2)' },
        h('label', { class: 'set-row' },
          h('input', { type: 'checkbox', checked: !!cur.cset.embedPhotos, onchange: e => { cur.cset.embedPhotos = e.target.checked; saveSoon(); } }),
          h('span', {}, h('b', {}, 'לצרף את התמונות לאקסל'), h('div', { class: 'muted small' }, 'התמונות שסומנו לדוח נכנסות לנספח (עמודות BF:BK) ליד מספר העץ. בלי סימון: רק מספרי העצים, והתמונות מתיקיית Pictures במחשב.'))),
        h('h3', { style: 'margin:8px 0 0;font-size:18px' }, 'הגדרות הסקר'),
        h('div', { class: 'muted small' }, 'כמו בלשונית "חד גזעי" באקסל. חלות על כל העצים בסקר.'),
        Construction.SETTINGS.map(toggle), diam));
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

  function constructionBadge(t) {
    const c = Construction.compute(t, Construction.settingsOf(cur));
    return c.N == null ? null : h('span', { class: 'badge val-' + (c.N > 13 ? 'hi' : c.N > 6 ? 'mid' : 'lo'), title: 'סך ערך' }, c.N + '/20');
  }

  function treeRow(t) {
    const pineMissing = !Construction.isConstruction(cur) && Core.isPine(t.species) && (t.pines == null || t.pines === '');
    const urg = !Construction.isConstruction(cur) && t.urgency ? ' u-' + t.urgency : '';
    return h('button', { class: 'tree-row' + (t.id === curTreeId ? ' on' : '') + urg, 'data-id': t.id, 'data-search': `${t.num || ''} ${t.species || ''} ${t.notes || ''}`.toLowerCase(), onclick: () => selectTree(t.id) },
      h('span', { class: 'n' }, t.num || '—'),
      h('span', { style: 'min-width:0' },
        h('div', { class: 'sp' }, t.species || 'ללא מין'),
        h('div', { class: 'meta' }, t.notes || '')),
      h('span', { class: 'badges' },
        Construction.isConstruction(cur) ? constructionBadge(t)
          : t.urgency ? h('span', { class: 'badge u-' + t.urgency }, t.urgency) : null,
        pineMissing ? h('span', { class: 'badge alert', title: 'חסרה כמות אורנים' }, 'אורנים?') : null,
        (t.photos || []).length ? h('span', { class: 'badge soft', title: 'תמונות' }, icon('camera'), (t.photos || []).length) : null,
        t.lat != null ? h('span', { class: 'badge soft', title: 'יש נ"צ' }, icon('pin')) : null));
  }

  // סינון רשימת העצים (מספר, מין או הערה). נשמר בין רענונים של הרשימה
  let treeFilter = '';
  function applyTreeFilter(list) {
    const q = treeFilter.trim().toLowerCase();
    let shown = 0;
    for (const r of list.querySelectorAll('.tree-row')) { const ok = !q || r.dataset.search.includes(q); r.classList.toggle('hidden', !ok); if (ok) shown++; }
    const none = $('.no-match', list.parentNode);
    if (none) none.classList.toggle('hidden', shown > 0 || !q);
  }
  function renderTreeList(pane) {
    pane = pane || $('.list-pane');
    if (!pane) return;
    const trees = Core.sortTrees(cur.trees);
    const n = trees.filter(Core.hasContent).length;
    const list = h('div', { class: 'tree-list' }, trees.map(treeRow));
    const search = trees.length > 6 ? h('input', { class: 'in tree-search', type: 'search', value: treeFilter, placeholder: 'סינון: מספר, מין או הערה', 'aria-label': 'סינון העצים',
      oninput: e => { treeFilter = e.target.value; applyTreeFilter(list); } }) : null;
    if (!search) treeFilter = '';
    pane.replaceChildren(...[
      h('button', { class: 'btn primary big block', onclick: addTree }, icon('plus'), 'עץ חדש'),
      h('div', { class: 'list-head' }, h('span', {}, `${n} עצים בסקר` + (n > Core.MAX_TREES ? ` (בתבנית יש מקום ל-${Core.MAX_TREES})` : ''))),
      search,
      trees.length ? list : h('div', { class: 'empty' }, icon('sprout'), 'עוד אין עצים'),
      h('div', { class: 'muted small no-match hidden', style: 'text-align:center' }, 'אין עץ שמתאים לסינון')].filter(Boolean));
    applyTreeFilter(list);
    const on = $('.tree-row.on', pane);
    if (on) on.scrollIntoView({ block: 'nearest' });
  }

  function refreshRow(t) {
    const old = $(`.tree-row[data-id="${t.id}"]`);
    if (old) { const r = treeRow(t); r.classList.toggle('hidden', old.classList.contains('hidden')); old.replaceWith(r); }
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
    // סקר לבנייה: מין העץ של העץ הקודם עובר לעץ החדש (מוצג באפור). בלי לגעת הוא נשאר; בלחיצה בוחרים מין אחר בלי למחוק
    const prev = cur.trees[cur.trees.length - 1];
    if (Construction.isConstruction(cur) && prev && (prev.species || '').trim()) { t.species = prev.species; t.speciesAuto = true; }
    cur.trees.push(t);
    selectTree(t.id);
    await saveNow();
  }

  // השלמה אוטומטית של מין העץ בסקר בטיחות: כל המינים מרשימת סקר הבנייה, רק המילה הראשונה (איקליפטוס המקור → איקליפטוס)
  let safetySpeciesCache = null;
  function safetySpecies() {
    if (!safetySpeciesCache) safetySpeciesCache = [...new Set([...Construction.SPECIES.keys()]
      .map(n => n.replace(/\u00a0/g, ' ').trim().split(/\s+/)[0].replace(/-$/, ''))
      .filter(w => /[\u0590-\u05ff]/.test(w)))].sort((a, b) => a.localeCompare(b, 'he'));
    return safetySpeciesCache;
  }

  let sugCache = { speciesAll: SPECIES_SEED, speciesTop: SPECIES_SEED.slice(0, 10), phrasesTop: PHRASE_SEED, constructionNotes: CONSTRUCTION_NOTES_SEED };
  function refreshSuggestions() { suggestions().then(s => { sugCache = s; }).catch(() => {}); }

  async function suggestions() {
    const all = await DB.allSurveys();
    const sp = new Map();
    // לומדים רק מסקרי בטיחות: ההערות והמינים של סקרי בנייה לא נכנסים להצעות
    for (const s of all.filter(x => !Construction.isConstruction(x))) for (const t of s.trees) {
      const k = (t.species || '').trim();
      if (k) sp.set(k, (sp.get(k) || 0) + 1);
    }
    const custom = await DB.getKV('species', null);
    const phrases = await DB.getKV('phrases', null);
    const top = m => [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    const uniq = a => [...new Set(a)];
    return {
      speciesAll: uniq(top(sp).concat(custom || SPECIES_SEED)),
      speciesTop: uniq(top(sp).concat(custom || SPECIES_SEED)).slice(0, 10),
      // הערות: רק הרשימה הקבועה מההגדרות, בלי למידה מהסקרים
      phrasesTop: phrases || PHRASE_SEED,
      constructionNotes: (await DB.getKV('constructionNotes', null)) || CONSTRUCTION_NOTES_SEED,
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
    // פצל: תמיד מוצג, פעיל כשמספר העץ הוא טווח או רשימה (2-5, 7--9, 3,4)
    const showSplit = () => {
      const multi = /[-,–]/.test(t.num || '');
      splitWrap.classList.toggle('dim', !multi && !t.split);
      splitWrap.title = multi ? '' : 'פעיל כשמספר העץ הוא טווח, למשל 2-5';
    };
    const numIn = h('input', { class: 'in', value: t.num || '', inputmode: 'text', 'aria-label': 'מספר העץ',
      oninput: e => { t.num = e.target.value; showSplit(); changed(); }, onchange: () => { renderTreeList(); renderPhotos(); } });
    showSplit();

    // מין העץ + אורנים
    const pineIn = h('input', { class: 'in', type: 'number', inputmode: 'numeric', min: 0, value: t.pines == null ? '' : t.pines,
      oninput: e => { t.pines = e.target.value === '' ? null : Number(e.target.value); markPine(); changed(); } });
    const pineWrap = field('כמה אורנים?', pineIn);
    const markPine = () => {
      const pine = Core.isPine(t.species) && !Construction.isConstruction(cur);
      pineWrap.classList.toggle('hidden', !pine && (t.pines == null || t.pines === ''));
      pineIn.classList.toggle('alert', pine && (t.pines == null || t.pines === ''));
    };
    // כשנכתב אורן (גם עם עוד מינים או בשגיאת כתיב) ואין כמות: שואל מיד "כמה אורנים?"
    const askPines = async () => {
      if (Construction.isConstruction(cur)) return;
      if (!Core.isPine(t.species) || (t.pines != null && t.pines !== '') || t._askedPines === t.species) return;
      t._askedPines = t.species;
      const n = await askNumber('כמה אורנים?', `במין העץ "${t.species}" זוהה אורן`);
      if (n == null) { pineIn.focus(); return; }
      t.pines = n; pineIn.value = n; markPine(); changed();
    };
    const spIn = h('input', { class: 'in', value: t.speciesAuto ? '' : t.species || '', placeholder: t.speciesAuto ? t.species.trim() : '', list: 'speciesList', 'aria-label': 'מין עץ',
      oninput: e => { t.species = e.target.value; if (t.speciesAuto) { delete t.speciesAuto; spIn.placeholder = ''; } markPine(); changed(); if (Construction.isConstruction(cur) && constructionFields.refresh) constructionFields.refresh(); if (e.inputType === 'insertReplacementText' || !e.inputType) askPines(); },
      onchange: askPines });
    markPine();
    const chipSpecies = Construction.isConstruction(cur)
      ? [...new Set(sug.speciesAll.map(Construction.canonSpecies).filter(x => Construction.SPECIES.has(x)))].slice(0, 16)
      : sug.speciesTop;
    // הצ'יפ של המין שכבר נבחר מסומן
    const markSpChips = () => { for (const c of spChips.children) c.classList.toggle('on', c.textContent === (t.species || '').trim()); };
    const spChips = h('div', { class: 'chips' }, chipSpecies.map(s => h('button', { class: 'chip', type: 'button',
      onclick: () => { t.species = s; spIn.value = s; markPine(); markSpChips(); changed(); askPines(); if (Construction.isConstruction(cur) && constructionFields.refresh) constructionFields.refresh(); } }, s)));
    spIn.addEventListener('input', markSpChips);
    markSpChips();

    // הערות. צ'יפ של הערה שכבר כתובה מסומן, ולחיצה עליו מסירה אותה
    const notesIn = h('textarea', { class: 'in', 'aria-label': 'הערות וטיפול מומלץ', oninput: e => { t.notes = e.target.value; markNoteChips(); changed(); } });
    notesIn.value = t.notes || '';
    const noteParts = () => notesIn.value.split(/\s*[,.]\s*/).map(s => s.trim()).filter(Boolean);
    const markNoteChips = () => { const parts = noteParts(); for (const c of notesChips.children) c.classList.toggle('on', parts.includes(c.textContent)); };
    const notesChips = h('div', { class: 'chips' }, (Construction.isConstruction(cur) ? sug.constructionNotes || CONSTRUCTION_NOTES_SEED : sug.phrasesTop).map(p => h('button', { class: 'chip', type: 'button',
      onclick: () => {
        const parts = noteParts();
        if (parts.includes(p)) notesIn.value = parts.filter(x => x !== p).join(', ');
        else { const cur0 = notesIn.value.trim(); notesIn.value = cur0 ? cur0.replace(/[,.]$/, '') + ', ' + p : p; }
        t.notes = notesIn.value; markNoteChips(); changed();
      } }, p)));
    markNoteChips();

    // דחיפות
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'דחיפות' }, [['', 'ללא'], ['כ', 'כ - כריתה'], ['1', '1 - מיידי'], ['2', '2 - חצי שנה']].map(([v, label]) =>
      h('button', { type: 'button', class: (v ? 'v-' + v : '') + ((t.urgency || '') === v ? ' on' : ''), onclick: e => {
        t.urgency = v; changed();
        [...seg.children].forEach(b => b.classList.toggle('on', b === e.currentTarget));
      } }, label)));

    // נ"צ
    const gpsBox = h('span', { class: 'gps-inline', id: 'gpsBox' });
    renderGps(t, gpsBox);

    const photosBox = h('div', { id: 'photosBox' });
    const build = Construction.isConstruction(cur) ? constructionFields(t, changed, spIn) : null;

    pane.replaceChildren(
      h('datalist', { id: 'speciesList' }, (build ? [...Construction.SPECIES.keys()] : safetySpecies()).map(s => h('option', { value: s }))),
      h('div', { class: 'card stack' },
        h('div', { class: 'grid2' },
          h('div', {}, field('מספר העץ', numIn), splitWrap),
          h('div', {}, field('מין עץ', build ? speciesCombo(spIn, t) : spIn))),
        build ? null : spChips,
        build ? null : pineWrap,
        build,
        field(build ? 'הערות' : 'הערות וטיפול מומלץ', notesIn),
        notesChips,
        build ? null : field('דחיפות', seg),
        h('div', {},
          h('label', { class: 'f' }, 'תמונות'),
          h('div', { class: 'row', style: 'margin-bottom:10px' },
            h('button', { class: 'btn primary big', onclick: takePhotos }, icon('camera'), 'צלם'),
            h('button', { class: 'btn big', onclick: () => pickPhoto('galInput') }, icon('image'), 'מהגלריה'),
            gpsBox),
          photosBox),
        h('div', { class: 'editor-foot' },
          h('button', { class: 'btn danger', onclick: deleteTree }, icon('trash'), 'מחק עץ'),
          h('button', { class: 'btn primary', onclick: addTree }, icon('plus'), 'עץ הבא'))));
    renderPhotos();
  }

  // מין עץ בסקר לבנייה: רשימה נפתחת (חץ), חיפוש לפי חלק מהשם, ו-X שמנקה. רק שמות מהתבנית
  function speciesCombo(input, t) {
    input.removeAttribute('list');
    input.setAttribute('autocomplete', 'off');
    // Unknown ראשון, כמו ברשימה בתבנית
    const names = [...Construction.SPECIES.keys()].filter(n => n.trim());
    const menu = h('div', { class: 'combo-menu hidden', role: 'listbox' });
    const show = all => {
      const norm = v => v.replace(/[\u00a0\s]+/g, ' ').trim().toLowerCase();
      const q = all ? '' : norm(input.value);
      const list = q ? names.filter(n => norm(n).includes(q)) : names;
      menu.replaceChildren(...(list.length ? list.map(n => h('button', { type: 'button', class: 'combo-opt', role: 'option',
        onmousedown: e => e.preventDefault(),
        onclick: () => { input.value = n; t.species = n; hide(); input.dispatchEvent(new Event('change')); input.dispatchEvent(new Event('input')); } }, n.trim()))
        : [h('div', { class: 'muted small', style: 'padding:10px' }, 'אין מין כזה ברשימה')]));
      menu.classList.remove('hidden');
    };
    const hide = () => menu.classList.add('hidden');
    input.addEventListener('input', e => { if (e.isTrusted) show(false); });
    input.addEventListener('focus', () => show(!input.value.trim() || Construction.SPECIES.has(Construction.canonSpecies(input.value))));
    input.addEventListener('blur', () => setTimeout(hide, 150));
    const arrow = h('button', { type: 'button', class: 'combo-btn', 'aria-label': 'פתח רשימת מינים', onmousedown: e => e.preventDefault(),
      onclick: () => { if (menu.classList.contains('hidden')) { show(true); input.focus(); } else hide(); } }, '▾');
    const clear = h('button', { type: 'button', class: 'combo-btn', 'aria-label': 'נקה', onmousedown: e => e.preventDefault(),
      onclick: () => { input.value = ''; t.species = ''; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change')); input.focus(); show(true); } }, '✕');
    return h('div', { class: 'combo' }, h('div', { class: 'combo-row' }, input, clear, arrow), menu);
  }

  // סקר לבנייה: מה שממלאים בשטח (כמו בגיליון סקר בתבנית), ומתחת הערכים שהאקסל מחשב
  function constructionFields(t, changed, spIn) {
    const autoBox = h('div', { class: 'value-box', role: 'status' });
    const showAuto = () => {
      const c = Construction.compute(t, Construction.settingsOf(cur));
      const fmt = (v, d) => v == null ? '—' : (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('he-IL');
      const item = (label, v) => h('span', { class: 'auto-item' }, label + ': ', h('b', {}, v));
      autoBox.replaceChildren(...[
        h('div', { class: 'muted small' }, 'מחושב אוטומטית, כמו באקסל'),
        h('div', { class: 'auto-grid' },
          item('קוטר גזע', fmt(c.I, 1) + ' ס"מ'),
          item('ערך מין', c.L == null ? '—' : c.L),
          item('סך ערך', c.N == null ? '—' : c.N + '/20' + (c.N != null ? ' · ' + c.cat : '')),
          item('אזור שורשים מוגן', fmt(c.O, 2) + " מ'"),
          item('שווי עץ', c.P == null ? '—' : '₪' + fmt(c.P, 0))),
        (t.species || '').trim() && !c.known ? h('div', { class: 'small', style: 'color:var(--danger)' }, 'המין לא ברשימת המינים של התבנית. בחר מהרשימה כדי שיחושבו ערך מין ושווי.') : null,
        c.exempt ? h('div', { class: 'small muted' }, 'מין פטור מרישיון: סך ערך 0.') : null,
        c.palm ? h('div', { class: 'small muted' }, cur.cset && cur.cset.resExempt === false ? 'דקל: השווי לפי הגובה.' : 'דקל: פטור בתכנית בייעוד מגורים (ניתן לשנות בפרטי הסקר).') : null,
        c.P === 0 && c.N ? h('div', { class: 'small muted' }, 'שווי 0 (עץ מתחת ל-2 מ\' או קוטר קטן מהסף), ולכן אין אזור שורשים אלא אם יסומן שימור באקסל.') : null].filter(Boolean));
      autoBox.dataset.cat = c.cat;
    };
    showAuto();
    const upd = () => { changed(); showAuto(); };
    const measure = ([k, label]) => field(label, h('input', { class: 'in', inputmode: 'decimal', value: t[k] == null ? '' : t[k],
      oninput: e => { t[k] = e.target.value.trim(); upd(); } }));
    const score = ([k, label]) => {
      const seg = h('div', { class: 'seg score', role: 'group', 'aria-label': label }, [0, 1, 2, 3, 4, 5].map(v =>
        h('button', { type: 'button', class: String(t[k]) === String(v) ? 'on' : '', onclick: e => {
          t[k] = String(t[k]) === String(v) ? null : v; upd();
          [...seg.children].forEach(b => b.classList.toggle('on', b === e.currentTarget && t[k] != null));
        } }, String(v))));
      return field(label + ' (0-5)', seg);
    };
    const curTr = Construction.transplantOf(t);
    const trSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'היתכנות העתקה' }, Construction.TRANSPLANT.map(v =>
      h('button', { type: 'button', class: curTr === v ? 'on' : '', onclick: e => {
        t.transplant = Construction.transplantOf(t) === v ? '' : v; changed();
        [...trSeg.children].forEach(b => b.classList.toggle('on', b === e.currentTarget && !!t.transplant));
      } }, v)));
    // מין העץ: כשנבחר שם מהרשימה, נשמר בדיוק כמו בתבנית
    spIn.addEventListener('change', () => { const c = Construction.canonSpecies(t.species); if (c !== t.species) { t.species = c; spIn.value = c; changed(); } showAuto(); });
    constructionFields.refresh = showAuto;
    return h('div', { class: 'stack' },
      h('div', { class: 'grid4' }, Construction.MEASURES.map(measure)),
      h('div', { class: 'grid2 scores' }, Construction.SCORES.map(score)),
      field('היתכנות העתקה', trSeg),
      autoBox);
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

  // חלון קטן עם מקלדת מספרים. מחזיר מספר, או null אם דילגו
  function askNumber(title, sub) {
    return new Promise(resolve => {
      const inp = h('input', { class: 'in', type: 'number', inputmode: 'numeric', min: 0, style: 'font-size:28px;text-align:center' });
      const close = v => { ov.remove(); resolve(v); };
      const ok = () => { const v = inp.value.trim(); if (v !== '' && !isNaN(+v)) close(Number(v)); else inp.focus(); };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
      const ov = h('div', { class: 'modal' },
        h('div', { class: 'card stack', style: 'max-width:360px;width:90%' },
          h('h2', { style: 'margin:0;font-size:22px' }, title),
          sub ? h('div', { class: 'muted small' }, sub) : null,
          inp,
          h('div', { class: 'row', style: 'justify-content:space-between' },
            h('button', { class: 'btn', onclick: () => close(null) }, 'אחר כך'),
            h('button', { class: 'btn primary big', onclick: ok }, 'שמור'))));
      document.body.append(ov);
      setTimeout(() => inp.focus(), 50);
    });
  }

  // ---------- GPS ----------
  function renderGps(t, box) {
    box = box || $('#gpsBox');
    if (!box || t.id !== curTreeId) return;
    const has = t.lat != null;
    // נ"צ נלקח רק בלחיצה. כשיש כבר נ"צ, לחיצה שואלת אם לעדכן
    box.replaceChildren(
      h('button', { class: 'btn big' + (has ? ' ok' : ''), disabled: t._gpsBusy ? '' : null, onclick: () => {
        if (has && !confirm(`לעץ כבר יש נ"צ (${t.lat.toFixed(5)}, ${t.lon.toFixed(5)}). לעדכן למיקום הנוכחי?`)) return;
        captureGps(t);
      } }, icon('pin'), t._gpsBusy ? 'מאתר…' : has ? `נ"צ ✓${t.acc != null ? ` ±${Math.round(t.acc)}מ'` : t.gpsSrc === 'map' ? ' (מפה)' : ''}` : 'נ"צ'),
      h('button', { class: 'btn big', disabled: t._gpsBusy ? '' : null, onclick: () => refineOnMap(t) }, has ? '🗺 דייק במפה' : '🗺 סמן במפה'));
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
      if (best.coords.accuracy <= 8) finish();
    }, err => {
      if (!best) {
        t._gpsBusy = false; renderGps(t); done = true; navigator.geolocation.clearWatch(wid);
        if (!quiet || err.code === 1) toast(err.code === 1 ? 'צריך לאשר גישה למיקום בדפדפן' : 'לא הצלחתי לקבל מיקום. נסה שוב בשטח פתוח.');
      }
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    setTimeout(finish, 6000);
  }

  // ---------- תמונות ----------
  let pickTarget = null;
  function pickPhoto(inputId) {
    pickTarget = curTreeId;
    const inp = $('#' + inputId);
    inp.value = '';
    inp.click();
  }
  // שומרת תמונה אחת לעץ: (סימון אם ביקשו) -> טאבלט -> רישום בסקר. מחזירה false אם לא נשמרה
  async function addPhoto(t, file, annotate) {
    try {
      const p = await processImage(file);
      let rec = { id: p.id, blob: p.blob, thumb: p.thumb, w: p.w, h: p.h };
      if (annotate) {
        const strokes = await Annotate.open(p.blob, [], { saveLabel: 'שמור', cancelLabel: 'בלי סימון' });
        if (strokes && strokes.length) rec = await applyStrokes(rec, p.blob, strokes);
      }
      await DB.putPhoto(rec);
      // בעץ מפוצל: התמונה עוברת למספר הראשון שעוד אין לו תמונה
      let sub = null;
      if (Core.splitActive(t)) {
        const nums = Core.expandNum(t.num);
        sub = nums.find(n => !t.photos.some(x => x.sub === n)) || nums[0];
      }
      const np = { id: p.id, w: p.w, h: p.h, sub, inReport: false, note: '', taken: Date.now() };
      // הראשונה בקבוצה נכנסת לדוח, השאר לא (אפשר לשנות)
      // תמונה חדשה בעץ שיש בו רק תמונות מהסקר הקודם: החדשה נכנסת לדוח במקומן
      const group = t.photos.filter(x => Core.groupKey(t, x) === Core.groupKey(t, np));
      np.inReport = !group.some(x => !x.fromOld);
      if (np.inReport) group.forEach(x => { x.inReport = false; });
      t.photos.push(np);
      await saveNow(); // כל תמונה נרשמת בסקר מיד, גם אם האפליקציה תיסגר באמצע
      refreshRow(t);
      if (t.id === curTreeId) renderPhotos();
      Sync.kick(true);
      return true;
    } catch (err) {
      console.error(err);
      toast('לא הצלחתי לשמור את התמונה: ' + err.message);
      return false;
    }
  }

  // "צלם": המצלמה של האפליקציה (מהירה, צילום ברצף). אם אין גישה — אפליקציית המצלמה של המכשיר
  async function takePhotos() {
    const t = treeById(curTreeId);
    if (!t) return;
    if (await DB.getKV('inAppCamera', true)) {
      // בסקר לבנייה לא צריך מסך סימון אחרי הצילום
      const annotate = !Construction.isConstruction(cur) && await DB.getKV('annotateAfter', true);
      try {
        await Camera.open(blob => addPhoto(t, blob, annotate), { title: `עץ ${t.num || ''} ${t.species || ''}`.trim() });
        return;
      } catch (e) {
        toast('המצלמה של האפליקציה לא זמינה (' + e.message + '), פותח את מצלמת המכשיר', 3000);
      }
    }
    pickPhoto('camInput');
  }

  for (const id of ['camInput', 'galInput']) {
    document.getElementById(id).addEventListener('change', async e => {
      const files = [...e.target.files];
      const t = cur && treeById(pickTarget);
      if (!t || !files.length) return;
      toast(files.length > 1 ? `שומר ${files.length} תמונות…` : 'שומר תמונה…', 1500);
      // אחרי צילום: מסך ציור (כמו בטלגרם) לפני שהתמונה נשמרת ונשלחת
      const annotate = id === 'camInput' && files.length === 1 && !Construction.isConstruction(cur) && await DB.getKV('annotateAfter', true);
      for (const f of files) await addPhoto(t, f, annotate);
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

  async function makeThumb(blob) {
    const src = await createImageBitmap(blob);
    const s = Math.min(1, 320 / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * s); c.height = Math.round(src.height * s);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.7));
  }

  // שומר את המקור בצד, ומחליף את התמונה בגרסה עם הסימונים (זו שנכנסת לדוח, לטלגרם ולגוגל דרייב)
  async function applyStrokes(rec, orig, strokes) {
    const blob = strokes.length ? await Annotate.flatten(orig, strokes) : orig;
    return Object.assign({}, rec, { blob, orig: strokes.length ? orig : null, strokes, thumb: await makeThumb(blob) });
  }

  async function editPhoto(t, p) {
    const rec = await DB.getPhoto(p.id);
    if (!rec) return;
    if (!rec.blob) { // התמונה פונתה מהטאבלט: מורידים אותה מגוגל דרייב
      try { rec.blob = await photoBlob(cur, p.id); } catch (e) { toast('לא ניתן לטעון את התמונה מגוגל דרייב: ' + e.message, 4000); return; }
      if (!rec.blob) return;
    }
    const orig = rec.orig || rec.blob;
    const strokes = await Annotate.open(orig, rec.strokes || [], { saveLabel: 'שמור', cancelLabel: 'ביטול' });
    if (!strokes) return;
    await DB.putPhoto(await applyStrokes(rec, orig, strokes));
    const old = thumbUrls.get(p.id);
    if (old) { URL.revokeObjectURL(old); thumbUrls.delete(p.id); }
    p.ver = (p.ver || 0) + 1; // מסמן שצריך להחליף את התמונה בטלגרם ובגוגל דרייב
    // תמונה מהסקר הקודם ששונתה: הופכת לתמונה של הסקר הזה. נשלחת לטלגרם כתמונה חדשה ונשמרת בתיקייה של הסקר הזה,
    // והתמונה הישנה (בטלגרם ובקובץ של הסקר הקודם) לא משתנה
    if (p.fromOld) { delete p.fromOld; delete p.tgMsgId; delete p.tgVer; }
    if (p.odShared) { delete p.odShared; delete p.odId; delete p.odName; delete p.odVer; }
    await saveNow();
    refreshRow(t); renderPhotos();
    Sync.kick(true);
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
      // סקר לבנייה: שדה אחד לתמונה, גם לאקסל (התווית בנספח, למשל 7-9) וגם לטלגרם
      const shared = Construction.isConstruction(cur) && !split;
      const noteIn = shared
        ? h('input', { class: 'in note-in', value: Construction.photoName(t, p), placeholder: 'שם התמונה (מספר העץ, למשל 7-9)', title: 'אוטומטית מספר העץ. אפשר לשנות, למשל 7-9',
            // ריק או בדיוק מספר העץ = אוטומטי (מתעדכן כשמספר העץ משתנה); כל דבר אחר = שם ידני
            oninput: e => { const v = e.target.value.trim(); p.trees = p.note = v === String(t.num || '').trim() ? '' : v; saveSoon(); Sync.kick(); },
            onchange: e => { if (!e.target.value.trim()) e.target.value = Construction.photoName(t, p); } })
        : h('input', { class: 'in note-in', value: p.note || '', placeholder: 'שם / פרטים (לטלגרם בלבד)',
            oninput: e => { p.note = e.target.value; saveSoon(); Sync.kick(); } });
      return h('div', { class: 'ph-card' + (p.inReport ? ' in-report' : '') },
        h('div', { class: 'ph' },
          h('img', { src: url, alt: 'תמונה של עץ ' + Core.photoLabel(t, p), onclick: () => openPhoto(p.id) }),
          h('span', { class: 'sync' },
            p.fromOld ? null : p.tgMsgId ? h('span', { class: 'tg', title: 'גובתה בטלגרם' }, 'TG ✓') : h('span', { class: 'tg pending', title: 'ממתינה לשליחה לטלגרם' }, 'TG …'),
            p.odId ? h('span', { class: 'od', title: 'נשמרה בגוגל דרייב' }, 'GD ✓') : null),
          h('button', { class: 'pen', title: 'סמן על התמונה', 'aria-label': 'סמן על התמונה', onclick: () => editPhoto(t, p) }, '✏️'),
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
        noteIn,
        cur.trees.length > 1 ? h('select', { class: 'in move-sel', 'aria-label': 'העבר את התמונה לעץ אחר', onchange: e => { const to = treeById(e.target.value); if (to) movePhoto(t, p, to); } },
          h('option', { value: '' }, '↔ העבר לעץ אחר…'),
          cur.trees.filter(x => x !== t).map(x => h('option', { value: x.id }, ['עץ', x.num || '(בלי מספר)', x.species].filter(Boolean).join(' ')))) : null);
    }));
    const hint = h('div', { class: 'muted small', style: 'margin-top:6px' },
      'כל התמונות מגובות בטלגרם. רק המסומנות "בדוח" נכנסות לנספח התמונות.');
    box.replaceChildren(h('div', { class: 'photos' }, items), hint);
  }

  // העברת תמונה לעץ אחר (למשל אחרי ייבוא סקר ישן שבו תמונה שויכה לעץ הלא נכון).
  // השם בגוגל דרייב והכיתוב בטלגרם מתעדכנים בסנכרון הבא לפי העץ החדש
  async function movePhoto(from, p, to) {
    const key = Core.groupKey(from, p);
    from.photos = from.photos.filter(x => x !== p);
    Core.ensureReportPhoto(from, key);
    p.sub = null;
    if (Core.splitActive(to)) {
      const nums = Core.expandNum(to.num);
      p.sub = nums.find(n => !to.photos.some(x => x.sub === n)) || nums[0];
    }
    // נכנסת לדוח רק אם לעץ החדש עוד אין תמונה בדוח (למספר הזה)
    p.inReport = !to.photos.some(x => x.inReport && Core.groupKey(to, x) === Core.groupKey(to, p));
    to.photos.push(p);
    await saveNow();
    refreshRow(from); refreshRow(to); renderPhotos();
    Sync.kick(true);
    toast(`התמונה הועברה לעץ ${to.num || to.species || ''}`.trim());
  }

  async function openPhoto(id) {
    let blob;
    try { blob = await photoBlob(cur, id); } catch (e) { toast('לא ניתן לטעון את התמונה מגוגל דרייב: ' + e.message, 4000); return; }
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const ov = h('div', { style: 'position:fixed;inset:0;background:#000;z-index:60;display:flex;align-items:center;justify-content:center', onclick: () => { ov.remove(); URL.revokeObjectURL(url); } },
      h('img', { src: url, style: 'max-width:100%;max-height:100%;object-fit:contain' }));
    document.body.append(ov);
  }

  // ---------- הפקה ----------
  async function renderExport(body) {
    if (Construction.isConstruction(cur)) return renderConstructionExport(body);
    const warns = Core.warnings(cur);
    const rs = Core.reportSlots(cur.trees);
    const status = h('div', { class: 'small muted', role: 'status' });
    const syncBox = h('div', { class: 'small', role: 'status' });
    const finishBox = h('div', { class: 'stack' });
    const tgOn = !!(await DB.getKV('tgChat', ''));
    const odOn = await OD.connected();
    const hm = t => new Date(t).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const drawSync = () => {
      const all = cur.trees.flatMap(t => t.photos || []);
      const tgLeft = all.filter(p => !p.fromOld && !p.tgMsgId).length, odLeft = all.filter(p => !p.odId).length;
      syncBox.replaceChildren(
        h('div', {}, tgOn ? (tgLeft ? `טלגרם: ${tgLeft} מתוך ${all.length} תמונות ממתינות לגיבוי.` : `טלגרם: כל ${all.length} התמונות מגובות.`) : 'טלגרם לא מחובר.'),
        h('div', {}, odOn ? (odLeft ? `גוגל דרייב: ${odLeft} תמונות ממתינות.` : 'גוגל דרייב: התמונות ונתוני הסקר שמורים.') : 'גוגל דרייב לא מחובר.'),
        ...(cur.odReportAt ? [h('div', {}, `אקסל הועלה לגוגל דרייב: ${hm(cur.odReportAt)}`)] : []),
        ...(cur.odPdfAt ? [h('div', {}, `PDF הועלה לגוגל דרייב: ${hm(cur.odPdfAt)}`)] : []),
        ...(Sync.state.error ? [h('div', { style: 'color:var(--danger)' }, Sync.state.error)] : []));
      finishBox.replaceChildren(cur.finished
        ? h('div', { class: 'okbox' }, `✓ הסקר הסתיים ב-${hm(cur.finishedAt)}. האקסל וה-PDF בתיקיית הפרויקט בגוגל דרייב, והתמונות פונו מהטאבלט (הן נטענות מהענן כשצריך).`)
        : cur.finishPending
          ? h('div', { class: 'small' }, Sync.state.offline ? '⏸ אין קליטה. הסקר יעלה לבד (אקסל + PDF) כשהקליטה תחזור.' : '⟳ מעלה את התמונות, ואז את האקסל וה-PDF…')
          : h('div', { class: 'muted small' }, 'מעלה את כל התמונות, ואז שומר אקסל ו-PDF באותה תיקייה בגוגל דרייב ומפנה את התמונות מהטאבלט. בלי קליטה זה יקרה לבד כשהקליטה תחזור.'));
    };
    drawSync();
    const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (err) { console.error(err); status.textContent = 'נכשל: ' + err.message; } finally { btn.disabled = false; drawSync(); } };

    body.append(h('div', { class: 'stack', style: 'max-width:820px;margin:0 auto' },
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'סיום סקר'),
        finishBox,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary big', onclick: async e => {
            const btn = e.currentTarget;
            if (!odOn) { toast('צריך לחבר את גוגל דרייב בהגדרות', 4000); return; }
            if (warns.length && !confirm('יש פרטים חסרים (ראה "בדיקה לפני הפקה" למטה). לסיים בכל זאת?')) return;
            cur.finishPending = true; cur.finished = false;
            const sid = cur.id; Sync.preparing.add(sid);
            await saveNow(); Sync.now(); drawSync();
            // האקסל וה-PDF מוכנים כבר עכשיו בטאבלט, בזמן שהתמונות עולות. ה-PDF נפתח מיד לצפייה ולשליחה
            btn.disabled = true;
            try {
              const s = cur;
              status.textContent = 'מכין אקסל…';
              const x = await buildReport(s);
              await DB.setKV('xlsm:' + s.id, { hash: Sync.hashSurvey(s), blob: x.blob, name: x.name });
              const pdf = await buildPdf(s, (i, n) => { status.textContent = `מכין PDF… עמוד ${i} מתוך ${n}`; });
              status.textContent = Sync.state.offline ? '✓ האקסל וה-PDF מוכנים. יעלו לגוגל דרייב כשהקליטה תחזור.' : '✓ האקסל וה-PDF מוכנים, ועולים עכשיו לגוגל דרייב יחד עם התמונות.';
              if (pdf) viewPdf(s, pdf);
            } catch (err) { console.error(err); status.textContent = 'הכנת הקבצים נכשלה, הם יוכנו בזמן ההעלאה: ' + err.message; }
            finally { Sync.preparing.delete(sid); Sync.now(); btn.disabled = false; drawSync(); }
          } }, cur.finished ? '✔ סיים שוב (אחרי עריכה)' : '✔ סיום סקר'),
          h('button', { class: 'btn big', onclick: e => busy(e.currentTarget, async () => {
            if (!odOn) throw new Error('גוגל דרייב לא מחובר');
            await saveNow();
            status.textContent = 'מעלה אקסל לגוגל דרייב…';
            await Sync.uploadReport(cur);
            status.textContent = '✓ האקסל הועלה לגוגל דרייב (תיקיית הפרויקט בסקרי עצים).';
          }) }, '⬆ העלה אקסל לענן'))),
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'דוח PDF'),
        h('div', { class: 'muted small' }, cur.trees.some(Core.hasContent)
          ? `הסקר המלא כמו באקסל: מכתב, טבלת העצים ונספח תמונות (${Math.min(rs.length, Core.MAX_PRINTED)} תמונות), בלי השורות הצהובות.`
          : 'אין עצים בטבלה, ולכן יוצא מכתב אישור קצר, כמו "אישורי תקינות" בתוכנה במחשב.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary big', onclick: e => busy(e.currentTarget, async () => {
            await saveNow();
            status.textContent = 'מפיק PDF…';
            const s = cur;
            const pdf = await buildPdf(s, (i, n) => { status.textContent = `מפיק PDF… ${i}/${n}`; });
            status.textContent = `✓ ה-PDF מוכן (${pdf.pages} עמודים).`;
            viewPdf(s, pdf);
            if (odOn) {
              status.textContent += ' מעלה לגוגל דרייב…';
              await Sync.uploadPdf(s, pdf);
              status.textContent = `✓ ה-PDF מוכן (${pdf.pages} עמודים) ונשמר גם בגוגל דרייב.`;
            }
          }) }, 'הפק PDF'),
          h('button', { class: 'btn big', onclick: () => exportZip(status) }, 'תמונות בקובץ ZIP')),
        pdfBox(cur),
        status),
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'גיבוי וסנכרון'),
        h('div', { class: 'muted small' }, 'כל שינוי נשמר מיד בטאבלט. נתוני הסקר עולים לגוגל דרייב אחרי כל שינוי, והתמונות לטלגרם ולגוגל דרייב מיד אחרי הצילום.'),
        syncBox,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => { Sync.now(); toast('מגבה עכשיו…'); } }, 'גבה עכשיו'),
          (!tgOn || !odOn) ? h('button', { class: 'btn', onclick: () => go('#/settings') }, 'להגדרות') : null)),
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'שכבת GIS'),
        h('div', { class: 'muted small' }, `${cur.trees.filter(t => t.lat != null).length} עצים עם נ"צ. GeoJSON נפתח ב-QGIS וב-ArcGIS, ו-KML בגוגל ארת'.`),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => deliver(new Blob([Gis.geojson([cur])], { type: 'application/geo+json' }), fileBase() + '.geojson') }, 'GeoJSON'),
          h('button', { class: 'btn', onclick: () => deliver(new Blob([Gis.kml([cur], cur.site)], { type: 'application/vnd.google-earth.kml+xml' }), fileBase() + '.kml') }, 'KML'),
          h('button', { class: 'btn primary', onclick: e => busy(e.currentTarget, async () => {
            await saveNow();
            status.textContent = 'מכין מפה…';
            status.textContent = await shareMap([cur], cur.site || 'סקר עצים');
          }) }, '🗺 מפת עצים לשיתוף'))),
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'בדיקה לפני הפקה'),
        warns.length ? h('ul', { class: 'warn-list' }, warns.map(w => h('li', {}, w))) : h('div', { class: 'okbox' }, 'הכול מלא.'))));
    const off = Sync.onChange(() => { if (!document.body.contains(syncBox)) { if (off) off(); return; } drawSync(); });
  }

  // הפקה לסקר לבנייה: טבלת אקסל, תמונות ו-GIS. "סיום סקר" מעלה את האקסל לגוגל דרייב ומפנה את התמונות
  async function renderConstructionExport(body) {
    const warns = Construction.warnings(cur);
    const status = h('div', { class: 'small muted', role: 'status' });
    const splitStatus = h('div', { class: 'small muted', role: 'status' });
    const odOn = await OD.connected();
    const n = cur.trees.filter(Core.hasContent).length;
    const st = Construction.settingsOf(cur);
    const calc = cur.trees.filter(Core.hasContent).map(t => Construction.compute(t, st));
    const byCat = k => calc.filter(c => c.cat === k).length;
    const totalP = calc.reduce((a, c) => a + (c.P || 0), 0);
    const busy = async (btn, fn, out) => { btn.disabled = true; try { await fn(); } catch (err) { console.error(err); (out || status).textContent = 'נכשל: ' + err.message; } finally { btn.disabled = false; } };
    // אפשרות 2: אקסל הטבלאות או PDF התמונות, כל אחד בנפרד, להורדה או לגוגל דרייב
    const splitAction = (e, kind, drive) => busy(e.currentTarget, async () => {
      if (drive && !odOn) { toast('צריך לחבר את גוגל דרייב בהגדרות', 4000); return; }
      await saveNow();
      const say = m => { splitStatus.textContent = m; };
      const f = kind === 'xlsx' ? await buildTablesFile(cur, say) : await buildPhotosPdfFile(cur, say);
      if (!f) { say('אין תמונות שסומנו לדוח.'); return; }
      if (!drive) { await deliver(f.blob, f.name); say(`✓ הורד: ${f.name}`); return; }
      say(`מעלה לגוגל דרייב: ${f.name}…`);
      const where = await Sync.uploadFile(cur, f.name, f.blob);
      // התיקייה המדויקת ולינק אליה, כדי שלא יצטרכו לחפש
      splitStatus.replaceChildren(
        h('div', {}, `✓ "${f.name}" נשמר בגוגל דרייב בתיקייה "${where.path}".`),
        h('a', { href: 'https://drive.google.com/drive/folders/' + where.folderId, target: '_blank', rel: 'noopener', class: 'btn' }, 'פתח את התיקייה בגוגל דרייב'));
    }, splitStatus);
    const hm = t => new Date(t).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    body.append(h('div', { class: 'stack', style: 'max-width:820px;margin:0 auto' },
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'סיכום'),
        h('div', {}, `${n} עצים · ` + ['גבוה מאוד', 'גבוה', 'בינונית', 'נמוכה'].map(k => `${k}: ${byCat(k)}`).join(' · ')),
        h('div', {}, `סה"כ שווי עצים: ₪${Math.round(totalP).toLocaleString('he-IL')}`),
        h('div', { class: 'muted small' }, 'הסטטוס המוצע (שימור / כריתה / העתקה) ממולא ידנית באקסל, ואז מתעדכנים אזור השורשים והטבלה המסכמת.')),
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'סיום סקר'),
        cur.finished ? h('div', { class: 'okbox' }, `✓ הסקר הסתיים ב-${hm(cur.finishedAt)}. האקסל בתיקיית הפרויקט בגוגל דרייב.`)
          : cur.finishPending ? h('div', { class: 'small' }, '⟳ מעלה את התמונות ואת האקסל…')
          : h('div', { class: 'muted small' }, 'מעלה את כל התמונות, ואז שומר את קובץ האקסל בגוגל דרייב ומפנה את התמונות מהטאבלט.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary big', onclick: async () => {
            if (!odOn) { toast('צריך לחבר את גוגל דרייב בהגדרות', 4000); return; }
            if (warns.length && !confirm('יש פרטים חסרים (ראה "בדיקה לפני הפקה" למטה). לסיים בכל זאת?')) return;
            cur.finishPending = true; cur.finished = false;
            await saveNow(); Sync.now(); go(`#/s/${cur.id}/export`);
            toast(Sync.state.offline ? 'אין קליטה. יעלה לבד כשהקליטה תחזור' : 'מעלה לגוגל דרייב…', 3000);
          } }, cur.finished ? '✔ סיים שוב (אחרי עריכה)' : '✔ סיום סקר'))),
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'הורדת קבצים'),
        h('div', { class: 'muted small' }, 'התבנית "סקר עצים להיתר בניה" עם כל העצים וההגדרות, והנוסחאות שלה מחשבות את השאר. אפשר לבחור באחת משתי הדרכים:'),
        // אפשרות 1: אקסל אחד עם התמונות בנספח
        h('div', { class: 'card stack', style: 'background:var(--surface-2)' },
          h('b', {}, '1. אקסל עם התמונות'),
          h('div', { class: 'muted small' }, 'קובץ אחד: הטבלאות, ובנספח התמונות שסומנו לדוח ליד מספר העץ.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary big', onclick: e => busy(e.currentTarget, async () => {
              await saveNow();
              status.textContent = 'מכין את האקסל…';
              const withPhotos = Object.assign({}, cur, { cset: Object.assign({}, Construction.settingsOf(cur), { embedPhotos: true }) });
              const r = await buildReport(withPhotos);
              await deliver(r.blob, r.name);
              status.textContent = '✓ האקסל עם התמונות הורד.';
              if (odOn) { status.textContent += ' מעלה לגוגל דרייב…'; await Sync.uploadReport(cur); status.textContent = '✓ האקסל עם התמונות הורד ונשמר גם בגוגל דרייב.'; }
            }) }, 'הורד אקסל עם התמונות')),
          status),
        // אפשרות 2: אקסל של הטבלאות + PDF של התמונות
        h('div', { class: 'card stack', style: 'background:var(--surface-2)' },
          h('b', {}, '2. אקסל בלי תמונות, ו-PDF של התמונות בנפרד'),
          h('div', { class: 'muted small' }, 'כל קובץ לבד: האקסל בלי התמונות, או PDF של התמונות שסומנו לדוח (6 בעמוד, עם מספר העץ מעל כל תמונה).'),
          // כל קובץ לבד (לפי ori: שלא יהיו תלויים אחד בשני)
          h('div', { class: 'row' },
            h('button', { class: 'btn primary big', onclick: e => splitAction(e, 'xlsx', false) }, 'הורד אקסל בלי תמונות'),
            h('button', { class: 'btn primary big', onclick: e => splitAction(e, 'pdf', false) }, 'הורד PDF תמונות')),
          h('div', { class: 'row' },
            h('button', { class: 'btn big', onclick: e => splitAction(e, 'xlsx', true) }, 'שמור אקסל בגוגל דרייב'),
            h('button', { class: 'btn big', onclick: e => splitAction(e, 'pdf', true) }, 'שמור PDF בגוגל דרייב')),
          splitStatus),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => exportZip(status) }, 'כל התמונות בקובץ ZIP'))),
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'שכבת GIS'),
        h('div', { class: 'muted small' }, `${cur.trees.filter(t => t.lat != null).length} עצים עם נ"צ.`),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => deliver(new Blob([Gis.geojson([cur])], { type: 'application/geo+json' }), fileBase() + '.geojson') }, 'GeoJSON'),
          h('button', { class: 'btn', onclick: () => deliver(new Blob([Gis.kml([cur], cur.site)], { type: 'application/vnd.google-earth.kml+xml' }), fileBase() + '.kml') }, 'KML'),
          h('button', { class: 'btn primary', onclick: e => busy(e.currentTarget, async () => {
            await saveNow();
            status.textContent = 'מכין מפה…';
            status.textContent = await shareMap([cur], cur.site || 'סקר עצים');
          }) }, '🗺 מפת עצים לשיתוף'))),
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'בדיקה לפני הפקה'),
        warns.length ? h('ul', { class: 'warn-list' }, warns.map(w => h('li', {}, w))) : h('div', { class: 'okbox' }, 'הכול מלא.'))));
  }

  async function templateBytes() {
    const res = await fetch('template/survey.xltm');
    if (!res.ok) throw new Error('לא נמצאה התבנית');
    return new Uint8Array(await res.arrayBuffer());
  }

  function fileBase(s) {
    s = s || cur;
    // שני סקרים עם אותו שם ותאריך (באותה תיקיית פרויקט) מקבלים שמות קבצים שונים
    const k = (s.odFolderK || 1) > 1 ? ' - ' + s.odFolderK : '';
    if (Construction.isConstruction(s)) return safeName(`סקר עצים לבנייה - ${s.site || 'ללא שם'} - ${fmtDate(s.date).replace(/\//g, '.')}${k}`);
    // סקר בטיחות (כללים של ori):
    // עריכה של קובץ מהארכיון / סקר ישן שיובא: אותו שם כמו בדרייב
    const orig = (s.source && s.source.file) || (s.imported && s.odSrcName);
    if (orig) return safeName(orig.replace(/\.xls[xm]?$/i, ''));
    const proj = s.project || '';
    // ויצו: סמל_התאריך בעוד שנה מיום הסקר_26
    if (/ויצ"?ו/.test(proj) && s.code) {
      const d = new Date((s.date || today()) + 'T12:00'); d.setFullYear(d.getFullYear() + 1);
      return safeName(`${s.code}_${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}_${String(d.getDate()).padStart(2, '0')}_26`) + k;
    }
    // ירושלים: סמל מוסד, שם מוסד וכתובת בלי עיר. אחרים: שם מוסד, כתובת ועיר
    const parts = /ירושלים/.test(proj) ? [s.code, s.siteName, s.street] : [s.siteName, s.street, s.city];
    return safeName(parts.filter(Boolean).join(' ') || s.site || 'סקר בטיחות עצים') + k;
  }

  async function deliver(blob, name) {
    const file = new File([blob], shareName(name), { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && await DB.getKV('shareFiles', false)) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  // בונה את קובץ האקסל של סקר (משמש גם להורדה וגם לגוגל דרייב)
  async function buildReport(s) {
    if (Construction.isConstruction(s)) {
      const res = await fetch('template/construction.xltm');
      if (!res.ok) throw new Error('לא נמצאה תבנית סקר הבנייה');
      const bytes = await Construction.buildWorkbook(new Uint8Array(await res.arrayBuffer()), s, id => photoBlob(s, id));
      return { blob: new Blob([bytes], { type: 'application/vnd.ms-excel.sheet.macroEnabled.12' }), name: fileBase(s) + '.xlsm', placed: 0 };
    }
    const r = await SurveyExcel.buildWorkbook(await templateBytes(), s, async id => {
      const p = await DB.getPhoto(id);
      const blob = await photoBlob(s, id);
      return blob ? { blob, w: p && p.w, h: p && p.h } : null;
    }, { embedPhotos: true });
    return { blob: new Blob([r.bytes], { type: 'application/vnd.ms-excel.sheet.macroEnabled.12' }), name: fileBase(s) + '.xlsm', placed: r.placed };
  }

  // סקר לבנייה, טבלאות ותמונות בנפרד: אקסל בלי תמונות + PDF של התמונות שסומנו לדוח (באותו סדר ובאותן תוויות כמו בנספח באקסל)
  async function buildTablesFile(s, say) {
    say('מכין את האקסל בלי התמונות…');
    const res = await fetch('template/construction.xltm');
    if (!res.ok) throw new Error('לא נמצאה תבנית סקר הבנייה');
    const noPhotos = Object.assign({}, s, { cset: Object.assign({}, Construction.settingsOf(s), { embedPhotos: false }) });
    const bytes = await Construction.buildWorkbook(new Uint8Array(await res.arrayBuffer()), noPhotos, () => null);
    return { name: fileBase(s) + ' - טבלאות.xlsm', blob: new Blob([bytes], { type: 'application/vnd.ms-excel.sheet.macroEnabled.12' }) };
  }
  // PDF של התמונות שסומנו לדוח (באותו סדר ובאותן תוויות כמו בנספח באקסל). null כשאין תמונות
  async function buildPhotosPdfFile(s, say) {
    const items = Construction.photoSlots(s.trees).map(sl => ({ label: sl.label, id: sl.photo.id }));
    if (!items.length) return null;
    const pdf = await ReportPrint.photosPdf(items, id => photoBlob(s, id), (i, n) => say(`מכין PDF של התמונות… ${i}/${n}`));
    // שם הקובץ לפי ori: "תמונות" ושם הפרויקט (הכתובת של הסקר)
    return { name: safeName(`תמונות - ${s.site || s.project || 'סקר עצים לבנייה'}`) + '.pdf', blob: pdf };
  }

  // דוח PDF (אותו שם כמו האקסל, כדי שיופיעו אחד ליד השני בגוגל דרייב)
  async function buildPdf(s, onProgress) {
    if (Construction.isConstruction(s)) return null; // בסקר לבנייה יש רק אקסל
    const r = await ReportPrint.toPdf(s, id => photoBlob(s, id), onProgress);
    const pdf = { blob: r.blob, name: fileBase(s) + '.pdf', pages: r.pages, html: r.html };
    // ה-PDF האחרון של כל סקר נשמר בטאבלט, כדי שאפשר יהיה לפתוח ולשלוח אותו מתוך האפליקציה
    try { await DB.setKV('pdf:' + s.id, Object.assign({ at: Date.now(), hash: Sync.hashSurvey(s) }, pdf)); pdfChanged(s.id); } catch (_) {}
    return pdf;
  }
  const pdfListeners = new Set();
  function pdfChanged(id) { for (const f of [...pdfListeners]) f(id); }

  // ---------- צפייה ב-PDF ושליחה ----------
  // מייל / וואטסאפ: אתר לא יכול לצרף קובץ ישירות למייל או לוואטסאפ, אז נפתח חלון השיתוף של אנדרואיד עם הקובץ מצורף,
  // ובוחרים בו את Gmail או את וואטסאפ. את הבחירה האחרונה אנדרואיד מציג ראשונה
  async function sharePdf(s, pdf, via) {
    const file = new File([pdf.blob], shareName(pdf.name), { type: 'application/pdf' });
    // לפי ori: נושא = "סקר עצים <השנה שבה נשלח> <שם הגן> <כתובת> <עיר>", בגוף: שורה ריקה ואז "רצ"ב סקר עצים וחשבונית לתשלום"
    const place = Core.placeOf(s);
    const where = [s.siteName, s.street, s.city].filter(Boolean).join(' ') || [place.name, place.address].filter(Boolean).join(' ') || s.site || '';
    const subject = `סקר עצים ${new Date().getFullYear()} ${where}`.trim();
    const body = '\nרצ"ב סקר עצים וחשבונית לתשלום';
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      // בוואטסאפ אין נושא, אז הנושא נכנס כשורה ראשונה בהודעה
      const data = { files: [file], title: subject, text: via === 'mail' ? body : subject + '\n' + body };
      try { await navigator.share(data); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    // אין שיתוף קבצים בדפדפן הזה: מורידים את הקובץ, ובמייל פותחים הודעה חדשה עם נושא (את הקובץ מצרפים מההורדות)
    downloadFile(pdf.blob, pdf.name);
    if (via === 'mail') location.href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    toast('הקובץ הורד. צרף אותו מתיקיית ההורדות.', 5000);
  }
  // בחירת תיקייה בגוגל דרייב לחיפוש בארכיון: נכנסים לתיקיות ובוחרים
  async function pickDriveFolder() {
    if (!navigator.onLine) { toast('אין קליטה'); return; }
    const stack = [{ id: null, name: 'הדרייב שלי' }];
    const list = h('div', { class: 'stack', style: 'max-height:55vh;overflow:auto' });
    const title = h('b', {});
    const close = () => ov.remove();
    const choose = h('button', { class: 'btn primary', onclick: async () => {
      const cur = stack[stack.length - 1];
      await DB.setKV('gdArchive', cur.id ? { id: cur.id, name: stack.slice(1).map(x => x.name).join(' / ') } : null);
      close(); renderSettings();
    } }, 'בחר את התיקייה הזו');
    const draw = async () => {
      const cur = stack[stack.length - 1];
      title.textContent = stack.map(x => x.name).join(' / ');
      list.replaceChildren(h('div', { class: 'muted small' }, 'טוען…'));
      try {
        const folders = (await OD.children(cur.id)).filter(x => x.folder);
        list.replaceChildren(...[
          stack.length > 1 ? h('button', { class: 'btn', onclick: () => { stack.pop(); draw(); } }, '⬆ חזרה') : null,
          ...folders.map(x => h('button', { class: 'btn', style: 'justify-content:flex-start', onclick: () => { stack.push({ id: x.id, name: x.name }); draw(); } }, '📁 ' + x.name)),
          folders.length ? null : h('div', { class: 'muted small' }, 'אין כאן תתי תיקיות')].filter(Boolean));
      } catch (e) { list.replaceChildren(h('div', {}, (e instanceof OD.AuthError ? 'צריך להתחבר לגוגל דרייב. ' : 'נכשל: ') + e.message)); }
    };
    const ov = h('div', { style: 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px' },
      h('div', { class: 'card stack', style: 'width:min(560px,100%)' },
        h('div', { class: 'muted small' }, 'הסקרים הישנים יחופשו רק בתיקייה שתבחר ובכל התיקיות שבתוכה'),
        title, list, h('div', { class: 'row' }, choose, h('button', { class: 'btn', onclick: close }, 'ביטול'))));
    document.body.append(ov);
    draw();
  }

  function downloadFile(blob, name) {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  async function viewPdf(s, pdf) {
    // PDF חדש (וקטורי): מציגים את העמודים מה-HTML שממנו נוצר. PDF ישן (תמונות): מחלצים את התמונות
    const view = pdf.html ? PdfVec.view(pdf.html, { rootId: 'printRoot' }) : null;
    const urls = view ? [] : (await ReportPrint.pdfPages(pdf.blob)).map(b => URL.createObjectURL(b));
    const close = () => { ov.remove(); urls.forEach(u => URL.revokeObjectURL(u)); if (view) view.cleanup(); window.removeEventListener('hashchange', close); };
    window.addEventListener('hashchange', close);
    const ov = h('div', { class: 'pdfv' },
      h('div', { class: 'annot-bar' },
        h('button', { class: 'txt', onclick: close }, 'סגור'),
        h('span', { class: 'sp pdfv-title' }, `${pdf.pages} עמודים`),
        h('button', { class: 'txt', onclick: () => sharePdf(s, pdf, 'mail') }, '✉ מייל'),
        h('button', { class: 'txt', onclick: () => sharePdf(s, pdf, 'whatsapp') }, 'וואטסאפ'),
        h('button', { class: 'txt', title: 'הורדה', 'aria-label': 'הורדה', onclick: () => downloadFile(pdf.blob, pdf.name) }, '⬇')),
      view || h('div', { class: 'pdfv-pages' }, urls.map((u, i) => h('img', { src: u, alt: `עמוד ${i + 1}` }))));
    document.body.append(ov);
  }

  // בלשונית הפקת דוח: ה-PDF האחרון של הסקר (גם זה שנוצר ב"סיום סקר"), עם צפייה ושליחה
  function pdfBox(s) {
    const box = h('div', { class: 'stack' });
    let drawn = false;
    const draw = async () => {
      if (drawn && !box.isConnected) { pdfListeners.delete(onCh); return; }
      drawn = true;
      const pdf = await DB.getKV('pdf:' + s.id, null);
      if (!pdf || !pdf.blob) { box.replaceChildren(); return; }
      const hm = new Date(pdf.at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const stale = pdf.hash !== Sync.hashSurvey(s);
      box.replaceChildren(
        h('div', { class: 'small' }, `PDF אחרון: ${hm}, ${pdf.pages} עמודים.`, stale ? h('span', { style: 'color:var(--danger)' }, ' הסקר השתנה מאז. לחץ "הפק PDF" כדי לעדכן.') : null),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => viewPdf(s, pdf) }, '👁 הצג PDF'),
          h('button', { class: 'btn', onclick: () => sharePdf(s, pdf, 'mail') }, '✉ שלח במייל'),
          h('button', { class: 'btn', onclick: () => sharePdf(s, pdf, 'whatsapp') }, 'שלח בוואטסאפ')));
    };
    const onCh = id => { if (id === s.id) draw(); };
    pdfListeners.add(onCh);
    draw();
    return box;
  }

  async function exportZip(status) {
    await saveNow();
    status.textContent = 'אורז את התמונות…';
    try {
      const zip = new JSZip();
      const used = new Set();
      // מספור כמו בנספח: עם תמונות בקובץ, לפי התמונות שסומנו; בלי, לפי משבצות התבנית
      // סקר לבנייה: שם הקובץ = מספר העץ, כמו הנתיב בתבנית (Pictures\<מספר>.jpg)
      const seenN = new Map();
      const constructionName = sl => {
        const n = Construction.pictureName(sl.label).replace(/[\\/:*?"<>|]/g, '_') || 'x';
        const k = (seenN.get(n) || 0) + 1; seenN.set(n, k);
        return k === 1 ? n : `${n}_${k}`;
      };
      const pairs = Construction.isConstruction(cur) ? Construction.photoSlots(cur.trees).map(sl => [constructionName(sl), sl.photo])
        : true ? Core.reportSlots(cur.trees).map(sl => [sl.index, sl.photo])
        : Core.slotsOf(cur.trees).map(sl => [sl.index, Core.photoForSlot(sl)]);
      for (const [n, p] of pairs) {
        if (!p) continue;
        const b = await photoBlob(cur, p.id);
        if (b) { zip.file(n + '.jpg', b); used.add(p.id); }
      }
      // שאר התמונות בתיקייה extra, לפי מספר העץ (שמות באנגלית כדי שווינדוס יפתח את ה-ZIP בלי ג'יבריש)
      for (const t of Core.sortTrees(cur.trees)) {
        let k = 1;
        for (const p of t.photos || []) {
          if (used.has(p.id)) continue;
          const b = await photoBlob(cur, p.id);
          if (b) zip.file(`extra/tree_${String(t.num || 'x').replace(/[^0-9,-]+/g, '') || 'x'}${p.sub ? '_' + p.sub : ''}_${k++}.jpg`, b);
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
    const annotateAfter = chk('annotateAfter', true, 'אחרי צילום לפתוח מסך סימון על התמונה (קווים וחצים)');
    annotateAfter.firstChild.checked = await DB.getKV('annotateAfter', true);
    const inAppCamera = chk('inAppCamera', true, 'מצלמה מהירה בתוך האפליקציה (צילום ברצף). כבוי = אפליקציית המצלמה של המכשיר');
    inAppCamera.firstChild.checked = await DB.getKV('inAppCamera', true);
    const curOrient = await DB.getKV('orientLock', 'start');
    const orientSel = h('select', { class: 'in', onchange: async e => { await DB.setKV('orientLock', e.target.value); applyOrientation(); toast('נשמר'); } },
      [['start', 'נעול בכיוון שבו האפליקציה נפתחה'], ['portrait', 'תמיד לאורך'], ['landscape', 'תמיד לרוחב'], ['any', 'מסתובב עם הטאבלט']]
        .map(([v, l]) => h('option', { value: v, selected: v === curOrient ? '' : null }, l)));
    const shareFiles = chk('shareFiles', false, 'במקום הורדה, לפתוח את תפריט השיתוף (לשליחה לדרייב, וואטסאפ וכו\')');
    shareFiles.firstChild.checked = await DB.getKV('shareFiles', false);
    const speciesTa = h('textarea', { class: 'in', style: 'min-height:140px' });
    speciesTa.value = (await DB.getKV('species', null) || SPECIES_SEED).join('\n');
    const cNotesTa = h('textarea', { class: 'in', style: 'min-height:110px' });
    cNotesTa.value = (await DB.getKV('constructionNotes', null) || CONSTRUCTION_NOTES_SEED).join('\n');
    const phrasesTa = h('textarea', { class: 'in', style: 'min-height:140px' });
    phrasesTa.value = (await DB.getKV('phrases', null) || PHRASE_SEED).join('\n');
    const backupStatus = h('div', { class: 'small', role: 'status' });
    const odClientIn = h('input', { class: 'in', value: await OD.clientId(), dir: 'ltr', placeholder: '1234567890-xxxx.apps.googleusercontent.com', autocomplete: 'off' });
    const odSecretIn = h('input', { class: 'in', value: await OD.clientSecret(), dir: 'ltr', placeholder: 'GOCSPX-…', autocomplete: 'off' });
    const hasSecret = !!(await OD.clientSecret());
    // פרטי החיבור לגוגל מוסתרים; נפתחים רק בלחיצה על "החלף" (או כשעוד אין סוד במכשיר הזה)
    const credBox = h('div', { class: 'stack', hidden: hasSecret },
      field('מזהה הלקוח מגוגל (Client ID). מובנה באפליקציה, משנים רק אם יוצרים לקוח חדש', odClientIn),
      field('הסוד מגוגל (Client secret). מקלידים פעם אחת בכל מכשיר', odSecretIn));
    const credLine = h('div', { class: 'row small' },
      h('span', {}, 'פרטי החיבור לגוגל: ' + (hasSecret ? 'שמורים במכשיר' : 'חסר הסוד (Client secret)')),
      h('button', { class: 'btn', onclick: () => { credBox.hidden = !credBox.hidden; } }, 'החלף'));
    const archive = await DB.getKV('gdArchive', null);
    const archLine = h('div', { class: 'row small' },
      h('span', {}, 'תיקיית הארכיון לחיפוש סקרים ישנים: ', h('b', {}, archive ? archive.name : 'כל הדרייב')),
      h('button', { class: 'btn', onclick: () => pickDriveFolder() }, 'בחר תיקייה'),
      archive ? h('button', { class: 'btn', onclick: async () => { await DB.setKV('gdArchive', null); renderSettings(); } }, 'כל הדרייב') : null);
    const odRootIn = h('input', { class: 'in', value: await DB.getKV('odRoot', 'סקרי עצים') });
    const odConnected = await OD.connected();
    const odUser = await DB.getKV('odUser', '');
    const odStatus = h('div', { class: 'small', role: 'status' },
      Sync.state.odNeedsLogin ? 'צריך להתחבר מחדש.' : odConnected ? `✓ מחובר${odUser ? ' כ-' + odUser : ''}` : '');

    app.replaceChildren(
      bar('הגדרות', '#/'),
      h('main', { class: 'stack', style: 'max-width:820px;margin:0 auto' },
        h('div', { class: 'card stack' },
          h('h2', { style: 'margin:0;font-size:20px' }, 'בוט טלגרם'),
          h('ol', { class: 'small', style: 'margin:0;padding-inline-start:20px' },
            h('li', {}, 'פותחים בוט חדש לגיבוי ב-BotFather (/newbot) ומדביקים כאן את הטוקן שלו. אפשר להדביק את כל ההודעה של BotFather.'),
            h('li', {}, 'שולחים לבוט בטלגרם הודעה כלשהי, למשל /start, מהחשבון או מהקבוצה שאליה התמונות צריכות להגיע.'),
            h('li', {}, 'לוחצים "חבר".')),
          field('טוקן הבוט', tokenIn),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', onclick: async () => {
              // הטוקן נראה כך: 123456789:AAH...  מחלצים אותו גם מתוך הודעה שלמה של BotFather או עם רווחים
              const raw = tokenIn.value;
              const mt = raw.match(/\d{6,12}:[A-Za-z0-9_-]{30,}/) || raw.replace(/\s+/g, '').match(/\d{6,12}:[A-Za-z0-9_-]{35}/);
              if (!mt) { tgStatus.textContent = raw ? 'זה לא נראה כמו טוקן. טוקן נראה כך: 123456789:AAH... (מספר, נקודתיים, אותיות)' : ''; return; }
              const tk = mt[0];
              tokenIn.value = tk;
              tgStatus.textContent = 'בודק…';
              try {
                const me = await TG.getMe(tk);
                const c = await TG.findChat(tk);
                if (!c) { tgStatus.textContent = `הבוט @${me.username} תקין, אבל לא מצאתי הודעה אליו. שלח לו /start ולחץ שוב.`; return; }
                await DB.setKV('tgToken', tk); await DB.setKV('tgChat', c.id); await DB.setKV('tgChatName', c.name || '');
                Sync.settingsChanged(); // אותו טוקן בכל המכשירים
                await TG.sendText(tk, c.id, '✓ אפליקציית סקר העצים מחוברת. כל תמונה שמצלמים באפליקציה תגובה לכאן.');
                Sync.kick(true);
                tgStatus.textContent = `✓ מחובר לצ'אט: ${c.name || c.id} דרך @${me.username}`;
              } catch (e) { tgStatus.textContent = 'החיבור נכשל: ' + e.message; }
            } }, 'חבר'),
            token ? h('button', { class: 'btn', onclick: async () => {
              if (!confirm('לנתק את הטלגרם בכל המכשירים?')) return;
              await DB.setKV('tgToken', ''); await DB.setKV('tgChat', ''); await DB.setKV('tgChatName', ''); Sync.settingsChanged(); renderSettings();
            } }, 'נתק') : null),
          h('div', { class: 'muted small' }, 'הטוקן נשמר גם בגוגל דרייב, כך שבכל מכשיר שמתחבר לגוגל דרייב הטלגרם מתחבר לבד. החלפת טוקן כאן מעדכנת את כל המכשירים.'),
          tgStatus),
        h('div', { class: 'card stack' },
          h('h2', { style: 'margin:0;font-size:20px' }, 'גוגל דרייב'),
          h('div', { class: 'muted small' }, 'אקסל ו-PDF נשמרים בתיקיית הדוחות, תיקייה לכל פרויקט. הנתונים, התמונות וההגדרות המשותפות נשמרים בתיקייה "גיבוי אפליקציית סקרי עצים".'),
          odStatus,
          credLine, credBox,
          archLine,
          field('תיקיית הדוחות בגוגל דרייב (אקסל ו-PDF; הגיבוי נשמר בנפרד ב"גיבוי אפליקציית סקרי עצים")', odRootIn),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', onclick: async () => {
              // מזהה זהה למובנה לא נשמר, כדי שעדכון של המזהה המובנה יגיע לכל המכשירים
              const cid = odClientIn.value.trim();
              await DB.setKV('gdClientId', cid === OD.defaultClientId ? '' : cid); await DB.setKV('gdClientSecret', odSecretIn.value.trim());
              if (!odSecretIn.value.trim()) { credBox.hidden = false; odSecretIn.focus(); odStatus.textContent = 'הדבק את הסוד (Client secret) מגוגל ולחץ שוב.'; return; } await DB.setKV('odRoot', odRootIn.value.trim() || 'סקרי עצים');

              if (!navigator.onLine) { odStatus.textContent = 'צריך קליטה כדי להתחבר.'; return; }
              await saveNow();
              try { await OD.beginLogin(); } catch (e) { odStatus.textContent = e.message; }
            } }, odConnected && !Sync.state.odNeedsLogin ? 'התחבר מחדש' : 'התחבר לגוגל דרייב'),
            odConnected ? h('button', { class: 'btn', onclick: async () => { await OD.logout(); renderSettings(); } }, 'נתק') : null,
            h('button', { class: 'btn', onclick: async () => { await DB.setKV('odRoot', odRootIn.value.trim() || 'סקרי עצים'); toast('נשמר'); } }, 'שמור תיקייה'))),
        h('div', { class: 'card stack' },
          h('h2', { style: 'margin:0;font-size:20px' }, 'עבודה בשטח'),
          inAppCamera, annotateAfter, shareFiles, field('כיוון המסך באפליקציה', orientSel)),
        h('div', { class: 'card stack' },
          h('h2', { style: 'margin:0;font-size:20px' }, 'רשימות בחירה'),
          h('div', { class: 'muted small' }, 'שורה לכל פריט. ההערות מתחת לשדה ההערות הן רק מה שכתוב כאן (בלי למידה מהסקרים). למיני העצים האפליקציה מוסיפה גם מינים שכבר כתבת בסקרי בטיחות.'),
          field('מיני עצים', speciesTa),
          field('הערות וטיפול מומלץ בסקר בטיחות (כפתורים מתחת להערות)', phrasesTa),
          field('הערות בסקר לבנייה (כפתורים מתחת להערות)', cNotesTa),
          h('button', { class: 'btn primary', onclick: async () => {
            const lines = ta => ta.value.split('\n').map(s => s.trim()).filter(Boolean);
            await DB.setKV('species', lines(speciesTa)); await DB.setKV('phrases', lines(phrasesTa)); await DB.setKV('constructionNotes', lines(cNotesTa)); refreshSuggestions();
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
      if (d && d.blob) { // תמונות שפונו מהטאבלט כבר נמצאות בגוגל דרייב
        zip.file('photos/' + p.id + '.jpg', d.blob); n++;
        if (d.orig) zip.file('photos/' + p.id + '.orig.jpg', d.orig);
        if (d.strokes && d.strokes.length) zip.file('photos/' + p.id + '.strokes.json', JSON.stringify(d.strokes));
      }
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
          const of = zip.file('photos/' + p.id + '.orig.jpg'), sf = zip.file('photos/' + p.id + '.strokes.json');
          const orig = of ? new Blob([await of.async('uint8array')], { type: 'image/jpeg' }) : null;
          const strokes = sf ? JSON.parse(await sf.async('string')) : null;
          await DB.putPhoto({ id: p.id, blob, orig, strokes, thumb: null, w: p.w, h: p.h });
        }
        await DB.putSurvey(s); added++;
      }
      toast(`שוחזרו ${added} סקרים` + (skipped ? `, ${skipped} דולגו` : ''), 4000);
    } catch (err) { toast('השחזור נכשל: ' + err.message, 4000); }
  });

  // ---------- הפעלה ----------
  window.addEventListener('pagehide', saveNow);
  // יציאה מהאפליקציה (מסך כבוי, מעבר לאפליקציה אחרת): שומר מיד בטאבלט ומעלה את נתוני הסקר
  // מקלדת מספרים: מקש "הבא" במקלדת עובר לשדה הבא, כמו Tab במחשב
  const isNumField = el => el && el.tagName === 'INPUT' && (el.type === 'number' || ['numeric', 'decimal'].includes(el.getAttribute('inputmode')));
  const nextField = el => {
    // בתוך חלון קופץ: רק השדות שבו
    const all = [...(el.closest('.modal') || document).querySelectorAll('input, textarea')].filter(x =>
      !['checkbox', 'radio', 'file', 'button', 'hidden', 'date', 'search'].includes(x.type) && !x.disabled && !x.readOnly && x.offsetParent !== null);
    return all[all.indexOf(el) + 1] || null;
  };
  document.addEventListener('focusin', e => {
    if (isNumField(e.target)) e.target.setAttribute('enterkeyhint', nextField(e.target) ? 'next' : 'done');
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || !isNumField(e.target) || e.target.getAttribute('enterkeyhint') !== 'next') return;
    const n = nextField(e.target);
    if (!n) return;
    e.preventDefault();
    n.focus();
    if (n.select && n.tagName === 'INPUT') try { n.select(); } catch (_) {}
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { saveNow(); if (cur) Sync.now(); } });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  // כיוון מסך: באנדרואיד האפליקציה המותקנת לא תמיד מצייתת לנעילת הסיבוב של המכשיר, אז נועלים מתוך האפליקציה.
  // 'start' = הכיוון שבו האפליקציה נפתחה (ברירת מחדל), 'portrait' / 'landscape' קבוע, 'any' = מסתובבת חופשי
  async function applyOrientation() {
    const so = screen.orientation;
    if (!so || !so.lock) return;
    const mode = await DB.getKV('orientLock', 'start');
    try {
      if (mode === 'any') so.unlock();
      else await so.lock(mode === 'start' ? (so.type.startsWith('portrait') ? 'portrait' : 'landscape') : mode);
    } catch (_) {} // בדפדפן רגיל (לא אפליקציה מותקנת) אי אפשר לנעול
  }
  applyOrientation();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  // מעבר מ-OneDrive לגוגל דרייב (פעם אחת): מזהי הקבצים של OneDrive לא תקפים בדרייב, אז הסקרים שבטאבלט יעלו מחדש לדרייב.
  // מה שכבר ב-OneDrive נשאר שם ולא נמחק
  async function moveToGdrive() {
    if ((await DB.getKV('storage', '')) === 'gdrive') return;
    for (const s of await DB.allSurveys()) {
      for (const k of Object.keys(s)) if (/^od/.test(k) && k !== 'odLayout') delete s[k];
      for (const t of s.trees || []) for (const p of t.photos || []) {
        const d = await DB.getPhoto(p.id);
        if (d && d.blob) { delete p.odId; delete p.odName; delete p.odVer; delete p.odShared; } // תעלה מחדש לדרייב
        else if (p.odId) p.odShared = true; // כבר פונתה מהטאבלט: נשארת רק ב-OneDrive
      }
      s.finishPending = s.finishPending || false;
      await DB.putSurvey(s, false);
    }
    for (const k of ['odAuth', 'odUser', 'importedSrc', 'importLog']) await DB.delKV(k);
    await DB.setKV('storage', 'gdrive');
  }
  moveToGdrive().catch(() => {}).then(() => OD.handleRedirect()).then(r => {
    if (r) { toast(r.ok ? '✓ מחובר לגוגל דרייב' : 'החיבור לגוגל דרייב נכשל: ' + r.message, 4000); Sync.state.odNeedsLogin = false; }
    route();
    Sync.kick(true);
    setTimeout(() => { ReportPrint.preloadFonts(); getLayoutWarm(); }, 2000);
  });
  function getLayoutWarm() { fetch('template/layout.json').catch(() => {}); }
})();

// אפליקציית סקר בטיחות עצים לטאבלט
(function () {
  'use strict';
  const APP_VERSION = '1.8.0';

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

  // תמונה מלאה: מהטאבלט, ואם כבר פונתה אחרי "סיום סקר" — מ-OneDrive
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
    if (hash.startsWith('#/settings')) return renderSettings();
    return renderHome();
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  function bar(title, back, ...right) {
    return h('header', { class: 'bar' },
      back ? h('button', { class: 'icon-btn', 'aria-label': 'חזרה', onclick: () => go(back) }, '→') : null,
      back ? homeBtn() : null,
      h('h1', {}, title), h('button', { class: 'sync-pill icon-btn', id: 'syncPill', onclick: () => go('#/health') }, syncText()), ...right,
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
    buildReport, buildPdf,
  };

  // ---------- מסך הבית ----------
  let projectFilter = null;
  async function renderHome() {
    const app = $('#app');
    // במסך הבית: רק סקרים שעבדו עליהם היום, וכל סקר שעוד לא גובה במלואו לענן (כדי שלא ייעלם לפני שעלה).
    // סקרים קודמים נמצאים ב"חיפוש סקרים בענן"
    const all = (await DB.allSurveys()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const odOn = await OD.connected();
    const surveys = all.filter(s => dayOf(s.updated || s.created) === today() || !inCloud(s, odOn));
    const hiddenN = all.length - surveys.length;
    cleanupOld(all.filter(s => !surveys.includes(s)));
    const projects = [...new Set(surveys.map(s => s.project || ''))].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, 'he'));
    if (projectFilter != null && !projects.includes(projectFilter)) projectFilter = null;
    const card = s => {
      const n = s.trees.filter(Core.hasContent).length;
      const ph = s.trees.reduce((a, t) => a + (t.photos || []).length, 0);
      return h('div', { class: 'card survey-item', role: 'button', tabindex: 0, onclick: () => go('#/s/' + s.id) },
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { class: 't' }, s.site || 'סקר ללא שם', Construction.isConstruction(s) ? h('span', { class: 'badge type-badge' }, 'לבנייה') : null),
          h('div', { class: 'muted small' }, [s.code ? 'סמל ' + s.code : null, fmtDate(s.date)].filter(Boolean).join(' · ')),
          h('div', { class: 'small' }, `${n} עצים · ${ph} תמונות` + (s.finished ? ' · ✓ הסתיים, בענן' : s.finishPending ? ' · ממתין להעלאה' : ''))),
        h('span', { class: 'muted', 'aria-hidden': 'true' }, '←'));
    };
    const shown = projectFilter == null ? projects : [projectFilter];
    const list = surveys.length ? shown.map(pr => h('section', {},
      h('h2', { class: 'proj-head' }, (pr || 'ללא פרויקט') + ` (${surveys.filter(s => (s.project || '') === pr).length})`),
      h('div', { class: 'grid-list' }, surveys.filter(s => (s.project || '') === pr).map(card))))
      : h('div', { class: 'empty' }, all.length ? 'אין סקרים מהיום. סקרים קודמים נמצאים ב"חיפוש סקרים בענן".' : 'עוד אין סקרים. לחץ על "סקר חדש" כדי להתחיל.');
    const chips = projects.length > 1 ? h('div', { class: 'project-chips', role: 'group', 'aria-label': 'סינון לפי פרויקט' },
      h('button', { class: 'chip' + (projectFilter == null ? ' on' : ''), onclick: () => { projectFilter = null; renderHome(); } }, 'כל הפרויקטים'),
      projects.map(pr => h('button', { class: 'chip' + (projectFilter === pr ? ' on' : ''), onclick: () => { projectFilter = pr; renderHome(); } }, pr || 'ללא פרויקט'))) : null;

    app.replaceChildren(
      bar('סקרי עצים', null, h('button', { class: 'icon-btn', onclick: () => go('#/settings') }, '⚙ הגדרות')),
      h('main', { class: 'stack' },
        h('div', { class: 'row' },
          h('button', { class: 'btn primary big', style: 'flex:1', onclick: newSurvey }, '+ סקר חדש'),
          h('button', { class: 'btn big', style: 'flex:1', onclick: () => go('#/cloud') }, '🔎 חיפוש סקרים בענן'),
          h('button', { class: 'btn big', style: 'flex:1', onclick: () => go('#/summary') }, '🌲 אורנים ומפות')),
        chips, list,
        hiddenN ? h('div', { class: 'muted small', style: 'text-align:center' }, `עוד ${hiddenN} סקרים מימים קודמים שמורים בענן. `,
          h('a', { href: '#/cloud' }, 'לחיפוש סקרים בענן')) : null,
        h('p', { class: 'muted small', style: 'text-align:center', id: 'homeFoot' }, 'סקר פתוח נשמר בטאבלט (כדי לעבוד גם בלי קליטה) ומגובה לטלגרם ול-OneDrive. אחרי "סיום סקר" התמונות מפונות מהטאבלט ונשארות בענן. גרסה ' + APP_VERSION)));
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => {
      const el = $('#homeFoot'); if (el && e.usage != null) el.append(` · בשימוש בטאבלט: ${(e.usage / 1048576).toFixed(0)} MB`);
    }).catch(() => {});
  }

  const dayOf = t => { const d = new Date(t || 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // הסקר כולו בענן: נתונים ותמונות ב-OneDrive (ובטלגרם אם מחובר), בלי "סיום סקר" שממתין
  function inCloud(s, odOn) {
    if (!odOn) return false;
    if (s.finishPending || s.odDataHash !== Sync.hashSurvey(s)) return false;
    return Sync.allInCloud(s);
  }
  // סקרים מימים קודמים שכבר בענן: התמונות המלאות מפונות מהטאבלט (הנתונים עצמם קטנים ונשארים)
  let cleaning = false; const freedIds = new Set();
  async function cleanupOld(list) {
    if (cleaning) return; cleaning = true;
    try { for (const s of list) if (!freedIds.has(s.id)) { await Sync.freeLocal(s); freedIds.add(s.id); } } catch (_) {} finally { cleaning = false; }
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
        { value: 'new', primary: true, label: `כן, סקר חדש בתאריך ${fmtDate(t)}`, hint: 'העצים מועתקים בלי התמונות (למשל סקר חוזר)' },
        { value: 'newPhotos', label: `כן, סקר חדש בתאריך ${fmtDate(t)} עם התמונות` },
      ]);
      if (choice !== 'keep') {
        const n = await copySurvey(s, choice === 'newPhotos');
        toast(`נפתח סקר חדש בתאריך ${fmtDate(t)}. הסקר מ-${fmtDate(s.date)} נשאר כמו שהוא.`, 4000);
        return n;
      }
      s.dateAskedDay = t;
    }
    // עריכה ביום אחר מהעריכה האחרונה: הגרסה שבענן נשמרת קודם כגרסה קודמת
    if (s.updated && dayOf(s.updated) !== t && s.odDataId && !s.snapshotFrom) s.snapshotFrom = dayOf(s.updated);
    await DB.putSurvey(s);
    return s;
  }

  // סקר חדש להיום על בסיס סקר קיים. withPhotos: התמונות מועתקות (בטאבלט, או קישור לקובץ שכבר ב-OneDrive)
  async function copySurvey(old, withPhotos) {
    const keep = ['num', 'species', 'notes', 'urgency', 'pines', 'split', 'lat', 'lon', 'acc', 'gpsTime', 'gpsSrc', ...Construction.FIELDS];
    const s = { id: uid(), type: Construction.typeOf(old), project: old.project || '', siteName: old.siteName != null ? old.siteName : (old.site || ''), street: old.street || '', city: old.city || '',
      code: old.code || '', manager: old.manager || '', date: today(), created: Date.now(), prev: { id: old.id, date: old.date }, odLayout: 2, trees: [] };
    for (const t of old.trees || []) {
      const nt = Object.assign({ id: uid(), photos: [], created: Date.now() }, Object.fromEntries(keep.filter(k => t[k] !== undefined).map(k => [k, t[k]])));
      if (withPhotos) for (const p of t.photos || []) {
        const np = Object.assign({}, p, { id: uid() });
        delete np.odName; // שם הקובץ בתיקייה החדשה ייקבע מחדש
        const d = await DB.getPhoto(p.id);
        if (d && d.blob) { delete np.odId; delete np.odVer; await DB.putPhoto(Object.assign({}, d, { id: np.id })); } // יעלה לתיקיית הסקר החדש
        else if (p.odId) await DB.putPhoto({ id: np.id, thumb: d && d.thumb, w: p.w, h: p.h, cloud: true }); // נשאר בענן, נטען כשצריך
        else continue;
        nt.photos.push(np);
      }
      s.trees.push(nt);
    }
    s.site = composeSite(s);
    await DB.putSurvey(s);
    return s;
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
      [odOn, odOn ? 'OneDrive מחובר' : 'OneDrive לא מחובר: הסקרים לא מגובים לענן'],
      [!st.odNeedsLogin, st.odNeedsLogin ? 'OneDrive: צריך להתחבר מחדש (בהגדרות)' : 'ההתחברות ל-OneDrive תקפה'],
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
            h('tr', {}, h('th', {}, 'סקר'), h('th', {}, 'נתונים בענן'), h('th', {}, 'תמונות ב-OneDrive'), h('th', {}, 'תמונות בטלגרם'), h('th', {}, 'אקסל / PDF')),
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
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    return leafletP || (leafletP = new Promise((res, rej) => {
      document.head.append(h('link', { rel: 'stylesheet', href: 'vendor/leaflet/leaflet.css' }));
      const sc = h('script', { src: 'vendor/leaflet/leaflet.js' });
      sc.onload = res; sc.onerror = () => { leafletP = null; rej(new Error('טעינת המפה נכשלה')); };
      document.head.append(sc);
    }));
  }
  // תצלומי אוויר: גוגל (הכי חד בישראל) ו-Bing (ב-zoom עמוק ממשיך להגדיל את התמונה האחרונה במקום להיעלם)
  const LAYERS = {
    'גוגל – לוויין': ['https://mt{s}.google.com/vt/lyrs=y&hl=iw&x={x}&y={y}&z={z}', { subdomains: '0123', maxZoom: 22, maxNativeZoom: 21, attribution: '© Google' }],
    'Bing – תצלום אוויר': ['bing', { maxZoom: 22, maxNativeZoom: 19, attribution: '© Microsoft' }],
    'גוגל – מפה': ['https://mt{s}.google.com/vt/lyrs=m&hl=iw&x={x}&y={y}&z={z}', { subdomains: '0123', maxZoom: 22, maxNativeZoom: 21, attribution: '© Google' }],
  };
  function tileLayer(url, o) {
    const L = window.L;
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
  // כל הסקרים שעלו ל-OneDrive, מכל מכשיר. אפשר לפתוח סקר כמו שהוא, או להתחיל ממנו סקר חדש (למשל בשנה הבאה)
  let cloudCache = null;
  async function renderCloud() {
    const app = $('#app');
    const q = h('input', { class: 'in', type: 'search', placeholder: 'סמל מוסד, שם, רחוב, עיר או פרויקט', style: 'font-size:18px' });
    const list = h('div', { class: 'stack' });
    const msg = h('div', { class: 'muted small', role: 'status' });
    app.replaceChildren(bar('חיפוש סקרים בענן', '#/'), h('main', { class: 'stack', style: 'max-width:820px;margin:0 auto' }, q, msg, list));
    if (!(await OD.connected())) { msg.textContent = 'צריך לחבר את OneDrive בהגדרות כדי לחפש בענן.'; return; }
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
          h('button', { class: 'btn', onclick: ev => local.has(e.id) ? go('#/s/' + e.id) : fromCloud(e, false, ev.currentTarget) }, local.has(e.id) ? 'פתח (נמצא בטאבלט)' : 'פתח את הסקר הזה')))));
    };
    q.addEventListener('input', draw);
    draw();
    msg.textContent = 'טוען מהענן…';
    try { cloudCache = await Sync.cloudIndex(); draw(); setTimeout(() => q.focus(), 50); }
    catch (e) { msg.textContent = (e instanceof OD.AuthError ? 'צריך להתחבר מחדש ל-OneDrive בהגדרות. ' : 'הטעינה נכשלה: ') + e.message; }
  }

  // asNew=true: סקר חדש עם אותם פרטי מוסד ואותם עצים (מספר, מין, הערות, אורנים, נ"צ), בתאריך של היום ובלי תמונות
  async function fromCloud(e, asNew, btn) {
    btn.disabled = true;
    try {
      if (!e.dataId) throw new Error('לסקר הזה אין עדיין נתונים בענן');
      const blob = await OD.download(e.dataId);
      if (!blob) throw new Error('קובץ נתוני הסקר לא נמצא ב-OneDrive');
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
      const s = await copySurvey(old, false);
      toast(`נפתח סקר חדש על בסיס הסקר מ-${fmtDate(old.date)}. עדכן את העצים והוסף תמונות.`, 5000);
      go('#/s/' + s.id + '/details');
    } catch (err) { toast('נכשל: ' + err.message, 5000); }
    finally { btn.disabled = false; }
  }

  // ---------- אורנים ומפות: סיכום על פני כמה סקרים ----------
  // תמונה ממוזערת לעץ במפה: מהטאבלט אם יש, אחרת מ-OneDrive
  async function mapThumb(s, p) {
    const rec = await DB.getPhoto(p.id);
    if (rec && (rec.thumb || rec.blob)) return rec.thumb || await makeThumb(rec.blob);
    return p.odId && navigator.onLine && await OD.connected() ? OD.thumb(p.odId) : null;
  }
  // מפה כדף אינטרנט אחד: מורידים/משתפים, ונשמרת גם בתיקיית הפרויקט ב-OneDrive. מחזיר הודעה למשתמש
  async function shareMap(surveys, title, onProgress) {
    const r = await Reports.mapHtml(surveys, title, mapThumb);
    if (!r.points) throw new Error('אין עצים עם נ"צ בסקרים שנבחרו');
    const name = safeName(`מפת עצים - ${title} - ${fmtDate(today()).replace(/\//g, '.')}`) + '.html';
    await deliver(r.blob, name);
    let msg = `✓ המפה הורדה: ${r.points} עצים` + (r.noGps ? ` (${r.noGps} עצים בלי נ"צ לא מופיעים)` : '') + '. אפשר לשלוח את הקובץ בוואטסאפ או במייל, והוא נפתח בכל דפדפן.';
    const saved = await saveSummaryToCloud(surveys, name, r.blob);
    if (saved) msg += ` נשמרה גם ב-OneDrive: ${saved}.`;
    return msg;
  }
  // קובץ סיכום לתיקיית הדוחות ב-OneDrive (תיקיית הפרויקט אם כולם מאותו פרויקט)
  async function saveSummaryToCloud(surveys, name, blob) {
    try {
      if (!navigator.onLine || !(await OD.connected())) return '';
      const root = await OD.folder(null, (await DB.getKV('odRoot', 'סקרי עצים')) || 'סקרי עצים');
      const projects = [...new Set(surveys.map(s => s.project || 'ללא פרויקט'))];
      const dir = projects.length === 1 ? await OD.folder(root, projects[0]) : root;
      await OD.upload(dir, name, blob, true);
      const path = ((await DB.getKV('odRoot', 'סקרי עצים')) || 'סקרי עצים') + (projects.length === 1 ? '/' + projects[0] : '');
      Sync.log('ok', 'קובץ סיכום נשמר ב-OneDrive: ' + name);
      return path;
    } catch (e) { Sync.log('error', 'שמירת קובץ סיכום ב-OneDrive נכשלה: ' + e.message); return ''; }
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
      if (saved) m += ` נשמר גם ב-OneDrive: ${saved}.`;
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
          opt('construction', '🏗 ' + Construction.TYPES.construction, 'גובה, קוטר, ערכיות 0-20 והמלצה: שימור / העתקה / כריתה'),
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

  // שם המוסד, רחוב ועיר נשמרים בנפרד, ובכותרת הדוח (F9) מופיעים יחד: "שם, רחוב, עיר"
  const composeSite = s => [s.siteName, s.street, s.city].map(x => (x || '').trim()).filter(Boolean).join(', ');
  function migrateSite(s) {
    if (s.siteName == null && s.street == null && s.city == null) { s.siteName = s.site || ''; s.street = ''; s.city = ''; }
  }

  function field(label, input) { return h('div', {}, h('label', { class: 'f' }, label), input); }

  function renderDetails(body) {
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
      field('סוג הסקר', h('select', { class: 'in', onchange: e => { cur.type = e.target.value; saveSoon(); } },
        Object.entries(Construction.TYPES).map(([k, v]) => h('option', { value: k, selected: Construction.typeOf(cur) === k ? '' : null }, v)))),
      field('פרויקט (למשל: ירושלים)', inp('project', { list: 'projectList', placeholder: 'לניהול וסינון הסקרים, לא מופיע בדוח' })),
      field('שם המוסד / האתר', inp('siteName', { placeholder: 'למשל: גן חצב' })),
      h('div', { class: 'row', style: 'align-items:stretch' },
        h('div', { style: 'flex:2;min-width:200px' }, field('רחוב ומספר', inp('street', { list: 'streetList', placeholder: 'למשל: הנרקיס 5' }))),
        h('div', { style: 'flex:1;min-width:160px' }, field('עיר', inp('city', { list: 'cityList', placeholder: 'למשל: ירושלים' })))),
      h('div', { class: 'muted small' }, 'בכותרת הדוח: שם המוסד בשורה הראשונה, ומתחתיו רחוב ועיר.'),
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
    const pineMissing = !Construction.isConstruction(cur) && Core.isPine(t.species) && (t.pines == null || t.pines === '');
    return h('button', { class: 'tree-row' + (t.id === curTreeId ? ' on' : ''), 'data-id': t.id, onclick: () => selectTree(t.id) },
      h('span', { class: 'n' }, t.num || '—'),
      h('span', { style: 'min-width:0' },
        h('div', { class: 'sp' }, t.species || 'ללא מין'),
        h('div', { class: 'meta' }, t.notes || '')),
      h('span', { class: 'badges' },
        Construction.isConstruction(cur) ? (t.rec ? h('span', { class: 'badge rec-' + t.rec }, t.rec) : null)
          : t.urgency ? h('span', { class: 'badge u-' + t.urgency }, t.urgency) : null,
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
    const spIn = h('input', { class: 'in', value: t.species || '', list: 'speciesList', 'aria-label': 'מין עץ',
      oninput: e => { t.species = e.target.value; markPine(); changed(); if (e.inputType === 'insertReplacementText' || !e.inputType) askPines(); },
      onchange: askPines });
    markPine();
    const spChips = h('div', { class: 'chips' }, sug.speciesTop.map(s => h('button', { class: 'chip', type: 'button',
      onclick: () => { t.species = s; spIn.value = s; markPine(); changed(); askPines(); } }, s)));

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
    const gpsBox = h('span', { class: 'gps-inline', id: 'gpsBox' });
    renderGps(t, gpsBox);

    const photosBox = h('div', { id: 'photosBox' });
    const build = Construction.isConstruction(cur) ? constructionFields(t, changed) : null;

    pane.replaceChildren(
      h('datalist', { id: 'speciesList' }, sug.speciesAll.map(s => h('option', { value: s }))),
      h('div', { class: 'card stack' },
        h('div', { class: 'grid2' },
          h('div', {}, field('מספר העץ', numIn), splitWrap),
          h('div', {}, field('מין עץ', spIn))),
        spChips,
        build ? null : pineWrap,
        build,
        field(build ? 'הערות' : 'הערות וטיפול מומלץ', notesIn),
        notesChips,
        build ? null : field('דחיפות', seg),
        h('div', {},
          h('label', { class: 'f' }, 'תמונות'),
          h('div', { class: 'row', style: 'margin-bottom:10px' },
            h('button', { class: 'btn primary big', onclick: takePhotos }, '📷 צלם'),
            h('button', { class: 'btn big', onclick: () => pickPhoto('galInput') }, '🖼 מהגלריה'),
            gpsBox),
          photosBox),
        h('div', { class: 'row', style: 'justify-content:space-between;margin-top:20px' },
          h('button', { class: 'btn danger', onclick: deleteTree }, 'מחק עץ'),
          h('button', { class: 'btn primary', onclick: addTree }, '+ עץ הבא'))));
    renderPhotos();
  }

  // סקר לבנייה: מידות, ניקוד 0-5 בארבעה מדדים (סה"כ ערכיות 0-20) והמלצה
  function constructionFields(t, changed) {
    const totalBox = h('div', { class: 'value-box', role: 'status' });
    const showTotal = () => {
      const n = Construction.total(t);
      totalBox.replaceChildren(n == null ? h('span', { class: 'muted' }, 'ערכיות: ממלאים את ארבעת הציונים')
        : h('span', {}, 'ערכיות ', h('b', {}, n + '/20'), ' · ', h('b', {}, Construction.category(n))));
      totalBox.dataset.cat = Construction.category(n);
    };
    showTotal();
    const measure = ([k, label]) => field(label, h('input', { class: 'in', inputmode: 'decimal', value: t[k] == null ? '' : t[k],
      oninput: e => { t[k] = e.target.value.trim(); changed(); } }));
    const score = ([k, label]) => {
      const seg = h('div', { class: 'seg score', role: 'group', 'aria-label': label }, [0, 1, 2, 3, 4, 5].map(v =>
        h('button', { type: 'button', class: String(t[k]) === String(v) ? 'on' : '', onclick: e => {
          t[k] = String(t[k]) === String(v) ? null : v; changed(); showTotal();
          [...seg.children].forEach(b => b.classList.toggle('on', b === e.currentTarget && t[k] != null));
        } }, String(v))));
      return field(label, seg);
    };
    const recSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'המלצה' }, Construction.RECS.map(r =>
      h('button', { type: 'button', class: t.rec === r ? 'on' : '', onclick: e => {
        t.rec = t.rec === r ? '' : r; changed();
        [...recSeg.children].forEach(b => b.classList.toggle('on', b === e.currentTarget && !!t.rec));
      } }, r)));
    return h('div', { class: 'stack' },
      h('div', { class: 'grid4' }, Construction.MEASURES.map(measure)),
      h('div', { class: 'grid2 scores' }, Construction.SCORES.map(score)),
      totalBox,
      field('המלצה', recSeg));
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
      } }, t._gpsBusy ? '📍 מאתר…' : has ? `📍 נ"צ ✓${t.acc != null ? ` ±${Math.round(t.acc)}מ'` : t.gpsSrc === 'map' ? ' (מפה)' : ''}` : '📍 נ"צ'),
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
      np.inReport = !t.photos.some(x => Core.groupKey(t, x) === Core.groupKey(t, np));
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
      const annotate = await DB.getKV('annotateAfter', true);
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
      const annotate = id === 'camInput' && files.length === 1 && await DB.getKV('annotateAfter', true);
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

  // שומר את המקור בצד, ומחליף את התמונה בגרסה עם הסימונים (זו שנכנסת לדוח, לטלגרם ול-OneDrive)
  async function applyStrokes(rec, orig, strokes) {
    const blob = strokes.length ? await Annotate.flatten(orig, strokes) : orig;
    return Object.assign({}, rec, { blob, orig: strokes.length ? orig : null, strokes, thumb: await makeThumb(blob) });
  }

  async function editPhoto(t, p) {
    const rec = await DB.getPhoto(p.id);
    if (!rec) return;
    if (!rec.blob) { // התמונה פונתה מהטאבלט: מורידים אותה מ-OneDrive
      try { rec.blob = await photoBlob(cur, p.id); } catch (e) { toast('לא ניתן לטעון את התמונה מ-OneDrive: ' + e.message, 4000); return; }
      if (!rec.blob) return;
    }
    const orig = rec.orig || rec.blob;
    const strokes = await Annotate.open(orig, rec.strokes || [], { saveLabel: 'שמור', cancelLabel: 'ביטול' });
    if (!strokes) return;
    await DB.putPhoto(await applyStrokes(rec, orig, strokes));
    const old = thumbUrls.get(p.id);
    if (old) { URL.revokeObjectURL(old); thumbUrls.delete(p.id); }
    p.ver = (p.ver || 0) + 1; // מסמן שצריך להחליף את התמונה בטלגרם וב-OneDrive
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
      const noteIn = h('input', { class: 'in note-in', value: p.note || '', placeholder: 'שם / פרטים (לטלגרם בלבד)',
        oninput: e => { p.note = e.target.value; saveSoon(); Sync.kick(); } });
      return h('div', { class: 'ph-card' + (p.inReport ? ' in-report' : '') },
        h('div', { class: 'ph' },
          h('img', { src: url, alt: 'תמונה של עץ ' + Core.photoLabel(t, p), onclick: () => openPhoto(p.id) }),
          h('span', { class: 'sync' },
            p.tgMsgId ? h('span', { class: 'tg', title: 'גובתה בטלגרם' }, 'TG ✓') : h('span', { class: 'tg pending', title: 'ממתינה לשליחה לטלגרם' }, 'TG …'),
            p.odId ? h('span', { class: 'od', title: 'נשמרה ב-OneDrive' }, 'OD ✓') : null),
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
        noteIn);
    }));
    const hint = h('div', { class: 'muted small', style: 'margin-top:6px' },
      'כל התמונות מגובות בטלגרם. רק המסומנות "בדוח" נכנסות לנספח התמונות.');
    box.replaceChildren(h('div', { class: 'photos' }, items), hint);
  }

  async function openPhoto(id) {
    let blob;
    try { blob = await photoBlob(cur, id); } catch (e) { toast('לא ניתן לטעון את התמונה מ-OneDrive: ' + e.message, 4000); return; }
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
      const tgLeft = all.filter(p => !p.tgMsgId).length, odLeft = all.filter(p => !p.odId).length;
      syncBox.replaceChildren(
        h('div', {}, tgOn ? (tgLeft ? `טלגרם: ${tgLeft} מתוך ${all.length} תמונות ממתינות לגיבוי.` : `טלגרם: כל ${all.length} התמונות מגובות.`) : 'טלגרם לא מחובר.'),
        h('div', {}, odOn ? (odLeft ? `OneDrive: ${odLeft} תמונות ממתינות.` : 'OneDrive: התמונות ונתוני הסקר שמורים.') : 'OneDrive לא מחובר.'),
        ...(cur.odReportAt ? [h('div', {}, `אקסל הועלה ל-OneDrive: ${hm(cur.odReportAt)}`)] : []),
        ...(cur.odPdfAt ? [h('div', {}, `PDF הועלה ל-OneDrive: ${hm(cur.odPdfAt)}`)] : []),
        ...(Sync.state.error ? [h('div', { style: 'color:var(--danger)' }, Sync.state.error)] : []));
      finishBox.replaceChildren(cur.finished
        ? h('div', { class: 'okbox' }, `✓ הסקר הסתיים ב-${hm(cur.finishedAt)}. האקסל וה-PDF בתיקיית הפרויקט ב-OneDrive, והתמונות פונו מהטאבלט (הן נטענות מהענן כשצריך).`)
        : cur.finishPending
          ? h('div', { class: 'small' }, Sync.state.offline ? '⏸ אין קליטה. הסקר יעלה לבד (אקסל + PDF) כשהקליטה תחזור.' : '⟳ מעלה את התמונות, ואז את האקסל וה-PDF…')
          : h('div', { class: 'muted small' }, 'מעלה את כל התמונות, ואז שומר אקסל ו-PDF באותה תיקייה ב-OneDrive ומפנה את התמונות מהטאבלט. בלי קליטה זה יקרה לבד כשהקליטה תחזור.'));
    };
    drawSync();
    const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (err) { console.error(err); status.textContent = 'נכשל: ' + err.message; } finally { btn.disabled = false; drawSync(); } };

    body.append(h('div', { class: 'stack', style: 'max-width:820px;margin:0 auto' },
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'סיום סקר'),
        finishBox,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary big', onclick: async e => {
            if (!odOn) { toast('צריך לחבר את OneDrive בהגדרות', 4000); return; }
            if (warns.length && !confirm('יש פרטים חסרים (ראה "בדיקה לפני הפקה" למטה). לסיים בכל זאת?')) return;
            cur.finishPending = true; cur.finished = false;
            await saveNow(); Sync.now(); drawSync();
            toast(Sync.state.offline ? 'אין קליטה. יעלה לבד כשהקליטה תחזור' : 'מעלה ל-OneDrive…', 3000);
          } }, cur.finished ? '✔ סיים שוב (אחרי עריכה)' : '✔ סיום סקר'),
          h('button', { class: 'btn big', onclick: e => busy(e.currentTarget, async () => {
            if (!odOn) throw new Error('OneDrive לא מחובר');
            await saveNow();
            status.textContent = 'מעלה אקסל ל-OneDrive…';
            await Sync.uploadReport(cur);
            status.textContent = '✓ האקסל הועלה ל-OneDrive (תיקיית הפרויקט בסקרי עצים).';
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
            const pdf = await buildPdf(cur, (i, n) => { status.textContent = `מפיק PDF… עמוד ${i} מתוך ${n}`; });
            await deliver(pdf.blob, pdf.name);
            status.textContent = `✓ ה-PDF הורד (${pdf.pages} עמודים).`;
            if (odOn) {
              status.textContent += ' מעלה ל-OneDrive…';
              await Sync.uploadPdf(cur, pdf);
              status.textContent = `✓ ה-PDF הורד (${pdf.pages} עמודים) ונשמר גם ב-OneDrive.`;
            }
          }) }, 'הפק PDF'),
          h('button', { class: 'btn big', onclick: () => exportZip(status) }, 'תמונות בקובץ ZIP')),
        status),
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'גיבוי וסנכרון'),
        h('div', { class: 'muted small' }, 'כל שינוי נשמר מיד בטאבלט. נתוני הסקר עולים ל-OneDrive אחרי כל שינוי, והתמונות לטלגרם ול-OneDrive מיד אחרי הצילום.'),
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

  // הפקה לסקר לבנייה: טבלת אקסל, תמונות ו-GIS. "סיום סקר" מעלה את האקסל ל-OneDrive ומפנה את התמונות
  async function renderConstructionExport(body) {
    const warns = Construction.warnings(cur);
    const status = h('div', { class: 'small muted', role: 'status' });
    const odOn = await OD.connected();
    const n = cur.trees.filter(Core.hasContent).length;
    const by = r => cur.trees.filter(Core.hasContent).filter(t => t.rec === r).length;
    const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (err) { console.error(err); status.textContent = 'נכשל: ' + err.message; } finally { btn.disabled = false; } };
    const hm = t => new Date(t).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    body.append(h('div', { class: 'stack', style: 'max-width:820px;margin:0 auto' },
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'סיכום'),
        h('div', {}, `${n} עצים · ` + Construction.RECS.map(r => `${r}: ${by(r)}`).join(' · ')),
        h('div', { class: 'muted small' }, 'נוסח הדוח לסקר לבנייה (PDF) יתווסף כשתגיע תבנית. בינתיים: טבלת אקסל, תמונות ושכבת GIS.')),
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'סיום סקר'),
        cur.finished ? h('div', { class: 'okbox' }, `✓ הסקר הסתיים ב-${hm(cur.finishedAt)}. האקסל בתיקיית הפרויקט ב-OneDrive.`)
          : cur.finishPending ? h('div', { class: 'small' }, '⟳ מעלה את התמונות ואת האקסל…')
          : h('div', { class: 'muted small' }, 'מעלה את כל התמונות, ואז שומר את טבלת האקסל ב-OneDrive ומפנה את התמונות מהטאבלט.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary big', onclick: async () => {
            if (!odOn) { toast('צריך לחבר את OneDrive בהגדרות', 4000); return; }
            if (warns.length && !confirm('יש פרטים חסרים (ראה "בדיקה לפני הפקה" למטה). לסיים בכל זאת?')) return;
            cur.finishPending = true; cur.finished = false;
            await saveNow(); Sync.now(); go(`#/s/${cur.id}/export`);
            toast(Sync.state.offline ? 'אין קליטה. יעלה לבד כשהקליטה תחזור' : 'מעלה ל-OneDrive…', 3000);
          } }, cur.finished ? '✔ סיים שוב (אחרי עריכה)' : '✔ סיום סקר'))),
      h('div', { class: 'card stack' },
        h('h2', { style: 'margin:0;font-size:20px' }, 'טבלת עצים'),
        h('div', { class: 'muted small' }, 'מס\' עץ, מין, גובה, גזעים, קוטר גזע וחופה, ניקוד, ערכיות, המלצה, הערות ונ"צ.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary big', onclick: e => busy(e.currentTarget, async () => {
            await saveNow();
            const r = await buildReport(cur);
            await deliver(r.blob, r.name);
            status.textContent = '✓ האקסל הורד.';
            if (odOn) { status.textContent += ' מעלה ל-OneDrive…'; await Sync.uploadReport(cur); status.textContent = '✓ האקסל הורד ונשמר גם ב-OneDrive.'; }
          }) }, 'הורד אקסל'),
          h('button', { class: 'btn big', onclick: () => exportZip(status) }, 'תמונות בקובץ ZIP')),
        status),
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
    const kind = Construction.isConstruction(s) ? 'סקר עצים לבנייה' : 'סקר בטיחות עצים';
    return safeName(`${kind} - ${s.site || 'ללא שם'} - ${fmtDate(s.date).replace(/\//g, '.')}${(s.odFolderK || 1) > 1 ? ' - ' + s.odFolderK : ''}`);
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
    if (Construction.isConstruction(s)) return { blob: await Construction.xlsx(s), name: fileBase(s) + '.xlsx', placed: 0 };
    const r = await SurveyExcel.buildWorkbook(await templateBytes(), s, async id => {
      const p = await DB.getPhoto(id);
      const blob = await photoBlob(s, id);
      return blob ? { blob, w: p && p.w, h: p && p.h } : null;
    }, { embedPhotos: true });
    return { blob: new Blob([r.bytes], { type: 'application/vnd.ms-excel.sheet.macroEnabled.12' }), name: fileBase(s) + '.xlsm', placed: r.placed };
  }

  // דוח PDF (אותו שם כמו האקסל, כדי שיופיעו אחד ליד השני ב-OneDrive)
  async function buildPdf(s, onProgress) {
    if (Construction.isConstruction(s)) return null; // הדוח לבנייה עוד לא מוגדר
    const r = await ReportPrint.toPdf(s, id => photoBlob(s, id), onProgress);
    return { blob: r.blob, name: fileBase(s) + '.pdf', pages: r.pages };
  }

  async function exportZip(status) {
    await saveNow();
    status.textContent = 'אורז את התמונות…';
    try {
      const zip = new JSZip();
      const used = new Set();
      // מספור כמו בנספח: עם תמונות בקובץ, לפי התמונות שסומנו; בלי, לפי משבצות התבנית
      const pairs = true ? Core.reportSlots(cur.trees).map(sl => [sl.index, sl.photo])
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
    const shareFiles = chk('shareFiles', false, 'במקום הורדה, לפתוח את תפריט השיתוף (לשליחה לדרייב, וואטסאפ וכו\')');
    shareFiles.firstChild.checked = await DB.getKV('shareFiles', false);
    const speciesTa = h('textarea', { class: 'in', style: 'min-height:140px' });
    speciesTa.value = (await DB.getKV('species', null) || SPECIES_SEED).join('\n');
    const phrasesTa = h('textarea', { class: 'in', style: 'min-height:140px' });
    phrasesTa.value = (await DB.getKV('phrases', null) || PHRASE_SEED).join('\n');
    const backupStatus = h('div', { class: 'small', role: 'status' });
    const odClientIn = h('input', { class: 'in', value: await OD.clientId(), dir: 'ltr', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', autocomplete: 'off' });
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
          h('div', { class: 'muted small' }, 'הטוקן נשמר גם ב-OneDrive, כך שבכל מכשיר שמתחבר ל-OneDrive הטלגרם מתחבר לבד. החלפת טוקן כאן מעדכנת את כל המכשירים.'),
          tgStatus),
        h('div', { class: 'card stack' },
          h('h2', { style: 'margin:0;font-size:20px' }, 'OneDrive'),
          h('div', { class: 'muted small' }, 'אקסל ו-PDF נשמרים בתיקיית הדוחות, תיקייה לכל פרויקט. הנתונים, התמונות וההגדרות המשותפות נשמרים בתיקייה "גיבוי אפליקציית סקרי עצים".'),
          field('מזהה האפליקציה ב-Microsoft (Client ID)', odClientIn),
          field('תיקיית הדוחות ב-OneDrive (אקסל ו-PDF; הגיבוי נשמר בנפרד ב"גיבוי אפליקציית סקרי עצים")', odRootIn),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', onclick: async () => {
              await DB.setKV('odClientId', odClientIn.value.trim()); await DB.setKV('odRoot', odRootIn.value.trim() || 'סקרי עצים');

              if (!navigator.onLine) { odStatus.textContent = 'צריך קליטה כדי להתחבר.'; return; }
              await saveNow();
              try { await OD.beginLogin(); } catch (e) { odStatus.textContent = e.message; }
            } }, odConnected && !Sync.state.odNeedsLogin ? 'התחבר מחדש' : 'התחבר ל-OneDrive'),
            odConnected ? h('button', { class: 'btn', onclick: async () => { await OD.logout(); renderSettings(); } }, 'נתק') : null,
            h('button', { class: 'btn', onclick: async () => { await DB.setKV('odRoot', odRootIn.value.trim() || 'סקרי עצים'); toast('נשמר'); } }, 'שמור תיקייה')),
          odStatus),
        h('div', { class: 'card stack' },
          h('h2', { style: 'margin:0;font-size:20px' }, 'עבודה בשטח'),
          inAppCamera, annotateAfter, shareFiles),
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
      if (d && d.blob) { // תמונות שפונו מהטאבלט כבר נמצאות ב-OneDrive
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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { saveNow(); if (cur) Sync.now(); } });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  OD.handleRedirect().then(r => {
    if (r) { toast(r.ok ? '✓ מחובר ל-OneDrive' : 'החיבור ל-OneDrive נכשל: ' + r.message, 4000); Sync.state.odNeedsLogin = false; }
    route();
    Sync.kick(true);
    setTimeout(() => { ReportPrint.preloadFonts(); getLayoutWarm(); }, 2000);
  });
  function getLayoutWarm() { fetch('template/layout.json').catch(() => {}); }
})();

// כישורים לעבודות (1.184.0, ori): כל מה שמיוחד לעבודה אחת (למשל "ירושלים כללי", "ויצו") במקום אחד בהגדרות.
// כישור = שם, הסברים, לאיזה קובץ / פרויקט הוא שייך, עמודות שהקובץ צריך (חובה / ייחודי / מספרי) וכללים שאפשר להדליק.
// ההתנהגויות עצמן כתובות בקוד (worklists.js, app.js); הכישור קובע אם הן פועלות ברשימה שמשויך אליה (l.skill).
// רשימה בלי כישור עובדת כמו קודם (לפי המילים בשם הפרויקט / הרשימה).
// נשמר ב-KV jobSkills ובקובץ "הגדרות משותפות.json" (sync.js), מיזוג לפי כישור: מה שעודכן אחרון מנצח (גם מחיקה).
(function (root) {
  'use strict';
  const U = () => root.App.ui;
  const clean = v => String(v == null ? '' : v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  // להשוואת כותרות ומילים: בלי גרשיים וסימנים (קב"ט = קבט)
  const norm = v => clean(v).replace(/["'׳״“”‘’`]/g, '').replace(/[.,;:()\-–_\\+]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // שדות הסקר שעמודה יכולה להיכנס אליהם (כמו בשיוך העמודות של הרשימה). '' = עמודה לבדיקה בלבד
  const FIELD_LABELS = { '': 'רק לבדיקה (לא נכנסת לסקר)', siteName: 'שם המוסד / האתר', street: 'רחוב ומספר', city: 'עיר', code: 'סמל מוסד', manager: 'מנהל/ת', hood: 'שכונה', kabat: 'קב"ט', gush: 'גוש', helka: 'חלקה' };
  const NAME_RULES = {
    auto: 'לפי שם הפרויקט (כמו בלי כישור)',
    jlm: 'סמל מוסד, שם מוסד ורחוב (בלי עיר)',
    wizo: 'סמל_התאריך בעוד שנה_26 (ויצו)',
    plain: 'שם מוסד, רחוב ועיר',
  };
  const PINES_BTN = { auto: 'כשיש ברשימה אורנים', on: 'תמיד', off: 'אף פעם' };

  const col = (key, label, words, o = {}) => Object.assign({ id: key || uid(), key, label, words, req: false, uniq: false, num: false, why: '' }, o);
  // הכישורים המוכנים: בדיוק ההתנהגות שהייתה בקוד עד 1.169
  const SEEDS = [
    {
      id: 'jlm-general', name: 'ירושלים כללי', type: 'safety', builtin: true,
      must: 'ירושל', not: 'אורנ / חדש',
      about: 'הרשימה השנתית של מוסדות החינוך בירושלים (גנים ובתי ספר).\n' +
        '• תיקיות בדרייב: סקרי עצים / ירושלים / <קב"ט> / <שכונה>. סקר בלי קב"ט נכנס ל"ללא שיוך".\n' +
        '• קב"ט: רק השם הראשון (לפני /). מה שבסוגריים או בסוגריים מסולסלים (למשל {גיבוי}) לא נכנס. "אין" / "-" = ללא שיוך. אותו שם בכתיב אחר (אסנת / אוסנת) = תיקייה אחת.\n' +
        '• אם אין בקובץ עמודת קב"ט: ברשימה "➕ עמודה מקובץ" ובחירת האקסל עם הקב"טים, לפי סמל המוסד.\n' +
        '• שכונה: מהעמודה, ואם אין לפי סמל המוסד או הכתובת ברשימות האחרות.\n' +
        '• שם הקובץ: סמל מוסד, שם מוסד ורחוב, בלי העיר.\n' +
        '• שורה שכתוב בה "אורנים": הסקר נפתח עם ריכוז אורנים.\n' +
        '• במפת המסלול: הסיכות צבועות לפי קב"ט (צבע קבוע לכל קב"ט בכל הרשימות).',
      cols: [
        col('code', 'סמל מוסד', 'סמל', { req: true, uniq: true, num: true, why: 'לפיו מוצאים סקרים קודמים, שכונה וקב"ט, והוא בשם הקובץ' }),
        col('siteName', 'שם המוסד', 'שם מוסד / שם הגן / שם בית ספר / שם', { req: true, why: 'נכנס לדוח ולשם הקובץ' }),
        col('street', 'כתובת', 'כתובת / רחוב', { req: true, why: 'לדוח, לשם הקובץ ולמסלול' }),
        col('hood', 'שכונה', 'שכונ', { why: 'תיקייה בדרייב. בלי עמודה: לפי סמל המוסד ברשימות האחרות' }),
        col('kabat', 'קב"ט', 'קב"ט', { req: true, why: 'תיקייה לכל קב"ט בדרייב, מעל השכונה. אין בקובץ? ברשימה "➕ עמודה מקובץ" עם האקסל של הקב"טים' }),
      ],
      rules: { hood: true, kabat: true, kabatPins: true, pines: true, pinesBtn: 'auto', fileName: 'jlm' },
    },
    {
      id: 'jlm-pines', name: 'ירושלים אורנים וחדשים', type: 'safety', builtin: true,
      must: 'ירושל, אורנ / חדש', not: '',
      about: 'רשימות האורנים והמוסדות החדשים בירושלים.\n' +
        '• תיקיות בדרייב: סקרי עצים / ירושלים / <שכונה> (בלי קב"ט).\n' +
        '• שורה שכתוב בה "אורנים": ריכוז אורנים בסקר (חלון פרטי אורן לכל אורן, תזכורות, אקסל ריכוז).\n' +
        '• כפתור "🌲 אורנים ומפות" ברשימה: סיכום האורנים ומפת עצים לשיתוף.\n' +
        '• שם הקובץ: סמל מוסד, שם מוסד ורחוב, בלי העיר.',
      cols: [
        col('code', 'סמל מוסד', 'סמל', { req: true, num: true, why: 'לפיו מוצאים סקרים קודמים ושכונה, והוא בשם הקובץ' }),
        col('siteName', 'שם המוסד', 'שם מוסד / שם הגן / שם בית ספר / שם', { req: true, why: 'נכנס לדוח ולשם הקובץ' }),
        col('street', 'כתובת', 'כתובת / רחוב', { req: true, why: 'לדוח, לשם הקובץ ולמסלול' }),
        col('hood', 'שכונה', 'שכונ', { why: 'תיקייה בדרייב. בלי עמודה: לפי סמל המוסד ברשימות האחרות' }),
      ],
      rules: { hood: true, kabat: false, pines: true, pinesBtn: 'on', fileName: 'jlm' },
    },
    {
      id: 'wizo', name: 'ויצו', type: 'safety', builtin: true,
      must: 'ויצ', not: '',
      about: 'מעונות ויצו.\n• שם הקובץ: סמל_התאריך בעוד שנה מיום הסקר_26 (למשל 12345_2027_11_25_26).\n• בלי סמל מוסד אין שם קובץ של ויצו, ולכן הסמל חובה.',
      cols: [
        col('code', 'סמל מעון', 'סמל', { req: true, uniq: true, num: true, why: 'שם הקובץ של ויצו בנוי מהסמל' }),
        col('siteName', 'שם המעון', 'שם / מעון', { req: true, why: 'נכנס לדוח' }),
        col('street', 'כתובת', 'כתובת / רחוב', { req: true, why: 'לדוח ולמסלול' }),
        col('city', 'עיר', 'עיר / ישוב / יישוב', { req: true, why: 'המעונות בכל הארץ' }),
      ],
      rules: { hood: false, kabat: false, pines: true, pinesBtn: 'auto', fileName: 'wizo' },
    },
  ];
  SEEDS.forEach(s => { s.updated = 1; });

  // ---------- אחסון ----------
  let cache = null;
  const ready = (async () => {
    try {
      let list = await DB.getKV('jobSkills', null);
      if (!list) { list = JSON.parse(JSON.stringify(SEEDS)); await DB.setKV('jobSkills', list); }
      cache = list;
    } catch (e) { console.warn('skills', e); cache = JSON.parse(JSON.stringify(SEEDS)); }
    return cache;
  })();
  const all = () => (cache || []).filter(s => !s.deleted);
  const get = id => id ? all().find(s => s.id === id) || null : null;
  async function save(sk) {
    await ready;
    sk.updated = Date.now();
    const i = cache.findIndex(x => x.id === sk.id);
    if (i >= 0) cache[i] = sk; else cache.push(sk);
    await DB.setKV('jobSkills', cache);
    if (root.Sync && Sync.skillsChanged) Sync.skillsChanged();
  }
  async function remove(id) { const sk = cache.find(x => x.id === id); if (!sk) return; sk.deleted = Date.now(); await save(sk); }
  // מיזוג עם הענן: לכל כישור, מה שעודכן אחרון
  function merge(a, b) {
    const m = new Map();
    for (const s of [...(a || []), ...(b || [])]) { const o = m.get(s.id); if (!o || (s.updated || 0) > (o.updated || 0)) m.set(s.id, s); }
    return [...m.values()];
  }
  async function setAll(list) { await ready; cache = list; await DB.setKV('jobSkills', cache); }

  // ---------- התאמה לרשימה ----------
  // "ירושל, אורנ / חדש": כל חלק שמופרד בפסיק חייב להופיע, ו-/ בתוך חלק = אחת מהמילים
  const groups = t => String(t || '').split(/[,\n]/).map(g => g.split('/').map(norm).filter(Boolean)).filter(g => g.length);
  const words = t => String(t || '').split(/[,/\n]/).map(norm).filter(Boolean);
  const hayOf = l => norm([l.project, l.name, l.file].filter(Boolean).join(' '));
  function matches(sk, l) {
    if (!sk || !l) return false;
    if ((sk.type || 'safety') !== (l.type || 'safety')) return false;
    const hay = hayOf(l), must = groups(sk.must);
    if (!must.length) return false;
    return must.every(g => g.some(w => hay.includes(w))) && !words(sk.not).some(w => hay.includes(w));
  }
  // הכישור שמתאים לשם הרשימה / הקובץ / הפרויקט (הכי הרבה מילים תואמות)
  function suggest(l) {
    const c = all().filter(sk => matches(sk, l));
    return c.sort((a, b) => groups(b.must).length - groups(a.must).length)[0] || null;
  }
  // הכישור של הרשימה: רק מה שנבחר בה (l.skill). 'none' = בלי כישור
  const forList = l => l && l.skill && l.skill !== 'none' ? get(l.skill) : null;
  // כלל של כישור לרשימה: undefined כשאין כישור (ואז הקוד הישן מחליט)
  function rule(l, k) { const sk = forList(l); return sk && sk.rules ? sk.rules[k] : undefined; }

  // ---------- בדיקת קובץ / רשימה מול הכישור ----------
  // עמודה של הכישור ברשימה: קודם לפי השיוך לשדה (אם יש), אחרת לפי מילה בכותרת
  function findCols(sk, l) {
    const used = new Set(), out = new Map();
    const colsOf = m => m ? [m.col, ...(m.more || [])].filter(Boolean) : [];
    for (const c of sk.cols || []) {
      let ids = c.key ? colsOf((l.map || {})[c.key]).filter(id => (l.cols || []).some(x => x.id === id)) : [];
      if (!ids.length) {
        const ws = words(c.words || c.label);
        const hit = (l.cols || []).find(x => !used.has(x.id) && ws.some(w => norm(x.name).includes(w)));
        if (hit) ids = [hit.id];
      }
      ids.forEach(id => used.add(id));
      out.set(c.id, ids);
    }
    return out;
  }
  // תוצאה: { level: 'ok' | 'warn' | 'bad', items: [{ lvl, text, why }] }. לא משנה כלום ברשימה
  function check(sk, l, helpers = {}) {
    const items = [], add = (lvl, text, why) => items.push({ lvl, text, why: why || '' });
    if (!sk) return { level: 'ok', items };
    if ((sk.type || 'safety') !== (l.type || 'safety')) add('bad', `הכישור הוא ל${sk.type === 'construction' ? 'סקר לבנייה' : 'סקר בטיחות'}, והרשימה היא ${l.type === 'construction' ? 'סקר לבנייה' : 'סקר בטיחות'}`);
    const rows = (l.rows || []).filter(r => !r.deleted);
    if (!rows.length) add('bad', 'אין שורות ברשימה');
    const found = findCols(sk, l), name = id => ((l.cols || []).find(x => x.id === id) || {}).name || id;
    const label = r => clean([...(found.get('siteName') || []), ...(found.get('street') || [])].map(id => r.cells[id]).filter(Boolean).join(', ')).slice(0, 40);
    const rowList = rs => rs.slice(0, 8).map(({ i, r }) => `שורה ${i + 1}${label(r) ? ' (' + label(r) + ')' : ''}`).join(', ') + (rs.length > 8 ? ` ועוד ${rs.length - 8}` : '');
    const val = (c, r) => clean((found.get(c.id) || []).map(id => r.cells[id]).filter(Boolean).join(' '));
    for (const c of sk.cols || []) {
      const ids = found.get(c.id) || [];
      if (!ids.length) {
        add(c.req ? 'bad' : 'info', `${c.req ? 'חסרה עמודת חובה' : 'אין עמודה'}: ${c.label}` + (c.words ? ` (מחפש בכותרת: ${c.words})` : ''), c.why);
        continue;
      }
      add('ok', `${c.label}: עמודה "${ids.map(name).join(' + ')}"`);
      const idx = rows.map((r, i) => ({ i, r }));
      if (c.req) {
        const empty = idx.filter(x => !val(c, x.r));
        if (empty.length) add('warn', `${c.label} ריק ב-${empty.length} שורות: ${rowList(empty)}`, c.why);
      }
      if (c.num) {
        const bad = idx.filter(x => { const v = val(c, x.r); return v && !/\d{3,}/.test(v); });
        if (bad.length) add('warn', `${c.label} בלי מספר ב-${bad.length} שורות: ${rowList(bad)}`, c.why);
      }
      if (c.uniq) {
        const seen = new Map();
        for (const x of idx) { const v = norm(val(c, x.r)); if (!v) continue; if (!seen.has(v)) seen.set(v, []); seen.get(v).push(x); }
        const dup = [...seen].filter(([, xs]) => xs.length > 1);
        if (dup.length) add('warn', `${c.label} מופיע יותר מפעם אחת: ` + dup.slice(0, 6).map(([v, xs]) => `${v} (${xs.map(x => x.i + 1).join(', ')})`).join('; ') + (dup.length > 6 ? ` ועוד ${dup.length - 6}` : ''), 'אותו מוסד פעמיים: בדוק שזו לא טעות בקובץ');
      }
      // קב"ט: מה יקרה לערכים (ללא שיוך, שמות בכתיב אחר)
      if (c.key === 'kabat' && helpers.kabatFirst) {
        const none = idx.filter(x => val(c, x.r) && !helpers.kabatFirst(val(c, x.r)));
        if (none.length) add('info', `${none.length} שורות עם קב"ט כמו "אין" או "-": ייכנסו ל"ללא שיוך"`);
        const by = new Map();
        for (const x of idx) { const n = helpers.kabatFirst(val(c, x.r)); if (!n) continue; const k = helpers.kabatKey(n); if (!by.has(k)) by.set(k, new Set()); by.get(k).add(n); }
        const multi = [...by.values()].filter(s => s.size > 1);
        if (multi.length) add('info', 'שמות קב"ט בכמה כתיבים, יהיו בתיקייה אחת: ' + multi.slice(0, 5).map(s => [...s].join(' / ')).join('; '));
        add('info', `${by.size} קב"טים שונים ברשימה`);
      }
    }
    const level = items.some(x => x.lvl === 'bad') ? 'bad' : items.some(x => x.lvl === 'warn') ? 'warn' : 'ok';
    return { level, items };
  }
  const LEVEL = { ok: '✅ תקין', warn: '⚠️ חסרים נתונים', bad: '❌ לא תקין' };

  // שיוך אוטומטי של עמודות הכישור לשדות הסקר שעוד לא שויכו (לא דורס שיוך קיים)
  function applyMap(sk, l) {
    if (!sk) return 0;
    l.map = l.map || {};
    const found = findCols(sk, l), taken = new Set(Object.values(l.map).flatMap(m => m ? [m.col, ...(m.more || [])] : []).filter(Boolean));
    let n = 0;
    for (const c of sk.cols || []) {
      if (!c.key || (l.map[c.key] && l.map[c.key].col)) continue;
      const id = (found.get(c.id) || []).find(x => !taken.has(x));
      if (!id) continue;
      l.map[c.key] = Object.assign({ pre: '', prev: false }, l.map[c.key] || {}, { col: id });
      taken.add(id); n++;
    }
    return n;
  }

  // ---------- מסכים ----------
  // הכרטיס בהגדרות
  function settingsCard() {
    const ui = U(), { h } = ui;
    const box = h('div', { class: 'stack' });
    const draw = async () => {
      await ready;
      const lists = root.WorkLists && WorkLists.allLists ? await WorkLists.allLists() : [];
      const n = id => lists.filter(l => l.skill === id).length;
      box.replaceChildren(...all().sort((a, b) => a.name.localeCompare(b.name, 'he')).map(sk => h('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap' },
        h('button', { class: 'btn', style: 'flex:1;justify-content:flex-start;text-align:start', onclick: () => ui.go('#/skills/' + encodeURIComponent(sk.id)) },
          h('b', {}, '🧩 ' + sk.name), h('span', { class: 'muted small' }, ` · ${sk.type === 'construction' ? 'בנייה' : 'בטיחות'} · ${n(sk.id) ? n(sk.id) + ' רשימות' : 'אין רשימות'}`)))));
    };
    draw();
    return h('div', { class: 'card stack' },
      h('h2', { style: 'margin:0;font-size:20px' }, '📁 כישורים לעבודות'),
      h('div', { class: 'muted small' }, 'כל מה שמיוחד לעבודה אחת (ירושלים כללי, ויצו...): הסברים, עמודות שהקובץ צריך, תיקיות ושם הקובץ. כישור פועל ברשימה שבחרת לה אותו, ושם גם בודקים שהקובץ תקין.'),
      box,
      h('div', { class: 'row', style: 'gap:8px' },
        h('button', { class: 'btn', onclick: async () => { const sk = { id: uid(), name: 'כישור חדש', type: 'safety', must: '', not: '', about: '', cols: [], rules: { hood: false, kabat: false, pines: true, pinesBtn: 'auto', fileName: 'auto' } }; await save(sk); ui.go('#/skills/' + encodeURIComponent(sk.id)); } }, '➕ כישור חדש')));
  }

  // עריכת כישור
  async function renderEdit(id) {
    await ready;
    const ui = U(), { h } = ui;
    const sk0 = get(id);
    if (!sk0) { ui.go('#/settings'); return; }
    const sk = JSON.parse(JSON.stringify(sk0));
    sk.cols = sk.cols || []; sk.rules = Object.assign({ hood: false, kabat: false, pines: true, pinesBtn: 'auto', fileName: 'auto' }, sk.rules || {});
    const field = (label, el, hint) => h('div', {}, h('label', { class: 'f' }, label), el, hint ? h('div', { class: 'muted small' }, hint) : null);
    const inp = (k, o = {}) => h('input', Object.assign({ class: 'in', value: sk[k] || '', oninput: e => { sk[k] = e.target.value; dirty(); } }, o));
    const sel = (opts, v, on) => h('select', { class: 'in', onchange: e => on(e.target.value) }, Object.entries(opts).map(([k, t]) => h('option', { value: k, selected: k === v ? true : null }, t)));
    const chk = (k, text, hint) => h('label', { class: 'row', style: 'gap:8px;align-items:flex-start' },
      h('input', { type: 'checkbox', checked: !!sk.rules[k], onchange: e => { sk.rules[k] = e.target.checked; dirty(); } }), h('span', {}, text, hint ? h('div', { class: 'muted small' }, hint) : null));
    // נשמר תוך כדי כתיבה (כמו הרשימות)
    const saveSoon = ui.debounce(async () => { Object.keys(sk0).forEach(k => delete sk0[k]); Object.assign(sk0, JSON.parse(JSON.stringify(sk))); await save(sk0); drawLists(); }, 600);
    const dirty = () => saveSoon();
    const about = h('textarea', { class: 'in', rows: 8, style: 'width:100%', oninput: e => { sk.about = e.target.value; dirty(); } }, sk.about || '');

    const colsBox = h('div', { class: 'stack' });
    const drawCols = () => colsBox.replaceChildren(...sk.cols.map((c, i) => h('div', { class: 'card stack', style: 'padding:10px;gap:6px' },
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:center' },
        h('input', { class: 'in', style: 'flex:1 1 160px;width:auto', value: c.label, placeholder: 'שם העמודה', 'aria-label': 'שם העמודה', oninput: e => { c.label = e.target.value; dirty(); } }),
        Object.assign(sel(FIELD_LABELS, c.key || '', v => { c.key = v; dirty(); }), { style: 'flex:1 1 160px;width:auto' }),
        h('button', { class: 'icon-btn', title: 'הסר עמודה', 'aria-label': 'הסר עמודה', onclick: () => { sk.cols.splice(i, 1); dirty(); drawCols(); } }, '✕')),
      field('מילים בכותרת בקובץ (מופרדות ב-/)', h('input', { class: 'in', style: 'width:100%', value: c.words || '', placeholder: 'למשל: קב"ט / קצין ביטחון', oninput: e => { c.words = e.target.value; dirty(); } })),
      h('div', { class: 'row small', style: 'gap:14px;flex-wrap:wrap' },
        ...[['req', 'חובה'], ['uniq', 'בלי כפילויות'], ['num', 'מספר (סמל)']].map(([k, t]) => h('label', { class: 'row', style: 'gap:6px;align-items:center' },
          h('input', { type: 'checkbox', checked: !!c[k], onchange: e => { c[k] = e.target.checked; dirty(); } }), t))),
      h('input', { class: 'in', style: 'width:100%', value: c.why || '', placeholder: 'למה צריך את העמודה (מופיע בבדיקה)', oninput: e => { c.why = e.target.value; dirty(); } }))));
    drawCols();

    const listsBox = h('div', { class: 'stack' });
    const drawLists = async () => {
      const lists = (root.WorkLists && WorkLists.allLists ? await WorkLists.allLists() : []).filter(l => !l.deleted);
      const mine = lists.filter(l => l.skill === sk0.id), fit = lists.filter(l => !l.skill && matches(sk0, l));
      const hp = WorkLists && WorkLists._t ? WorkLists._t : {};
      listsBox.replaceChildren(
        mine.length ? null : h('div', { class: 'muted small' }, 'עוד אין רשימה עם הכישור הזה. בוחרים אותו במסך של הרשימה (🧩 כישור).'),
        ...mine.map(l => { const r = check(sk0, l, hp); return h('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap' },
          h('button', { class: 'btn', style: 'flex:1;justify-content:flex-start', onclick: () => ui.go('#/lists/' + encodeURIComponent(l.id)) }, l.name || 'רשימה'),
          h('button', { class: 'btn', onclick: () => reportDialog(sk0, l, r) }, LEVEL[r.level])); }),
        ...fit.map(l => h('div', { class: 'row small', style: 'gap:8px;align-items:center;flex-wrap:wrap' },
          h('span', { style: 'flex:1' }, `מתאים לפי השם: ${l.name || 'רשימה'}`),
          h('button', { class: 'btn', onclick: async () => { await WorkLists.setSkill(l.id, sk0.id); drawLists(); } }, 'שייך'))));
    };
    drawLists();

    // בדיקת קובץ בלי לייבא אותו
    const fileIn = h('input', { type: 'file', accept: '.xlsx,.xlsm,.csv', style: 'display:none', onchange: async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { const l = await WorkLists.previewFile(f); l.type = sk.type; reportDialog(sk, l, check(sk, l, WorkLists._t || {}), f.name); }
      catch (err) { ui.toast('קריאת הקובץ נכשלה: ' + err.message, 5000); }
    } });

    const bar = ui.bar({ title: '🧩 ' + (sk.name || 'כישור'), sub: 'כישור לעבודה · נשמר אוטומטית' }, '#/settings');
    ui.app().replaceChildren(bar, h('main', { class: 'stack', style: 'max-width:820px;margin:0 auto' },
      h('div', { class: 'card stack' },
        field('שם הכישור', inp('name')),
        field('סוג הסקר', sel({ safety: 'סקר בטיחות', construction: 'סקר לבנייה' }, sk.type || 'safety', v => { sk.type = v; dirty(); })),
        field('הסברים: איך העבודה הזו עובדת', about, 'לקריאה שלך (ושלי כשאתה מבקש שינוי). מופיע גם בבדיקה של הרשימה.')),
      h('div', { class: 'card stack' },
        h('h3', { style: 'margin:0' }, 'לאיזה קובץ'),
        field('מילים שחייבות להופיע בשם הקובץ, הרשימה או הפרויקט', inp('must', { placeholder: 'למשל: ירושל, אורנ / חדש' }), 'פסיק = גם וגם, / = אחת מהן. משמש להצעת הכישור כשמייבאים קובץ.'),
        field('מילים שאסור שיופיעו', inp('not', { placeholder: 'למשל: אורנ / חדש' }))),
      h('div', { class: 'card stack' },
        h('h3', { style: 'margin:0' }, 'עמודות שהקובץ צריך'),
        colsBox,
        h('button', { class: 'btn', onclick: () => { sk.cols.push(col('', '', '')); dirty(); drawCols(); } }, '➕ עמודה')),
      h('div', { class: 'card stack' },
        h('h3', { style: 'margin:0' }, 'כללים'),
        sk.type === 'construction' ? null : chk('hood', '📁 תיקייה לפי שכונה בתוך תיקיית הפרויקט'),
        sk.type === 'construction' ? null : chk('kabat', '📁 תיקייה לפי קב"ט (הראשון) מעל השכונה', 'רק כשיש ברשימה עמודת קב"ט'),
        sk.type === 'construction' ? null : chk('kabatPins', '🎨 במפת המסלול: צבע סיכה לפי קב"ט', 'רק כשיש ברשימה עמודת קב"ט. סימון ברשימה גובר'),
        sk.type === 'construction' ? null : chk('pines', '🌲 שורה שכתוב בה "אורנים" פותחת סקר עם ריכוז אורנים'),
        sk.type === 'construction' ? null : field('כפתור "🌲 אורנים ומפות" ברשימה', sel(PINES_BTN, sk.rules.pinesBtn || 'auto', v => { sk.rules.pinesBtn = v; dirty(); })),
        sk.type === 'construction' ? null : field('שם הקובץ של הסקר', sel(NAME_RULES, sk.rules.fileName || 'auto', v => { sk.rules.fileName = v; dirty(); })),
        h('div', { class: 'muted small' }, 'כלל שמסומן ברשימה עצמה (למשל כיבוי תיקייה לפי שכונה) גובר על הכישור.')),
      h('div', { class: 'card stack' },
        h('h3', { style: 'margin:0' }, 'רשימות עם הכישור'),
        listsBox,
        h('label', { class: 'btn' }, '🔍 בדוק קובץ מול הכישור (בלי לייבא)', fileIn)),
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
        sk0.builtin ? h('button', { class: 'btn', onclick: async () => {
          if (!confirm('להחזיר את הכישור להגדרות המקוריות? השינויים שעשית בו יימחקו.')) return;
          const seed = JSON.parse(JSON.stringify(SEEDS.find(s => s.id === sk0.id)));
          Object.keys(sk0).forEach(k => delete sk0[k]); Object.assign(sk0, seed); await save(sk0); renderEdit(id);
        } }, '↺ החזר למקור') : null,
        h('button', { class: 'btn', onclick: async () => { const c = JSON.parse(JSON.stringify(sk)); c.id = uid(); c.name = sk.name + ' (עותק)'; delete c.builtin; c.cols.forEach(x => { if (!x.key) x.id = uid(); }); await save(c); ui.go('#/skills/' + encodeURIComponent(c.id)); } }, 'שכפל'),
        h('button', { class: 'btn danger', onclick: async () => {
          if (!confirm(`למחוק את הכישור "${sk0.name}"? רשימות שמשתמשות בו יחזרו לעבוד בלי כישור.`)) return;
          await remove(sk0.id); ui.go('#/settings');
        } }, 'מחק'))));
  }

  // דוח הבדיקה (חלון)
  function reportDialog(sk, l, res, fileName) {
    const ui = U(), { h } = ui;
    const icon = { ok: '✅', warn: '⚠️', bad: '❌', info: 'ℹ️' };
    const close = () => ov.remove();
    const ov = h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
      h('div', { class: 'card stack', style: 'max-width:620px;width:96%' },
        h('h2', { style: 'margin:0;font-size:20px' }, `${LEVEL[res.level]}: ${fileName || l.name || 'רשימה'}`),
        h('div', { class: 'muted small' }, `בדיקה מול הכישור "${sk.name}" · ${(l.rows || []).filter(r => !r.deleted).length} שורות`),
        h('div', { class: 'stack', style: 'gap:6px' }, ...res.items.map(x => h('div', { class: 'skill-item ' + x.lvl },
          h('div', {}, icon[x.lvl] + ' ' + x.text), x.why && x.lvl !== 'ok' ? h('div', { class: 'muted small' }, x.why) : null))),
        sk.about ? h('details', {}, h('summary', {}, 'ההסברים של הכישור'), h('div', { class: 'small', style: 'white-space:pre-wrap' }, sk.about)) : null,
        h('button', { class: 'btn', onclick: close }, 'סגור')));
    document.body.append(ov);
  }

  // השורה במסך הרשימה: הכישור, הסטטוס ובחירה
  function listRow(l, onChange) {
    const ui = U(), { h } = ui;
    const sk = forList(l), sug = !l.skill ? suggest(l) : null;
    const res = sk ? check(sk, l, (root.WorkLists && WorkLists._t) || {}) : null;
    const pick = () => {
      const close = () => ov.remove();
      const opts = all().filter(x => (x.type || 'safety') === (l.type || 'safety'));
      const choose = async v => { close(); await onChange(v); };
      const ov = h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
        h('div', { class: 'card stack', style: 'max-width:520px;width:96%' },
          h('h2', { style: 'margin:0;font-size:20px' }, '🧩 כישור לרשימה'),
          h('div', { class: 'muted small' }, 'הכישור קובע את התיקיות בדרייב, שם הקובץ, האורנים ואילו עמודות צריכות להיות בקובץ.'),
          ...opts.map(x => h('button', { class: 'btn' + (sk && sk.id === x.id ? ' primary' : ''), style: 'justify-content:flex-start', onclick: () => choose(x.id) },
            '🧩 ' + x.name + (sug && sug.id === x.id ? ' (מתאים לפי השם)' : ''))),
          h('button', { class: 'btn' + (l.skill === 'none' || !l.skill ? ' primary' : ''), onclick: () => choose('none') }, 'בלי כישור (כמו קודם)'),
          h('button', { class: 'btn', onclick: () => { close(); ui.go('#/settings'); } }, 'ניהול הכישורים בהגדרות'),
          h('button', { class: 'btn', onclick: close }, 'ביטול')));
      document.body.append(ov);
    };
    return h('div', { class: 'row small', style: 'gap:8px;align-items:center;flex-wrap:wrap' },
      h('button', { class: 'btn', onclick: pick }, '🧩 ' + (sk ? 'כישור: ' + sk.name : 'בלי כישור')),
      res ? h('button', { class: 'btn skill-lvl ' + res.level, onclick: () => reportDialog(sk, l, res) }, LEVEL[res.level]) : null,
      sk ? h('button', { class: 'link-btn small', onclick: () => ui.go('#/skills/' + encodeURIComponent(sk.id)) }, 'הסברים') : null,
      sug ? h('button', { class: 'btn', onclick: () => onChange(sug.id) }, `מתאים לכישור "${sug.name}"? שייך`) : null);
  }

  root.Skills = { ready, all, get, save, remove, merge, setAll, list: () => cache || [], matches, suggest, forList, rule, check, applyMap, LEVEL, NAME_RULES, SEEDS,
    settingsCard, renderEdit, reportDialog, listRow,
    render: hash => renderEdit(decodeURIComponent(hash.slice('#/skills/'.length))) };
})(window);

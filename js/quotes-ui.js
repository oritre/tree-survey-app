// מסכי הצעות מחיר: רשימה, הצעה חדשה מתבנית, מילוי פרטים / עריכת כל המסמך, סעיפי תמחיר, PDF / Word, שליחה ושמירה בדרייב
(function (root) {
  'use strict';
  const U = () => App.ui;
  const $ = s => document.querySelector(s);
  const DEFAULT_FOLDER = 'א עצים/הצעות מחיר';

  // ---------- אחסון ----------
  const allQuotes = async () => (await DB.getKV('quotes', [])) || [];
  async function saveQuote(q) {
    q.updated = Date.now();
    const list = await allQuotes();
    const i = list.findIndex(x => x.id === q.id);
    if (i >= 0) list[i] = q; else list.push(q);
    await DB.setKV('quotes', list);
  }
  async function deleteQuote(id) { await DB.setKV('quotes', (await allQuotes()).filter(x => x.id !== id)); }

  // תבניות: המובנות (מהתיקייה של ori) + תבניות שהועלו מהמכשיר. תבנית שהועלתה באותו שם מחליפה את המובנית
  async function templates() {
    const up = (await DB.getKV('quoteTemplates', [])) || [];
    const names = new Set(up.map(t => t.name));
    return [...Quotes.BUILTIN.filter(t => !names.has(t.name)), ...up.map(t => Object.assign({ uploaded: true }, t))];
  }
  const bytesCache = {};
  async function templateBytes(id) {
    if (bytesCache[id]) return bytesCache[id];
    const b = Quotes.BUILTIN.find(t => t.id === id);
    let bytes;
    if (b) {
      const res = await fetch(b.file);
      if (!res.ok) throw new Error('לא נמצאה התבנית ' + b.name);
      bytes = new Uint8Array(await res.arrayBuffer());
    } else {
      bytes = await DB.getKV('qtpl:' + id, null);
      if (!bytes) throw new Error('התבנית של ההצעה הזו נמחקה מהאפליקציה. אפשר להעלות אותה שוב באותו שם.');
    }
    return (bytesCache[id] = bytes);
  }
  async function uploadTemplate(file) {
    const name = file.name.replace(/\.(dotx|docx)$/i, '').trim();
    const bytes = new Uint8Array(await file.arrayBuffer());
    await Quotes.parse(bytes); // בדיקה שזה באמת מסמך Word
    const up = (await DB.getKV('quoteTemplates', [])) || [];
    const old = up.find(t => t.name === name);
    const id = old ? old.id : 'u-' + Quotes.uid();
    await DB.setKV('qtpl:' + id, bytes);
    delete bytesCache[id];
    if (!old) up.push({ id, name });
    await DB.setKV('quoteTemplates', up);
    return name;
  }

  // כל סעיפי התמחיר שמופיעים בתבניות ובהצעות קודמות, לבחירה מהירה
  let libCache = null;
  async function priceLibrary() {
    const map = new Map();
    const add = (desc, amt, from) => { const k = desc.trim() + '|' + String(amt || '').trim(); if (desc.trim() && !map.has(k)) map.set(k, { desc: desc.trim(), amt: String(amt || '').trim(), from }); };
    if (!libCache) {
      libCache = [];
      for (const t of await templates()) {
        try { for (const b of await Quotes.parse(await templateBytes(t.id))) if (b.kind === 'price') libCache.push({ desc: b.desc, amt: b.amt, from: t.name }); } catch (_) {}
      }
    }
    for (const x of libCache) add(x.desc, x.amt, x.from);
    for (const q of (await allQuotes()).sort((a, b) => b.updated - a.updated)) for (const b of q.blocks) if (b.kind === 'price' && !b.del) add(b.desc, b.amt, 'הצעות קודמות');
    return [...map.values()];
  }

  // ---------- ניווט ----------
  async function render(hash) {
    const m = /^#\/quotes\/(.+)$/.exec(hash);
    if (m) {
      const q = (await allQuotes()).find(x => x.id === decodeURIComponent(m[1]));
      if (!q) { U().go('#/quotes'); return; }
      return renderEditor(q);
    }
    return renderList();
  }

  // ---------- רשימת הצעות ----------
  async function renderList() {
    const { h, bar, go } = U();
    const list = (await allQuotes()).sort((a, b) => b.updated - a.updated);
    const filter = h('input', { class: 'in', type: 'search', placeholder: 'חיפוש לפי שם, כתובת או גוש' });
    const box = h('div', { class: 'grid-list' });
    const draw = () => {
      const f = filter.value.trim();
      const shown = list.filter(q => !f || nameOf(q).includes(f));
      box.replaceChildren(...(shown.length ? shown.map(q => h('div', { class: 'card survey-item', role: 'button', tabindex: 0, onclick: () => go('#/quotes/' + encodeURIComponent(q.id)) },
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { class: 't' }, nameOf(q)),
          h('div', { class: 'muted small' }, [q.tplName, U().fmtDate(q.date)].filter(Boolean).join(' · ') + (q.savedAt ? ' · ☁ בדרייב' : ''))),
        h('span', { class: 'muted', 'aria-hidden': 'true' }, '←'))) : [h('div', { class: 'empty' }, list.length ? 'לא נמצאו הצעות' : 'עוד אין הצעות מחיר. לחץ על "הצעת מחיר חדשה".')]));
    };
    filter.addEventListener('input', draw);
    $('#app').replaceChildren(
      bar('הצעות מחיר', '#/'),
      h('main', { class: 'stack' },
        h('div', { class: 'row' },
          h('button', { class: 'btn primary big', style: 'flex:1', onclick: pickTemplate }, '+ הצעת מחיר חדשה'),
          h('button', { class: 'btn big', style: 'flex:1', onclick: manageTemplates }, '📂 תבניות')),
        list.length > 4 ? filter : null, box));
    draw();
  }
  const nameOf = q => (q.name || '').trim() || Quotes.autoName(q);

  async function pickTemplate() {
    const { askChoice, go, toast, today } = U();
    const tpls = await templates();
    const id = await askChoice('הצעת מחיר חדשה', 'בחר תבנית', [...tpls.map(t => ({ value: t.id, label: t.name })), { value: '', label: 'ביטול' }]);
    if (!id) return;
    try {
      const t = tpls.find(x => x.id === id);
      const q = Quotes.newQuote(t, await Quotes.parse(await templateBytes(id)), today());
      await saveQuote(q);
      go('#/quotes/' + encodeURIComponent(q.id));
    } catch (e) { toast('פתיחת התבנית נכשלה: ' + e.message, 5000); }
  }

  async function manageTemplates() {
    const { h, toast } = U();
    const close = () => ov.remove();
    const list = h('div', { class: 'stack' });
    const input = h('input', { type: 'file', accept: '.dotx,.docx', multiple: true, class: 'hidden', onchange: async e => {
      for (const f of e.target.files) {
        try { toast('נוספה התבנית ' + await uploadTemplate(f)); } catch (err) { toast(f.name + ': ' + err.message, 5000); }
      }
      libCache = null; input.value = ''; draw();
    } });
    const draw = async () => {
      const tpls = await templates();
      list.replaceChildren(...tpls.map(t => h('div', { class: 'row', style: 'justify-content:space-between' },
        h('span', {}, t.name, t.uploaded ? h('span', { class: 'badge', style: 'margin-inline-start:6px' }, 'הועלתה') : null),
        t.uploaded ? h('button', { class: 'btn danger', onclick: async () => {
          if (!confirm(`למחוק את התבנית "${t.name}"? הצעות שנעשו ממנה לא יוכלו להפיק קובץ עד שתעלה אותה שוב.`)) return;
          await DB.setKV('quoteTemplates', ((await DB.getKV('quoteTemplates', [])) || []).filter(x => x.id !== t.id));
          await DB.delKV('qtpl:' + t.id); libCache = null; draw();
        } }, 'מחיקה') : null)));
    };
    const ov = h('div', { class: 'modal' },
      h('div', { class: 'card stack', style: 'max-width:520px;width:92%' },
        h('h2', { style: 'margin:0;font-size:21px' }, 'תבניות הצעות מחיר'),
        h('div', { class: 'muted small' }, 'אפשר להעלות קובץ Word (dotx או docx) מהמכשיר. תבנית באותו שם מחליפה את הקיימת. כדי לסמן בתבנית שדה למילוי כתוב בה [[שם השדה]].'),
        list, input,
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => input.click() }, '📂 העלאת תבנית'), h('button', { class: 'btn', onclick: close }, 'סגירה'))));
    document.body.append(ov);
    draw();
  }

  // ---------- עורך הצעה ----------
  let mode = 'form';
  async function renderEditor(q) {
    const { h, bar, go, debounce } = U();
    const save = debounce(() => saveQuote(q), 300);
    const changed = () => { save(); const n = $('#qName'); if (n && !q.name) n.placeholder = Quotes.autoName(q); };

    const nameIn = h('input', { class: 'in', id: 'qName', value: q.name || '', placeholder: Quotes.autoName(q), oninput: e => { q.name = e.target.value; save(); } });
    const dateIn = h('input', { class: 'in', type: 'date', value: q.date || '', style: 'max-width:220px', oninput: e => { q.date = e.target.value; save(); } });
    const content = h('div', { class: 'stack' });
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'אופן עריכה' },
      [['form', 'מילוי פרטים'], ['full', 'עריכת כל המסמך']].map(([v, label]) =>
        h('button', { class: mode === v ? 'on' : '', onclick: () => { mode = v; renderEditor(q); } }, label)));

    const draw = () => content.replaceChildren(...(mode === 'form' ? formView(q, changed, draw) : fullView(q, changed, draw)));
    draw();

    $('#app').replaceChildren(
      bar('הצעת מחיר', '#/quotes'),
      h('main', { class: 'stack editor' },
        h('div', { class: 'card stack' },
          h('div', { class: 'muted small' }, 'תבנית: ' + q.tplName),
          h('div', {}, h('label', { class: 'f' }, 'תאריך'), dateIn)),
        seg, content,
        h('div', { class: 'card stack' },
          h('div', {}, h('label', { class: 'f', for: 'qName' }, 'שם הקובץ בדרייב'), nameIn,
            h('div', { class: 'muted small' }, 'ריק = ' + (q.blocks.some(b => b.inst) ? 'שם המוסד' : 'הכתובת') + '. אפשר לכתוב כאן שם אחר.'))),
        actions(q)));
    saveWordOn().then(v => { const c = $('#qSaveWord'); if (c) c.checked = v; });
  }

  function field(label, input, hint) {
    const { h } = U();
    return h('div', {}, h('label', { class: 'f' }, label), input, hint ? h('div', { class: 'muted small' }, hint) : null);
  }
  function autoGrow(el) { const fit = () => { el.style.height = 'auto'; el.style.height = Math.max(50, el.scrollHeight + 2) + 'px'; }; el.addEventListener('input', fit); requestAnimationFrame(fit); return el; }

  // מילוי פרטים: רק מה שמשתנה בין הצעה להצעה. הטקסט הקבוע נשאר כמו בתבנית
  function formView(q, changed, redraw) {
    const { h } = U();
    const fields = [];
    for (const b of q.blocks) {
      if (b.del) continue;
      if (b.kind === 'gush') {
        fields.push(h('div', { class: 'grid2' },
          field('גוש', h('input', { class: 'in', inputmode: 'numeric', value: b.gush || '', oninput: e => { b.gush = e.target.value.trim(); changed(); } })),
          field('חלקה', h('input', { class: 'in', inputmode: 'numeric', value: b.helka || '', oninput: e => { b.helka = e.target.value.trim(); changed(); } }))));
      } else if (b.kind === 'subject') {
        fields.push(field(b.label || (/\d/.test(b.ex) && /,/.test(b.ex) ? 'כתובת' : 'שורה בכותרת'),
          h('input', { class: 'in', value: b.t || '', placeholder: b.ex ? 'לדוגמה: ' + b.ex : '', oninput: e => { b.t = e.target.value; changed(); } }),
          b.inst ? 'מופיע מתחת לכותרת, ומשמש גם כשם הקובץ' : 'שורה ריקה לא תופיע בהצעה'));
      } else if (b.kind === 'blank' && b.blank === 'mark') {
        const labels = [...new Set([...b.text.matchAll(/\[\[([^\]]*)\]\]/g)].map(m => m[1]))];
        for (const l of labels) fields.push(field(l || 'שדה', h('input', { class: 'in', value: (b.vals || {})[l] || '', oninput: e => { (b.vals = b.vals || {})[l] = e.target.value; changed(); } })));
      } else if (b.kind === 'blank') {
        fields.push(field(b.label || 'שדה', h('input', { class: 'in', value: b.val || '', inputmode: b.label === 'מספר עצים' ? 'numeric' : 'text', oninput: e => { b.val = e.target.value; changed(); } }),
          'בהצעה: ' + b.text.trim().replace(/\s{2,}/, ' ___ ') + (b.blank === 'colon' ? ' ___' : '')));
      }
    }
    return [
      fields.length ? h('div', { class: 'card stack' }, h('h2', { style: 'margin:0;font-size:19px' }, 'פרטים'), ...fields) : null,
      pricesCard(q, changed, redraw),
      h('div', { class: 'muted small', style: 'text-align:center' }, 'כל שאר הטקסט נשאר כמו בתבנית. לשינוי טקסט קבוע: "עריכת כל המסמך".'),
    ];
  }

  function priceRow(q, b, changed, redraw) {
    const { h } = U();
    const prices = () => q.blocks.filter(x => x.kind === 'price' && !x.del);
    const move = d => {
      const ps = prices(), i = ps.indexOf(b), other = ps[i + d];
      if (!other) return;
      const a = q.blocks.indexOf(b), c = q.blocks.indexOf(other);
      [q.blocks[a], q.blocks[c]] = [q.blocks[c], q.blocks[a]];
      changed(); redraw();
    };
    return h('div', { class: 'price-row' },
      autoGrow(h('textarea', { class: 'in', rows: 1, 'aria-label': 'תיאור הסעיף', placeholder: 'תיאור הסעיף', oninput: e => { b.desc = e.target.value.replace(/\n/g, ' '); changed(); } }, b.desc || '')),
      h('div', { class: 'row', style: 'flex-wrap:nowrap' },
        h('input', { class: 'in', inputmode: 'decimal', 'aria-label': 'מחיר בש"ח', placeholder: '₪', value: Quotes.fmtAmt(b.amt), style: 'max-width:150px',
          oninput: e => { b.amt = e.target.value.replace(/,/g, '').trim(); changed(); } }),
        h('span', { class: 'muted' }, '₪'),
        h('span', { style: 'flex:1' }),
        h('button', { class: 'icon-btn', title: 'למעלה', 'aria-label': 'הזזה למעלה', onclick: () => move(-1) }, '↑'),
        h('button', { class: 'icon-btn', title: 'למטה', 'aria-label': 'הזזה למטה', onclick: () => move(1) }, '↓'),
        h('button', { class: 'icon-btn', title: 'שכפול סעיף', 'aria-label': 'שכפול סעיף', onclick: () => {
          q.blocks.splice(q.blocks.indexOf(b) + 1, 0, Quotes.makePrice(b, b.desc, b.amt)); changed(); redraw();
        } }, '⧉'),
        h('button', { class: 'icon-btn', title: 'מחיקת סעיף', 'aria-label': 'מחיקת סעיף', style: 'color:var(--danger)', onclick: () => {
          if (b.fresh) q.blocks.splice(q.blocks.indexOf(b), 1); else b.del = true;
          changed(); redraw();
        } }, '✕')));
  }

  // סעיף חדש נכנס אחרי הסעיף האחרון (באותו עיצוב ומספור)
  function lastPrice(q) {
    const ps = q.blocks.filter(x => x.kind === 'price' && !x.del);
    return ps[ps.length - 1] || q.blocks.filter(x => x.kind === 'price').pop() || q.blocks.find(x => x.kind === 'priceHead');
  }
  function insertPrice(q, desc, amt) {
    const src = lastPrice(q);
    if (!src) { U().toast('אין בתבנית הזו סעיפי מחיר. אפשר להוסיף פסקה ב"עריכת כל המסמך".', 5000); return false; }
    const nb = Quotes.makePrice(src.kind === 'price' ? src : Object.assign({}, src, { sep: '–' }), desc, amt);
    q.blocks.splice(q.blocks.indexOf(src) + 1, 0, nb);
    return true;
  }

  function pricesCard(q, changed, redraw) {
    const { h } = U();
    const ps = q.blocks.filter(x => x.kind === 'price' && !x.del);
    return h('div', { class: 'card stack' },
      h('h2', { style: 'margin:0;font-size:19px' }, 'סעיפי תמחיר'),
      ...ps.map(b => priceRow(q, b, changed, redraw)),
      ps.length ? null : h('div', { class: 'muted small' }, 'אין סעיפים'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { if (insertPrice(q, '', '')) { changed(); redraw(); } } }, '+ סעיף חדש'),
        h('button', { class: 'btn', onclick: () => pickFromLibrary(q, changed, redraw) }, '+ סעיף דומה מהרשימה')));
  }

  async function pickFromLibrary(q, changed, redraw) {
    const { h } = U();
    const lib = await priceLibrary();
    const close = () => ov.remove();
    const filter = h('input', { class: 'in', type: 'search', placeholder: 'חיפוש סעיף' });
    const list = h('div', { class: 'stack', style: 'max-height:55vh;overflow:auto' });
    const draw = () => {
      const f = filter.value.trim();
      list.replaceChildren(...lib.filter(x => !f || x.desc.includes(f)).map(x => h('button', { class: 'btn block', style: 'justify-content:space-between;text-align:right;font-weight:400;min-height:56px;height:auto;padding:8px 14px', onclick: () => {
        if (insertPrice(q, x.desc, x.amt)) { changed(); redraw(); }
        close();
      } }, h('span', { style: 'flex:1' }, x.desc, h('div', { class: 'muted small' }, x.from)), h('b', {}, x.amt ? Quotes.fmtAmt(x.amt) + ' ₪' : ''))));
    };
    filter.addEventListener('input', draw);
    const ov = h('div', { class: 'modal' },
      h('div', { class: 'card stack', style: 'max-width:600px;width:94%' },
        h('h2', { style: 'margin:0;font-size:21px' }, 'סעיף מהרשימה'),
        h('div', { class: 'muted small' }, 'הסעיפים מכל התבניות ומהצעות קודמות. אחרי ההוספה אפשר לשנות טקסט ומחיר.'),
        filter, list, h('button', { class: 'btn', onclick: close }, 'ביטול')));
    document.body.append(ov);
    draw();
  }

  // עריכת כל המסמך: כל פסקה ניתנת לעריכה, מחיקה והוספת פסקה אחריה (באותו עיצוב)
  function fullView(q, changed, redraw) {
    const { h } = U();
    const rows = [];
    for (const b of q.blocks) {
      if (b.del) continue;
      if (b.k === 'raw') { if (/<w:tbl\b/.test(b.xml)) rows.push(h('div', { class: 'muted small doc-row' }, '[טבלה מהתבנית – נשארת כמו שהיא]')); continue; }
      const tools = h('div', { class: 'doc-tools' },
        h('button', { class: 'icon-btn', title: 'פסקה חדשה אחרי זו', 'aria-label': 'הוספת פסקה אחרי זו', onclick: () => {
          const nb = b.kind === 'price' ? Quotes.makePrice(b, '', '') : Quotes.makePara(b, '');
          q.blocks.splice(q.blocks.indexOf(b) + 1, 0, nb); changed(); redraw();
        } }, '+'),
        h('button', { class: 'icon-btn', title: 'מחיקת הפסקה', 'aria-label': 'מחיקת הפסקה', style: 'color:var(--danger)', onclick: () => {
          if (b.fresh) q.blocks.splice(q.blocks.indexOf(b), 1); else b.del = true;
          changed(); redraw();
        } }, '✕'));
      let editor;
      if (b.kind === 'date') editor = h('div', { class: 'muted' }, Quotes.blockText(q, b).trim() + ' (התאריך נקבע למעלה)');
      else if (b.kind === 'image') editor = h('div', { class: 'muted' }, '🖼 ' + (b.text.trim() ? b.text.trim() + ' ' : '') + '(עם תמונה מהתבנית, חותמת / לוגו)');
      else if (b.kind === 'price') { rows.push(h('div', { class: 'doc-row' }, priceRow(q, b, changed, redraw))); continue; }
      else {
        const val = Quotes.blockText(q, b);
        editor = autoGrow(h('textarea', { class: 'in doc-text' + (b.center ? ' c' : '') + (b.bold ? ' b' : ''), rows: 1, 'aria-label': 'טקסט הפסקה', placeholder: b.ex ? 'לדוגמה: ' + b.ex : 'שורה ריקה',
          oninput: e => {
            // מרגע שעורכים פסקה כאן היא טקסט חופשי (גם אם הייתה שדה במילוי פרטים)
            if (b.kind !== 'text' && b.kind !== 'title' && b.kind !== 'priceHead') { b.kind = 'text'; }
            b.t = e.target.value; changed();
          } }, val));
      }
      rows.push(h('div', { class: 'doc-row' + (b.list ? ' li' : '') }, editor, tools));
    }
    return [h('div', { class: 'card stack' },
      h('div', { class: 'muted small' }, 'כל פסקה כאן היא פסקה במסמך. "+" מוסיף פסקה חדשה אחריה באותו עיצוב (גם בתוך רשימה), "✕" מוחק.'),
      ...rows)];
  }

  // ---------- הפקה, שליחה ושמירה ----------
  const fileName = (q, ext) => U().safeName(nameOf(q)) + ext;
  async function makeDocx(q) { return Quotes.build(await templateBytes(q.tpl), q); }
  async function makePdf(q) { return QuotePrint.toPdf(await templateBytes(q.tpl), q); }

  async function withBusy(btn, label, fn) {
    const old = btn.textContent; btn.disabled = true; btn.textContent = label;
    try { return await fn(); } catch (e) { U().toast('נכשל: ' + e.message, 6000); console.error(e); } finally { btn.disabled = false; btn.textContent = old; }
  }

  // תיקיית הסוג לפי התבנית: יציבות עצים / היתר בניה (תבנית אחרת: ישר בתוך תיקיית השנה)
  function typeFolder(q) {
    const n = (q.tplName || '') + ' ' + (q.tpl || '');
    if (/יציבות|stability/.test(n)) return 'יציבות עצים';
    if (/היתר|בני[יה]|construction/.test(n)) return 'היתר בניה';
    return null;
  }
  // הנתיב בדרייב: א עצים / הצעות מחיר / <שנת ההצעה> / <יציבות עצים או היתר בניה>. תיקיות חסרות נוצרות
  async function drivePath(q) {
    const base = String((await DB.getKV('quoteFolder', DEFAULT_FOLDER)) || DEFAULT_FOLDER).split('/').map(s => s.trim()).filter(Boolean);
    const year = (q.date || U().today()).slice(0, 4);
    return [...base, year, typeFolder(q)].filter(Boolean);
  }

  // שמירה בגוגל דרייב: קובץ PDF בתיקיית הסוג (בלי תיקייה לכל הצעה), ואם סומן גם קובץ Word.
  // have = קבצים שכבר הוכנו (כדי לא להכין שוב)
  const saveWordOn = async () => !!(await DB.getKV('quoteSaveWord', false));
  async function saveToDrive(q, quiet, have) {
    const { toast } = U();
    if (!navigator.onLine || !(await OD.connected())) { if (!quiet) toast('לא נשמר בדרייב: ' + (navigator.onLine ? 'צריך להתחבר לגוגל דרייב בהגדרות' : 'אין קליטה'), 5000); return false; }
    try {
      have = have || {};
      const files = [{ name: fileName(q, '.pdf'), blob: have.pdf || await makePdf(q) }];
      if (await saveWordOn()) files.push({ name: fileName(q, '.docx'), blob: have.docx || await makeDocx(q) });
      const path = await drivePath(q);
      const parent = await OD.path(path);
      await Promise.all(files.map(f => OD.upload(parent, f.name, f.blob, true)));
      q.savedAt = Date.now(); await saveQuote(q);
      toast('נשמר בדרייב: ' + path.join(' / '), 4000);
      return true;
    } catch (e) { toast('השמירה בדרייב נכשלה: ' + e.message, 6000); return false; }
  }

  async function share(q, via) {
    const { askChoice, toast, downloadFile } = U();
    const kind = await askChoice(via === 'mail' ? 'שליחה במייל' : 'שליחה בוואטסאפ', 'איזה קובץ לצרף?', [
      { value: 'pdf', label: 'PDF', primary: true }, { value: 'docx', label: 'Word' }, { value: 'both', label: 'שניהם' }, { value: '', label: 'ביטול' }]);
    if (!kind) return;
    const files = [];
    if (kind !== 'docx') files.push({ name: fileName(q, '.pdf'), blob: await makePdf(q) });
    if (kind !== 'pdf') files.push({ name: fileName(q, '.docx'), blob: await makeDocx(q) });
    saveToDrive(q, true, { pdf: (files.find(f => f.name.endsWith('.pdf')) || {}).blob, docx: (files.find(f => f.name.endsWith('.docx')) || {}).blob });
    const fs = files.map(f => new File([f.blob], f.name, { type: f.blob.type }));
    // ori: נושא "הצעת מחיר <שנה> <שם המוסד>", וגוף קבוע
    const inst = q.blocks.find(x => x.inst && !x.del && (x.t || '').trim());
    const subject = `הצעת מחיר ${(q.date || U().today()).slice(0, 4)} ${inst ? inst.t.trim() : nameOf(q).replace(/^הצעת מחיר\s*/, '')}`.replace(/\s+/g, ' ').trim();
    const body = 'שלום רב.\nרצ"ב הצעת מחיר, זמין לכל שאלה.';
    if (navigator.canShare && navigator.canShare({ files: fs })) {
      const data = { files: fs, title: subject };
      if (via === 'mail') data.text = body;
      try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    for (const f of files) downloadFile(f.blob, f.name);
    if (via === 'mail') location.href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    toast('הקובץ הורד. צרף אותו מתיקיית ההורדות.', 5000);
  }

  async function preview(q) {
    const { h } = U();
    // תצוגה מקדימה: אותם עמודים שמהם נוצר ה-PDF, בלי להפיק קובץ (מהיר)
    if (root.ReportPrint) await ReportPrint.preloadFonts();
    const view = PdfVec.view(await QuotePrint.pages(await templateBytes(q.tpl), q), { css: QuotePrint.CSS });
    const close = () => { ov.remove(); view.cleanup(); window.removeEventListener('hashchange', close); };
    window.addEventListener('hashchange', close);
    const ov = h('div', { class: 'pdfv' },
      h('div', { class: 'annot-bar' },
        h('button', { class: 'txt', onclick: close }, 'סגור'),
        h('span', { class: 'sp pdfv-title' }, 'תצוגה מקדימה')),
      view);
    document.body.append(ov);
  }

  function actions(q) {
    const { h, downloadFile, go, today } = U();
    const btn = (label, fn, cls) => { const b = h('button', { class: 'btn ' + (cls || ''), onclick: () => fn(b) }, label); return b; };
    return h('div', { class: 'card stack' },
      h('div', { class: 'row' },
        btn('👁 תצוגה מקדימה', b => withBusy(b, 'מכין…', () => preview(q))),
        btn('📄 PDF', b => withBusy(b, 'מכין PDF…', async () => { const blob = await makePdf(q); downloadFile(blob, fileName(q, '.pdf')); saveToDrive(q, true, { pdf: blob }); }), 'primary'),
        btn('📝 Word', b => withBusy(b, 'מכין Word…', async () => { const blob = await makeDocx(q); downloadFile(blob, fileName(q, '.docx')); if (await saveWordOn()) saveToDrive(q, true, { docx: blob }); }), 'primary')),
      h('div', { class: 'row' },
        btn('💬 וואטסאפ', b => withBusy(b, 'מכין…', () => share(q, 'wa'))),
        btn('✉ מייל', b => withBusy(b, 'מכין…', () => share(q, 'mail'))),
        btn('☁ שמירה בדרייב', b => withBusy(b, 'שומר…', () => saveToDrive(q)))),
      h('label', { class: 'row small', style: 'gap:8px' },
        h('input', { type: 'checkbox', id: 'qSaveWord', onchange: e => DB.setKV('quoteSaveWord', e.target.checked) }), 'לשמור בדרייב גם קובץ Word (חוץ מה-PDF)'),
      h('div', { class: 'muted small' }, 'כל הצעה שמופקת או נשלחת נשמרת כקובץ PDF בגוגל דרייב: ' + DEFAULT_FOLDER + ' / ' + (q.date || U().today()).slice(0, 4) + (typeFolder(q) ? ' / ' + typeFolder(q) : '') + '.'),
      h('div', { class: 'row' },
        btn('⧉ שכפול ההצעה', async () => {
          const c = JSON.parse(JSON.stringify(q));
          Object.assign(c, { id: Quotes.uid(), created: Date.now(), date: today(), name: q.name ? q.name + ' (עותק)' : '', savedAt: null });
          await saveQuote(c); go('#/quotes/' + encodeURIComponent(c.id));
        }),
        btn('🗑 מחיקה', async () => { if (!confirm('למחוק את ההצעה מהאפליקציה? (מה שנשמר בדרייב נשאר)')) return; await deleteQuote(q.id); go('#/quotes'); }, 'danger')));
  }

  root.QuotesUI = { render, templates, templateBytes };
})(self);

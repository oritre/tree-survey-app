// מסמכים ברשימת עבודה (1.116.0): אישורי כניסה וכל קובץ שצריך להראות בשטח.
// הקובץ נשמר בטאבלט (נפתח מיד, גם בלי קליטה) ומגובה לגוגל דרייב, ומשם מגיע לשאר המכשירים.
// הצפייה בתוך האפליקציה: PDF (pdf.js), תמונות, אקסל, וורד (docx), טקסט.
(function (root) {
  'use strict';
  const U = () => App.ui;
  const DIR = 'מסמכי רשימות עבודה';
  const KEY = id => 'wlDoc:' + id;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const extOf = n => ((/\.([a-z0-9]{1,5})$/i.exec(n || '') || [])[1] || '').toLowerCase();
  const kindOf = d => {
    const e = extOf(d.name), t = d.type || '';
    if (e === 'pdf' || t === 'application/pdf') return 'pdf';
    if (/^image\//.test(t) || /^(jpe?g|png|gif|webp|bmp|heic|heif)$/.test(e)) return 'image';
    if (/^(xlsx|xlsm|xltx|xltm)$/.test(e)) return 'excel';
    if (e === 'csv') return 'csv';
    if (/^(docx|dotx|docm)$/.test(e)) return 'word';
    if (/^(txt|md|json|log)$/.test(e) || /^text\//.test(t)) return 'text';
    return 'other';
  };
  const ICON = { pdf: '📕', image: '🖼', excel: '📗', csv: '📗', word: '📘', text: '📄', other: '📎' };
  const sizeText = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const live = l => (l.docs || []).filter(d => !d.deleted);

  // מיזוג בין מכשירים: לפי מזהה, הגרסה שעודכנה אחרונה
  function merge(a, b) {
    if (!(a && a.length) && !(b && b.length)) return undefined;
    const m = new Map((b || []).map(d => [d.id, d]));
    for (const d of a || []) { const x = m.get(d.id); if (!x || (d.u || 0) >= (x.u || 0)) m.set(d.id, d); }
    return [...m.values()].sort((x, y) => (x.added || 0) - (y.added || 0));
  }

  const blobs = new Map(); // במטמון של הזיכרון: פתיחה שנייה מיידית
  async function localBlob(d) {
    if (blobs.has(d.id)) return blobs.get(d.id);
    const b = await DB.getKV(KEY(d.id), null);
    if (b) blobs.set(d.id, b);
    return b;
  }
  async function getBlob(d) {
    const b = await localBlob(d);
    if (b) return b;
    if (!d.gid) throw new Error('הקובץ עוד לא הועלה לדרייב מהמכשיר שבו הוסף');
    if (navigator.onLine === false || !(await OD.connected())) throw new Error('הקובץ עוד לא ירד למכשיר הזה. צריך קליטה וחיבור לגוגל דרייב פעם אחת');
    const got = await OD.download(d.gid);
    if (!got) throw new Error('הקובץ לא נמצא בגוגל דרייב');
    const typed = got.type && got.type !== 'application/octet-stream' ? got : new Blob([got], { type: d.type || got.type });
    await DB.setKV(KEY(d.id), typed);
    blobs.set(d.id, typed);
    return typed;
  }

  async function dirOf(l) {
    const r = await OD.folder(null, (await DB.getKV('odBackupRoot', 'גיבוי אפליקציית סקרי עצים')) || 'גיבוי אפליקציית סקרי עצים');
    const d = await OD.folder(r, DIR);
    return OD.folder(d, U().safeName(l.name || 'רשימה') || 'רשימה');
  }

  // מעלה לדרייב מה שעוד לא עלה, מוריד מה שחסר במכשיר, ומפנה קבצים שנמחקו. save(l) שומר את הרשימה
  let busy = null;
  async function syncDocs(l, save, onChange) {
    if (busy) return busy;
    busy = (async () => {
      for (const d of l.docs || []) if (d.deleted && (blobs.has(d.id) || await DB.getKV(KEY(d.id), null))) { blobs.delete(d.id); await DB.delKV(KEY(d.id)).catch(() => {}); }
      if (navigator.onLine === false || !(await OD.connected())) return;
      let dir = null, changed = false;
      for (const d of live(l)) {
        try {
          if (!d.gid) {
            const b = await localBlob(d); if (!b) continue;
            dir = dir || await dirOf(l);
            const j = await OD.upload(dir, d.name, b, false);
            if (j && j.id) { d.gid = j.id; d.u = Date.now(); changed = true; }
          } else if (!(await localBlob(d))) { await getBlob(d); if (onChange) onChange(); }
        } catch (e) { console.warn('מסמך ברשימה:', d.name, e); }
      }
      if (changed) { await save(l); if (onChange) onChange(); }
    })();
    try { await busy; } finally { busy = null; }
  }

  async function addFiles(l, files, save) {
    l.docs = l.docs || [];
    for (const f of files) {
      const d = { id: uid(), name: f.name || 'מסמך', type: f.type || '', size: f.size, added: Date.now(), u: Date.now() };
      await DB.setKV(KEY(d.id), f.slice(0, f.size, f.type));
      blobs.set(d.id, f);
      l.docs.push(d);
    }
    await save(l);
  }

  // מוסיף לרשימה עותק של מסמכים מרשימות אחרות (1.165.0). הקובץ מועתק במכשיר ומגובה לתיקיית הרשימה הזו בדרייב
  async function copyDocs(l, picks, save) {
    l.docs = l.docs || [];
    let ok = 0; const bad = [];
    for (const { d: src, list } of picks) {
      try {
        const b = await getBlob(src);
        const d = { id: uid(), name: src.name, type: src.type || b.type || '', size: src.size || b.size, added: Date.now(), u: Date.now(), src: src.id, from: list.name || '' };
        await DB.setKV(KEY(d.id), b);
        blobs.set(d.id, b);
        l.docs.push(d); ok++;
      } catch (e) { bad.push(src.name + ': ' + e.message); }
    }
    if (ok) await save(l);
    return { ok, bad };
  }
  const sameDoc = (a, b) => a.id === b.id || a.src === b.id || b.src === a.id || (a.src && a.src === b.src) || (a.name === b.name && (a.size || 0) === (b.size || 0));

  // חלון חיפוש במסמכים של רשימות פעילות אחרות
  async function pickOther(l, others, onPick) {
    const ui = U(), { h } = ui;
    const lists = (await others()).filter(x => live(x).length);
    const all = lists.flatMap(list => live(list).map(d => ({ d, list, have: live(l).some(x => sameDoc(x, d)) })));
    const chosen = new Set();
    const close = () => { ov.remove(); window.removeEventListener('hashchange', close); };
    const q = h('input', { type: 'search', placeholder: 'חיפוש לפי שם מסמך או שם רשימה', style: 'flex:1', oninput: () => draw() });
    const box = h('div', { class: 'stack', style: 'max-height:55vh;overflow:auto;gap:6px' });
    const addBtn = h('button', { class: 'btn primary', onclick: async () => {
      const picks = all.filter(x => chosen.has(x));
      if (!picks.length) return;
      addBtn.disabled = true; addBtn.textContent = 'מעתיק…';
      try { await onPick(picks); close(); } finally { addBtn.disabled = false; }
    } });
    function draw() {
      const words = (q.value || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      const vis = all.filter(x => { const hay = (x.d.name + ' ' + (x.list.name || '') + ' ' + (x.list.project || '')).toLowerCase(); return words.every(w => hay.includes(w)); });
      addBtn.textContent = chosen.size ? `הוסף ${chosen.size === 1 ? 'מסמך אחד' : chosen.size + ' מסמכים'} לרשימה` : 'סמן מסמכים להוספה';
      addBtn.disabled = !chosen.size;
      if (!all.length) { box.replaceChildren(h('div', { class: 'muted' }, 'אין מסמכים ברשימות הפעילות האחרות.')); return; }
      if (!vis.length) { box.replaceChildren(h('div', { class: 'muted' }, 'לא נמצאו מסמכים בחיפוש הזה.')); return; }
      const groups = new Map();
      for (const x of vis) { if (!groups.has(x.list)) groups.set(x.list, []); groups.get(x.list).push(x); }
      box.replaceChildren(...[...groups].map(([list, xs]) => h('div', { class: 'stack', style: 'gap:4px' },
        h('div', { class: 'small', style: 'font-weight:700' }, '📋 ' + (list.name || 'רשימה') + (list.project ? ' · ' + list.project : '')),
        ...xs.map(x => h('div', { class: 'wl-doc' + (x.have ? ' muted' : '') },
          h('label', { class: 'wl-doc-open', style: 'cursor:' + (x.have ? 'default' : 'pointer') },
            h('input', { type: 'checkbox', checked: chosen.has(x), disabled: x.have, onchange: e => { e.target.checked ? chosen.add(x) : chosen.delete(x); draw(); } }),
            h('span', { class: 'wl-doc-ic', 'aria-hidden': 'true' }, ICON[kindOf(x.d)]),
            h('span', { class: 'wl-doc-name', dir: 'auto' }, x.d.name),
            h('span', { class: 'muted small' }, x.have ? 'כבר ברשימה הזו' : sizeText(x.d.size || 0))),
          h('button', { class: 'icon-btn', title: 'הצג', 'aria-label': 'הצג: ' + x.d.name, onclick: () => open(x.d) }, '👁'))))));
    }
    const ov = h('div', { class: 'modal wl-docs-pick', onclick: e => { if (e.target === ov) close(); } },
      h('div', { class: 'card stack', style: 'max-width:640px;width:96%' },
        h('h2', { style: 'margin:0;font-size:20px' }, '🔎 מסמכים מרשימות פעילות'),
        h('div', { class: 'muted small' }, 'בוחרים מסמכים שכבר נמצאים ברשימות אחרות שעוד לא הסתיימו, והם מתווספים גם לרשימה הזו (עותק, נפתח גם בלי קליטה).'),
        h('div', { class: 'row', style: 'gap:8px' }, q),
        box,
        h('div', { class: 'row', style: 'gap:8px' }, addBtn, h('button', { class: 'btn', onclick: close }, 'ביטול'))));
    window.addEventListener('hashchange', close);
    document.body.append(ov);
    draw();
    q.focus();
  }

  // ---------- תצוגה ----------
  function overlay(d, blob) {
    const { h } = U();
    let zoom = 1;
    const body = h('div', { class: 'docv-body' });
    const close = () => { ov.remove(); window.removeEventListener('hashchange', close); document.removeEventListener('keydown', esc); cleanup.forEach(f => f()); };
    const esc = e => { if (e.key === 'Escape') close(); };
    const cleanup = [];
    const setZoom = z => { zoom = Math.max(0.5, Math.min(4, z)); body.style.setProperty('--z', zoom); };
    const share = async () => {
      const file = new File([blob], d.name, { type: blob.type || d.type || 'application/octet-stream' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: d.name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      U().downloadFile(blob, d.name);
    };
    const ov = h('div', { class: 'pdfv docv', role: 'dialog', 'aria-label': d.name },
      h('div', { class: 'annot-bar' },
        h('button', { class: 'txt', onclick: close }, 'סגור'),
        h('span', { class: 'sp pdfv-title' }, d.name),
        h('button', { class: 'txt', title: 'הקטן', 'aria-label': 'הקטן', onclick: () => setZoom(zoom / 1.25) }, '−'),
        h('button', { class: 'txt', title: 'הגדל', 'aria-label': 'הגדל', onclick: () => setZoom(zoom * 1.25) }, '+'),
        h('button', { class: 'txt', title: 'שיתוף', 'aria-label': 'שיתוף', onclick: share }, '✉'),
        h('button', { class: 'txt', title: 'הורדה', 'aria-label': 'הורדה', onclick: () => U().downloadFile(blob, d.name) }, '⬇')),
      body);
    window.addEventListener('hashchange', close);
    document.addEventListener('keydown', esc);
    document.body.append(ov);
    return { body, cleanup, h, share };
  }

  async function open(d) {
    let blob;
    try { blob = await getBlob(d); } catch (e) { U().toast(e.message, 4500); return; }
    const { body, cleanup, h, share } = overlay(d, blob);
    const k = kindOf(d);
    const msg = t => h('div', { class: 'docv-msg' }, t);
    try {
      if (k === 'image') {
        const u = URL.createObjectURL(blob); cleanup.push(() => URL.revokeObjectURL(u));
        body.append(h('img', { class: 'docv-page', src: u, alt: d.name }));
      } else if (k === 'pdf') await showPdf(body, blob, h);
      else if (k === 'excel' || k === 'csv') await showSheets(body, blob, k, h);
      else if (k === 'word') await showWord(body, blob, h, cleanup);
      else if (k === 'text') body.append(h('pre', { class: 'docv-sheet docv-text', dir: 'auto' }, await blob.text()));
      else body.append(msg('אי אפשר להציג את סוג הקובץ הזה בתוך האפליקציה.'), h('button', { class: 'btn primary', onclick: share }, 'פתח באפליקציה אחרת'));
    } catch (e) {
      console.error(e);
      body.replaceChildren(msg('לא הצלחתי להציג את הקובץ: ' + e.message), h('button', { class: 'btn primary', onclick: share }, 'פתח באפליקציה אחרת'));
    }
  }

  let pdfP = null;
  function pdfjs() {
    if (pdfP) return pdfP;
    const base = new URL('vendor/pdfjs/', root.location.href).href;
    pdfP = import(base + 'pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs'; return m; })
      .catch(e => { pdfP = null; throw new Error('קורא ה-PDF לא נטען (צריך קליטה בפעם הראשונה): ' + e.message); });
    return pdfP;
  }
  async function showPdf(body, blob, h) {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    const W = Math.min(1400, Math.max(600, (body.clientWidth || innerWidth) - 20)) * Math.min(2, devicePixelRatio || 1) * 1.5;
    // עמוד אחרי עמוד: הראשון מופיע מיד
    for (let i = 1; i <= doc.numPages; i++) {
      if (!body.isConnected) break;
      const page = await doc.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: W / vp1.width });
      const c = h('canvas', { class: 'docv-page', width: Math.round(vp.width), height: Math.round(vp.height), 'aria-label': `עמוד ${i}` });
      c.style.aspectRatio = vp.width + ' / ' + vp.height;
      body.append(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
    doc.destroy && doc.destroy();
  }

  const colName = n => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
  const cellStr = v => v == null ? '' : typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
  async function showSheets(body, blob, k, h) {
    let sheets;
    if (k === 'csv') {
      const text = await blob.text();
      const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
      sheets = [{ name: 'CSV', rows: text.split(/\r?\n/).map(r => r.split(sep)) }];
    } else sheets = await Importer.readTable(await blob.arrayBuffer());
    sheets = sheets.map(s => {
      const rows = s.rows.map(r => [...(r || [])].map(cellStr));
      while (rows.length && rows[rows.length - 1].every(v => !v)) rows.pop();
      const cols = Math.max(0, ...rows.map(r => { let n = r.length; while (n && !r[n - 1]) n--; return n; }));
      return { name: s.name, rows, cols };
    }).filter(s => s.rows.length);
    if (!sheets.length) { body.append(h('div', { class: 'docv-msg' }, 'הגיליון ריק')); return; }
    const box = h('div', { class: 'docv-sheet' });
    const tabs = h('div', { class: 'project-chips docv-tabs' });
    const show = i => {
      const s = sheets[i];
      tabs.querySelectorAll('.chip').forEach((c, j) => c.classList.toggle('on', j === i));
      box.replaceChildren(h('table', { class: 'docv-table' },
        h('thead', {}, h('tr', {}, h('th', {}), ...Array.from({ length: s.cols }, (_, c) => h('th', {}, colName(c))))),
        h('tbody', {}, s.rows.map((r, i) => h('tr', {}, h('th', {}, i + 1), ...Array.from({ length: s.cols }, (_, c) => h('td', { dir: 'auto' }, r[c] || '')))))));
    };
    if (sheets.length > 1) tabs.append(...sheets.map((s, i) => h('button', { class: 'chip', onclick: () => show(i) }, s.name)));
    body.append(tabs, box);
    show(0);
  }

  // ---------- וורד (docx) ל-HTML: פסקאות, הדגשות, יישור, טבלאות ותמונות ----------
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  async function showWord(body, blob, h, cleanup) {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const read = async p => { const f = zip.file(p); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
    const doc = await read('word/document.xml');
    if (!doc) throw new Error('זה לא קובץ וורד תקין');
    const rels = await read('word/_rels/document.xml.rels');
    const target = {};
    if (rels) for (const r of rels.getElementsByTagName('Relationship')) target[r.getAttribute('Id')] = r.getAttribute('Target');
    const imgUrl = async rid => {
      let t = target[rid]; if (!t) return null;
      t = t.startsWith('/') ? t.slice(1) : 'word/' + t.replace(/^\.\//, '');
      const f = zip.file(t); if (!f) return null;
      const e = extOf(t), type = e === 'png' ? 'image/png' : e === 'gif' ? 'image/gif' : /^jpe?g$/.test(e) ? 'image/jpeg' : e === 'svg' ? 'image/svg+xml' : '';
      if (!type) return null; // emf/wmf: הדפדפן לא מציג
      const u = URL.createObjectURL(new Blob([await f.async('uint8array')], { type }));
      cleanup.push(() => URL.revokeObjectURL(u));
      return u;
    };
    const kids = (el, name) => [...el.childNodes].filter(n => n.nodeType === 1 && (!name || n.localName === name));
    const kid = (el, name) => kids(el, name)[0] || null;
    const val = el => el && (el.getAttributeNS(W_NS, 'val') || el.getAttribute('w:val'));
    const on = el => !!el && !/^(0|false|off|none)$/.test(val(el) || '');
    async function runs(el, out) {
      for (const n of kids(el)) {
        const ln = n.localName;
        if (ln === 'r') {
          const pr = kid(n, 'rPr');
          let css = '';
          if (pr) {
            if (on(kid(pr, 'b')) || on(kid(pr, 'bCs'))) css += 'font-weight:700;';
            if (on(kid(pr, 'i')) || on(kid(pr, 'iCs'))) css += 'font-style:italic;';
            if (kid(pr, 'u') && val(kid(pr, 'u')) !== 'none') css += 'text-decoration:underline;';
            const sz = val(kid(pr, 'szCs')) || val(kid(pr, 'sz'));
            if (sz) css += `font-size:${(+sz / 2 / 11).toFixed(2)}em;`;
            const col = val(kid(pr, 'color'));
            if (col && /^[0-9a-f]{6}$/i.test(col) && col !== '000000') css += `color:#${col};`;
            const hl = val(kid(pr, 'highlight'));
            if (hl && hl !== 'none') css += `background:${hl};`;
          }
          const span = h('span', css ? { style: css } : {});
          for (const c of kids(n)) {
            if (c.localName === 't') span.append(c.textContent);
            else if (c.localName === 'tab') span.append(' ');
            else if (c.localName === 'br' || c.localName === 'cr') span.append(h('br'));
            else if (c.localName === 'drawing' || c.localName === 'pict') {
              for (const b of [...c.getElementsByTagName('*')].filter(x => x.localName === 'blip' || x.localName === 'imagedata')) {
                const u = await imgUrl(b.getAttributeNS(R_NS, 'embed') || b.getAttributeNS(R_NS, 'id') || b.getAttribute('r:embed') || b.getAttribute('r:id'));
                if (u) span.append(h('img', { src: u, alt: '', class: 'docv-img' }));
              }
              for (const tb of [...c.getElementsByTagName('*')].filter(x => x.localName === 'txbxContent')) { const box = h('div', { class: 'docv-txbx' }); await blocks(tb, box); span.append(box); }
            }
          }
          if (span.childNodes.length) out.append(span);
        } else if (['hyperlink', 'ins', 'smartTag', 'fldSimple', 'sdt', 'sdtContent', 'customXml'].includes(ln)) await runs(n, out);
      }
    }
    async function para(p) {
      const pr = kid(p, 'pPr');
      const style = pr ? val(kid(pr, 'pStyle')) || '' : '';
      const jc = pr ? val(kid(pr, 'jc')) : '';
      const bidi = pr && kid(pr, 'bidi') ? on(kid(pr, 'bidi')) : null;
      const hm = /heading\s*(\d)|^(\d)$|title/i.exec(style);
      const el = h(hm ? 'h' + Math.min(4, +(hm[1] || hm[2] || 1) + 1) : 'p', { class: 'docv-p', dir: bidi === true ? 'rtl' : bidi === false ? 'ltr' : 'auto' });
      const align = { center: 'center', both: 'justify', distribute: 'justify', left: bidi ? 'right' : 'left', right: bidi ? 'left' : 'right', start: 'start', end: 'end' }[jc];
      if (align) el.style.textAlign = align;
      if (pr && kid(pr, 'numPr')) el.prepend('• ');
      await runs(p, el);
      if (!el.textContent.trim() && !el.querySelector('img')) el.append(h('br'));
      return el;
    }
    async function table(t) {
      const tb = h('tbody');
      for (const tr of kids(t, 'tr')) {
        const row = h('tr');
        for (const tc of kids(tr, 'tc')) {
          const pr = kid(tc, 'tcPr');
          const vm = pr && kid(pr, 'vMerge');
          if (vm && val(vm) !== 'restart') continue; // המשך של תא ממוזג לגובה
          const span = pr && val(kid(pr, 'gridSpan'));
          const td = h('td', span > 1 ? { colspan: span } : {});
          await blocks(tc, td);
          row.append(td);
        }
        tb.append(row);
      }
      return h('table', { class: 'docv-wtable' }, tb);
    }
    async function blocks(el, out) {
      for (const n of kids(el)) {
        if (n.localName === 'p') out.append(await para(n));
        else if (n.localName === 'tbl') out.append(await table(n));
        else if (['sdt', 'sdtContent', 'customXml'].includes(n.localName)) await blocks(n, out);
      }
    }
    const page = h('div', { class: 'docv-word' });
    await blocks(kid(doc.documentElement, 'body') || doc.documentElement, page);
    body.append(page);
  }

  // ---------- חלק במסך הרשימה ----------
  // others(): רשימות פעילות אחרות (לא הסתיימו), לחיפוש מסמכים שכבר הוספו שם
  function section(l, save, others) {
    const ui = U(), { h } = ui;
    const box = h('div', { class: 'card stack wl-docs' });
    const input = h('input', { type: 'file', multiple: true, class: 'hidden' });
    input.addEventListener('change', async () => {
      const fs = [...input.files]; input.value = '';
      if (!fs.length) return;
      add(fs);
    });
    let open_ = null;
    const KV = 'wlDocsOpen:' + l.id;
    function draw() {
      const ds = live(l);
      if (open_ == null) open_ = true;
      const head = h('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap' },
        h('button', { class: 'link-btn', style: 'font-weight:700;font-size:16px', 'aria-expanded': open_ ? 'true' : 'false', onclick: () => { open_ = !open_; DB.setKV(KV, open_).catch(() => {}); draw(); } },
          (open_ ? '▾ ' : '▸ ') + `📁 מסמכים (${ds.length})`),
        h('span', { class: 'muted small', style: 'flex:1' }, 'אישורי כניסה וכל מה שצריך להראות. נפתח בתוך האפליקציה, גם בלי קליטה'),
        h('button', { class: 'btn', title: 'קובץ מהזיכרון של המכשיר', onclick: () => input.click() }, '➕ הוסף מהמכשיר'),
        others ? h('button', { class: 'btn', title: 'מסמך שכבר נמצא ברשימה פעילה אחרת', onclick: () => pickOther(l, others, fromOthers) }, '🔎 מרשימות אחרות') : '');
      if (!open_) { box.replaceChildren(head, input); return; }
      const item = d => {
        const k = kindOf(d);
        const pending = !d.gid;
        return h('div', { class: 'wl-doc' },
          h('button', { class: 'wl-doc-open', title: 'פתח', onclick: ev => { ev.currentTarget.disabled = true; open(d).finally(() => { ev.currentTarget && (ev.currentTarget.disabled = false); }); } },
            h('span', { class: 'wl-doc-ic', 'aria-hidden': 'true' }, ICON[k]),
            h('span', { class: 'wl-doc-name', dir: 'auto' }, d.name),
            h('span', { class: 'muted small' }, sizeText(d.size || 0) + (d.from ? ' · מהרשימה ' + d.from : '') + (pending ? ' · ממתין לגיבוי בדרייב' : ''))),
          h('button', { class: 'icon-btn', title: 'שנה שם', 'aria-label': 'שנה שם: ' + d.name, onclick: async () => {
            const e = extOf(d.name);
            const n = prompt('שם המסמך', e ? d.name.slice(0, -(e.length + 1)) : d.name);
            if (n == null || !n.trim()) return;
            d.name = ui.safeName(n.trim()) + (e ? '.' + e : ''); d.u = Date.now(); await save(l); draw();
            if (d.gid && await OD.connected().catch(() => false)) OD.rename(d.gid, d.name).catch(() => {});
          } }, '✎'),
          h('button', { class: 'icon-btn', title: 'מחק', 'aria-label': 'מחק: ' + d.name, onclick: async () => {
            if (!confirm(`למחוק את "${d.name}" מהרשימה? (בכל המכשירים. העותק בגוגל דרייב נשאר)`)) return;
            d.deleted = Date.now(); d.u = Date.now(); blobs.delete(d.id); DB.delKV(KEY(d.id)).catch(() => {});
            await save(l); draw();
          } }, '✕'));
      };
      box.replaceChildren(head, input,
        ds.length ? h('div', { class: 'wl-doc-list' }, ds.map(item))
          : h('div', { class: 'muted small' }, 'אין עדיין מסמכים. אפשר להוסיף PDF, אקסל, וורד, תמונות וכל קובץ אחר, או לגרור קבצים לכאן.'));
    }
    DB.getKV(KV, true).then(v => { open_ = v !== false; draw(); }).catch(() => draw());
    draw();
    const add = async files => { await addFiles(l, files, save); open_ = true; draw(); ui.toast(files.length > 1 ? `נוספו ${files.length} מסמכים` : 'המסמך נוסף', 2500); syncDocs(l, save, draw); };
    const fromOthers = async picks => {
      const { ok, bad } = await copyDocs(l, picks, save);
      open_ = true; draw();
      if (ok) ui.toast(ok > 1 ? `נוספו ${ok} מסמכים` : 'המסמך נוסף', 2500);
      if (bad.length) ui.toast(`${bad.length} לא נוספו: ` + bad.join(' · '), 6000);
      if (ok) syncDocs(l, save, draw);
    };
    syncDocs(l, save, draw);
    // PDF בלי קליטה: טוענים את קורא ה-PDF למטמון כבר עכשיו
    if (live(l).some(d => kindOf(d) === 'pdf') && navigator.onLine !== false) pdfjs().catch(() => {});
    return { el: box, redraw: draw, add };
  }

  root.ListDocs = { section, merge, open, syncDocs, _t: { kindOf, merge, copyDocs, sameDoc } };
})(window);

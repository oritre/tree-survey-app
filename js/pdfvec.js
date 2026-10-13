// PDF אמיתי (טקסט וקווים וקטוריים, לא תמונה של העמוד): העמודים נבנים ב-HTML כרגיל, הדפדפן מסדר אותם,
// ואז כל אות, רקע, קו ותמונה נכתבים לקובץ PDF במיקום המדויק שבו הדפדפן צייר אותם (pdf-lib + גופן Arimo מוטמע).
// כך הטקסט חד בכל הגדלה, אפשר לסמן ולחפש בו, והקובץ קטן.
(function (root) {
  'use strict';
  const LIBS = ['vendor/pdf-lib.min.js', 'vendor/fontkit.umd.min.js'];
  const FONTS = {
    400: ['fonts/arimo-hebrew-400.ttf', 'fonts/arimo-latin-400.ttf'],
    700: ['fonts/arimo-hebrew-700.ttf', 'fonts/arimo-latin-700.ttf'],
  };
  // המרחק מראש תיבת האות לקו הבסיס, ביחס לגודל הגופן (נמדד בדפדפן עצמו, כי הוא תלוי במערכת)
  let ASC = 1854 / 2048;
  function measureAscent(holder) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:0;top:0;font-family:RepArial,Arial,sans-serif;font-size:100px;line-height:normal;white-space:nowrap';
    probe.innerHTML = '<span>Hא</span><span style="display:inline-block;width:1px;height:0;vertical-align:baseline"></span>';
    holder.append(probe);
    const r = document.createRange(); r.setStart(probe.firstChild.firstChild, 0); r.setEnd(probe.firstChild.firstChild, 1);
    const t = r.getClientRects()[0], b = probe.lastChild.getBoundingClientRect();
    if (t && b) ASC = (b.bottom - t.top) / 100;
    probe.remove();
  }
  const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' };
  const SKIP = /[\s​-‏‪-‮⁠-⁩﻿­]/;

  // הספריות נטענות רק כשמפיקים PDF בפעם הראשונה (הן גדולות), ונשמרות במטמון לעבודה בלי קליטה
  let libP = null;
  function loadLibs() {
    if (root.PDFLib && root.fontkit) return Promise.resolve();
    return libP || (libP = LIBS.reduce((p, src) => p.then(() => new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => { libP = null; rej(new Error('טעינת רכיב ה-PDF נכשלה')); };
      document.head.append(s);
    })), Promise.resolve()));
  }
  const fontBytes = {};
  const getBytes = u => fontBytes[u] || (fontBytes[u] = fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.arrayBuffer(); }));

  function parseColor(c) {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    const a = p.length > 3 ? p[3] : 1;
    if (!(a > 0.01)) return null;
    return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a };
  }

  // מלבן החיתוך של אלמנט (overflow hidden של האבות), כדי שטקסט שנחתך בתא לא יופיע ב-PDF
  function clipOf(el, stop, cache) {
    if (!el || el === stop) return null;
    if (cache.has(el)) return cache.get(el);
    let c = clipOf(el.parentElement, stop, cache);
    const cs = getComputedStyle(el);
    if (cs.overflow !== 'visible' || cs.overflowX !== 'visible') {
      const r = el.getBoundingClientRect();
      c = c ? { l: Math.max(c.l, r.left), t: Math.max(c.t, r.top), r: Math.min(c.r, r.right), b: Math.min(c.b, r.bottom) } : { l: r.left, t: r.top, r: r.right, b: r.bottom };
    }
    cache.set(el, c);
    return c;
  }

  // אוסף מה לצייר בעמוד: רקעים, מסגרות, תמונות וטקסט (אות אחר אות, במיקום שהדפדפן קבע)
  function collect(page) {
    const base = page.getBoundingClientRect();
    const out = { w: base.width, h: base.height, fills: [], lines: [], imgs: [], chars: [] };
    const cache = new Map();
    const els = [page, ...page.querySelectorAll('*')];
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const x = r.left - base.left, y = r.top - base.top;
      const bg = parseColor(cs.backgroundColor);
      if (bg && el !== page) out.fills.push({ x, y, w: r.width, h: r.height, c: bg });
      for (const [side, bx, by, bw, bh] of [
        ['Top', x, y, r.width, null], ['Bottom', x, y + r.height, r.width, null],
        ['Left', x, y, null, r.height], ['Right', x + r.width, y, null, r.height]]) {
        const w = parseFloat(cs[`border${side}Width`]);
        if (!(w > 0) || cs[`border${side}Style`] === 'none') continue;
        const c = parseColor(cs[`border${side}Color`]);
        if (!c) continue;
        // הקו בתוך גבולות האלמנט, כמו בדפדפן
        if (bw != null) out.lines.push({ x: bx, y: side === 'Top' ? by : by - w, w: bw, h: w, c });
        else out.lines.push({ x: side === 'Left' ? bx : bx - w, y: by, w, h: bh, c });
      }
      if (el.tagName === 'IMG' && el.naturalWidth) {
        let w = r.width, h = r.height, ix = x, iy = y;
        if (cs.objectFit === 'contain') {
          const k = Math.min(r.width / el.naturalWidth, r.height / el.naturalHeight);
          w = el.naturalWidth * k; h = el.naturalHeight * k; ix = x + (r.width - w) / 2; iy = y + (r.height - h) / 2;
        }
        out.imgs.push({ src: el.currentSrc || el.src, x: ix, y: iy, w, h });
      }
    }
    // טקסט
    const tw = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = tw.nextNode(); node; node = tw.nextNode()) {
      const text = node.data;
      if (!text || !text.trim()) continue;
      const el = node.parentElement;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const size = parseFloat(cs.fontSize);
      const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
      const color = parseColor(cs.color) || { r: 0, g: 0, b: 0, a: 1 };
      const under = /underline/.test(cs.textDecorationLine || cs.textDecoration || '');
      const clip = clipOf(el, page.parentElement, cache);
      const rects = [];
      for (let i = 0; i < text.length; i++) {
        range.setStart(node, i); range.setEnd(node, i + 1);
        const rs = range.getClientRects();
        rects.push(rs.length ? rs[0] : null);
      }
      for (let i = 0; i < text.length; i++) {
        let ch = text[i];
        const rc = rects[i];
        if (!rc || SKIP.test(ch)) continue;
        if (clip) { const cx = (rc.left + rc.right) / 2, cy = (rc.top + rc.bottom) / 2; if (cx < clip.l - 0.5 || cx > clip.r + 0.5 || cy < clip.t - 0.5 || cy > clip.b + 0.5) continue; }
        // סוגריים בתוך טקסט מימין לשמאל מוצגים הפוכים (כמו בדפדפן)
        if (MIRROR[ch]) {
          const nx = rects.slice(i + 1).find(Boolean), pv = rects.slice(0, i).reverse().find(Boolean);
          const rtl = (nx && nx.left < rc.left - 0.1) || (pv && pv.left > rc.left + 0.1);
          if (rtl) ch = MIRROR[ch];
        }
        out.chars.push({ ch, x: rc.left - base.left, r: rc.right - base.left, top: rc.top - base.top, base: rc.top - base.top + ASC * size, size, bold, color, under, node: node, i });
      }
    }
    return out;
  }

  // מחבר אותיות סמוכות באותה שורה למילה אחת (בסדר הויזואלי משמאל לימין)
  function runs(chars) {
    const sorted = chars.slice().sort((a, b) => (Math.abs(a.base - b.base) < 0.5 ? a.x - b.x : a.base - b.base));
    const out = [];
    for (const c of sorted) {
      const last = out[out.length - 1];
      if (last && last.node === c.node && Math.abs(last.base - c.base) < 0.5 && last.size === c.size && last.bold === c.bold && last.font === c.font && Math.abs(c.x - last.r) < 0.6) {
        last.text += c.ch; last.r = c.r;
      } else out.push({ text: c.ch, x: c.x, r: c.r, base: c.base, size: c.size, bold: c.bold, color: c.color, under: c.under, font: c.font, node: c.node });
    }
    return out;
  }

  async function imageBytes(src) {
    const res = await fetch(src);
    const blob = await res.blob();
    const b = new Uint8Array(await blob.arrayBuffer());
    if (b[0] === 0x89 && b[1] === 0x50) return { png: b };
    if (b[0] === 0xFF && b[1] === 0xD8) return { jpg: b };
    // סוג אחר (webp וכו'): ממירים ל-PNG
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    return { png: new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer()) };
  }

  // pages: מחרוזות HTML של עמודים (כל אחד אלמנט אחד בגודל העמוד). css: העיצוב שלהם. rootId: מזהה לעוטף (לסלקטורים כמו #printRoot)
  async function fromHtml(pages, opts) {
    opts = opts || {};
    await loadLibs();
    const { PDFDocument, rgb, PageSizes } = root.PDFLib;
    const holder = document.createElement('div');
    if (opts.rootId) holder.id = opts.rootId;
    holder.style.cssText = 'display:block;position:fixed;left:-100000px;top:0;width:2000px;pointer-events:none';
    holder.innerHTML = (opts.css ? `<style>${opts.css}</style>` : '') + pages.join('');
    document.body.append(holder);
    try {
      if (document.fonts && document.fonts.ready) {
        await Promise.all(['400 12px RepArial', '700 12px RepArial'].map(f => document.fonts.load(f, 'אבג abc 123').catch(() => {})));
        await document.fonts.ready;
      }
      await Promise.all([...holder.querySelectorAll('img')].map(im => (im.decode ? im.decode() : Promise.resolve()).catch(() => {})));
      const pageEls = [...holder.children].filter(e => e.tagName !== 'STYLE');
      measureAscent(holder);

      const doc = await PDFDocument.create();
      doc.registerFontkit(root.fontkit);
      const fonts = {};
      for (const w of [400, 700]) {
        fonts[w] = [];
        for (const u of FONTS[w]) {
          const f = await doc.embedFont(await getBytes(u), { subset: true });
          fonts[w].push({ f, set: new Set(f.getCharacterSet()) });
        }
      }
      const fontFor = (ch, bold) => {
        const list = fonts[bold ? 700 : 400], cp = ch.codePointAt(0);
        return (list.find(x => x.set.has(cp)) || {}).f || null;
      };
      const imgCache = new Map();
      const embedImg = src => {
        if (!imgCache.has(src)) imgCache.set(src, imageBytes(src).then(b => b.png ? doc.embedPng(b.png) : doc.embedJpg(b.jpg)).catch(() => null));
        return imgCache.get(src);
      };

      for (const el of pageEls) {
        const data = collect(el);
        const k = (opts.widthPt || data.w * 0.75) / data.w; // פיקסלים -> נקודות
        const W = data.w * k, H = data.h * k;
        const page = doc.addPage([W, H]);
        const col = c => rgb(c.r, c.g, c.b);
        const box = (o, extra) => page.drawRectangle(Object.assign({ x: o.x * k, y: H - (o.y + o.h) * k, width: o.w * k, height: o.h * k, color: col(o.c), opacity: o.c.a, borderWidth: 0 }, extra || {}));
        for (const f of data.fills) box(f);
        for (const im of data.imgs) {
          const img = await embedImg(im.src);
          if (img) page.drawImage(img, { x: im.x * k, y: H - (im.y + im.h) * k, width: im.w * k, height: im.h * k });
        }
        for (const l of data.lines) box(l);
        for (const c of data.chars) c.font = fontFor(c.ch, c.bold);
        for (const r of runs(data.chars)) {
          const opt = { x: r.x * k, y: H - r.base * k, size: r.size * k, color: col(r.color), opacity: r.color.a };
          // fontkit מסדר בעצמו טקסט עברי מימין לשמאל, ולכן מקבל את המילה בסדר הכתיבה (הפוך מהסדר הויזואלי)
          if (r.font) page.drawText(/[\u0590-\u05FF\uFB1D-\uFB4F]/.test(r.text) ? [...r.text].reverse().join('') : r.text, Object.assign(opt, { font: r.font }));
          else if (r.text === '•' || /^•+$/.test(r.text)) page.drawCircle({ x: (r.x + r.r) / 2 * k, y: H - (r.base - r.size * 0.33) * k, size: r.size * 0.17 * k, color: col(r.color) });
          if (r.under) page.drawRectangle({ x: r.x * k, y: H - (r.base + r.size * 0.12) * k, width: (r.r - r.x) * k, height: Math.max(0.4, r.size * 0.06 * k), color: col(r.color) });
        }
      }
      const bytes = await doc.save();
      return new Blob([bytes], { type: 'application/pdf' });
    } finally { holder.remove(); }
  }

  // תצוגה של העמודים בתוך האפליקציה (בלי לפענח את ה-PDF): אותו HTML שממנו נוצר הקובץ, מוקטן לרוחב המסך
  function view(pages, opts) {
    opts = opts || {};
    const box = document.createElement('div');
    box.style.cssText = 'flex:1;overflow:auto;padding:10px;-webkit-overflow-scrolling:touch';
    const inner = document.createElement('div');
    if (opts.rootId) inner.id = opts.rootId;
    inner.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;width:100%';
    inner.innerHTML = (opts.css ? `<style>${opts.css}</style>` : '') + pages.map(p => `<div class="pv-wrap" style="width:100%;max-width:900px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.5);overflow:hidden">${p}</div>`).join('');
    box.append(inner);
    const fit = () => {
      for (const w of inner.querySelectorAll('.pv-wrap')) {
        const pg = w.firstElementChild;
        if (!pg) continue;
        pg.style.zoom = '';
        const k = w.clientWidth / pg.offsetWidth;
        if (k > 0) { pg.style.zoom = String(k); w.style.height = pg.offsetHeight * k + 'px'; }
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(fit));
    window.addEventListener('resize', fit);
    box.cleanup = () => window.removeEventListener('resize', fit);
    return box;
  }

  root.PdfVec = { fromHtml, loadLibs, view };
})(self);

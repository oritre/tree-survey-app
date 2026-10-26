// ציור על תמונה: קווים חופשיים, קו ישר וחץ, בכמה צבעים. הקווים נשמרים כווקטורים
// (בקואורדינטות יחסיות 0..1) כדי שאפשר יהיה לפתוח שוב, לבטל או למחוק בלי לאבד את המקור
(function (root) {
  'use strict';
  const COLORS = ['#ff1f1f', '#ffd400', '#ffffff', '#1e90ff', '#000000'];
  const WIDTHS = [0.004, 0.008, 0.014]; // יחסית לצלע הארוכה של התמונה

  function drawStroke(ctx, s, W, H) {
    const lw = s.w * Math.max(W, H);
    ctx.strokeStyle = s.c; ctx.fillStyle = s.c; ctx.lineWidth = lw;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const P = s.p.map(([x, y]) => [x * W, y * H]);
    if (!P.length) return;
    ctx.beginPath();
    if (s.t === 'free') {
      ctx.moveTo(P[0][0], P[0][1]);
      if (P.length === 1) ctx.lineTo(P[0][0] + 0.01, P[0][1]);
      for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]);
      ctx.stroke();
      return;
    }
    const [a, b] = [P[0], P[P.length - 1]];
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    if (s.t === 'arrow') {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = lw * 4.5;
      ctx.beginPath();
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - len * Math.cos(ang - 0.45), b[1] - len * Math.sin(ang - 0.45));
      ctx.lineTo(b[0] - len * Math.cos(ang + 0.45), b[1] - len * Math.sin(ang + 0.45));
      ctx.closePath(); ctx.fill();
    }
  }

  // כפתור החזרה של הטאבלט סוגר את המסך העליון (מצלמה / סימון) במקום לצאת למסך הראשי.
  // push(fn) מוסיף רשומה בהיסטוריה; fn נקרא כשלוחצים חזרה. מחזיר release() לסגירה רגילה מהכפתורים
  const BackGuard = (() => {
    const stack = [];
    let skip = 0;
    window.addEventListener('popstate', () => {
      if (skip) { skip--; return; }
      const fn = stack.pop();
      if (fn) fn();
    });
    return {
      push(fn) {
        history.pushState({ backGuard: stack.length + 1 }, '', location.href);
        stack.push(fn);
        return () => {
          const i = stack.indexOf(fn);
          if (i < 0) return; // כבר נסגר בכפתור החזרה
          stack.splice(i, 1);
          skip++;
          history.back();
        };
      },
    };
  })();

  function render(ctx, img, strokes, W, H) {
    ctx.drawImage(img, 0, 0, W, H);
    for (const s of strokes) drawStroke(ctx, s, W, H);
  }

  // מצייר את הקווים על התמונה המקורית בגודל מלא ומחזיר JPEG
  async function flatten(blob, strokes) {
    const img = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    render(c.getContext('2d'), img, strokes, c.width, c.height);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
  }

  // פותח עורך במסך מלא. מחזיר את רשימת הקווים (ריקה אם לא סימנו), null אם בוטל (גם בכפתור החזרה), או 'retake' (עם opts.retakeLabel) לצילום מחדש
  function open(blob, strokes, opts) {
    opts = opts || {};
    return new Promise(async resolve => {
      const img = await createImageBitmap(blob);
      let list = (strokes || []).map(s => JSON.parse(JSON.stringify(s)));
      const redo = [];
      let tool = 'free', color = COLORS[0], width = WIDTHS[1], cur = null;

      const ov = document.createElement('div');
      ov.className = 'annot';
      ov.innerHTML = `
        <div class="annot-bar">
          <div class="grp" data-g="tool">
            <button data-tool="free" title="ציור חופשי">✏️</button>
            <button data-tool="line" title="קו ישר">／</button>
            <button data-tool="arrow" title="חץ">➚</button>
          </div>
          <div class="grp" data-g="color">${COLORS.map(c => `<button data-color="${c}" style="--c:${c}" class="sw" title="צבע"></button>`).join('')}</div>
          <div class="grp" data-g="width">${WIDTHS.map((w, i) => `<button data-width="${w}" title="עובי"><i style="height:${3 + i * 4}px"></i></button>`).join('')}</div>
          <div class="grp">
            <button data-act="undo" title="בטל">↶</button>
            <button data-act="redo" title="חזור">↷</button>
            <button data-act="clear" title="מחק הכל">🧽</button>
            <button data-act="fit" title="חזרה לגודל מלא" hidden>⤢</button>
          </div>
          <span class="sp"></span>
          ${opts.retakeLabel ? `<button data-act="retake" class="txt">${opts.retakeLabel}</button>` : ''}
          <button data-act="cancel" class="txt">${opts.cancelLabel || 'ביטול'}</button>
          <button data-act="save" class="txt save">${opts.saveLabel || 'שמור'}</button>
        </div>
        <div class="annot-stage"><canvas></canvas></div>`;
      document.body.append(ov);
      const stage = ov.querySelector('.annot-stage');
      const cv = ov.querySelector('canvas');
      const ctx = cv.getContext('2d');
      let W = 0, H = 0;

      // הגדלה בצביטה של שתי אצבעות: zoom והזזה (tx, ty) כ-CSS transform על הקנבס; אחרי הצביטה הקנבס מצויר מחדש ברזולוציה מתאימה
      let zoom = 1, tx = 0, ty = 0;
      function applyZoom() {
        cv.style.transform = zoom > 1 ? `translate(${tx}px, ${ty}px) scale(${zoom})` : '';
        ov.querySelector('[data-act=fit]').hidden = zoom <= 1;
      }
      function resize() {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        // לא יותר מהרזולוציה של התמונה עצמה ולא יותר מ-16 מגה-פיקסל
        const k = Math.min(dpr * zoom, img.width / W, Math.sqrt(16e6 / (W * H)));
        const nw = Math.round(W * Math.max(dpr, k)), nh = Math.round(H * Math.max(dpr, k));
        if (nw !== cv.width || nh !== cv.height) { cv.width = nw; cv.height = nh; }
        draw();
      }
      function layout() {
        const r = stage.getBoundingClientRect();
        const s = Math.min((r.width - 16) / img.width, (r.height - 16) / img.height);
        W = Math.max(1, Math.round(img.width * s)); H = Math.max(1, Math.round(img.height * s));
        cv.style.width = W + 'px'; cv.style.height = H + 'px';
        zoom = 1; tx = ty = 0; applyZoom();
        resize();
      }
      function draw() {
        render(ctx, img, cur ? list.concat([cur]) : list, cv.width, cv.height);
      }
      function sync() {
        ov.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
        ov.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('on', b.dataset.color === color));
        ov.querySelectorAll('[data-width]').forEach(b => b.classList.toggle('on', +b.dataset.width === width));
        ov.querySelector('[data-act=undo]').disabled = !list.length;
        ov.querySelector('[data-act=redo]').disabled = !redo.length;
      }
      const pt = e => {
        const r = cv.getBoundingClientRect();
        return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
      };
      // אצבע אחת מציירת. אצבע שנייה מבטלת את הקו שהתחיל ועוברת להגדלה/הזזה, ואין ציור עד שכל האצבעות מורמות
      const ptrs = new Map();
      let pinch = null, noDraw = false;
      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      function startPinch() {
        const [a, b] = [...ptrs.values()];
        const sr = stage.getBoundingClientRect();
        pinch = { d: dist(a, b), m: mid(a, b), z: zoom, tx, ty, bx: sr.left + cv.offsetLeft, by: sr.top + cv.offsetTop };
      }
      stage.addEventListener('pointerdown', e => {
        e.preventDefault();
        stage.setPointerCapture(e.pointerId);
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size >= 2) {
          cur = null; noDraw = true; draw();
          if (ptrs.size === 2) startPinch();
          return;
        }
        if (noDraw) return;
        cur = { t: tool, c: color, w: width, p: [pt(e)] };
        draw();
      });
      stage.addEventListener('pointermove', e => {
        if (!ptrs.has(e.pointerId)) return;
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && ptrs.size >= 2) {
          const [a, b] = [...ptrs.values()];
          const m = mid(a, b);
          zoom = Math.min(8, Math.max(1, pinch.z * dist(a, b) / pinch.d));
          // הנקודה שהייתה בין האצבעות נשארת בין האצבעות
          const px = (pinch.m.x - pinch.bx - pinch.tx) / pinch.z, py = (pinch.m.y - pinch.by - pinch.ty) / pinch.z;
          tx = m.x - pinch.bx - px * zoom; ty = m.y - pinch.by - py * zoom;
          if (zoom <= 1) tx = ty = 0;
          applyZoom();
          return;
        }
        if (!cur) return;
        const p = pt(e);
        if (cur.t === 'free') cur.p.push(p); else cur.p[1] = p;
        draw();
      });
      const end = e => {
        if (!ptrs.delete(e.pointerId)) return;
        if (pinch) {
          if (ptrs.size === 2) return startPinch();
          if (ptrs.size < 2) { pinch = null; resize(); }
        }
        if (!ptrs.size) noDraw = false;
        if (!cur) return;
        if (cur.t === 'free' || cur.p.length > 1) { list.push(cur); redo.length = 0; }
        cur = null; draw(); sync();
      };
      stage.addEventListener('pointerup', end);
      stage.addEventListener('pointercancel', end);

      let release = null;
      function close(result) {
        window.removeEventListener('resize', layout);
        ov.remove();
        if (release) release();
        resolve(result);
      }
      release = BackGuard.push(() => { release = null; close(null); });
      ov.querySelector('.annot-bar').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.tool) tool = b.dataset.tool;
        else if (b.dataset.color) color = b.dataset.color;
        else if (b.dataset.width) width = +b.dataset.width;
        else if (b.dataset.act === 'undo') { if (list.length) redo.push(list.pop()); }
        else if (b.dataset.act === 'redo') { if (redo.length) list.push(redo.pop()); }
        else if (b.dataset.act === 'clear') { if (list.length && confirm('למחוק את כל הסימונים?')) { list = []; redo.length = 0; } }
        else if (b.dataset.act === 'cancel') return close(null);
        else if (b.dataset.act === 'retake') return close('retake');
        else if (b.dataset.act === 'fit') { zoom = 1; tx = ty = 0; applyZoom(); resize(); }
        else if (b.dataset.act === 'save') return close(list);
        draw(); sync();
      });
      window.addEventListener('resize', layout);
      sync();
      requestAnimationFrame(layout);
    });
  }

  root.Annotate = { open, flatten };
  root.BackGuard = BackGuard;
})(self);

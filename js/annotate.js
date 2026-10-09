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

  // פותח עורך במסך מלא. מחזיר את רשימת הקווים החדשה, או null אם בוטל
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
          </div>
          <span class="sp"></span>
          <button data-act="cancel" class="txt">${opts.cancelLabel || 'ביטול'}</button>
          <button data-act="save" class="txt save">${opts.saveLabel || 'שמור'}</button>
        </div>
        <div class="annot-stage"><canvas></canvas></div>`;
      document.body.append(ov);
      const stage = ov.querySelector('.annot-stage');
      const cv = ov.querySelector('canvas');
      const ctx = cv.getContext('2d');
      let W = 0, H = 0;

      function layout() {
        const r = stage.getBoundingClientRect();
        const s = Math.min(r.width / img.width, r.height / img.height);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        W = Math.max(1, Math.round(img.width * s)); H = Math.max(1, Math.round(img.height * s));
        cv.style.width = W + 'px'; cv.style.height = H + 'px';
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        draw();
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
      cv.addEventListener('pointerdown', e => {
        e.preventDefault();
        cv.setPointerCapture(e.pointerId);
        cur = { t: tool, c: color, w: width, p: [pt(e)] };
        draw();
      });
      cv.addEventListener('pointermove', e => {
        if (!cur) return;
        const p = pt(e);
        if (cur.t === 'free') cur.p.push(p); else cur.p[1] = p;
        draw();
      });
      const end = () => {
        if (!cur) return;
        if (cur.t === 'free' || cur.p.length > 1) { list.push(cur); redo.length = 0; }
        cur = null; draw(); sync();
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);

      function close(result) {
        window.removeEventListener('resize', layout);
        ov.remove();
        resolve(result);
      }
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
        else if (b.dataset.act === 'save') return close(list);
        draw(); sync();
      });
      window.addEventListener('resize', layout);
      sync();
      requestAnimationFrame(layout);
    });
  }

  root.Annotate = { open, flatten };
})(self);

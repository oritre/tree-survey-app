// מצלמה בתוך האפליקציה: נפתחת מיד, צילום בלחיצה אחת.
// onShot(blob) נקרא לכל תמונה. אם הוא מחזיר 'close' המצלמה נסגרת (עברנו לסימון ושמרנו), 'cancel' נסגרת בלי לשמור,
// 'retake' חוזרים למצלמה לצילום חדש, false התמונה לא נשמרה, וכל דבר אחר: נשמרה והמצלמה ממשיכה (צילום ברצף).
// opts.instant: onShot מקבל מיד את הפריים מהווידאו (canvas) ו-{ better } עם הצילום האיכותי כשיהיה מוכן.
// opts.review: אחרי כל צילום התמונה מוצגת במסך מלא עם "החלף תמונה" / "צלם עוד" / "סיום", ו-onShot נקרא רק אחרי
// "סיום" (נשמרת והמצלמה נסגרת) או "צלם עוד" (נשמרת והמצלמה נשארת פתוחה לתמונה הבאה).
(function (root) {
  'use strict';

  // פותח את המצלמה האחורית עם חשיפה/פוקוס אוטומטיים
  async function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('אין גישה למצלמה בדפדפן הזה');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      // 16:9 (בטאבלט לאורך 9:16): כמעט בדיוק הצורה של תא התמונה בדוחות (רוחב/גובה 0.56-0.61), כך שמה שרואים במצלמה
      // הוא מה שייכנס לדוח. הצילום המלא (3:4) נשמר שלם, ובדוח נחתך מהמרכז לצורת התא
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    // חשיפה, איזון לבן ופוקוס אוטומטיים ורציפים (אם המצלמה תומכת)
    const auto = {};
    for (const k of ['exposureMode', 'whiteBalanceMode', 'focusMode']) if ((caps[k] || []).includes('continuous')) auto[k] = 'continuous';
    if (Object.keys(auto).length) track.applyConstraints({ advanced: [auto] }).catch(() => {});
    // צילום אמיתי של המצלמה (עם עיבוד התמונה של המכשיר, בהיר וחד יותר מפריים מהווידאו)
    const ic = 'ImageCapture' in root ? new root.ImageCapture(track) : null;
    // הרזולוציות שהמצלמה יודעת לצלם (ברקע, כדי לא לעכב את הפתיחה)
    if (ic && ic.getPhotoCapabilities) ic.getPhotoCapabilities().then(c => { ic._pc = c; }).catch(() => {});
    return { stream, track, caps, ic };
  }

  // פריים מהווידאו
  function frame(video) {
    if (!video.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    return c;
  }
  // חדות של פריים: שונות של הלפלסיאן במרכז התמונה (מוקטן). תמונה מרוחה מתנועה או לא בפוקוס מקבלת ציון נמוך
  const scoreCanvas = document.createElement('canvas');
  function sharpness(c) {
    const S = 256, g = scoreCanvas;
    g.width = S; g.height = S;
    const ctx = g.getContext('2d', { willReadFrequently: true });
    const side = Math.min(c.width, c.height) * 0.6;
    ctx.drawImage(c, (c.width - side) / 2, (c.height - side) / 2, side, side, 0, 0, S, S);
    const d = ctx.getImageData(0, 0, S, S).data;
    const y = new Float32Array(S * S);
    for (let i = 0, j = 0; j < y.length; i += 4, j++) y[j] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    let sum = 0, sum2 = 0, n = 0;
    for (let r = 1; r < S - 1; r++) for (let k = 1; k < S - 1; k++) {
      const j = r * S + k;
      const v = 4 * y[j] - y[j - 1] - y[j + 1] - y[j - S] - y[j + S];
      sum += v; sum2 += v * v; n++;
    }
    const m = sum / n;
    return sum2 / n - m * m;
  }
  const nextFrame = video => new Promise(r => {
    if (video.requestVideoFrameCallback) { let done = false; video.requestVideoFrameCallback(() => { if (!done) { done = true; r(); } }); setTimeout(() => { if (!done) { done = true; r(); } }, 80); }
    else setTimeout(r, 34);
  });
  // צילום מיידי: הפריים של רגע הלחיצה ועוד כמה פריימים מיד אחריו (פחות מ-0.15 שנייה), ונשאר החד ביותר.
  // כך אין המתנה לצילום של המצלמה (שלוקח באנדרואיד כמה שניות ומקפיא את התצוגה), ורעידה של הלחיצה לא מורחת את התמונה
  async function sharpFrame(video, first, count) {
    let best = first || frame(video), bestScore = best ? sharpness(best) : -1;
    for (let i = 0; i < (count || 4); i++) {
      await nextFrame(video);
      const c = frame(video);
      if (!c) continue;
      const sc = sharpness(c);
      if (sc > bestScore) { if (best) best.width = best.height = 0; best = c; bestScore = sc; }
      else c.width = c.height = 0;
    }
    return best;
  }

  // תמונה קטנה (data URL) לפינה של המצלמה
  function thumbOf(c) {
    const t = document.createElement('canvas');
    t.width = 160; t.height = Math.max(1, Math.round(160 * c.height / c.width));
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.7);
  }
  // תמונה שחורה כמעט לגמרי (המצלמה עוד לא "התעוררה" או שהצילום נכשל)
  async function isBlack(src) {
    try {
      // מפענחים בגודל קטן (מהיר בהרבה מפענוח של תמונה מלאה)
      const bmp = src instanceof Blob ? await createImageBitmap(src, { resizeWidth: 24, resizeHeight: 24, resizeQuality: 'low' }) : src;
      const c = document.createElement('canvas');
      c.width = 24; c.height = 24;
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0, 24, 24);
      const d = g.getImageData(0, 0, 24, 24).data;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i], d[i + 1], d[i + 2]);
      return max < 14;
    } catch (_) { return false; }
  }

  // תמונה אחת: צילום של המצלמה, ואם לא הצליח פריים מהווידאו. null אם יצא שחור.
  // takePhoto נתקע לפעמים באנדרואיד ולא חוזר עד שסוגרים את המצלמה (ואז הפריים מהווידאו כבר שחור),
  // לכן הוא מוגבל בזמן, ופריים מהווידאו נשמר מראש (o.backup אם כבר צולם).
  // o.maxSide: מצלמים ברזולוציה הקטנה ביותר שעדיין גדולה ממנו (התמונה מוקטנת אליו בכל מקרה), וזה מהיר יותר
  async function grab(video, ic, torch, o) {
    o = o || {};
    if (o.fast) {
      const c = await sharpFrame(video, o.backup);
      if (!c || await isBlack(c)) return null;
      return new Promise(r => c.toBlob(b => { c.width = c.height = 0; r(b); }, 'image/jpeg', 0.92));
    }
    const backup = o.noFallback ? null : o.backup || frame(video);
    let blob = null;
    if (ic) {
      const set = torch ? {} : { fillLightMode: 'off' };
      const iw = ic._pc && ic._pc.imageWidth;
      if (o.maxSide && iw && iw.max > o.maxSide) {
        const step = iw.step || 1;
        set.imageWidth = Math.min(iw.max, Math.max(iw.min, Math.ceil(o.maxSide / step) * step));
      }
      const attempt = o => ic.takePhoto(o).then(b => (b && b.size ? b : null));
      const p = attempt(set).catch(() => attempt().catch(() => null));
      const TIMEOUT = {};
      blob = ic._hung ? null : await Promise.race([p, new Promise(r => setTimeout(() => r(TIMEOUT), 3500))]);
      // נתקע פעם אחת: עד שהמצלמה תיסגר מצלמים מהווידאו מיד, בלי לחכות שוב. בפתיחה הבאה (ImageCapture חדש) מנסים שוב
      if (blob === TIMEOUT) { ic._hung = true; blob = null; }
      if (blob && await isBlack(blob)) blob = null;
    }
    if (!blob && o.noFallback) return null;
    if (!blob) {
      const c = backup && !(await isBlack(backup)) ? backup : frame(video);
      if (c && !(await isBlack(c))) blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    }
    return blob;
  }

  async function open(onShot, opts) {
    opts = opts || {};
    const { stream, track, caps, ic } = await start();
    // fast (ברירת המחדל): צילום מיידי מהווידאו, הפריים החד ביותר. כבוי: הצילום של המצלמה עצמה (איטי יותר)
    const fast = opts.fast !== false;
    let torch = false;
    // תיקון בהירות (פיצוי חשיפה) לצילום אחד: כל צילום (וכל פתיחה) מתחיל מהבהירות הרגילה (ori)
    const ec = caps.exposureCompensation;
    let ev = 0;
    try { localStorage.removeItem('camEv'); } catch (_) {}
    const setEv = v => {
      if (!ec) return;
      ev = Math.max(ec.min, Math.min(ec.max, Math.round(v / (ec.step || 0.5)) * (ec.step || 0.5)));
      track.applyConstraints({ advanced: [{ exposureCompensation: ev }] }).catch(() => {});
    };

    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'cam';
      ov.innerHTML = `
        <video playsinline muted autoplay></video>
        <div class="cam-top">
          <span class="cam-title"></span>
          ${ec ? '<button class="cam-btn" data-act="ev-" title="כהה יותר">☀−</button><span class="cam-ev"></span><button class="cam-btn" data-act="ev+" title="בהיר יותר">☀+</button>' : ''}
          ${caps.torch ? '<button class="cam-btn" data-act="torch" title="פנס">🔦</button>' : ''}
        </div>
        <div class="cam-bottom">
          <button class="cam-btn txt" data-act="done">${opts.doneLabel || 'סיום'}</button>
          <button class="cam-shutter" data-act="shot" aria-label="צלם"></button>
          <div class="cam-last"><img alt=""><b></b></div>
        </div>
        <canvas class="cam-freeze"></canvas>
        <div class="cam-focus"></div>
        <div class="cam-review">
          <img alt="">
          <div class="cam-review-bar">
            <button class="cam-btn txt" data-act="replace">החלף תמונה</button>
            <button class="cam-btn txt" data-act="more">צלם עוד</button>
            <button class="cam-btn txt ok" data-act="accept">סיום</button>
          </div>
        </div>
        <div class="cam-flash"></div>`;
      document.body.append(ov);
      const video = ov.querySelector('video');
      video.srcObject = stream;
      ov.querySelector('.cam-title').textContent = opts.title || '';
      const lastImg = ov.querySelector('.cam-last img'), count = ov.querySelector('.cam-last b');
      const evLabel = ov.querySelector('.cam-ev');
      const showEv = () => { if (evLabel) evLabel.textContent = ev ? (ev > 0 ? '+' : '') + ev : '0'; };
      showEv();
      let n = 0, busy = false, closed = false, release = null, decide = null;

      function close() {
        if (closed) return;
        closed = true;
        if (decide) { const d = decide; decide = null; d(false); }
        stream.getTracks().forEach(t => t.stop());
        ov.remove();
        if (release) release();
        resolve(n);
      }
      // כפתור החזרה של הטאבלט סוגר את המצלמה וחוזר לאפליקציה
      release = root.BackGuard ? root.BackGuard.push(() => { release = null; close(); }) : null;

      // מסך אישור: התמונה במסך מלא, "החלף תמונה" חוזר למצלמה ו"סיום" מאשר
      const review = ov.querySelector('.cam-review'), reviewImg = review.querySelector('img');

      function askReview(blob) {
        reviewImg.src = URL.createObjectURL(blob);
        ov.classList.add('reviewing');
        return new Promise(r => { decide = r; });
      }
      function endReview() {
        ov.classList.remove('reviewing');
        if (reviewImg.src) URL.revokeObjectURL(reviewImg.src);
        reviewImg.removeAttribute('src');
      }
      const freeze = ov.querySelector('.cam-freeze');

      async function shot() {
        if (busy || !video.videoWidth) return;
        busy = true;
        const fl = ov.querySelector('.cam-flash');
        fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
        // הפריים של רגע הלחיצה מוצג מיד (כמו מצלמה רגילה) עד שהתמונה מוכנה
        let backup = frame(video);
        if (fast && backup) backup = await sharpFrame(video, backup);
        if (backup) {
          freeze.width = Math.min(1280, backup.width); freeze.height = Math.round(freeze.width * backup.height / backup.width);
          freeze.getContext('2d').drawImage(backup, 0, 0, freeze.width, freeze.height);
        }
        ov.classList.add('busy');
        try {
          // opts.instant: עוברים מיד לסימון על הפריים של רגע הלחיצה, והצילום האיכותי של המצלמה (שלוקח לפעמים כמה שניות)
          // ממשיך ברקע ומוחלף בעורך כשהוא מוכן: onShot(frame, { better: Promise<Blob|null>, thumb })
          if (opts.instant && backup && !(await isBlack(backup))) {
            const better = fast ? null : grab(video, ic, torch, { maxSide: opts.maxSide, noFallback: true });
            if (better) better.catch(() => {});
            const thumb = thumbOf(backup);
            if (ev) { setEv(0); showEv(); }
            ov.classList.remove('busy');
            ov.classList.add('hidden');
            const kept = await onShot(backup, { better, thumb });
            return after(kept, thumb);
          }
          const blob = fast ? (backup && !(await isBlack(backup)) ? await new Promise(r => backup.toBlob(r, 'image/jpeg', 0.92)) : null)
            : await grab(video, ic, torch, { backup, maxSide: opts.maxSide });
          ov.classList.remove('busy');
          if (closed) return;
          if (!blob) { opts.onError && opts.onError('התמונה יצאה שחורה, צלם שוב'); return; }
          if (ev) { setEv(0); showEv(); } // הצילום הבא חוזר לבהירות הרגילה
          let more = false;
          if (opts.review) {
            const ok = await askReview(blob);
            endReview();
            if (closed) return;
            if (!ok) return; // החלף תמונה: חוזרים למצלמה
            more = ok === 'more';
          }
          ov.classList.add('hidden');
          let kept = await onShot(blob);
          if (more && kept === 'close') kept = true; // צלם עוד: נשמרה, והמצלמה נשארת פתוחה
          after(kept, blob);
        } finally { busy = false; ov.classList.remove('busy'); }
      }
      // אחרי onShot: נסגרים, או חוזרים למצלמה (ואם נשמרה, התמונה האחרונה והמונה בפינה)
      function after(kept, last) {
        if (kept === 'close') { n++; return close(); }
        if (kept === 'cancel' || closed) return close();
        ov.classList.remove('hidden');
        if (video.paused) video.play().catch(() => {});
        ov.focus();
        if (kept !== false && kept !== 'retake') {
          n++;
          count.textContent = n;
          if (lastImg.src && lastImg.src.startsWith('blob:')) URL.revokeObjectURL(lastImg.src);
          lastImg.src = typeof last === 'string' ? last : URL.createObjectURL(last);
          ov.querySelector('.cam-last').classList.add('on');
        }
      }

      // הצילום ברגע הנגיעה בכפתור ולא כשמרימים את האצבע: מהיר יותר, ולפני שהלחיצה מזיזה את הטאבלט
      const shutter = ov.querySelector('.cam-shutter');
      shutter.addEventListener('pointerdown', e => { e.preventDefault(); shot(); });
      // נגיעה בתמונה: פוקוס על הנקודה הזאת (אם המצלמה תומכת), ואחרי כמה שניות חזרה לפוקוס אוטומטי
      const ring = ov.querySelector('.cam-focus');
      let refocus = null;
      video.addEventListener('pointerdown', e => {
        if (busy || !video.videoWidth) return;
        const r = video.getBoundingClientRect();
        const sc = Math.min(r.width / video.videoWidth, r.height / video.videoHeight);
        const w = video.videoWidth * sc, hh = video.videoHeight * sc;
        const x = (e.clientX - r.left - (r.width - w) / 2) / w, y = (e.clientY - r.top - (r.height - hh) / 2) / hh;
        if (x < 0 || x > 1 || y < 0 || y > 1) return;
        ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
        ring.classList.remove('on'); void ring.offsetWidth; ring.classList.add('on');
        const fm = caps.focusMode || [];
        const set = { pointsOfInterest: [{ x, y }] };
        if (fm.includes('single-shot')) set.focusMode = 'single-shot';
        track.applyConstraints({ advanced: [set] }).catch(() => {});
        clearTimeout(refocus);
        if (fm.includes('continuous')) refocus = setTimeout(() => { if (!closed) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}); }, 5000);
      });
      ov.addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'shot') { if (e.detail === 0) shot(); }
        else if (['accept', 'more', 'replace'].includes(b.dataset.act)) {
          if (decide) { const d = decide; decide = null; d(b.dataset.act === 'accept' ? true : b.dataset.act === 'more' ? 'more' : false); }
        }
        else if (b.dataset.act === 'done') close();
        else if (b.dataset.act === 'ev+' || b.dataset.act === 'ev-') { setEv(ev + (b.dataset.act === 'ev+' ? 1 : -1) * Math.max(ec.step || 0.5, 0.5)); showEv(); }
        else if (b.dataset.act === 'torch') {
          torch = !torch;
          track.applyConstraints({ advanced: [{ torch }] }).catch(() => {});
          b.classList.toggle('on', torch);
        }
      });
      // כפתורי עוצמת הקול לא נגישים לדפדפן; מקש Enter / רווח במקלדת חיצונית מצלם
      ov.tabIndex = -1; ov.focus();
      ov.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !decide) { e.preventDefault(); shot(); } });
    });
  }

  root.Camera = { open, start, grab };
})(self);

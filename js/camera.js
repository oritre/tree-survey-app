// מצלמה בתוך האפליקציה: נפתחת מיד, צילום בלחיצה אחת.
// onShot(blob) נקרא לכל תמונה. אם הוא מחזיר 'close' המצלמה נסגרת (עברנו לסימון ושמרנו), 'cancel' נסגרת בלי לשמור,
// 'retake' חוזרים למצלמה לצילום חדש, false התמונה לא נשמרה, וכל דבר אחר: נשמרה והמצלמה ממשיכה (צילום ברצף).
(function (root) {
  'use strict';

  // פותח את המצלמה האחורית עם חשיפה/פוקוס אוטומטיים
  async function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('אין גישה למצלמה בדפדפן הזה');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
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
  // תמונה שחורה כמעט לגמרי (המצלמה עוד לא "התעוררה" או שהצילום נכשל)
  async function isBlack(src) {
    try {
      const bmp = src instanceof Blob ? await createImageBitmap(src) : src;
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
  // לכן הוא מוגבל בזמן, ופריים מהווידאו נשמר מראש
  async function grab(video, ic, torch) {
    const backup = frame(video);
    let blob = null;
    if (ic) {
      const attempt = o => ic.takePhoto(o).then(b => (b && b.size ? b : null));
      const p = attempt(torch ? {} : { fillLightMode: 'off' }).catch(() => attempt().catch(() => null));
      blob = await Promise.race([p, new Promise(r => setTimeout(() => r(null), 3500))]);
      if (blob && await isBlack(blob)) blob = null;
    }
    if (!blob) {
      const c = backup && !(await isBlack(backup)) ? backup : frame(video);
      if (c && !(await isBlack(c))) blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    }
    return blob;
  }

  async function open(onShot, opts) {
    opts = opts || {};
    const { stream, track, caps, ic } = await start();
    let torch = false;
    // תיקון בהירות (פיצוי חשיפה), נשמר בין פתיחות
    const ec = caps.exposureCompensation;
    let ev = 0;
    try { ev = +localStorage.getItem('camEv') || 0; } catch (_) {}
    const setEv = v => {
      if (!ec) return;
      ev = Math.max(ec.min, Math.min(ec.max, Math.round(v / (ec.step || 0.5)) * (ec.step || 0.5)));
      track.applyConstraints({ advanced: [{ exposureCompensation: ev }] }).catch(() => {});
      try { localStorage.setItem('camEv', ev); } catch (_) {}
    };
    if (ec && ev) setEv(ev);

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
        <div class="cam-flash"></div>`;
      document.body.append(ov);
      const video = ov.querySelector('video');
      video.srcObject = stream;
      ov.querySelector('.cam-title').textContent = opts.title || '';
      const lastImg = ov.querySelector('.cam-last img'), count = ov.querySelector('.cam-last b');
      const evLabel = ov.querySelector('.cam-ev');
      const showEv = () => { if (evLabel) evLabel.textContent = ev ? (ev > 0 ? '+' : '') + ev : '0'; };
      showEv();
      let n = 0, busy = false, closed = false, release = null;

      function close() {
        if (closed) return;
        closed = true;
        stream.getTracks().forEach(t => t.stop());
        ov.remove();
        if (release) release();
        resolve(n);
      }
      // כפתור החזרה של הטאבלט סוגר את המצלמה וחוזר לאפליקציה
      release = root.BackGuard ? root.BackGuard.push(() => { release = null; close(); }) : null;

      async function shot() {
        if (busy || !video.videoWidth) return;
        busy = true;
        const fl = ov.querySelector('.cam-flash');
        fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
        ov.classList.add('busy');
        try {
          const blob = await grab(video, ic, torch);
          ov.classList.remove('busy');
          if (closed) return;
          if (!blob) { opts.onError && opts.onError('התמונה יצאה שחורה, צלם שוב'); return; }
          ov.classList.add('hidden');
          const kept = await onShot(blob);
          if (kept === 'close') { n++; return close(); }
          if (kept === 'cancel' || closed) return close();
          ov.classList.remove('hidden');
          if (video.paused) video.play().catch(() => {});
          ov.focus();
          if (kept !== false && kept !== 'retake') {
            n++;
            count.textContent = n;
            if (lastImg.src) URL.revokeObjectURL(lastImg.src);
            lastImg.src = URL.createObjectURL(blob);
            ov.querySelector('.cam-last').classList.add('on');
          }
        } finally { busy = false; ov.classList.remove('busy'); }
      }

      ov.addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'shot') shot();
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
      ov.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); shot(); } });
    });
  }

  root.Camera = { open, start, grab };
})(self);

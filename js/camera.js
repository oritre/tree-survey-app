// מצלמה בתוך האפליקציה: נפתחת מיד, צילום בלחיצה אחת, ואפשר לצלם כמה תמונות ברצף בלי לצאת.
// onShot(blob) נקרא לכל תמונה (שם נפתח מסך הסימון ונשמרת התמונה), והמצלמה ממשיכה אחריו.
(function (root) {
  'use strict';

  async function open(onShot, opts) {
    opts = opts || {};
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('אין גישה למצלמה בדפדפן הזה');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    let torch = false;

    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'cam';
      ov.innerHTML = `
        <video playsinline muted autoplay></video>
        <div class="cam-top">
          <span class="cam-title"></span>
          ${caps.torch ? '<button class="cam-btn" data-act="torch" title="פנס">🔦</button>' : ''}
        </div>
        <div class="cam-bottom">
          <button class="cam-btn txt" data-act="done">סיום</button>
          <button class="cam-shutter" data-act="shot" aria-label="צלם"></button>
          <div class="cam-last"><img alt=""><b></b></div>
        </div>
        <div class="cam-flash"></div>`;
      document.body.append(ov);
      const video = ov.querySelector('video');
      video.srcObject = stream;
      ov.querySelector('.cam-title').textContent = opts.title || '';
      const lastImg = ov.querySelector('.cam-last img'), count = ov.querySelector('.cam-last b');
      let n = 0, busy = false;

      function close() {
        stream.getTracks().forEach(t => t.stop());
        ov.remove();
        resolve(n);
      }

      async function shot() {
        if (busy || !video.videoWidth) return;
        busy = true;
        const fl = ov.querySelector('.cam-flash');
        fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
        try {
          const c = document.createElement('canvas');
          c.width = video.videoWidth; c.height = video.videoHeight;
          c.getContext('2d').drawImage(video, 0, 0);
          const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
          ov.classList.add('paused');
          const kept = await onShot(blob);
          ov.classList.remove('paused');
          if (kept !== false) {
            n++;
            count.textContent = n;
            if (lastImg.src) URL.revokeObjectURL(lastImg.src);
            lastImg.src = URL.createObjectURL(blob);
            ov.querySelector('.cam-last').classList.add('on');
          }
        } finally { busy = false; }
      }

      ov.addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'shot') shot();
        else if (b.dataset.act === 'done') close();
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

  root.Camera = { open };
})(self);

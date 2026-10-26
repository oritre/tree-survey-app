// מצב דיבור לסקר בטיחות: המצלמה פתוחה, האפליקציה מקשיבה כל הזמן, ומשפט כמו
// "עץ 1, אשל, הפחתת משקלים, דחיפות 1" ממלא את העץ ומצלם אותו לבד.
// parse() מפרק משפט לשדות (בלי DOM, נבדק גם ב-node). open() מציג את המסך ומנהל מיקרופון, מצלמה והקראה.
(function (root) {
  'use strict';

  // ---------- נרמול ----------
  const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  function norm(s) {
    return String(s || '').toLowerCase().replace(/[֑-ׇ]/g, '').replace(/["'`׳״‘’“”]/g, '')
      .replace(/[ךםןףץ]/g, c => FINALS[c]).replace(/[^א-ת0-9a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // השוואה גמישה: בלי ו/י (כתיב מלא/חסר), כמו Core.isPine
  const loose = s => norm(s).replace(/[וי]/g, '').replace(/ /g, '');

  function lev(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row;
    }
    return prev[b.length];
  }
  // דמיון 0..1. מילים קצרות (עד 3 אותיות, למשל אשל, הדר) רק בהתאמה מלאה
  function sim(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (Math.min(a.length, b.length) <= 3) return 0;
    return 1 - lev(a, b) / Math.max(a.length, b.length);
  }

  // ---------- מספרים במילים ----------
  const NUM = {};
  const addNum = (k, words) => { for (const [w, v] of Object.entries(words)) NUM[norm(w)] = { v, k }; };
  addNum('unit', { 'אפס': 0, 'אחד': 1, 'אחת': 1, 'שתיים': 2, 'שתים': 2, 'שניים': 2, 'שנים': 2, 'שתי': 2, 'שלוש': 3, 'שלושה': 3, 'שלש': 3,
    'ארבע': 4, 'ארבעה': 4, 'חמש': 5, 'חמישה': 5, 'חמשה': 5, 'שש': 6, 'שישה': 6, 'ששה': 6, 'שבע': 7, 'שבעה': 7, 'שמונה': 8, 'תשע': 9, 'תשעה': 9 });
  addNum('teen', { 'עשר': 10, 'עשרה': 10 });
  addNum('tens', { 'עשרים': 20, 'שלושים': 30, 'ארבעים': 40, 'חמישים': 50, 'שישים': 60, 'שבעים': 70, 'שמונים': 80, 'תשעים': 90 });
  addNum('hund', { 'מאה': 100, 'מאתיים': 200 });
  addNum('mul', { 'מאות': 100 });

  function wordVal(n) {
    if (NUM[n]) return Object.assign({ and: false }, NUM[n]);
    if (n.length > 1 && n[0] === 'ו' && NUM[n.slice(1)]) return Object.assign({ and: true }, NUM[n.slice(1)]);
    return null;
  }

  // מילים -> טוקנים {o: המקור, n: מנורמל, num?}. "עשרים ושלוש" -> 23, "5-8" -> 5 עד 8
  function tokenize(text) {
    const toks = String(text || '').replace(/(\d)\s*[-–]\s*(\d)/g, '$1 עד $2').replace(/[-–,.;:!?]+/g, ' ')
      .split(/\s+/).filter(Boolean).map(o => ({ o, n: norm(o) })).filter(t => t.n);
    const out = [];
    for (let i = 0; i < toks.length;) {
      const t = toks[i];
      if (/^\d+$/.test(t.n)) { out.push({ o: t.o, n: t.n, num: +t.n }); i++; continue; }
      const a = wordVal(t.n);
      if (!a || a.and || a.k === 'mul') { out.push(t); i++; continue; }
      let v = a.v, j = i + 1;
      while (j < toks.length) {
        const b = wordVal(toks[j].n);
        if (!b) break;
        if (b.k === 'teen' && !b.and && v < 10) v += 10; // אחד עשר
        else if (b.k === 'mul' && !b.and && v < 10) v *= 100; // שלוש מאות
        else if (b.and && b.k === 'unit' && v >= 20 && v % 10 === 0) v += b.v; // עשרים ושלוש, מאה ושלוש
        else if (b.and && b.k === 'teen' && v >= 100 && v % 100 === 0) v += b.v; // מאה ועשר
        else if (b.k === 'tens' && v >= 100 && v % 100 === 0) v += b.v; // מאה עשרים, מאה ועשרים
        else break;
        j++;
      }
      out.push({ o: toks.slice(i, j).map(x => x.o).join(' '), n: String(v), num: v });
      i = j;
    }
    return out;
  }

  const set = words => new Set(words.map(norm));
  const CMD_CLOSE = set(['סיום', 'סיים', 'סיימתי', 'צא', 'יציאה', 'סגור', 'סיום מצב דיבור']);
  const CMD_UNDO = set(['בטל', 'ביטול', 'תבטל', 'בטל את זה', 'מחק', 'תמחק', 'מחק את זה', 'טעות']);
  const CMD_PAUSE = set(['הפסקה', 'עצור', 'תעצור', 'השהה']);
  const TREE = set(['עץ', 'עצים']);
  const SHOT = set(['צלם', 'תצלם', 'צילום']);
  const SPLIT = set(['פצל', 'פיצול', 'מפוצל']);
  const URG1 = set(['מיידי', 'מידי', 'מיידית', 'מידית', 'דחוף', 'דחופה']);
  const FILLER = set(['מספר', 'אה', 'אמ', 'אממ', 'אוקיי', 'אוקי', 'טוב', 'מין', 'המלצה', 'טיפול', 'מומלץ', 'ו', 'הערות', 'הבא', 'חדש']);

  // מוצא חלון של מילים רצופות (שלא נוצלו) שדומה לאחד המועמדים. מחזיר {i, k, value, score}
  function bestMatch(toks, cands) {
    let best = null;
    for (const c of cands) {
      const k = c.words;
      for (let i = 0; i + k <= toks.length; i++) {
        const win = toks.slice(i, i + k);
        if (win.some(t => t.used || t.num != null)) continue;
        let s = sim(loose(win.map(t => t.n).join('')), c.key);
        // ו בתחילת מילה ("ואשל")
        if (s < 1 && win[0].n[0] === 'ו') s = Math.max(s, sim(loose(win.map(t => t.n).join('').slice(1)), c.key));
        if (s >= 0.8 && (!best || s > best.score || (s === best.score && k > best.k))) best = { i, k, value: c.value, score: s };
      }
    }
    return best;
  }
  const candidates = list => [...new Set((list || []).map(x => String(x || '').trim()).filter(Boolean))]
    .map(value => ({ value, words: norm(value).split(' ').length, key: loose(value) })).filter(c => c.key);

  // משפט -> שדות. ctx: { species: [...], phrases: [...] }
  function parse(text, ctx) {
    ctx = ctx || {};
    const toks = tokenize(text);
    const r = { raw: String(text || '').trim(), num: null, newTree: false, species: null, pines: null, urgency: null, split: false, notes: [], photo: false, cmd: null, matched: 0, free: false };
    const whole = toks.map(t => t.n).join(' ');
    if (!whole) return r;
    if (CMD_CLOSE.has(whole)) { r.cmd = 'close'; return r; }
    if (CMD_UNDO.has(whole)) { r.cmd = 'undo'; return r; }
    if (CMD_PAUSE.has(whole)) { r.cmd = 'pause'; return r; }
    // "הערה ..." : כל השאר נכנס כמו שהוא להערות
    if (toks[0].n === norm('הערה')) { r.free = true; r.notes = toks.length > 1 ? [toks.slice(1).map(t => t.o).join(' ')] : []; return r; }
    const use = (...ts) => ts.forEach(t => { if (t) t.used = true; });
    const at = i => toks[i] || { n: '' };

    // תמונה נוספת: "צלם", "עוד תמונה", "תמונה נוספת"
    toks.forEach((t, i) => {
      if (SHOT.has(t.n)) { r.photo = true; use(t); }
      if (t.n === norm('תמונה') && (at(i - 1).n === 'עוד' || at(i + 1).n === norm('נוספת'))) { r.photo = true; use(t, toks[i - 1], toks[i + 1]); }
    });
    // אורנים: "3 אורנים" / "אורנים 3"
    toks.forEach((t, i) => {
      if (t.used || t.n !== norm('אורנים')) return;
      if (at(i - 1).num != null && !at(i - 1).used) { r.pines = at(i - 1).num; use(t, toks[i - 1]); }
      else if (at(i + 1).num != null) { r.pines = at(i + 1).num; use(t, toks[i + 1]); }
    });
    // מספר עץ: "עץ (מספר) 5 (עד 8)", "עץ הבא", או מספר בתחילת המשפט
    const readNum = i => {
      if (at(i).n === norm('מספר')) use(toks[i++]);
      if (at(i).num == null || at(i).used) return false;
      let num = String(at(i).num); use(toks[i]);
      if (at(i + 1).n === 'עד' && at(i + 2).num != null) { num += '-' + at(i + 2).num; use(toks[i + 1], toks[i + 2]); }
      r.num = num;
      return true;
    };
    const ti = toks.findIndex(t => TREE.has(t.n) && !t.used);
    if (ti >= 0) {
      use(toks[ti]);
      // "עץ" בלי מספר לא פותח עץ (הזיהוי שומע "עץ" גם באמצע משפט). רק "עץ הבא" / "עץ חדש"
      if (!readNum(ti + 1) && ['הבא', 'חדש'].includes(at(ti + 1).n)) { r.newTree = true; use(toks[ti + 1]); }
    } else if (at(0).num != null && !at(0).used) readNum(0);
    else if (['הבא', norm('עץ הבא')].includes(whole)) { r.newTree = true; use(...toks); }
    // דחיפות
    toks.forEach((t, i) => {
      if (t.used) return;
      if (t.n === norm('דחיפות')) {
        use(t);
        const nx = at(i + 1);
        if (nx.num === 1 || nx.num === 2) { r.urgency = String(nx.num); use(nx); } else if (nx.n === 'כ' || nx.n === norm('כריתה')) { r.urgency = 'כ'; use(nx); }
      } else if (URG1.has(t.n)) { r.urgency = '1'; use(t); }
      else if (t.n === 'חצי' && at(i + 1).n === 'שנה') { r.urgency = '2'; use(t, toks[i + 1]); }
      else if (t.n === norm('כריתה') && !r.urgency) r.urgency = 'כ';
      else if (SPLIT.has(t.n)) { r.split = true; use(t); }
    });
    // מין העץ: ההתאמה הטובה ביותר מהרשימה
    const sp = bestMatch(toks, candidates(ctx.species));
    if (sp) { r.species = sp.value; toks.slice(sp.i, sp.i + sp.k).forEach(t => use(t)); r.matched++; }
    // "עץ תאנה כריתה" (עץ ומין בלי מספר): עץ חדש במספר הבא
    if (ti >= 0 && r.num == null && r.species) r.newTree = true;
    // הערות קבועות (טיפול מומלץ), לפי הסדר במשפט, ומה שנשאר נכנס כמו שנאמר
    const items = [];
    const phr = candidates(ctx.phrases);
    for (let m; (m = bestMatch(toks, phr));) {
      toks.slice(m.i, m.i + m.k).forEach(t => use(t));
      items.push({ i: m.i, text: m.value });
      r.matched++;
    }
    let run = [];
    const flush = i => {
      while (run.length && FILLER.has(run[0].n)) run.shift();
      while (run.length && FILLER.has(run[run.length - 1].n)) run.pop();
      if (run.length) items.push({ i, text: run.map(t => t.o).join(' ') });
      run = [];
    };
    toks.forEach((t, i) => { if (t.used) flush(i); else run.push(t); });
    flush(toks.length);
    r.notes = items.sort((a, b) => a.i - b.i).map(x => x.text);
    return r;
  }

  // מבין כמה אפשרויות שהזיהוי מחזיר, בוחר את זו שהכי מתאימה לסקר
  function score(r) {
    return (r.cmd ? 5 : 0) + (r.num != null || r.newTree ? 2 : 0) + (r.species ? 2 : 0) + r.matched + (r.urgency ? 1 : 0) + (r.pines != null ? 1 : 0)
      - 0.1 * r.notes.join(' ').split(' ').filter(Boolean).length;
  }
  function parseBest(alts, ctx) {
    let best = null;
    for (const a of alts) { const r = parse(a, ctx); if (!best || score(r) > score(best)) best = r; }
    return best;
  }

  // כמה עצים ברצף אחד ("עץ 1 אשל ... עץ 2 ברוש ..."): חותכים לפני כל "עץ" + מספר / "עץ הבא"
  function segments(text) {
    const words = String(text || '').replace(/(\d)\s*[-–]\s*(\d)/g, '$1 עד $2').split(/\s+/).filter(Boolean);
    const starts = (w, nx) => TREE.has(norm(w)) && nx != null && (/^\d/.test(norm(nx)) || !!wordVal(norm(nx)) || ['מספר', 'הבא', 'חדש'].includes(norm(nx)));
    const out = [];
    let cur = [];
    words.forEach((w, i) => {
      if (cur.length && starts(w, words[i + 1])) { out.push(cur.join(' ')); cur = []; }
      cur.push(w);
    });
    if (cur.length) out.push(cur.join(' '));
    return out;
  }
  // כל האפשרויות של הזיהוי -> רשימת משפטים מפוענחים (של האפשרות עם הניקוד הגבוה ביותר)
  function parseAll(alts, ctx) {
    let best = null, bestScore = -Infinity;
    for (const a of alts) {
      const list = segments(a).map(x => parse(x, ctx)).filter(r => r.raw);
      const sc = list.reduce((n, r) => n + score(r), 0);
      if (list.length && sc > bestScore) { best = list; bestScore = sc; }
    }
    return best || [];
  }

  // ---------- מסך מצב הדיבור ----------
  const Rec = root.SpeechRecognition || root.webkitSpeechRecognition;
  const supported = () => !!Rec;

  // opts: { context(): {species, phrases}, handle(parsed, shoot): Promise<{say, card, close}>, manualShot(shoot), title() }
  async function open(opts) {
    if (!Rec) throw new Error('זיהוי דיבור לא נתמך בדפדפן הזה (צריך Chrome)');
    const cam = await root.Camera.start();
    let speakOn = true;
    try { speakOn = localStorage.getItem('voiceSpeak') !== '0'; } catch (_) {}

    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'cam voice';
      ov.innerHTML = `
        <video playsinline muted autoplay></video>
        <div class="cam-top">
          <span class="cam-title"></span>
          <button class="cam-btn" data-act="rec" title="הקלטת הדיבור (גיבוי)"></button>
          <button class="cam-btn" data-act="speak" title="הקראת אישור"></button>
          <button class="cam-btn" data-act="mic" title="השהיית ההקשבה"></button>
        </div>
        <div class="voice-panel">
          <div class="voice-status"><span class="voice-dot"></span><span class="voice-state"></span><span class="voice-rec"></span></div>
          <div class="voice-heard"></div>
          <div class="voice-card"></div>
          <div class="voice-log"></div>
          <div class="voice-help">לדוגמה: "עץ 1, אשל, הפחתת משקלים, דחיפות 1" · "בטל" · "הערה …" · "סיום". צילום: בכפתור</div>
        </div>
        <div class="cam-bottom">
          <button class="cam-btn txt" data-act="done">סיום</button>
          <button class="cam-shutter" data-act="shot" aria-label="צלם לעץ הנוכחי"></button>
          <div class="cam-last"><img alt=""><b></b></div>
        </div>
        <div class="cam-flash"></div>`;
      document.body.append(ov);
      const $ = s => ov.querySelector(s);
      const video = $('video');
      video.srcObject = cam.stream;
      const title = () => { $('.cam-title').textContent = (opts.title && opts.title()) || 'מצב דיבור'; };
      title();
      const speakBtn = $('[data-act="speak"]'), micBtn = $('[data-act="mic"]');
      const showSpeak = () => { speakBtn.textContent = speakOn ? '🔊' : '🔇'; speakBtn.classList.toggle('on', speakOn); };
      showSpeak();

      let active = true, paused = false, speaking = false, listening = false, shots = 0, errStreak = 0;
      const queue = [];
      let working = false;

      const setState = (cls, text) => { ov.dataset.state = cls; $('.voice-state').textContent = text; };
      const showMic = () => { micBtn.textContent = paused ? '▶' : '⏸'; micBtn.classList.toggle('on', paused); };
      showMic();

      // ---------- הקלטה: גיבוי של כל מה שנאמר, בקטעים של 3 דקות (כל קטע נשמר מיד, גם אם האפליקציה תיסגר) ----------
      const SEG_MS = 3 * 60 * 1000;
      let recOn = !!opts.onRecording && !!root.MediaRecorder;
      try { if (localStorage.getItem('voiceRecord') === '0') recOn = false; } catch (_) {}
      let micStream = null, mr = null, segTimer = null, recNote = '';
      const recBtn = $('[data-act="rec"]');
      const showRec = () => {
        recBtn.hidden = !opts.onRecording || !root.MediaRecorder;
        recBtn.textContent = '⏺';
        recBtn.classList.toggle('rec-on', !!mr);
        $('.voice-rec').textContent = mr ? '● מקליט' : recNote;
      };
      async function startRecording() {
        if (!recOn || mr || !active) return;
        try {
          if (!micStream) micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
          if (!active || mr) return;
          const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => root.MediaRecorder.isTypeSupported(m)) || '';
          const m = new root.MediaRecorder(micStream, Object.assign({ audioBitsPerSecond: 24000 }, mime ? { mimeType: mime } : {}));
          const chunks = [], start = Date.now();
          m.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
          m.onstop = () => {
            const blob = new Blob(chunks, { type: m.mimeType || mime || 'audio/webm' });
            if (blob.size > 2000) opts.onRecording(blob, { start, end: Date.now() });
          };
          m.start(5000);
          mr = m; recNote = '';
          segTimer = setTimeout(() => stopRecording(true), SEG_MS);
        } catch (e) { recOn = false; recNote = 'ההקלטה לא זמינה'; console.warn(e); }
        showRec();
      }
      function stopRecording(restart) {
        clearTimeout(segTimer);
        if (mr && mr.state !== 'inactive') { try { mr.stop(); } catch (_) {} }
        mr = null;
        if (restart && recOn && active) startRecording();
        else if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
        showRec();
      }
      showRec();
      startRecording();

      // מסך דולק כל הזמן
      let lock = null;
      const keepAwake = () => { if (navigator.wakeLock && document.visibilityState === 'visible') navigator.wakeLock.request('screen').then(l => { lock = l; }).catch(() => {}); };
      keepAwake();
      const onVis = () => { if (document.visibilityState === 'visible') { keepAwake(); listen(); } };
      document.addEventListener('visibilitychange', onVis);

      // ---------- זיהוי דיבור ----------
      const rec = new Rec();
      rec.lang = 'he-IL';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 4;
      // בלי רשת: זיהוי בתוך המכשיר, אם הדפדפן תומך ויש לו עברית
      if (!navigator.onLine && 'processLocally' in rec) rec.processLocally = true;
      rec.onstart = () => { listening = true; committed = ''; if (!speaking && !paused) setState('on', 'מקשיב…'); };
      // חלקי משפט נאספים, ונשלחים לפענוח רק אחרי הפסקה קצרה בדיבור. כך "עץ 1" ... "אשל" ... "הפחתת משקלים" הם משפט אחד.
      // באנדרואיד התוצאה הסופית לפעמים מצטברת (חוזרת על מה שכבר נאמר) או קצרה מהביניים, ולכן משווים לשניהם
      let pending = [], commitT = null, lastInterim = '', committed = '';
      const heardNow = () => pending.map(a => a[0]).concat(lastInterim).join(' ').trim();
      function addFinal(alts) {
        alts = alts.map(a => a.trim()).filter(Boolean);
        if (!alts.length) return;
        // מה שכבר נשלח בסשן הזה וחוזר בתחילת התוצאה: מורידים
        if (committed && norm(alts[0]).startsWith(norm(committed))) {
          const rest = alts[0].split(/\s+/).slice(committed.split(/\s+/).length).join(' ');
          if (!rest) return;
          alts = [rest];
        }
        if (lastInterim && norm(lastInterim).length > norm(alts[0]).length + 3 && norm(lastInterim).includes(norm(alts[0]).split(' ')[0])) alts = alts.concat(lastInterim);
        const last = pending[pending.length - 1];
        if (last && norm(alts[0]).startsWith(norm(last[0]))) pending[pending.length - 1] = alts;
        else if (!(last && norm(last[0]).startsWith(norm(alts[0])))) pending.push(alts);
      }
      function commit() {
        clearTimeout(commitT);
        lastInterim = '';
        if (!pending.length) return;
        const alts = pending.length === 1 ? pending[0] : [pending.map(a => a[0]).join(' ')];
        committed = (committed + ' ' + pending.map(a => a[0]).join(' ')).trim();
        pending = [];
        queue.push(alts);
        pump();
      }
      rec.onresult = e => {
        errStreak = 0;
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) { addFinal(Array.from({ length: res.length }, (_, k) => res[k].transcript)); lastInterim = ''; }
          else interim += res[0].transcript;
        }
        if (interim) lastInterim = interim.trim();
        $('.voice-heard').textContent = heardNow();
        ov.dataset.state = 'hear';
        clearTimeout(commitT);
        commitT = setTimeout(commit, opts.pauseMs || 1500);
      };
      rec.onerror = e => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        errStreak++;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { paused = true; showMic(); setState('err', 'אין הרשאה למיקרופון. צריך לאשר בדפדפן.'); }
        else if (e.error === 'audio-capture' && mr) { recOn = false; stopRecording(false); recNote = 'ההקלטה כובתה: המיקרופון תפוס'; showRec(); }
        else if (e.error === 'network') setState('err', 'זיהוי הדיבור צריך חיבור לרשת. אפשר לצלם בכפתור.');
        else if (e.error === 'language-not-supported') { paused = true; showMic(); setState('err', 'אין זיהוי דיבור בעברית במכשיר הזה'); }
        else setState('err', 'תקלה בזיהוי דיבור (' + e.error + ')');
      };
      rec.onend = () => { listening = false; if (pending.length || lastInterim) { if (!pending.length) pending.push([lastInterim]); commit(); } if (active && !paused && !speaking) setTimeout(listen, Math.min(250 * 2 ** errStreak, 8000)); };
      function listen() {
        if (!active || paused || speaking || listening || document.visibilityState !== 'visible') return;
        try { rec.start(); } catch (_) { /* כבר פועל */ }
      }
      const stopListening = () => { try { rec.abort(); } catch (_) {} };

      // הקראה בקול. בזמן ההקראה לא מקשיבים, שלא יזהה את עצמו
      const voices = () => (root.speechSynthesis ? root.speechSynthesis.getVoices() : []).filter(v => /^he|^iw/i.test(v.lang));
      function say(text) {
        if (!speakOn || !text || !root.speechSynthesis) return Promise.resolve();
        speaking = true; stopListening();
        setState('say', 'מקריא…');
        return new Promise(res => {
          const u = new root.SpeechSynthesisUtterance(text);
          u.lang = 'he-IL';
          const v = voices()[0];
          if (v) u.voice = v;
          u.rate = 1.15;
          let done = false;
          const fin = () => { if (done) return; done = true; speaking = false; res(); setTimeout(listen, 150); };
          u.onend = fin; u.onerror = fin;
          setTimeout(fin, 1500 + text.length * 120);
          root.speechSynthesis.cancel();
          root.speechSynthesis.speak(u);
        });
      }

      async function shoot() {
        const fl = $('.cam-flash');
        fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
        const blob = await root.Camera.grab(video, cam.ic, false);
        if (!blob) return null; // תמונה שחורה / המצלמה לא החזירה תמונה
        shots++;
        const last = $('.cam-last');
        $('.cam-last b').textContent = shots;
        const img = $('.cam-last img');
        if (img.src) URL.revokeObjectURL(img.src);
        img.src = URL.createObjectURL(blob);
        last.classList.add('on');
        return blob;
      }

      // מה נשמע ומה נכנס, ארבעת האחרונים (כדי לראות מיד אם הזיהוי הבין)
      function addLog(raw, res) {
        const box = $('.voice-log');
        const d = document.createElement('div');
        const q = document.createElement('q'); q.textContent = raw;
        const r = document.createElement('span'); r.textContent = ' ← ' + (res ? [].concat(res.card || res.say || []).slice(0, 2).join(' · ') : '');
        if (res && res.warn) d.className = 'warn';
        d.append(q, r);
        box.prepend(d);
        while (box.children.length > 4) box.lastChild.remove();
      }

      function showResult(res) {
        const card = $('.voice-card');
        card.replaceChildren();
        if (!res) return;
        card.classList.toggle('warn', !!res.warn);
        for (const line of [].concat(res.card || res.say || [])) {
          const d = document.createElement('div');
          d.textContent = line;
          card.append(d);
        }
      }

      async function pump() {
        if (working) return;
        working = true;
        try {
          while (queue.length && active) {
            const alts = queue.shift();
            const list = parseAll(alts, opts.context());
            $('.voice-heard').textContent = '';
            const says = [];
            for (const p of list) {
              if (p.cmd === 'close') { close(); return; }
              if (p.cmd === 'pause') { paused = true; showMic(); stopListening(); setState('off', 'מושהה. לחץ ▶ להמשך'); continue; }
              setState('work', 'שומר…');
              let res;
              try { res = await opts.handle(p); } catch (err) { console.error(err); res = { say: 'לא נשמר', card: ['לא נשמר: ' + err.message], warn: true }; }
              if (!active) return;
              title();
              showResult(res);
              addLog(p.raw, res);
              if (opts.log) opts.log({ at: Date.now(), heard: alts, raw: p.raw, parsed: { num: p.num, newTree: p.newTree, species: p.species, notes: p.notes, urgency: p.urgency, pines: p.pines, cmd: p.cmd }, result: res ? [].concat(res.card || res.say || []).join(' | ') : '' });
              if (res && res.close) { close(); return; }
              if (res && res.say) says.push(res.say);
            }
            await say(says.join('. '));
            if (!speaking && !paused) setState(listening ? 'on' : 'off', listening ? 'מקשיב…' : '');
          }
        } finally { working = false; }
      }

      function close() {
        if (!active) return;
        active = false;
        stopListening();
        if (root.speechSynthesis) root.speechSynthesis.cancel();
        stopRecording(false);
        if (lock) lock.release().catch(() => {});
        document.removeEventListener('visibilitychange', onVis);
        cam.stream.getTracks().forEach(t => t.stop());
        const img = $('.cam-last img');
        if (img.src) URL.revokeObjectURL(img.src);
        ov.remove();
        resolve(shots);
      }

      ov.addEventListener('click', async e => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'done') close();
        else if (act === 'rec') {
          recOn = !mr;
          try { localStorage.setItem('voiceRecord', recOn ? '1' : '0'); } catch (_) {}
          recNote = recOn ? '' : 'ההקלטה כבויה';
          if (recOn) startRecording(); else stopRecording(false);
        }
        else if (act === 'speak') { speakOn = !speakOn; showSpeak(); try { localStorage.setItem('voiceSpeak', speakOn ? '1' : '0'); } catch (_) {} }
        else if (act === 'mic') {
          paused = !paused; showMic();
          if (paused) { stopListening(); setState('off', 'מושהה. לחץ ▶ להמשך'); } else { errStreak = 0; listen(); }
        } else if (act === 'shot') {
          // בזמן הצילום והסימון לא מקשיבים
          b.disabled = true;
          const wasPaused = paused;
          paused = true; stopListening(); commit();
          try {
            const res = await opts.manualShot(shoot);
            if (res === 'retake') return;
            showResult(res); title();
          } finally { b.disabled = false; paused = wasPaused; if (!paused) listen(); }
        }
      });
      setState('off', 'מתחיל…');
      listen();
    });
  }

  const api = { parse, parseBest, parseAll, segments, tokenize, norm, supported, open };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Voice = api;
})(typeof self !== 'undefined' ? self : this);

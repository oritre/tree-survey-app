// מצב דיבור עם Gemini: משפט מוקלט (WAV) נשלח ל-Gemini, שמתמלל עברית מדוברת ומחזיר ישר את שדות העץ.
// מחליף את זיהוי הדיבור של הדפדפן, שבטאבלט של ori לא שמע כלום כשהמיקרופון גם הקליט, וטעה במילים (כריתה -> שריטה).
(function (root) {
  'use strict';
  const MODEL = 'gemini-2.5-flash';
  const URL = key => `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;

  // ---------- WAV ----------
  // דגימות float32 (מונו) -> קובץ WAV של 16 ביט
  function wav(chunks, rate) {
    const n = chunks.reduce((a, c) => a + c.length, 0);
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    let o = 44;
    for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 0x7fff, true);
    return new Blob([buf], { type: 'audio/wav' });
  }

  // ---------- זיהוי משפטים (VAD): מקשיב למיקרופון, ומוציא קטע לכל משפט (אחרי שקט קצר) ----------
  // opts: { onSegment(blob, ms), onLevel(speaking), isMuted() }
  function listen(stream, opts) {
    const Ctx = root.AudioContext || root.webkitAudioContext;
    let ctx;
    try { ctx = new Ctx({ sampleRate: 16000 }); } catch (_) { ctx = new Ctx(); }
    const rate = ctx.sampleRate;
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    const blockMs = 2048 / rate * 1000;
    const SILENCE_MS = opts.silenceMs || 1300, MAX_MS = 30000, MIN_VOICED_MS = 350, PREROLL = Math.ceil(400 / blockMs);
    let floor = 0.01, speaking = false, buf = [], pre = [], silent = 0, voiced = 0, total = 0;
    const finish = () => {
      const chunks = buf; const v = voiced;
      speaking = false; buf = []; silent = 0; voiced = 0; total = 0;
      opts.onLevel && opts.onLevel(false);
      if (v >= MIN_VOICED_MS) opts.onSegment(wav(chunks, rate), v);
    };
    proc.onaudioprocess = e => {
      const d = new Float32Array(e.inputBuffer.getChannelData(0));
      if (opts.isMuted && opts.isMuted()) { if (speaking) finish(); pre = []; return; }
      let s = 0;
      for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      const rms = Math.sqrt(s / d.length);
      const thr = Math.max(0.012, floor * 3);
      const loud = rms > thr;
      if (!speaking) {
        floor = floor * 0.97 + Math.min(rms, 0.2) * 0.03; // רעש הרקע
        pre.push(d); if (pre.length > PREROLL) pre.shift();
        if (loud) { speaking = true; buf = pre.slice(); pre = []; voiced = blockMs; total = buf.length * blockMs; opts.onLevel && opts.onLevel(true); }
        return;
      }
      buf.push(d); total += blockMs;
      floor = floor * 0.995 + Math.min(rms, 0.2) * 0.005; // רעש קבוע (רוח, תנועה) מעלה לאט את הסף, כדי שהקטע ייסגר
      if (loud) { silent = 0; voiced += blockMs; } else silent += blockMs;
      if (silent >= SILENCE_MS || total >= MAX_MS) finish();
    };
    src.connect(proc); proc.connect(ctx.destination);
    const resume = () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); };
    resume();
    document.addEventListener('click', resume, true);
    return {
      flush() { if (speaking) finish(); },
      stop() { document.removeEventListener('click', resume, true); try { proc.disconnect(); src.disconnect(); } catch (_) {} ctx.close().catch(() => {}); },
      get state() { return ctx.state; },
    };
  }

  // ---------- הבקשה ל-Gemini ----------
  const SCHEMA = {
    type: 'OBJECT',
    properties: {
      transcript: { type: 'STRING' },
      command: { type: 'STRING', enum: ['none', 'undo', 'close', 'pause'] },
      trees: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            tree_number: { type: 'STRING', nullable: true },
            new_tree: { type: 'BOOLEAN' },
            species: { type: 'STRING', nullable: true },
            location: { type: 'STRING', nullable: true },
            findings: { type: 'ARRAY', items: { type: 'STRING' } },
            treatment: { type: 'ARRAY', items: { type: 'STRING' } },
            urgency: { type: 'STRING', enum: ['none', '1', '2', 'כ'] },
            pines: { type: 'INTEGER', nullable: true },
          },
          required: ['new_tree', 'findings', 'treatment', 'urgency'],
        },
      },
    },
    required: ['transcript', 'command', 'trees'],
  };

  function prompt(ctx) {
    return [
      'אתה עוזר לאגרונום שעושה סקר בטיחות עצים בשטח ומדבר אל הטאבלט. בהקלטה משפט אחד או כמה משפטים שלו בעברית.',
      'תמלל במדויק (transcript), ותמיר את מה שנאמר לשדות של עצים בסקר (trees). הזיהוי הקולי טועה לפעמים, אז תקן מילים לפי ההקשר והרשימות:',
      'למשל "שריטה"/"פריטה" -> "כריתה", "התנן" -> "תאנה", "מקונית"/"מכני" -> "נזק מכני".',
      '',
      'כללים:',
      '- tree_number: רק אם נאמר מספר עץ ("עץ 5", "עצים 3 עד 6" -> "3-6"). אחרת null.',
      '- new_tree: true אם הוא מתחיל לדבר על עץ אחר מהעץ הנוכחי (מספר חדש, "העץ הבא", או מין אחר מהעץ הנוכחי). false אם הוא מוסיף פרטים על העץ הנוכחי.',
      '- species: שם המין כפי שהוא מופיע ברשימת המינים (אם אפשר), אחרת כפי שנאמר. null אם לא נאמר מין.',
      '- location: מיקום העץ אם נאמר ("בחניה", "ליד השירותים", "ברחבה"). קצר, בלי מילות קישור מיותרות.',
      '- findings: ממצאים/נזקים/מצב העץ ("נזק מכני", "ענף יבש", "רקבון בבסיס"). ביטויים קצרים.',
      '- treatment: הטיפול המומלץ. העדף ביטוי מרשימת הטיפולים אם הוא מתאים ("הפחתת משקלים", "כריתה", "גיזום ענפים יבשים").',
      '- urgency: "כ" אם ההמלצה כריתה, "1" אם נאמר מיידי/דחוף, "2" אם נאמר חצי שנה, אחרת "none".',
      '- pines: מספר האורנים אם נאמר ("3 אורנים"), אחרת null.',
      '- command: "undo" אם ביקש לבטל ("בטל", "טעות"), "close" אם אמר "סיום", "pause" אם אמר "הפסקה", אחרת "none".',
      '- דיבור שלא קשור לסקר (שיחה עם אנשים, רעש): trees ריק. אל תמציא פרטים שלא נאמרו.',
      '',
      `העץ הנוכחי: ${ctx.current || 'אין'}. מספרי העצים שכבר בסקר: ${(ctx.numbers || []).join(', ') || 'אין'}.`,
      `רשימת המינים: ${(ctx.species || []).join(', ')}`,
      `רשימת הטיפולים: ${(ctx.phrases || []).join(', ')}`,
    ].join('\n');
  }

  const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

  async function call(key, body, tries) {
    let last;
    for (let i = 0; i < (tries || 2); i++) {
      try {
        const res = await fetch(URL(key), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = (j.error && j.error.message) || ('HTTP ' + res.status);
          if (res.status === 400 || res.status === 403) throw Object.assign(new Error(msg), { fatal: true });
          throw new Error(msg);
        }
        return j;
      } catch (e) {
        last = e;
        if (e.fatal) break;
        await new Promise(r => setTimeout(r, 1200));
      }
    }
    throw last;
  }

  // קטע מוקלט -> { transcript, command, trees: [...] }
  async function understand(key, blob, ctx) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt(ctx) }, { inline_data: { mime_type: blob.type || 'audio/wav', data: await b64(blob) } }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
    };
    const j = await call(key, body);
    const text = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(p => p.text || '').join('');
    return JSON.parse(text || '{}');
  }

  // תשובת Gemini -> רשימת משפטים באותו מבנה של Voice.parse, כדי שהאפליקציה תמלא אותם באותה דרך
  function toParsed(out) {
    const raw = String(out.transcript || '').trim();
    const cmd = out.command && out.command !== 'none' ? out.command : null;
    if (cmd) return [{ raw, cmd, num: null, newTree: false, species: null, pines: null, urgency: null, split: false, notes: [], matched: 0, free: false }];
    return (out.trees || []).map(t => {
      const num = t.tree_number ? String(t.tree_number).replace(/\s+/g, '').replace(/[–—]/g, '-') : null;
      const notes = [t.location].concat(t.findings || [], t.treatment || []).map(x => String(x || '').trim()).filter(Boolean);
      return { raw, cmd: null, num, newTree: !!t.new_tree && !num, species: t.species ? String(t.species).trim() : null,
        pines: Number.isInteger(t.pines) ? t.pines : null, urgency: t.urgency && t.urgency !== 'none' ? t.urgency : null,
        split: false, notes, matched: 1, free: true, ai: true };
    });
  }

  // בדיקת מפתח: בקשת טקסט קטנה
  async function test(key) {
    const j = await call(key, { contents: [{ role: 'user', parts: [{ text: 'ענה במילה אחת: תקין' }] }], generationConfig: { thinkingConfig: { thinkingBudget: 0 } } }, 1);
    return !!(j.candidates && j.candidates.length);
  }

  root.Gemini = { listen, understand, toParsed, test, wav, MODEL };
})(self);

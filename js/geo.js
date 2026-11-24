// (1.158) GPS משותף לכל האפליקציה: מעקב מיקום אחד (watchPosition) שכל המסכים משתמשים בו, במקום שכל כפתור ידליק
// GPS משלו ויחכה שיתאפס מאפס. כל עוד סקר פתוח (או מפה עם "המיקום שלי") ה-GPS כבר "חם", כך שלחיצה על נ"צ מקבלת
// מיקום מיד, ויש כבר כמה מדידות מהשניות האחרונות למיצוע. אחרי שכולם משחררים הוא ממשיך עוד 3 דקות (מעבר בין סקרים/מסכים
// לא מכבה ומדליק אותו), ונעצר כשהאפליקציה ברקע (סוללה) וחוזר כשחוזרים אליה.
(function (root) {
  'use strict';
  const geo = root.navigator && root.navigator.geolocation;
  const KEEP = 60000, LINGER = 3 * 60000, STALL = 25000;
  const S = { id: null, started: 0, fixes: [], last: null, holds: new Set(), subs: new Set(), lingerUntil: 0, lingerT: 0, err: null, dog: 0 };
  const LS = 'geoLast';

  function fixOf(p) {
    const c = p.coords;
    return { lat: c.latitude, lon: c.longitude, acc: c.accuracy, hd: c.heading, spd: c.speed, alt: c.altitude, t: p.timestamp || Date.now() };
  }
  function emit(f, err) { for (const fn of [...S.subs]) { try { fn(f, err); } catch (e) { console.error(e); } } }
  let saved = 0;
  function onPos(p) {
    const f = fixOf(p);
    if (!isFinite(f.lat) || !isFinite(f.lon)) return;
    // אותה מדידה פעמיים (חלק מהדפדפנים שולחים שוב את האחרונה)
    if (S.last && S.last.t === f.t && S.last.lat === f.lat && S.last.lon === f.lon) { S.last.seen = Date.now(); return; }
    S.err = null; S.last = f; S.fixes.push(f);
    const old = Date.now() - KEEP;
    while (S.fixes.length && S.fixes[0].t < old) S.fixes.shift();
    // המיקום האחרון נשמר (פעם בדקה) כדי שמפה תיפתח מיד במקום הנכון גם לפני שה-GPS התאפס
    if (Date.now() - saved > 60000) { saved = Date.now(); try { localStorage.setItem(LS, JSON.stringify({ lat: f.lat, lon: f.lon, acc: f.acc, t: f.t })); } catch (_) {} }
    emit(f, null);
  }
  function onErr(e) {
    S.err = e;
    if (e && e.code === 1) stop(); // אין הרשאה: אין טעם להמשיך
    emit(null, e);
  }
  function active() { return S.holds.size > 0 || Date.now() < S.lingerUntil; }
  function start() {
    if (S.id != null || !geo || document.visibilityState === 'hidden') return;
    S.started = Date.now();
    // maximumAge 0: רק מדידות חדשות. בלי timeout: ממשיכים לחכות גם כשאין קליטה רגעית
    S.id = geo.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 0 });
    // שומר: יש דפדפנים שמפסיקים לשלוח מיקום אחרי שגיאה. אם אין מדידה 25 שניות, מתחילים את המעקב מחדש
    if (!S.dog) S.dog = setInterval(() => {
      if (S.id == null) return;
      const lastT = S.last ? Math.max(S.last.seen || S.last.t, S.started) : S.started;
      if (Date.now() - lastT > STALL && Date.now() - S.started > STALL) { geo.clearWatch(S.id); S.id = null; start(); }
    }, 5000);
  }
  function stop() {
    if (S.id != null && geo) geo.clearWatch(S.id);
    S.id = null;
    if (S.dog) { clearInterval(S.dog); S.dog = 0; }
  }
  function hold(key) {
    S.holds.add(key);
    clearTimeout(S.lingerT);
    start();
  }
  function release(key) {
    if (!S.holds.delete(key) || S.holds.size) return;
    S.lingerUntil = Date.now() + LINGER;
    clearTimeout(S.lingerT);
    S.lingerT = setTimeout(() => { if (!active()) stop(); }, LINGER + 100);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stop();
    else if (active()) start();
  });
  // חזרה מהמסך הכבוי: יש מכשירים שבהם visibilitychange מגיע באיחור, אז מתחילים גם ב-pageshow/focus (start לא מתחיל פעמיים)
  for (const ev of ['pageshow', 'focus']) root.addEventListener(ev, () => { if (active()) start(); });

  async function permission() {
    try { if (navigator.permissions) return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch (_) {}
    return 'unknown';
  }
  const age = f => Date.now() - (f.seen || f.t); // seen: הדפדפן שלח שוב את אותה מדידה (עומדים במקום), אז היא עדיין עדכנית
  // המדידה האחרונה, אם היא מ-maxAge האחרונות
  function last(maxAge) { return S.last && age(S.last) <= (maxAge == null ? 5000 : maxAge) ? S.last : null; }
  function recent(ms) { const from = Date.now() - ms; return S.fixes.filter(f => f.t >= from); }
  // מיקום מכמה מדידות: ממוצע משוקלל (מדידה מדויקת שוקלת יותר) של המדידות שקרובות בדיוק לטובה ביותר.
  // כשעומדים במקום, הממוצע מבטל חלק מהקפיצות של ה-GPS ומדויק יותר ממדידה בודדת
  function blend(fixes) {
    if (!fixes.length) return null;
    const bestAcc = Math.min(...fixes.map(f => f.acc));
    const use = fixes.filter(f => f.acc <= Math.max(bestAcc * 1.5, bestAcc + 2));
    let w = 0, lat = 0, lon = 0;
    for (const f of use) { const k = 1 / Math.max(1, f.acc) ** 2; w += k; lat += k * f.lat; lon += k * f.lon; }
    return { lat: lat / w, lon: lon / w, acc: bestAcc, n: use.length, t: Math.max(...use.map(f => f.t)) };
  }
  // מרחק במטרים (קירוב טוב למרחקים קצרים)
  function dist(a, b) {
    const k = Math.PI / 180, x = (b.lon - a.lon) * k * Math.cos((a.lat + b.lat) / 2 * k), y = (b.lat - a.lat) * k;
    return Math.sqrt(x * x + y * y) * 6371000;
  }

  // מיקום עכשיו, מהר ככל האפשר. מתחיל ממדידות של השניות האחרונות (GPS חם) ומחזיר מיד אם יש מדויקת מספיק (good).
  // אחרת מחכה למדידות חדשות: מחזיר ברגע שיש good, אחרי settle מ"ש מחזיר כל מה שעד ok, ובסוף (timeout) את הטובה ביותר שהתקבלה.
  // onProgress(best) מקבל כל שיפור תוך כדי (להצגת "מאתר… ±30מ'"). מחזיר { lat, lon, acc, n, t } או null (הסיבה ב-Geo.error)
  function get(o) {
    // stale: יש דפדפנים שלא שולחים מדידה חדשה כשעומדים במקום. אם אין מדידה חדשה תוך 1.5 שניות והמעקב רץ,
    // המדידה האחרונה (עד stale מ"ש) היא עדיין המיקום הנוכחי
    o = Object.assign({ fresh: 3000, stale: 12000, good: 10, ok: 30, settle: 4000, timeout: 20000, onProgress: null }, o || {});
    return new Promise(resolve => {
      if (!geo) return resolve(null);
      const t0 = Date.now(), key = {};
      const pool = recent(o.fresh);
      let done = false, tm1 = 0, tm2 = 0;
      const best = () => blend(pool);
      const end = r => {
        if (done) return; done = true;
        S.subs.delete(sub); clearTimeout(tm1); clearTimeout(tm2); release(key);
        resolve(r);
      };
      const check = () => {
        const b = best();
        if (!b) return;
        if (o.onProgress) o.onProgress(b);
        if (b.acc <= o.good) end(b);
        else if (Date.now() - t0 >= o.settle && b.acc <= o.ok) end(b);
      };
      const sub = (f, err) => {
        if (done) return;
        if (f) { pool.push(f); check(); }
        else if (err && err.code === 1) end(null); // אין הרשאה (Geo.error.code === 1)
      };
      S.subs.add(sub); hold(key);
      tm1 = setTimeout(check, o.settle + 10);
      const wasRunning = S.id != null;
      setTimeout(() => {
        if (done || pool.length || !wasRunning || S.err) return;
        const f = last(o.stale); if (f) { pool.push(f); check(); }
      }, 1500);
      tm2 = setTimeout(() => end(best() || blend([last(30000)].filter(Boolean))), o.timeout);
      check();
    });
  }

  function lastSaved() { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch (_) { return null; } }

  root.Geo = {
    hold, release, permission, last, recent, blend, dist, get, lastSaved,
    on(fn) { S.subs.add(fn); return () => S.subs.delete(fn); },
    get running() { return S.id != null; },
    get error() { return S.err; },
    _state: S,
  };
})(window);

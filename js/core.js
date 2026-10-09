// לוגיקה משותפת: מספרי עצים, פיצול, אורנים, סדר התמונות בנספח.
// הכללים כאן מחקים את הנוסחאות בתבנית "סקר יציבות ירושלים - טאבלט אורנים".
(function (root) {
  'use strict';

  // שורות העצים בתבנית (72 שורות בשלושה עמודים)
  const TREE_ROWS = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33]
    .concat(range(37, 47), [62, 63], range(67, 86), range(90, 107), [116, 117], range(121, 128));
  const MAX_TREES = TREE_ROWS.length; // 72
  const MAX_SLOTS = 72;
  const MAX_PRINTED = 24; // 4 תמונות בשורה, 2 שורות בעמוד, 3 עמודים

  function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }

  // כמו עמודה Z בתבנית: מקף ארוך -> מקף, "--" -> "-", בלי רווחים
  function normNum(s) {
    return String(s == null ? '' : s).replace(/–/g, '-').replace(/--/g, '-').replace(/--/g, '-').replace(/\s+/g, '');
  }

  // "2-5,7--9" -> [2,3,4,5,7,8,9]; null אם יש חלק לא תקין (כמו -1 בתבנית)
  function expandNum(s) {
    const z = normNum(s);
    if (!z) return [];
    const parts = z.split(',').map(p => p.trim()).filter(Boolean).slice(0, 6);
    const out = [];
    for (const p of parts) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(p);
      if (!m) {
        // התבנית מקבלת גם "5-" או "5-x" כעץ בודד, אבל טקסט בהתחלה נכשל
        const lead = /^(\d+)/.exec(p);
        if (!lead) return null;
        out.push(+lead[1]);
        continue;
      }
      const a = +m[1];
      const b = m[2] != null ? +m[2] : a;
      if (a <= 0) return null;
      const n = Math.max(1, b - a + 1);
      for (let i = 0; i < n && out.length < MAX_SLOTS; i++) out.push(a + i);
    }
    return out;
  }

  function firstNum(s) {
    const m = /^\s*(\d+)/.exec(normNum(s));
    return m ? +m[1] : null;
  }

  // אורן / אורנים / ארן / אוורן / האורן / ואורנים, גם בתוך רשימת מינים. לא קזוארינה.
  function isPine(species) {
    if (!species) return false;
    const s = String(species).replace(/ו/g, '').replace(/י/g, '').replace(/ן/g, 'נ');
    const words = s.split(/[\s,;/\\\-–+.()]+/).filter(Boolean);
    // אותן תחיליות כמו בעיצוב המותנה של תא J בתבנית
    return words.some(w => /^(ארנ|הארנ|אארנ|אנרנ|האנרנ)/.test(w));
  }

  // ערך עמודה J: כמות אורנים ו/או "פצל"
  function jValue(tree) {
    const n = tree.pines != null && tree.pines !== '' ? Number(tree.pines) : null;
    if (tree.split && n != null) return n + ' פצל';
    if (tree.split) return 'פצל';
    if (n != null && !isNaN(n)) return n;
    return null;
  }

  function hasContent(t) {
    return !!(String(t.num || '').trim() || String(t.species || '').trim());
  }

  // מיון לפי המספר הראשון, עצים בלי מספר בסוף
  function sortTrees(trees) {
    return trees.slice().sort((a, b) => {
      const fa = firstNum(a.num), fb = firstNum(b.num);
      if (fa == null && fb == null) return (a.created || 0) - (b.created || 0);
      if (fa == null) return 1;
      if (fb == null) return -1;
      return fa - fb || (a.created || 0) - (b.created || 0);
    });
  }

  // האם הפיצול פעיל לעץ (כמו עמודה AY בתבנית)
  function splitActive(tree) {
    if (!tree.split) return false;
    const e = expandNum(tree.num);
    return !!(e && e.length > 0);
  }

  // רשימת המשבצות בנספח התמונות, לפי הסדר. כל משבצת = תמונה אחת, ומספר התמונה = המקום ברשימה.
  function slotsOf(trees) {
    const slots = [];
    for (const t of sortTrees(trees).filter(hasContent).slice(0, MAX_TREES)) {
      if (splitActive(t)) {
        for (const n of expandNum(t.num)) slots.push({ tree: t, sub: n, label: String(n) });
      } else {
        slots.push({ tree: t, sub: null, label: String(t.num || t.species || '') });
      }
    }
    return slots.slice(0, MAX_SLOTS).map((s, i) => Object.assign(s, { index: i + 1 }));
  }

  // קבוצת התמונות: בעץ מפוצל כל תת-מספר הוא קבוצה, אחרת כל העץ
  function groupKey(tree, p) { return splitActive(tree) ? p.sub : null; }

  // ברירת מחדל: התמונה הראשונה בכל קבוצה נכנסת לדוח (גם לנתונים ישנים עם כוכב)
  function normalizePhotos(tree) {
    const photos = tree.photos || (tree.photos = []);
    const seen = new Set();
    for (const p of photos) {
      if (p.inReport == null) {
        const k = groupKey(tree, p);
        const firstInGroup = !photos.some(x => x !== p && groupKey(tree, x) === k && x.star);
        p.inReport = p.star ? true : (!seen.has(k) && firstInGroup);
      }
      seen.add(groupKey(tree, p));
      delete p.star;
    }
  }

  // אם בקבוצה לא נשארה אף תמונה לדוח, הראשונה חוזרת לדוח
  function ensureReportPhoto(tree, key) {
    const g = (tree.photos || []).filter(p => groupKey(tree, p) === key);
    if (g.length && !g.some(p => p.inReport)) g[0].inReport = true;
  }

  // התמונה הראשונה לדוח עבור משבצת (מצב התבנית: משבצת אחת לכל עץ / תת-מספר)
  function photoForSlot(slot) {
    const photos = slot.tree.photos || [];
    const mine = slot.sub == null ? photos : photos.filter(p => p.sub === slot.sub);
    return mine.find(p => p.inReport) || null;
  }

  // נספח שהאפליקציה בונה: משבצת לכל תמונה שסומנה לדוח, לפי סדר העצים
  function reportSlots(trees) {
    const slots = [];
    for (const t of sortTrees(trees).filter(hasContent).slice(0, MAX_TREES)) {
      const photos = (t.photos || []).filter(p => p.inReport);
      if (splitActive(t)) {
        for (const n of expandNum(t.num)) for (const p of photos.filter(x => x.sub === n)) slots.push({ tree: t, sub: n, label: String(n), photo: p });
      } else {
        for (const p of photos) slots.push({ tree: t, sub: null, label: String(t.num || t.species || ''), photo: p });
      }
    }
    return slots.map((s, i) => Object.assign(s, { index: i + 1 }));
  }

  // התווית של תמונה (מספר העץ, או תת-המספר בעץ מפוצל)
  function photoLabel(tree, p) {
    return splitActive(tree) && p.sub != null ? String(p.sub) : String(tree.num || '');
  }

  // המספר הבא לעץ חדש
  function nextNum(trees) {
    let max = 0;
    for (const t of trees) {
      const e = expandNum(t.num) || [];
      for (const n of e) if (n > max) max = n;
    }
    return String(max + 1);
  }

  function warnings(survey) {
    const w = [];
    const trees = survey.trees.filter(hasContent);
    if (trees.length > MAX_TREES) w.push(`יש ${trees.length} עצים, ובתבנית יש מקום ל-${MAX_TREES} בלבד.`);
    for (const t of sortTrees(trees)) {
      const name = 'עץ ' + (t.num || t.species);
      if (isPine(t.species) && (t.pines == null || t.pines === '')) w.push(`${name}: אורן בלי כמות אורנים.`);
      if (t.split && !splitActive(t)) w.push(`${name}: סומן פצל אבל מספר העץ לא תקין לפיצול.`);
      if (!(t.photos || []).length) w.push(`${name}: אין תמונה.`);
      if (t.lat == null) w.push(`${name}: אין נ"צ.`);
    }
    for (const t of trees) {
      if (!splitActive(t)) continue;
      for (const n of expandNum(t.num)) if (!(t.photos || []).some(p => p.sub === n)) w.push(`עץ ${n} (מתוך ${t.num}): אין תמונה למספר הזה.`);
    }
    const rs = reportSlots(survey.trees);
    if (rs.length > MAX_PRINTED) w.push(`סומנו ${rs.length} תמונות לדוח, ובנספח יש מקום ל-${MAX_PRINTED}. התמונות שאחרי ${MAX_PRINTED} לא ייכנסו.`);
    return w;
  }

  // שם המוסד (F9) וכתובת (D10) בדוח. סקר ישן עם שדה אתר אחד: הכול נכנס לשם
  function placeOf(s) {
    const t = x => (x || '').trim();
    if (s.siteName == null && s.street == null && s.city == null) return { name: t(s.site), address: '' };
    return { name: t(s.siteName), address: [t(s.street), t(s.city)].filter(Boolean).join(', ') };
  }

  const api = { placeOf, TREE_ROWS, MAX_TREES, MAX_SLOTS, MAX_PRINTED, normNum, expandNum, firstNum, isPine, jValue, hasContent,
    sortTrees, splitActive, slotsOf, photoForSlot, groupKey, normalizePhotos, ensureReportPhoto, reportSlots, photoLabel,
    nextNum, warnings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Core = api;
})(typeof self !== 'undefined' ? self : this);

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

  // מיון לפי המספר הראשון. עץ תקין (בלי מספר) נשאר במקום שלו: אחרי העץ הממוספר שנרשם לפניו.
  // עצים אחרים בלי מספר בסוף
  function sortTrees(trees) {
    const key = new Map();
    let last = 0;
    trees.forEach((t, i) => {
      const f = firstNum(t.num);
      if (f != null) { last = f; key.set(t, [f, 0, t.created || 0]); }
      else if (isOk(t)) key.set(t, [last, 1, i]);
      else key.set(t, [Infinity, 2, t.created || 0]);
    });
    return trees.slice().sort((a, b) => {
      const ka = key.get(a), kb = key.get(b);
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
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
    return splitActive(tree) && p.sub != null ? String(p.sub) : String(tree.num || tree.species || '').trim();
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

  // דחיפות "תקין": העץ בלי מספר (בדוח, בתמונות ובנספח מופיע מין העץ), והספירה של העצים האחרים ממשיכה בלעדיו
  const OK = 'תקין';
  const DEFAULT_URGENCY = '2';
  const isOk = t => (t.urgency || '').trim() === OK;
  // דחיפות בעמודה I בדוח: עץ תקין נשאר ריק, כמו בדוחות במחשב (ההערה "תקין")
  const urgencyCell = t => isOk(t) ? '' : (t.urgency || '').trim();
  const notesCell = t => (t.notes || '').trim() || (isOk(t) ? OK : '');

  // מספרים שמשתנים: כל מספר בשדה (גם בטווח "7-9") ובתמונות של עץ מפוצל
  function renumber(trees, skip, fn) {
    const changed = [];
    for (const u of trees) {
      if (u === skip || !String(u.num || '').trim() || !expandNum(u.num)) continue;
      const num = String(u.num).replace(/\d+/g, d => String(fn(+d)));
      if (num === u.num) continue;
      u.num = num;
      for (const p of u.photos || []) if (p.sub != null) p.sub = fn(+p.sub);
      changed.push(u);
    }
    return changed;
  }
  const otherNums = (trees, t) => new Set(trees.filter(u => u !== t).flatMap(u => expandNum(u.num) || []));

  // משנה דחיפות. מעבר ל"תקין" מוריד את מספר העץ ומקדם את העצים שאחריו, ויציאה מ"תקין" מחזירה את המספר למקומו.
  // מחזיר את העצים האחרים שהמספר שלהם השתנה
  function setUrgency(trees, t, v) {
    const was = isOk(t);
    t.urgency = v;
    delete t.urgencyAuto;
    if (isOk(t) && !was) {
      const num = String(t.num || '').trim();
      if (!num) return [];
      t.okNum = num; t.num = '';
      if (t.split) t.split = false;
      for (const p of t.photos || []) p.sub = null;
      const used = otherNums(trees, t);
      const drop = (expandNum(num) || []).filter(n => !used.has(n));
      return drop.length ? renumber(trees, t, n => n - drop.filter(r => r < n).length) : [];
    }
    if (!isOk(t) && was && !String(t.num || '').trim()) {
      const ins = expandNum(t.okNum || '');
      delete t.okNum;
      if (!ins || !ins.length) { t.num = nextNum(trees); return []; }
      const used = otherNums(trees, t);
      const num = ins.length === 1 ? String(ins[0]) : ins[0] + '-' + ins[ins.length - 1];
      const changed = ins.some(n => used.has(n)) ? renumber(trees, t, n => n >= ins[0] ? n + ins.length : n) : [];
      t.num = num;
      return changed;
    }
    return [];
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
      if (survey.warnGps && t.lat == null) w.push(`${name}: אין נ"צ.`);
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
    nextNum, warnings, OK, DEFAULT_URGENCY, isOk, urgencyCell, notesCell, setUrgency };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Core = api;
})(typeof self !== 'undefined' ? self : this);

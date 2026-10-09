// סקר עצים לבנייה: שדות לכל עץ, חישוב ערכיות (0-20) והמלצה, וטבלת אקסל.
// הניקוד לפי הנחיות פקיד היערות: ערך מין + מצב בריאותי + מיקום + חופה, כל אחד 0-5
(function (root) {
  'use strict';
  const TYPES = { safety: 'סקר יציבות עצים', construction: 'סקר עצים לבנייה' };
  const typeOf = s => (s && s.type) || 'safety';
  const isConstruction = s => typeOf(s) === 'construction';

  const SCORES = [['scSpecies', 'ערך מין'], ['scHealth', 'מצב בריאותי'], ['scLocation', 'מיקום'], ['scCanopy', 'חופה']];
  const MEASURES = [['height', 'גובה (מ\')'], ['stems', 'מספר גזעים'], ['diam', 'קוטר גזע (ס"מ)'], ['canopyDiam', 'קוטר חופה (מ\')']];
  const RECS = ['שימור', 'העתקה', 'כריתה'];
  const FIELDS = MEASURES.map(m => m[0]).concat(SCORES.map(s => s[0]), ['rec']);

  const num = v => (v == null || v === '' || isNaN(+v)) ? null : Number(v);
  // סה"כ ערכיות, רק כשכל ארבעת הציונים מולאו
  function total(t) {
    const v = SCORES.map(([k]) => num(t[k]));
    return v.some(x => x == null) ? null : v.reduce((a, b) => a + b, 0);
  }
  function category(n) {
    if (n == null) return '';
    return n >= 17 ? 'גבוהה מאוד' : n >= 14 ? 'גבוהה' : n >= 7 ? 'בינונית' : 'נמוכה';
  }

  function warnings(s) {
    const w = [];
    for (const t of Core.sortTrees(s.trees.filter(Core.hasContent))) {
      const name = 'עץ ' + (t.num || t.species);
      const miss = SCORES.filter(([k]) => num(t[k]) == null).map(x => x[1]);
      if (miss.length) w.push(`${name}: חסר ניקוד ${miss.join(', ')}.`);
      if (!t.rec) w.push(`${name}: אין המלצה (שימור / העתקה / כריתה).`);
      if (num(t.diam) == null && !(t.diam || '').trim()) w.push(`${name}: אין קוטר גזע.`);
      if (!(t.photos || []).length) w.push(`${name}: אין תמונה.`);
      if (t.lat == null) w.push(`${name}: אין נ"צ.`);
    }
    return w;
  }

  const HEAD = ['מס\' עץ', 'מין העץ', ...MEASURES.map(m => m[1]), ...SCORES.map(s => s[1] + ' (0-5)'), 'סה"כ ערכיות (0-20)', 'ערכיות העץ', 'המלצה', 'הערות', 'קו רוחב', 'קו אורך'];
  function rows(s) {
    const out = [HEAD];
    for (const t of Core.sortTrees(s.trees.filter(Core.hasContent))) {
      const tot = total(t);
      const v = k => { const n = num(t[k]); return n != null ? n : (t[k] || ''); };
      out.push([t.num || '', t.species || '', ...MEASURES.map(([k]) => v(k)), ...SCORES.map(([k]) => v(k)),
        tot == null ? '' : tot, category(tot), t.rec || '', t.notes || '',
        t.lat != null ? +t.lat.toFixed(6) : '', t.lon != null ? +t.lon.toFixed(6) : '']);
    }
    const by = r => s.trees.filter(Core.hasContent).filter(t => t.rec === r).length;
    out.push(['סה"כ', `${out.length - 1} עצים`, '', '', '', '', '', '', '', '', '', '', RECS.map(r => `${r}: ${by(r)}`).join(' · '), '', '', '']);
    return out;
  }
  async function xlsx(s) {
    return Reports.xlsx(rows(s), { sheet: 'סקר עצים לבנייה', boldLast: true, widths: [9, 18, 9, 9, 11, 11, 10, 12, 10, 9, 14, 13, 11, 40, 11, 11] });
  }

  root.Construction = { TYPES, typeOf, isConstruction, SCORES, MEASURES, RECS, FIELDS, total, category, warnings, rows, xlsx };
})(this);

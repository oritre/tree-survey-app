// הצעות מחיר מתבנית Word (dotx/docx): מזהה בתבנית מה משתנה ומה קבוע, ובונה קובץ Word חדש
// הטקסט הקבוע נשאר בדיוק כמו בתבנית (כולל העיצוב). רק פסקה ששונתה נכתבת מחדש, בעיצוב של הפסקה המקורית
(function (root) {
  'use strict';

  const BUILTIN = [
    { id: 'b-construction', name: 'הצעת מחיר היתר בניה', file: 'template/quotes/construction.dotx' },
    { id: 'b-construction-tlv', name: 'הצעת מחיר היתר בניה תל אביב', file: 'template/quotes/construction-tlv.dotx' },
    { id: 'b-stability', name: 'הצעת מחיר יציבות עצים', file: 'template/quotes/stability.dotx' },
  ];

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const unesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // מפרק את גוף המסמך לאלמנטים ברמה העליונה (פסקאות, טבלאות, sectPr), עם עומק כדי שפסקאות בתוך תיבות טקסט לא יתפרקו
  function topLevel(body) {
    const out = [];
    const re = /<(\/?)w:(p|tbl|sectPr|sdt)\b[^>]*?(\/?)>/g;
    let depth = 0, start = -1, m, last = 0;
    while ((m = re.exec(body))) {
      const closing = m[1] === '/', selfClose = m[3] === '/';
      if (!closing && !selfClose) {
        if (depth === 0) {
          if (m.index > last) out.push({ k: 'raw', xml: body.slice(last, m.index) });
          start = m.index;
        }
        depth++;
      } else if (closing) {
        depth--;
        if (depth === 0) {
          const xml = body.slice(start, re.lastIndex);
          out.push({ k: /^<w:p\b/.test(xml) ? 'p' : 'raw', xml });
          last = re.lastIndex;
        }
      } else if (depth === 0) { // אלמנט ריק ברמה העליונה
        if (m.index > last) out.push({ k: 'raw', xml: body.slice(last, m.index) });
        out.push({ k: /^<w:p\b/.test(m[0]) ? 'p' : 'raw', xml: m[0] });
        last = re.lastIndex;
      }
    }
    if (last < body.length) out.push({ k: 'raw', xml: body.slice(last) });
    return out.filter(b => b.k === 'p' || b.xml.trim());
  }

  // הטקסט של פסקה כמו שהוא מוצג (בלי קודי שדות)
  function paraText(xml) {
    let s = '';
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:instrText[^>]*>[^<]*<\/w:instrText>/g;
    let m;
    while ((m = re.exec(xml))) {
      if (m[0].startsWith('<w:tab')) s += '\t';
      else if (m[0].startsWith('<w:br')) s += '\n';
      else if (m[1] != null) s += unesc(m[1]);
    }
    return s;
  }
  const isList = xml => /<w:numPr>/.test(xml);
  const center = xml => /<w:jc w:val="center"\/>/.test(xml);
  const bold = xml => { const p = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(xml); return !!(p && /<w:b\/>/.test(p[0])); };

  // כותב פסקה מחדש עם טקסט חדש: אותו עיצוב פסקה (pPr), ועיצוב התו של הריצה הראשונה שיש בה טקסט
  function setText(xml, text, fresh) {
    let open = /^<w:p\b[^>]*>/.exec(xml)[0];
    if (fresh) open = open.replace(/\s(w14:paraId|w14:textId)="[^"]*"/g, '');
    const pPr = (/^<w:p\b[^>]*>\s*(<w:pPr>[\s\S]*?<\/w:pPr>)/.exec(xml) || [])[1] || '';
    let rPr = '';
    const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
    let m;
    while ((m = runRe.exec(xml))) if (/<w:t[\s>]/.test(m[1])) { rPr = (/^\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(m[1]) || [])[1] || ''; break; }
    if (!rPr) { const pr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(pPr); rPr = pr ? pr[0] : '<w:rPr><w:rtl/></w:rPr>'; }
    const runs = String(text).split('\n').map(line => line.split('\t').map(seg => seg ? `<w:t xml:space="preserve">${esc(seg)}</w:t>` : '').join('<w:tab/>')).join('<w:br/>');
    return `${open}${pPr}${text ? `<w:r>${rPr}${runs}</w:r>` : ''}</w:p>`;
  }

  // ---------- סעיפי תמחיר ----------
  const PRICE_RE = /^(.*?)\s*([–—-])\s*([\d.,]+)\s*₪\s*\.?\s*$/;
  function parsePrice(text) {
    const m = PRICE_RE.exec(text.trim());
    if (!m) return null;
    return { desc: m[1].trim(), sep: m[2], amt: m[3].replace(/,/g, '') };
  }
  const fmtAmt = a => { const s = String(a == null ? '' : a).trim(); return /^\d+(\.\d+)?$/.test(s) ? Number(s).toLocaleString('en-US') : s; };
  function priceText(b) {
    const amt = fmtAmt(b.amt);
    if (!b.desc && !amt) return '';
    return amt ? `${b.desc} ${b.sep || '–'} ${amt} ₪.` : b.desc;
  }

  // ---------- שדות משתנים ----------
  // [[שם שדה]] בתבנית = שדה למילוי (לתבניות חדשות)
  const MARK_RE = /\[\[([^\]]*)\]\]/g;
  // "גוש 10107 חלקה 109"
  const GUSH_RE = /^\s*גוש\s+(\S*)\s+חלקה\s+(\S*)\s*$/;

  function blankText(b) {
    if (b.blank === 'mark') {
      return b.text.replace(MARK_RE, (_, label) => { const v = (b.vals || {})[label]; return v != null && v !== '' ? v : ''; });
    }
    const v = (b.val || '').trim();
    if (!v) return b.text;
    if (b.blank === 'gap') {
      // "הסקר הינו ל  עצים" -> "הסקר הינו ל-12 עצים"
      const before = b.text.slice(0, b.gapAt).replace(/\s+$/, ''), after = b.text.slice(b.gapAt).replace(/^\s+/, '');
      const prefix = /(^|\s)[לבמהוכש]$/.test(before);
      return before + (prefix ? '-' : ' ') + v + ' ' + after;
    }
    return b.text.replace(/\s*$/, '') + ' ' + v; // "סקר במתחם:" -> "סקר במתחם: גן הדסים"
  }

  // הטקסט הסופי של כל פסקה לפי מה שמולא
  function blockText(q, b) {
    switch (b.kind) {
      case 'date': return (b.lead || '') + '‏' + fmtDate(q.date);
      case 'price': return priceText(b);
      case 'gush': return (b.gush || b.helka) ? `גוש ${b.gush || ''} חלקה ${b.helka || ''}`.replace(/\s+/g, ' ').trim() : '';
      case 'subject': return b.t || '';
      case 'blank': return blankText(b);
      default: return b.t;
    }
  }
  const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

  // ---------- ניתוח תבנית ----------
  async function load(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    const doc = await zip.file('word/document.xml').async('string');
    const bm = /<w:body>([\s\S]*)<\/w:body>/.exec(doc);
    if (!bm) throw new Error('הקובץ לא נראה כמו מסמך Word');
    return { zip, doc, body: bm[1], bodyStart: bm.index + '<w:body>'.length, bodyEnd: bm.index + '<w:body>'.length + bm[1].length };
  }

  // יוצר הצעת מחיר חדשה מתבנית: רשימת פסקאות, ולכל אחת מה משתנה בה.
  // keep=true: מסמך הצעה קיים (Word מהדרייב) — הערכים שכבר כתובים בו נשארים, ושום שורה לא נמחקת או נוספת
  async function parse(bytes, keep) {
    const { body } = await load(bytes);
    const els = topLevel(body);
    const blocks = [];
    let titleSeen = false, introSeen = false, inPrice = false, signSeen = false, dateSeen = false;
    els.forEach((e, i) => {
      if (e.k !== 'p') { blocks.push({ id: uid(), k: 'raw', xml: e.xml, kind: 'raw' }); return; }
      const text = paraText(e.xml);
      const tt = text.trim();
      const b = { id: uid(), k: 'p', xml: e.xml, text, t: text, list: isList(e.xml), center: center(e.xml), bold: bold(e.xml), kind: 'text' };
      // פסקה עם תמונה (חותמת, לוגו) או שדה שאינו תאריך: נשארת בדיוק כמו בתבנית
      if (/<w:drawing>|<w:pict>|<w:object/.test(e.xml)) { b.kind = 'image'; blocks.push(b); return; }
      const next = els.slice(i + 1).find(x => x.k === 'p' && paraText(x.xml).trim());
      // ori: בהצעת יציבות השורה "סקר במתחם:" לא נכנסת (שם המוסד מופיע מתחת לכותרת)
      if (!keep && /^סקר במתחם\s*:?\s*$/.test(tt)) return;
      if (!dateSeen && /תאריך\s*:/.test(text)) {
        dateSeen = true;
        b.kind = 'date';
        b.lead = text.slice(0, text.indexOf(':') + 1) + ' ';
      } else if (/^בברכה/.test(tt)) { signSeen = true; inPrice = false; }
      else if (!titleSeen && /^הצעת מחיר/.test(tt)) { titleSeen = true; b.kind = 'title'; }
      else if (titleSeen && !introSeen && /בהמשך ל/.test(tt)) introSeen = true;
      else if (titleSeen && !introSeen && tt) {
        const g = GUSH_RE.exec(text);
        if (g) { b.kind = 'gush'; b.gush = keep ? g[1] : ''; b.helka = keep ? g[2] : ''; b.ex = tt; }
        else { b.kind = 'subject'; b.t = keep ? text : ''; b.ex = tt; }
      } else if (/^מחיר\s*:?$/.test(tt) && !signSeen) inPrice = true;
      if (b.kind === 'text' && !signSeen) {
        const p = inPrice && parsePrice(text);
        if (p) Object.assign(b, { kind: 'price' }, p);
        else if (MARK_RE.test(text)) { MARK_RE.lastIndex = 0; b.kind = 'blank'; b.blank = 'mark'; b.vals = {}; }
        else if (b.list && /\S {2,}\S/.test(tt)) {
          b.kind = 'blank'; b.blank = 'gap'; b.val = '';
          b.gapAt = text.search(/ {2,}(?=\S)/) + 1;
          b.label = tt.slice(0, tt.search(/ {2,}/)).split(/\s+/).slice(-2).join(' ').replace(/^ה?סקר הינו ל$/, 'מספר עצים');
          if (/עצים/.test(tt.slice(tt.search(/ {2,}/)))) b.label = 'מספר עצים';
        } else if (introSeen && !inPrice && /:$/.test(tt) && !(next && isList(next.xml))) {
          b.kind = 'blank'; b.blank = 'colon'; b.val = ''; b.label = tt.replace(/:$/, '');
        }
      }
      if (b.kind === 'text' && inPrice && /^מחיר\s*:?$/.test(tt)) b.kind = 'priceHead';
      blocks.push(b);
    });
    // אין בתבנית שורות כותרת למילוי (כמו ביציבות): שורת "שם המוסד" מתחת לכותרת, באותו עיצוב כמו הכותרת
    const title = blocks.find(b => b.kind === 'title');
    if (!keep && title && !blocks.some(b => b.kind === 'subject' || b.kind === 'gush')) {
      blocks.splice(blocks.indexOf(title) + 1, 0, { id: uid(), k: 'p', xml: title.xml, text: null, t: '', list: false, center: title.center, bold: title.bold,
        kind: 'subject', label: 'שם המוסד', inst: true, ex: '', fresh: true });
    }
    return blocks;
  }

  function newQuote(tpl, blocks, dateIso) {
    return { id: uid(), tpl: tpl.id, tplName: tpl.name, created: Date.now(), updated: Date.now(), date: dateIso, name: '', blocks };
  }

  // שם הקובץ: שם התבנית + מה שמולא בכותרת (כתובת, גוש/חלקה, מתחם)
  function autoName(q) {
    // ori: יציבות = שם המוסד; היתר בניה = הכתובת בלבד (בלי גוש/חלקה ובלי שם התבנית)
    const inst = q.blocks.find(b => b.inst && !b.del && b.kind === 'subject' && (b.t || '').trim());
    if (inst) return inst.t.trim();
    const subj = q.blocks.filter(b => b.kind === 'subject' && !b.del && (b.t || '').trim()).map(b => b.t.trim());
    if (subj.length) return subj.join(' ');
    const blank = q.blocks.find(b => b.kind === 'blank' && b.blank === 'colon' && !b.del && (b.val || '').trim());
    if (blank) return blank.val.trim();
    const g = q.blocks.find(b => b.kind === 'gush' && !b.del && (b.gush || b.helka));
    if (g) return `גוש ${g.gush} חלקה ${g.helka}`.trim();
    return q.tplName || 'הצעת מחיר';
  }

  function total(q) {
    let s = 0;
    for (const b of q.blocks) if (b.kind === 'price' && !b.del) { const n = Number(String(b.amt || '').replace(/,/g, '')); if (isFinite(n)) s += n; }
    return s;
  }

  // סעיף תמחיר חדש: משוכפל מסעיף קיים (אותו עיצוב ומספור), עם תיאור וסכום
  function makePrice(src, desc, amt) {
    return { id: uid(), k: 'p', xml: src.xml, text: null, t: '', list: src.list, kind: 'price', desc: desc || '', amt: amt || '', sep: src.sep || '–', fresh: true };
  }
  // פסקה חדשה אחרי פסקה קיימת, באותו עיצוב
  function makePara(src, text) {
    return { id: uid(), k: 'p', xml: src.xml, text: null, t: text || '', list: src.list, center: src.center, bold: src.bold, kind: 'text', fresh: true };
  }

  // ---------- בניית קובץ Word ----------
  // ה-XML הסופי של גוף המסמך, פסקה אחרי פסקה
  function finalParts(q) {
    const parts = [];
    for (const b of q.blocks) {
      if (b.del) continue;
      if (b.k === 'raw') { parts.push(b.xml); continue; }
      const t = blockText(q, b);
      if ((b.kind === 'subject' || b.kind === 'gush') && !t) continue; // שורת כותרת שלא מולאה לא נכנסת
      if (b.kind === 'price' && !t) continue;
      if (!b.fresh && t === b.text && b.kind !== 'date') parts.push(b.xml);
      else parts.push(setText(b.xml, t, b.fresh));
    }
    // שורות ריקות בסוף המסמך יוצרות לפעמים עמוד ריק נוסף, ולכן לא נכנסות
    for (let i = parts.length - 1; i > 0; i--) {
      if (/^<w:p\b/.test(parts[i])) {
        if (!paraText(parts[i]).trim() && !/<w:drawing>|<w:pict>|<w:sectPr/.test(parts[i])) { parts.splice(i, 1); continue; }
        break;
      }
    }
    return parts;
  }

  async function build(bytes, q) {
    const { zip, doc, bodyStart, bodyEnd } = await load(bytes);
    const parts = finalParts(q);
    zip.file('word/document.xml', doc.slice(0, bodyStart) + parts.join('') + doc.slice(bodyEnd));
    // תבנית (dotx) -> מסמך (docx)
    const ct = await zip.file('[Content_Types].xml').async('string');
    zip.file('[Content_Types].xml', ct.replace('wordprocessingml.template.main+xml', 'wordprocessingml.document.main+xml'));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  root.Quotes = { BUILTIN, parse, build, finalParts, load, paraText, newQuote, blockText, autoName, total, makePrice, makePara, priceText, fmtAmt, parsePrice, uid };
})(typeof self !== 'undefined' ? self : globalThis);

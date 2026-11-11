// הפקת קובץ אקסל מלא מתוך התבנית "סקר יציבות ירושלים - טאבלט אורנים".
// עובד ישירות על ה-XML שבתוך הקובץ, כך שכל הנוסחאות, העיצוב והמאקרו נשמרים.
(function (root) {
  'use strict';
  const Core = root.Core || (typeof require !== 'undefined' ? require('./core.js') : null);

  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const REL_IMAGE = NS_R + '/image';

  // שורות שנפתחות כשיש עמוד 2 / עמוד 3 (שורות מספרי התמונות והנתיבים נשארות מוסתרות)
  const PAGE2_ROWS = range(56, 110).filter(r => ![64, 65, 87, 88].includes(r));
  const PAGE3_ROWS = range(111, 163).filter(r => ![118, 119, 142, 143].includes(r));

  // אזורי התמונה בנספח: שורה ראשונה של כל בלוק, וגובה השורות בנקודות
  const IMG_ROW0 = [14, 37, 67, 90, 121, 145];
  const BLOCK_HEIGHTS = {
    14: [14.25, 14.25, 15.75, 15.75, 14.25, 14.25, 15, 15, 15, 14.25, 14.25, 14.25, 14.25, 14.25, 14.25, 14.25, 14.25],
    37: [14.25, 14.25, 14.25, 14.25, 14.25, 14.25, 14.25, 14.25, 14.25, 14.25, 14.25, 14.25, 14.25, 14.25, 14.25, 15.75, 15],
    67: rep(14.25, 18), 90: rep(14.25, 18), 121: rep(14.25, 19), 145: rep(14.25, 18),
  };
  // שורות המשבצת בכל בלוק: תווית, מספר תמונה, נתיב, עותק הנתיב, תא התמונה
  const SLOT_ROWS = [[10, 11, 12, 13, 14], [32, 34, 35, 36, 37], [62, 64, 65, 66, 67], [85, 87, 88, 89, 90],
    [116, 118, 119, 120, 121], [140, 142, 143, 144, 145]].map(([label, num, path, copy, img]) => ({ label, num, path, copy, img }));
  const COL_K = 10; // אינדקס 0 של עמודה K
  const COL_PX = 164; // רוחב 22.75 תווים
  const EMU_PX = 9525, EMU_PT = 12700;

  // איפה כל משבצת יושבת בגיליון: [בלוק, קבוצת עמודות (0=K:N, 1=O:R, 2=S:V), משבצת ראשונה]
  // מחקה את נוסחאות התוויות בשורות 10/32/62/85/116/140.
  const LAYOUT = {
    A: [[0, 0, 1], [1, 0, 5], [0, 1, 9], [1, 1, 13], [0, 2, 17], [1, 2, 21]],
    B: [[0, 0, 1], [1, 0, 5], [2, 0, 9], [3, 0, 13], [0, 1, 17], [1, 1, 21], [2, 1, 25], [3, 1, 29],
      [0, 2, 33], [1, 2, 37], [2, 2, 41], [3, 2, 45]],
    C: [[0, 0, 1], [1, 0, 5], [2, 0, 9], [3, 0, 13], [4, 0, 17], [5, 0, 21],
      [0, 1, 25], [1, 1, 29], [2, 1, 33], [3, 1, 37], [4, 1, 41], [5, 1, 45],
      [0, 2, 49], [1, 2, 53], [2, 2, 57], [3, 2, 61], [4, 2, 65], [5, 2, 69]],
  };

  function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }
  function rep(v, n) { return new Array(n).fill(v); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      // תווים שאסורים ב-XML
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }
  function colName(n) { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function colNum(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }

  // מעבר ל-24 תמונות: עמודי נספח נוספים אחרי שורה 163, כל אחד העתק של עמוד 3 (שורות 111-163, 8 תמונות)
  const EXTRA_SRC0 = 111, EXTRA_SRC1 = 163, EXTRA_SPAN = EXTRA_SRC1 - EXTRA_SRC0 + 1;
  const PRINT_LAST_ROW = 278;
  // איפה תמונה מספר i (מ-0) יושבת בנספח: בלוק בתבנית, עמודה, והזזה בשורות לעמודים הנוספים
  function appendixCell(i) {
    if (i < Core.BASE_PRINTED) return { block: Math.floor(i / 4), col: COL_K + (i % 4), off: 0 };
    const k = Math.floor((i - Core.BASE_PRINTED) / Core.PER_EXTRA_PAGE), j = (i - Core.BASE_PRINTED) % Core.PER_EXTRA_PAGE;
    return { block: 4 + Math.floor(j / 4), col: COL_K + (j % 4), off: EXTRA_SPAN * (k + 1) };
  }
  function extraPages(n) { return Math.max(0, Math.ceil((n - Core.BASE_PRINTED) / Core.PER_EXTRA_PAGE)); }
  // יחס רוחב/גובה של תא התמונה בבלוק (רוחב עמודה 22.75 = 164 פיקסלים = 123 נק')
  function slotAspect(block) {
    const hh = BLOCK_HEIGHTS[IMG_ROW0[block]].reduce((a, b) => a + b, 0);
    return (COL_PX * 0.75) / hh;
  }

  // מוסיף עמודי נספח אחרי שורה 163: מעתיק את העיצוב, הגבהים והמיזוגים של K:N בעמוד 3 (בלי נוסחאות),
  // עם מעבר עמוד ידני לפני כל עמוד. מחזיר את השורה האחרונה
  function addAppendixPages(sheet, pages) {
    const src = [];
    for (let r = EXTRA_SRC0; r <= EXTRA_SRC1; r++) {
      const m = sheet.rowRe(r).exec(sheet.xml);
      if (!m) throw new Error('row ' + r + ' missing');
      const attrs = /^<row ([^>]*?)\/?>/.exec(m[0])[1].replace(/\s*\br="\d+"/, '').replace(/\s*\bspans="[^"]*"/, '').trim();
      const cells = [...m[0].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)]
        .filter(c => { const n = colNum(c[1]); return n >= COL_K && n < COL_K + 4; })
        .map(c => { const st = /\ss="(\d+)"/.exec(c[2]); return [c[1], st ? ` s="${st[1]}"` : '']; });
      src.push({ r, attrs, cells });
    }
    let last = EXTRA_SRC1;
    for (let p = 1; p <= pages; p++) {
      for (const row of src) {
        const nr = row.r + EXTRA_SPAN * p;
        const xml = `<row r="${nr}" ${row.attrs}>` + row.cells.map(([c, st]) => `<c r="${c}${nr}"${st}/>`).join('') + '</row>';
        const m = sheet.rowRe(nr).exec(sheet.xml);
        sheet.xml = m ? sheet.xml.replace(m[0], xml) : sheet.xml.replace('</sheetData>', xml + '</sheetData>');
        last = nr;
      }
    }
    // מיזוגים
    const merges = [...sheet.xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g)]
      .filter(m => colNum(m[1]) >= COL_K && colNum(m[3]) < COL_K + 4 && +m[2] >= EXTRA_SRC0 && +m[4] <= EXTRA_SRC1);
    const add = [];
    for (let p = 1; p <= pages; p++) for (const m of merges) add.push(`<mergeCell ref="${m[1]}${+m[2] + EXTRA_SPAN * p}:${m[3]}${+m[4] + EXTRA_SPAN * p}"/>`);
    sheet.xml = sheet.xml.replace(/<mergeCells count="(\d+)">/, (_, n) => `<mergeCells count="${+n + add.length}">`).replace('</mergeCells>', add.join('') + '</mergeCells>');
    // מעבר עמוד לפני כל עמוד נוסף
    const brks = [];
    for (let p = 1; p <= pages; p++) brks.push(`<brk id="${EXTRA_SRC1 + EXTRA_SPAN * (p - 1)}" max="16383" man="1"/>`);
    const rb = `<rowBreaks count="${brks.length}" manualBreakCount="${brks.length}">${brks.join('')}</rowBreaks>`;
    if (/<\/headerFooter>/.test(sheet.xml)) sheet.xml = sheet.xml.replace('</headerFooter>', '</headerFooter>' + rb);
    else sheet.xml = sheet.xml.replace(/(<pageSetup[^>]*\/>)/, '$1' + rb);
    sheet.xml = sheet.xml.replace(/(<dimension ref="[A-Z]+\d+:[A-Z]+)(\d+)"/, (all, a, n) => `${a}${Math.max(+n, last)}"`);
    return last;
  }

  function pageCase(slotCount) {
    // K62 מוצג כשיש משבצת 23, K116 כשיש משבצת 63
    if (slotCount >= 63) return 'C';
    if (slotCount >= 23) return 'B';
    return 'A';
  }

  function slotCell(index, slotCount) {
    for (const [block, group, start] of LAYOUT[pageCase(slotCount)]) {
      if (index >= start && index < start + 4) {
        return { block, col: COL_K + group * 4 + (index - start), printed: group === 0 };
      }
    }
    return null;
  }

  // ---------- עריכת ה-XML של הגיליון ----------
  class Sheet {
    constructor(xml) { this.xml = xml; }
    rowRe(r) { return new RegExp('<row r="' + r + '"[^>]*?(?:/>|>[\\s\\S]*?</row>)'); }
    setCell(ref, cellXmlFn) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      const r = +m[2];
      const rowM = this.rowRe(r).exec(this.xml);
      if (!rowM) throw new Error('row ' + r + ' missing');
      let row = rowM[0];
      if (row.endsWith('/>')) row = row.slice(0, -2) + '></row>';
      const cellRe = new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>[\\s\\S]*?</c>)');
      const cm = cellRe.exec(row);
      let newRow;
      if (cm) {
        const s = /\ss="(\d+)"/.exec(cm[1]);
        newRow = row.replace(cm[0], cellXmlFn(ref, s ? s[1] : null));
      } else {
        // הכנסה לפי סדר העמודות
        const target = colNum(m[1]);
        const cells = [...row.matchAll(/<c r="([A-Z]+)\d+"/g)];
        const after = cells.find(c => colNum(c[1]) > target);
        const xml = cellXmlFn(ref, null);
        newRow = after ? row.slice(0, after.index) + xml + row.slice(after.index) : row.replace('</row>', xml + '</row>');
      }
      this.xml = this.xml.replace(rowM[0], newRow);
    }
    unhideRow(r) {
      this.xml = this.xml.replace(new RegExp('(<row r="' + r + '"[^>]*?) hidden="1"'), '$1');
    }
  }

  class Strings {
    constructor(xml) {
      this.xml = xml;
      this.count = (xml.match(/<si>/g) || []).length;
      this.added = [];
    }
    add(text) {
      this.added.push('<si><t xml:space="preserve">' + esc(text) + '</t></si>');
      return this.count + this.added.length - 1;
    }
    toXml() {
      const total = this.count + this.added.length;
      return this.xml.replace('</sst>', this.added.join('') + '</sst>')
        .replace(/uniqueCount="\d+"/, 'uniqueCount="' + total + '"')
        .replace(/ count="\d+"/, ' count="' + total + '"');
    }
  }

  function strCell(strings, text) {
    return (ref, s) => `<c r="${ref}"${s ? ` s="${s}"` : ''} t="s"><v>${strings.add(text)}</v></c>`;
  }
  function numCell(v) {
    return (ref, s) => `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${v}</v></c>`;
  }
  function emptyCell() {
    return (ref, s) => `<c r="${ref}"${s ? ` s="${s}"` : ''}/>`;
  }
  function valueCell(strings, v) {
    if (v == null || v === '') return emptyCell();
    if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v).trim())) return numCell(Number(v));
    return strCell(strings, String(v));
  }

  function dateSerial(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  }

  // מיקום תמונה בתוך משבצת, שומר על יחס גובה-רוחב וממרכז
  function anchorFor(cell, w, h) {
    const row0 = IMG_ROW0[cell.block];
    const heights = BLOCK_HEIGHTS[row0];
    const boxW = COL_PX * EMU_PX, boxH = heights.reduce((a, b) => a + b, 0) * EMU_PT;
    const pad = 3 * EMU_PX;
    const scale = Math.min((boxW - 2 * pad) / w, (boxH - 2 * pad) / h);
    const cx = Math.round(w * scale), cy = Math.round(h * scale);
    const offX = Math.round((boxW - cx) / 2), offY = Math.round((boxH - cy) / 2);
    const locate = (y) => {
      let acc = 0;
      for (let i = 0; i < heights.length; i++) {
        const hh = heights[i] * EMU_PT;
        if (y < acc + hh || i === heights.length - 1) return { row: row0 - 1 + i, off: Math.round(Math.min(y - acc, hh)) };
        acc += hh;
      }
    };
    const from = locate(offY), to = locate(offY + cy);
    return { from, to, offX, cx, cy };
  }

  function picXml(id, rid, name, cell, a) {
    return `<xdr:twoCellAnchor editAs="twoCell"><xdr:from><xdr:col>${cell.col}</xdr:col><xdr:colOff>${a.offX}</xdr:colOff><xdr:row>${a.from.row}</xdr:row><xdr:rowOff>${a.from.off}</xdr:rowOff></xdr:from>` +
      `<xdr:to><xdr:col>${cell.col}</xdr:col><xdr:colOff>${a.offX + a.cx}</xdr:colOff><xdr:row>${a.to.row}</xdr:row><xdr:rowOff>${a.to.off}</xdr:rowOff></xdr:to>` +
      `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${esc(name)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
      `<xdr:blipFill><a:blip xmlns:r="${NS_R}" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
      `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${a.cx}" cy="${a.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;
  }

  async function openDrawing(zip) {
    const drawPath = 'xl/drawings/drawing1.xml';
    const relPath = 'xl/drawings/_rels/drawing1.xml.rels';
    let draw = await zip.file(drawPath).async('string');
    let rels = await zip.file(relPath).async('string');
    let nextId = 100, nextRid = 100;
    const anchors = [];
    return {
      add(slot, cell, data, photo) {
        const media = `tree_photo_${slot.index}.jpg`;
        zip.file('xl/media/' + media, data.bytes || data.blob);
        const rid = 'rId' + (nextRid++);
        rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="${REL_IMAGE}" Target="../media/${media}"/></Relationships>`);
        anchors.push(picXml(nextId++, rid, 'תמונה ' + slot.index + ' עץ ' + slot.label, cell, anchorFor(cell, data.w || photo.w, data.h || photo.h)));
      },
      async save() {
        zip.file(drawPath, draw.replace('</xdr:wsDr>', anchors.join('') + '</xdr:wsDr>'));
        zip.file(relPath, rels);
        let ct = await zip.file('[Content_Types].xml').async('string');
        if (!/Extension="jpg"/i.test(ct)) ct = ct.replace('<Default Extension="png"', '<Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png"');
        zip.file('[Content_Types].xml', ct);
      },
    };
  }

  // תמונה בתוך התא (כמו "הכנס תמונה > מקם בתוך התא" באקסל): richData + metadata.
  // התא מכיל #VALUE! עם vm שמפנה לתמונה. אקסל 365 (גם באנדרואיד) מציג אותה בתוך התא הממוזג
  const RD = 'http://schemas.microsoft.com/office/spreadsheetml/2017/richdata';
  async function openCellImages(zip) {
    const imgs = [];
    return {
      // מחזיר פונקציית תא כמו strCell
      add(slot, data) {
        const media = `tree_photo_${slot.index}.jpg`;
        zip.file('xl/media/' + media, data.bytes || data.blob);
        imgs.push(media);
        const vm = imgs.length; // 1-based
        return (ref, s) => `<c r="${ref}"${s ? ` s="${s}"` : ''} t="e" vm="${vm}"><v>#VALUE!</v></c>`;
      },
      async save() {
        if (!imgs.length) return;
        const n = imgs.length;
        const idx = imgs.map((_, i) => i);
        zip.file('xl/metadata.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          `<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="${RD}">` +
          '<metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1"/></metadataTypes>' +
          `<futureMetadata name="XLRICHVALUE" count="${n}">` + idx.map(i => `<bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="${i}"/></ext></extLst></bk>`).join('') + '</futureMetadata>' +
          `<valueMetadata count="${n}">` + idx.map(i => `<bk><rc t="1" v="${i}"/></bk>`).join('') + '</valueMetadata></metadata>');
        zip.file('xl/richData/rdrichvalue.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          `<rvData xmlns="${RD}" count="${n}">` + idx.map(i => `<rv s="0"><v>${i}</v><v>5</v></rv>`).join('') + '</rvData>');
        zip.file('xl/richData/rdrichvaluestructure.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          `<rvStructures xmlns="${RD}" count="1"><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>`);
        zip.file('xl/richData/rdRichValueTypes.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<rvTypesInfo xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata2" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><global><keyFlags>' +
          '<key name="_Self"><flag name="ExcludeFromFile" value="1"/><flag name="ExcludeFromCalcComparison" value="1"/></key>' +
          '<key name="_DisplayString"><flag name="ExcludeFromCalcComparison" value="1"/></key>' +
          '<key name="_Flags"><flag name="ExcludeFromCalcComparison" value="1"/></key>' +
          '<key name="_Format"><flag name="ExcludeFromCalcComparison" value="1"/></key>' +
          '<key name="_SubLabel"><flag name="ExcludeFromCalcComparison" value="1"/></key>' +
          '<key name="_Attribution"><flag name="ExcludeFromCalcComparison" value="1"/></key>' +
          '<key name="_Icon"><flag name="ExcludeFromCalcComparison" value="1"/></key>' +
          '<key name="_Display"><flag name="ExcludeFromCalcComparison" value="1"/></key>' +
          '<key name="_CanonicalPropertyNames"><flag name="ExcludeFromCalcComparison" value="1"/></key>' +
          '<key name="_ClassificationId"><flag name="ExcludeFromCalcComparison" value="1"/></key>' +
          '</keyFlags></global></rvTypesInfo>');
        zip.file('xl/richData/richValueRel.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          `<richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="${NS_R}">` + idx.map(i => `<rel r:id="rId${i + 1}"/>`).join('') + '</richValueRels>');
        zip.file('xl/richData/_rels/richValueRel.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          imgs.map((m, i) => `<Relationship Id="rId${i + 1}" Type="${REL_IMAGE}" Target="../media/${m}"/>`).join('') + '</Relationships>');
        let wbRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
        wbRels = wbRels.replace('</Relationships>',
          '<Relationship Id="rIdMeta" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/>' +
          '<Relationship Id="rIdRv" Type="http://schemas.microsoft.com/office/2017/06/relationships/rdRichValue" Target="richData/rdrichvalue.xml"/>' +
          '<Relationship Id="rIdRvs" Type="http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueStructure" Target="richData/rdrichvaluestructure.xml"/>' +
          '<Relationship Id="rIdRvt" Type="http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueTypes" Target="richData/rdRichValueTypes.xml"/>' +
          '<Relationship Id="rIdRvr" Type="http://schemas.microsoft.com/office/2022/10/relationships/richValueRel" Target="richData/richValueRel.xml"/></Relationships>');
        zip.file('xl/_rels/workbook.xml.rels', wbRels);
        let ct = await zip.file('[Content_Types].xml').async('string');
        if (!/Extension="jpg"/i.test(ct)) ct = ct.replace('<Default Extension="png"', '<Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png"');
        ct = ct.replace('</Types>',
          '<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/>' +
          '<Override PartName="/xl/richData/rdrichvalue.xml" ContentType="application/vnd.ms-excel.rdrichvalue+xml"/>' +
          '<Override PartName="/xl/richData/rdrichvaluestructure.xml" ContentType="application/vnd.ms-excel.rdrichvaluestructure+xml"/>' +
          '<Override PartName="/xl/richData/rdRichValueTypes.xml" ContentType="application/vnd.ms-excel.rdrichvaluetypes+xml"/>' +
          '<Override PartName="/xl/richData/richValueRel.xml" ContentType="application/vnd.ms-excel.richvaluerel+xml"/></Types>');
        zip.file('[Content_Types].xml', ct);
      },
    };
  }

  // גיליון שני: נ"צ ותמונות (לא מודפס בדוח)
  function fieldSheetXml(survey, slots) {
    const head = ['מספר העץ', 'מין עץ', 'דחיפות', 'אורנים', 'קו רוחב', 'קו אורך', 'דיוק (מ\')', 'מפה', 'תמונות שצולמו', 'תמונות בנספח', 'הערות', 'פרטי תמונות'];
    const isc = (ref, t) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
    const nc = (ref, v) => `<c r="${ref}"><v>${v}</v></c>`;
    const rows = [];
    rows.push(`<row r="1">${head.map((h, i) => isc(colName(i) + '1', h)).join('')}</row>`);
    let r = 2;
    for (const t of Core.sortTrees(survey.trees).filter(Core.hasContent)) {
      const cells = [];
      const put = (i, v) => {
        if (v == null || v === '') return;
        const ref = colName(i) + r;
        cells.push(typeof v === 'number' ? nc(ref, v) : isc(ref, String(v)));
      };
      put(0, /^\d+$/.test(String(t.num || '')) ? Number(t.num) : t.num);
      put(1, t.species);
      put(2, /^\d+$/.test(String(t.urgency || '')) ? Number(t.urgency) : t.urgency);
      put(3, t.pines != null && t.pines !== '' ? Number(t.pines) : null);
      if (t.lat != null) {
        put(4, +t.lat.toFixed(6)); put(5, +t.lon.toFixed(6));
        if (t.acc != null) put(6, Math.round(t.acc));
        const url = `https://www.google.com/maps?q=${t.lat.toFixed(6)},${t.lon.toFixed(6)}`;
        cells.push(`<c r="H${r}" t="str"><f>HYPERLINK("${url}","מפה")</f><v>מפה</v></c>`);
      }
      put(8, (t.photos || []).length);
      put(9, slots.filter(s => s.tree === t).map(s => s.index).join(', '));
      put(11, (t.photos || []).map(p => p.note).filter(Boolean).join(' | '));
      put(10, t.notes);
      cells.sort((a, b) => colNum(/r="([A-Z]+)/.exec(a)[1]) - colNum(/r="([A-Z]+)/.exec(b)[1]));
      rows.push(`<row r="${r}">${cells.join('')}</row>`);
      r++;
    }
    const widths = [10, 18, 8, 8, 11, 11, 9, 8, 12, 12, 40, 40];
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + NS_R + '">' +
      '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>' +
      '<sheetData>' + rows.join('') + '</sheetData></worksheet>';
  }

  /**
   * survey: נתוני הסקר. getPhoto(id) -> Promise<{blob|bytes, w, h}>
   * opts.embedPhotos: להכניס את התמונות לתוך הנספח
   * מחזיר Promise<Uint8Array> של קובץ xlsm
   */
  async function buildWorkbook(templateBytes, survey, getPhoto, opts) {
    opts = Object.assign({ embedPhotos: true }, opts || {});
    const JSZip = root.JSZip || globalThis.JSZip;
    const zip = await JSZip.loadAsync(templateBytes);
    const sheet = new Sheet(await zip.file('xl/worksheets/sheet1.xml').async('string'));
    const strings = new Strings(await zip.file('xl/sharedStrings.xml').async('string'));

    // כותרת
    // סמל מוסד / מנהל שלא מולאו: גם הכותרת שלהם לא מופיעה בדוח
    if (survey.code) sheet.setCell('B5', valueCell(strings, survey.code)); else sheet.setCell('A5', emptyCell());
    if (survey.manager) sheet.setCell('B6', strCell(strings, survey.manager)); else sheet.setCell('A6', emptyCell());
    // F9 תוספת לכותרת + שם המוסד, D10 הכתובת ("רחוב, עיר"), כמו בדוחות במחשב
    const place = Core.placeOf(survey);
    if (place.head) sheet.setCell('F9', strCell(strings, place.head));
    if (place.address) sheet.setCell('D10', strCell(strings, place.address));
    if (survey.date) sheet.setCell('F2', numCell(dateSerial(survey.date)));

    // עצים
    // מין העץ וההערות: "התאם לגודל התא", כדי שטקסט ארוך יוקטן ולא ייחתך (כמו ב-PDF)
    let stylesXml = await zip.file('xl/styles.xml').async('string');
    const shrunk = new Map();
    const shrinkStyle = s => {
      if (s == null) return s;
      if (shrunk.has(s)) return shrunk.get(s);
      const m = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
      const xfs = m ? m[2].match(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) : null;
      if (!xfs || !xfs[+s]) { shrunk.set(s, s); return s; }
      let xf = xfs[+s];
      if (/<alignment/.test(xf)) xf = xf.replace(/<alignment(?![^>]*shrinkToFit)/, '<alignment shrinkToFit="1"');
      else xf = xf.replace(/\s*\/>$/, '><alignment shrinkToFit="1"/></xf>').replace(/(<xf [^>]*?)>/, (a, b) => /applyAlignment/.test(b) ? a : b + ' applyAlignment="1">');
      const id = xfs.length;
      stylesXml = stylesXml.replace(m[0], `<cellXfs count="${id + 1}">${m[2]}${xf}</cellXfs>`);
      shrunk.set(s, String(id));
      return String(id);
    };
    const fitCell = fn => (ref, s) => fn(ref, shrinkStyle(s));
    const trees = Core.sortTrees(survey.trees).filter(Core.hasContent).slice(0, Core.MAX_TREES);
    trees.forEach((t, i) => {
      const r = Core.TREE_ROWS[i];
      sheet.setCell('A' + r, valueCell(strings, String(t.num || '').trim()));
      sheet.setCell('B' + r, fitCell(valueCell(strings, (t.species || '').trim())));
      sheet.setCell('D' + r, fitCell(valueCell(strings, Core.notesCell(t))));
      sheet.setCell('I' + r, valueCell(strings, Core.urgencyCell(t)));
      sheet.setCell('J' + r, valueCell(strings, Core.jValue(t)));
    });

    const placed = [];
    let slots, lastRow = 0;
    if (opts.embedPhotos) {
      // הנספח נבנה כאן: תמונה בכל משבצת לפי הסדר, רק בעמודות המודפסות K:N
      slots = Core.reportSlots(survey.trees).slice(0, Core.MAX_PRINTED);
      if (trees.length > 22 || slots.length > 8) PAGE2_ROWS.forEach(r => sheet.unhideRow(r));
      if (trees.length > 62 || slots.length > 16) PAGE3_ROWS.forEach(r => sheet.unhideRow(r));
      // מנקה את תוויות המשבצות, מספרי התמונות והנתיבים של התבנית
      for (const st of SLOT_ROWS) for (const r of [st.label, st.num, st.path, st.copy, st.img]) {
        for (let c = COL_K; c < COL_K + 12; c++) sheet.setCell(colName(c) + r, emptyCell());
      }
      const pages = extraPages(slots.length);
      if (pages) lastRow = addAppendixPages(sheet, pages);
      const cellImgs = await openCellImages(zip);
      for (const slot of slots) {
        const cell = appendixCell(slot.index - 1);
        sheet.setCell(colName(cell.col) + (SLOT_ROWS[cell.block].label + cell.off), valueCell(strings, slot.label));
        // התמונה נחתכת ליחס של התא, כדי שתמלא אותו כמו השאר
        const data = await getPhoto(slot.photo.id, slotAspect(cell.block));
        if (!data) continue;
        sheet.setCell(colName(cell.col) + (SLOT_ROWS[cell.block].img + cell.off), cellImgs.add(slot, data));
        placed.push({ index: slot.index, printed: true });
      }
      await cellImgs.save();
    } else {
      // מצב התבנית: הנוסחאות של התבנית קובעות את הנספח, התמונות מגיעות מתיקיית Pictures
      slots = Core.slotsOf(survey.trees);
      const pc = pageCase(slots.length);
      if (trees.length > 22 || pc !== 'A') PAGE2_ROWS.forEach(r => sheet.unhideRow(r));
      if (trees.length > 62 || pc === 'C') PAGE3_ROWS.forEach(r => sheet.unhideRow(r));
    }

    // הפס התחתון עם פרטי הקשר (קיים בתבנית אבל לא מופעל בה, ובדוחות של אורי כן)
    if (!/<oddFooter>/.test(sheet.xml)) sheet.xml = sheet.xml.replace('</oddHeader></headerFooter>', '</oddHeader><oddFooter>&amp;C&amp;G</oddFooter></headerFooter>');
    zip.file('xl/worksheets/sheet1.xml', sheet.xml);
    zip.file('xl/sharedStrings.xml', strings.toXml());
    if (shrunk.size) zip.file('xl/styles.xml', stylesXml);

    // גיליון נתוני שטח
    zip.file('xl/worksheets/sheet2.xml', fieldSheetXml(survey, slots));
    let wb = await zip.file('xl/workbook.xml').async('string');
    // אזור ההדפסה של הנספח מתארך כשנוספו עמודים
    if (lastRow > PRINT_LAST_ROW) wb = wb.replace(/(Print_Area[^>]*>[^<]*\$K\$1:\$N\$)(\d+)/, (all, a, n) => a + Math.max(+n, lastRow));
    wb = wb.replace('</sheets>', '<sheet name="נתוני שטח" sheetId="2" r:id="rIdField"/></sheets>');
    zip.file('xl/workbook.xml', wb);
    let wbRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    wbRels = wbRels.replace('</Relationships>', '<Relationship Id="rIdField" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>');
    zip.file('xl/_rels/workbook.xml.rels', wbRels);
    let ct = await zip.file('[Content_Types].xml').async('string');
    ct = ct.replace('application/vnd.ms-excel.template.macroEnabled.main+xml', 'application/vnd.ms-excel.sheet.macroEnabled.main+xml')
      .replace('</Types>', '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
    zip.file('[Content_Types].xml', ct);

    // בלי רשומות תיקייה בקובץ, כמו בקבצים שאקסל עצמו שומר
    for (const [p, f] of Object.entries(zip.files)) if (f.dir) delete zip.files[p];
    const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12' });
    return { bytes: out, slots, placed };
  }

  const api = { buildWorkbook, slotCell, pageCase, dateSerial, appendixCell, extraPages, slotAspect, SLOT_ROWS, PAGE2_ROWS, PAGE3_ROWS, EXTRA_SPAN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SurveyExcel = api;
})(typeof self !== 'undefined' ? self : this);

// החתימה והחותמת של ori לא נמצאות באתר הציבורי ולא בתבניות שבו.
// הן נשמרות רק במכשיר (IndexedDB) ובתיקיית הגיבוי בגוגל דרייב, ונכנסות לדוחות ולהצעות המחיר בזמן ההפקה.
// בתבניות יש במקומן תמונה ריקה (PNG שקוף עם הסימון sig-placeholder) שמוחלפת בחתימה.
(function (root) {
  'use strict';
  const KEY = 'signature';
  const DRIVE_NAME = 'חתימה וחותמת.png';
  const BACKUP_ROOT = 'גיבוי אפליקציית סקרי עצים';
  const MARK = 'sig-placeholder';
  const EMPTY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
  const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

  let loaded = null;
  const Sig = {
    src: EMPTY, // לתצוגה ול-PDF: החתימה כ-data URL, או תמונה שקופה כשאין חתימה במכשיר
    has: false,

    async bytes() {
      const b = await DB.getKV(KEY, null);
      return b && b.length ? b : null;
    },
    load() { return loaded || (loaded = Sig._load()); },
    async _load() {
      let b = await Sig.bytes();
      if (!b) b = await Sig._migrate();
      if (!b) b = await Sig._fromDrive().catch(() => null);
      Sig.has = !!b;
      Sig.src = b ? await blobToDataUrl(new Blob([b], { type: 'image/png' })) : EMPTY;
      if (!b) loaded = null; // בפעם הבאה מנסים שוב (למשל אחרי התחברות לדרייב)
      return Sig.has;
    },
    async set(blob, fromCloud) {
      const b = new Uint8Array(await blob.arrayBuffer());
      if (b.length < 8 || b[0] !== 0x89 || b[1] !== 0x50) throw new Error('צריך קובץ PNG');
      await DB.setKV(KEY, b);
      await DB.setKV('sigUploaded', !!fromCloud);
      loaded = null;
      await Sig.load();
      if (!fromCloud) Sig.sync().catch(() => {});
    },

    // מכשיר שכבר היה מותקן: ה-service worker העביר את החותמת הישנה למטמון פרטי (ראו sw.js)
    async _migrate() {
      if (!root.caches) return null;
      try {
        const c = await caches.open('tree-survey-private');
        const r = await c.match('signature.png');
        if (!r) return null;
        const b = new Uint8Array(await r.arrayBuffer());
        await DB.setKV(KEY, b); await DB.setKV('sigUploaded', false);
        await c.delete('signature.png');
        return b;
      } catch (e) { return null; }
    },
    async _root() { return OD.folder(null, (await DB.getKV('odBackupRoot', BACKUP_ROOT)) || BACKUP_ROOT); },
    async _fromDrive() {
      if (!navigator.onLine || !(await OD.connected())) return null;
      const f = await OD.findFile(await Sig._root(), DRIVE_NAME);
      const blob = f && await OD.download(f.id);
      if (!blob) return null;
      const b = new Uint8Array(await blob.arrayBuffer());
      await DB.setKV(KEY, b); await DB.setKV('sigUploaded', true);
      return b;
    },
    // נקרא מהסנכרון ברקע: מעלה חתימה חדשה לדרייב, או מוריד אותה למכשיר שאין בו
    async sync(r) {
      if (!(await OD.connected())) return;
      const b = await Sig.bytes();
      if (b && !(await DB.getKV('sigUploaded', false))) {
        await OD.upload(r || await Sig._root(), DRIVE_NAME, new Blob([b], { type: 'image/png' }), true);
        await DB.setKV('sigUploaded', true);
      } else if (!b && await Sig._fromDrive()) { loaded = null; await Sig.load(); }
    },

    // מחליף בתבנית (xlsm/dotx) את התמונה הריקה בחתימה
    async patch(bytes) {
      const sig = (await Sig.load()) && await Sig.bytes();
      if (!sig) return bytes;
      const zip = await JSZip.loadAsync(bytes);
      let changed = false;
      for (const f of zip.file(/\/media\/[^/]+\.png$/i)) {
        const b = await f.async('uint8array');
        if (b.length > 400 || !new TextDecoder('latin1').decode(b).includes(MARK)) continue;
        zip.file(f.name, sig);
        changed = true;
      }
      return changed ? zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) : bytes;
    }
  };
  root.Sig = Sig;
})(typeof window !== 'undefined' ? window : globalThis);

// עבודה בלי קליטה: שומר את קבצי האפליקציה במטמון
const CACHE = 'tree-survey-v1.31.3';
const FILES = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'vendor/jszip.min.js', 'js/core.js', 'js/excel.js',
  'js/db.js', 'js/telegram.js', 'js/gis.js', 'js/gdrive.js', 'js/sync.js', 'js/annotate.js', 'js/print.js', 'js/camera.js', 'js/voice.js', 'js/gemini.js', 'js/reports.js', 'js/importer.js', 'js/construction-data.js', 'js/construction.js', 'template/construction.xltm', 'js/pdfvec.js', 'vendor/pdf-lib.min.js', 'vendor/fontkit.umd.min.js', 'js/quotes.js', 'js/quote-print.js', 'js/quotes-ui.js', 'template/quotes/construction.dotx', 'template/quotes/construction-tlv.dotx', 'template/quotes/stability.dotx', 'js/app.js', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/proj4.min.js', 'template/survey.xltm', 'template/layout.json', 'template/letterhead.png', 'template/footer.png', 'template/build-logo.png', 'template/build-footer.png', 'js/signature.js', 'fonts/arimo-hebrew-400.ttf', 'fonts/arimo-hebrew-700.ttf', 'fonts/arimo-latin-400.ttf', 'fonts/arimo-latin-700.ttf', 'fonts/arimo-hebrew-400-normal.woff2', 'fonts/arimo-hebrew-700-normal.woff2', 'fonts/arimo-latin-400-normal.woff2', 'fonts/arimo-latin-700-normal.woff2', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
// החותמת כבר לא באתר. במכשיר שהיא שמורה אצלו במטמון של גרסה קודמת, היא עוברת למטמון פרטי
// שלא נמחק, והאפליקציה מעבירה אותה משם למכשיר ולגוגל דרייב (js/signature.js)
const PRIVATE = 'tree-survey-private';
async function keepStamp(keys) {
  for (const k of keys) {
    if (k === CACHE || k === PRIVATE) continue;
    const r = await (await caches.open(k)).match('template/stamp.png', { ignoreSearch: true });
    if (r && r.ok) { await (await caches.open(PRIVATE)).put('signature.png', r); return; }
  }
}
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => keepStamp(keys).catch(() => {}).then(() => Promise.all(keys.filter(k => k !== CACHE && k !== PRIVATE).map(k => caches.delete(k)))))
    .then(() => self.clients.claim()));
});
// קודם מהרשת (כדי לקבל עדכונים), ואם אין קליטה מהמטמון
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // no-cache: לא להשתמש בעותק הישן שהדפדפן שומר 10 דקות, כדי שעדכון יגיע מיד
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

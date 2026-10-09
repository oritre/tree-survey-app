// עבודה בלי קליטה: שומר את קבצי האפליקציה במטמון
const CACHE = 'tree-survey-v1.4.0';
const FILES = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'vendor/jszip.min.js', 'js/core.js', 'js/excel.js',
  'js/db.js', 'js/telegram.js', 'js/gis.js', 'js/onedrive.js', 'js/sync.js', 'js/annotate.js', 'js/print.js', 'js/app.js', 'template/survey.xltm', 'template/layout.json', 'template/letterhead.png', 'template/footer.png', 'template/stamp.png', 'fonts/arimo-hebrew-400-normal.woff2', 'fonts/arimo-hebrew-700-normal.woff2', 'fonts/arimo-latin-400-normal.woff2', 'fonts/arimo-latin-700-normal.woff2', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
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

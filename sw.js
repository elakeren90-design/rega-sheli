// מאפשר לפתוח את ״רגע שלי״ גם בלי אינטרנט.
// בכל עדכון של הקבצים: להעלות את מספר הגרסה כאן.
const VERSION = 'v1';
const CACHE = 'rega-sheli-' + VERSION;
const ASSETS = [
  './',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/store.js',
  './js/recorder.js',
  './js/backup.js',
  './js/questions.js',
  './fonts/rubik-hebrew.woff2',
  './fonts/rubik-latin.woff2',
  './fonts/playpen-hebrew.woff2',
  './fonts/playpen-latin.woff2',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rega-sheli-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// קודם מהזיכרון (מהיר וגם בלי אינטרנט), ובמקביל מתעדכן לפעם הבאה
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isPage = req.mode === 'navigate';
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = isPage ? './' : req;
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic' && !res.redirected) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached) {
        event.waitUntil(network.catch(() => {}));
        return cached;
      }
      return network.then((res) => res || new Response('', { status: 504 }));
    })
  );
});

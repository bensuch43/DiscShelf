// DiscShelf service worker: precache the app shell, serve it cache-first,
// and keep TMDB poster images in a separate long-lived cache for offline use.
// Bump VERSION with every release (must match CONFIG.version; a test checks).
const VERSION = '0.4.0';
const CACHE = `discshelf-${VERSION}`;
const POSTER_CACHE = 'discshelf-posters-v1'; // survives app updates
const POSTER_HOST = 'https://image.tmdb.org';
const POSTER_LIMIT = 3000;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/config.js',
  './js/db.js',
  './js/money.js',
  './js/ean.js',
  './js/value.js',
  './js/backup.js',
  './js/prices.js',
  './js/lookup.js',
  './js/scanner.js',
  './js/csv.js',
  './js/share.js',
  './js/ui.js',
  './js/views/collection.js',
  './js/views/item-form.js',
  './js/views/lookup-panel.js',
  './js/views/wants.js',
  './js/views/settings.js',
  './js/views/shared.js',
  './vendor/zxing.min.js',
  './vendor/ZXING-LICENSE.txt',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' bypasses the HTTP cache so a new version never precaches stale files.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('discshelf-') && k !== CACHE && k !== POSTER_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function posterResponse(request) {
  const cache = await caches.open(POSTER_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  // <img> requests are no-cors, so responses are opaque (status 0); cache those and 200s.
  if (res.ok || res.type === 'opaque') {
    await cache.put(request, res.clone());
    const keys = await cache.keys();
    if (keys.length > POSTER_LIMIT) await Promise.all(keys.slice(0, keys.length - POSTER_LIMIT).map((k) => cache.delete(k)));
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === POSTER_HOST) {
    event.respondWith(posterResponse(request));
    return;
  }
  if (url.origin !== self.location.origin) return; // API calls go straight to the network
  if (request.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then((hit) => hit || fetch(request)));
    return;
  }
  event.respondWith(caches.match(request, { ignoreSearch: true }).then((hit) => hit || fetch(request)));
});

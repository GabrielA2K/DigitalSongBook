/* Service worker: offline-first for the app shell + third-party libs/fonts */
const VERSION = 'v3';
const CACHE = 'songbook-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

// Third-party assets the page loads (must match index.html)
const CDN = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/papaparse/5.4.1/papaparse.min.js'
];
// Stylesheets whose url(...) font files also get precached
const CSS = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800;900&family=Inter:wght@300;400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap'
];

async function put(cache, url, opts) {
  try {
    const res = await fetch(url, opts);
    if (res && (res.ok || res.type === 'opaque')) { await cache.put(url, res.clone()); }
    return res;
  } catch (e) { return null; }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await Promise.all(CDN.map(u => put(cache, u, { mode: 'no-cors' })));
    for (const cssUrl of CSS) {
      const res = await put(cache, cssUrl, { mode: 'cors' });
      if (!res || !res.ok) continue;
      const text = await res.clone().text();
      const urls = [...text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)]
        .map(m => new URL(m[1], cssUrl).href)
        .filter(u => !u.startsWith('data:'));
      await Promise.all([...new Set(urls)].map(u => put(cache, u, { mode: 'no-cors' })));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('songbook-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Page navigations: network-first so updates arrive, fall back to cached shell offline.
  // The app uses query params for state, so ignore the query when matching.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok && url.origin === location.origin) {
          const cache = await caches.open(CACHE);
          cache.put('./index.html', fresh.clone());
        }
        return fresh;
      } catch (e) {
        return (await caches.match('./index.html', { ignoreSearch: true })) ||
               (await caches.match('./', { ignoreSearch: true }));
      }
    })());
    return;
  }

  // Everything else: cache-first, then network (and cache the result).
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreVary: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque') && url.protocol.startsWith('http')) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (e) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});

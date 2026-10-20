/* Service worker: local-first offline caching for app shell and fonts */
const VERSION = 'v16';
const CACHE = 'songbook-' + VERSION;

// Local assets precached on service worker installation
const SHELL = [
  './',
  './index.html',
  './songs.csv',
  './songs_less.csv',
  './manifest.webmanifest',
  './webfonts/fa-solid-900.woff2',
  './webfonts/fa-brands-400.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Precache all local shell assets
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Clean up outdated cache versions
    await Promise.all(
      keys.filter(k => k.startsWith('songbook-') && k !== CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1. Page navigations: Network-first, fallback to cached shell
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

  // 2. Default CSV song lists: Network-first to fetch updates, fallback to cache
  if (url.origin === location.origin && /\/songs(_less)?\.csv$/.test(url.pathname)) {
    const key = './' + url.pathname.split('/').pop();
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(key, fresh.clone());
        return fresh;
      } catch (e) {
        return (await cache.match(key, { ignoreSearch: true })) || new Response('', { status: 504 });
      }
    })());
    return;
  }

  // 3. Cache-first strategy for local assets, images, and external dependencies
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
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
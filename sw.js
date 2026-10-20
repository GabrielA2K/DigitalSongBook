/* Service worker: offline-first for app shell + third-party libs/fonts */
const VERSION = 'v13';
const CACHE = 'songbook-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './songs.csv',
  './songs_less.csv',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

// Third-party scripts and styles to cache
const CDN = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/papaparse/5.4.1/papaparse.min.js'
];

const CSS = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800;900&family=Inter:wght@300;400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap'
];

// Safe put function to store assets by string URL key
async function put(cache, url, opts) {
  try {
    const res = await fetch(url, opts);
    if (res && (res.ok || res.type === 'opaque')) {
      await cache.put(url, res.clone());
    }
    return res;
  } catch (e) {
    return null;
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    
    // Cache local app shell
    await cache.addAll(SHELL);
    
    // Cache CDN scripts
    await Promise.all(CDN.map(u => put(cache, u, { mode: 'no-cors' })));
    
    // Cache CSS and extract referenced font files (.woff2) for precaching
    for (const cssUrl of CSS) {
      const res = await put(cache, cssUrl, { mode: 'cors' }) || await put(cache, cssUrl, { mode: 'no-cors' });
      if (!res) continue;
      
      try {
        const text = await res.clone().text();
        const fontUrls = [...text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)]
          .map(m => new URL(m[1], cssUrl).href)
          .filter(u => !u.startsWith('data:'));
        
        await Promise.all([...new Set(fontUrls)].map(u => put(cache, u, { mode: 'no-cors' })));
      } catch (e) {
        // Fallback for opaque CSS where body reading is restricted
      }
    }
    
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Clean up older caches
    await Promise.all(keys.filter(k => k.startsWith('songbook-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1. Page navigations: Network-first, fall back to cached shell
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

  // 2. Default song lists (CSV): Network-first
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

  // 3. Dedicated handler for FontAwesome & Google Fonts (.woff2, .css)
  if (url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('fonts.gstatic.com') || url.pathname.match(/\.(woff2?|ttf|eot|otf)$/i)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      
      // Match using the string URL to avoid CORS/Request mode mismatches on reload
      const cachedResponse = await cache.match(req.url, { ignoreSearch: true, ignoreVary: true });
      if (cachedResponse) return cachedResponse;

      try {
        const fresh = await fetch(req);
        if (fresh && (fresh.ok || fresh.type === 'opaque')) {
          cache.put(req.url, fresh.clone());
        }
        return fresh;
      } catch (e) {
        return new Response('', { status: 504, statusText: 'Font Asset Unavailable Offline' });
      }
    })());
    return;
  }

  // 4. Everything else: Cache-first, fall back to network
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreVary: true, ignoreSearch: true });
    if (cached) return cached;

    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque') && url.protocol.startsWith('http')) {
        const cache = await caches.open(CACHE);
        cache.put(req.url, res.clone());
      }
      return res;
    } catch (e) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
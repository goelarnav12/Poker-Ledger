// ---------------------------------------------------------------------------
// Service worker — makes the app installable and usable without a connection.
//
// Strategy is network-first, cache-as-fallback. Not cache-first: the asset
// filenames here are not content-hashed (no build step), so a cache-first
// worker would happily serve last week's app.js forever. Network-first means a
// deploy is picked up on the next load, and the cache exists only for offline.
//
// Bump CACHE when the shell list changes; activate() deletes every other cache.
// ---------------------------------------------------------------------------

const CACHE = 'poker-ledger-v2';

// Relative, never absolute: this is served from the domain root on Vercel but
// from /Poker-Ledger/ on GitHub Pages, and absolute paths would break one.
const SHELL = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './stats.js',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll is all-or-nothing; one 404 would abandon the whole install.
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;

  // Only GETs are cacheable, and a write must never be served from a cache.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Supabase carries the ledger itself and the auth token exchange. Serving
  // either from a cache would show stale sessions or replay a stale token, so
  // these always go straight to the network.
  if (url.hostname.endsWith('.supabase.co')) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        // Cross-origin CDN responses are opaque; still worth storing so the
        // charts and Supabase SDK are available offline.
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(req).then(hit =>
          // A navigation that misses falls back to the shell rather than the
          // browser's offline error page.
          hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)
        )
      )
  );
});

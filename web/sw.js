// Kaamghor service worker: keeps a copy of the app so it opens offline and on weak networks.
// App files: network first (always the latest when online), saved copy if offline or the network
// takes longer than 4 s. The pinned supabase-js file never changes, so it is served from the cache.
// Change CACHE only to throw away old copies (for example after renaming files).
const CACHE = 'kaamghor-v9';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
const SHELL = ['./', './index.html', './api.js', './manifest.webmanifest', './icon.svg', './logo.svg', './icon-192.png', './icon-512.png', './terms.html', SUPABASE_JS];
const SLOW_MS = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Supabase API and Razorpay always go straight to the network.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.url === SUPABASE_JS) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    })));
    return;
  }
  if (url.origin !== self.location.origin) return;

  const nav = req.mode === 'navigate';
  const key = nav ? './index.html' : req;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const network = fetch(req).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    e.waitUntil(network.catch(() => {})); // let a slow download finish and refresh the copy
    const slow = new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), SLOW_MS));
    try {
      return await Promise.race([network, slow]);
    } catch (_) {
      const saved = await cache.match(key, { ignoreSearch: nav });
      return saved || network; // nothing saved yet: keep waiting for the network
    }
  })());
});

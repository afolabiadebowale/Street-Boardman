// Minimal offline support: caches the app shell so the UI still loads with
// no signal, and caches GET /api/competitions responses so a Better can at
// least browse what's on offer offline. Nothing financial (wallet, bets,
// deposits) is ever cached — those always require a live server round trip.
//
// Bump this on any change to the caching strategy below — `activate` only
// evicts caches whose name differs from this one, so a stale name here
// means a client that installed an older service worker keeps that old
// cache around forever (FEAT-051).
const CACHE_NAME = 'streetboardman-v2';
const SHELL_FILES = ['/', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  const isSafeToCache =
    request.method === 'GET' && url.pathname === '/api/competitions';

  if (isSafeToCache) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Network-first for the rest of the app shell (notably '/' itself and
  // manifest.json): a deploy changes the hashed asset filenames '/'
  // references, so serving it cache-first would keep pointing returning
  // visitors at assets that no longer exist on the server. Only fall back
  // to the cached copy when there's genuinely no network.
  if (request.method === 'GET' && url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
  }
});

// JellyJet service worker: lets the app open with no internet.
//
//   the page (/)        network first (4s timeout), then the last copy
//   /assets/*           build files with a content hash in the name: cache first
//   icons, fonts, etc.  served from cache, refreshed in the background
//
// Everything else (Jellyfin API, artwork, audio streams, /pipeline) is left to
// the network. Downloaded songs get their own storage in a later step.

const SHELL = 'jellyjet2-shell-v1';
const APP_FILES = /^\/(assets|fonts|icons)\/|^\/(favicon\.png|manifest\.webmanifest)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.add('/')).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('jellyjet2-shell-') && key !== SHELL) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(page(request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else if (APP_FILES.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function page(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await withTimeout(fetch(request), 4000);
    if (response.ok) await cache.put('/', response.clone());
    return response;
  } catch {
    return (await cache.match('/')) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return hit ?? (await refresh) ?? Response.error();
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

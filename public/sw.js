// JellyJet service worker: lets the app open, and downloaded music play,
// with no internet.
//
//   the page (/)              network first (4s timeout), then the last copy
//   /assets/*                 build files with a content hash in the name: cache first
//   icons, fonts, etc.        served from cache, refreshed in the background
//   /offline/audio/<id>       downloaded songs, from storage (with seeking)
//   cover images              the downloaded copy when there is one
//
// Everything else (Jellyfin API, audio streams, /pipeline) goes to the network.

const SHELL = 'jellyjet2-shell-v2';
const AUDIO = 'jellyjet2-audio';
const IMAGES = 'jellyjet2-images';
const APP_FILES = /^\/(assets|fonts|icons)\/|^\/(favicon\.png|manifest\.webmanifest)$/;
const COVER = /^\/Items\/[^/]+\/Images\/Primary/;

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
  } else if (url.pathname.startsWith('/offline/audio/')) {
    event.respondWith(storedAudio(request, url.pathname));
  } else if (COVER.test(url.pathname)) {
    event.respondWith(storedCoverOrNetwork(request));
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

/** A downloaded song, whole or the byte range the audio player asks for. */
async function storedAudio(request, path) {
  const cache = await caches.open(AUDIO);
  const stored = await cache.match(path);
  if (!stored) return new Response('Not downloaded', { status: 404 });

  const blob = await stored.blob();
  const type = stored.headers.get('Content-Type') || 'audio/mpeg';
  const size = blob.size;
  const range = request.headers.get('Range');
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    return new Response(blob, {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
    });
  }

  let start = match[1] === '' ? undefined : Number(match[1]);
  let end = match[2] === '' ? undefined : Number(match[2]);
  if (start === undefined) {
    // "bytes=-500": the last 500 bytes.
    start = Math.max(0, size - (end ?? 0));
    end = size - 1;
  } else {
    end = end === undefined ? size - 1 : Math.min(end, size - 1);
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1, type), {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}

/** Covers of downloaded songs come from storage (any size will do); others from the server. */
async function storedCoverOrNetwork(request) {
  const cache = await caches.open(IMAGES);
  const stored = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
  if (stored) return stored;
  return fetch(request);
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

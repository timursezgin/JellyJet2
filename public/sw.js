// JellyJet service worker: lets the app open, and downloaded music play,
// with no internet.
//
//   the page (/)              the saved copy at once (instant start), with a newer
//                             version fetched in the background: stored only once
//                             all its build files are saved too, then the app is told
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
  event.waitUntil(refreshShell().catch(() => {}).then(() => self.skipWaiting()));
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

// "Update available" tapped: save the published page and its files now, then
// answer, so the app's reload opens the new version rather than the saved one.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'refresh-shell') return;
  const source = event.source;
  event.waitUntil(
    refreshShell()
      .catch(() => false)
      .then(() => source?.postMessage({ type: 'shell-refreshed' })),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(page(event));
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

/** Opening the app: the saved page straight away, a newer one checked for meanwhile. */
async function page(event) {
  const cache = await caches.open(SHELL);
  const saved = await cache.match('/');
  if (saved) {
    event.waitUntil(
      refreshShell()
        .then((updated) => updated && tellClients({ type: 'update-ready' }))
        .catch(() => {}),
    );
    return saved;
  }
  // First time (or storage cleared): from the network.
  try {
    const response = await fetch(event.request);
    if (response.ok) event.waitUntil(refreshShell().catch(() => {}));
    return response;
  } catch {
    return Response.error();
  }
}

/**
 * Fetches the page and, if it changed, saves every build file it uses first
 * and the page last, so a saved page is never missing its files (a publish
 * deletes the old ones from the server). Returns whether a newer page replaced
 * an older one.
 */
async function refreshShell() {
  const response = await fetch('/', { cache: 'no-store' });
  if (!response.ok) return false;
  const html = await response.text();
  const cache = await caches.open(SHELL);
  const saved = await cache.match('/');
  const savedHtml = saved ? await saved.text() : null;
  if (savedHtml === html) return false;

  const files = [...new Set([...html.matchAll(/(?:src|href)="(\/(?:assets|fonts)\/[^"]+)"/g)].map((m) => m[1]))];
  await cache.addAll(files); // all or nothing
  await cache.put('/', new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));

  // Build files the new page doesn't use are old versions.
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/assets/') && !files.includes(path)) await cache.delete(request);
  }
  return savedHtml !== null;
}

async function tellClients(message) {
  for (const client of await self.clients.matchAll({ type: 'window' })) client.postMessage(message);
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

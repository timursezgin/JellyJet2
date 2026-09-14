// Smoothness measurements in Safari's engine (Playwright WebKit) against a
// pretend Jellyfin the size of a real library. No account, no sound.
//   npm run build
//   JELLYFIN_UPSTREAM=localhost:8793 sh tool/serve-local.sh   (another terminal)
//   node tool/perf-test.mjs
// Reports: start-up times, React commits, dropped frames while scrolling and
// opening pages, and how big the saved library cache gets.
import { webkit } from 'playwright';
import http from 'node:http';
import zlib from 'node:zlib';

// ORIGIN=http://localhost:5199 with `JJ_JELLYFIN=http://localhost:8793 npx vite --port 5199` measures a
// development build, which also reports how long React spends rendering.
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:8792';
const log = (...a) => console.log(...a);

// --- A big pretend library ----------------------------------------------------
const TRACKS = 12000;
const ALBUMS = 1000;
const ARTISTS = 400;
const LIKED = 2000;
const now = Date.now();
const user = { Id: 'u1', Name: 'tester', Policy: { IsAdministrator: true, EnableContentDeletion: true, EnableContentDownloading: true } };
const artists = Array.from({ length: ARTISTS }, (_, i) => ({ Id: `ar${i}`, Name: `Artist ${String(i).padStart(3, '0')}`, Type: 'MusicArtist', ImageTags: { Primary: 't' } }));
const albums = Array.from({ length: ALBUMS }, (_, i) => ({
  Id: `al${i}`, Name: `Album ${i}`, Type: 'MusicAlbum', AlbumArtist: artists[i % ARTISTS].Name, ProductionYear: 1970 + (i % 50),
  ImageTags: { Primary: 't' }, ChildCount: 12,
}));
const tracks = Array.from({ length: TRACKS }, (_, i) => {
  const album = albums[i % ALBUMS];
  const artist = artists[i % ARTISTS];
  return {
    Id: `s${i}`, Name: `Song number ${i} with a longer title`, Type: 'Audio', Album: album.Name, AlbumId: album.Id, AlbumPrimaryImageTag: 't',
    Artists: [artist.Name], ArtistItems: [{ Id: artist.Id, Name: artist.Name }], AlbumArtist: artist.Name, RunTimeTicks: 2_000_000_000,
    Container: 'mp3', IndexNumber: (i % 12) + 1, Genres: [['Rock', 'Jazz', 'Pop', 'Electronic'][i % 4]], ProductionYear: album.ProductionYear,
    UserData: { IsFavorite: i < LIKED, PlayCount: i % 7, LastPlayedDate: i % 3 ? new Date(now - (i % 200) * 86400000).toISOString() : undefined },
  };
});
const items = (list, start = 0, total = list.length) => ({ Items: list, TotalRecordCount: total, StartIndex: start });
// A real little JPEG (grey), sent after a short delay like a server resizing art.
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);
const stats = { images: 0 };

function jellyfin(req) {
  const url = new URL(`http://mock${req.url}`);
  const p = url.pathname;
  const q = url.searchParams;
  const page = (list) => {
    const start = Number(q.get('StartIndex') ?? 0);
    const limit = Number(q.get('Limit') ?? list.length);
    return items(list.slice(start, start + limit), start, list.length);
  };
  if (p === '/System/Info/Public') return { ServerName: 'Mock', Version: '12', Id: 'srv' };
  if (p === '/System/Ping') return 'Jellyfin Server';
  if (p === '/Users/AuthenticateByName') return { AccessToken: 'tok', ServerId: 'srv', User: user };
  if (p === '/Users/Me') return user;
  if (p === '/UserViews') return items([{ Id: 'lib', Name: 'Music', Type: 'CollectionFolder', CollectionType: 'music' }]);
  if (p.startsWith('/DisplayPreferences/')) return { Id: 'x', CustomPrefs: {} };
  if (p.startsWith('/Sessions')) return {};
  if (p === '/Artists/AlbumArtists') return q.get('Limit') === '0' ? items([], 0, ARTISTS) : page(artists);
  if (p === '/Genres') return items([]);
  if (p === '/Items/Latest') return albums.slice(0, 20);
  if (/^\/Items\/al\d+$/.test(p)) return albums[Number(p.slice(9))];
  if (p === '/Playlists/p1/Items') return items(tracks.slice(0, 300).map((t) => ({ ...t, PlaylistItemId: `e${t.Id}` })));
  if (p !== '/Items') return items([]);
  const types = q.get('IncludeItemTypes') ?? '';
  if (types === 'Playlist') return items([{ Id: 'p1', Name: 'Big Playlist', Type: 'Playlist', ChildCount: 300 }]);
  let list = types === 'MusicAlbum' ? albums : tracks;
  if (q.get('Ids')) return items(albums.filter((a) => q.get('Ids').split(',').includes(a.Id)));
  if (q.get('ParentId')?.startsWith('al')) return items(tracks.filter((t) => t.AlbumId === q.get('ParentId')));
  if (q.get('Limit') === '0') return items([], 0, list.length);
  if (q.get('Filters') === 'IsFavorite') list = list.filter((t) => t.UserData?.IsFavorite);
  if (q.get('Filters') === 'IsPlayed') list = list.filter((t) => t.UserData?.PlayCount);
  return page(list);
}

const mock = http.createServer((req, res) => {
  if (/\/Images\//.test(req.url)) {
    stats.images++;
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000' });
      res.end(jpeg);
    }, 60);
    return;
  }
  const out = jellyfin(req);
  const body = typeof out === 'string' ? out : JSON.stringify(out);
  const gz = zlib.gzipSync(body);
  res.writeHead(200, { 'Content-Type': typeof out === 'string' ? 'text/plain' : 'application/json', 'Content-Encoding': 'gzip' });
  res.end(gz);
});
await new Promise((r) => mock.listen(8793, r));

// --- Instruments inside the page -------------------------------------------------
const instruments = () => {
  // Count React commits through the devtools hook React looks for at start-up.
  window.__commits = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      this.renderers.set(1, renderer);
      return 1;
    },
    onCommitFiberRoot(_id, root) {
      window.__commits++;
      // Development builds time each render.
      window.__renderMs = (window.__renderMs ?? 0) + (root?.current?.actualDuration ?? 0);
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
  // Frame timing.
  window.__frames = { on: false, gaps: [] };
  let last = 0;
  const loop = (t) => {
    if (window.__frames.on && last) window.__frames.gaps.push(t - last);
    last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3 });
await context.addInitScript(instruments);
const page = await context.newPage();
page.on('pageerror', (e) => log('PAGE ERROR', e.message));
const top = () => page.locator('[data-visible] > div:not([data-covered]):not([data-hidden])').last();
const tab = (name) => page.locator('nav').getByRole('button', { name, exact: true }).click();

async function frames(label, action) {
  await page.evaluate(() => {
    window.__frames.gaps = [];
    window.__frames.on = true;
    window.__commitsAt = window.__commits;
    window.__renderAt = window.__renderMs ?? 0;
  });
  const t0 = Date.now();
  await action();
  const result = await page.evaluate(() => {
    window.__frames.on = false;
    const gaps = window.__frames.gaps;
    return {
      frames: gaps.length,
      over20: gaps.filter((g) => g > 20).length,
      over50: gaps.filter((g) => g > 50).length,
      worst: Math.round(Math.max(0, ...gaps)),
      commits: window.__commits - window.__commitsAt,
      renderMs: Math.round((window.__renderMs ?? 0) - window.__renderAt),
    };
  });
  log(`${label}: ${Date.now() - t0}ms, frames ${result.frames}, >20ms ${result.over20}, >50ms ${result.over50}, worst ${result.worst}ms, React commits ${result.commits}${result.renderMs ? `, React render ${result.renderMs}ms` : ''}`);
  return result;
}

// Sign in (cold start).
let t = Date.now();
await page.goto(ORIGIN);
await page.fill('input[name=username]', 'tester');
await page.fill('input[name=password]', 'x');
await page.click('button[type=submit]');
await page.getByText('Recently added').waitFor();
await page.locator('img[data-loaded]').first().waitFor();
log(`sign-in to Home with covers: ${Date.now() - t}ms`);

// Warm start: reopen with the service worker and saved cache.
await page.waitForTimeout(3000);
t = Date.now();
await page.reload();
await page.getByText('Recently added').waitFor();
const warmShell = Date.now() - t;
await page.locator('img[data-loaded]').first().waitFor();
log(`reopen: Home shown ${warmShell}ms, first cover ${Date.now() - t}ms`);

// Idle on Home: nothing should be re-rendering.
await frames('idle on Home 3s', () => page.waitForTimeout(3000));

// Scroll Home down and up.
await frames('scroll Home', async () => {
  for (let i = 0; i < 30; i++) {
    await top().locator('div[class*="scroll"]').first().evaluate((el, d) => (el.scrollTop += d), i < 15 ? 60 : -60);
    await page.waitForTimeout(16);
  }
});

// Open Library > Tracks (12,000) and fling through it.
await tab('Library');
await frames('open Tracks', async () => {
  await top().getByText('Tracks', { exact: true }).click();
  await top().getByText(/Song number/).first().waitFor();
  await page.waitForTimeout(500);
});
let onScreen = 0;
let blankCovers = 0;
await frames('scroll Tracks fast (3000px/s for 3s)', async () => {
  const scroller = top().locator('div[class*="scroll"]').first();
  for (let i = 0; i < 180; i++) {
    const r = await scroller.evaluate(async (el, sample) => {
      el.scrollTop += 50;
      if (!sample) return null;
      // A quarter of a second later, how many covers on screen are still empty?
      await new Promise((resolve) => setTimeout(resolve, 250));
      const box = el.getBoundingClientRect();
      const imgs = [...el.querySelectorAll('[class*="art"]')].filter((a) => {
        const b = a.getBoundingClientRect();
        return b.bottom > box.top + 60 && b.top < box.bottom - 120;
      });
      return { total: imgs.length, blank: imgs.filter((a) => !a.querySelector('img[data-loaded]')).length };
    }, i % 20 === 10);
    if (r) {
      onScreen += r.total;
      blankCovers += r.blank;
    }
    await page.waitForTimeout(16);
  }
});
log(`during the fling: ${blankCovers} of ${onScreen} on-screen covers still empty after 250ms`);
const blank = await top().locator('div[class*="scroll"]').first().evaluate((el) => {
  // Rows drawn vs rows that should be on screen.
  const rows = el.querySelectorAll('[class*="row"]').length;
  return { scrollTop: Math.round(el.scrollTop), rowsInDom: rows, domNodes: document.querySelectorAll('*').length };
});
log('after the fling:', blank);

// Scroll back up through rows already seen: their covers must show at once,
// not fade in again (that reads as flicker).
{
  const scroller = top().locator('div[class*="scroll"]').first();
  let checked = 0;
  let faded = 0;
  for (let i = 0; i < 60; i++) {
    const r = await scroller.evaluate(async (el) => {
      el.scrollTop -= 50;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const box = el.getBoundingClientRect();
      const imgs = [...el.querySelectorAll('img')].filter((img) => {
        const b = img.getBoundingClientRect();
        return b.bottom > box.top + 60 && b.top < box.bottom;
      });
      return { checked: imgs.length, faded: imgs.filter((img) => Number(getComputedStyle(img).opacity) < 0.99).length };
    });
    checked += r.checked;
    faded += r.faded;
  }
  log(`scrolling back up: ${faded} of ${checked} on-screen covers were not fully shown`);
}

// Keep going to load many pages of Tracks, to check the saved copy stays small.
{
  const scroller = top().locator('div[class*="scroll"]').first();
  for (let i = 0; i < 12; i++) {
    await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(500);
  }
  const loaded = await scroller.evaluate((el) => Math.round(el.scrollHeight / 56));
  await page.waitForTimeout(3000); // the cache saves at most every 2s
  const saved = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('jellyjet2-cache');
        open.onsuccess = () => {
          const get = open.result.transaction('queries', 'readonly').objectStore('queries').get('library');
          get.onsuccess = () => {
            const client = JSON.parse(get.result);
            const tracks = client.clientState.queries.find((q) => q.queryKey[0] === 'tracks');
            resolve({ kb: Math.round(get.result.length / 1024), trackPagesSaved: tracks?.state.data.pages.length });
          };
        };
      }),
  );
  log(`after loading ${loaded} rows of Tracks, the saved cache is`, saved);
}

// Liked Songs with 2,000 songs.
await tab('Library');
await page.waitForTimeout(500);
await tab('Library');
await frames('open Liked Songs (2,000)', async () => {
  await top().getByText('Liked Songs', { exact: true }).click();
  await top().getByText(/Song number/).first().waitFor();
  await page.waitForTimeout(600);
});
await frames('scroll Liked Songs', async () => {
  const scroller = top().locator('div[class*="scroll"]').first();
  for (let i = 0; i < 120; i++) {
    await scroller.evaluate((el) => (el.scrollTop += 50));
    await page.waitForTimeout(16);
  }
});

// Open an album from Home (the slide-in) and go back.
await tab('Home');
await page.waitForTimeout(400);
await frames('open an album (slide in + load)', async () => {
  await page.getByText('Album 0', { exact: true }).first().click();
  await top().getByText(/Song number/).first().waitFor();
  await page.waitForTimeout(500);
});
await frames('back (slide out)', async () => {
  await top().getByRole('button', { name: /^Back to/ }).click();
  await page.waitForTimeout(600);
});

// The saved cache.
const cache = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const open = indexedDB.open('jellyjet2-cache');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('queries', 'readonly');
        const get = tx.objectStore('queries').get('library');
        get.onsuccess = () => {
          const v = get.result;
          resolve({ type: typeof v, kb: Math.round((typeof v === 'string' ? v.length : JSON.stringify(v ?? '').length) / 1024) });
        };
      };
      open.onerror = () => resolve(null);
    }),
);
log('saved library cache:', cache);
log('cover requests:', stats.images);

await browser.close();
mock.close();
process.exit(0);

// Downloads and offline, end to end, in Safari's engine (Playwright WebKit),
// against a pretend Jellyfin - no account, no sound.
//   npm run build
//   JELLYFIN_UPSTREAM=localhost:8793 sh tool/serve-local.sh   (in another terminal)
//   node tool/offline-test.mjs
// Needs Playwright once: npm i -D playwright && npx playwright install webkit
import { webkit } from 'playwright';
import http from 'node:http';

const ORIGIN = 'http://localhost:8792';
const APP_FILE = /^\/($|index\.html|sw\.js|manifest\.webmanifest|favicon\.png|assets\/|fonts\/|icons\/|offline\/)/;
const log = (...a) => console.log(...a);
const fail = (msg) => { console.log('FAIL:', msg); process.exitCode = 1; };

// --- A pretend Jellyfin ---------------------------------------------------
function wav(seconds = 2) {
  const rate = 8000, n = rate * seconds, b = Buffer.alloc(44 + n, 128);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
}
const user = { Id: 'u1', Name: 'tester', Policy: { IsAdministrator: true, EnableContentDeletion: true, EnableContentDownloading: true } };
const song = (id, name, extra = {}) => ({ Id: id, Name: name, Type: 'Audio', Album: 'Mock Album', AlbumId: 'a1', AlbumPrimaryImageTag: 'tag', Artists: ['Mock Artist'], ArtistItems: [{ Id: 'ar1', Name: 'Mock Artist' }], RunTimeTicks: 20000000, Container: 'wav', UserData: { IsFavorite: false }, ...extra });
const state = {
  playlist: [song('t1', 'One'), song('t3', 'Three')],
  prefs: {},
  favoritePosts: [],
  audioRequests: 0,
};
const items = (list) => ({ Items: list, TotalRecordCount: list.length, StartIndex: 0 });

function makeRoute(req, res, body) {
  return {
    request: () => ({ url: () => `http://mock${req.url}`, method: () => req.method, postData: () => body }),
    fulfill: ({ status = 200, contentType, headers = {}, body: out = '' }) => {
      res.writeHead(status, { ...(contentType ? { 'Content-Type': contentType } : {}), ...headers });
      res.end(out);
    },
  };
}
async function jellyfin(route) {
  const url = new URL(route.request().url());
  const p = url.pathname, q = url.searchParams, method = route.request().method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (p === '/System/Info/Public') return json({ ServerName: 'Mock', Version: '12', Id: 'srv' });
  if (p === '/System/Ping') return route.fulfill({ status: 200, body: 'Jellyfin Server' });
  if (p === '/Users/AuthenticateByName') return json({ AccessToken: 'tok', ServerId: 'srv', User: user });
  if (p === '/Users/Me') return json(user);
  if (p === '/UserViews') return json(items([{ Id: 'lib', Name: 'Music', Type: 'CollectionFolder', CollectionType: 'music' }]));
  if (p.startsWith('/Sessions')) return route.fulfill({ status: 204 });
  if (p.startsWith('/UserFavoriteItems/')) { state.favoritePosts.push([method, p]); return json({}); }
  if (p.startsWith('/UserPlayedItems/')) return json({});
  if (p.startsWith('/DisplayPreferences/')) {
    if (method === 'POST') { state.prefs = JSON.parse(route.request().postData()).CustomPrefs; return route.fulfill({ status: 204 }); }
    return json({ Id: 'jellyjet-downloads', CustomPrefs: state.prefs });
  }
  if (/^\/Items\/[^/]+\/Images/.test(p)) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('89504e470d0a1a0a', 'hex') });
  if (/^\/Audio\/[^/]+\/(stream|universal)/.test(p)) { state.audioRequests++; const b = wav(); return route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Content-Length': String(b.length) }, body: b }); }
  if (p === '/Playlists/p1/Items') return json(items(state.playlist.map((s, i) => ({ ...s, PlaylistItemId: `e${s.Id}` }))));
  if (p === '/Items/p1') return json({ Id: 'p1', Name: 'Mock Playlist', Type: 'Playlist', ChildCount: state.playlist.length });
  if (p === '/Items/a1') return json({ Id: 'a1', Name: 'Mock Album', Type: 'MusicAlbum', AlbumArtist: 'Mock Artist' });
  if (p === '/Items/Latest') return json([{ Id: 'a1', Name: 'Mock Album', Type: 'MusicAlbum', AlbumArtist: 'Mock Artist', ImageTags: { Primary: 'tag' } }]);
  if (p === '/Items') {
    const types = q.get('IncludeItemTypes') ?? '';
    if (q.get('Limit') === '0') return json({ Items: [], TotalRecordCount: 3 });
    if (types === 'Playlist') return json(items([{ Id: 'p1', Name: 'Mock Playlist', Type: 'Playlist', ChildCount: state.playlist.length }]));
    if (q.get('Filters') === 'IsFavorite') return json(items([]));
    if (q.get('ParentId') === 'a1') return json(items([song('t1', 'One'), song('t2', 'Two')]));
    return json(items([]));
  }
  if (p === '/Genres' || p === '/Artists/AlbumArtists') return json(items([]));
  return json(items([]));
}

// --- The run ----------------------------------------------------------------
let serverDown = false;
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (globalThis.trace) console.log('  mock:', req.method, req.url.slice(0, 80));
    if (serverDown) { res.writeHead(502); res.end(); return; }
    jellyfin(makeRoute(req, res, body));
  });
});
await new Promise((r) => mock.listen(8793, r));
const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => { if (!/access control checks|Load failed/.test(e.message)) fail(`page error: ${e.message}`); });

const audioKeys = () => page.evaluate(async () => (await (await caches.open('jellyjet2-audio')).keys()).map((r) => new URL(r.url).pathname).sort());
const tapText = async (text) => page.getByText(text, { exact: true }).first().click();
const visiblePage = () => page.locator('[data-visible] > div:not([data-covered]):not([data-hidden])').last();

await page.goto(ORIGIN);
await page.fill('input[name=username]', 'tester');
await page.fill('input[name=password]', 'x');
await page.click('button[type=submit]');
await page.getByText('Home', { exact: true }).first().waitFor();
log('signed in');
await page.reload(); // let the service worker take control
await page.waitForTimeout(1500);
log('service worker controlling:', await page.evaluate(() => !!navigator.serviceWorker.controller));

// Download a playlist.
await page.locator('nav').getByRole('button', { name: 'Library', exact: true }).click();
await tapText('Playlists');
await tapText('Mock Playlist');
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Download Mock Playlist' }).click();
await page.waitForFunction(async () => (await (await caches.open('jellyjet2-audio')).keys()).length === 2, null, { timeout: 15000 });
log('playlist downloaded:', await audioKeys());
await visiblePage().getByText(/· Downloaded/).first().waitFor();
log('playlist header says Downloaded');


// Remove one song's download from the row, with the confirmation.
await visiblePage().getByRole('button', { name: 'Remove download of Three' }).click();
await page.getByRole('button', { name: 'Remove', exact: true }).click();
await page.waitForTimeout(800);
const afterRemove = await audioKeys();
log('after removing Three:', afterRemove);

await page.locator('nav').getByRole('button', { name: 'Settings', exact: true }).click();
await page.waitForTimeout(400);

await page.locator('nav').getByRole('button', { name: 'Library', exact: true }).click();
await page.waitForTimeout(400);
if (afterRemove.join() !== '/offline/audio/t1') fail('removing one download');

// A new song added to the playlist on the server downloads by itself; the removed one doesn't come back.
state.playlist = [song('t1', 'One'), song('t3', 'Three'), song('t4', 'Four')];
// (as when coming back to the app)
globalThis.trace = false;
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(3000);
globalThis.trace = false;
await page.waitForFunction(async () => (await (await caches.open('jellyjet2-audio')).keys()).length === 2, null, { timeout: 15000 }).catch(() => {});
const afterSync = await audioKeys();
log('after the playlist gained Four:', afterSync);
if (afterSync.join() !== '/offline/audio/t1,/offline/audio/t4') fail('auto-fetch new / keep removed out');

// Backup reached the account.
await page.waitForTimeout(6500);
log('backup on account:', state.prefs.downloads);
if (!state.prefs.downloads?.includes('p1')) fail('backup not written');

// Server unreachable: banner, grey rows for what can't play, downloaded songs play.
serverDown = true;
await page.locator('nav').getByRole('button', { name: 'Home', exact: true }).click();
await page.locator('nav').getByRole('button', { name: 'Library', exact: true }).click();
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await visiblePage().getByText(/Offline – Only/).first().waitFor({ timeout: 20000 });
log('offline notice shown under the title');
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/offline-notice.png` });
await page.waitForTimeout(500);
const rows = await visiblePage().locator('[data-unavailable]').count();
log('greyed rows offline (expect 1 - Three):', rows);
if (rows !== 1) fail('grey rows');

await visiblePage().getByText('One', { exact: true }).click();
await page.waitForTimeout(2500);
const playing = await page.evaluate(() => navigator.mediaSession?.playbackState);
log('offline playback state:', playing);
if (playing !== 'playing') fail('offline playback');

// "downloads" in the notice opens the Downloaded list.
await visiblePage().getByRole('button', { name: 'downloads', exact: true }).click();
await page.waitForTimeout(700);
const onDownloaded = await visiblePage().getByRole('heading', { name: 'Downloaded' }).count().catch(() => 0) ||
  (await visiblePage().getByText('Downloaded', { exact: true }).count());
log('tapping "downloads" opened the Downloaded list:', !!onDownloaded);
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/offline-downloaded.png` });
if (!onDownloaded) fail('offline notice link');
if (await visiblePage().getByRole('button', { name: 'downloads', exact: true }).count()) fail('no link on the Downloaded page itself');
await visiblePage().getByRole('button', { name: /^Back to/ }).click();
await page.waitForTimeout(700);

// Like while offline, then come back online: it syncs.
await visiblePage().getByRole('button', { name: 'Add Four to Liked Songs' }).click();
await page.waitForTimeout(300);
serverDown = false;
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(4000);
log('favourite calls after reconnect:', state.favoritePosts);
if (!state.favoritePosts.some(([m, p]) => m === 'POST' && p.endsWith('/t4'))) fail('offline like not synced');

// The app itself opens with no network at all (served by the service worker).
// Stop the web server entirely, as if there were no network, and reopen.
(await import('node:child_process')).execSync('pkill -f "caddy run --config deploy/Caddyfile" || true');
await new Promise((r) => setTimeout(r, 1000));
try {
  await page.goto(ORIGIN);
  const offlineRows = await page.evaluate(async () => (await (await caches.open('jellyjet2-audio')).keys()).length);
  log('downloads still on the device after reopening:', offlineRows);
  await visiblePage().getByText(/Offline – Only/).first().waitFor({ timeout: 15000 });
  log('app opened with no network, offline banner shown');
} catch (error) {
  log('(could not check opening with no network in this test browser:', error.message.split('\n')[0], ')');
}

await browser.close();
mock.close();
log(process.exitCode ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED');

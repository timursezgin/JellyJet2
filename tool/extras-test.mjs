// Step 6 - Made for you, Stations, Add albums - end to end in Safari's engine
// (Playwright WebKit) against a pretend Jellyfin and a pretend download server.
// No account, no real key, no sound.
//   npm run build
//   JELLYFIN_UPSTREAM=localhost:8793 PIPELINE_UPSTREAM=localhost:8795 sh tool/serve-local.sh   (another terminal)
//   node tool/extras-test.mjs
// Needs Playwright once: npm i -D playwright && npx playwright install webkit
import { webkit } from 'playwright';
import http from 'node:http';

const ORIGIN = 'http://localhost:8792';
const FAKE_KEY = 'pretend-key-for-tests';
const log = (...a) => console.log(...a);
const fail = (msg) => {
  console.log('FAIL:', msg);
  process.exitCode = 1;
};
const check = (ok, msg) => (ok ? log('ok  ', msg) : fail(msg));
// SHOTS=folder saves screenshots along the way.
const shot = async (name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });

// --- A pretend Jellyfin with a listening history ---------------------------
const DAY = 86400000;
const now = Date.now();
const user = { Id: 'u1', Name: 'tester', Policy: { IsAdministrator: true, EnableContentDeletion: true, EnableContentDownloading: true } };
const artists = [
  { Id: 'arA', Name: 'Artist A' },
  { Id: 'arB', Name: 'Artist B' },
  { Id: 'arC', Name: 'Artist C' },
  { Id: 'arD', Name: 'Artist D' },
];
const library = Array.from({ length: 120 }, (_, i) => {
  const artist = artists[i % artists.length];
  const year = i % 3 === 0 ? 1994 : i % 3 === 1 ? 2005 : 1978;
  const played = i < 90;
  return {
    Id: `s${i}`,
    Name: `Song ${i}`,
    Type: 'Audio',
    Album: `Album ${Math.floor(i / 10)}`,
    AlbumId: `al${Math.floor(i / 10)}`,
    AlbumArtist: artist.Name,
    Artists: [artist.Name],
    ArtistItems: [artist],
    RunTimeTicks: 1800000000,
    Container: 'mp3',
    Genres: [i % 2 ? 'Rock' : 'Jazz'],
    ProductionYear: year,
    UserData: {
      IsFavorite: i % 5 === 0,
      PlayCount: played ? 1 + ((i * 7) % 20) : 0,
      // Most played recently; every fourth song last played a year ago.
      LastPlayedDate: played ? new Date(now - (i % 4 === 0 ? 400 : (i % 25) + 1) * DAY).toISOString() : undefined,
    },
  };
});
const items = (list) => ({ Items: list, TotalRecordCount: list.length, StartIndex: 0 });
const seen = { playlistsCreated: [], libraryRefresh: 0, randomAll: 0, years: [], artistIds: [] };

function jellyfin(req, body) {
  const url = new URL(`http://mock${req.url}`);
  const p = url.pathname;
  const q = url.searchParams;
  if (p === '/System/Info/Public') return { ServerName: 'Mock', Version: '12', Id: 'srv' };
  if (p === '/System/Ping') return 'Jellyfin Server';
  if (p === '/Users/AuthenticateByName') return { AccessToken: 'tok', ServerId: 'srv', User: user };
  if (p === '/Users/Me') return user;
  if (p === '/UserViews') return items([{ Id: 'lib', Name: 'Music', Type: 'CollectionFolder', CollectionType: 'music' }]);
  if (p === '/Library/Refresh') {
    seen.libraryRefresh++;
    return {};
  }
  if (p === '/Playlists' && req.method === 'POST') {
    seen.playlistsCreated.push(JSON.parse(body));
    return { Id: `pl${seen.playlistsCreated.length}` };
  }
  if (p.startsWith('/DisplayPreferences/')) return { Id: 'x', CustomPrefs: {} };
  if (p === '/Artists/AlbumArtists') return items(artists);
  if (p === '/Genres') return items([]);
  if (p === '/Items/Latest') return [];
  if (p !== '/Items') return items([]);

  const types = q.get('IncludeItemTypes') ?? '';
  let list = types === 'Audio' ? library : [];
  if (types === 'MusicAlbum') return items([]);
  if (q.get('Years')) {
    const years = q.get('Years').split(',').map(Number);
    seen.years.push(years[0]);
    list = list.filter((s) => years.includes(s.ProductionYear));
  }
  if (q.get('Limit') === '0') return { Items: [], TotalRecordCount: list.length };
  if (q.get('Filters') === 'IsPlayed') list = list.filter((s) => s.UserData.PlayCount > 0);
  if (q.get('Filters') === 'IsFavorite') list = list.filter((s) => s.UserData.IsFavorite);
  if (q.get('Genres')) list = list.filter((s) => s.Genres.includes(q.get('Genres')));
  if (q.get('ArtistIds')) {
    const ids = q.get('ArtistIds').split(',');
    seen.artistIds.push(ids);
    list = list.filter((s) => ids.includes(s.ArtistItems[0].Id));
  }
  const sort = q.get('SortBy');
  const desc = q.get('SortOrder') === 'Descending';
  if (sort === 'DatePlayed') list = [...list].sort((a, b) => (Date.parse(a.UserData.LastPlayedDate ?? 0) - Date.parse(b.UserData.LastPlayedDate ?? 0)) * (desc ? -1 : 1));
  if (sort === 'PlayCount') list = [...list].sort((a, b) => b.UserData.PlayCount - a.UserData.PlayCount);
  if (sort === 'Random') {
    if (!q.get('Years') && !q.get('Genres') && !q.get('ArtistIds')) seen.randomAll++;
    list = [...list].sort(() => Math.random() - 0.5);
  }
  return items(list.slice(0, Number(q.get('Limit') ?? 1000)));
}

// --- A pretend download server (the orchestrator) -------------------------
const results = [
  {
    id: 'r1', user: 'peer1', dir: 'Music\\Test Band\\Great Album', folderName: 'Great Album', artist: 'Test Band', album: 'Great Album',
    year: 1999, trackCount: 3, totalBytes: 90_000_000, bitrate: 320, format: 'mp3', hasFreeSlot: true, queueLength: 0,
    files: [1, 2, 3].map((n) => ({ filename: `Music\\Test Band\\Great Album\\0${n} Track ${n}.mp3`, size: 30_000_000, bitrate: 320, length: 200 })),
  },
  {
    id: 'r2', user: 'peer2', dir: 'Shares\\Other Album', folderName: 'Other Album (FLAC)', artist: null, album: null,
    year: null, trackCount: 10, totalBytes: 400_000_000, bitrate: null, format: 'flac', hasFreeSlot: false, queueLength: 4,
    files: [{ filename: 'Shares\\Other Album\\01.flac', size: 40_000_000 }],
  },
];
const orchestrator = { auth: [], jobs: new Map(), deleted: [], searches: [], made: 0 };
function pipeline(req, body) {
  const url = new URL(`http://mock${req.url}`);
  orchestrator.auth.push(req.headers.authorization);
  if (req.headers.authorization !== `Bearer ${FAKE_KEY}`) return [401, { error: 'bad or missing api key' }];
  if (url.pathname === '/whoami') return [200, { ok: true }];
  if (url.pathname === '/search') {
    orchestrator.searches.push(url.searchParams.get('q'));
    return [200, { results }, 1200];
  }
  if (url.pathname === '/download' && req.method === 'POST') {
    const b = JSON.parse(body);
    const jobId = `job${++orchestrator.made}`;
    orchestrator.jobs.set(jobId, { jobId, artist: b.artist, album: b.album, folderName: b.folderName, trackCount: b.files.length, polls: 0 });
    return [200, { jobId }];
  }
  if (url.pathname === '/jobs') {
    const jobs = [...orchestrator.jobs.values()].map((j) => {
      j.polls++;
      // The first job moves along with each look; the second stays downloading.
      const stage = j.jobId === 'job1' ? j.polls : 1;
      const state = stage <= 1 ? 'downloading' : stage === 2 ? 'tagging' : 'inLibrary';
      return { jobId: j.jobId, artist: j.artist, album: j.album, folderName: j.folderName, trackCount: j.trackCount, state, progress: stage <= 1 ? 0.4 : 1, note: '' };
    });
    return [200, { jobs }];
  }
  const del = /^\/jobs\/(\w+)$/.exec(url.pathname);
  if (del && req.method === 'DELETE') {
    orchestrator.deleted.push(del[1]);
    orchestrator.jobs.delete(del[1]);
    return [200, { ok: true }];
  }
  return [404, { error: 'not found' }];
}

function serve(port, handler, answersWithStatus = false) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (/^\/Audio\//.test(req.url)) {
        // Two seconds of silence.
        const rate = 8000, n = rate * 2, b = Buffer.alloc(44 + n, 128);
        b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
        b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
        b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(b.length) });
        res.end(b);
        return;
      }
      if (/\/Images\//.test(req.url)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const out = handler(req, body);
      const [status, json, delay] = answersWithStatus ? out : [200, out, 0];
      setTimeout(() => {
        res.writeHead(status, { 'Content-Type': typeof json === 'string' ? 'text/plain' : 'application/json' });
        res.end(typeof json === 'string' ? json : JSON.stringify(json));
      }, delay ?? 0);
    });
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

const jellyfinMock = await serve(8793, jellyfin);
const pipelineMock = await serve(8795, pipeline, true);

const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => fail(`page error: ${e.message}`));
const top = () => page.locator('[data-visible] > div:not([data-covered]):not([data-hidden])').last();
const tab = (name) => page.locator('nav').getByRole('button', { name, exact: true }).click();

await page.goto(ORIGIN);
await page.fill('input[name=username]', 'tester');
await page.fill('input[name=password]', 'x');
await page.click('button[type=submit]');
await page.getByText('Made for you').waitFor();
log('signed in');

// --- Made for you -------------------------------------------------------------
const cards = page.getByRole('button', { name: /^Play .+/ });
await cards.first().waitFor({ timeout: 20000 });
const mixNames = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').replace(/^Play /, '')));
log('mixes on Home:', mixNames);
check(mixNames.length >= 3, 'at least three mixes were made');
check(mixNames.some((n) => /Mix$/.test(n)) && mixNames.some((n) => /^The \d{4}s$/.test(n)), 'a genre mix and a decade mix are among them');

await page.getByText(mixNames[0], { exact: true }).first().click();
await top().getByText(/\d+ songs ·/).waitFor();
const mixMeta = await top().getByText(/\d+ songs ·/).first().textContent();
log('mix page:', mixNames[0], '-', mixMeta);
check(/^(1\d|2[0-5]) songs/.test(mixMeta), 'the mix page lists 10-25 songs');
await top().getByRole('button', { name: 'Save as a playlist' }).click();
await page.getByText('Saved to your playlists').waitFor();
const created = seen.playlistsCreated.at(-1);
check(created?.Name === `JellyJet · ${mixNames[0]}` && created.Ids.length >= 10, `saving made the playlist "${created?.Name}" with ${created?.Ids.length} songs`);
await top().getByRole('button', { name: 'Saved as a playlist' }).waitFor();

await tab('Home');
await page.waitForTimeout(600);
const before = mixNames.join('|');
await page.getByRole('button', { name: 'Regenerate' }).click();
await page.waitForFunction(
  (old) => [...document.querySelectorAll('button[aria-label^="Play "]')].map((e) => e.getAttribute('aria-label').replace(/^Play /, '')).join('|') !== old,
  before,
  { timeout: 20000 },
).catch(() => {});
const after = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').replace(/^Play /, '')));
log('after Regenerate:', after);
check(after.length > 0 && after.join('|') !== before, 'Regenerate shows different mixes');

await page.reload();
await page.getByText('Made for you').waitFor();
await cards.first().waitFor();
const reopened = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').replace(/^Play /, '')));
check(reopened.join('|') === after.join('|'), 'mixes stay the same after reopening the app');

// --- Stations ---------------------------------------------------------------------
// What the lock screen is told is playing.
const nowPlaying = async (previous) => {
  await page
    .waitForFunction((prev) => {
      const title = navigator.mediaSession?.metadata?.title;
      return !!title && title !== prev;
    }, previous, { timeout: 8000 })
    .catch(() => {});
  return page.evaluate(() => navigator.mediaSession?.metadata?.title ?? null);
};

await page.getByRole('button', { name: /Library\s*radio/ }).click();
const radioSong = await nowPlaying(null);
check(seen.randomAll > 0 && !!radioSong, `Library radio plays (now: ${radioSong})`);

await page.getByRole('button', { name: /Decade\s*radio/ }).click();
await page.getByRole('button', { name: '1990s' }).click();
await page.waitForTimeout(1500);
const decadeSong = await nowPlaying(radioSong);
const decadeTrack = library.find((s) => s.Name === decadeSong);
check(seen.years.includes(1990) && decadeTrack?.ProductionYear === 1994, `Decade radio plays a 1990s song (now: ${decadeSong}, ${decadeTrack?.ProductionYear})`);

await page.getByRole('button', { name: /Artist\s*mix/ }).click();
await top().getByRole('button', { name: /Artist B/ }).click();
await top().getByRole('button', { name: /Artist D/ }).click();
await top().getByRole('button', { name: 'Build (2)' }).click();
await top().getByText('Artist B & Artist D Mix').first().waitFor();
const stationMeta = await top().getByText(/\d+ songs ·/).first().textContent();
check(seen.artistIds.at(-1)?.join() === 'arB,arD' && /^60 songs/.test(stationMeta), `artist mix built from just those artists (${stationMeta})`);

// --- Add albums -------------------------------------------------------------------
await tab('Library');
await page.waitForTimeout(400);
await tab('Library'); // back to the Library page itself
await page.getByRole('button', { name: 'Add albums' }).click();
await top().getByPlaceholder('Key').fill('not-the-key');
await top().getByRole('button', { name: 'Connect' }).click();
await top().getByText('That key isn’t right.').waitFor();
await shot('add-albums-wrong-key');
log('ok   a wrong key is refused');
await top().getByPlaceholder('Key').fill(FAKE_KEY);
await top().getByRole('button', { name: 'Connect' }).click();
const search = top().getByPlaceholder('Album or artist, then search');
await search.waitFor();
check(orchestrator.auth.at(-1) === `Bearer ${FAKE_KEY}`, 'the key is sent to the download server');

await search.fill('great album');
await search.press('Enter');
await top().getByText(/Searching Soulseek/).waitFor();
await top().getByText('Great Album', { exact: true }).waitFor({ timeout: 10000 });
check(orchestrator.searches.at(-1) === 'great album', 'search results arrive');
check(await top().getByText('Other Album (FLAC)').isVisible(), 'a result with no album name shows its folder name');
await shot('add-albums-results');

await top().getByText('Great Album', { exact: true }).click();
await top().getByText('03 Track 3.mp3').waitFor();
log('ok   the result page lists the files');
await shot('album-result');
await top().getByRole('button', { name: 'Download to library' }).click();
await page.getByText(/it appears in your library once tagged/).waitFor();
await page.waitForTimeout(1200); // goes back to the list
await top().getByText('Downloads', { exact: true }).waitFor();
await top().getByText(/Downloading 40%/).waitFor();
log('ok   the download shows with its progress');
await shot('add-albums-downloading');

// Checked every 10 seconds: downloading → tagging → in the library.
await top().getByText(/Tagging and filing/).waitFor({ timeout: 15000 });
log('ok   then tagging');
await top().getByText(/Added to your library/).waitFor({ timeout: 15000 });
await page.waitForTimeout(500);
check(seen.libraryRefresh > 0, 'when it lands, Jellyfin is asked to look for it');
await shot('add-albums-landed');

// Swiping a download row left uncovers its action. Desktop WebKit can't make
// Touch objects, so an Event carrying the same fields stands in.
async function swipeLeft(text) {
  const box = await top().getByText(text, { exact: true }).first().boundingBox();
  const y = box.y + box.height / 2;
  await page.evaluate(
    async ({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      const send = (type, px) => {
        const touch = { identifier: 7, target, clientX: px, clientY: y };
        const ev = new Event(type, { bubbles: true, cancelable: true });
        const live = type === 'touchend' ? [] : [touch];
        Object.defineProperty(ev, 'touches', { value: live });
        Object.defineProperty(ev, 'changedTouches', { value: [touch] });
        target.dispatchEvent(ev);
      };
      send('touchstart', x);
      for (let i = 1; i <= 8; i++) {
        await new Promise((r) => setTimeout(r, 16));
        send('touchmove', x - i * 18);
      }
      send('touchend', x - 144);
    },
    { x: 300, y },
  );
  await page.waitForTimeout(450);
}

// The finished download: swipe, Dismiss.
await swipeLeft('Great Album');
await shot('add-albums-dismiss');
await top().getByText('Dismiss', { exact: true }).click();
await page.waitForTimeout(900);
check(orchestrator.deleted.includes('job1') && !(await top().getByText('Added to your library').count()), 'a finished download swipes to Dismiss and leaves the list');

// A second download, still going: swipe, Cancel - no popup.
await top().getByText('Other Album (FLAC)').click();
await top().getByRole('button', { name: 'Download to library' }).click();
await page.waitForTimeout(1500);
await swipeLeft('Other Album (FLAC)');
await top().getByRole('button', { name: 'Cancel' }).waitFor();
await shot('add-albums-cancel');
check(!(await page.getByRole('alertdialog').count()), 'no popup - the row shows Cancel');
await top().getByText('Cancel', { exact: true }).click();
await page.waitForTimeout(900);
check(orchestrator.deleted.includes('job2') && !(await top().getByText(/Downloading 40%/).count()), 'Cancel stops the download and the row leaves');

// Opening a row and tapping elsewhere closes it again.
await top().getByText('Great Album', { exact: true }).first().click();
await top().getByRole('button', { name: 'Download to library' }).click();
await page.waitForTimeout(1500);
await swipeLeft('Great Album');
await top().getByText('Downloads', { exact: true }).click();
await page.waitForTimeout(500);
check(!(await top().locator('[data-open]').count()), 'tapping elsewhere closes an open row');

// Forget the key.
await top().getByRole('button', { name: 'Forget the download server key' }).click();
await page.getByRole('button', { name: 'Forget', exact: true }).click();
await top().getByPlaceholder('Key').waitFor();
check(await page.evaluate(() => localStorage.getItem('jj.pipelineKey') === null), 'forgetting removes the key from the phone');

await browser.close();
jellyfinMock.close();
pipelineMock.close();
log(process.exitCode ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED');
process.exit(process.exitCode ?? 0);

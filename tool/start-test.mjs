// App start and updates, in Safari's engine (Playwright WebKit): reopening on
// a slow connection, and a newly published version reaching an open app.
//   npm run build
//   JELLYFIN_UPSTREAM=localhost:8793 sh tool/serve-local.sh   (another terminal)
//   node tool/start-test.mjs
// A proxy on :8794 in front of the local server holds the page back 1.5s, like
// weak mobile data.
import { webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';

const log = (...a) => console.log(...a);
const fail = (msg) => {
  console.log('FAIL:', msg);
  process.exitCode = 1;
};
const DELAY = 1500;

// Pretend Jellyfin.
const user = { Id: 'u1', Name: 'tester', Policy: { IsAdministrator: true, EnableContentDeletion: true, EnableContentDownloading: true } };
const mock = http.createServer((req, res) => {
  const p = new URL(`http://m${req.url}`).pathname;
  const json = (o) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(o));
  };
  if (p === '/System/Info/Public') return json({ ServerName: 'Mock', Version: '12', Id: 'srv' });
  if (p === '/System/Ping') return json('ok');
  if (p === '/Users/AuthenticateByName') return json({ AccessToken: 'tok', ServerId: 'srv', User: user });
  if (p === '/Users/Me') return json(user);
  if (p === '/UserViews') return json({ Items: [{ Id: 'lib', CollectionType: 'music' }], TotalRecordCount: 1 });
  if (p === '/Items/Latest') return json([]);
  return json({ Items: [], TotalRecordCount: 0 });
});
await new Promise((r) => mock.listen(8793, r));

// Slow front door: the page itself (a navigation) is held back.
let slow = false;
const proxy = http.createServer((req, res) => {
  const forward = () => {
    const upstream = http.request({ host: 'localhost', port: 8792, path: req.url, method: req.method, headers: req.headers }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  };
  if (slow && (req.url === '/' || req.url === '/index.html')) setTimeout(forward, DELAY);
  else forward();
});
await new Promise((r) => proxy.listen(8794, r));
const ORIGIN = 'http://localhost:8794';

const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 402, height: 874 } });
const page = await context.newPage();
page.on('pageerror', (e) => fail(`page error: ${e.message}`));

await page.goto(ORIGIN);
await page.fill('input[name=username]', 'tester');
await page.fill('input[name=password]', 'x');
await page.click('button[type=submit]');
await page.getByText('Recently added').waitFor();
await page.reload(); // the service worker takes over
await page.getByText('Recently added').waitFor();
await page.waitForTimeout(1500);

// Reopen with the page held back.
slow = true;
const times = [];
for (let i = 0; i < 3; i++) {
  const t = Date.now();
  await page.reload();
  await page.getByText('Recently added').waitFor();
  times.push(Date.now() - t);
  await page.waitForTimeout(DELAY + 500);
}
slow = false;
log(`reopening with the page held back ${DELAY}ms: ${times.join('ms, ')}ms`);
if (Math.max(...times) > DELAY) fail('opening waited for the network');

// Publish a "new version" (the page changes) while the app is open.
const index = process.env.DIST_INDEX ?? 'dist/index.html';
const original = fs.readFileSync(index, 'utf8');
const marker = `<!-- build ${Date.now()} -->`;
fs.writeFileSync(index, original.replace('</head>', `${marker}</head>`));
try {
  await page.reload(); // opens the saved (old) copy; the new one arrives in the background
  await page.getByText('Recently added').waitFor();
  const switched = await page
    .waitForFunction((m) => document.documentElement.outerHTML.includes(m), marker, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  log('a new version published while open is switched to right after opening:', switched);
  if (!switched) fail('update not applied');
  await page.getByText('Recently added').waitFor();

  // And it's the saved copy from now on, with its files, even with no server.
  const cached = await page.evaluate(async () => {
    const cache = await caches.open('jellyjet2-shell-v2');
    const html = await (await cache.match('/')).text();
    const files = [...html.matchAll(/(?:src|href)="(\/(?:assets|fonts)\/[^"]+)"/g)].map((m) => m[1]);
    const missing = [];
    for (const f of files) if (!(await cache.match(f))) missing.push(f);
    return { files: files.length, missing };
  });
  log('saved page and its files:', cached);
  if (cached.missing.length) fail('saved page is missing files');
} finally {
  fs.writeFileSync(index, original);
}

await browser.close();
mock.close();
proxy.close();
log(process.exitCode ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED');
process.exit(process.exitCode ?? 0);

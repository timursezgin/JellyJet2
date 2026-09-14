// Swipe-back stress test in Playwright WebKit with synthetic touches.
// Run the pretend-session dev server first: VITE_LAYOUT_TEST=1 npx vite --port 5199
// Needs playwright installed (npm i playwright; npx playwright install webkit).
import { webkit } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5199/';
const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 402, height: 874 }, hasTouch: true });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto(URL);
await page.waitForTimeout(1500);

const sleep = (ms) => page.waitForTimeout(ms);

await page.evaluate(() => {
  let target = null;
  // Desktop WebKit can't construct Touch objects; an Event carrying the same fields does.
  window.__fake = (type, touches, changed) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'touches', { value: touches });
    Object.defineProperty(ev, 'targetTouches', { value: touches });
    Object.defineProperty(ev, 'changedTouches', { value: changed });
    return ev;
  };
  let id = 0;
  window.__touchTarget = () => target;
  window.__touch = (type, x, y) => {
    if (type === 'touchstart') {
      target = document.elementFromPoint(x, y);
      id += 1;
    }
    const t = { identifier: id, target, clientX: x, clientY: y, pageX: x, pageY: y };
    const live = type === 'touchend' || type === 'touchcancel' ? [] : [t];
    target.dispatchEvent(window.__fake(type, live, [t]));
  };
});

async function nav(fn, ...args) {
  return page.evaluate(
    async ([fn, args]) => {
      const m = await import('/src/nav/navigation.ts');
      const s = m.useNavigation.getState();
      s[fn](...args);
    },
    [fn, args],
  );
}

async function stackLength() {
  return page.evaluate(async () => {
    const m = await import('/src/nav/navigation.ts');
    const s = m.useNavigation.getState();
    return s.stacks[s.tab].length;
  });
}

/** Everything that must be true once nothing is moving. */
async function checkRest(label) {
  const r = await page.evaluate(() => {
    const stack = [...document.querySelectorAll('[class*="stack"][data-visible]')][0];
    const pages = [...stack.children];
    const problems = [];
    if (stack.dataset.dragging) problems.push('still marked dragging');
    pages.forEach((p, i) => {
      if (p.style.transform) problems.push(`page ${i} inline transform ${p.style.transform}`);
      const shade = p.lastElementChild;
      if (shade?.style.opacity) problems.push(`page ${i} inline shade ${shade.style.opacity}`);
      const running = p.getAnimations().filter((a) => a.playState === 'running');
      if (running.length) problems.push(`page ${i} still animating`);
    });
    const top = pages.filter((p) => !p.hasAttribute('data-covered') && !p.hasAttribute('data-hidden')).at(-1);
    const left = top?.getBoundingClientRect().left;
    if (left !== 0) problems.push(`top page left=${left}`);
    if (top?.hasAttribute('inert')) problems.push('top page inert');
    return { problems, pages: pages.length };
  });
  const len = await stackLength();
  if (r.pages !== len) r.problems.push(`DOM pages ${r.pages} vs stack ${len}`);
  console.log(r.problems.length ? `FAIL ${label}: ${r.problems.join('; ')}` : `ok   ${label} (stack ${len})`);
  return r.problems.length === 0;
}

async function swipe(points, stepMs = 16, { end = true } = {}) {
  await page.evaluate(([x, y]) => window.__touch('touchstart', x, y), points[0]);
  for (const p of points.slice(1)) {
    await sleep(stepMs);
    await page.evaluate(([x, y]) => window.__touch('touchmove', x, y), p);
  }
  if (end) await page.evaluate(([x, y]) => window.__touch('touchend', x, y), points.at(-1));
}

const line = (from, to, n, y = 500) =>
  Array.from({ length: n + 1 }, (_, i) => [from + ((to - from) * i) / n, y + (i % 2)]);

async function reset(depth) {
  await nav('selectTab', 'library');
  await nav('popToRoot', 'library');
  await sleep(600);
  const routes = [{ name: 'playlists' }, { name: 'liked' }, { name: 'artists' }, { name: 'genres' }];
  for (let i = 0; i < depth - 1; i++) {
    await nav('push', routes[i]);
    await sleep(500);
  }
}

let ok = true;

// 1. A quick swipe back, then another swipe starting while the first is still sliding.
await reset(4);
await swipe(line(10, 260, 5), 12);
await sleep(40);
await swipe(line(10, 40, 4), 20);
await sleep(900);
ok = (await checkRest('swipe again while sliding (short second swipe)')) && ok;

// 2. Two full swipes back to back.
await reset(4);
await swipe(line(10, 300, 6), 12);
await sleep(30);
await swipe(line(10, 300, 6), 12);
await sleep(900);
const len2 = await stackLength();
ok = (await checkRest('two quick full swipes')) && ok;
if (len2 !== 2) {
  console.log(`FAIL two quick full swipes: expected stack 2, got ${len2}`);
  ok = false;
}

// 3. Swipe back, then open a page: it must stay open.
await reset(3);
await swipe(line(10, 300, 6), 12);
await sleep(700);
await nav('push', { name: 'genres' });
await sleep(900);
const len3 = await stackLength();
ok = (await checkRest('open a page after swiping back')) && ok;
if (len3 !== 3) {
  console.log(`FAIL open after swipe: expected stack 3, got ${len3}`);
  ok = false;
}

// 4. A second finger lands during the swipe, then the page is swiped again.
await reset(3);
await swipe(line(10, 150, 5), 16, { end: false });
await page.evaluate(() => {
  const t1 = { identifier: 991, clientX: 150, clientY: 500 };
  const t2 = { identifier: 992, clientX: 300, clientY: 300 };
  window.__touchTarget().dispatchEvent(window.__fake('touchmove', [t1, t2], [t2]));
});
await sleep(700);
ok = (await checkRest('second finger cancels')) && ok;

// 5. Random abuse: swipes of random length/speed at random gaps.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let round = 0; round < 25; round++) {
  await reset(4);
  const swipes = 1 + Math.floor(rand() * 3);
  for (let s = 0; s < swipes; s++) {
    const to = 20 + rand() * 360;
    await swipe(line(6 + rand() * 18, to, 2 + Math.floor(rand() * 8)), 8 + rand() * 40);
    await sleep(rand() * 250);
  }
  if (rand() < 0.5) {
    await nav('push', { name: 'tracks' });
    await sleep(rand() * 200);
  }
  await sleep(900);
  ok = (await checkRest(`random round ${round}`)) && ok;
}

console.log(ok ? 'ALL SWIPE CHECKS PASSED' : 'SOME SWIPE CHECKS FAILED');
await browser.close();
process.exit(ok ? 0 : 1);

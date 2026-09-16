// Draws JellyJet's icons: the JJ in Archivo Bold on the app's red, with the
// second J raised a little (two beamed notes, if you look at it right).
//   node tool/icons.mjs            -> writes public/favicon.png and public/icons/*
//   node tool/icons.mjs --preview  -> one sheet in scratch/, nothing overwritten
// Needs Playwright WebKit (the same one the tests use).
// The file names never change, so caches (Cloudflare, browsers, the service
// worker) would keep the old pictures: after changing the icons, raise the
// ?v= on every icon address in index.html, public/manifest.webmanifest and
// src/screens/sign-in-screen.tsx.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RED = '#ec3013';
const INK = '#f5f4f3';
/** Of the tile's width: how big the letters are, how far apart, how much the second J rises. */
const SIZE = 0.53;
const TRACKING = -0.012;
const RAISE = 0.075;
const font = fs.readFileSync(path.join(root, 'public/fonts/Archivo-Bold.woff2')).toString('base64');

function page({ size = 512, raise = RAISE, letters = SIZE, background = RED } = {}) {
  return `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: Archivo; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 700; }
  html, body { margin: 0; padding: 0; }
  .tile { width: ${size}px; height: ${size}px; background: ${background}; display: flex;
          align-items: center; justify-content: center; overflow: hidden; }
  .jj { font: 700 ${size * letters}px Archivo, sans-serif; color: ${INK};
        letter-spacing: ${size * TRACKING}px; display: flex; align-items: baseline; }
  .up { position: relative; top: ${-size * raise}px; }
  </style><div class="tile"><span class="jj"><span>J</span><span class="up">J</span></span></div>`;
}

const browser = await webkit.launch();

async function shot(file, options) {
  const size = options.size ?? 512;
  const p = await browser.newPage({ viewport: { width: size, height: size } });
  await p.setContent(page(options));
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(150);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await p.screenshot({ path: file, omitBackground: false });
  await p.close();
  return file;
}

if (process.argv.includes('--preview')) {
  const out = process.env.PREVIEW_DIR ?? path.join(root, 'scratch');
  for (const raise of [0, 0.05, 0.075, 0.1]) {
    await shot(path.join(out, `icon-raise-${String(raise).replace('.', '')}.png`), { raise });
    await shot(path.join(out, `icon-raise-${String(raise).replace('.', '')}-64.png`), { raise, size: 64 });
  }
  console.log(`preview icons in ${out}`);
} else {
  const files = [
    ['public/favicon.png', { size: 32 }],
    ['public/icons/apple-touch-icon.png', { size: 180 }],
    ['public/icons/Icon-192.png', { size: 192 }],
    ['public/icons/Icon-512.png', { size: 512 }],
    // Maskable: Android crops the corners, and the letters sit well inside the safe circle.
    ['public/icons/Icon-maskable-192.png', { size: 192 }],
    ['public/icons/Icon-maskable-512.png', { size: 512 }],
  ];
  for (const [file, options] of files) console.log('wrote', await shot(path.join(root, file), options));
}

await browser.close();

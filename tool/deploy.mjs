// Builds JellyJet 2 and copies it into tim-box's Desktop\JellyJet2\site folder,
// where the JellyJet2 Caddy container serves it. Works from the Mac, from
// tim-box itself and from another Windows PC:
//   npm run deploy
// The folder is found automatically (first one that exists), or set it:
//   JJ_DEPLOY_TARGET="\\100.115.48.57\Users\Windows 11\Desktop\JellyJet2" npm run deploy
// The container picks up new files at once; only a Caddyfile or
// docker-compose.yml change needs a restart on tim-box.
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const CANDIDATES = [
  // The Mac, with tim-box's "Users" share mounted.
  '/Volumes/Users/Windows 11/Desktop/JellyJet2',
  // tim-box itself.
  'C:\\Users\\Windows 11\\Desktop\\JellyJet2',
  // Another Windows PC, over Tailscale or the home network (open the share in
  // File Explorer once and sign in with tim-box's Windows account).
  '\\\\100.115.48.57\\Users\\Windows 11\\Desktop\\JellyJet2',
  '\\\\tim-box\\Users\\Windows 11\\Desktop\\JellyJet2',
];

const target = process.env.JJ_DEPLOY_TARGET || CANDIDATES.find((dir) => fs.existsSync(dir));
if (!target || !fs.existsSync(target)) {
  console.error(
    `Can't see tim-box's JellyJet2 folder. Tried:\n  ${(process.env.JJ_DEPLOY_TARGET ? [process.env.JJ_DEPLOY_TARGET] : CANDIDATES).join('\n  ')}\n` +
      'On Windows, open \\\\100.115.48.57\\Users in File Explorer once and sign in, or set JJ_DEPLOY_TARGET.',
  );
  process.exit(1);
}

const build = spawnSync('npm run build', { stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const dist = path.join(root, 'dist');
const site = path.join(target, 'site');
fs.mkdirSync(site, { recursive: true });

/** Every file under a folder, as paths relative to it. */
function files(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full, base) : [path.relative(base, full)];
  });
}

const built = files(dist).filter((f) => !f.endsWith('.map'));
const isShell = (f) => f === 'index.html' || f === 'sw.js';
const copy = (f) => {
  fs.mkdirSync(path.dirname(path.join(site, f)), { recursive: true });
  fs.copyFileSync(path.join(dist, f), path.join(site, f));
};

// Build files first, the page and service worker last, so a phone never loads
// a page whose files haven't arrived yet.
for (const f of built.filter((f) => !isShell(f))) copy(f);
for (const f of built.filter(isShell)) copy(f);

// Old build files go once the new page is in place.
const keep = new Set(built);
let removed = 0;
for (const f of files(site)) {
  if (keep.has(f)) continue;
  fs.rmSync(path.join(site, f));
  removed++;
}
// Folders left empty.
for (const dir of fs.readdirSync(site, { withFileTypes: true })) {
  const full = path.join(site, dir.name);
  if (dir.isDirectory() && files(full).length === 0) fs.rmSync(full, { recursive: true });
}

for (const [name, action] of [
  ['Caddyfile', "run 'docker compose restart' in Desktop\\JellyJet2 on tim-box"],
  ['docker-compose.yml', "run 'docker compose up -d' in Desktop\\JellyJet2 on tim-box"],
]) {
  const from = path.join(root, 'deploy', name);
  const to = path.join(target, name);
  const same = fs.existsSync(to) && fs.readFileSync(from).equals(fs.readFileSync(to));
  if (!same) {
    fs.copyFileSync(from, to);
    console.log(`${name} changed - ${action}.`);
  }
}

let version = 'local';
try {
  version = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  // not a git checkout
}
console.log(`Published JellyJet 2 (${version}) to ${site} - ${built.length} files, ${removed} old removed.`);

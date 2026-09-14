// Serves the production build (dist/) on http://localhost:8792 exactly as the
// JellyJet2 container does, for testing the service worker and downloads.
// Needs Caddy on the PATH (Mac: brew install caddy; Windows: winget install CaddyServer.Caddy).
//   npm run serve-local                                   -> the real Jellyfin over Tailscale
//   JELLYFIN_UPSTREAM=localhost:8793 npm run serve-local   -> the tests' pretend server
//   (PIPELINE_UPSTREAM=localhost:8795 for the extras test's pretend download server)
// On Windows PowerShell set variables first: $env:JELLYFIN_UPSTREAM="localhost:8793"
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const caddy = ['/opt/homebrew/bin/caddy'].find((p) => fs.existsSync(p)) ?? 'caddy';

const child = spawn(caddy, ['run', '--config', 'deploy/Caddyfile', '--adapter', 'caddyfile'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    LISTEN: 'http://:8792',
    // Relative to cwd: the Caddyfile inserts it unquoted, so an absolute path
    // with a space (C:\Users\Windows 11\...) would split in two.
    SITE_ROOT: 'dist',
    JELLYFIN_UPSTREAM: process.env.JELLYFIN_UPSTREAM || '100.115.48.57:8096',
    PIPELINE_UPSTREAM: process.env.PIPELINE_UPSTREAM || '100.115.48.57:8420',
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));

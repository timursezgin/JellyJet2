import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// The app's version (package.json, raised with each release) and this build's
// stamp. The build writes both to /version.json too, so an open app can tell
// a newer release has been published (src/update/update.ts).
const VERSION = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;
const BUILD = new Date().toISOString();

const versionFile: Plugin = {
  name: 'jellyjet-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION, build: BUILD }) });
  },
};

// While developing on the Mac, the app talks to tim-box over Tailscale through
// these two local paths. Once published, Caddy serves the same paths on jj.
const JELLYFIN = process.env.JJ_JELLYFIN ?? 'http://100.115.48.57:8096';
const PIPELINE = process.env.JJ_PIPELINE ?? 'http://100.115.48.57:8420';

export default defineConfig({
  plugins: [react(), versionFile],
  define: {
    __APP_VERSION__: JSON.stringify(VERSION),
    __APP_BUILD__: JSON.stringify(BUILD),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: true,
    port: Number(process.env.PORT ?? 5173),
    proxy: {
      '/jellyfin': {
        target: JELLYFIN,
        changeOrigin: true,
        // The live connection (/socket) other devices send commands through.
        ws: true,
        rewrite: (path) => path.replace(/^\/jellyfin/, ''),
      },
      '/pipeline': {
        target: PIPELINE,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/pipeline/, ''),
      },
    },
  },
  build: {
    target: 'safari16',
    sourcemap: true,
  },
});

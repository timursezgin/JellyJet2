import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// While developing on the Mac, the app talks to tim-box over Tailscale through
// these two local paths. Once published, Caddy serves the same paths on jj.
const JELLYFIN = process.env.JJ_JELLYFIN ?? 'http://100.115.48.57:8096';
const PIPELINE = process.env.JJ_PIPELINE ?? 'http://100.115.48.57:8420';

export default defineConfig({
  plugins: [react()],
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

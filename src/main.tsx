import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';
import { persistOptions, queryClient } from './data/query-client';
import { ErrorBoundary } from './ui/error-boundary';
import { startUpdateChecks } from './update/update';
import './theme/global.css';

/** The window height; full-screen layers use it instead of `inset: 0`. */
function syncAppHeight() {
  document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
}
syncAppHeight();
window.addEventListener('resize', syncAppHeight);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </PersistQueryClientProvider>
  </StrictMode>,
);

// The offline service worker only runs in the published build; during
// development it would serve stale files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });

  // The app opens from its saved copy while a newer version is fetched in the
  // background. If one arrives in the first seconds after opening, before
  // anything has been touched, switch to it straight away; otherwise it's used
  // the next time the app opens.
  let touched = false;
  window.addEventListener('pointerdown', () => (touched = true), { once: true, capture: true });
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'update-ready') return;
    if (!touched && performance.now() < 6000) window.location.reload();
  });
}

// Later than that, Settings shows "Update available" (src/update/update.ts).
startUpdateChecks();

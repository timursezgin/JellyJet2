import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';
import './theme/global.css';

/** The window height; full-screen layers use it instead of `inset: 0`. */
function syncAppHeight() {
  document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
}
syncAppHeight();
window.addEventListener('resize', syncAppHeight);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Library data changes rarely; refresh in the background, never block.
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

// The offline service worker only runs in the published build; during
// development it would serve stale files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

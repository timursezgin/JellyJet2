import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';
import './theme/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The offline service worker only runs in the published build; during
// development it would serve stale files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

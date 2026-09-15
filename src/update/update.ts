import { create } from 'zustand';

/**
 * Is a newer JellyJet published than the one running? Every build writes
 * /version.json (vite.config.ts); an open app compares its own build stamp
 * with it when it opens, when it comes back to the front and every so often,
 * and shows "Update available" (Settings) when they differ. The service worker
 * saying it has saved a newer page counts too.
 */

export const APP_VERSION = __APP_VERSION__;
export const APP_BUILD = __APP_BUILD__;

interface UpdateState {
  available: boolean;
  /** The published version, once known to differ. */
  latest: string | null;
  refreshing: boolean;
}

export const useUpdate = create<UpdateState>(() => ({ available: false, latest: null, refreshing: false }));

const CHECK_EVERY_MS = 10 * 60 * 1000;
const CHECK_GAP_MS = 60 * 1000;
let lastCheck = 0;

export async function checkForUpdate() {
  if (!import.meta.env.PROD || useUpdate.getState().available) return;
  if (Date.now() - lastCheck < CHECK_GAP_MS) return;
  lastCheck = Date.now();
  try {
    // A fresh address each time, so no cache on the way answers for the server.
    const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const published = (await response.json()) as { version?: string; build?: string };
    if (published.build && published.build !== APP_BUILD) {
      useUpdate.setState({ available: true, latest: published.version ?? null });
    }
  } catch {
    // Offline or unreachable: asked again later.
  }
}

/**
 * Switch to the published version: the service worker saves the new page and
 * its files first (so the reload doesn't open the old saved copy), then reload.
 */
export async function applyUpdate() {
  if (useUpdate.getState().refreshing) return;
  useUpdate.setState({ refreshing: true });
  const worker = navigator.serviceWorker?.controller;
  if (worker) {
    await new Promise<void>((resolve) => {
      const done = () => {
        navigator.serviceWorker.removeEventListener('message', onMessage);
        clearTimeout(timer);
        resolve();
      };
      const onMessage = (event: MessageEvent) => {
        if (event.data?.type === 'shell-refreshed') done();
      };
      // An older service worker doesn't answer: reload anyway after a moment.
      const timer = setTimeout(done, 8000);
      navigator.serviceWorker.addEventListener('message', onMessage);
      worker.postMessage({ type: 'refresh-shell' });
    });
  }
  window.location.reload();
}

/** Keep checking while the app runs. Called once at start. */
export function startUpdateChecks() {
  if (!import.meta.env.PROD) return;
  navigator.serviceWorker?.addEventListener('message', (event) => {
    if (event.data?.type === 'update-ready') useUpdate.setState({ available: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      lastCheck = 0;
      void checkForUpdate();
    }
  }, CHECK_EVERY_MS);
  setTimeout(() => void checkForUpdate(), 3000);
}

import { create } from 'zustand';

/**
 * Whether Jellyfin can be reached right now. "Offline" covers both no
 * internet and the server being unreachable (e.g. Tailscale off).
 *
 * Every request reports in: a network failure flips to offline once a ping
 * confirms it, any answer flips back. While offline the server is pinged
 * every few seconds.
 */

interface ConnectionState {
  online: boolean;
}

export const useConnection = create<ConnectionState>(() => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
}));

export const isOnline = () => useConnection.getState().online;
export const useOnline = () => useConnection((s) => s.online);

type Pinger = () => Promise<boolean>;
let pinger: Pinger | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

/** Run `fn` whenever the connection comes back. */
export function onReconnect(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function reportReachable() {
  if (useConnection.getState().online) return;
  clearTimeout(timer);
  useConnection.setState({ online: true });
  for (const fn of listeners) fn();
}

let confirming = false;

/**
 * A request failed. One failure isn't proof of being offline - a busy server
 * can be slow to answer one request - so the server is asked directly first.
 * (A false "offline" skips every song that isn't downloaded, stopping the music.)
 */
export function reportUnreachable() {
  if (!useConnection.getState().online || confirming) return;
  if (!pinger || !navigator.onLine) {
    goOffline();
    return;
  }
  confirming = true;
  void pinger()
    .catch(() => false)
    .then((ok) => {
      confirming = false;
      if (!ok) goOffline();
    });
}

function goOffline() {
  if (!useConnection.getState().online) return;
  useConnection.setState({ online: false });
  schedulePing();
}

function schedulePing() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (useConnection.getState().online) return;
    const ok = pinger ? await pinger().catch(() => false) : navigator.onLine;
    if (ok) reportReachable();
    else schedulePing();
  }, 5000);
}

/** How to check the server; set once the server address is known. */
export function setPinger(fn: Pinger) {
  pinger = fn;
}

window.addEventListener('offline', () => goOffline());
window.addEventListener('online', () => {
  // The network is back, but the server may not be: check before trusting it.
  if (pinger) void pinger().then((ok) => (ok ? reportReachable() : schedulePing()), () => schedulePing());
  else reportReachable();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !useConnection.getState().online) {
    clearTimeout(timer);
    void pinger?.().then((ok) => (ok ? reportReachable() : schedulePing()), () => schedulePing());
  }
});

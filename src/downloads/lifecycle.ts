import type { Session } from '@/auth/session';
import { isOnline, onReconnect, setPinger } from '@/connectivity/connection';
import { queryClient } from '@/data/query-client';
import { flushOutbox } from '@/offline/outbox';
import { restorePendingLikes } from '@/songs/likes';
import { checkBackup, startBackup } from './backup';
import { loadDownloads, unloadDownloads } from './downloads';
import { pumpQueue, stopDownloads, syncAllCollections, verifyFiles } from './engine';

let backupStarted = false;

/**
 * Everything that keeps downloads and offline changes moving, for as long as
 * someone is signed in. Returns a function that stops it.
 */
export function startOfflineServices(session: Session) {
  let stopped = false;

  setPinger(async () => {
    // A server that doesn't answer within a few seconds counts as unreachable.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`${session.serverUrl}/System/Ping`, { cache: 'no-store', signal: controller.signal });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  });

  const whenReachable = () => {
    if (stopped) return;
    void flushOutbox();
    pumpQueue();
    void syncAllCollections();
  };

  void (async () => {
    await loadDownloads(session.userId);
    if (stopped) return;
    restorePendingLikes();
    await verifyFiles();
    if (!backupStarted) {
      backupStarted = true;
      startBackup();
    }
    if (isOnline()) {
      whenReachable();
      void checkBackup();
    }
  })();

  const offReconnect = onReconnect(() => {
    whenReachable();
    void checkBackup();
  });

  // iOS pauses web apps in the background; pick up where things were on return.
  const onVisible = () => {
    if (document.visibilityState === 'visible' && isOnline()) whenReachable();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    offReconnect();
    document.removeEventListener('visibilitychange', onVisible);
    stopDownloads();
    unloadDownloads();
  };
}

/** Signing out: forget this account's cached library on the phone (downloads stay for next time). */
export async function clearAccountCache() {
  queryClient.clear();
}

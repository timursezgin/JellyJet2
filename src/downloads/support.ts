/** Whether this browser, opened this way, can keep songs for offline. */

const ua = navigator.userAgent;
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

export const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export type DownloadSupport =
  | { ok: true }
  | { ok: false; title: string; message: string };

export function downloadSupport(): DownloadSupport {
  if (!window.isSecureContext || !('caches' in window) || !('indexedDB' in window)) {
    return {
      ok: false,
      title: 'Downloads need the secure address',
      message: 'Open JellyJet from its https:// address to keep songs on this device.',
    };
  }
  // A Safari tab keeps its own storage, separate from the home-screen app
  // (and iOS clears it far more readily), so downloads only happen there.
  if (isIOS && !isStandalone) {
    return {
      ok: false,
      title: 'Add JellyJet to your Home Screen first',
      message:
        'Downloads are kept by the Home Screen app. In Safari tap Share, then Add to Home Screen, and download from there.',
    };
  }
  return { ok: true };
}

/** Ask the browser to protect this site's storage from automatic clean-up. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

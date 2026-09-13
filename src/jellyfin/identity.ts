/**
 * How this app introduces itself to Jellyfin. The device id must stay the same
 * across launches: it keys the entry in Jellyfin's Dashboard → Devices and the
 * session that playback reports attach to.
 */

const DEVICE_ID_KEY = 'jj.deviceId';

export const CLIENT_NAME = 'JellyJet';
export const CLIENT_VERSION = '2.0.0';

function randomId(): string {
  // crypto.randomUUID needs a secure (https) page; getRandomValues doesn't.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/** A short, readable device name, e.g. "iPhone", "Mac (Chrome)". */
export function deviceName(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : 'Web';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua) && !/CriOS/.test(ua)
        ? 'Chrome'
        : 'Safari';
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (device === 'iPhone' || device === 'iPad' || device === 'Android') {
    return standalone ? device : `${device} (${browser})`;
  }
  return `${device} (${browser})`;
}

/**
 * Header values must be plain ASCII - a browser sends "Tim’s iPhone" as-is and
 * Cloudflare rejects the request before Jellyfin ever sees it.
 */
function headerSafe(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/"/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function authorizationHeader(token?: string): string {
  const parts = [
    `Client="${CLIENT_NAME}"`,
    `Device="${headerSafe(deviceName())}"`,
    `DeviceId="${deviceId()}"`,
    `Version="${CLIENT_VERSION}"`,
  ];
  if (token) parts.push(`Token="${token}"`);
  return `MediaBrowser ${parts.join(', ')}`;
}

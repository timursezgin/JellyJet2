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

const DEVICE_NAME_KEY = 'jj.deviceName';
const nameListeners = new Set<() => void>();

/**
 * This device's name as shown to the account's other devices ("Playing on …")
 * and in Jellyfin: the one chosen in Settings, or a guess from the browser
 * (a web page can't read the name the owner gave the phone or computer).
 */
export function deviceName(): string {
  try {
    const chosen = localStorage.getItem(DEVICE_NAME_KEY);
    if (chosen) return chosen;
  } catch {
    // Storage unavailable: the guess will do.
  }
  return guessedDeviceName();
}

/** Name this device (an empty name goes back to the guess). Returns the name as it will be shown. */
export function setDeviceName(name: string): string {
  const clean = headerSafe(name).slice(0, MAX_DEVICE_NAME);
  try {
    if (!clean || clean === guessedDeviceName()) localStorage.removeItem(DEVICE_NAME_KEY);
    else localStorage.setItem(DEVICE_NAME_KEY, clean);
  } catch {
    // Storage full: the name just isn't kept.
  }
  for (const listener of nameListeners) listener();
  return deviceName();
}

export const MAX_DEVICE_NAME = 40;

/** Hear when this device is renamed. */
export function onDeviceNameChange(listener: () => void) {
  nameListeners.add(listener);
  return () => void nameListeners.delete(listener);
}

/** A short, readable guess at the device, e.g. "iPhone", "Mac (Chrome)". */
export function guessedDeviceName(): string {
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
export function headerSafe(value: string): string {
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

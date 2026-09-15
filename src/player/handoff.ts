import { create } from 'zustand';

import { useSession } from '@/auth/session';
import { isOnline, onReconnect } from '@/connectivity/connection';
import { deviceId, deviceName } from '@/jellyfin/identity';
import { pauseDevice } from '@/remote/remote';
import {
  currentPosition,
  onPlaybackActivity,
  resumeQueue,
  usePlayer,
  type PlaybackActivity,
  type Repeat,
} from './player';
import type { Track } from './track';
import { queueFromIds } from './track-lookup';

/**
 * Pick up on one device where another left off.
 *
 * While music plays here, a small note - which songs are queued, which one is
 * on and how far in - is kept on the Jellyfin account (display preferences
 * under this app's name, like the downloads backup). When the app is opened
 * or comes back to the front on another device, and the note there is newer
 * than anything played on that device, it offers to continue from the same
 * spot. Only listening counts: opening the app never overwrites the note.
 */

const PREFS_ID = 'jellyjet-playback';
const CLIENT = 'JellyJet';
const KEY = 'nowPlaying';

/** At most this many songs of the queue go in the note, starting a little before the one on. */
const WINDOW_BEFORE = 50;
const WINDOW_SIZE = 300;
/** While a song plays, the note's position is brought up to date this often. */
const TICK_WRITE_MS = 30_000;
/** Notes older than this aren't offered. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Switching windows back and forth doesn't ask the server every time. */
const CHECK_GAP_MS = 5_000;

interface Note {
  v: 1;
  device: string;
  deviceName: string;
  /** When the listening happened (ms since 1970). */
  at: number;
  ids: string[];
  index: number;
  position: number;
  shuffle: boolean;
  repeat: Repeat;
}

export interface HandoffOffer {
  deviceName: string;
  deviceId: string;
  tracks: Track[];
  index: number;
  position: number;
  shuffle: boolean;
  repeat: Repeat;
  /** Identifies the note, so a dismissed one stays dismissed. */
  key: string;
}

export const useHandoff = create<{ offer: HandoffOffer | null }>(() => ({ offer: null }));

type Prefs = { CustomPrefs?: Record<string, string | null> } & Record<string, unknown>;

const activeKey = (userId: string) => `jj.handoff.activeAt.${userId}`;
const dismissedKey = (userId: string) => `jj.handoff.dismissed.${userId}`;

function account() {
  const { client, session } = useSession.getState();
  return client && session ? { client, userId: session.userId } : null;
}

function readLocal(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full; at worst an offer shows once more.
  }
}

// --- Writing the note --------------------------------------------------------

/** The display preferences document as last read, so a write keeps its other fields. */
let prefs: Prefs | null = null;
let lastWrite = 0;
let writeTimer: ReturnType<typeof setTimeout> | undefined;

function snapshot(): Note | null {
  const { queue, index, shuffle, repeat } = usePlayer.getState();
  if (queue.length === 0) return null;
  const start = Math.max(0, Math.min(index - WINDOW_BEFORE, queue.length - WINDOW_SIZE));
  return {
    v: 1,
    device: deviceId(),
    deviceName: deviceName(),
    at: Date.now(),
    ids: queue.slice(start, start + WINDOW_SIZE).map((t) => t.id),
    index: index - start,
    position: Math.round(currentPosition()),
    shuffle,
    repeat,
  };
}

async function writeNote(keepalive = false) {
  const a = account();
  const note = snapshot();
  if (!a || !note || !isOnline()) return;
  lastWrite = Date.now();
  const query = { userId: a.userId, client: CLIENT };
  try {
    prefs ??= (await a.client.get<Prefs>(`/DisplayPreferences/${PREFS_ID}`, { query })) ?? {};
    await a.client.post(`/DisplayPreferences/${PREFS_ID}`, {
      query,
      keepalive,
      body: { ...prefs, Id: PREFS_ID, Client: CLIENT, CustomPrefs: { ...(prefs.CustomPrefs ?? {}), [KEY]: JSON.stringify(note) } },
    });
  } catch {
    prefs = null; // read afresh next time
  }
}

function onActivity(kind: PlaybackActivity) {
  const a = account();
  if (!a) return;
  writeLocal(activeKey(a.userId), String(Date.now()));
  // Listening here now: an offer to continue from elsewhere no longer fits.
  if (useHandoff.getState().offer) useHandoff.setState({ offer: null });
  if (kind === 'tick' && Date.now() - lastWrite < TICK_WRITE_MS) return;
  // A burst of changes (skipping through songs) makes one write.
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => void writeNote(), kind === 'now' ? 1000 : 0);
}

// --- Offering to continue ----------------------------------------------------

let lastCheck = 0;
let checking = false;

export async function checkHandoff() {
  const a = account();
  const { playing, remote } = usePlayer.getState();
  if (!a || !isOnline() || checking || playing || remote) return;
  if (Date.now() - lastCheck < CHECK_GAP_MS) return;
  lastCheck = Date.now();
  checking = true;
  try {
    prefs = (await a.client.get<Prefs>(`/DisplayPreferences/${PREFS_ID}`, { query: { userId: a.userId, client: CLIENT } })) ?? {};
    const raw = prefs.CustomPrefs?.[KEY];
    if (!raw) return;
    const note = JSON.parse(raw) as Note;
    if (note.v !== 1 || note.device === deviceId() || !note.ids?.length) return;

    const key = `${note.device}:${note.at}`;
    const activeAt = Number(readLocal(activeKey(a.userId)) ?? 0);
    if (note.at <= activeAt || Date.now() - note.at > MAX_AGE_MS) return;
    if (readLocal(dismissedKey(a.userId)) === key || useHandoff.getState().offer?.key === key) return;

    // Already at the same song and place here: nothing to offer.
    const { queue, index } = usePlayer.getState();
    if (queue[index]?.id === note.ids[note.index] && Math.abs(currentPosition() - note.position) < 5) return;

    // Fetched before offering, so Continue can start playing straight from the tap.
    const { tracks, index: start, position } = await queueFromIds(note.ids, note.index, note.position);
    if (tracks.length === 0) return;
    const now = usePlayer.getState();
    if (now.playing || now.remote) return; // started playing (or controlling) meanwhile

    useHandoff.setState({
      offer: {
        deviceName: note.deviceName,
        deviceId: note.device,
        tracks,
        index: start,
        position,
        shuffle: note.shuffle,
        repeat: note.repeat,
        key,
      },
    });
  } catch {
    // Not reachable right now; asked again next time the app comes to the front.
  } finally {
    checking = false;
  }
}

/**
 * Continue: the queue from the other device plays here, from the same spot,
 * and that device pauses if it's still playing.
 */
export function acceptHandoff() {
  const offer = useHandoff.getState().offer;
  if (!offer) return;
  useHandoff.setState({ offer: null });
  resumeQueue(offer.tracks, offer.index, offer.position, { shuffle: offer.shuffle, repeat: offer.repeat });
  void pauseDevice(offer.deviceId);
}

export function dismissHandoff() {
  const offer = useHandoff.getState().offer;
  const a = account();
  if (offer && a) writeLocal(dismissedKey(a.userId), offer.key);
  useHandoff.setState({ offer: null });
}

/** While signed in: keep the note up to date and look for one from elsewhere. Returns a stop function. */
export function startHandoff() {
  const offActivity = onPlaybackActivity(onActivity);
  const offReconnect = onReconnect(() => void checkHandoff());

  const onFront = () => {
    if (document.visibilityState === 'visible') void checkHandoff();
  };
  // Leaving while a song plays: bring the note's position up to date on the way out.
  const onLeave = () => {
    if (document.visibilityState === 'hidden' && usePlayer.getState().playing) {
      clearTimeout(writeTimer);
      void writeNote(true);
    }
  };
  document.addEventListener('visibilitychange', onFront);
  document.addEventListener('visibilitychange', onLeave);
  window.addEventListener('focus', onFront);
  void checkHandoff();

  return () => {
    offActivity();
    offReconnect();
    document.removeEventListener('visibilitychange', onFront);
    document.removeEventListener('visibilitychange', onLeave);
    window.removeEventListener('focus', onFront);
    clearTimeout(writeTimer);
    prefs = null;
    lastCheck = 0;
    useHandoff.setState({ offer: null });
  };
}

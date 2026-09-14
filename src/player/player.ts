import { create } from 'zustand';

import { useSession } from '@/auth/session';
import {
  imageUrl,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
  streamUrl,
} from '@/jellyfin/api';
import { toast } from '@/ui/toast';
import type { Track } from './track';

/**
 * The player: one audio element for the life of the app, a queue, and the
 * lock-screen controls.
 *
 * iPhone rule that shapes everything here: when a song ends with the screen
 * locked, the next one must be started straight away inside the `ended` event
 * - no waiting on the network first - or iOS may not let it start. So stream
 * URLs are built locally and reports to Jellyfin are fired without waiting.
 */

export type Repeat = 'off' | 'all' | 'one';

/** A queue entry. `uid` tells two copies of the same song apart. */
export type QueueItem = Track & { uid: string };

interface PlayerState {
  queue: QueueItem[];
  /** The unshuffled order, kept while shuffle is on so it can be restored. */
  original: QueueItem[] | null;
  index: number;
  shuffle: boolean;
  repeat: Repeat;
  playing: boolean;
  buffering: boolean;
  duration: number;
  /** Full-screen player open. */
  expanded: boolean;
  queueOpen: boolean;
}

export const usePlayer = create<PlayerState>(() => ({
  queue: [],
  original: null,
  index: 0,
  shuffle: false,
  repeat: 'off',
  playing: false,
  buffering: false,
  duration: 0,
  expanded: false,
  queueOpen: false,
}));

const get = usePlayer.getState;
const set = usePlayer.setState;

export const audio = new Audio();
audio.preload = 'auto';
audio.setAttribute('playsinline', '');
audio.setAttribute('aria-hidden', 'true');

// --- Per-track bookkeeping ------------------------------------------------
let loadedUid: string | null = null;
let playSessionId = '';
let reportedStart = false;
let lastProgressReport = 0;
let lastSaved = 0;
let pendingSeek: number | null = null;
/** Where a restored queue left off, shown before anything is loaded. */
let restoredPosition = 0;
let errorStreak = 0;
/** Swapping the source fires a `pause`; that one isn't the listener pausing. */
let switchingTracks = false;

let uidCounter = 0;
const withUid = (track: Track): QueueItem => ({ ...track, uid: `q${Date.now().toString(36)}${++uidCounter}` });

function randomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function currentTrack(state: PlayerState = get()): QueueItem | undefined {
  return state.queue[state.index];
}

/** Position in seconds, including a restored position before playback starts. */
export function currentPosition(): number {
  return loadedUid ? audio.currentTime : restoredPosition;
}

function session() {
  const { client, session } = useSession.getState();
  return client && session ? { client, userId: session.userId } : null;
}

// --- Loading and transport ------------------------------------------------

function load(index: number, { autoplay, startAt = 0 }: { autoplay: boolean; startAt?: number }) {
  const track = get().queue[index];
  const s = session();
  if (!track || !s) return;
  endSilentPause();

  reportStopped();
  playSessionId = randomId();
  reportedStart = false;
  lastProgressReport = 0;
  loadedUid = track.uid;
  restoredPosition = 0;
  pendingSeek = startAt > 0 ? startAt : null;

  set({ index, duration: track.duration, buffering: autoplay, playing: autoplay });
  switchingTracks = autoplay;
  audio.src = streamUrl(s.client, s.userId, track.id, playSessionId);
  updateMetadata(track);
  if (autoplay) startPlayback();
  save(true);
}

function startPlayback() {
  audio.play().catch((error: unknown) => {
    // Refused (e.g. no tap yet after launch) or interrupted by a newer load.
    if (error instanceof DOMException && error.name === 'AbortError') return;
    switchingTracks = false;
    set({ playing: false, buffering: false });
  });
}

/** Replace the queue with these songs and start playing at `startIndex`. */
export function playTracks(tracks: Track[], startIndex = 0, options: { shuffle?: boolean } = {}) {
  if (tracks.length === 0) return;
  unlockSilence();
  const items = tracks.map(withUid);
  const shuffle = options.shuffle ?? get().shuffle;
  if (shuffle) {
    const first = options.shuffle && startIndex === 0 ? items[Math.floor(Math.random() * items.length)] : items[startIndex];
    const rest = shuffled(items.filter((item) => item !== first));
    set({ queue: [first, ...rest], original: items, shuffle: true });
  } else {
    set({ queue: items, original: null, shuffle: false });
  }
  errorStreak = 0;
  load(shuffle ? 0 : startIndex, { autoplay: true });
}

export function play() {
  const track = currentTrack();
  if (!track) return;
  unlockSilence();
  endSilentPause();
  if (loadedUid !== track.uid) {
    load(get().index, { autoplay: true, startAt: restoredPosition });
    return;
  }
  set({ playing: true });
  startPlayback();
}

export function pause() {
  switchingTracks = false;
  audio.pause();
  set({ playing: false });
}

export function togglePlay() {
  if (get().playing) pause();
  else play();
}

export function next() {
  const { queue, index, repeat } = get();
  if (queue.length === 0) return;
  if (index + 1 < queue.length) load(index + 1, { autoplay: true });
  else if (repeat === 'all') load(0, { autoplay: true });
  else load(0, { autoplay: false });
}

export function previous() {
  const { index } = get();
  if (currentPosition() > 3 || index === 0) {
    seek(0);
    return;
  }
  load(index - 1, { autoplay: true });
}

export function seek(seconds: number) {
  const track = currentTrack();
  if (!track) return;
  if (loadedUid !== track.uid) {
    restoredPosition = Math.max(0, seconds);
    audio.dispatchEvent(new Event('timeupdate'));
    return;
  }
  audio.currentTime = Math.max(0, seconds);
  reportProgress(true);
}

export function jumpTo(index: number) {
  if (index < 0 || index >= get().queue.length) return;
  load(index, { autoplay: true });
}

export function setShuffle(on: boolean) {
  const { queue, original, index, shuffle } = get();
  if (on === shuffle || queue.length === 0) {
    set({ shuffle: on });
    return;
  }
  const current = queue[index];
  if (on) {
    const rest = shuffled(queue.filter((item) => item !== current));
    set({ original: queue, queue: [current, ...rest], index: 0, shuffle: true });
  } else {
    const restored = original ?? queue;
    set({ queue: restored, original: null, index: Math.max(0, restored.indexOf(current)), shuffle: false });
  }
  save(true);
}

export function cycleRepeat() {
  const order: Repeat[] = ['off', 'all', 'one'];
  set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] });
  save(true);
}

export function addToQueue(tracks: Track[]) {
  const items = tracks.map(withUid);
  set((s) => ({
    queue: [...s.queue, ...items],
    original: s.original ? [...s.original, ...items] : null,
  }));
  if (get().queue.length === items.length) load(0, { autoplay: false });
  save(true);
}

export function removeFromQueue(index: number) {
  const { queue, original, index: currentIndex, playing } = get();
  const item = queue[index];
  if (!item) return;
  const nextQueue = queue.filter((_, i) => i !== index);
  const nextOriginal = original?.filter((entry) => entry !== item) ?? null;
  if (nextQueue.length === 0) {
    clearQueue();
    return;
  }
  if (index < currentIndex) {
    set({ queue: nextQueue, original: nextOriginal, index: currentIndex - 1 });
  } else if (index > currentIndex) {
    set({ queue: nextQueue, original: nextOriginal });
  } else {
    set({ queue: nextQueue, original: nextOriginal });
    load(Math.min(index, nextQueue.length - 1), { autoplay: playing });
  }
  save(true);
}

export function moveInQueue(from: number, to: number) {
  const { queue, index } = get();
  if (from === to || !queue[from] || to < 0 || to >= queue.length) return;
  const current = queue[index];
  const nextQueue = [...queue];
  const [moved] = nextQueue.splice(from, 1);
  nextQueue.splice(to, 0, moved);
  set({ queue: nextQueue, index: nextQueue.indexOf(current) });
  save(true);
}

export function clearQueue() {
  endSilentPause();
  reportStopped();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  loadedUid = null;
  restoredPosition = 0;
  set({ queue: [], original: null, index: 0, playing: false, buffering: false, duration: 0, expanded: false, queueOpen: false });
  save(true);
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
}

export const openPlayer = () => set({ expanded: true });
export const closePlayer = () => set({ expanded: false, queueOpen: false });
export const setQueueOpen = (queueOpen: boolean) => set({ queueOpen });

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// --- Audio element events ---------------------------------------------------

audio.addEventListener('playing', () => {
  errorStreak = 0;
  switchingTracks = false;
  set({ playing: true, buffering: false });
  if (!reportedStart) {
    reportedStart = true;
    const track = currentTrack();
    const s = session();
    if (track && s) reportPlaybackStart(s.client, { itemId: track.id, playSessionId, positionSeconds: audio.currentTime });
  } else {
    reportProgress(true);
  }
  syncMediaSession();
});

audio.addEventListener('pause', () => {
  if (audio.ended || switchingTracks) return;
  set({ playing: false, buffering: false });
  reportProgress(true);
  syncMediaSession();
  save(true);
});

audio.addEventListener('waiting', () => set({ buffering: true }));

audio.addEventListener('loadedmetadata', () => {
  if (pendingSeek !== null) {
    audio.currentTime = pendingSeek;
    pendingSeek = null;
  }
});

audio.addEventListener('durationchange', () => {
  if (Number.isFinite(audio.duration) && audio.duration > 0) set({ duration: audio.duration });
  syncMediaSession();
});

audio.addEventListener('timeupdate', () => {
  if (!loadedUid) return;
  const now = performance.now();
  if (now - lastProgressReport > 10_000) reportProgress(false);
  if (now - lastSaved > 5_000) save(false);
});

audio.addEventListener('seeked', syncMediaSession);

audio.addEventListener('ended', () => {
  const { queue, index, repeat } = get();
  if (repeat === 'one') {
    load(index, { autoplay: true });
  } else if (index + 1 < queue.length) {
    load(index + 1, { autoplay: true });
  } else if (repeat === 'all') {
    load(0, { autoplay: true });
  } else {
    reportStopped();
    loadedUid = null;
    set({ playing: false, buffering: false, index: 0 });
    syncMediaSession();
    save(true);
  }
});

audio.addEventListener('error', () => {
  if (!loadedUid || !audio.getAttribute('src')) return;
  const track = currentTrack();
  errorStreak += 1;
  set({ buffering: false });
  if (track) toast(`Couldn’t play “${track.name}”`);
  const { queue, index } = get();
  if (errorStreak < 3 && index + 1 < queue.length) {
    load(index + 1, { autoplay: true });
  } else {
    loadedUid = null;
    set({ playing: false });
  }
});

// --- Reporting ----------------------------------------------------------

function reportProgress(force: boolean) {
  const track = currentTrack();
  const s = session();
  if (!track || !s || !reportedStart) return;
  const now = performance.now();
  if (!force && now - lastProgressReport < 10_000) return;
  lastProgressReport = now;
  const repeat = get().repeat;
  reportPlaybackProgress(s.client, {
    itemId: track.id,
    playSessionId,
    positionSeconds: audio.currentTime,
    paused: audio.paused,
    repeatMode: repeat === 'all' ? 'RepeatAll' : repeat === 'one' ? 'RepeatOne' : 'RepeatNone',
  });
}

function reportStopped() {
  if (!reportedStart || !loadedUid) return;
  const s = session();
  const item = get().queue.find((entry) => entry.uid === loadedUid) ?? currentTrack();
  reportedStart = false;
  if (!item || !s) return;
  reportPlaybackStopped(s.client, {
    itemId: item.id,
    playSessionId,
    positionSeconds: audio.ended ? audio.duration || item.duration : audio.currentTime,
  });
}

// --- Lock screen and Control Centre ---------------------------------------

function updateMetadata(track: Track) {
  if (!('mediaSession' in navigator)) return;
  const base = useSession.getState().session?.serverUrl;
  const artwork =
    base && track.art
      ? [256, 512].map((size) => ({
          src: imageUrl(base, track.art!.id, track.art!.tag, size),
          sizes: `${size}x${size}`,
          type: 'image/jpeg',
        }))
      : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.name,
    artist: track.artists.map((a) => a.name).join(', '),
    album: track.album ?? '',
    artwork,
  });
}

function syncMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = get().playing ? 'playing' : 'paused';
  const duration = audio.duration;
  if (Number.isFinite(duration) && duration > 0) {
    try {
      navigator.mediaSession.setPositionState({
        duration,
        // A rate of exactly 0 isn't allowed; a tiny one keeps the lock-screen
        // progress bar still during a silent pause.
        playbackRate: silentPause ? 1e-6 : audio.playbackRate || 1,
        position: Math.min(audio.currentTime, duration),
      });
    } catch {
      // Some browsers reject position state mid-load; the next event retries.
    }
  }
}

// --- Silent pause -----------------------------------------------------------
//
// When a home-screen web app stops making sound with the screen off, iOS puts
// it to sleep within seconds and hands the lock-screen player to another app:
// play then starts that app's (empty) track and tapping the player opens it.
// So a pause from the lock screen quietly plays silence on a second element
// instead: the app stays awake and stays the lock-screen player, and the next
// press resumes the song from the same spot. After 15 minutes it becomes a
// real pause. While the app is on screen a pause is always a real pause.

const SILENT_PAUSE_LIMIT = 15 * 60_000;
const silence = new Audio();
silence.loop = true;
silence.preload = 'auto';
silence.setAttribute('playsinline', '');
let silenceUnlocked = false;
let silentPause = false;
let silentPauseTimer: ReturnType<typeof setTimeout> | undefined;

/** Five seconds of silence as a tiny WAV, made on the spot. */
function silentWavUrl(): string {
  const rate = 8000;
  const samples = rate * 5;
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true); // 8-bit: silence is 128
  text(36, 'data');
  view.setUint32(40, samples, true);
  new Uint8Array(buffer, 44).fill(128);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

/** iOS lets an element play without a tap only once it has played from one. */
function unlockSilence() {
  if (silenceUnlocked) return;
  silenceUnlocked = true;
  silence.src = silentWavUrl();
  silence
    .play()
    .then(() => silence.pause())
    .catch(() => {
      silenceUnlocked = false;
    });
}

function startSilentPause() {
  if (silentPause || !silenceUnlocked) {
    pause();
    return;
  }
  silentPause = true;
  silence.play().catch(() => {
    silentPause = false;
  });
  pause();
  clearTimeout(silentPauseTimer);
  silentPauseTimer = setTimeout(endSilentPause, SILENT_PAUSE_LIMIT);
  syncMediaSession();
}

function endSilentPause() {
  clearTimeout(silentPauseTimer);
  if (!silentPause) return;
  silentPause = false;
  silence.pause();
}

// Back on screen, a paused app is simply paused.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') endSilentPause();
});

/**
 * Which lock-screen buttons exist. Re-sent every time a song starts: iOS
 * forgets a list given before any audio has played and falls back to its
 * video-style skip-15-seconds buttons.
 *
 * During a silent pause iOS thinks something is playing, so it shows a pause
 * button; either button then resumes the song.
 */
function onRemotePlay() {
  play();
}

function onRemotePause() {
  if (silentPause) play();
  else if (document.visibilityState === 'hidden' && get().playing) startSilentPause();
  else pause();
}

function registerRemoteCommands() {
  if (!('mediaSession' in navigator)) return;
  const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
    ['play', onRemotePlay],
    ['pause', onRemotePause],
    ['seekbackward', null],
    ['seekforward', null],
    ['previoustrack', () => previous()],
    ['nexttrack', () => next()],
    ['seekto', (details) => details.seekTime !== undefined && seek(details.seekTime)],
  ];
  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Action not supported here.
    }
  }
}

registerRemoteCommands();
audio.addEventListener('playing', registerRemoteCommands);

// --- Remembering the queue between launches -------------------------------

const storageKey = () => {
  const userId = useSession.getState().session?.userId;
  return userId ? `jj.player.${userId}` : null;
};

interface Saved {
  queue: QueueItem[];
  original: QueueItem[] | null;
  index: number;
  shuffle: boolean;
  repeat: Repeat;
  position: number;
}

/** Nothing is written until the saved queue has been read back, or it'd be lost. */
let restoreAttemptedFor: string | null = null;

function save(now: boolean) {
  const key = storageKey();
  if (!key || restoreAttemptedFor !== key) return;
  const t = performance.now();
  if (!now && t - lastSaved < 5_000) return;
  lastSaved = t;
  const { queue, original, index, shuffle, repeat } = get();
  if (queue.length === 0) {
    localStorage.removeItem(key);
    return;
  }
  const saved: Saved = { queue, original, index, shuffle, repeat, position: currentPosition() };
  try {
    localStorage.setItem(key, JSON.stringify(saved));
  } catch {
    // Storage full; the queue just won't survive a relaunch.
  }
}

/** Bring back the last queue, paused where it was. Called once after sign-in. */
export function restoreQueue() {
  const key = storageKey();
  if (!key || restoreAttemptedFor === key) return;
  restoreAttemptedFor = key;
  if (get().queue.length > 0) return;
  if (import.meta.env.DEV && import.meta.env.VITE_LAYOUT_TEST && !localStorage.getItem(key)) {
    const names = ['First Song', 'A Second Song With A Much Longer Title', 'Third', 'Fourth', 'Fifth', 'Sixth'];
    const queue = names.map((name, i) =>
      withUid({ id: `layout-${i}`, name, album: 'Layout Album', artists: [{ name: 'Layout Artist' }], duration: 200 + i * 17, art: null }),
    );
    localStorage.setItem(key, JSON.stringify({ queue, original: null, index: 0, shuffle: false, repeat: 'off', position: 61 }));
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const saved = JSON.parse(raw) as Saved;
    if (!saved.queue?.length) return;
    const index = Math.min(Math.max(0, saved.index), saved.queue.length - 1);
    restoredPosition = saved.position ?? 0;
    set({
      queue: saved.queue,
      original: saved.original,
      index,
      shuffle: saved.shuffle,
      repeat: saved.repeat,
      duration: saved.queue[index].duration,
      playing: false,
    });
    updateMetadata(saved.queue[index]);
  } catch {
    // Unreadable - start fresh.
  }
}

window.addEventListener('pagehide', () => save(true));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save(true);
});

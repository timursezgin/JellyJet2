import { create } from 'zustand';

import { useSession } from '@/auth/session';
import {
  imageUrl,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
  streamUrl,
} from '@/jellyfin/api';
import { isOnline } from '@/connectivity/connection';
import { isDownloaded } from '@/downloads/downloads';
import { offlineAudioPath } from '@/downloads/engine';
import { enqueue } from '@/offline/outbox';
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
  /** 0-1; only computers show a volume control (iPhones use their buttons). */
  volume: number;
  /**
   * Set while the music plays on another device and this one controls it:
   * the queue, index, playing, duration, shuffle and repeat above then mirror
   * that device, and the transport functions below send it commands.
   */
  remote: RemoteDevice | null;
  /** A song was sent here but iOS wants a tap before sound can start. */
  needsTap: boolean;
}

export interface RemoteDevice {
  sessionId: string;
  deviceId: string;
  deviceName: string;
}

/** What remote mode does instead of playing here (src/remote/remote.ts). */
export interface RemoteController {
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  seek(seconds: number): void;
  jumpTo(index: number): void;
  setShuffle(on: boolean): void;
  setRepeat(repeat: Repeat): void;
  playTracks(tracks: Track[], startIndex: number, shuffle: boolean): void;
  addToQueue(tracks: Track[]): void;
}

const VOLUME_KEY = 'jj.volume';

function savedVolume() {
  const value = Number(localStorage.getItem(VOLUME_KEY) ?? 1);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
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
  volume: savedVolume(),
  remote: null,
  needsTap: false,
}));

const get = usePlayer.getState;
const set = usePlayer.setState;

export const audio = new Audio();
audio.volume = get().volume;
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

// --- Listening activity ------------------------------------------------------

/**
 * `now`: something the listener did (play, pause, skip, seek, a queue change).
 * `tick`: a song carrying on playing (every few seconds). Opening the app or
 * bringing back a saved queue is neither, so it never counts as listening here.
 */
export type PlaybackActivity = 'now' | 'tick';
const activityListeners = new Set<(kind: PlaybackActivity) => void>();
let lastTick = 0;

/** Hear about listening on this device (the handoff note uses it). */
export function onPlaybackActivity(listener: (kind: PlaybackActivity) => void) {
  activityListeners.add(listener);
  return () => void activityListeners.delete(listener);
}

function activity(kind: PlaybackActivity) {
  // Controlling another device isn't listening here: that device keeps the note.
  if (get().queue.length === 0 || controller) return;
  for (const listener of activityListeners) listener(kind);
}

// --- Position updates -----------------------------------------------------------

const positionListeners = new Set<() => void>();

/**
 * Hear when the position may have changed (seeks, new songs, progress), here
 * or on the device being controlled. Between these, `currentPosition()` keeps
 * moving while `playing` is true.
 */
export function subscribePosition(listener: () => void) {
  positionListeners.add(listener);
  return () => void positionListeners.delete(listener);
}

function notifyPosition() {
  for (const listener of positionListeners) listener();
}

for (const event of ['timeupdate', 'seeked', 'loadedmetadata', 'emptied']) audio.addEventListener(event, notifyPosition);

// --- Remote mode --------------------------------------------------------------------

let controller: RemoteController | null = null;
/** The controlled device's position when last heard, and whether it's moving on from there. */
let remoteClock = { seconds: 0, at: 0, running: false };

/** Stop playing here without forgetting the queue (the music is moving elsewhere). */
function stopHere() {
  reportStopped();
  switchingTracks = false;
  audio.pause();
  if (audio.getAttribute('src')) {
    audio.removeAttribute('src');
    audio.load();
  }
  loadedUid = null;
}

/** Control another device from here: the music stops here and the player mirrors that device. */
export function enterRemoteMode(device: RemoteDevice, remoteController: RemoteController) {
  remoteClock = { seconds: currentPosition(), at: performance.now(), running: false };
  stopHere();
  controller = remoteController;
  set({ remote: device, playing: false, buffering: false, needsTap: false, original: null });
  notifyPosition();
}

/** Back to playing here; the queue stays as it last was there, paused at that spot. */
export function leaveRemoteMode() {
  if (!controller) return;
  restoredPosition = currentPosition();
  controller = null;
  set({ remote: null, playing: false, buffering: false });
  notifyPosition();
  save(true);
}

/** The controlled device's latest state (from the server's session updates). */
export function applyRemoteState(state: {
  queue?: QueueItem[];
  index: number;
  playing: boolean;
  duration: number;
  shuffle: boolean;
  repeat: Repeat;
  position: number;
}) {
  if (!controller) return;
  remoteClock = { seconds: state.position, at: performance.now(), running: state.playing };
  const { queue, ...rest } = state;
  set(queue ? { ...rest, queue, buffering: false } : { ...rest, buffering: false });
  notifyPosition();
}

/** Optimistic changes while a command is on its way (so a tap shows at once). */
export function nudgeRemoteState(change: { playing?: boolean; position?: number }) {
  if (!controller) return;
  const seconds = change.position ?? currentPosition();
  const running = change.playing ?? remoteClock.running;
  remoteClock = { seconds, at: performance.now(), running };
  if (change.playing !== undefined) set({ playing: change.playing });
  notifyPosition();
}

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
  if (controller) {
    const { seconds, at, running } = remoteClock;
    const now = running ? seconds + (performance.now() - at) / 1000 : seconds;
    const duration = get().duration;
    return duration > 0 ? Math.min(now, duration) : now;
  }
  return loadedUid ? audio.currentTime : restoredPosition;
}

function session() {
  const { client, session } = useSession.getState();
  return client && session ? { client, userId: session.userId } : null;
}

// --- Loading and transport ------------------------------------------------

/**
 * Where a song plays from: its downloaded copy when there is one (served by
 * the service worker, seekable, no data used), otherwise the server.
 * Worked out without waiting on anything, for the lock-screen rule above.
 */
function sourceFor(track: QueueItem, s: NonNullable<ReturnType<typeof session>>) {
  if (isDownloaded(track.id) && navigator.serviceWorker?.controller) return offlineAudioPath(track.id);
  return streamUrl(s.client, s.userId, track.id, playSessionId);
}

function load(index: number, { autoplay, startAt = 0 }: { autoplay: boolean; startAt?: number }) {
  const track = get().queue[index];
  const s = session();
  if (!track || !s) return;

  // Offline, only downloaded songs can play: move on to the next one that can.
  if (!isOnline() && !isDownloaded(track.id)) {
    const nextPlayable = get().queue.findIndex((t, i) => i > index && isDownloaded(t.id));
    if (nextPlayable >= 0) {
      load(nextPlayable, { autoplay, startAt: 0 });
    } else {
      if (autoplay) toast('Not downloaded - it needs a connection');
      set({ playing: false, buffering: false });
    }
    return;
  }

  reportStopped();
  playSessionId = randomId();
  reportedStart = false;
  lastProgressReport = 0;
  loadedUid = track.uid;
  restoredPosition = 0;
  pendingSeek = startAt > 0 ? startAt : null;

  set({ index, duration: track.duration, buffering: autoplay, playing: autoplay });
  switchingTracks = autoplay;
  audio.src = sourceFor(track, s);
  updateMetadata(track);
  if (autoplay) startPlayback();
  save(true);
}

function startPlayback() {
  // Tell the browser this is music playback (Audio Session API), so iOS
  // treats it like a music app's audio: plays with the silent switch on and
  // handles interruptions such as calls accordingly.
  const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (audioSession && audioSession.type !== 'playback') audioSession.type = 'playback';
  audio.play().catch((error: unknown) => {
    // Refused (e.g. no tap yet after launch) or interrupted by a newer load.
    if (error instanceof DOMException && error.name === 'AbortError') return;
    switchingTracks = false;
    // Refused for want of a tap (a song sent from another device): ask for one.
    const needsTap = error instanceof DOMException && error.name === 'NotAllowedError';
    set({ playing: false, buffering: false, needsTap });
    if (needsTap) reportWaiting();
  });
}

/** Replace the queue with these songs and start playing at `startIndex`. */
export function playTracks(tracks: Track[], startIndex = 0, options: { shuffle?: boolean } = {}) {
  if (tracks.length === 0) return;
  // Offline, the queue is just the songs that can play.
  if (!isOnline()) {
    const start = tracks[startIndex];
    tracks = tracks.filter((t) => isDownloaded(t.id));
    if (tracks.length === 0) {
      toast('None of these are downloaded');
      return;
    }
    startIndex = Math.max(0, tracks.indexOf(start));
  }
  const items = tracks.map(withUid);
  const shuffle = options.shuffle ?? get().shuffle;
  let order = items;
  if (shuffle) {
    const first = options.shuffle && startIndex === 0 ? items[Math.floor(Math.random() * items.length)] : items[startIndex];
    order = [first, ...shuffled(items.filter((item) => item !== first))];
  }
  // Controlling another device: the same queue starts there instead.
  if (controller) {
    controller.playTracks(order, shuffle ? 0 : startIndex, shuffle);
    return;
  }
  set(shuffle ? { queue: order, original: items, shuffle: true } : { queue: items, original: null, shuffle: false });
  errorStreak = 0;
  load(shuffle ? 0 : startIndex, { autoplay: true });
}

/**
 * Tapping a song that's already on doesn't start it over: playing, nothing
 * happens; paused, it carries on from where it was. Returns whether it was on.
 */
export function continueIfCurrent(id: string): boolean {
  if (currentTrack()?.id !== id) return false;
  if (!get().playing) play();
  return true;
}

export function play() {
  if (controller) {
    controller.play();
    return;
  }
  set({ needsTap: false });
  const track = currentTrack();
  if (!track) return;
  if (loadedUid !== track.uid) {
    load(get().index, { autoplay: true, startAt: restoredPosition });
    return;
  }
  set({ playing: true });
  startPlayback();
}

export function pause() {
  if (controller) {
    controller.pause();
    return;
  }
  switchingTracks = false;
  audio.pause();
  set({ playing: false });
}

export function togglePlay() {
  if (get().playing) pause();
  else play();
}

export function next() {
  if (controller) {
    controller.next();
    return;
  }
  const { queue, index, repeat } = get();
  if (queue.length === 0) return;
  if (index + 1 < queue.length) load(index + 1, { autoplay: true });
  else if (repeat === 'all') load(0, { autoplay: true });
  else load(0, { autoplay: false });
}

export function previous() {
  if (controller) {
    controller.previous();
    return;
  }
  const { index } = get();
  if (currentPosition() > 3 || index === 0) {
    seek(0);
    return;
  }
  load(index - 1, { autoplay: true });
}

export function seek(seconds: number) {
  if (controller) {
    controller.seek(Math.max(0, seconds));
    return;
  }
  const track = currentTrack();
  if (!track) return;
  if (loadedUid !== track.uid) {
    restoredPosition = Math.max(0, seconds);
    notifyPosition();
    return;
  }
  audio.currentTime = Math.max(0, seconds);
  reportProgress(true);
  activity('now');
}

export function jumpTo(index: number) {
  if (index < 0 || index >= get().queue.length) return;
  if (controller) {
    controller.jumpTo(index);
    return;
  }
  load(index, { autoplay: true });
}

export function setShuffle(on: boolean) {
  if (controller) {
    controller.setShuffle(on);
    return;
  }
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
  reportProgress(true);
  activity('now');
}

/** Shuffle on without reordering: the queue arrived already shuffled (from another device). */
export function markShuffled(on: boolean) {
  set({ shuffle: on, original: null });
  save(true);
  reportProgress(true);
}

export function setRepeat(repeat: Repeat) {
  if (controller) {
    controller.setRepeat(repeat);
    return;
  }
  set({ repeat });
  save(true);
  reportProgress(true);
  activity('now');
}

export function cycleRepeat() {
  const order: Repeat[] = ['off', 'all', 'one'];
  setRepeat(order[(order.indexOf(get().repeat) + 1) % order.length]);
}

export function addToQueue(tracks: Track[]) {
  if (controller) {
    controller.addToQueue(tracks);
    return;
  }
  const items = tracks.map(withUid);
  set((s) => ({
    queue: [...s.queue, ...items],
    original: s.original ? [...s.original, ...items] : null,
  }));
  if (get().queue.length === items.length) load(0, { autoplay: false });
  save(true);
  reportProgress(true);
  activity('now');
}

/** Put songs straight after the one that's on (sent by another device's "play next"). */
export function playNext(tracks: Track[]) {
  if (controller || tracks.length === 0) return;
  const { queue, original, index } = get();
  if (queue.length === 0) {
    addToQueue(tracks);
    return;
  }
  const items = tracks.map(withUid);
  const current = queue[index];
  const nextQueue = [...queue.slice(0, index + 1), ...items, ...queue.slice(index + 1)];
  const at = original ? original.indexOf(current) + 1 : -1;
  set({
    queue: nextQueue,
    original: original ? [...original.slice(0, at), ...items, ...original.slice(at)] : null,
  });
  save(true);
  reportProgress(true);
  activity('now');
}

export function removeFromQueue(index: number) {
  // Another device's queue is shown, not edited (the queue list hides these controls).
  if (controller) return;
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
  reportProgress(true);
  activity('now');
}

export function moveInQueue(from: number, to: number) {
  if (controller) return;
  const { queue, index } = get();
  if (from === to || !queue[from] || to < 0 || to >= queue.length) return;
  const current = queue[index];
  const nextQueue = [...queue];
  const [moved] = nextQueue.splice(from, 1);
  nextQueue.splice(to, 0, moved);
  set({ queue: nextQueue, index: nextQueue.indexOf(current) });
  save(true);
  reportProgress(true);
  activity('now');
}

export function clearQueue() {
  leaveRemoteMode();
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

/** The volume before muting, so unmuting goes back to it. */
let volumeBeforeMute = 1;

export function setVolume(volume: number) {
  const value = Math.min(1, Math.max(0, volume));
  audio.volume = value;
  set({ volume: value });
  try {
    localStorage.setItem(VOLUME_KEY, String(value));
  } catch {
    // Storage full; the volume just won't be remembered.
  }
}

export function toggleMute() {
  const { volume } = get();
  if (volume > 0) {
    volumeBeforeMute = volume;
    setVolume(0);
  } else {
    setVolume(volumeBeforeMute || 1);
  }
}

/**
 * Take over a queue from another device (the handoff offer): the same songs,
 * shuffle and repeat, starting at `index` from `position` seconds. Called
 * straight from the Continue tap, so iOS lets it start playing.
 */
export function resumeQueue(tracks: Track[], index: number, position: number, options: { shuffle: boolean; repeat: Repeat }) {
  if (tracks.length === 0) return;
  // The music comes here, so this device stops controlling another one.
  leaveRemoteMode();
  const items = tracks.map(withUid);
  const start = Math.min(Math.max(0, index), items.length - 1);
  errorStreak = 0;
  set({ queue: items, original: null, index: start, shuffle: options.shuffle, repeat: options.repeat });
  load(start, { autoplay: true, startAt: position });
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
  set({ playing: true, buffering: false, needsTap: false });
  if (!reportedStart) {
    reportedStart = true;
    const track = currentTrack();
    const s = session();
    if (track && s) {
      reportPlaybackStart(s.client, { itemId: track.id, playSessionId, positionSeconds: audio.currentTime, ...stateReport() });
    }
  } else {
    reportProgress(true);
  }
  syncMediaSession();
  activity('now');
});

audio.addEventListener('pause', () => {
  // Stopping here to control another device isn't a pause of the music.
  if (audio.ended || switchingTracks || controller) return;
  set({ playing: false, buffering: false });
  reportProgress(true);
  syncMediaSession();
  save(true);
  activity('now');
});

audio.addEventListener('waiting', () => {
  if (!controller) set({ buffering: true });
});

audio.addEventListener('loadedmetadata', () => {
  if (pendingSeek !== null) {
    audio.currentTime = pendingSeek;
    pendingSeek = null;
  }
});

audio.addEventListener('durationchange', () => {
  if (controller) return;
  if (Number.isFinite(audio.duration) && audio.duration > 0) set({ duration: audio.duration });
  syncMediaSession();
});

audio.addEventListener('timeupdate', () => {
  if (!loadedUid) return;
  const now = performance.now();
  if (now - lastProgressReport > 10_000) reportProgress(false);
  if (now - lastSaved > 5_000) save(false);
  if (!audio.paused && now - lastTick > 5_000) {
    lastTick = now;
    activity('tick');
  }
});

audio.addEventListener('seeked', syncMediaSession);

audio.addEventListener('ended', () => {
  const { queue, index, repeat } = get();
  // Offline plays still count: Jellyfin hears about them once reachable.
  const finished = currentTrack();
  if (finished && !isOnline()) enqueue({ kind: 'played', itemId: finished.id, date: new Date().toISOString() });
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
  reportPlaybackProgress(s.client, {
    itemId: track.id,
    playSessionId,
    positionSeconds: audio.currentTime,
    paused: audio.paused,
    ...stateReport(),
  });
}

/**
 * A song sent here is waiting for a tap (iOS won't start sound without one):
 * tell the server it's here, paused, so the device that sent it shows the
 * song and the queue rather than nothing.
 */
function reportWaiting() {
  const track = currentTrack();
  const s = session();
  if (!track || !s || reportedStart) return;
  reportPlaybackProgress(s.client, {
    itemId: track.id,
    playSessionId,
    positionSeconds: pendingSeek ?? audio.currentTime,
    paused: true,
    ...stateReport(),
  });
}

/**
 * Repeat, shuffle and which entry is on, so a device controlling this one can
 * show them. (The queue itself reaches it through the playback note, handoff.ts.)
 */
function stateReport() {
  const { queue, index, repeat, shuffle } = get();
  return {
    repeatMode: repeat === 'all' ? ('RepeatAll' as const) : repeat === 'one' ? ('RepeatOne' as const) : ('RepeatNone' as const),
    shuffle,
    entryId: queue[index]?.uid,
  };
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
        playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime, duration),
      });
    } catch {
      // Some browsers reject position state mid-load; the next event retries.
    }
  }
}

/**
 * Which lock-screen buttons exist. Re-sent every time a song starts: iOS
 * forgets a list given before any audio has played and falls back to its
 * video-style skip-15-seconds buttons.
 *
 * Known iOS limit for home-screen web apps: once paused with the screen off,
 * iOS suspends the app within moments and gives the lock-screen player to
 * another app, so resuming from the lock screen needs the app opened again.
 */
function registerRemoteCommands() {
  if (!('mediaSession' in navigator)) return;
  const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
    ['play', () => play()],
    ['pause', () => pause()],
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

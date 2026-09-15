import { create } from 'zustand';

import { useSession } from '@/auth/session';
import {
  remoteCommand,
  remotePlay,
  remotePlaystate,
  sameId,
  sessions as fetchSessions,
  ticksToSeconds,
  type RemotePlaystate,
  type SessionInfo,
} from '@/jellyfin/api';
import { CLIENT_NAME, deviceId } from '@/jellyfin/identity';
import {
  applyRemoteState,
  currentPosition,
  enterRemoteMode,
  leaveRemoteMode,
  nudgeRemoteState,
  resumeQueue,
  usePlayer,
  type QueueItem,
  type RemoteController,
  type RemoteDevice,
  type Repeat,
} from '@/player/player';
import { trackFromItem, type Track } from '@/player/track';
import { lookUpTracks } from '@/player/track-lookup';
import { toast } from '@/ui/toast';
import { onSocketMessage, subscribeSessions, useSocket } from './socket';

/**
 * Playing on another device (like Spotify Connect). The "Play on" list shows
 * JellyJet open on this account's other devices. Choosing one sends it this
 * queue from the same spot and turns this device into its remote: the player
 * shows that device's song, and play/pause, skip, seek, shuffle and repeat
 * control it. Choosing "This device" brings the music back.
 */

/** How many songs of a queue go with a "play these" command (it travels in the address). */
const SENT_QUEUE = 200;
/** A controlled device missing from the account's sessions this long counts as gone. */
const GONE_AFTER_MS = 10_000;

interface DevicesState {
  /** JellyJet on this account's other devices that can take commands right now. */
  devices: SessionInfo[];
  loaded: boolean;
}

export const useDevices = create<DevicesState>(() => ({ devices: [], loaded: false }));

function account() {
  const { client, session } = useSession.getState();
  return client && session ? { client, userId: session.userId } : null;
}

/** The signed-in account's id: devices and commands never cross accounts. */
const myUserId = () => useSession.getState().session?.userId;

/**
 * JellyJet on another device signed in to this same account. Jellyfin lists
 * other accounts' sessions too (an admin may control them), so the account
 * check matters: nobody sees or controls anyone else's music.
 */
const isMine = (s: SessionInfo) => {
  const me = myUserId();
  return !!me && !!s.UserId && sameId(s.UserId, me);
};

const isOtherJellyJet = (s: SessionInfo) =>
  s.Client === CLIENT_NAME && isMine(s) && s.DeviceId !== deviceId() && s.SupportsRemoteControl === true;

/** Look up the account's devices now (also used by the handoff to pause the other device). */
export async function refreshDevices(): Promise<SessionInfo[]> {
  const a = account();
  if (!a) return [];
  try {
    const all = await fetchSessions(a.client, a.userId);
    const devices = all.filter(isOtherJellyJet);
    useDevices.setState({ devices, loaded: true });
    onSessions(all);
    return devices;
  } catch {
    useDevices.setState({ loaded: true });
    return useDevices.getState().devices;
  }
}

/** Continuing here from the handoff card: the device the note came from pauses, if it's still playing. */
export async function pauseDevice(targetDeviceId: string) {
  const a = account();
  if (!a) return;
  const devices = await refreshDevices();
  const target = devices.find((d) => d.DeviceId === targetDeviceId);
  if (target?.NowPlayingItem && !target.PlayState?.IsPaused) {
    await remotePlaystate(a.client, target.Id, 'Pause').catch(() => {});
  }
}

// --- Mirroring the controlled device ------------------------------------------------

const REPEAT: Record<string, Repeat> = { RepeatNone: 'off', RepeatAll: 'all', RepeatOne: 'one' };
const repeatMode = (repeat: Repeat) => (repeat === 'all' ? 'RepeatAll' : repeat === 'one' ? 'RepeatOne' : 'RepeatNone');

/** Songs already looked up, so a queue update doesn't fetch them again. */
const trackCache = new Map<string, Track>();
let mirroredQueueKey = '';
let lastHeard = { ticks: -1, paused: true, entry: '' };
let missingSince = 0;

function onSessions(all: SessionInfo[]) {
  const remote = usePlayer.getState().remote;
  if (!remote) return;
  const session = all.find((s) => s.DeviceId === remote.deviceId && isMine(s) && s.SupportsRemoteControl);
  if (!session) {
    missingSince ||= Date.now();
    if (Date.now() - missingSince > GONE_AFTER_MS) {
      toast(`Lost touch with ${remote.deviceName}`);
      stopControlling();
    }
    return;
  }
  missingSince = 0;
  void mirror(session);
}

async function mirror(session: SessionInfo) {
  const item = session.NowPlayingItem;
  const state = session.PlayState ?? {};
  const { remote } = usePlayer.getState();
  if (!remote) return;
  if (remote.sessionId !== session.Id) usePlayer.setState({ remote: { ...remote, sessionId: session.Id } });

  const repeat = REPEAT[state.RepeatMode ?? 'RepeatNone'] ?? 'off';
  const shuffle = state.PlaybackOrder === 'Shuffle';

  if (!item) {
    // Open there, but nothing loaded: show the queue as it was, paused.
    applyRemoteState({ index: usePlayer.getState().index, playing: false, duration: usePlayer.getState().duration, shuffle, repeat, position: currentPosition() });
    return;
  }

  const entries = session.NowPlayingQueue?.length
    ? session.NowPlayingQueue
    : [{ Id: item.Id, PlaylistItemId: session.PlaylistItemId ?? item.Id }];
  const entryKey = (e: { Id: string; PlaylistItemId?: string }, i: number) => e.PlaylistItemId ?? `${e.Id}:${i}`;
  let index = entries.findIndex((e) => session.PlaylistItemId && e.PlaylistItemId === session.PlaylistItemId);
  if (index < 0) index = Math.max(0, entries.findIndex((e) => e.Id === item.Id));

  const ticks = state.PositionTicks ?? 0;
  const paused = state.IsPaused ?? false;
  const entry = entryKey(entries[index], index);
  // A session update can repeat an old position (it came for another reason):
  // only a changed report moves the clock; otherwise it keeps running from here.
  const changed = ticks !== lastHeard.ticks || paused !== lastHeard.paused || entry !== lastHeard.entry;
  lastHeard = { ticks, paused, entry };
  const position = changed ? ticksToSeconds(ticks) : currentPosition();
  const duration = ticksToSeconds(item.RunTimeTicks) || usePlayer.getState().duration;

  const queueKey = entries.map(entryKey).join(',');
  if (queueKey === mirroredQueueKey) {
    applyRemoteState({ index, playing: !paused, duration, shuffle, repeat, position });
    return;
  }

  trackCache.set(item.Id, trackFromItem(item));
  const missing = entries.map((e) => e.Id).filter((id) => !trackCache.has(id));
  if (missing.length) {
    try {
      for (const [id, track] of await lookUpTracks(missing)) trackCache.set(id, track);
    } catch {
      // Shown with what's known; the next update tries again.
    }
  }
  if (!usePlayer.getState().remote) return;
  const queue: QueueItem[] = [];
  let mirroredIndex = 0;
  entries.forEach((e, i) => {
    const track = trackCache.get(e.Id);
    if (!track) return;
    if (i === index) mirroredIndex = queue.length;
    queue.push({ ...track, uid: entryKey(e, i) });
  });
  mirroredQueueKey = queueKey;
  applyRemoteState({ queue, index: mirroredIndex, playing: !paused, duration, shuffle, repeat, position });
}

// --- Sending commands -----------------------------------------------------------------

function target() {
  const a = account();
  const remote = usePlayer.getState().remote;
  return a && remote ? { ...a, remote } : null;
}

function failed(name: string) {
  toast(`Couldn’t reach ${name}`);
}

function playstate(command: RemotePlaystate, seconds?: number) {
  const t = target();
  if (!t) return;
  remotePlaystate(t.client, t.remote.sessionId, command, seconds).catch(() => failed(t.remote.deviceName));
}

/** Send a queue to a session, with repeat and shuffle, starting at `index`, `position` in. */
async function sendQueue(sessionId: string, tracks: { id: string }[], index: number, position: number, shuffle: boolean, repeat: Repeat) {
  const a = account();
  if (!a) throw new Error('signed out');
  const start = Math.max(0, Math.min(index - 50, tracks.length - SENT_QUEUE));
  const ids = tracks.slice(start, start + SENT_QUEUE).map((t) => t.id);
  await remotePlay(a.client, sessionId, 'PlayNow', ids, index - start, position);
  await remoteCommand(a.client, sessionId, 'SetRepeatMode', { RepeatMode: repeatMode(repeat) });
  // Already in shuffled order: the other device just marks shuffle as on.
  await remoteCommand(a.client, sessionId, 'SetShuffleQueue', { ShuffleMode: shuffle ? 'Shuffle' : 'Sorted', KeepOrder: 'true' });
}

const controller: RemoteController = {
  play() {
    nudgeRemoteState({ playing: true });
    playstate('Unpause');
  },
  pause() {
    nudgeRemoteState({ playing: false });
    playstate('Pause');
  },
  next() {
    playstate('NextTrack');
  },
  previous() {
    playstate('PreviousTrack');
  },
  seek(seconds) {
    nudgeRemoteState({ position: seconds });
    playstate('Seek', seconds);
  },
  jumpTo(index) {
    const t = target();
    if (!t) return;
    const { queue, shuffle, repeat } = usePlayer.getState();
    sendQueue(t.remote.sessionId, queue, index, 0, shuffle, repeat).catch(() => failed(t.remote.deviceName));
  },
  setShuffle(on) {
    const t = target();
    if (!t) return;
    usePlayer.setState({ shuffle: on });
    remoteCommand(t.client, t.remote.sessionId, 'SetShuffleQueue', { ShuffleMode: on ? 'Shuffle' : 'Sorted' }).catch(() =>
      failed(t.remote.deviceName),
    );
  },
  setRepeat(repeat) {
    const t = target();
    if (!t) return;
    usePlayer.setState({ repeat });
    remoteCommand(t.client, t.remote.sessionId, 'SetRepeatMode', { RepeatMode: repeatMode(repeat) }).catch(() =>
      failed(t.remote.deviceName),
    );
  },
  playTracks(tracks, startIndex, shuffle) {
    const t = target();
    if (!t) return;
    sendQueue(t.remote.sessionId, tracks, startIndex, 0, shuffle, usePlayer.getState().repeat).catch(() =>
      failed(t.remote.deviceName),
    );
  },
  addToQueue(tracks) {
    const t = target();
    if (!t) return;
    remotePlay(
      t.client,
      t.remote.sessionId,
      'PlayLast',
      tracks.map((track) => track.id),
    ).catch(() => failed(t.remote.deviceName));
  },
};

// --- Choosing where to play ----------------------------------------------------------

function startControlling(device: RemoteDevice) {
  mirroredQueueKey = '';
  lastHeard = { ticks: -1, paused: true, entry: '' };
  missingSince = 0;
  enterRemoteMode(device, controller);
  watchWhileControlling();
}

function stopControlling() {
  unwatch?.();
  unwatch = null;
  leaveRemoteMode();
}

/** Play on another device: this queue, from the same spot; this device becomes its remote. */
export async function playOn(session: SessionInfo) {
  const a = account();
  if (!a) return;
  const { queue, index, shuffle, repeat, playing, remote: previous } = usePlayer.getState();
  const position = currentPosition();
  const device: RemoteDevice = { sessionId: session.Id, deviceId: session.DeviceId, deviceName: session.DeviceName };

  // Music stops here straight away (or on the device controlled until now).
  startControlling(device);
  if (queue.length === 0) {
    void refreshDevices();
    return;
  }
  nudgeRemoteState({ playing: true, position });
  try {
    await sendQueue(session.Id, queue, index, position, shuffle, repeat);
    if (previous && previous.deviceId !== session.DeviceId) {
      await remotePlaystate(a.client, previous.sessionId, 'Pause').catch(() => {});
    }
    if (!playing && !previous) {
      // It was paused here: it arrives paused there too.
      await remotePlaystate(a.client, session.Id, 'Pause').catch(() => {});
      nudgeRemoteState({ playing: false });
    }
  } catch {
    failed(session.DeviceName);
    stopControlling();
  }
}

/** Bring the music back to this device, from where it is on the other one. */
export function playHere() {
  const t = target();
  const { queue, index, shuffle, repeat, playing } = usePlayer.getState();
  if (!t) return;
  const position = currentPosition();
  remotePlaystate(t.client, t.remote.sessionId, 'Pause').catch(() => {});
  stopControlling();
  if (playing && queue.length > 0) resumeQueue(queue, index, position, { shuffle, repeat });
}

// --- Keeping up with the other devices ------------------------------------------------

let unwatch: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | undefined;

/** While controlling: session updates pushed over the live connection, or asked for every few seconds without one. */
function watchWhileControlling() {
  unwatch?.();
  const offPush = subscribeSessions(() => {});
  void refreshDevices();
  pollTimer = setInterval(() => {
    if (!useSocket.getState().connected) void refreshDevices();
  }, 3000);
  unwatch = () => {
    offPush();
    clearInterval(pollTimer);
  };
}

/** The "Play on" list is open: keep it up to date. Returns a stop function. */
export function watchDevices() {
  const offPush = subscribeSessions(() => {});
  void refreshDevices();
  return offPush;
}

/** While signed in: apply pushed session updates. Returns a stop function. */
export function startRemote() {
  const off = onSocketMessage((message) => {
    if (message.MessageType !== 'Sessions' || !Array.isArray(message.Data)) return;
    const all = message.Data as SessionInfo[];
    useDevices.setState({ devices: all.filter(isOtherJellyJet), loaded: true });
    onSessions(all);
  });
  return () => {
    off();
    if (usePlayer.getState().remote) stopControlling();
    useDevices.setState({ devices: [], loaded: false });
  };
}

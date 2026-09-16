import { create } from 'zustand';

import { useSession } from '@/auth/session';
import { onReconnect } from '@/connectivity/connection';
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
import { readPlaybackNote } from '@/player/playback-note';
import { trackFromItem, type Track } from '@/player/track';
import { lookUpTracks } from '@/player/track-lookup';
import { toast } from '@/ui/toast';
import { onSocketMessage, subscribeSessions, useSocket } from './socket';

/**
 * Playing on another device (like Spotify Connect), with one rule: an account
 * plays in one place at a time.
 *
 * Every open JellyJet keeps an eye on the account's other devices. When one of
 * them is playing, this device follows it as its remote: the player shows that
 * device's song and queue, and play/pause, skip, seek, shuffle and repeat
 * control it. Music starting here pauses any other device. The "Play on" list
 * moves the music, queue included: choosing a device sends it this queue from
 * the same spot; "This device" brings it back here.
 */

/** How many songs of a queue go with a "play these" command (it travels in the address). */
const SENT_QUEUE = 200;
/** A controlled device missing from the account's sessions this long counts as gone. */
const GONE_AFTER_MS = 10_000;
/** Between songs a device briefly reports nothing playing; only this long counts as stopped. */
const EMPTY_GRACE_MS = 5_000;
/** A device just told to pause (or given the music) can still look like it's playing for a moment. */
const SETTLE_MS = 8_000;
/** A device sent music that hasn't started it by now didn't get it. */
const START_TIMEOUT_MS = 12_000;
/** A "playing" device whose last report is this much older than the newest isn't followed. */
const STALE_REPORT_MS = 60_000;
/** A followed device told to play that hasn't started by now isn't really there. */
const WAKE_TIMEOUT_MS = 8_000;
/** After a report, the device's note is read this long later (it writes it a second after a change)... */
const NOTE_DELAY_MS = 1_800;
/** ...and at most this often. */
const NOTE_GAP_MS = 3_000;

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

const isPlayingThere = (s: SessionInfo) => !!s.NowPlayingItem && s.PlayState?.IsPaused !== true;

/** Devices told to pause, until their reports catch up (device id → until). */
const settling = new Map<string, number>();
const settle = (id: string) => settling.set(id, Date.now() + SETTLE_MS);
const isSettling = (id: string) => (settling.get(id) ?? 0) > Date.now();

let refreshing: Promise<SessionInfo[]> | null = null;
let lastRefresh = 0;

/** Look up the account's devices now (also used by the handoff to pause the other device). */
export function refreshDevices(): Promise<SessionInfo[]> {
  const a = account();
  if (!a) return Promise.resolve([]);
  refreshing ??= (async () => {
    try {
      const all = await fetchSessions(a.client, a.userId);
      lastRefresh = Date.now();
      onSessions(all);
      return useDevices.getState().devices;
    } catch {
      useDevices.setState({ loaded: true });
      return useDevices.getState().devices;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Continuing here from the handoff card: the device the note came from pauses, if it's still playing. */
export async function pauseDevice(targetDeviceId: string) {
  const a = account();
  if (!a) return;
  const devices = await refreshDevices();
  const target = devices.find((d) => d.DeviceId === targetDeviceId);
  if (target && isPlayingThere(target)) {
    settle(target.DeviceId);
    await remotePlaystate(a.client, target.Id, 'Pause').catch(() => {});
  }
}

let lastAll: SessionInfo[] = [];

/** The account's sessions as last heard (pushed over the live connection, or asked for). */
function onSessions(all: SessionInfo[]) {
  lastAll = all;
  const devices = all.filter(isOtherJellyJet);
  useDevices.setState({ devices, loaded: true });
  followRemote(all);
  followPlayback(devices, all);
}

// --- One place at a time ------------------------------------------------------------

/** Music is on (or about to be) on this device itself. */
function busyHere() {
  const { remote, playing, buffering, needsTap } = usePlayer.getState();
  return !remote && (playing || buffering || needsTap);
}

/**
 * Another device is playing and this one isn't: follow it as its remote, so
 * the play button here controls that music instead of starting a second one.
 */
function followPlayback(devices: SessionInfo[], all: SessionInfo[]) {
  if (busyHere()) return;
  const { remote } = usePlayer.getState();
  const current = remote ? devices.find((d) => d.DeviceId === remote.deviceId) : undefined;
  if (current && isPlayingThere(current)) return;
  // Only devices that reported just now: a session left behind by an app that
  // was killed can still say it's playing. "Now" comes from the newest activity
  // the server itself has recorded (this device's own requests keep it current),
  // so the server's clock is compared with its own.
  const newest = Math.max(0, ...all.map(lastActive));
  const playing = devices
    .filter(
      (d) =>
        isPlayingThere(d) &&
        !isSettling(d.DeviceId) &&
        d.DeviceId !== remote?.deviceId &&
        (checkIn(d) === 0 || checkIn(d) > newest - STALE_REPORT_MS),
    )
    .sort((a, b) => checkIn(b) - checkIn(a));
  const target = playing[0];
  if (!target) return;
  startControlling({ sessionId: target.Id, deviceId: target.DeviceId, deviceName: target.DeviceName });
  void mirror(target);
}

const checkIn = (s: SessionInfo) => Date.parse(s.LastPlaybackCheckIn ?? s.LastActivityDate ?? '') || 0;
const lastActive = (s: SessionInfo) => Math.max(checkIn(s), Date.parse(s.LastActivityDate ?? '') || 0);

/** Music started on this device: any other device of the account that's playing pauses. */
function claimPlayback() {
  const a = account();
  if (!a) return;
  for (const d of useDevices.getState().devices) {
    if (!isPlayingThere(d) || isSettling(d.DeviceId)) continue;
    settle(d.DeviceId);
    remotePlaystate(a.client, d.Id, 'Pause').catch(() => {});
  }
}

// --- Mirroring the controlled device ------------------------------------------------

const REPEAT: Record<string, Repeat> = { RepeatNone: 'off', RepeatAll: 'all', RepeatOne: 'one' };
const repeatMode = (repeat: Repeat) => (repeat === 'all' ? 'RepeatAll' : repeat === 'one' ? 'RepeatOne' : 'RepeatNone');

/** Songs already looked up, so a queue update doesn't fetch them again. */
const trackCache = new Map<string, Track>();
/** The queue as last read from the controlled device's note (`at` 0: the songs just sent to it). */
let note: { ids: string[]; index: number; at: number } | null = null;
/** The queue shown: which ids it was built from, and where each of them ended up. */
let mirrored = { key: '', map: [] as number[] };
let lastHeard = { ticks: -1, paused: true, entry: '' };
let missingSince = 0;
let emptySince = 0;
/** Songs were just sent to the controlled device: its reports only count once it has this song on. */
let awaiting: { itemId: string; since: number; onTimeout?: () => void } | null = null;

function followRemote(all: SessionInfo[]) {
  const { remote, playing } = usePlayer.getState();
  if (!remote) return;
  const session = all.find((s) => s.DeviceId === remote.deviceId && isMine(s) && s.SupportsRemoteControl);
  if (!session) {
    missingSince ||= Date.now();
    if (Date.now() - missingSince > GONE_AFTER_MS) {
      // A paused phone going to sleep is expected; music vanishing isn't.
      if (playing) toast(`Lost touch with ${remote.deviceName}`);
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

  if (awaiting) {
    if (item && item.Id === awaiting.itemId) {
      awaiting = null;
    } else if (Date.now() - awaiting.since > START_TIMEOUT_MS) {
      const { onTimeout } = awaiting;
      awaiting = null;
      onTimeout?.();
      return;
    } else {
      // Still showing what it had before the songs arrived.
      return;
    }
  }

  const repeat = REPEAT[state.RepeatMode ?? 'RepeatNone'] ?? 'off';
  const shuffle = state.PlaybackOrder === 'Shuffle';

  if (!item) {
    // Between two songs for a moment; for longer, it's stopped: the queue stays as it was, paused.
    emptySince ||= Date.now();
    if (Date.now() - emptySince < EMPTY_GRACE_MS) return;
    const now = usePlayer.getState();
    applyRemoteState({ index: now.index, playing: false, duration: now.duration, shuffle, repeat, position: currentPosition() });
    return;
  }
  emptySince = 0;

  const source = queueSource(item.Id);
  const ticks = state.PositionTicks ?? 0;
  const paused = state.IsPaused ?? false;
  const entry = `${session.PlaylistItemId ?? ''}:${item.Id}`;
  // A session update can repeat an old position (it came for another reason):
  // only a changed report moves the clock; otherwise it keeps running from here.
  const changed = ticks !== lastHeard.ticks || paused !== lastHeard.paused || entry !== lastHeard.entry;
  lastHeard = { ticks, paused, entry };
  const position = changed ? ticksToSeconds(ticks) : currentPosition();
  const duration = ticksToSeconds(item.RunTimeTicks) || usePlayer.getState().duration;

  // That device reports when something changes there (a new song, a pause, a
  // queue edit) and rewrites its note just after: look at the note again soon.
  if (changed || !source.fromNote) scheduleNoteRead();

  if (source.key === mirrored.key) {
    applyRemoteState({ index: queueIndexOf(source.index), playing: !paused, duration, shuffle, repeat, position });
    return;
  }

  if (!trackCache.has(item.Id)) trackCache.set(item.Id, trackFromItem(item));
  const missing = source.ids.filter((id) => !trackCache.has(id));
  let complete = true;
  if (missing.length) {
    try {
      const found = await lookUpTracks(missing);
      for (const [id, track] of found) trackCache.set(id, track);
    } catch {
      // Shown with what's known for now; the next update looks the rest up again.
      complete = false;
    }
  }
  if (!usePlayer.getState().remote || queueSource(item.Id).key !== source.key) return;
  const queue: QueueItem[] = [];
  const map: number[] = [];
  source.ids.forEach((id, i) => {
    const track = trackCache.get(id);
    map.push(track ? queue.length : -1);
    if (track) queue.push({ ...track, uid: `m${i}-${id}` });
  });
  mirrored = { key: complete ? source.key : '', map };
  applyRemoteState({ queue, index: queueIndexOf(source.index), playing: !paused, duration, shuffle, repeat, position });
}

/**
 * The controlled device's queue: from its playback note (or the songs just
 * sent to it), around the song it has on. Until a note that has that song
 * arrives, just the song.
 */
function queueSource(itemId: string) {
  if (note) {
    const index = nearest(note.ids, itemId, note.index);
    if (index >= 0) return { key: note.ids.join(','), ids: note.ids, index, fromNote: true };
  }
  return { key: itemId, ids: [itemId], index: 0, fromNote: false };
}

/** The position of `id` in `ids` closest to `hint` (a song can be queued twice), or -1. */
function nearest(ids: string[], id: string, hint: number) {
  for (let d = 0; d < ids.length; d++) {
    if (ids[hint + d] === id) return hint + d;
    if (d > 0 && ids[hint - d] === id) return hint - d;
  }
  return -1;
}

/** Where a note entry sits in the queue as mirrored (songs no longer in the library are left out). */
function queueIndexOf(sourceIndex: number) {
  const at = mirrored.map[sourceIndex];
  return at !== undefined && at >= 0 ? at : usePlayer.getState().index;
}

// --- The controlled device's queue, from its playback note ------------------------------

let noteTimer: ReturnType<typeof setTimeout> | undefined;
let lastNoteRead = 0;

function scheduleNoteRead() {
  if (noteTimer !== undefined) return;
  const delay = Math.max(NOTE_DELAY_MS, NOTE_GAP_MS - (Date.now() - lastNoteRead));
  noteTimer = setTimeout(() => {
    noteTimer = undefined;
    void readNote();
  }, delay);
}

async function readNote() {
  const a = account();
  if (!a || !usePlayer.getState().remote || document.visibilityState !== 'visible') return;
  lastNoteRead = Date.now();
  try {
    const { note: read } = await readPlaybackNote(a.client, a.userId);
    const remote = usePlayer.getState().remote;
    // Only the followed device's own note; another device's is an older story.
    if (!read || !remote || read.device !== remote.deviceId || read.at === note?.at) return;
    // Never back to an older queue (e.g. that device's note from before songs were sent to it).
    if (note && read.at < note.at - 5_000) return;
    note = { ids: read.ids, index: read.index, at: read.at };
    const session = lastAll.find((s) => s.DeviceId === remote.deviceId && isMine(s));
    if (session) void mirror(session);
  } catch {
    // Unreachable for now; the next report from that device tries again.
  }
}

function forgetNote() {
  clearTimeout(noteTimer);
  noteTimer = undefined;
  note = null;
  mirrored = { key: '', map: [] };
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
async function sendQueue(
  sessionId: string,
  tracks: { id: string }[],
  index: number,
  position: number,
  shuffle: boolean,
  repeat: Repeat,
  onTimeout?: () => void,
) {
  const a = account();
  if (!a) throw new Error('signed out');
  const start = Math.max(0, Math.min(index - 50, tracks.length - SENT_QUEUE));
  const ids = tracks.slice(start, start + SENT_QUEUE).map((t) => t.id);
  awaiting = { itemId: tracks[index].id, since: Date.now(), onTimeout };
  // Its queue is these songs until its own note says otherwise.
  note = { ids, index: index - start, at: Date.now() };
  mirrored = { key: '', map: [] };
  await remotePlay(a.client, sessionId, 'PlayNow', ids, index - start, position);
  await remoteCommand(a.client, sessionId, 'SetRepeatMode', { RepeatMode: repeatMode(repeat) });
  // Already in shuffled order: the other device just marks shuffle as on.
  await remoteCommand(a.client, sessionId, 'SetShuffleQueue', { ShuffleMode: shuffle ? 'Shuffle' : 'Sorted', KeepOrder: 'true' });
}

const controller: RemoteController = {
  play() {
    nudgeRemoteState({ playing: true });
    playstate('Unpause');
    watchItResponds(true);
  },
  pause() {
    nudgeRemoteState({ playing: false });
    playstate('Pause');
    watchItResponds(false);
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

/**
 * Play or pause was pressed for the device being followed. If it hasn't done
 * as asked by now, it isn't really there - an app that was killed (or a laptop
 * that slept) can leave a session behind that still looks alive - so the music
 * comes back to this device rather than going nowhere.
 */
function watchItResponds(asked: boolean) {
  clearTimeout(wakeTimer);
  const device = usePlayer.getState().remote;
  if (!device) return;
  wakeTimer = setTimeout(() => {
    const { remote, queue, index, shuffle, repeat } = usePlayer.getState();
    if (!remote || remote.deviceId !== device.deviceId) return;
    const session = lastAll.find((x) => x.DeviceId === device.deviceId);
    if (!session || isPlayingThere(session) === asked) return;
    toast(`${device.deviceName} isn’t answering - the music is back here`);
    const position = currentPosition();
    stopControlling();
    if (asked && queue.length > 0) resumeQueue(queue, index, position, { shuffle, repeat });
  }, WAKE_TIMEOUT_MS);
}

let wakeTimer: ReturnType<typeof setTimeout> | undefined;

// --- Choosing where to play ----------------------------------------------------------

function startControlling(device: RemoteDevice) {
  forgetNote();
  lastHeard = { ticks: -1, paused: true, entry: '' };
  missingSince = 0;
  emptySince = 0;
  awaiting = null;
  enterRemoteMode(device, controller);
}

function stopControlling() {
  awaiting = null;
  clearTimeout(wakeTimer);
  forgetNote();
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
  if (previous) settle(previous.deviceId);
  startControlling(device);
  if (queue.length === 0) {
    void refreshDevices();
    return;
  }
  nudgeRemoteState({ playing, position });

  // It never started there (asleep, or gone): the music stays here, paused where it was.
  const didNotStart = () => {
    toast(`${session.DeviceName} didn’t respond`);
    nudgeRemoteState({ playing: false, position });
    stopControlling();
  };

  try {
    await sendQueue(session.Id, queue, index, position, shuffle, repeat, didNotStart);
    if (previous && previous.deviceId !== session.DeviceId) {
      await remotePlaystate(a.client, previous.sessionId, 'Pause').catch(() => {});
    }
    if (!playing) {
      // It was paused: it arrives paused there too.
      await remotePlaystate(a.client, session.Id, 'Pause').catch(() => {});
    }
  } catch {
    failed(session.DeviceName);
    nudgeRemoteState({ playing: false, position });
    stopControlling();
  }
}

/** Bring the music back to this device, queue and all, from where it is on the other one. */
export function playHere() {
  const t = target();
  const { queue, index, shuffle, repeat, playing } = usePlayer.getState();
  if (!t) return;
  const position = currentPosition();
  settle(t.remote.deviceId);
  remotePlaystate(t.client, t.remote.sessionId, 'Pause').catch(() => {});
  stopControlling();
  if (playing && queue.length > 0) resumeQueue(queue, index, position, { shuffle, repeat });
}

// --- Keeping up with the other devices ------------------------------------------------

/**
 * While signed in: the account's devices, kept current. The server pushes
 * changes over the live connection; they're also asked for when the app opens
 * or comes to the front, when the connection (re)opens, and every few seconds
 * while it's down. Returns a stop function.
 */
export function startRemote() {
  const offMessages = onSocketMessage((message) => {
    if (message.MessageType !== 'Sessions' || !Array.isArray(message.Data)) return;
    onSessions(message.Data as SessionInfo[]);
  });
  const offPush = subscribeSessions(() => {});

  // Music starting here (not a remote): any other device that's playing pauses.
  const offClaim = usePlayer.subscribe((now, before) => {
    if (now.remote || !now.playing) return;
    if (before.playing && !before.remote) return;
    claimPlayback();
  });

  const visible = () => document.visibilityState === 'visible';
  const onFront = () => {
    if (!visible()) return;
    void refreshDevices();
    // The followed device's queue may have changed while this one was in the background.
    if (usePlayer.getState().remote) void readNote();
  };
  const offConnected = useSocket.subscribe((now, before) => {
    if (now.connected && !before.connected) void refreshDevices();
  });
  const offReconnect = onReconnect(onFront);
  document.addEventListener('visibilitychange', onFront);
  window.addEventListener('focus', onFront);
  const poll = setInterval(() => {
    const { connected } = useSocket.getState();
    const controlling = usePlayer.getState().remote !== null;
    const gap = Date.now() - lastRefresh;
    if (!connected && (visible() || controlling) && gap > 4_000) void refreshDevices();
    else if (visible() && gap > 30_000) void refreshDevices();
    // A controlled device that stops reporting still gets noticed (gone, or never started).
    else if (controlling) followRemote(lastAll);
  }, 5_000);
  void refreshDevices();

  return () => {
    offMessages();
    offPush();
    offClaim();
    offConnected();
    offReconnect();
    document.removeEventListener('visibilitychange', onFront);
    window.removeEventListener('focus', onFront);
    clearInterval(poll);
    if (usePlayer.getState().remote) stopControlling();
    settling.clear();
    lastAll = [];
    useDevices.setState({ devices: [], loaded: false });
  };
}

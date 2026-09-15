import { ticksToSeconds } from '@/jellyfin/api';
import {
  addToQueue,
  markShuffled,
  next,
  pause,
  play,
  playNext,
  previous,
  resumeQueue,
  seek,
  setRepeat,
  setShuffle,
  setVolume,
  togglePlay,
  usePlayer,
  type Repeat,
} from '@/player/player';
import { queueFromIds } from '@/player/track-lookup';
import { onSocketMessage, type SocketMessage } from './socket';

/**
 * Commands from another device (sent through Jellyfin to this device's live
 * connection): play these songs, pause, skip, seek, repeat, shuffle, volume.
 * Carried out one at a time in the order they came, so "play these" always
 * finishes before the "shuffle is on" that follows it.
 */

interface PlayRequest {
  ItemIds?: string[];
  StartIndex?: number;
  StartPositionTicks?: number;
  PlayCommand?: 'PlayNow' | 'PlayNext' | 'PlayLast' | 'PlayInstantMix' | 'PlayShuffle';
}

interface PlaystateRequest {
  Command?: string;
  SeekPositionTicks?: number;
}

interface GeneralCommand {
  Name?: string;
  Arguments?: Record<string, string>;
}

const REPEAT: Record<string, Repeat> = { RepeatNone: 'off', RepeatAll: 'all', RepeatOne: 'one' };

async function carryOut(message: SocketMessage) {
  // While this device is controlling another one, it isn't the one playing:
  // only "play these songs here" applies (it brings the music here).
  const controlling = usePlayer.getState().remote !== null;

  if (message.MessageType === 'Play') {
    const request = (message.Data ?? {}) as PlayRequest;
    const ids = request.ItemIds ?? [];
    if (ids.length === 0) return;
    if (request.PlayCommand === 'PlayNow' || request.PlayCommand === 'PlayShuffle' || request.PlayCommand === undefined) {
      const start = ticksToSeconds(request.StartPositionTicks);
      const queue = await queueFromIds(ids, request.StartIndex ?? 0, start);
      if (queue.tracks.length === 0) return;
      const { repeat } = usePlayer.getState();
      resumeQueue(queue.tracks, queue.index, queue.position, { shuffle: false, repeat });
      if (request.PlayCommand === 'PlayShuffle') setShuffle(true);
    } else if (!controlling && (request.PlayCommand === 'PlayNext' || request.PlayCommand === 'PlayLast')) {
      const { tracks } = await queueFromIds(ids, 0, 0);
      if (request.PlayCommand === 'PlayNext') playNext(tracks);
      else addToQueue(tracks);
    }
    return;
  }

  if (controlling) return;

  if (message.MessageType === 'Playstate') {
    const request = (message.Data ?? {}) as PlaystateRequest;
    switch (request.Command) {
      case 'Pause':
      case 'Stop':
        pause();
        break;
      case 'Unpause':
        play();
        break;
      case 'PlayPause':
        togglePlay();
        break;
      case 'NextTrack':
        next();
        break;
      case 'PreviousTrack':
        previous();
        break;
      case 'Seek':
        seek(ticksToSeconds(request.SeekPositionTicks));
        break;
    }
    return;
  }

  if (message.MessageType === 'GeneralCommand') {
    const command = (message.Data ?? {}) as GeneralCommand;
    const args = command.Arguments ?? {};
    switch (command.Name) {
      case 'SetRepeatMode':
        if (REPEAT[args.RepeatMode]) setRepeat(REPEAT[args.RepeatMode]);
        break;
      case 'SetShuffleQueue': {
        const on = args.ShuffleMode === 'Shuffle';
        // JellyJet sending its queue: already in shuffled order, just mark it.
        if (args.KeepOrder === 'true') markShuffled(on);
        else setShuffle(on);
        break;
      }
      case 'SetVolume': {
        const volume = Number(args.Volume);
        if (Number.isFinite(volume)) setVolume(volume / 100);
        break;
      }
    }
  }
}

let chain: Promise<void> = Promise.resolve();

/** While signed in: carry out commands from other devices. Returns a stop function. */
export function startReceiver() {
  return onSocketMessage((message) => {
    if (message.MessageType !== 'Play' && message.MessageType !== 'Playstate' && message.MessageType !== 'GeneralCommand') return;
    chain = chain.then(() => carryOut(message)).catch(() => {});
  });
}

import type { JellyfinClient } from './client';
import { deviceId } from './identity';
import type { BaseItem, ItemsResult } from './types';

/** Fields for queries whose results become playable song rows. */
export const TRACK_FIELDS = 'PrimaryImageAspectRatio,AlbumPrimaryImageTag,Container,ArtistItems';

export function recentlyAddedTracks(client: JellyfinClient, userId: string, limit = 60) {
  return client.get<ItemsResult>('/Items', {
    query: {
      userId,
      IncludeItemTypes: 'Audio',
      Recursive: true,
      SortBy: 'DateCreated',
      SortOrder: 'Descending',
      Limit: limit,
      Fields: TRACK_FIELDS,
      EnableUserData: true,
    },
  });
}

/**
 * Cover art. Image endpoints are public on the server, so no key rides along
 * (which also keeps the URL stable for the browser cache).
 */
export function imageUrl(
  baseUrl: string,
  itemId: string,
  tag: string | undefined,
  size: number,
): string {
  const params = new URLSearchParams({ fillWidth: String(size), fillHeight: String(size), quality: '90' });
  if (tag) params.set('tag', tag);
  return `${baseUrl}/Items/${itemId}/Images/Primary?${params}`;
}

/** The item whose picture represents this one: its own, else its album's. */
export function artworkOf(item: Pick<BaseItem, 'Id' | 'ImageTags' | 'AlbumId' | 'AlbumPrimaryImageTag'>) {
  if (item.ImageTags?.Primary) return { id: item.Id, tag: item.ImageTags.Primary };
  if (item.AlbumId && item.AlbumPrimaryImageTag) return { id: item.AlbumId, tag: item.AlbumPrimaryImageTag };
  return null;
}

/** What this browser's audio element can decode, and how the rest is converted. */
interface AudioProfile {
  containers: string[];
  transcodingContainer: string;
  transcodingCodec: string;
  transcodingProtocol: 'hls' | 'http';
}

const SAFARI: AudioProfile = {
  containers: ['mp3', 'aac', 'm4a|aac|alac', 'm4b|aac|alac', 'flac', 'wav'],
  transcodingContainer: 'ts',
  transcodingCodec: 'aac',
  transcodingProtocol: 'hls',
};

const OTHER_BROWSERS: AudioProfile = {
  containers: ['mp3', 'aac', 'm4a|aac', 'm4b|aac', 'flac', 'wav', 'ogg|vorbis|opus', 'oga|vorbis|opus', 'opus', 'webma|opus|vorbis', 'webm|opus|vorbis'],
  transcodingContainer: 'mp3',
  transcodingCodec: 'mp3',
  transcodingProtocol: 'http',
};

function audioProfile(): AudioProfile {
  // Safari (every iPhone browser included) plays HLS itself; others don't.
  const probe = document.createElement('audio');
  return probe.canPlayType('application/vnd.apple.mpegurl') ? SAFARI : OTHER_BROWSERS;
}

let profile: AudioProfile | undefined;

/**
 * A playable URL. `/universal` sends the original file when this browser can
 * play it (keeping real duration and seeking) and only converts otherwise.
 * The key rides as `ApiKey`: an audio element can't send headers, and Jellyfin
 * 12 turned the old lowercase `api_key` off.
 */
export function streamUrl(client: JellyfinClient, userId: string, itemId: string, playSessionId: string) {
  profile ??= audioProfile();
  return client.url(`/Audio/${itemId}/universal`, {
    userId,
    deviceId: deviceId(),
    ApiKey: client.token,
    PlaySessionId: playSessionId,
    container: profile.containers.join(','),
    audioCodec: profile.transcodingCodec,
    transcodingContainer: profile.transcodingContainer,
    transcodingProtocol: profile.transcodingProtocol,
  });
}

// --- Playback reporting --------------------------------------------------
// Play counts feed the Made for you mixes, so every play is reported. Reports
// are best-effort: a failure must never interrupt the music.

const TICKS_PER_SECOND = 10_000_000;

interface PlaybackReport {
  itemId: string;
  playSessionId: string;
  positionSeconds: number;
  paused?: boolean;
  repeatMode?: 'RepeatNone' | 'RepeatAll' | 'RepeatOne';
}

function report(client: JellyfinClient, path: string, r: PlaybackReport) {
  void client
    .post(path, {
      keepalive: true,
      timeoutMs: 10_000,
      body: {
        ItemId: r.itemId,
        PlaySessionId: r.playSessionId,
        PositionTicks: Math.round(r.positionSeconds * TICKS_PER_SECOND),
        IsPaused: r.paused ?? false,
        CanSeek: true,
        PlayMethod: 'DirectStream',
        RepeatMode: r.repeatMode ?? 'RepeatNone',
      },
    })
    .catch(() => {});
}

export const reportPlaybackStart = (c: JellyfinClient, r: PlaybackReport) => report(c, '/Sessions/Playing', r);
export const reportPlaybackProgress = (c: JellyfinClient, r: PlaybackReport) =>
  report(c, '/Sessions/Playing/Progress', r);
export const reportPlaybackStopped = (c: JellyfinClient, r: PlaybackReport) =>
  report(c, '/Sessions/Playing/Stopped', r);

export const ticksToSeconds = (ticks: number | undefined) => (ticks ?? 0) / TICKS_PER_SECOND;

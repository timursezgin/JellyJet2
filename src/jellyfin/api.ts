import type { JellyfinClient } from './client';
import { deviceId } from './identity';
import type { BaseItem, ItemsResult } from './types';

/** Fields for queries whose results become playable song rows. */
export const TRACK_FIELDS = 'PrimaryImageAspectRatio,AlbumPrimaryImageTag,Container,ArtistItems';
const CARD_FIELDS = 'PrimaryImageAspectRatio,ChildCount,ProductionYear';
const IMAGES = { ImageTypeLimit: 1, EnableImageTypes: 'Primary' } as const;

/** The server's music library, which most queries are scoped to. */
export async function musicLibraryId(client: JellyfinClient): Promise<string | null> {
  const views = await client.get<ItemsResult>('/UserViews');
  const music = views.Items.find((v) => v.CollectionType === 'music');
  return music?.Id ?? null;
}

export interface PageRequest {
  startIndex: number;
  limit: number;
  searchTerm?: string;
}

const scoped = (parentId: string | null) => (parentId ? { ParentId: parentId } : {});
const search = (term?: string) => (term?.trim() ? { SearchTerm: term.trim() } : {});

// --- Home --------------------------------------------------------------------

/** Albums in the order their songs were last played, newest first. */
export async function recentlyPlayedAlbums(client: JellyfinClient, userId: string, parentId: string | null, limit = 20) {
  const played = await client.get<ItemsResult>('/Items', {
    query: {
      userId,
      ...scoped(parentId),
      Recursive: true,
      IncludeItemTypes: 'Audio',
      Filters: 'IsPlayed',
      SortBy: 'DatePlayed',
      SortOrder: 'Descending',
      Limit: limit * 6,
      Fields: TRACK_FIELDS,
      ...IMAGES,
    },
  });
  const seen = new Set<string>();
  const albumIds: string[] = [];
  for (const track of played.Items) {
    if (!track.AlbumId || seen.has(track.AlbumId)) continue;
    seen.add(track.AlbumId);
    albumIds.push(track.AlbumId);
    if (albumIds.length === limit) break;
  }
  if (albumIds.length === 0) return [];
  const albums = await client.get<ItemsResult>('/Items', {
    query: { userId, Ids: albumIds.join(','), Fields: CARD_FIELDS, ...IMAGES },
  });
  const byId = new Map(albums.Items.map((a) => [a.Id, a]));
  return albumIds.map((id) => byId.get(id)).filter((a): a is BaseItem => !!a);
}

export function recentlyAddedAlbums(client: JellyfinClient, userId: string, parentId: string | null, limit = 20) {
  return client.get<BaseItem[]>('/Items/Latest', {
    query: { userId, ...scoped(parentId), IncludeItemTypes: 'MusicAlbum', Limit: limit, Fields: CARD_FIELDS, ...IMAGES },
  });
}

// --- Library -----------------------------------------------------------------

async function count(client: JellyfinClient, path: string, query: Record<string, string | number | boolean | undefined>) {
  const result = await client.get<ItemsResult>(path, { query: { ...query, Limit: 0, EnableTotalRecordCount: true } });
  return result.TotalRecordCount;
}

export async function libraryCounts(client: JellyfinClient, userId: string, parentId: string | null) {
  const base = { userId, ...scoped(parentId), Recursive: true };
  const [artists, albums, tracks, playlists, genres] = await Promise.all([
    count(client, '/Artists/AlbumArtists', { userId, ...scoped(parentId) }),
    count(client, '/Items', { ...base, IncludeItemTypes: 'MusicAlbum' }),
    count(client, '/Items', { ...base, IncludeItemTypes: 'Audio' }),
    // Playlists live outside the music library.
    count(client, '/Items', { userId, Recursive: true, IncludeItemTypes: 'Playlist' }),
    // Jellyfin 12 removed /MusicGenres; /Genres scoped to songs replaces it.
    count(client, '/Genres', { userId, ...scoped(parentId), IncludeItemTypes: 'Audio' }),
  ]);
  return { artists, albums, tracks, playlists, genres };
}

export function albums(
  client: JellyfinClient,
  userId: string,
  parentId: string | null,
  page: PageRequest,
  filter: { genreId?: string } = {},
) {
  return client.get<ItemsResult>('/Items', {
    query: {
      userId,
      ...scoped(parentId),
      ...search(page.searchTerm),
      Recursive: true,
      IncludeItemTypes: 'MusicAlbum',
      GenreIds: filter.genreId,
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      StartIndex: page.startIndex,
      Limit: page.limit,
      Fields: CARD_FIELDS,
      EnableTotalRecordCount: true,
      ...IMAGES,
    },
  });
}

/**
 * Album artists. Jellyfin 12 marks this endpoint deprecated in favour of
 * /Persons, but /Persons returns person records without artist photos.
 */
export function artists(client: JellyfinClient, userId: string, parentId: string | null, page: PageRequest) {
  return client.get<ItemsResult>('/Artists/AlbumArtists', {
    query: {
      userId,
      ...scoped(parentId),
      ...search(page.searchTerm),
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      StartIndex: page.startIndex,
      Limit: page.limit,
      Fields: 'PrimaryImageAspectRatio',
      EnableTotalRecordCount: true,
      ...IMAGES,
    },
  });
}

export function tracks(client: JellyfinClient, userId: string, parentId: string | null, page: PageRequest) {
  return client.get<ItemsResult>('/Items', {
    query: {
      userId,
      ...scoped(parentId),
      ...search(page.searchTerm),
      Recursive: true,
      IncludeItemTypes: 'Audio',
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      StartIndex: page.startIndex,
      Limit: page.limit,
      Fields: TRACK_FIELDS,
      EnableUserData: true,
      EnableTotalRecordCount: true,
      ...IMAGES,
    },
  });
}

export function genres(client: JellyfinClient, userId: string, parentId: string | null, searchTerm?: string) {
  return client.get<ItemsResult>('/Genres', {
    query: { userId, ...scoped(parentId), ...search(searchTerm), IncludeItemTypes: 'Audio', SortBy: 'SortName', ...IMAGES },
  });
}

export function playlists(client: JellyfinClient, userId: string) {
  return client.get<ItemsResult>('/Items', {
    query: { userId, Recursive: true, IncludeItemTypes: 'Playlist', SortBy: 'SortName', Fields: 'ChildCount,PrimaryImageAspectRatio', ...IMAGES },
  });
}

export function likedSongs(client: JellyfinClient, userId: string, parentId: string | null) {
  return client.get<ItemsResult>('/Items', {
    query: {
      userId,
      ...scoped(parentId),
      Recursive: true,
      IncludeItemTypes: 'Audio',
      Filters: 'IsFavorite',
      SortBy: 'Album,ParentIndexNumber,IndexNumber,SortName',
      SortOrder: 'Ascending',
      Fields: TRACK_FIELDS,
      EnableUserData: true,
      ...IMAGES,
    },
  });
}

// --- Details -----------------------------------------------------------------

export function item(client: JellyfinClient, userId: string, id: string) {
  return client.get<BaseItem>(`/Items/${id}`, { query: { userId } });
}

export function albumTracks(client: JellyfinClient, userId: string, albumId: string) {
  return client.get<ItemsResult>('/Items', {
    query: {
      userId,
      ParentId: albumId,
      IncludeItemTypes: 'Audio',
      SortBy: 'ParentIndexNumber,IndexNumber,SortName',
      Fields: TRACK_FIELDS,
      EnableUserData: true,
      ...IMAGES,
    },
  });
}

export function artistAlbums(client: JellyfinClient, userId: string, artistId: string) {
  return client.get<ItemsResult>('/Items', {
    query: {
      userId,
      Recursive: true,
      IncludeItemTypes: 'MusicAlbum',
      AlbumArtistIds: artistId,
      SortBy: 'ProductionYear,SortName',
      SortOrder: 'Descending',
      Fields: CARD_FIELDS,
      ...IMAGES,
    },
  });
}

/** Every song by an artist, most played first. */
export function artistTracks(client: JellyfinClient, userId: string, artistId: string) {
  return client.get<ItemsResult>('/Items', {
    query: {
      userId,
      Recursive: true,
      IncludeItemTypes: 'Audio',
      ArtistIds: artistId,
      SortBy: 'PlayCount,SortName',
      SortOrder: 'Descending',
      Fields: TRACK_FIELDS,
      EnableUserData: true,
      ...IMAGES,
    },
  });
}

export function playlistTracks(client: JellyfinClient, userId: string, playlistId: string) {
  return client.get<ItemsResult>(`/Playlists/${playlistId}/Items`, {
    query: { userId, Fields: TRACK_FIELDS, EnableUserData: true, ...IMAGES },
  });
}

/**
 * A playlist's cover drawn from what's in it now: the first four different
 * albums. Jellyfin draws its own playlist image once, at creation, so it goes
 * stale as songs come and go.
 */
export async function playlistCoverArt(client: JellyfinClient, userId: string, playlistId: string) {
  const result = await client.get<ItemsResult>(`/Playlists/${playlistId}/Items`, {
    query: { userId, Limit: 100, Fields: 'AlbumPrimaryImageTag', ...IMAGES },
  });
  const seen = new Set<string>();
  const art: { id: string; tag: string }[] = [];
  for (const track of result.Items) {
    const image = artworkOf(track);
    const key = track.AlbumId ?? image?.id;
    if (!image || !key || seen.has(key)) continue;
    seen.add(key);
    art.push(image);
    if (art.length === 4) break;
  }
  return art;
}

// --- Search ------------------------------------------------------------------

export function searchItems(client: JellyfinClient, userId: string, term: string, types: string, limit = 40) {
  return client.get<ItemsResult>('/Items', {
    query: {
      userId,
      Recursive: true,
      SearchTerm: term,
      IncludeItemTypes: types,
      Limit: limit,
      Fields: `${TRACK_FIELDS},ChildCount,ProductionYear`,
      EnableUserData: true,
      ...IMAGES,
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

import { JellyfinError, type JellyfinClient } from './client';
import { deviceId } from './identity';
import type { BaseItem, ItemsResult, LyricsResult } from './types';

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

/** Songs in the order they were last played, newest first. */
export function recentlyPlayedSongs(client: JellyfinClient, userId: string, parentId: string | null, limit = 100) {
  return client.get<ItemsResult>('/Items', {
    query: {
      userId,
      ...scoped(parentId),
      Recursive: true,
      IncludeItemTypes: 'Audio',
      Filters: 'IsPlayed',
      SortBy: 'DatePlayed',
      SortOrder: 'Descending',
      Limit: limit,
      Fields: TRACK_FIELDS,
      EnableUserData: true,
      ...IMAGES,
    },
  });
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

/** Jellyfin's sort fields for each song column (ties go by title). */
const TRACK_SORT_FIELDS = {
  title: 'SortName',
  artist: 'Artist,SortName',
  album: 'Album,SortName',
  duration: 'Runtime,SortName',
} as const;

export function tracks(
  client: JellyfinClient,
  userId: string,
  parentId: string | null,
  page: PageRequest,
  sort: { key: keyof typeof TRACK_SORT_FIELDS; descending: boolean } = { key: 'title', descending: false },
) {
  return client.get<ItemsResult>('/Items', {
    query: {
      userId,
      ...scoped(parentId),
      ...search(page.searchTerm),
      Recursive: true,
      IncludeItemTypes: 'Audio',
      SortBy: TRACK_SORT_FIELDS[sort.key],
      SortOrder: sort.descending ? 'Descending' : 'Ascending',
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

/** Albums liked with their own heart (Jellyfin favourites), A to Z. */
export function likedAlbums(client: JellyfinClient, userId: string, parentId: string | null) {
  return client.get<ItemsResult>('/Items', {
    query: {
      userId,
      ...scoped(parentId),
      Recursive: true,
      IncludeItemTypes: 'MusicAlbum',
      Filters: 'IsFavorite',
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      Fields: CARD_FIELDS,
      EnableUserData: true,
      ...IMAGES,
    },
  });
}

/**
 * Every song on these albums, album by album in the order given, each in disc
 * and track order. A hundred albums per request.
 */
export async function songsOfAlbums(client: JellyfinClient, userId: string, albumIds: string[]) {
  const items: BaseItem[] = [];
  for (let i = 0; i < albumIds.length; i += 100) {
    const result = await client.get<ItemsResult>('/Items', {
      query: {
        userId,
        AlbumIds: albumIds.slice(i, i + 100).join(','),
        Recursive: true,
        IncludeItemTypes: 'Audio',
        Fields: TRACK_FIELDS,
        EnableUserData: true,
        ...IMAGES,
      },
      timeoutMs: 60_000,
    });
    items.push(...result.Items);
  }
  const order = new Map(albumIds.map((id, i) => [id, i]));
  return items
    .filter((i) => i.Type === 'Audio' && i.AlbumId !== undefined && order.has(i.AlbumId))
    .sort(
      (a, b) =>
        order.get(a.AlbumId!)! - order.get(b.AlbumId!)! ||
        (a.ParentIndexNumber ?? 1) - (b.ParentIndexNumber ?? 1) ||
        (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0),
    );
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

/** A song's lyrics, or null when the server has none for it (yet). */
export async function lyrics(client: JellyfinClient, itemId: string): Promise<LyricsResult | null> {
  try {
    const result = await client.get<LyricsResult>(`/Audio/${itemId}/Lyrics`);
    return result?.Lyrics?.length ? result : null;
  } catch (error) {
    if (error instanceof JellyfinError && error.status === 404) return null;
    throw error;
  }
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

// --- Mixes and stations ------------------------------------------------------

/** Song fields plus what the mix generator reads (genre, year, plays). */
const MIX_FIELDS = `${TRACK_FIELDS},Genres,ProductionYear`;

type Query = Record<string, string | number | boolean | undefined>;

function songs(client: JellyfinClient, userId: string, parentId: string | null, query: Query) {
  return client.get<ItemsResult>('/Items', {
    query: {
      userId,
      ...scoped(parentId),
      Recursive: true,
      IncludeItemTypes: 'Audio',
      Fields: MIX_FIELDS,
      EnableUserData: true,
      ...IMAGES,
      ...query,
    },
    timeoutMs: 60_000,
  });
}

/** Songs that have been played, most recently played first (or oldest first). */
export const playedSongs = (c: JellyfinClient, u: string, p: string | null, limit: number, oldestFirst = false) =>
  songs(c, u, p, { Filters: 'IsPlayed', SortBy: 'DatePlayed', SortOrder: oldestFirst ? 'Ascending' : 'Descending', Limit: limit });

export const mostPlayedSongs = (c: JellyfinClient, u: string, p: string | null, limit: number) =>
  songs(c, u, p, { Filters: 'IsPlayed', SortBy: 'PlayCount', SortOrder: 'Descending', Limit: limit });

/** Liked songs, the longest-unplayed first. */
export const favouriteSongs = (c: JellyfinClient, u: string, p: string | null, limit: number) =>
  songs(c, u, p, { Filters: 'IsFavorite', SortBy: 'DatePlayed', SortOrder: 'Ascending', Limit: limit });

export const randomSongsInGenre = (c: JellyfinClient, u: string, p: string | null, genre: string, limit: number) =>
  songs(c, u, p, { Genres: genre, SortBy: 'Random', Limit: limit });

export const randomSongsFromYears = (c: JellyfinClient, u: string, p: string | null, years: number[], limit: number) =>
  songs(c, u, p, { Years: years.join(','), SortBy: 'Random', Limit: limit });

export const randomSongs = (c: JellyfinClient, u: string, p: string | null, limit: number) =>
  songs(c, u, p, { SortBy: 'Random', Limit: limit });

/** Songs by any of these artists (their features too), in random order. */
export const randomSongsByArtists = (c: JellyfinClient, u: string, p: string | null, artistIds: string[], limit: number) =>
  songs(c, u, p, { ArtistIds: artistIds.join(','), SortBy: 'Random', Limit: limit });

/** How many songs came out in these years (cheap: nothing is sent back). */
export function countSongsFromYears(client: JellyfinClient, userId: string, parentId: string | null, years: number[]) {
  return count(client, '/Items', { userId, ...scoped(parentId), Recursive: true, IncludeItemTypes: 'Audio', Years: years.join(',') });
}

/** Albums released in these years, in random order. */
export function randomAlbumsFromYears(client: JellyfinClient, userId: string, parentId: string | null, years: number[], limit: number) {
  return client.get<ItemsResult>('/Items', {
    query: { userId, ...scoped(parentId), Recursive: true, IncludeItemTypes: 'MusicAlbum', Years: years.join(','), SortBy: 'Random', Limit: limit },
  });
}

/** Asks the server to look for new files now (admins). */
export function refreshLibrary(client: JellyfinClient) {
  return client.post('/Library/Refresh');
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

export type JellyfinRepeatMode = 'RepeatNone' | 'RepeatAll' | 'RepeatOne';

interface PlaybackReport {
  itemId: string;
  playSessionId: string;
  positionSeconds: number;
  paused?: boolean;
  repeatMode?: JellyfinRepeatMode;
  shuffle?: boolean;
  /** Which queue entry is on (tells copies of a song apart). */
  entryId?: string;
}

/** Sent and forgotten: resolves once the server has it (or it failed). */
function report(client: JellyfinClient, path: string, r: PlaybackReport): Promise<void> {
  return client
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
        PlaybackOrder: r.shuffle ? 'Shuffle' : 'Default',
        // No NowPlayingQueue: Jellyfin ignores it in these reports (it only keeps
        // one sent with a stop). The queue goes in the playback note instead.
        PlaylistItemId: r.entryId,
      },
    })
    .then(
      () => {},
      () => {},
    );
}

export const reportPlaybackStart = (c: JellyfinClient, r: PlaybackReport) => report(c, '/Sessions/Playing', r);
export const reportPlaybackProgress = (c: JellyfinClient, r: PlaybackReport) =>
  report(c, '/Sessions/Playing/Progress', r);
export const reportPlaybackStopped = (c: JellyfinClient, r: PlaybackReport) =>
  report(c, '/Sessions/Playing/Stopped', r);

export const ticksToSeconds = (ticks: number | undefined) => (ticks ?? 0) / TICKS_PER_SECOND;
export const secondsToTicks = (seconds: number) => Math.round(seconds * TICKS_PER_SECOND);

// --- Sessions and remote control ------------------------------------------------
// Every open JellyJet keeps a live connection (src/remote/socket.ts) so other
// devices on the account can send it commands through these.

export interface SessionInfo {
  Id: string;
  DeviceId: string;
  DeviceName: string;
  Client: string;
  UserId: string;
  SupportsRemoteControl?: boolean;
  LastActivityDate?: string;
  /** When the device last reported on its playback. */
  LastPlaybackCheckIn?: string;
  NowPlayingItem?: BaseItem | null;
  PlaylistItemId?: string | null;
  PlayState?: {
    PositionTicks?: number | null;
    IsPaused?: boolean;
    RepeatMode?: JellyfinRepeatMode;
    PlaybackOrder?: 'Default' | 'Shuffle';
  };
}

/** Jellyfin writes the same id with or without dashes, in either case. */
export const sameId = (a: string, b: string) => a.replace(/-/g, '').toLowerCase() === b.replace(/-/g, '').toLowerCase();

/**
 * Sessions this account may control. For an admin that includes other
 * accounts' devices, so callers keep only their own (see remote.ts).
 */
export function sessions(client: JellyfinClient, userId: string) {
  return client.get<SessionInfo[]>('/Sessions', { query: { controllableByUserId: userId, activeWithinSeconds: 900 } });
}

/** Tell the server this app plays audio and takes commands over its live connection. */
export function reportCapabilities(client: JellyfinClient, supportedCommands: string[]) {
  return client.post('/Sessions/Capabilities/Full', {
    body: {
      PlayableMediaTypes: ['Audio'],
      SupportedCommands: supportedCommands,
      SupportsMediaControl: true,
      SupportsPersistentIdentifier: true,
    },
  });
}

/** Start songs on another session: `ids` from `startIndex`, `startSeconds` in. */
export function remotePlay(
  client: JellyfinClient,
  sessionId: string,
  command: 'PlayNow' | 'PlayNext' | 'PlayLast',
  ids: string[],
  startIndex = 0,
  startSeconds = 0,
) {
  return client.post(`/Sessions/${sessionId}/Playing`, {
    query: {
      playCommand: command,
      itemIds: ids.join(','),
      startIndex,
      startPositionTicks: secondsToTicks(startSeconds),
    },
  });
}

export type RemotePlaystate = 'Pause' | 'Unpause' | 'PlayPause' | 'Stop' | 'NextTrack' | 'PreviousTrack' | 'Seek';

export function remotePlaystate(client: JellyfinClient, sessionId: string, command: RemotePlaystate, seekSeconds?: number) {
  return client.post(`/Sessions/${sessionId}/Playing/${command}`, {
    query: seekSeconds === undefined ? undefined : { seekPositionTicks: secondsToTicks(seekSeconds) },
  });
}

export function remoteCommand(client: JellyfinClient, sessionId: string, name: string, args: Record<string, string>) {
  return client.post(`/Sessions/${sessionId}/Command`, { body: { Name: name, Arguments: args } });
}

// --- Changing things -----------------------------------------------------------

export function setFavorite(client: JellyfinClient, userId: string, itemId: string, favorite: boolean) {
  const path = `/UserFavoriteItems/${itemId}`;
  const options = { query: { userId } };
  return favorite ? client.post(path, options) : client.delete(path, options);
}

/** What's in a playlist: song id → its entry ids there (removing needs entry ids). */
export async function playlistEntries(client: JellyfinClient, userId: string, playlistId: string) {
  const result = await client.get<ItemsResult>(`/Playlists/${playlistId}/Items`, {
    query: { userId, Limit: 10000, EnableImages: false },
  });
  const entries: Record<string, string[]> = {};
  for (const item of result.Items) {
    if (!item.PlaylistItemId) continue;
    (entries[item.Id] ??= []).push(item.PlaylistItemId);
  }
  return entries;
}

/**
 * Adds songs to a playlist, skipping ones already in it: Jellyfin would
 * happily store duplicates. Returns how many were added.
 */
export async function addToPlaylist(client: JellyfinClient, userId: string, playlistId: string, ids: string[]) {
  const existing = await playlistEntries(client, userId, playlistId);
  const fresh = [...new Set(ids)].filter((id) => !existing[id]);
  if (fresh.length) await client.post(`/Playlists/${playlistId}/Items`, { query: { Ids: fresh, userId } });
  return fresh.length;
}

export function removeFromPlaylist(client: JellyfinClient, playlistId: string, entryIds: string[]) {
  return client.delete(`/Playlists/${playlistId}/Items`, { query: { EntryIds: entryIds } });
}

export async function createPlaylist(client: JellyfinClient, userId: string, name: string, ids: string[]) {
  const result = await client.post<{ Id: string }>('/Playlists', {
    body: { Name: name, Ids: [...new Set(ids)], UserId: userId, MediaType: 'Audio', IsPublic: false },
  });
  return result.Id;
}

/** Permanently deletes an item and its file from the server (needs deletion rights). */
export function deleteItem(client: JellyfinClient, itemId: string) {
  return client.delete(`/Items/${itemId}`);
}

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { useSession } from '@/auth/session';
import * as api from '@/jellyfin/api';
import type { JellyfinClient } from '@/jellyfin/client';
import type { BaseItem, ItemsResult } from '@/jellyfin/types';
import { trackFromItem, type Track } from '@/player/track';

/**
 * Every library read goes through these hooks. Results are cached and
 * refreshed in the background (on opening a page or returning to the app),
 * so lists show instantly and stay current without pull-to-refresh.
 */

function useAccount() {
  const client = useSession((s) => s.client) as JellyfinClient;
  const userId = useSession((s) => s.session?.userId ?? '');
  return { client, userId };
}

export function useMusicLibraryId() {
  const { client, userId } = useAccount();
  return useQuery({
    queryKey: ['music-library', userId],
    queryFn: () => api.musicLibraryId(client),
    staleTime: Infinity,
  });
}

/** A query that waits for the music library id, then runs with it. */
function useScopedQuery<T>(key: unknown[], fn: (parentId: string | null) => Promise<T>) {
  const { userId } = useAccount();
  const library = useMusicLibraryId();
  return useQuery({
    queryKey: [...key, userId],
    queryFn: () => fn(library.data ?? null),
    enabled: library.isSuccess,
  });
}

const toTracks = (result: ItemsResult) => result.Items.filter((i) => i.Type === 'Audio').map(trackFromItem);

// --- Home -------------------------------------------------------------------

export function useRecentlyPlayedAlbums() {
  const { client, userId } = useAccount();
  return useScopedQuery(['recently-played-albums'], (parentId) => api.recentlyPlayedAlbums(client, userId, parentId));
}

export function useRecentlyAddedAlbums() {
  const { client, userId } = useAccount();
  return useScopedQuery(['recently-added-albums'], (parentId) => api.recentlyAddedAlbums(client, userId, parentId));
}

export function useLikedSongs() {
  const { client, userId } = useAccount();
  return useScopedQuery(['liked-songs'], async (parentId) => toTracks(await api.likedSongs(client, userId, parentId)));
}

// --- Library ----------------------------------------------------------------

export function useLibraryCounts() {
  const { client, userId } = useAccount();
  return useScopedQuery(['library-counts'], (parentId) => api.libraryCounts(client, userId, parentId));
}

export function usePlaylists() {
  const { client, userId } = useAccount();
  return useQuery({
    queryKey: ['playlists', userId],
    queryFn: async () => (await api.playlists(client, userId)).Items,
  });
}

export function useGenres(searchTerm: string) {
  const { client, userId } = useAccount();
  const term = searchTerm.trim();
  return useScopedQuery(['genres', term], async (parentId) => (await api.genres(client, userId, parentId, term)).Items);
}

const PAGE_SIZE = 100;

/** A long list fetched a page at a time as it's scrolled. */
function usePagedList<T>(
  key: unknown[],
  fetchPage: (parentId: string | null, page: api.PageRequest) => Promise<ItemsResult>,
  map: (result: ItemsResult) => T[],
) {
  const { userId } = useAccount();
  const library = useMusicLibraryId();
  const query = useInfiniteQuery({
    queryKey: [...key, userId],
    enabled: library.isSuccess,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchPage(library.data ?? null, { startIndex: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, p) => sum + p.Items.length, 0);
      return loaded < last.TotalRecordCount && last.Items.length > 0 ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
  });
  const items = query.data?.pages.flatMap(map) ?? [];
  const total = query.data?.pages[0]?.TotalRecordCount ?? 0;
  return { ...query, items, total };
}

export function useAlbumList(searchTerm: string, genreId?: string) {
  const { client, userId } = useAccount();
  const term = searchTerm.trim();
  return usePagedList(
    ['albums', genreId ?? 'all', term],
    (parentId, page) => api.albums(client, userId, parentId, { ...page, searchTerm: term }, { genreId }),
    (r) => r.Items,
  );
}

export function useArtistList(searchTerm: string) {
  const { client, userId } = useAccount();
  const term = searchTerm.trim();
  return usePagedList(
    ['artists', term],
    (parentId, page) => api.artists(client, userId, parentId, { ...page, searchTerm: term }),
    (r) => r.Items,
  );
}

export function useTrackList(searchTerm: string) {
  const { client, userId } = useAccount();
  const term = searchTerm.trim();
  return usePagedList(
    ['tracks', term],
    (parentId, page) => api.tracks(client, userId, parentId, { ...page, searchTerm: term }),
    toTracks,
  );
}

// --- Details ----------------------------------------------------------------

export function useItem(id: string) {
  const { client, userId } = useAccount();
  return useQuery({ queryKey: ['item', id, userId], queryFn: () => api.item(client, userId, id) });
}

export function useAlbumTracks(albumId: string) {
  const { client, userId } = useAccount();
  return useQuery({
    queryKey: ['album-tracks', albumId, userId],
    queryFn: async () => toTracks(await api.albumTracks(client, userId, albumId)),
  });
}

export function useArtistAlbums(artistId: string) {
  const { client, userId } = useAccount();
  return useQuery({
    queryKey: ['artist-albums', artistId, userId],
    queryFn: async () => (await api.artistAlbums(client, userId, artistId)).Items,
  });
}

export function useArtistTracks(artistId: string) {
  const { client, userId } = useAccount();
  return useQuery({
    queryKey: ['artist-tracks', artistId, userId],
    queryFn: async () => toTracks(await api.artistTracks(client, userId, artistId)),
  });
}

export function usePlaylistTracks(playlistId: string) {
  const { client, userId } = useAccount();
  return useQuery({
    queryKey: ['playlist-tracks', playlistId, userId],
    queryFn: async () => toTracks(await api.playlistTracks(client, userId, playlistId)),
  });
}

export function usePlaylistCoverArt(playlistId: string) {
  const { client, userId } = useAccount();
  return useQuery({
    queryKey: ['playlist-cover', playlistId, userId],
    queryFn: () => api.playlistCoverArt(client, userId, playlistId),
    staleTime: 5 * 60_000,
  });
}

// --- Search -----------------------------------------------------------------

export type SearchFilter = 'all' | 'songs' | 'albums' | 'artists';

const SEARCH_TYPES: Record<SearchFilter, string> = {
  all: 'MusicArtist,MusicAlbum,Audio',
  songs: 'Audio',
  albums: 'MusicAlbum',
  artists: 'MusicArtist',
};

export interface SearchResults {
  artists: BaseItem[];
  albums: BaseItem[];
  songs: Track[];
}

export function useSearch(term: string, filter: SearchFilter) {
  const { client, userId } = useAccount();
  const trimmed = term.trim();
  return useQuery({
    queryKey: ['search', trimmed, filter, userId],
    enabled: trimmed.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<SearchResults> => {
      // A short pause so every keystroke doesn't hit the server.
      await new Promise((resolve) => setTimeout(resolve, 220));
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const result = await api.searchItems(client, userId, trimmed, SEARCH_TYPES[filter], filter === 'all' ? 60 : 80);
      return {
        artists: result.Items.filter((i) => i.Type === 'MusicArtist'),
        albums: result.Items.filter((i) => i.Type === 'MusicAlbum'),
        songs: toTracks(result),
      };
    },
  });
}

/** Keep only the songs whose title, artist or album contain the words typed. */
export function filterTracks(list: Track[], term: string): Track[] {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return list;
  return list.filter((t) => {
    const text = `${t.name} ${t.artists.map((a) => a.name).join(' ')} ${t.album ?? ''}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

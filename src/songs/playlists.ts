import { useQueries } from '@tanstack/react-query';

import { useSession } from '@/auth/session';
import { usePlaylists } from '@/data/queries';
import { queryClient } from '@/data/query-client';
import * as api from '@/jellyfin/api';
import type { BaseItem } from '@/jellyfin/types';
import { isOnline } from '@/connectivity/connection';
import { collectionKey, useDownloads } from '@/downloads/downloads';
import { syncCollection } from '@/downloads/engine';
import { JellyfinError } from '@/jellyfin/client';
import { enqueue } from '@/offline/outbox';
import { toast } from '@/ui/toast';

/** A downloaded playlist picks up the change straight away. */
async function syncDownloaded(playlistId: string) {
  const key = collectionKey('playlist', playlistId);
  if (useDownloads.getState().collections[key]) await syncCollection(key);
}

function account() {
  const { client, session } = useSession.getState();
  return client && session ? { client, userId: session.userId } : null;
}

/** Everything that shows a playlist's contents gets refreshed after a change. */
function refreshPlaylist(playlistId: string) {
  for (const key of ['playlist-entries', 'playlist-tracks', 'playlist-cover']) {
    void queryClient.invalidateQueries({ queryKey: [key, playlistId] });
  }
  void queryClient.invalidateQueries({ queryKey: ['playlists'] });
  void queryClient.invalidateQueries({ queryKey: ['library-counts'] });
}

/**
 * Every playlist with whether (and how) it contains the song. Only fetched
 * while `enabled` (the menu is open).
 */
export function usePlaylistMembership(trackId: string, enabled: boolean) {
  const userId = useSession((s) => s.session?.userId ?? '');
  const client = useSession((s) => s.client);
  const playlists = usePlaylists();
  const list = playlists.data ?? [];
  const entries = useQueries({
    queries: list.map((p) => ({
      queryKey: ['playlist-entries', p.Id, userId],
      queryFn: () => api.playlistEntries(client!, userId, p.Id),
      enabled: enabled && !!client,
      staleTime: 30_000,
    })),
  });
  const loading = playlists.isPending || entries.some((e) => e.isPending && e.fetchStatus !== 'idle');
  const rows = list.map((playlist, i) => ({
    playlist,
    entryIds: entries[i]?.data?.[trackId] ?? [],
    known: entries[i]?.data !== undefined,
  }));
  return { rows, loading };
}

const SAVED_OFFLINE = 'Saved - it will sync when you’re back online';

export async function addToPlaylist(playlist: Pick<BaseItem, 'Id' | 'Name'>, trackIds: string[]) {
  const a = account();
  if (!a) return;
  if (!isOnline()) {
    enqueue({ kind: 'playlist-add', playlistId: playlist.Id, ids: trackIds });
    toast(SAVED_OFFLINE);
    return;
  }
  try {
    const added = await api.addToPlaylist(a.client, a.userId, playlist.Id, trackIds);
    toast(added ? `Added to ${playlist.Name}` : `Already in ${playlist.Name}`);
    void syncDownloaded(playlist.Id);
  } catch (error) {
    if (error instanceof JellyfinError && error.network) {
      enqueue({ kind: 'playlist-add', playlistId: playlist.Id, ids: trackIds });
      toast(SAVED_OFFLINE);
      return;
    }
    toast(`Couldn’t add to ${playlist.Name}`);
  } finally {
    refreshPlaylist(playlist.Id);
  }
}

export async function removeFromPlaylist(playlist: Pick<BaseItem, 'Id' | 'Name'>, entryIds: string[]) {
  const a = account();
  if (!a || entryIds.length === 0) return;
  if (!isOnline()) {
    enqueue({ kind: 'playlist-remove', playlistId: playlist.Id, entryIds });
    toast(SAVED_OFFLINE);
    return;
  }
  try {
    await api.removeFromPlaylist(a.client, playlist.Id, entryIds);
    toast(`Removed from ${playlist.Name}`);
    void syncDownloaded(playlist.Id);
  } catch (error) {
    if (error instanceof JellyfinError && error.network) {
      enqueue({ kind: 'playlist-remove', playlistId: playlist.Id, entryIds });
      toast(SAVED_OFFLINE);
      return;
    }
    toast(`Couldn’t remove from ${playlist.Name}`);
  } finally {
    refreshPlaylist(playlist.Id);
  }
}

export async function createPlaylist(name: string, trackIds: string[], doneMessage?: string) {
  const a = account();
  if (!a) return null;
  if (!isOnline()) {
    toast('New playlists need a connection');
    return null;
  }
  try {
    const id = await api.createPlaylist(a.client, a.userId, name, trackIds);
    toast(doneMessage ?? (trackIds.length ? `Added to ${name}` : `Created ${name}`));
    refreshPlaylist(id);
    return id;
  } catch {
    toast('Couldn’t create the playlist');
    return null;
  }
}

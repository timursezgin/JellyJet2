import { create } from 'zustand';

import { useSession } from '@/auth/session';
import { useLikedSongs } from '@/data/queries';
import { queryClient } from '@/data/query-client';
import { isOnline } from '@/connectivity/connection';
import { useDownloads } from '@/downloads/downloads';
import { syncCollection } from '@/downloads/engine';
import { setFavorite } from '@/jellyfin/api';
import { JellyfinError } from '@/jellyfin/client';
import { enqueue, pendingFavorites } from '@/offline/outbox';
import type { Track } from '@/player/track';
import { toast } from '@/ui/toast';

/**
 * Whether a song is liked is a property of the song, shown the same on every
 * row, the player and the queue. Where it comes from, in order:
 *   1. a change made just now on this phone (shown instantly),
 *   2. the Liked Songs list, once loaded (the server's truth),
 *   3. what the song's own data said when it was fetched.
 */

interface LikesState {
  /** Song id → liked, for changes made in this session. */
  changed: Record<string, boolean>;
  /** Songs just unliked, flying out of the Liked Songs list before they go. */
  leaving: Record<string, true>;
  /** The Liked Songs row slid open to show its Unlike button, if any. */
  revealed: string | null;
}

const useLikes = create<LikesState>(() => ({ changed: {}, leaving: {}, revealed: null }));

/** How long an unliked row takes to fly out before it's removed (matches the CSS). */
const EXIT_MS = 320;
const removals = new Map<string, ReturnType<typeof setTimeout>>();

/** The Liked Songs list as a set of ids, built once per list (rows look up, not search). */
const likedIds = new WeakMap<Track[], Set<string>>();
function idsOf(list: Track[]) {
  let ids = likedIds.get(list);
  if (!ids) {
    ids = new Set(list.map((t) => t.id));
    likedIds.set(list, ids);
  }
  return ids;
}

export function useIsLiked(track: Pick<Track, 'id' | 'liked'>): boolean {
  const changed = useLikes((s) => s.changed[track.id]);
  const liked = useLikedSongs();
  if (changed !== undefined) return changed;
  if (liked.data) return idsOf(liked.data).has(track.id);
  return track.liked === true;
}

/** True while an unliked song is flying out of Liked Songs. */
export const useIsLeaving = (id: string) => useLikes((s) => s.leaving[id] === true);

/** Liked Songs: slide a row open to show its Unlike button (or close it with null). */
export const revealUnlike = (id: string | null) => useLikes.setState({ revealed: id });
export const useIsRevealed = (id: string) => useLikes((s) => s.revealed === id);

function likedSongsKey() {
  return ['liked-songs', useSession.getState().session?.userId ?? ''];
}

function setLeaving(id: string, leaving: boolean) {
  useLikes.setState((s) => {
    const next = { ...s.leaving };
    if (leaving) next[id] = true;
    else delete next[id];
    return { leaving: next };
  });
}

function cancelRemoval(id: string) {
  clearTimeout(removals.get(id));
  removals.delete(id);
  setLeaving(id, false);
}

/** Refresh Liked Songs from the server, but not while a row is still leaving. */
function refreshLikedSongs() {
  if (removals.size === 0) void queryClient.invalidateQueries({ queryKey: likedSongsKey() });
}

export async function setLiked(track: Track, liked: boolean) {
  const { client, session } = useSession.getState();
  if (!client || !session) return;
  const key = likedSongsKey();

  useLikes.setState((s) => ({ changed: { ...s.changed, [track.id]: liked } }));
  cancelRemoval(track.id);
  const wasListed = queryClient.getQueryData<Track[]>(key)?.some((t) => t.id === track.id) ?? false;

  if (liked) {
    if (!wasListed) {
      queryClient.setQueryData<Track[]>(key, (list) => (list ? [...list, { ...track, liked: true }] : list));
    }
  } else if (wasListed) {
    // Let the row fly out first, then take it out of the list.
    setLeaving(track.id, true);
    removals.set(
      track.id,
      setTimeout(() => {
        removals.delete(track.id);
        setLeaving(track.id, false);
        queryClient.setQueryData<Track[]>(key, (list) => list?.filter((t) => t.id !== track.id));
        refreshLikedSongs();
      }, EXIT_MS),
    );
  }

  if (!isOnline()) {
    enqueue({ kind: 'favorite', itemId: track.id, value: liked });
    return;
  }
  try {
    await setFavorite(client, session.userId, track.id, liked);
    if (useDownloads.getState().collections.liked) void syncCollection('liked');
  } catch (error) {
    // Lost the connection: keep the change and send it later.
    if (error instanceof JellyfinError && error.network) {
      enqueue({ kind: 'favorite', itemId: track.id, value: liked });
      return;
    }
    useLikes.setState((s) => {
      const changed = { ...s.changed };
      delete changed[track.id];
      return { changed };
    });
    cancelRemoval(track.id);
    if (liked && !wasListed) {
      queryClient.setQueryData<Track[]>(key, (list) => list?.filter((t) => t.id !== track.id));
    }
    toast('Couldn’t update Liked Songs');
  } finally {
    refreshLikedSongs();
  }
}

/** Show likes made offline (and not yet synced) after the app is reopened. */
export function restorePendingLikes() {
  useLikes.setState((s) => ({ changed: { ...pendingFavorites(), ...s.changed } }));
}

export function toggleLiked(track: Track, currentlyLiked: boolean) {
  void setLiked(track, !currentlyLiked);
}

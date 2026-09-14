import { create } from 'zustand';

import { useSession } from '@/auth/session';
import { useLikedSongs } from '@/data/queries';
import { queryClient } from '@/data/query-client';
import { setFavorite } from '@/jellyfin/api';
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
}

const useLikes = create<LikesState>(() => ({ changed: {} }));

export function useIsLiked(track: Pick<Track, 'id' | 'liked'>): boolean {
  const changed = useLikes((s) => s.changed[track.id]);
  const liked = useLikedSongs();
  if (changed !== undefined) return changed;
  if (liked.data) return liked.data.some((t) => t.id === track.id);
  return track.liked === true;
}

function likedSongsKey() {
  return ['liked-songs', useSession.getState().session?.userId ?? ''];
}

export async function setLiked(track: Track, liked: boolean) {
  const { client, session } = useSession.getState();
  if (!client || !session) return;

  useLikes.setState((s) => ({ changed: { ...s.changed, [track.id]: liked } }));
  // Keep the Liked Songs list in step straight away (and remember it, to put
  // back if the server says no).
  const before = queryClient.getQueryData<Track[]>(likedSongsKey());
  queryClient.setQueryData<Track[]>(likedSongsKey(), (list) => {
    if (!list) return list;
    const without = list.filter((t) => t.id !== track.id);
    return liked ? [...without, { ...track, liked: true }] : without;
  });

  try {
    await setFavorite(client, session.userId, track.id, liked);
    toast(liked ? 'Added to Liked Songs' : 'Removed from Liked Songs');
  } catch {
    useLikes.setState((s) => {
      const changed = { ...s.changed };
      delete changed[track.id];
      return { changed };
    });
    if (before) queryClient.setQueryData(likedSongsKey(), before);
    toast('Couldn’t update Liked Songs');
  } finally {
    void queryClient.invalidateQueries({ queryKey: likedSongsKey() });
  }
}

export function toggleLiked(track: Track, currentlyLiked: boolean) {
  void setLiked(track, !currentlyLiked);
}

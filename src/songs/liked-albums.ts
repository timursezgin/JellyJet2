import { create } from 'zustand';

import { useSession } from '@/auth/session';
import { isOnline } from '@/connectivity/connection';
import { useDownloads } from '@/downloads/downloads';
import { syncCollection } from '@/downloads/engine';
import { useLikedAlbums } from '@/data/queries';
import { queryClient } from '@/data/query-client';
import { setFavorite } from '@/jellyfin/api';
import { JellyfinError } from '@/jellyfin/client';
import type { BaseItem } from '@/jellyfin/types';
import { enqueue, pendingFavorites } from '@/offline/outbox';
import { toast } from '@/ui/toast';

/**
 * Liked Albums: an album's own heart, kept as a Jellyfin favourite on the
 * album (not a playlist, and separate from liking its songs). Whether an album
 * is liked comes from, in order: a change made just now, the Liked Albums
 * list once loaded, what the album's own data said.
 */

const useChanges = create<{ changed: Record<string, boolean> }>(() => ({ changed: {} }));

const listIds = new WeakMap<BaseItem[], Set<string>>();
function idsOf(list: BaseItem[]) {
  let ids = listIds.get(list);
  if (!ids) {
    ids = new Set(list.map((a) => a.Id));
    listIds.set(list, ids);
  }
  return ids;
}

export function useIsAlbumLiked(album: Pick<BaseItem, 'Id' | 'UserData'> | undefined): boolean {
  const changed = useChanges((s) => (album ? s.changed[album.Id] : undefined));
  const liked = useLikedAlbums();
  if (!album) return false;
  if (changed !== undefined) return changed;
  if (liked.data) return idsOf(liked.data).has(album.Id);
  return album.UserData?.IsFavorite === true;
}

const likedAlbumsKey = () => ['liked-albums', useSession.getState().session?.userId ?? ''];

function setChange(id: string, liked: boolean | undefined) {
  useChanges.setState((s) => {
    const changed = { ...s.changed };
    if (liked === undefined) delete changed[id];
    else changed[id] = liked;
    return { changed };
  });
}

/** Put the album in (or take it out of) the loaded list, keeping A to Z. */
function updateList(album: BaseItem, liked: boolean) {
  queryClient.setQueryData<BaseItem[]>(likedAlbumsKey(), (list) => {
    if (!list) return list;
    const without = list.filter((a) => a.Id !== album.Id);
    if (!liked) return without;
    const name = (a: BaseItem) => (a.SortName ?? a.Name ?? '').toLowerCase();
    return [...without, album].sort((a, b) => name(a).localeCompare(name(b)));
  });
}

export async function setAlbumLiked(album: BaseItem, liked: boolean) {
  const { client, session } = useSession.getState();
  if (!client || !session) return;
  const wasListed = queryClient.getQueryData<BaseItem[]>(likedAlbumsKey())?.some((a) => a.Id === album.Id) ?? false;
  setChange(album.Id, liked);
  updateList(album, liked);

  if (!isOnline()) {
    enqueue({ kind: 'favorite', itemId: album.Id, value: liked });
    return;
  }
  try {
    await setFavorite(client, session.userId, album.Id, liked);
  } catch (error) {
    // Lost the connection: keep the change and send it later.
    if (error instanceof JellyfinError && error.network) {
      enqueue({ kind: 'favorite', itemId: album.Id, value: liked });
      return;
    }
    setChange(album.Id, undefined);
    updateList(album, wasListed);
    toast('Couldn’t update Liked Albums');
    return;
  }
  void queryClient.invalidateQueries({ queryKey: likedAlbumsKey() });
  // A downloaded Liked Albums fetches the new album's songs (or lets go of an unliked one's).
  if (useDownloads.getState().collections['liked-albums']) void syncCollection('liked-albums');
}

/** Show album likes made offline (and not yet synced) after the app is reopened. */
export function restorePendingAlbumLikes() {
  useChanges.setState((s) => ({ changed: { ...pendingFavorites(), ...s.changed } }));
}

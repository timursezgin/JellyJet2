import { artworkOf, ticksToSeconds } from '@/jellyfin/api';
import type { BaseItem } from '@/jellyfin/types';

/** A song as the player keeps it: small enough to save the queue between launches. */
export interface Track {
  id: string;
  name: string;
  album?: string;
  albumId?: string;
  artists: { id?: string; name: string }[];
  duration: number;
  art: { id: string; tag: string } | null;
  /** Track and disc number within its album. */
  number?: number;
  disc?: number;
  /** Liked (a Jellyfin favourite) when this copy was fetched. */
  liked?: boolean;
  /** The entry id when this song came from a playlist (removing needs it). */
  entryId?: string;
}

export function trackFromItem(item: BaseItem): Track {
  const artists =
    item.ArtistItems?.length
      ? item.ArtistItems.map((a) => ({ id: a.Id, name: a.Name }))
      : (item.Artists ?? (item.AlbumArtist ? [item.AlbumArtist] : [])).map((name) => ({ name }));
  return {
    id: item.Id,
    name: item.Name,
    album: item.Album,
    albumId: item.AlbumId,
    artists,
    duration: ticksToSeconds(item.RunTimeTicks),
    art: artworkOf(item),
    number: item.IndexNumber,
    disc: item.ParentIndexNumber,
    liked: item.UserData?.IsFavorite,
    entryId: item.PlaylistItemId,
  };
}

export const artistLine = (track: Track) => track.artists.map((a) => a.name).join(', ');

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

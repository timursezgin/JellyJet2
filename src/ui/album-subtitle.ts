import type { BaseItem } from '@/jellyfin/types';

/** "Artist · Year" under an album's name. */
export function albumSubtitle(album: BaseItem) {
  const artist = album.AlbumArtist ?? album.AlbumArtists?.[0]?.Name ?? album.Artists?.[0];
  return [artist, album.ProductionYear].filter(Boolean).join(' · ');
}

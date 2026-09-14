import { artworkOf } from '@/jellyfin/api';
import type { BaseItem } from '@/jellyfin/types';
import { navigate } from '@/nav/navigation';
import { Artwork } from './artwork';
import styles from './album-card.module.css';

/** Caption height under a card's cover (title + subtitle). */
export const ALBUM_CAPTION_HEIGHT = 44;

export function albumSubtitle(album: BaseItem) {
  const artist = album.AlbumArtist ?? album.AlbumArtists?.[0]?.Name ?? album.Artists?.[0];
  return [artist, album.ProductionYear].filter(Boolean).join(' · ');
}

interface AlbumCardProps {
  album: BaseItem;
  size: number;
  /** Hide the year (shelves) or the artist (an artist's own page). */
  subtitle?: string;
  small?: boolean;
}

/** A square cover with title and subtitle; the whole card opens the album. */
export function AlbumCard({ album, size, subtitle, small = false }: AlbumCardProps) {
  return (
    <button
      type="button"
      className={styles.card}
      data-small={small || undefined}
      style={{ width: size }}
      onClick={() => navigate({ name: 'album', id: album.Id, title: album.Name })}
    >
      <Artwork art={artworkOf(album)} size={size} radius={10} />
      <span className={styles.title}>{album.Name}</span>
      <span className={styles.subtitle}>{subtitle ?? albumSubtitle(album)}</span>
    </button>
  );
}

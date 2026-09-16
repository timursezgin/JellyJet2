import { Play } from 'lucide-react';

import { fetchAlbumTracks } from '@/data/queries';
import { artworkOf } from '@/jellyfin/api';
import type { BaseItem } from '@/jellyfin/types';
import { navigate } from '@/nav/navigation';
import { currentTrack, playTracks, usePlayer } from '@/player/player';
import { beginAlbumDrag } from '@/songs/song-drag';
import { albumContextMenu } from '@/songs/song-menu';
import { toast } from '@/ui/toast';
import { albumSubtitle } from './album-subtitle';
import { Artwork } from './artwork';
import styles from './album-card.module.css';

export { albumSubtitle };

/** Caption height under a card's cover (title + subtitle). */
export const ALBUM_CAPTION_HEIGHT = 44;

interface AlbumCardProps {
  album: BaseItem;
  size: number;
  /** Hide the year (shelves) or the artist (an artist's own page). */
  subtitle?: string;
  small?: boolean;
  /** With a mouse, a play button on the cover starts the whole album (Home's Liked Albums). */
  playable?: boolean;
}

/**
 * A square cover with title and subtitle; the card opens the album. With a
 * mouse it can be right-clicked (Add to Liked Albums) and dragged onto Liked
 * Albums in the sidebar.
 */
export function AlbumCard({ album, size, subtitle, small = false, playable = false }: AlbumCardProps) {
  const open = () => navigate({ name: 'album', id: album.Id, title: album.Name });
  const common = {
    className: styles.card,
    'data-small': small || undefined,
    style: { width: size },
    onContextMenu: albumContextMenu(album),
    onPointerDown: (e: React.PointerEvent) => beginAlbumDrag(e, album),
  };

  if (!playable) {
    return (
      <button type="button" {...common} onClick={open}>
        <Artwork art={artworkOf(album)} size={size} radius={10} />
        <span className={styles.title}>{album.Name}</span>
        <span className={styles.subtitle}>{subtitle ?? albumSubtitle(album)}</span>
      </button>
    );
  }

  // The play button can't sit inside a button, so the cover and the name are buttons of their own.
  return (
    <div {...common} data-playable>
      <span className={styles.cover}>
        <button type="button" className={styles.coverButton} onClick={open} aria-label={`Open ${album.Name}`}>
          <Artwork art={artworkOf(album)} size={size} radius={10} />
        </button>
        <AlbumPlayButton album={album} />
      </span>
      <button type="button" className={styles.title} onClick={open}>
        {album.Name}
      </button>
      <span className={styles.subtitle}>{subtitle ?? albumSubtitle(album)}</span>
    </div>
  );
}

function AlbumPlayButton({ album }: { album: BaseItem }) {
  const playingThis = usePlayer((s) => s.playing && currentTrack(s)?.albumId === album.Id);
  if (playingThis) return null;
  return (
    <button
      type="button"
      className={styles.play}
      data-no-song-drag
      onPointerEnter={() => void fetchAlbumTracks(album.Id).catch(() => {})}
      onClick={async () => {
        try {
          const tracks = await fetchAlbumTracks(album.Id);
          if (tracks.length) playTracks(tracks, 0, { shuffle: false });
        } catch {
          toast('Couldn’t load this album');
        }
      }}
      aria-label={`Play ${album.Name}`}
      title="Play"
    >
      <Play size={22} fill="currentColor" strokeWidth={0} />
    </button>
  );
}

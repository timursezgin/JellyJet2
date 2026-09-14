import { Ellipsis, Heart } from 'lucide-react';

import { useSession } from '@/auth/session';
import type { Track } from '@/player/track';
import { SongDownloadButton } from '@/downloads/download-buttons';
import { toggleLiked, useIsLiked } from './likes';
import { openSongMenu, type SongContext } from './song-menu';
import styles from './song-buttons.module.css';

interface Props {
  track: Track;
  /** Bigger targets and icons for the full player. */
  large?: boolean;
  context?: SongContext;
  /** Tapping a filled heart asks first (Liked Songs) instead of unliking. */
  onUnlikeRequest?(): void;
}

/** heart | download | (…) - the same three buttons wherever a song appears. */
export function SongButtons({ track, large = false, context, onUnlikeRequest }: Props) {
  const canDownload = useSession((s) => s.session?.permissions.canDownload ?? false);
  return (
    <div className={styles.buttons} data-large={large || undefined}>
      <LikeButton track={track} large={large} onUnlikeRequest={onUnlikeRequest} />
      {canDownload && <SongDownloadButton track={track} className={styles.button} large={large} />}
      <button
        type="button"
        className={styles.button}
        onClick={() => openSongMenu(track, context)}
        aria-label={`More for ${track.name}`}
      >
        <Ellipsis size={large ? 24 : 20} strokeWidth={2.2} />
      </button>
    </div>
  );
}

export function LikeButton({
  track,
  large = false,
  onUnlikeRequest,
}: {
  track: Track;
  large?: boolean;
  onUnlikeRequest?(): void;
}) {
  const liked = useIsLiked(track);
  return (
    <button
      type="button"
      className={styles.button}
      data-active={liked || undefined}
      onClick={() => (liked && onUnlikeRequest ? onUnlikeRequest() : toggleLiked(track, liked))}
      aria-label={liked ? `Remove ${track.name} from Liked Songs` : `Add ${track.name} to Liked Songs`}
      aria-pressed={liked}
    >
      <Heart size={large ? 24 : 20} strokeWidth={2} fill={liked ? 'currentColor' : 'none'} />
    </button>
  );
}


import { ArrowDownToLine, Ellipsis, Heart } from 'lucide-react';

import { useSession } from '@/auth/session';
import type { Track } from '@/player/track';
import { toast } from '@/ui/toast';
import { toggleLiked, useIsLiked } from './likes';
import { openSongMenu, type SongContext } from './song-menu';
import styles from './song-buttons.module.css';

interface Props {
  track: Track;
  /** Bigger targets and icons for the full player. */
  large?: boolean;
  context?: SongContext;
}

/** heart | download | (…) - the same three buttons wherever a song appears. */
export function SongButtons({ track, large = false, context }: Props) {
  const canDownload = useSession((s) => s.session?.permissions.canDownload ?? false);
  return (
    <div className={styles.buttons} data-large={large || undefined}>
      <LikeButton track={track} large={large} />
      {canDownload && <DownloadButton large={large} />}
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

export function LikeButton({ track, large = false }: { track: Track; large?: boolean }) {
  const liked = useIsLiked(track);
  return (
    <button
      type="button"
      className={styles.button}
      data-active={liked || undefined}
      onClick={() => toggleLiked(track, liked)}
      aria-label={liked ? `Remove ${track.name} from Liked Songs` : `Add ${track.name} to Liked Songs`}
      aria-pressed={liked}
    >
      <Heart size={large ? 24 : 20} strokeWidth={2} fill={liked ? 'currentColor' : 'none'} />
    </button>
  );
}

/** Downloading arrives in step 5; the button already takes its place. */
function DownloadButton({ large }: { large: boolean }) {
  return (
    <button
      type="button"
      className={styles.button}
      data-muted
      onClick={() => toast('Downloads arrive in the next update')}
      aria-label="Download"
    >
      <ArrowDownToLine size={large ? 24 : 20} strokeWidth={2} />
    </button>
  );
}

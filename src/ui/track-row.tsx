import { useEffect, useRef, type RefObject } from 'react';

import { useOnline } from '@/connectivity/connection';
import { useIsDownloaded } from '@/downloads/downloads';
import { currentTrack, usePlayer } from '@/player/player';
import { artistLine, type Track } from '@/player/track';
import { revealUnlike, setLiked, useIsLeaving, useIsRevealed } from '@/songs/likes';
import { SongButtons } from '@/songs/song-buttons';
import type { SongContext } from '@/songs/song-menu';
import { Artwork } from './artwork';
import { toast } from './toast';
import styles from './track-row.module.css';

/** Fixed height, so long lists can be drawn only where they're visible. */
export const TRACK_ROW_HEIGHT = 64;

interface TrackRowProps {
  track: Track;
  onPlay(): void;
  /** `art` shows the cover; a number shows the track number (album pages). */
  leading?: 'art' | number;
  /** What goes under the title; defaults to "Artist · Album". */
  subtitle?: string;
  /** Where the row is shown, for the (…) menu (e.g. inside a playlist). */
  context?: SongContext;
  /**
   * Liked Songs: the heart slides the row open to a red Unlike button instead
   * of unliking straight away, and an unliked row flies out.
   */
  confirmUnlike?: boolean;
}

/**
 * A song row: tap anywhere on the song to play it; heart, download and (…)
 * on the right are their own full-height buttons.
 */
export function TrackRow({ track, onPlay, leading = 'art', subtitle, context, confirmUnlike = false }: TrackRowProps) {
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === track.id);
  const leaving = useIsLeaving(track.id) && confirmUnlike;
  const revealed = useIsRevealed(track.id) && confirmUnlike && !leaving;
  const line = subtitle ?? [artistLine(track), track.album].filter(Boolean).join(' · ');
  const unlikeButton = useRef<HTMLButtonElement>(null);
  const online = useOnline();
  const downloaded = useIsDownloaded(track.id);
  const unavailable = !online && !downloaded;

  useCloseWhenTappedElsewhere(revealed, unlikeButton);

  return (
    <div
      className={styles.row}
      data-current={isCurrent || undefined}
      data-revealed={revealed || undefined}
      data-leaving={leaving || undefined}
      data-unavailable={unavailable || undefined}
    >
      {confirmUnlike && (
        <button
          ref={unlikeButton}
          type="button"
          className={styles.unlike}
          tabIndex={revealed ? 0 : -1}
          aria-hidden={!revealed}
          onClick={() => {
            revealUnlike(null);
            void setLiked(track, false);
          }}
        >
          <span>Unlike</span>
        </button>
      )}
      <div className={styles.slide}>
        <button
          type="button"
          className={styles.main}
          onClick={unavailable ? () => toast('Not downloaded - it needs a connection') : onPlay}
          aria-disabled={unavailable || undefined}
        >
          {leading === 'art' ? (
            <Artwork art={track.art} size={44} radius={10} />
          ) : (
            <span className={styles.number}>{leading}</span>
          )}
          <span className={styles.text}>
            <span className={styles.title}>{track.name}</span>
            {line && <span className={styles.subtitle}>{line}</span>}
          </span>
        </button>
        <SongButtons
          track={track}
          context={context}
          onUnlikeRequest={confirmUnlike ? () => revealUnlike(track.id) : undefined}
        />
      </div>
    </div>
  );
}

/**
 * While a row is open, the next touch anywhere else (or a scroll) closes it -
 * and that first tap does nothing else, as in iOS lists.
 */
function useCloseWhenTappedElsewhere(open: boolean, keep: RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    if (!open) return;
    const swallowNextClick = () => {
      const stop = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      document.addEventListener('click', stop, { capture: true, once: true });
      // If the touch turns into a scroll there's no click; don't eat a later one.
      setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 600);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (keep.current?.contains(event.target as Node)) return;
      swallowNextClick();
      revealUnlike(null);
    };
    const onScroll = () => revealUnlike(null);
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [open, keep]);
}

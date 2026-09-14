import { currentTrack, usePlayer } from '@/player/player';
import { artistLine, formatTime, type Track } from '@/player/track';
import { Artwork } from './artwork';
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
}

/**
 * A song row. The whole row starts the song; the heart, download and (…)
 * buttons join on the right in step 4.
 */
export function TrackRow({ track, onPlay, leading = 'art', subtitle }: TrackRowProps) {
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === track.id);
  const line = subtitle ?? [artistLine(track), track.album].filter(Boolean).join(' · ');
  return (
    <div className={styles.row} data-current={isCurrent || undefined}>
      <button type="button" className={styles.main} onClick={onPlay}>
        {leading === 'art' ? (
          <Artwork art={track.art} size={44} radius={10} />
        ) : (
          <span className={styles.number}>{leading}</span>
        )}
        <span className={styles.text}>
          <span className={styles.title}>{track.name}</span>
          {line && <span className={styles.subtitle}>{line}</span>}
        </span>
        <span className={styles.duration}>{formatTime(track.duration)}</span>
      </button>
    </div>
  );
}

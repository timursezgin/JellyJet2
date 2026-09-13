import { currentTrack, usePlayer } from '@/player/player';
import { artistLine, formatTime, type Track } from '@/player/track';
import { Artwork } from './artwork';
import styles from './track-row.module.css';

interface TrackRowProps {
  track: Track;
  onPlay(): void;
  /** Hide the cover (album pages number their songs instead). */
  showArt?: boolean;
}

/**
 * A song row. The whole row starts the song; the heart, download and (…)
 * buttons join on the right in step 4.
 */
export function TrackRow({ track, onPlay, showArt = true }: TrackRowProps) {
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === track.id);
  return (
    <div className={styles.row} data-current={isCurrent || undefined}>
      <button type="button" className={styles.main} onClick={onPlay}>
        {showArt && <Artwork art={track.art} size={44} radius={10} />}
        <span className={styles.text}>
          <span className={styles.title}>{track.name}</span>
          <span className={styles.subtitle}>
            {artistLine(track)}
            {track.album ? ` · ${track.album}` : ''}
          </span>
        </span>
        <span className={styles.duration}>{formatTime(track.duration)}</span>
      </button>
    </div>
  );
}

import { currentTrack, usePlayer } from '@/player/player';
import { artistLine, type Track } from '@/player/track';
import { SongButtons } from '@/songs/song-buttons';
import type { SongContext } from '@/songs/song-menu';
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
  /** Where the row is shown, for the (…) menu (e.g. inside a playlist). */
  context?: SongContext;
}

/**
 * A song row: tap anywhere on the song to play it; heart, download and (…)
 * on the right are their own full-height buttons.
 */
export function TrackRow({ track, onPlay, leading = 'art', subtitle, context }: TrackRowProps) {
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
      </button>
      <SongButtons track={track} context={context} />
    </div>
  );
}

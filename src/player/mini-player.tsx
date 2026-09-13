import { Pause, Play, SkipForward } from 'lucide-react';
import { useRef, type PointerEvent } from 'react';

import { Artwork } from '@/ui/artwork';
import { currentTrack, next, openPlayer, previous, togglePlay, usePlayer } from './player';
import { artistLine } from './track';
import { usePosition } from './use-position';
import styles from './mini-player.module.css';

/** Docked above the tab bar whenever something is queued. */
export function MiniPlayer() {
  const track = usePlayer((s) => currentTrack(s));
  const playing = usePlayer((s) => s.playing);
  const duration = usePlayer((s) => s.duration);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const suppressTap = useRef(false);

  if (!track) return null;

  // Swipe left or right on the body to change song.
  const onPointerDown = (e: PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    suppressTap.current = false;
  };
  const onPointerUp = (e: PointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      suppressTap.current = true;
      if (dx < 0) next();
      else previous();
    }
  };

  return (
    <div className={styles.mini}>
      <button
        type="button"
        className={styles.body}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
        onClick={() => {
          if (!suppressTap.current) openPlayer();
        }}
        aria-label={`Now playing: ${track.name}. Open player`}
      >
        <Artwork art={track.art} size={42} radius={8} eager />
        <span className={styles.text}>
          <span className={styles.title}>{track.name}</span>
          <span className={styles.artist}>{artistLine(track)}</span>
        </span>
      </button>
      <button
        type="button"
        className={styles.control}
        onClick={togglePlay}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause size={24} fill="currentColor" strokeWidth={0} /> : <Play size={24} fill="currentColor" strokeWidth={0} />}
      </button>
      <button type="button" className={styles.control} onClick={next} aria-label="Next song">
        <SkipForward size={22} fill="currentColor" strokeWidth={2.2} />
      </button>
      <Progress duration={duration} />
    </div>
  );
}

function Progress({ duration }: { duration: number }) {
  const position = usePosition();
  const fraction = duration > 0 ? Math.min(1, position / duration) : 0;
  return (
    <div className={styles.progress}>
      <div className={styles.progressFill} style={{ transform: `scaleX(${fraction})` }} />
    </div>
  );
}

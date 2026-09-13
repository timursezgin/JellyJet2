import { useRef, useState, type PointerEvent } from 'react';

import { seek, usePlayer } from './player';
import { formatTime } from './track';
import { usePosition } from './use-position';
import styles from './scrubber.module.css';

/** The draggable progress bar with elapsed and remaining time. */
export function Scrubber() {
  const duration = usePlayer((s) => s.duration);
  const position = usePosition(true);
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const shown = dragging ?? position;
  const fraction = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0;

  const at = (e: PointerEvent) => {
    const rect = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * duration;
  };

  return (
    <div className={styles.scrubber} data-no-drag>
      <div
        ref={track}
        className={styles.hit}
        data-dragging={dragging !== null || undefined}
        onPointerDown={(e) => {
          if (duration <= 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(at(e));
        }}
        onPointerMove={(e) => dragging !== null && setDragging(at(e))}
        onPointerUp={(e) => {
          if (dragging === null) return;
          seek(at(e));
          setDragging(null);
        }}
        onPointerCancel={() => setDragging(null)}
        role="slider"
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
      >
        <div className={styles.track}>
          <div className={styles.fill} style={{ transform: `scaleX(${fraction})` }} />
        </div>
        <div className={styles.knob} style={{ left: `${fraction * 100}%` }} />
      </div>
      <div className={styles.times}>
        <span>{formatTime(shown)}</span>
        <span>-{formatTime(Math.max(0, duration - shown))}</span>
      </div>
    </div>
  );
}

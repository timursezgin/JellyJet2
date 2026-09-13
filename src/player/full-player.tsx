import { Airplay, ListMusic, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { Artwork } from '@/ui/artwork';
import { usePresence } from '@/ui/use-presence';
import {
  audio,
  closePlayer,
  currentTrack,
  cycleRepeat,
  next,
  previous,
  setQueueOpen,
  setShuffle,
  togglePlay,
  usePlayer,
} from './player';
import { QueueSheet } from './queue-sheet';
import { Scrubber } from './scrubber';
import { artistLine } from './track';
import styles from './full-player.module.css';

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** Slides up over everything. Drag down anywhere (or tap the handle) to close. */
export function FullPlayer() {
  const expanded = usePlayer((s) => s.expanded);
  const hasTrack = usePlayer((s) => s.queue.length > 0);
  const open = expanded && hasTrack;

  const { mounted, ref } = usePresence<HTMLDivElement>(
    open,
    (el) => [el.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 340, easing: EASE })],
    (el) => {
      const from = el.style.transform || 'translateY(0)';
      el.style.transform = '';
      return [el.animate([{ transform: from }, { transform: 'translateY(100%)' }], { duration: 300, easing: EASE, fill: 'forwards' })];
    },
  );

  // Drag to dismiss.
  const drag = useRef<{ id: number; y: number; x: number; engaged: boolean; lastY: number; lastT: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    drag.current = { id: e.pointerId, y: e.clientY, x: e.clientX, engaged: false, lastY: e.clientY, lastT: e.timeStamp };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y;
    if (!d.engaged) {
      if (Math.abs(e.clientX - d.x) > 12 && Math.abs(e.clientX - d.x) > dy) {
        drag.current = null;
        return;
      }
      if (dy < 10) return;
      d.engaged = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    e.currentTarget.style.transform = `translateY(${Math.max(0, dy)}px)`;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || !d.engaged) return;
    const el = e.currentTarget;
    const dy = Math.max(0, e.clientY - d.y);
    const velocity = (e.clientY - d.lastY) / Math.max(1, e.timeStamp - d.lastT);
    if (e.type === 'pointerup' && (dy > el.clientHeight * 0.22 || velocity > 0.6)) {
      closePlayer();
    } else {
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 260, easing: EASE });
      el.style.transform = '';
    }
  };

  if (!mounted) return null;

  return createPortal(
    <>
      <div
        ref={ref}
        className={styles.player}
        data-closing={!open || undefined}
        role="dialog"
        aria-label="Now playing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <PlayerContent />
      </div>
      <QueueSheet />
    </>,
    document.body,
  );
}

function PlayerContent() {
  const track = usePlayer((s) => currentTrack(s));
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const airPlay = useAirPlayAvailable();
  const stage = useRef<HTMLDivElement>(null);
  const artSize = useArtSize(stage);

  if (!track) return null;

  return (
    <>
      <button type="button" className={styles.handleButton} onClick={closePlayer} aria-label="Close player">
        <span className={styles.handle} />
      </button>

      <div ref={stage} className={styles.stage}>
        <div className={styles.artFrame} style={{ width: artSize, height: artSize }}>
          <Artwork art={track.art} size={artSize} radius={14} eager />
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.titleRow}>
          <div className={styles.titles}>
            <h2 className={styles.title}>{track.name}</h2>
            <p className={styles.artist}>{artistLine(track)}</p>
          </div>
        </div>

        <Scrubber />

        <div className={styles.transport}>
          <button
            type="button"
            className={styles.side}
            data-active={shuffle || undefined}
            onClick={() => setShuffle(!shuffle)}
            aria-label="Shuffle"
            aria-pressed={shuffle}
          >
            <Shuffle size={22} strokeWidth={2} />
          </button>
          <button type="button" className={styles.skip} onClick={previous} aria-label="Previous song">
            <SkipBack size={30} fill="currentColor" strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.play}
            data-buffering={(buffering && playing) || undefined}
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <Pause size={27} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={27} fill="currentColor" strokeWidth={0} className={styles.playGlyph} />
            )}
          </button>
          <button type="button" className={styles.skip} onClick={next} aria-label="Next song">
            <SkipForward size={30} fill="currentColor" strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.side}
            data-active={repeat !== 'off' || undefined}
            onClick={cycleRepeat}
            aria-label={`Repeat: ${repeat}`}
          >
            {repeat === 'one' ? <Repeat1 size={22} strokeWidth={2} /> : <Repeat size={22} strokeWidth={2} />}
          </button>
        </div>

        <div className={styles.secondary}>
          {airPlay ? (
            <button
              type="button"
              className={styles.side}
              onClick={() => (audio as HTMLAudioElement & { webkitShowPlaybackTargetPicker(): void }).webkitShowPlaybackTargetPicker()}
              aria-label="AirPlay"
            >
              <Airplay size={22} strokeWidth={2} />
            </button>
          ) : (
            <span className={styles.side} />
          )}
          <button type="button" className={styles.side} onClick={() => setQueueOpen(true)} aria-label="Queue">
            <ListMusic size={23} strokeWidth={2} />
          </button>
        </div>
      </div>
    </>
  );
}

/** The cover as large as fits: up to 320 wide, never crowding the controls. */
function useArtSize(stage: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState(300);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize(Math.max(120, Math.floor(Math.min(width, height - 24, 360))));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [stage]);
  return size;
}

/** Safari's AirPlay picker, offered only when a receiver is around. */
function useAirPlayAvailable() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!('WebKitPlaybackTargetAvailabilityEvent' in window)) return;
    const onChange = (e: Event) => setAvailable((e as Event & { availability: string }).availability === 'available');
    audio.addEventListener('webkitplaybacktargetavailabilitychanged', onChange);
    return () => audio.removeEventListener('webkitplaybacktargetavailabilitychanged', onChange);
  }, []);
  return available;
}

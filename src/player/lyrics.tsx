import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';

import { useLyrics } from '@/data/queries';
import { ticksToSeconds } from '@/jellyfin/api';
import { audio, currentPosition, seek } from './player';
import styles from './lyrics.module.css';

/** Lyrics shown instead of the bare cover; stays on from song to song. */
export const useLyricsView = create(() => ({ open: false }));
export const toggleLyrics = () => useLyricsView.setState((s) => ({ open: !s.open }));

interface Line {
  text: string;
  /** Seconds into the song; null for plain (untimed) lyrics. */
  start: number | null;
}

/** After scrolling by hand, the lyrics wait this long before following the song again. */
const HAND_SCROLL_PAUSE_MS = 3500;

/** The lyrics over the blurred cover, filling the space above the song title. */
export function LyricsPanel({ trackId }: { trackId: string }) {
  const query = useLyrics(trackId, true);

  const lines = useMemo<Line[]>(() => {
    const raw = query.data?.Lyrics ?? [];
    const timed = query.data?.Metadata?.IsSynced ?? raw.some((l) => l.Start != null);
    return raw.map((l) => ({ text: l.Text.trim(), start: timed && l.Start != null ? ticksToSeconds(l.Start) : null }));
  }, [query.data]);

  if (query.data) return <LyricLines key={trackId} lines={lines} />;

  let message = '';
  if (query.data === null) message = 'No lyrics for this song yet';
  else if (query.fetchStatus === 'paused') message = 'Lyrics need a connection';
  else if (query.isError) message = 'Couldn’t load the lyrics';

  return (
    <div className={styles.panel} data-no-drag>
      <p className={styles.message}>{message}</p>
    </div>
  );
}

function LyricLines({ lines }: { lines: Line[] }) {
  const timed = lines.some((l) => l.start != null);
  const active = useActiveLine(lines, timed);
  const scroller = useRef<HTMLDivElement>(null);
  const handScrollUntil = useRef(0);
  const placed = useRef(false);

  // Keep the current line a third of the way down, unless the reader is scrolling.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !timed || Date.now() < handScrollUntil.current) return;
    const line = el.children[Math.max(0, active)] as HTMLElement | undefined;
    if (!line) return;
    const top = Math.max(0, line.offsetTop - el.clientHeight * 0.33 + line.offsetHeight / 2);
    // The first placement jumps; later lines glide.
    el.scrollTo({ top, behavior: placed.current ? 'smooth' : 'auto' });
    placed.current = true;
  }, [active, timed]);

  const onHandScroll = () => {
    handScrollUntil.current = Date.now() + HAND_SCROLL_PAUSE_MS;
  };

  return (
    <div
      ref={scroller}
      className={styles.panel}
      data-timed={timed || undefined}
      data-no-drag
      onTouchMove={onHandScroll}
      onWheel={onHandScroll}
    >
      {lines.map((line, i) => (
        <LyricLine
          key={i}
          line={line}
          state={!timed ? 'plain' : i === active ? 'active' : 'idle'}
          onSeek={() => {
            handScrollUntil.current = 0;
            seek(line.start!);
          }}
        />
      ))}
      {timed && <div className={styles.end} />}
    </div>
  );
}

const LyricLine = memo(function LyricLine({
  line,
  state,
  onSeek,
}: {
  line: Line;
  state: 'plain' | 'active' | 'idle';
  onSeek: () => void;
}) {
  // An empty line is a pause in the singing: a gap, nothing to tap.
  if (!line.text) return <div className={styles.gap} />;
  if (state === 'plain') return <p className={styles.line}>{line.text}</p>;
  return (
    <button type="button" className={styles.line} data-active={state === 'active' || undefined} onClick={onSeek}>
      {line.text}
    </button>
  );
}, (a, b) => a.line === b.line && a.state === b.state);

/**
 * Index of the line being sung (-1 before the first). Follows every frame while
 * playing, but only re-renders when the line changes.
 */
function useActiveLine(lines: Line[], timed: boolean) {
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (!timed) return;
    const update = () => {
      const now = currentPosition();
      let index = -1;
      for (let i = 0; i < lines.length; i++) {
        const start = lines[i].start;
        if (start == null) continue;
        if (start > now) break;
        index = i;
      }
      setActive(index);
    };

    let frame = 0;
    const tick = () => {
      update();
      frame = requestAnimationFrame(tick);
    };
    const startFrames = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const stopFrames = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      update();
    };
    const events = ['timeupdate', 'seeked', 'loadedmetadata', 'emptied'];
    for (const event of events) audio.addEventListener(event, update);
    audio.addEventListener('playing', startFrames);
    audio.addEventListener('pause', stopFrames);
    if (!audio.paused) startFrames();
    update();

    return () => {
      for (const event of events) audio.removeEventListener(event, update);
      audio.removeEventListener('playing', startFrames);
      audio.removeEventListener('pause', stopFrames);
      cancelAnimationFrame(frame);
    };
  }, [lines, timed]);

  return active;
}

import { X } from 'lucide-react';
import { useRef, useState, type PointerEvent } from 'react';
import { create } from 'zustand';

import { LyricsPanel } from './lyrics';
import { currentTrack, usePlayer } from './player';
import { QueueList } from './queue-sheet';
import styles from './side-panel.module.css';

export type SideView = 'queue' | 'lyrics';

const KEY = 'jj.sidePanel';
const WIDTH_KEY = 'jj.sidePanelWidth';
export const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 280;
/** The frame can take up to half the window. */
const maxWidth = () => Math.floor(window.innerWidth * 0.5);

function saved(): SideView | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'queue' || value === 'lyrics' ? value : null;
  } catch {
    return null;
  }
}

function savedWidth() {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return value >= MIN_WIDTH ? value : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/** Desktop: which panel is open at the right edge and how wide it is (both remembered). */
export const useSidePanel = create<{ view: SideView | null; width: number }>(() => ({
  view: saved(),
  width: savedWidth(),
}));

function setWidth(width: number, remember: boolean) {
  const value = Math.round(Math.min(maxWidth(), Math.max(MIN_WIDTH, width)));
  useSidePanel.setState({ width: value });
  if (!remember) return;
  try {
    localStorage.setItem(WIDTH_KEY, String(value));
  } catch {
    // Not remembered; no harm.
  }
}

function setView(view: SideView | null) {
  useSidePanel.setState({ view });
  try {
    if (view) localStorage.setItem(KEY, view);
    else localStorage.removeItem(KEY);
  } catch {
    // Not remembered; no harm.
  }
}

/** The player bar's Queue and Lyrics buttons: open that panel, or close it if it's showing. */
export const toggleSidePanel = (view: SideView) => setView(useSidePanel.getState().view === view ? null : view);

/**
 * The frame's left edge: drag it to make the panel wider or narrower (up to
 * half the window); double-click puts it back to the usual width.
 */
function ResizeHandle() {
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, width: useSidePanel.getState().width };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    // Dragging left widens it: the frame is anchored to the right edge.
    setWidth(d.width + d.x - e.clientX, false);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    setWidth(useSidePanel.getState().width, true);
  };

  return (
    <div
      className={styles.resize}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setWidth(DEFAULT_WIDTH, true)}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      title="Drag to resize"
    />
  );
}

/** Queue or lyrics, in their own frame at the right edge of the window. */
export function SidePanel({ view }: { view: SideView }) {
  const track = usePlayer((s) => currentTrack(s));
  return (
    <aside className={styles.frame} aria-label={view === 'queue' ? 'Queue' : 'Lyrics'}>
      <ResizeHandle />
      <header className={styles.header}>
        <h2 className={styles.title}>{view === 'queue' ? 'Queue' : 'Lyrics'}</h2>
        <button type="button" className={styles.close} onClick={() => setView(null)} aria-label="Close" title="Close">
          <X size={18} strokeWidth={2.2} />
        </button>
      </header>
      {view === 'queue' ? (
        <div className={styles.scroll}>
          <QueueList />
        </div>
      ) : (
        <div className={styles.lyrics}>{track && <LyricsPanel trackId={track.id} side />}</div>
      )}
    </aside>
  );
}

import { Plus } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

import { artistLine, type Track } from '@/player/track';
import { Artwork } from '@/ui/artwork';
import { isDesktop } from '@/ui/use-desktop';
import { setLiked } from './likes';
import { addToPlaylist } from './playlists';
import styles from './song-drag.module.css';

/**
 * Desktop: drag a song row onto a playlist in the sidebar to add it there, or
 * onto Liked Songs to like it. Built on pointer events (not the browser's drag
 * and drop) so the song and the (+) can follow the mouse and change as it
 * moves over a target. Drop targets are elements with `data-drop-id` (a
 * playlist id, or "liked") and `data-drop-name`.
 */

interface DropTarget {
  /** A playlist id, or "liked" for Liked Songs. */
  id: string;
  name: string;
}

interface DragState {
  track: Track | null;
  x: number;
  y: number;
  target: DropTarget | null;
}

export const useSongDrag = create<DragState>(() => ({ track: null, x: 0, y: 0, target: null }));

/** How far the mouse moves with the button down before it's a drag, not a click (px). */
const THRESHOLD = 6;

function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-id]');
  return el ? { id: el.dataset.dropId!, name: el.dataset.dropName ?? '' } : null;
}

/** Call on a song row's pointerdown; becomes a drag once the mouse moves. */
export function beginSongDrag(event: ReactPointerEvent, track: Track) {
  if (event.button !== 0 || event.pointerType !== 'mouse' || !isDesktop()) return;
  if ((event.target as HTMLElement).closest('[data-no-song-drag]')) return;
  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;

  const onMove = (e: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
      dragging = true;
      document.documentElement.dataset.songDrag = '';
    }
    const target = targetAt(e.clientX, e.clientY);
    const previous = useSongDrag.getState().target;
    useSongDrag.setState({ track, x: e.clientX, y: e.clientY, target: previous?.id === target?.id ? previous : target });
  };

  const finish = (drop: boolean) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, { capture: true });
    if (!dragging) return;
    const { target } = useSongDrag.getState();
    useSongDrag.setState({ track: null, target: null });
    delete document.documentElement.dataset.songDrag;
    // Letting go ends the drag; it mustn't also count as a click (which plays the song).
    const swallow = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    if (!drop || !target) return;
    // Liking shows no message, as everywhere: the song's heart turns red.
    if (target.id === 'liked') void setLiked(track, true);
    else void addToPlaylist({ Id: target.id, Name: target.name }, [track.id]);
  };

  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !dragging) return;
    e.stopPropagation();
    finish(false);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, { capture: true });
}

/** The song following the mouse, with a (+) once it's over a playlist or Liked Songs. */
export function SongDragGhost() {
  const { track, x, y, target } = useSongDrag();
  if (!track) return null;
  return createPortal(
    <div className={styles.ghost} style={{ transform: `translate(${x}px, ${y}px)` }} data-over={target ? true : undefined}>
      <span className={styles.add} aria-hidden="true">
        <Plus size={16} strokeWidth={2.6} />
      </span>
      <div className={styles.chip}>
        <Artwork art={track.art} size={32} radius={6} eager />
        <span className={styles.text}>
          <span className={styles.title}>{track.name}</span>
          <span className={styles.subtitle}>{target ? `Add to ${target.name}` : artistLine(track)}</span>
        </span>
      </div>
    </div>,
    document.body,
  );
}

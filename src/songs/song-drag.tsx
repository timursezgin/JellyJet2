import { Ban, Plus } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

import { artworkOf } from '@/jellyfin/api';
import type { BaseItem } from '@/jellyfin/types';
import { artistLine, type Track } from '@/player/track';
import { albumSubtitle } from '@/ui/album-subtitle';
import { Artwork } from '@/ui/artwork';
import { isDesktop } from '@/ui/use-desktop';
import { setAlbumLiked } from './liked-albums';
import { setLiked } from './likes';
import { addToPlaylist } from './playlists';
import styles from './song-drag.module.css';

/**
 * Desktop: drag a song row onto a playlist in the sidebar to add it there, or
 * onto Liked Songs to like it; drag an album cover onto Liked Albums to like
 * the album (the only place an album can go). Built on pointer events (not the
 * browser's drag and drop) so the item and a (+) - or a "no" sign over a place
 * that won't take it - follow the mouse. Drop targets are elements with
 * `data-drop-id` (a playlist id, "liked" or "liked-albums") and `data-drop-name`.
 */

interface DropTarget {
  /** A playlist id, "liked" for Liked Songs or "liked-albums" for Liked Albums. */
  id: string;
  name: string;
}

export type DragItem = { kind: 'song'; track: Track } | { kind: 'album'; album: BaseItem };

interface DragState {
  item: DragItem | null;
  x: number;
  y: number;
  target: DropTarget | null;
}

export const useSongDrag = create<DragState>(() => ({ item: null, x: 0, y: 0, target: null }));

/** Whether a place takes what's dragged: albums only go to Liked Albums, songs everywhere else. */
export function accepts(kind: DragItem['kind'], targetId: string) {
  return kind === 'album' ? targetId === 'liked-albums' : targetId !== 'liked-albums';
}

/** How far the mouse moves with the button down before it's a drag, not a click (px). */
const THRESHOLD = 6;

function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-id]');
  return el ? { id: el.dataset.dropId!, name: el.dataset.dropName ?? '' } : null;
}

/** Call on a song row's pointerdown; becomes a drag once the mouse moves. */
export const beginSongDrag = (event: ReactPointerEvent, track: Track) => beginDrag(event, { kind: 'song', track });

/** Call on an album cover's pointerdown. */
export const beginAlbumDrag = (event: ReactPointerEvent, album: BaseItem) => beginDrag(event, { kind: 'album', album });

function beginDrag(event: ReactPointerEvent, item: DragItem) {
  if (event.button !== 0 || event.pointerType !== 'mouse' || !isDesktop()) return;
  if ((event.target as HTMLElement).closest('[data-no-song-drag]')) return;
  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;
  const root = document.documentElement;

  const onMove = (e: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
      dragging = true;
      root.dataset.songDrag = '';
    }
    const target = targetAt(e.clientX, e.clientY);
    const previous = useSongDrag.getState().target;
    if (target && !accepts(item.kind, target.id)) root.dataset.dragRefused = '';
    else delete root.dataset.dragRefused;
    useSongDrag.setState({ item, x: e.clientX, y: e.clientY, target: previous?.id === target?.id ? previous : target });
  };

  const finish = (drop: boolean) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, { capture: true });
    if (!dragging) return;
    const { target } = useSongDrag.getState();
    useSongDrag.setState({ item: null, target: null });
    delete root.dataset.songDrag;
    delete root.dataset.dragRefused;
    // Letting go ends the drag; it mustn't also count as a click (which plays the song or opens the album).
    const swallow = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    if (!drop || !target || !accepts(item.kind, target.id)) return;
    // Liking shows no message, as everywhere: the heart turns red.
    if (item.kind === 'album') void setAlbumLiked(item.album, true);
    else if (target.id === 'liked') void setLiked(item.track, true);
    else void addToPlaylist({ Id: target.id, Name: target.name }, [item.track.id]);
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

/** What's following the mouse: a (+) over a place that takes it, a "no" sign over one that doesn't. */
export function SongDragGhost() {
  const { item, x, y, target } = useSongDrag();
  if (!item) return null;
  const refused = target !== null && !accepts(item.kind, target.id);
  const song = item.kind === 'song' ? item.track : null;
  const album = item.kind === 'album' ? item.album : null;
  let subtitle = song ? artistLine(song) : albumSubtitle(album!);
  if (target) {
    if (!refused) subtitle = `Add to ${target.name}`;
    else subtitle = album ? 'Albums only go in Liked Albums' : 'Only albums go in Liked Albums';
  }
  return createPortal(
    <div
      className={styles.ghost}
      style={{ transform: `translate(${x}px, ${y}px)` }}
      data-over={(target && !refused) || undefined}
      data-refused={refused || undefined}
    >
      <span className={styles.add} aria-hidden="true">
        <Plus size={16} strokeWidth={2.6} />
      </span>
      <span className={styles.refuse} aria-hidden="true">
        <Ban size={15} strokeWidth={2.6} />
      </span>
      <div className={styles.chip}>
        <Artwork art={song ? song.art : artworkOf(album!)} size={32} radius={6} eager />
        <span className={styles.text}>
          <span className={styles.title}>{song ? song.name : album!.Name}</span>
          <span className={styles.subtitle}>{subtitle}</span>
        </span>
      </div>
    </div>,
    document.body,
  );
}

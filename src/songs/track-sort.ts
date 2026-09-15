import { useState } from 'react';

import { artistLine, type Track } from '@/player/track';

/** The columns a song list can be sorted by (desktop column headers). */
export type SortKey = 'title' | 'artist' | 'album' | 'duration';

export interface TrackSort {
  key: SortKey;
  descending: boolean;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const value: Record<Exclude<SortKey, 'duration'>, (t: Track) => string> = {
  title: (t) => t.name,
  artist: (t) => artistLine(t),
  album: (t) => t.album ?? '',
};

/** A sorted copy; ties keep the list's own order (then go by title). */
export function sortTracks<T extends Track>(tracks: T[], sort: TrackSort | null): T[] {
  if (!sort) return tracks;
  const direction = sort.descending ? -1 : 1;
  const compare =
    sort.key === 'duration'
      ? (a: T, b: T) => a.duration - b.duration
      : (a: T, b: T) => collator.compare(value[sort.key as 'title'](a), value[sort.key as 'title'](b));
  return [...tracks].sort((a, b) => direction * compare(a, b) || collator.compare(a.name, b.name));
}

/**
 * Clicking a column: sort by it A-Z (shortest first), again for Z-A, and a
 * third time back to the list's own order. `fixed` lists (the server sorts
 * them) always have some order, so they just flip.
 */
export function nextSort(current: TrackSort | null, key: SortKey, fixed = false): TrackSort | null {
  if (current?.key !== key) return { key, descending: false };
  if (!current.descending) return { key, descending: true };
  return fixed ? { key, descending: false } : null;
}

/** Sort state for one list; starts in the list's own order. */
export function useTrackSort(initial: TrackSort | null = null, fixed = false) {
  const [sort, setSort] = useState<TrackSort | null>(initial);
  return [sort, (key: SortKey) => setSort((s) => nextSort(s, key, fixed))] as const;
}

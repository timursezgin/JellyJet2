import { createStore, del, get as idbGet, set as idbSet } from 'idb-keyval';
import { create } from 'zustand';

import type { Track } from '@/player/track';

/**
 * What's downloaded, for the signed-in account.
 *
 * A song is downloaded or not - one copy, whatever brought it in. Each copy
 * remembers its "sources": `song` (downloaded on its own) and/or the
 * collections that include it (`album:<id>`, `playlist:<id>`, `liked`,
 * `liked-albums`).
 * The file stays while it has at least one source.
 *
 * A downloaded collection fetches songs added to it later, except ones whose
 * download was removed by hand (its `excluded` list).
 *
 * Files live in the site's Cache Storage (see engine.ts); this index lives in
 * IndexedDB. Both sit in the site's protected storage on the phone.
 */

export type SongSource = string;
export type CollectionKind = 'album' | 'playlist' | 'liked' | 'liked-albums';

export interface DownloadedSong {
  track: Track;
  sources: SongSource[];
  size: number;
  mime: string;
  quality: 'original' | 'smaller';
  addedAt: number;
}

export interface DownloadedCollection {
  key: string;
  kind: CollectionKind;
  id: string;
  name: string;
  art: { id: string; tag: string } | null;
  /** The collection's songs when last checked, in order. */
  trackIds: string[];
  /** Songs whose download was removed by hand: never fetched again automatically. */
  excluded: string[];
  addedAt: number;
}

export interface DownloadJob {
  track: Track;
  sources: SongSource[];
}

interface DownloadsState {
  userId: string | null;
  loaded: boolean;
  songs: Record<string, DownloadedSong>;
  collections: Record<string, DownloadedCollection>;
  /** Waiting or in progress, in order. */
  jobs: DownloadJob[];
  /** Song id → 0…1 while its file is being fetched. */
  progress: Record<string, number>;
  /** Downloaded songs whose file has gone missing from storage. */
  missing: Record<string, true>;
}

export const useDownloads = create<DownloadsState>(() => ({
  userId: null,
  loaded: false,
  songs: {},
  collections: {},
  jobs: [],
  progress: {},
  missing: {},
}));

/** Liked Songs and Liked Albums are one of a kind: their key is just their kind. */
export const collectionKey = (kind: CollectionKind, id: string) =>
  kind === 'liked' || kind === 'liked-albums' ? kind : `${kind}:${id}`;

// --- Persistence ------------------------------------------------------------

const idb = createStore('jellyjet2-downloads', 'index');
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const changeListeners = new Set<() => void>();

/** Called (debounced) after downloads change - the backup listens. */
export function onDownloadsChanged(fn: () => void) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

export async function loadDownloads(userId: string) {
  if (useDownloads.getState().userId === userId && useDownloads.getState().loaded) return;
  const [songs, collections, jobs] = await Promise.all([
    idbGet<Record<string, DownloadedSong>>(`songs:${userId}`, idb),
    idbGet<Record<string, DownloadedCollection>>(`collections:${userId}`, idb),
    idbGet<DownloadJob[]>(`jobs:${userId}`, idb),
  ]).catch(() => [undefined, undefined, undefined] as const);
  useDownloads.setState({
    userId,
    loaded: true,
    songs: songs ?? {},
    collections: collections ?? {},
    jobs: jobs ?? [],
    progress: {},
    missing: {},
  });
}

export function unloadDownloads() {
  useDownloads.setState({ userId: null, loaded: false, songs: {}, collections: {}, jobs: [], progress: {}, missing: {} });
}

function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { userId, songs, collections, jobs } = useDownloads.getState();
    if (!userId) return;
    void Promise.all([
      idbSet(`songs:${userId}`, songs, idb),
      idbSet(`collections:${userId}`, collections, idb),
      jobs.length ? idbSet(`jobs:${userId}`, jobs, idb) : del(`jobs:${userId}`, idb),
    ]).catch(() => {});
    for (const fn of changeListeners) fn();
  }, 400);
}

/** Apply a change to the index and save it. */
export function updateDownloads(change: (state: DownloadsState) => Partial<DownloadsState>) {
  useDownloads.setState(change);
  persistSoon();
}

// --- Reading -------------------------------------------------------------------

export type SongDownloadState =
  | { status: 'none' }
  | { status: 'queued' }
  | { status: 'downloading'; progress: number }
  | { status: 'done' }
  | { status: 'missing' };

/** Ids of the songs waiting to download, built once per queue (progress updates are frequent). */
const queuedIds = new WeakMap<DownloadsState['jobs'], Set<string>>();
function isQueued(jobs: DownloadsState['jobs'], id: string) {
  let ids = queuedIds.get(jobs);
  if (!ids) {
    ids = new Set(jobs.map((j) => j.track.id));
    queuedIds.set(jobs, ids);
  }
  return ids.has(id);
}

export function songDownloadState(state: DownloadsState, id: string): SongDownloadState {
  if (state.missing[id]) return { status: 'missing' };
  if (state.songs[id]) return { status: 'done' };
  const progress = state.progress[id];
  if (progress !== undefined) return { status: 'downloading', progress };
  if (isQueued(state.jobs, id)) return { status: 'queued' };
  return { status: 'none' };
}

/** Whether a song can play from this device right now. */
export const isDownloaded = (id: string) => {
  const state = useDownloads.getState();
  return !!state.songs[id] && !state.missing[id];
};

export function useIsDownloaded(id: string) {
  return useDownloads((s) => !!s.songs[id] && !s.missing[id]);
}

export type CollectionDownloadState =
  | { status: 'none' }
  | { status: 'downloading'; done: number; total: number }
  | { status: 'done' };

export function collectionDownloadState(state: DownloadsState, key: string): CollectionDownloadState {
  const collection = state.collections[key];
  if (!collection) return { status: 'none' };
  const wanted = collection.trackIds.filter((id) => !collection.excluded.includes(id));
  const pending = state.jobs.filter((j) => j.sources.includes(key)).length;
  if (pending === 0) return { status: 'done' };
  return { status: 'downloading', done: Math.max(0, wanted.length - pending), total: wanted.length };
}

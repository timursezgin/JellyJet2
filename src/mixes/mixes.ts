import { create } from 'zustand';

import { useSession } from '@/auth/session';
import { isOnline } from '@/connectivity/connection';
import { queryClient } from '@/data/query-client';
import * as api from '@/jellyfin/api';
import { generateMixes, type Mix } from './generator';

/**
 * The pool of generated mixes. Home shows eight at a time; Regenerate moves on
 * to the next eight and builds a fresh pool once they have all been shown. The
 * pool is kept on the phone, so mixes stay put between launches (and offline)
 * until Regenerate is tapped.
 */

export const MIXES_IN_VIEW = 8;
/** Regenerate slides the window on by half a screen: half the cards are new. */
const REGENERATE_STEP = MIXES_IN_VIEW / 2;

interface MixesState {
  userId: string | null;
  pool: Mix[];
  windowStart: number;
  generating: boolean;
  error: string | null;
}

export const useMixes = create<MixesState>(() => ({
  userId: null,
  pool: [],
  windowStart: 0,
  generating: false,
  error: null,
}));

const storageKey = (userId: string) => `jj.mixes.${userId}`;

/** Loads the signed-in account's saved mixes; builds the first set if there are none. */
export function loadMixes(userId: string) {
  if (useMixes.getState().userId === userId) return;
  let saved: Pick<MixesState, 'pool' | 'windowStart'> | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey(userId)) ?? 'null');
  } catch {
    saved = null;
  }
  useMixes.setState({
    userId,
    pool: saved?.pool ?? [],
    windowStart: saved?.windowStart ?? 0,
    generating: false,
    error: null,
  });
  if (!saved?.pool.length) void buildPool();
}

function save() {
  const { userId, pool, windowStart } = useMixes.getState();
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify({ pool, windowStart }));
  } catch {
    // Storage full: the mixes still work until the app closes.
  }
}

export function visibleMixes(state: Pick<MixesState, 'pool' | 'windowStart'>): Mix[] {
  const { pool, windowStart } = state;
  return Array.from({ length: Math.min(MIXES_IN_VIEW, pool.length) }, (_, i) => pool[(windowStart + i) % pool.length]);
}

export const findMix = (id: string) => useMixes.getState().pool.find((m) => m.id === id);

/** Regenerate: the next few mixes from the pool, or a new pool once it's used up. */
export async function regenerateMixes() {
  const { pool, windowStart, generating } = useMixes.getState();
  if (generating) return;
  const next = windowStart + REGENERATE_STEP;
  // Move along while that brings in cards not on screen; otherwise build new
  // mixes, so Regenerate always changes what's shown.
  if (pool.length >= next + REGENERATE_STEP) {
    useMixes.setState({ windowStart: next });
    save();
    return;
  }
  await buildPool();
}

async function buildPool() {
  const { client, session } = useSession.getState();
  const userId = session?.userId;
  if (!client || !userId || useMixes.getState().generating) return;
  if (!isOnline()) {
    useMixes.setState({ error: 'New mixes need a connection.' });
    return;
  }
  useMixes.setState({ generating: true, error: null });
  try {
    const parentId = await queryClient.fetchQuery({
      queryKey: ['music-library', userId],
      queryFn: () => api.musicLibraryId(client),
      staleTime: Infinity,
    });
    const pool = await generateMixes(client, userId, parentId);
    if (useMixes.getState().userId !== userId) return; // signed out meanwhile
    useMixes.setState({
      pool: pool.length ? pool : useMixes.getState().pool,
      windowStart: 0,
      generating: false,
      error: pool.length ? null : 'Play some music and your mixes will appear here.',
    });
    save();
  } catch {
    useMixes.setState({ generating: false, error: 'Couldn’t build mixes.' });
  }
}

/** Signing out: the next account starts with its own mixes. */
export function unloadMixes() {
  useMixes.setState({ userId: null, pool: [], windowStart: 0, generating: false, error: null });
}

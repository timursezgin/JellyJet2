import { create } from 'zustand';

import { useSession } from '@/auth/session';
import { queryClient } from '@/data/query-client';
import * as api from '@/jellyfin/api';
import {
  cancelJob,
  checkKey,
  isActiveJob,
  listJobs,
  PipelineError,
  queueAlbum,
  searchAlbums,
  type AlbumResult,
  type DownloadJob,
} from './client';

/**
 * Add albums: the key for the download server, the Soulseek search, and the
 * list of album downloads (checked every 10 seconds while any is running).
 */

const KEY_STORAGE = 'jj.pipelineKey';
const POLL_MS = 10_000;

interface PipelineState {
  key: string | null;
  query: string;
  searching: boolean;
  results: AlbumResult[] | null;
  searchError: string | null;
  jobs: DownloadJob[];
  jobsError: string | null;
}

function savedKey() {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export const usePipeline = create<PipelineState>(() => ({
  key: savedKey(),
  query: '',
  searching: false,
  results: null,
  searchError: null,
  jobs: [],
  jobsError: null,
}));

const message = (error: unknown, fallback: string) => (error instanceof PipelineError ? error.message : fallback);

/** Checks the key with the server, then keeps it on this phone. */
export async function connectPipeline(key: string): Promise<string | null> {
  try {
    await checkKey(key);
  } catch (error) {
    return message(error, 'Couldn’t connect.');
  }
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    // Kept for this session only.
  }
  usePipeline.setState({ key });
  void refreshJobs();
  return null;
}

/** Forgets the key (and everything shown), e.g. when signing out. */
export function forgetPipeline() {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    // nothing stored
  }
  stopPolling();
  hiddenAtStart = null;
  lastState.clear();
  usePipeline.setState({ key: null, query: '', searching: false, results: null, searchError: null, jobs: [], jobsError: null });
}

/** The server rejected the key: ask for it again. */
function onError(error: unknown) {
  if (error instanceof PipelineError && error.badKey) forgetPipeline();
}

// --- Search -----------------------------------------------------------------

let searchRun = 0;

export async function searchSoulseek(query: string) {
  const key = usePipeline.getState().key;
  const q = query.trim();
  if (!key || q.length < 2) return;
  const run = ++searchRun;
  usePipeline.setState({ query: q, searching: true, results: null, searchError: null });
  try {
    const results = await searchAlbums(key, q);
    if (run === searchRun) usePipeline.setState({ searching: false, results });
  } catch (error) {
    onError(error);
    if (run === searchRun) usePipeline.setState({ searching: false, searchError: message(error, 'Search failed.') });
  }
}

export function clearSearch() {
  searchRun++;
  usePipeline.setState({ query: '', searching: false, results: null, searchError: null });
}

export const findResult = (id: string) => usePipeline.getState().results?.find((r) => r.id === id);

// --- Downloads ----------------------------------------------------------------

/** Jobs already finished when the list was first loaded aren't news; failed ones stay until dismissed. */
let hiddenAtStart: Set<string> | null = null;
const lastState = new Map<string, string>();
let timer: number | undefined;

function stopPolling() {
  window.clearTimeout(timer);
  timer = undefined;
}

export async function refreshJobs() {
  const key = usePipeline.getState().key;
  if (!key) return;
  stopPolling();
  try {
    const jobs = await listJobs(key);
    if (usePipeline.getState().key !== key) return;
    hiddenAtStart ??= new Set(jobs.filter((j) => j.state === 'inLibrary').map((j) => j.jobId));
    noticeArrivals(jobs);
    usePipeline.setState({ jobs: jobs.filter((j) => !hiddenAtStart!.has(j.jobId)), jobsError: null });
    if (jobs.some(isActiveJob)) timer = window.setTimeout(() => void refreshJobs(), POLL_MS);
  } catch (error) {
    onError(error);
    if (!usePipeline.getState().key) return;
    usePipeline.setState({ jobsError: message(error, 'Couldn’t load downloads.') });
    // Try again a little later; the last list stays on screen.
    if (usePipeline.getState().jobs.some(isActiveJob)) timer = window.setTimeout(() => void refreshJobs(), POLL_MS * 2);
  }
}

/** An album just reached the library: have Jellyfin look now, then refresh the lists that show new albums. */
function noticeArrivals(jobs: DownloadJob[]) {
  let arrived = false;
  for (const job of jobs) {
    const before = lastState.get(job.jobId);
    if (job.state === 'inLibrary' && before !== undefined && before !== 'inLibrary') arrived = true;
    lastState.set(job.jobId, job.state);
  }
  if (!arrived) return;
  const client = useSession.getState().client;
  if (client) void api.refreshLibrary(client).catch(() => {});
  for (const delay of [4_000, 20_000]) {
    window.setTimeout(() => {
      for (const key of ['recently-added-albums', 'library-counts', 'albums', 'artists']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    }, delay);
  }
}

export async function downloadAlbum(album: AlbumResult): Promise<string | null> {
  const key = usePipeline.getState().key;
  if (!key) return 'Not connected.';
  try {
    await queueAlbum(key, album);
  } catch (error) {
    onError(error);
    return message(error, 'Couldn’t start that download.');
  }
  await refreshJobs();
  return null;
}

/** Stops a download (deleting what arrived) or clears a finished one, on the server. */
export async function cancelOrDismissJob(jobId: string): Promise<string | null> {
  const key = usePipeline.getState().key;
  if (!key) return 'Not connected.';
  try {
    await cancelJob(key, jobId);
    return null;
  } catch (error) {
    onError(error);
    return message(error, 'Couldn’t remove that.');
  }
}

/** Takes a cancelled or dismissed job off the list. */
export function forgetJob(jobId: string) {
  usePipeline.setState((s) => ({ jobs: s.jobs.filter((j) => j.jobId !== jobId) }));
  void refreshJobs();
}

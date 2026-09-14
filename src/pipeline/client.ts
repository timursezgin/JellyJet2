import { pipelineUrl } from '@/lib/server';

/**
 * The download orchestrator on tim-box (watcher.py): it searches Soulseek
 * through slskd, downloads whole album folders, has beets tag them and files
 * them into the Jellyfin library. Reached through this site's /pipeline path;
 * every call but /ping needs the key from its api_key.txt.
 */

export interface AlbumFile {
  filename: string;
  size: number;
  bitrate?: number;
  /** Seconds. */
  length?: number;
}

/** One album folder shared by a Soulseek user. */
export interface AlbumResult {
  id: string;
  user: string;
  dir: string;
  folderName: string;
  artist?: string | null;
  album?: string | null;
  year?: number | null;
  trackCount: number;
  totalBytes: number;
  bitrate?: number | null;
  format: string;
  hasFreeSlot: boolean;
  queueLength: number;
  files: AlbumFile[];
}

export type JobState = 'queued' | 'downloading' | 'tagging' | 'inLibrary' | 'failed';

export interface DownloadJob {
  jobId: string;
  artist?: string | null;
  album?: string | null;
  folderName: string;
  trackCount?: number | null;
  state: JobState | string;
  progress: number;
  note?: string;
}

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly network = false,
  ) {
    super(message);
  }
  get badKey() {
    return this.status === 401;
  }
}

async function call<T>(key: string, method: string, path: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${pipelineUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch {
    throw new PipelineError('Can’t reach the download server.', undefined, true);
  } finally {
    window.clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Caddy answers 502 when the orchestrator container isn't running.
    if (response.status >= 502 && response.status <= 504) {
      throw new PipelineError('The download server isn’t running on tim-box.', response.status, true);
    }
    if (response.status === 401) throw new PipelineError('That key isn’t right.', 401);
    throw new PipelineError((data as { error?: string }).error ?? `The download server answered ${response.status}.`, response.status);
  }
  return data as T;
}

export const checkKey = (key: string) => call<{ ok: boolean }>(key, 'GET', '/whoami');

/** `mp3`: only album folders whose songs are all MP3. `any`: every format. */
export type SearchFormat = 'mp3' | 'any';

/** Blocks while Soulseek gathers answers - up to about a minute. */
export async function searchAlbums(key: string, query: string, format: SearchFormat) {
  const params = new URLSearchParams({ q: query });
  if (format !== 'any') params.set('format', format);
  const data = await call<{ results?: AlbumResult[] }>(key, 'GET', `/search?${params}`, undefined, 100_000);
  return data.results ?? [];
}

export async function queueAlbum(key: string, album: AlbumResult) {
  const data = await call<{ jobId?: string }>(key, 'POST', '/download', {
    user: album.user,
    dir: album.dir,
    folderName: album.folderName,
    artist: album.artist,
    album: album.album,
    files: album.files.map((f) => ({ filename: f.filename, size: f.size })),
  });
  return data.jobId ?? '';
}

export async function listJobs(key: string) {
  const data = await call<{ jobs?: DownloadJob[] }>(key, 'GET', '/jobs');
  return data.jobs ?? [];
}

/** Stops a download and deletes what arrived; for a finished one, just forgets it. */
export const cancelJob = (key: string, jobId: string) => call(key, 'DELETE', `/jobs/${encodeURIComponent(jobId)}`);

export const albumTitle = (a: { album?: string | null; folderName: string }) => (a.album?.trim() ? a.album : a.folderName);
export const isActiveJob = (job: DownloadJob) => job.state === 'queued' || job.state === 'downloading' || job.state === 'tagging';
/** The file's own name, without the Soulseek user's folders. */
export const fileName = (file: AlbumFile) => file.filename.split(/[\\/]/).pop() ?? file.filename;

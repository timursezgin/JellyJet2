import { useSession } from '@/auth/session';
import { isOnline } from '@/connectivity/connection';
import * as api from '@/jellyfin/api';
import { deviceId } from '@/jellyfin/identity';
import type { ItemsResult } from '@/jellyfin/types';
import { trackFromItem, type Track } from '@/player/track';
import { useSettings } from '@/settings/settings';
import {
  collectionKey,
  updateDownloads,
  useDownloads,
  type CollectionKind,
  type DownloadedCollection,
  type DownloadJob,
} from './downloads';
import { requestPersistentStorage } from './support';

/**
 * Fetching songs into storage, and every change to what's downloaded.
 *
 * Files are kept in Cache Storage under `/offline/audio/<id>`; the service
 * worker plays them from there (with seeking) when the phone has no signal.
 * Covers are kept alongside so downloaded music looks right offline.
 */

export const AUDIO_CACHE = 'jellyjet2-audio';
export const IMAGE_CACHE = 'jellyjet2-images';
export const offlineAudioPath = (id: string) => `/offline/audio/${id}`;

const PARALLEL = 2;
const SMALLER_BITRATE = 192_000;
const running = new Map<string, AbortController>();

function account() {
  const { client, session } = useSession.getState();
  return client && session ? { client, session } : null;
}

// --- The queue ----------------------------------------------------------------

export function pumpQueue() {
  const { jobs, loaded } = useDownloads.getState();
  if (!loaded || !isOnline() || !account()) return;
  for (const job of jobs) {
    if (running.size >= PARALLEL) break;
    if (running.has(job.track.id)) continue;
    void runJob(job);
  }
}

async function runJob(job: DownloadJob) {
  const id = job.track.id;
  const controller = new AbortController();
  running.set(id, controller);
  updateDownloads((s) => ({ progress: { ...s.progress, [id]: 0 } }));
  try {
    const stored = await fetchIntoStorage(job.track, controller.signal);
    updateDownloads((s) => {
      const current = s.jobs.find((j) => j.track.id === id);
      const progress = { ...s.progress };
      delete progress[id];
      const missing = { ...s.missing };
      delete missing[id];
      // Cancelled while finishing: throw the file away.
      if (!current) return { progress, missing };
      return {
        progress,
        missing,
        jobs: s.jobs.filter((j) => j.track.id !== id),
        songs: {
          ...s.songs,
          [id]: {
            track: current.track,
            sources: [...new Set([...(s.songs[id]?.sources ?? []), ...current.sources])],
            size: stored.size,
            mime: stored.mime,
            quality: stored.quality,
            addedAt: Date.now(),
          },
        },
      };
    });
    if (!useDownloads.getState().songs[id]) await deleteFiles(id);
  } catch (error) {
    updateDownloads((s) => {
      const progress = { ...s.progress };
      delete progress[id];
      return { progress };
    });
    if (controller.signal.aborted) {
      // Cancelled, or signing out; nothing to keep.
    } else if (!isOnline()) {
      // Lost the connection: the job stays queued and resumes when it's back.
    } else {
      console.warn('Download failed', job.track.name, error);
      // Move it to the back so one bad file doesn't block the rest.
      updateDownloads((s) => {
        const rest = s.jobs.filter((j) => j.track.id !== id);
        const failed = s.jobs.find((j) => j.track.id === id);
        return { jobs: failed ? [...rest, failed] : rest };
      });
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } finally {
    running.delete(id);
    pumpQueue();
  }
}

/** Stop everything in flight (signing out). Queued jobs stay saved. */
export function stopDownloads() {
  for (const controller of running.values()) controller.abort();
  running.clear();
}

// --- Files --------------------------------------------------------------------

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  aac: 'audio/aac',
  alac: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg; codecs=opus',
  webm: 'audio/webm',
};

/** The original file only if this browser can play it; otherwise a compressed copy. */
function chooseQuality(track: Track): 'original' | 'smaller' {
  if (useSettings.getState().downloadQuality === 'smaller') return 'smaller';
  const container = track.container?.split(',')[0]?.toLowerCase();
  const mime = container ? MIME[container] : undefined;
  if (!mime) return 'smaller';
  return document.createElement('audio').canPlayType(mime) ? 'original' : 'smaller';
}

async function fetchIntoStorage(track: Track, signal: AbortSignal) {
  const a = account();
  if (!a) throw new Error('Signed out');
  const { client, session } = a;
  const quality = chooseQuality(track);
  const url =
    quality === 'original'
      ? client.url(`/Audio/${track.id}/stream`, { static: true, deviceId: deviceId(), ApiKey: client.token })
      : client.url(`/Audio/${track.id}/universal`, {
          userId: session.userId,
          deviceId: deviceId(),
          ApiKey: client.token,
          audioCodec: 'aac',
          transcodingContainer: 'm4a',
          transcodingProtocol: 'http',
          maxStreamingBitrate: SMALLER_BITRATE,
          audioBitRate: SMALLER_BITRATE,
        });

  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new Error(`Server answered ${response.status}`);
  const mime = response.headers.get('Content-Type')?.split(';')[0] || 'audio/mp4';
  const expected =
    Number(response.headers.get('Content-Length')) || Math.max(1, track.duration * (SMALLER_BITRATE / 8));

  // Read it in, reporting progress a few times a second.
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    const now = performance.now();
    if (now - lastReport > 200) {
      lastReport = now;
      const fraction = Math.min(0.99, received / expected);
      useDownloads.setState((s) => (s.progress[track.id] === undefined ? s : { progress: { ...s.progress, [track.id]: fraction } }));
    }
  }
  if (received === 0) throw new Error('Empty file');

  const blob = new Blob(chunks as BlobPart[], { type: mime });
  const audioCache = await caches.open(AUDIO_CACHE);
  await audioCache.put(
    offlineAudioPath(track.id),
    new Response(blob, { headers: { 'Content-Type': mime, 'Content-Length': String(blob.size) } }),
  );

  // The cover, at a size that looks sharp everywhere it's shown.
  if (track.art) {
    try {
      const imageCache = await caches.open(IMAGE_CACHE);
      const imageUrl = api.imageUrl(client.baseUrl, track.art.id, track.art.tag, 640);
      if (!(await imageCache.match(imageUrl, { ignoreSearch: true }))) {
        const image = await fetch(imageUrl, { signal });
        if (image.ok) await imageCache.put(imageUrl, image);
      }
    } catch {
      // A missing cover isn't worth failing the song over.
    }
  }

  return { size: blob.size, mime, quality };
}

async function deleteFiles(id: string) {
  const audioCache = await caches.open(AUDIO_CACHE);
  await audioCache.delete(offlineAudioPath(id));
}

/** Remove covers no downloaded song uses any more. */
async function pruneImages() {
  const { songs } = useDownloads.getState();
  const inUse = new Set(Object.values(songs).map((s) => s.track.art?.id).filter(Boolean));
  const imageCache = await caches.open(IMAGE_CACHE);
  for (const request of await imageCache.keys()) {
    const match = new URL(request.url).pathname.match(/\/Items\/([^/]+)\/Images/);
    if (match && !inUse.has(match[1])) await imageCache.delete(request);
  }
}

/** Mark downloaded songs whose files are no longer in storage. */
export async function verifyFiles() {
  try {
    const audioCache = await caches.open(AUDIO_CACHE);
    const present = new Set((await audioCache.keys()).map((r) => new URL(r.url).pathname));
    const missing: Record<string, true> = {};
    for (const id of Object.keys(useDownloads.getState().songs)) {
      if (!present.has(offlineAudioPath(id))) missing[id] = true;
    }
    useDownloads.setState({ missing });
  } catch {
    // Storage unavailable here; nothing to verify.
  }
}

/** Queue every missing file again. */
export function redownloadMissing() {
  updateDownloads((s) => {
    const songs = { ...s.songs };
    const jobs = [...s.jobs];
    for (const id of Object.keys(s.missing)) {
      const song = songs[id];
      if (!song) continue;
      delete songs[id];
      if (!jobs.some((j) => j.track.id === id)) jobs.push({ track: song.track, sources: song.sources });
    }
    return { songs, jobs, missing: {} };
  });
  pumpQueue();
}

// --- Songs --------------------------------------------------------------------

export function downloadSong(track: Track) {
  void requestPersistentStorage();
  updateDownloads((s) => {
    // Downloading it by hand also undoes earlier removals from collections.
    const collections = { ...s.collections };
    const collectionSources: string[] = [];
    for (const [key, c] of Object.entries(collections)) {
      if (!c.trackIds.includes(track.id)) continue;
      collectionSources.push(key);
      if (c.excluded.includes(track.id)) collections[key] = { ...c, excluded: c.excluded.filter((x) => x !== track.id) };
    }
    const sources = ['song', ...collectionSources];
    const existing = s.songs[track.id];
    if (existing) {
      return { collections, songs: { ...s.songs, [track.id]: { ...existing, sources: [...new Set([...existing.sources, ...sources])] } } };
    }
    if (s.jobs.some((j) => j.track.id === track.id)) {
      return {
        collections,
        jobs: s.jobs.map((j) => (j.track.id === track.id ? { ...j, sources: [...new Set([...j.sources, ...sources])] } : j)),
      };
    }
    return { collections, jobs: [...s.jobs, { track, sources }] };
  });
  pumpQueue();
}

/** Remove a song's download (and keep collections from fetching it again). */
export async function removeSongDownload(id: string) {
  running.get(id)?.abort();
  updateDownloads((s) => {
    const songs = { ...s.songs };
    delete songs[id];
    const missing = { ...s.missing };
    delete missing[id];
    const collections = { ...s.collections };
    for (const [key, c] of Object.entries(collections)) {
      if (c.trackIds.includes(id) && !c.excluded.includes(id)) collections[key] = { ...c, excluded: [...c.excluded, id] };
    }
    return { songs, missing, collections, jobs: s.jobs.filter((j) => j.track.id !== id) };
  });
  await deleteFiles(id);
  await pruneImages();
}

// --- Collections ----------------------------------------------------------------

export interface CollectionInfo {
  kind: CollectionKind;
  id: string;
  name: string;
  art: { id: string; tag: string } | null;
}

export function downloadCollection(info: CollectionInfo, tracks: Track[]) {
  void requestPersistentStorage();
  const key = collectionKey(info.kind, info.id);
  updateDownloads((s) => ({
    collections: {
      ...s.collections,
      [key]: { key, ...info, trackIds: tracks.map((t) => t.id), excluded: [], addedAt: Date.now() },
    },
  }));
  applyTrackList(key, tracks);
}

export async function removeCollectionDownload(key: string) {
  const orphans: string[] = [];
  updateDownloads((s) => {
    const collections = { ...s.collections };
    delete collections[key];
    const songs = { ...s.songs };
    for (const [id, song] of Object.entries(songs)) {
      if (!song.sources.includes(key)) continue;
      const sources = song.sources.filter((x) => x !== key);
      if (sources.length) songs[id] = { ...song, sources };
      else {
        delete songs[id];
        orphans.push(id);
      }
    }
    const jobs = s.jobs
      .map((j) => ({ ...j, sources: j.sources.filter((x) => x !== key) }))
      .filter((j) => {
        if (j.sources.length) return true;
        running.get(j.track.id)?.abort();
        return false;
      });
    return { collections, songs, jobs };
  });
  for (const id of orphans) await deleteFiles(id);
  await pruneImages();
}

/**
 * Bring a downloaded collection in line with its current songs: fetch new
 * ones (unless removed by hand), let go of songs no longer in it.
 */
export function applyTrackList(key: string, tracks: Track[]) {
  const collection = useDownloads.getState().collections[key];
  if (!collection) return;
  const ids = new Set(tracks.map((t) => t.id));
  const orphans: string[] = [];
  updateDownloads((s) => {
    const c = s.collections[key];
    if (!c) return {};
    const songs = { ...s.songs };
    let jobs = [...s.jobs];
    for (const track of tracks) {
      if (c.excluded.includes(track.id)) continue;
      const song = songs[track.id];
      if (song) {
        if (!song.sources.includes(key)) songs[track.id] = { ...song, sources: [...song.sources, key] };
        continue;
      }
      const job = jobs.find((j) => j.track.id === track.id);
      if (job) {
        if (!job.sources.includes(key)) jobs = jobs.map((j) => (j === job ? { ...j, sources: [...j.sources, key] } : j));
      } else {
        jobs.push({ track, sources: [key] });
      }
    }
    // Songs that left the collection.
    for (const [id, song] of Object.entries(songs)) {
      if (ids.has(id) || !song.sources.includes(key)) continue;
      const sources = song.sources.filter((x) => x !== key);
      if (sources.length) songs[id] = { ...song, sources };
      else {
        delete songs[id];
        orphans.push(id);
      }
    }
    jobs = jobs
      .map((j) => (ids.has(j.track.id) ? j : { ...j, sources: j.sources.filter((x) => x !== key) }))
      .filter((j) => j.sources.length > 0);
    const updated: DownloadedCollection = {
      ...c,
      trackIds: tracks.map((t) => t.id),
      excluded: c.excluded.filter((id) => ids.has(id)),
    };
    return { songs, jobs, collections: { ...s.collections, [key]: updated } };
  });
  void Promise.all(orphans.map(deleteFiles)).then(pruneImages);
  pumpQueue();
}

async function fetchCollectionTracks(c: DownloadedCollection): Promise<Track[]> {
  const a = account();
  if (!a) throw new Error('Signed out');
  const { client, session } = a;
  let result: ItemsResult;
  if (c.kind === 'album') result = await api.albumTracks(client, session.userId, c.id);
  else if (c.kind === 'playlist') result = await api.playlistTracks(client, session.userId, c.id);
  else result = await api.likedSongs(client, session.userId, await api.musicLibraryId(client));
  return result.Items.filter((i) => i.Type === 'Audio').map(trackFromItem);
}

const lastSynced = new Map<string, number>();

/** Check one downloaded collection against the server now. */
export async function syncCollection(key: string) {
  const c = useDownloads.getState().collections[key];
  if (!c || !isOnline()) return;
  try {
    const tracks = await fetchCollectionTracks(c);
    lastSynced.set(key, Date.now());
    applyTrackList(key, tracks);
  } catch (error) {
    // The collection itself was deleted on the server: stop following it.
    if (error instanceof Error && 'status' in error && (error as { status?: number }).status === 404) {
      await removeCollectionDownload(key);
    }
  }
}

/** Check every downloaded collection (at most every few minutes each). */
export async function syncAllCollections(force = false) {
  const now = Date.now();
  for (const key of Object.keys(useDownloads.getState().collections)) {
    if (!force && now - (lastSynced.get(key) ?? 0) < 5 * 60_000) continue;
    await syncCollection(key);
  }
}

export async function removeAllDownloads() {
  for (const controller of running.values()) controller.abort();
  running.clear();
  updateDownloads(() => ({ songs: {}, collections: {}, jobs: [], progress: {}, missing: {} }));
  await caches.delete(AUDIO_CACHE);
  await caches.delete(IMAGE_CACHE);
}

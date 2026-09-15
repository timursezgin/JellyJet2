import { ArrowDownToLine, CircleCheck } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { useSession } from '@/auth/session';
import { useOnline } from '@/connectivity/connection';
import type { Track } from '@/player/track';
import { confirm } from '@/ui/confirm';
import { toast } from '@/ui/toast';
import {
  collectionDownloadState,
  collectionKey,
  songDownloadState,
  useDownloads,
  type CollectionKind,
} from './downloads';
import {
  downloadCollection,
  downloadSong,
  removeCollectionDownload,
  removeSongDownload,
  type CollectionInfo,
} from './engine';
import { downloadSupport } from './support';
import styles from './download-buttons.module.css';

/** Whether downloading can start here; explains why not when it can't. */
async function mayDownload(): Promise<boolean> {
  const support = downloadSupport();
  if (support.ok) return true;
  await confirm({ title: support.title, message: support.message, confirmLabel: 'OK', cancelLabel: null });
  return false;
}

// These selectors build a fresh object each time; comparing field by field
// stops that from counting as a change (which would redraw forever).
export function useSongDownloadState(id: string) {
  return useDownloads(useShallow((s) => songDownloadState(s, id)));
}

/** What the download arrow does for a song, wherever it's shown. */
export async function toggleSongDownload(track: Track) {
  const state = songDownloadState(useDownloads.getState(), track.id);
  switch (state.status) {
    case 'none':
    case 'missing':
      if (!(await mayDownload())) return;
      if (!navigator.onLine) {
        toast('Downloading needs a connection');
        return;
      }
      downloadSong(track);
      return;
    case 'queued':
    case 'downloading':
      await removeSongDownload(track.id);
      return;
    case 'done': {
      const ok = await confirm({
        title: 'Remove download?',
        message: `“${track.name}” won’t play without internet any more. It stays in your playlists.`,
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (ok) await removeSongDownload(track.id);
    }
  }
}

interface IconProps {
  status: 'none' | 'queued' | 'downloading' | 'done' | 'missing';
  progress?: number;
  size: number;
}

/** Arrow → ring filling up → check. */
export function DownloadIcon({ status, progress = 0, size }: IconProps) {
  if (status === 'done') return <CircleCheck size={size} strokeWidth={2} className={styles.done} />;
  if (status === 'queued' || status === 'downloading') {
    const r = size / 2 - 1.5;
    const c = 2 * Math.PI * r;
    return (
      <span className={styles.ring} style={{ width: size, height: size }} data-queued={status === 'queued' || undefined}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} className={styles.track} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            className={styles.fill}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.max(0.04, progress))}
          />
        </svg>
        <span className={styles.stop} />
      </span>
    );
  }
  return <ArrowDownToLine size={size} strokeWidth={2} />;
}

/** The download arrow for one song (rows, player). */
export function SongDownloadButton({ track, className, large = false }: { track: Track; className: string; large?: boolean }) {
  const state = useSongDownloadState(track.id);
  const online = useOnline();
  const unavailable = !online && (state.status === 'none' || state.status === 'missing');
  const label =
    state.status === 'done'
      ? `Remove download of ${track.name}`
      : state.status === 'none' || state.status === 'missing'
        ? `Download ${track.name}`
        : `Stop downloading ${track.name}`;
  return (
    <button
      type="button"
      className={className}
      data-active={state.status === 'done' || state.status === 'downloading' || state.status === 'queued' || undefined}
      data-muted={unavailable || state.status === 'none' || state.status === 'missing' || undefined}
      data-unavailable={unavailable || undefined}
      onClick={() => void toggleSongDownload(track)}
      aria-label={label}
    >
      <DownloadIcon
        status={state.status}
        progress={state.status === 'downloading' ? state.progress : 0}
        size={large ? 24 : 20}
      />
    </button>
  );
}

/** The download button on an album, playlist or Liked Songs page. */
export function CollectionDownloadButton({
  info,
  tracks,
  className,
}: {
  info: CollectionInfo;
  tracks: Track[] | undefined;
  className: string;
}) {
  const canDownload = useSession((s) => s.session?.permissions.canDownload ?? false);
  const key = collectionKey(info.kind, info.id);
  const state = useDownloads(useShallow((s) => collectionDownloadState(s, key)));
  if (!canDownload) return null;

  const onClick = async () => {
    if (state.status === 'none') {
      if (!tracks?.length || !(await mayDownload())) return;
      downloadCollection(info, tracks);
      return;
    }
    const ok = await confirm({
      title: state.status === 'downloading' ? 'Stop downloading?' : 'Remove downloads?',
      message: `Songs from “${info.name}” won’t play without internet any more, unless you downloaded them separately.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (ok) await removeCollectionDownload(key);
  };

  return (
    <button
      type="button"
      className={className}
      data-active={state.status !== 'none' || undefined}
      onClick={() => void onClick()}
      aria-label={state.status === 'none' ? `Download ${info.name}` : `Remove downloads of ${info.name}`}
    >
      <DownloadIcon
        status={state.status === 'none' ? 'none' : state.status === 'done' ? 'done' : 'downloading'}
        progress={state.status === 'downloading' && state.total ? state.done / state.total : 0}
        size={20}
      />
    </button>
  );
}

/** "Downloaded" or download progress under a collection's name. */
export function useCollectionDownloadLabel(kind: CollectionKind, id: string) {
  const state = useDownloads(useShallow((s) => collectionDownloadState(s, collectionKey(kind, id))));
  if (state.status === 'done') return 'Downloaded';
  if (state.status === 'downloading') return `Downloading ${state.done} of ${state.total}`;
  return undefined;
}

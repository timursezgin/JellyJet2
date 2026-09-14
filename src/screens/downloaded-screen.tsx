import { useMemo } from 'react';

import { useBackup, dismissBackup, restoreBackup } from '@/downloads/backup';
import { useDownloads } from '@/downloads/downloads';
import { redownloadMissing } from '@/downloads/engine';
import { downloadSupport } from '@/downloads/support';
import { navigate } from '@/nav/navigation';
import { Artwork } from '@/ui/artwork';
import { DownloadedCover, LikedCover, PlaylistCover } from '@/ui/covers';
import { ItemRow } from '@/ui/item-row';
import { SectionHeader } from '@/ui/section';
import { TrackCollection } from './playlist-screen';
import { songCount } from './playlists-screen';
import styles from './downloaded-screen.module.css';

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * The Downloaded tab: every song on this phone, ready without internet, with
 * the downloaded albums and playlists above.
 */
export function DownloadedScreen() {
  const songs = useDownloads((s) => s.songs);
  const collections = useDownloads((s) => s.collections);
  const jobs = useDownloads((s) => s.jobs.length);
  const missing = useDownloads((s) => Object.keys(s.missing).length);
  const backup = useBackup();

  const tracks = useMemo(
    () =>
      Object.values(songs)
        .sort((a, b) => b.addedAt - a.addedAt)
        .map((s) => s.track),
    [songs],
  );
  const totalBytes = useMemo(() => Object.values(songs).reduce((sum, s) => sum + s.size, 0), [songs]);
  const collectionList = Object.values(collections).sort((a, b) => b.addedAt - a.addedAt);
  const support = downloadSupport();

  const extra = (
    <>
      {!support.ok && (
        <div className={styles.notice}>
          <p className={styles.noticeTitle}>{support.title}</p>
          <p>{support.message}</p>
        </div>
      )}

      {backup.available && (
        <div className={styles.notice}>
          <p className={styles.noticeTitle}>Download your music again?</p>
          <p>
            Your account lists {backup.available.songs.length + backup.available.collections.length} downloads that aren’t
            on this device.
          </p>
          <div className={styles.noticeActions}>
            <button type="button" className={styles.primary} disabled={backup.restoring} onClick={() => void restoreBackup()}>
              {backup.restoring ? 'Starting…' : 'Download again'}
            </button>
            <button type="button" className={styles.secondary} onClick={dismissBackup}>
              Not now
            </button>
          </div>
        </div>
      )}

      {missing > 0 && (
        <div className={styles.notice}>
          <p className={styles.noticeTitle}>
            {missing} {missing === 1 ? 'song needs' : 'songs need'} downloading again
          </p>
          <p>Their files were cleared from this device’s storage.</p>
          <div className={styles.noticeActions}>
            <button type="button" className={styles.primary} onClick={redownloadMissing}>
              Download again
            </button>
          </div>
        </div>
      )}

      {tracks.length + jobs > 0 && (
        <p className={styles.summary}>
          {formatBytes(totalBytes)} on this device
          {jobs > 0 && ` · ${jobs} ${jobs === 1 ? 'song' : 'songs'} still downloading - keep JellyJet open`}
        </p>
      )}

      {collectionList.length > 0 && (
        <>
          <SectionHeader title="Albums & playlists" />
          {collectionList.map((c) => (
            <ItemRow
              key={c.key}
              art={
                c.kind === 'liked' ? (
                  <LikedCover size={52} />
                ) : c.kind === 'playlist' ? (
                  <PlaylistCover playlistId={c.id} size={52} />
                ) : (
                  <Artwork art={c.art} size={52} radius={10} />
                )
              }
              title={c.name}
              subtitle={`${c.kind === 'album' ? 'Album' : 'Playlist'} · ${songCount(c.trackIds.length - c.excluded.length)}`}
              onClick={() =>
                navigate(
                  c.kind === 'liked'
                    ? { name: 'liked' }
                    : c.kind === 'album'
                      ? { name: 'album', id: c.id, title: c.name }
                      : { name: 'playlist', id: c.id, title: c.name },
                )
              }
            />
          ))}
          {tracks.length > 0 && <SectionHeader title="Songs" />}
        </>
      )}
    </>
  );

  return (
    <TrackCollection
      title="Downloaded"
      art={<DownloadedCover size={200} />}
      query={{ data: tracks, isPending: false, isError: false, refetch: () => {} }}
      empty="Songs, albums and playlists you download will be here, ready to play without internet."
      extra={extra}
      animateRemovals
    />
  );
}

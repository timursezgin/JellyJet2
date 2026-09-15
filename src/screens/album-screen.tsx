import { useMemo } from 'react';

import { useAlbumTracks, useItem } from '@/data/queries';
import { artworkOf } from '@/jellyfin/api';
import { navigate } from '@/nav/navigation';
import { playTracks } from '@/player/player';
import { artistLine } from '@/player/track';
import { Artwork } from '@/ui/artwork';
import { HERO_ART, Hero, heroIconClass } from '@/ui/hero';
import { CollectionDownloadButton, useCollectionDownloadLabel } from '@/downloads/download-buttons';
import { useKeepInSync } from '@/downloads/use-keep-in-sync';
import { Page } from '@/ui/page';
import { LoadError, LoadingRows } from '@/ui/states';
import { sortTracks, useTrackSort } from '@/songs/track-sort';
import { TrackListHeader, TrackRow } from '@/ui/track-row';
import styles from './detail-screens.module.css';

export function AlbumScreen({ id, title }: { id: string; title?: string }) {
  const album = useItem(id);
  const tracks = useAlbumTracks(id);
  const list = tracks.data ?? [];
  const info = album.data;

  const albumArtist = info?.AlbumArtists?.[0];
  const artistName = info?.AlbumArtist ?? albumArtist?.Name;
  const downloadLabel = useCollectionDownloadLabel('album', id);
  useKeepInSync('album', id, tracks.data);
  const totalSeconds = list.reduce((sum, t) => sum + t.duration, 0);
  const meta = [
    info?.ProductionYear,
    list.length ? `${list.length} ${list.length === 1 ? 'song' : 'songs'}` : undefined,
    totalSeconds ? formatLength(totalSeconds) : undefined,
    downloadLabel,
  ]
    .filter(Boolean)
    .join(' · ');
  // Sorted by a column, the disc headings go: they'd split up a sorted list.
  const [sort, onSort] = useTrackSort();
  const shown = useMemo(() => sortTracks(list, sort), [list, sort]);
  const discs = !sort && new Set(list.map((t) => t.disc ?? 1)).size > 1;

  return (
    <Page title={info?.Name ?? title ?? ''} variant="detail">
      <Hero
        layout="side"
        art={<Artwork art={info ? artworkOf(info) : null} size={HERO_ART} radius={10} eager />}
        title={info?.Name ?? title ?? ''}
        link={
          artistName
            ? {
                label: artistName,
                onClick: albumArtist ? () => navigate({ name: 'artist', id: albumArtist.Id, title: albumArtist.Name }) : undefined,
              }
            : undefined
        }
        meta={meta}
        onPlay={list.length ? () => playTracks(list, 0, { shuffle: false }) : undefined}
        onShuffle={list.length ? () => playTracks(list, 0, { shuffle: true }) : undefined}
        actions={
          <CollectionDownloadButton
            info={{ kind: 'album', id, name: info?.Name ?? title ?? 'this album', art: info ? artworkOf(info) : null }}
            tracks={tracks.data}
            className={heroIconClass}
          />
        }
      />
      {list.length > 0 && <TrackListHeader sort={sort} onSort={onSort} numbered hideAlbum />}
      {tracks.isPending && <LoadingRows count={6} />}
      {tracks.isError && !tracks.data && <LoadError onRetry={() => tracks.refetch()} />}
      {shown.map((track, i) => {
        const showDisc = discs && (i === 0 || (shown[i - 1].disc ?? 1) !== (track.disc ?? 1));
        const ownArtist = artistLine(track);
        return (
          <div key={track.id}>
            {showDisc && <p className={styles.disc}>Disc {track.disc ?? 1}</p>}
            <TrackRow
              track={track}
              leading={track.number ?? i + 1}
              subtitle={ownArtist && ownArtist !== artistName ? ownArtist : ''}
              hideAlbum
              onPlay={() => playTracks(shown, i, { shuffle: false })}
            />
          </div>
        );
      })}
    </Page>
  );
}

export function formatLength(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ${minutes % 60} min`;
}

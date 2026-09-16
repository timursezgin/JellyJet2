import { useMemo, useState } from 'react';

import { useAlbumList, useLikedAlbums, useLikedAlbumTracks, useRecentlyAddedAlbums } from '@/data/queries';
import { ticksToSeconds } from '@/jellyfin/api';
import { playTracks } from '@/player/player';
import { LikedAlbumsCover } from '@/ui/covers';
import { CollectionDownloadButton, useCollectionDownloadLabel } from '@/downloads/download-buttons';
import { useKeepInSync } from '@/downloads/use-keep-in-sync';
import { HERO_ART, Hero, heroIconClass } from '@/ui/hero';
import { formatLength } from './album-screen';
import type { BaseItem } from '@/jellyfin/types';
import { ALBUM_CAPTION_HEIGHT, AlbumCard, albumSubtitle } from '@/ui/album-card';
import { Page } from '@/ui/page';
import { LoadError } from '@/ui/states';
import { useDebounced } from '@/ui/use-debounced';
import { VirtualGrid } from '@/ui/virtual-list';
import styles from './list-screens.module.css';

const GAP = { row: 20, column: 16 };

/**
 * Covers per row: two on a phone, more as the window widens (each about
 * 180px or more).
 */
export function gridColumns(width: number, gap = GAP.column) {
  return Math.max(2, Math.floor((width + gap) / (180 + gap)));
}

/** Every album (or a genre's albums), two to a row. */
export function AlbumsScreen({ title = 'Albums', genreId }: { title?: string; genreId?: string }) {
  const [term, setTerm] = useState('');
  const list = useAlbumList(useDebounced(term), genreId);

  return (
    <Page title={title} search={{ value: term, onChange: setTerm, placeholder: 'Search albums' }}>
      {list.isError && list.items.length === 0 ? (
        <LoadError onRetry={() => list.refetch()} />
      ) : !list.isPending && list.items.length === 0 ? (
        <p className={styles.message}>{term ? 'No albums match that.' : 'No albums yet.'}</p>
      ) : (
        <AlbumGrid
          albums={list.items}
          onNearEnd={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        />
      )}
    </Page>
  );
}

/** The newest-added albums, from Home's "see all". */
export function RecentAlbumsScreen() {
  const query = useRecentlyAddedAlbums();
  return (
    <Page title="Recently added">
      {query.isError && !query.data ? <LoadError onRetry={() => query.refetch()} /> : <AlbumGrid albums={query.data ?? []} />}
    </Page>
  );
}

/** Albums liked with their own heart, A to Z, under a Liked Songs-style header. */
export function LikedAlbumsScreen() {
  const [term, setTerm] = useState('');
  const query = useLikedAlbums();
  const all = query.data;
  const tracks = useLikedAlbumTracks(all);
  useKeepInSync('liked-albums', 'liked-albums', tracks);
  const downloadLabel = useCollectionDownloadLabel('liked-albums', 'liked-albums');
  const albums = useMemo(() => filterAlbums(all ?? [], term), [all, term]);
  const searching = term.trim().length > 0;
  const count = all?.length ?? 0;
  const seconds = all?.reduce((sum, a) => sum + ticksToSeconds(a.RunTimeTicks), 0) ?? 0;
  const meta = count
    ? [`${count.toLocaleString()} ${count === 1 ? 'album' : 'albums'}`, seconds ? formatLength(seconds) : '', downloadLabel].filter(Boolean).join(' · ')
    : undefined;
  // Play and Shuffle wait for the songs, so a tap starts playback straight away.
  const ready = count > 0 && tracks && tracks.length > 0 ? tracks : null;
  return (
    <Page title="Liked Albums" variant="detail" search={{ value: term, onChange: setTerm, placeholder: 'Search Liked Albums' }}>
      {!searching && (
        <Hero
          layout="side"
          art={<LikedAlbumsCover size={HERO_ART} />}
          title="Liked Albums"
          meta={meta}
          onPlay={ready ? () => playTracks(ready, 0, { shuffle: false }) : undefined}
          onShuffle={ready ? () => playTracks(ready, 0, { shuffle: true }) : undefined}
          actions={
            <CollectionDownloadButton
              info={{ kind: 'liked-albums', id: 'liked-albums', name: 'Liked Albums', art: null }}
              tracks={tracks}
              className={heroIconClass}
            />
          }
        />
      )}
      {query.isError && !all ? (
        <LoadError onRetry={() => query.refetch()} />
      ) : all && albums.length === 0 ? (
        <p className={styles.message}>{searching ? 'No liked albums match that.' : 'Like an album from its page and it shows up here.'}</p>
      ) : (
        <AlbumGrid albums={albums} playable />
      )}
    </Page>
  );
}

function filterAlbums(list: BaseItem[], term: string) {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return list;
  return list.filter((a) => {
    const text = `${a.Name} ${albumSubtitle(a)}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

export function AlbumGrid({
  albums,
  subtitle,
  onNearEnd,
  playable,
}: {
  albums: BaseItem[];
  subtitle?: (a: BaseItem) => string;
  onNearEnd?(): void;
  /** With a mouse, a play button on each cover plays the whole album (Liked Albums). */
  playable?: boolean;
}) {
  return (
    <div className={styles.grid}>
      <VirtualGrid
        count={albums.length}
        columns={gridColumns}
        gap={GAP}
        cellHeight={(width) => width + ALBUM_CAPTION_HEIGHT}
        onNearEnd={onNearEnd}
        renderCell={(i, width) => <AlbumCard album={albums[i]} size={width} subtitle={subtitle?.(albums[i])} playable={playable} />}
      />
    </div>
  );
}

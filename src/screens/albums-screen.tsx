import { useState } from 'react';

import { useAlbumList, useRecentlyAddedAlbums, useRecentlyPlayedAlbums } from '@/data/queries';
import type { BaseItem } from '@/jellyfin/types';
import { ALBUM_CAPTION_HEIGHT, AlbumCard } from '@/ui/album-card';
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

/** The newest-played or newest-added albums, from Home's "see all". */
export function RecentAlbumsScreen({ kind }: { kind: 'played' | 'added' }) {
  const played = useRecentlyPlayedAlbums();
  const added = useRecentlyAddedAlbums();
  const query = kind === 'played' ? played : added;
  return (
    <Page title={kind === 'played' ? 'Recently played' : 'Recently added'}>
      {query.isError && !query.data ? <LoadError onRetry={() => query.refetch()} /> : <AlbumGrid albums={query.data ?? []} />}
    </Page>
  );
}

export function AlbumGrid({ albums, subtitle, onNearEnd }: { albums: BaseItem[]; subtitle?: (a: BaseItem) => string; onNearEnd?(): void }) {
  return (
    <div className={styles.grid}>
      <VirtualGrid
        count={albums.length}
        columns={gridColumns}
        gap={GAP}
        cellHeight={(width) => width + ALBUM_CAPTION_HEIGHT}
        onNearEnd={onNearEnd}
        renderCell={(i, width) => <AlbumCard album={albums[i]} size={width} subtitle={subtitle?.(albums[i])} />}
      />
    </div>
  );
}

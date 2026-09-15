import { useState } from 'react';

import { useTrackList } from '@/data/queries';
import { playTracks } from '@/player/player';
import { useTrackSort } from '@/songs/track-sort';
import { Page } from '@/ui/page';
import { LoadError, LoadingRows } from '@/ui/states';
import { TRACK_ROW_HEIGHT, TrackListHeader, TrackRow } from '@/ui/track-row';
import { useDebounced } from '@/ui/use-debounced';
import { VirtualList } from '@/ui/virtual-list';
import styles from './list-screens.module.css';

/**
 * Every song in the library, A to Z. On a computer the columns sort it; the
 * server does the sorting, since the list arrives a page at a time.
 */
export function TracksScreen() {
  const [term, setTerm] = useState('');
  const [sort, onSort] = useTrackSort({ key: 'title', descending: false }, true);
  const list = useTrackList(useDebounced(term), sort ?? undefined);

  return (
    <Page title="Tracks" search={{ value: term, onChange: setTerm, placeholder: 'Search songs' }}>
      {list.isPending ? (
        <LoadingRows />
      ) : list.isError && list.items.length === 0 ? (
        <LoadError onRetry={() => list.refetch()} />
      ) : list.items.length === 0 ? (
        <p className={styles.message}>{term ? 'No songs match that.' : 'No songs yet.'}</p>
      ) : (
        <>
          <p className={styles.count}>{list.total.toLocaleString()} songs</p>
          <TrackListHeader sort={sort} onSort={onSort} />
          <VirtualList
            count={list.items.length}
            rowHeight={TRACK_ROW_HEIGHT}
            onNearEnd={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
            renderRow={(i) => <TrackRow track={list.items[i]} onPlay={() => playTracks(list.items, i)} />}
          />
        </>
      )}
    </Page>
  );
}

import { useState } from 'react';

import { useTrackList } from '@/data/queries';
import { playTracks } from '@/player/player';
import { Page } from '@/ui/page';
import { LoadError, LoadingRows } from '@/ui/states';
import { TRACK_ROW_HEIGHT, TrackRow } from '@/ui/track-row';
import { useDebounced } from '@/ui/use-debounced';
import { VirtualList } from '@/ui/virtual-list';
import styles from './list-screens.module.css';

/** Every song in the library, A to Z. */
export function TracksScreen() {
  const [term, setTerm] = useState('');
  const list = useTrackList(useDebounced(term));

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

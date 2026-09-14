import { useState } from 'react';

import { useArtistList } from '@/data/queries';
import { artworkOf } from '@/jellyfin/api';
import { navigate } from '@/nav/navigation';
import { Artwork } from '@/ui/artwork';
import { ITEM_ROW_HEIGHT, ItemRow } from '@/ui/item-row';
import { Page } from '@/ui/page';
import { LoadError, LoadingRows } from '@/ui/states';
import { useDebounced } from '@/ui/use-debounced';
import { VirtualList } from '@/ui/virtual-list';
import styles from './list-screens.module.css';

export function ArtistsScreen() {
  const [term, setTerm] = useState('');
  const list = useArtistList(useDebounced(term));

  return (
    <Page title="Artists" search={{ value: term, onChange: setTerm, placeholder: 'Search artists' }}>
      {list.isPending ? (
        <LoadingRows height={ITEM_ROW_HEIGHT} />
      ) : list.isError && list.items.length === 0 ? (
        <LoadError onRetry={() => list.refetch()} />
      ) : list.items.length === 0 ? (
        <p className={styles.message}>{term ? 'No artists match that.' : 'No artists yet.'}</p>
      ) : (
        <VirtualList
          count={list.items.length}
          rowHeight={ITEM_ROW_HEIGHT}
          onNearEnd={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
          renderRow={(i) => {
            const artist = list.items[i];
            return (
              <ItemRow
                art={<Artwork art={artworkOf(artist)} size={44} round />}
                title={artist.Name}
                onClick={() => navigate({ name: 'artist', id: artist.Id, title: artist.Name })}
              />
            );
          }}
        />
      )}
    </Page>
  );
}

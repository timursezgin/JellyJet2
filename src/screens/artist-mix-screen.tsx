import { Check } from 'lucide-react';
import { useState } from 'react';

import { useArtistList } from '@/data/queries';
import { artworkOf } from '@/jellyfin/api';
import { navigate } from '@/nav/navigation';
import { buildArtistMix } from '@/mixes/stations';
import { Artwork } from '@/ui/artwork';
import { ITEM_ROW_HEIGHT } from '@/ui/item-row';
import { Page } from '@/ui/page';
import { LoadError, LoadingRows } from '@/ui/states';
import { useDebounced } from '@/ui/use-debounced';
import { VirtualList } from '@/ui/virtual-list';
import styles from './artist-mix-screen.module.css';
import listStyles from './list-screens.module.css';

/** Pick some artists, get a shuffled station of just their songs. */
export function ArtistMixScreen() {
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]);
  const [building, setBuilding] = useState(false);
  const list = useArtistList(useDebounced(term));
  const pickedIds = new Set(picked.map((a) => a.id));

  const build = async () => {
    if (!picked.length || building) return;
    setBuilding(true);
    const station = await buildArtistMix(picked);
    setBuilding(false);
    if (station) navigate({ name: 'station', id: station.id, title: station.name });
  };

  return (
    <Page
      title="Artist mix"
      search={{ value: term, onChange: setTerm, placeholder: 'Search artists' }}
      trailing={
        <button type="button" className={styles.build} onClick={() => void build()} disabled={!picked.length || building}>
          {building ? 'Building…' : picked.length ? `Build (${picked.length})` : 'Build'}
        </button>
      }
    >
      <p className={styles.hint}>
        {picked.length ? picked.map((a) => a.name).join(', ') : 'Pick one or more artists for a mix of just their songs.'}
      </p>
      {list.isPending ? (
        <LoadingRows height={ITEM_ROW_HEIGHT} />
      ) : list.isError && list.items.length === 0 ? (
        <LoadError onRetry={() => list.refetch()} />
      ) : list.items.length === 0 ? (
        <p className={listStyles.message}>{term ? 'No artists match that.' : 'No artists yet.'}</p>
      ) : (
        <VirtualList
          count={list.items.length}
          rowHeight={ITEM_ROW_HEIGHT}
          onNearEnd={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
          renderRow={(i) => {
            const artist = list.items[i];
            const on = pickedIds.has(artist.Id);
            return (
              <button
                type="button"
                className={styles.row}
                data-on={on || undefined}
                aria-pressed={on}
                onClick={() =>
                  setPicked((current) =>
                    on ? current.filter((a) => a.id !== artist.Id) : [...current, { id: artist.Id, name: artist.Name }],
                  )
                }
              >
                <Artwork art={artworkOf(artist)} size={44} round />
                <span className={styles.name}>{artist.Name}</span>
                <span className={styles.check}>{on && <Check size={14} strokeWidth={3} />}</span>
              </button>
            );
          }}
        />
      )}
    </Page>
  );
}

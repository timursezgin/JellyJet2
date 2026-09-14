import { useState } from 'react';

import { useGenres } from '@/data/queries';
import { navigate } from '@/nav/navigation';
import { Page } from '@/ui/page';
import { LoadError } from '@/ui/states';
import { useDebounced } from '@/ui/use-debounced';
import styles from './list-screens.module.css';

export function GenresScreen() {
  const [term, setTerm] = useState('');
  const genres = useGenres(useDebounced(term));
  const list = genres.data ?? [];

  return (
    <Page title="Genres" search={{ value: term, onChange: setTerm, placeholder: 'Search genres' }}>
      {genres.isError ? (
        <LoadError onRetry={() => genres.refetch()} />
      ) : !genres.isPending && list.length === 0 ? (
        <p className={styles.message}>{term ? 'No genres match that.' : 'No genres yet.'}</p>
      ) : (
        <div className={styles.tiles}>
          {list.map((genre) => (
            <button
              key={genre.Id}
              type="button"
              className={styles.tile}
              onClick={() => navigate({ name: 'albums', genreId: genre.Id, title: genre.Name })}
            >
              <span className={styles.tileName}>{genre.Name}</span>
              {genre.AlbumCount !== undefined && (
                <span className={styles.tileCount}>
                  {genre.AlbumCount} {genre.AlbumCount === 1 ? 'album' : 'albums'}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </Page>
  );
}

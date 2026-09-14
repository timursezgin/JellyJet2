import { useState } from 'react';

import { usePlaylists } from '@/data/queries';
import { navigate } from '@/nav/navigation';
import { openNewPlaylist } from '@/songs/song-menu';
import { Plus } from 'lucide-react';
import { PlaylistCover } from '@/ui/covers';
import { ItemRow } from '@/ui/item-row';
import { Page } from '@/ui/page';
import { LoadError, LoadingRows } from '@/ui/states';
import styles from './list-screens.module.css';

/** The account's playlists, with New playlist on top. */
export function PlaylistsScreen() {
  const [term, setTerm] = useState('');
  const playlists = usePlaylists();
  const words = term.trim().toLowerCase();
  const matches = (name: string) => !words || name.toLowerCase().includes(words);
  const list = (playlists.data ?? []).filter((p) => matches(p.Name));

  return (
    <Page title="Playlists" search={{ value: term, onChange: setTerm, placeholder: 'Search playlists' }}>
      <div className={styles.rows}>
        {!words && (
          <ItemRow
            art={
              <span className={styles.newTile}>
                <Plus size={22} strokeWidth={2.4} />
              </span>
            }
            title="New playlist"
            accent
            onClick={openNewPlaylist}
          />
        )}
        {list.map((playlist) => (
          <ItemRow
            key={playlist.Id}
            art={<PlaylistCover playlistId={playlist.Id} size={52} />}
            title={playlist.Name}
            subtitle={songCount(playlist.ChildCount)}
            onClick={() => navigate({ name: 'playlist', id: playlist.Id, title: playlist.Name })}
          />
        ))}
      </div>
      {playlists.isPending && <LoadingRows count={4} height={70} />}
      {playlists.isError && <LoadError onRetry={() => playlists.refetch()} />}
    </Page>
  );
}

export function songCount(count: number | undefined) {
  if (count === undefined) return undefined;
  return `${count.toLocaleString()} ${count === 1 ? 'song' : 'songs'}`;
}


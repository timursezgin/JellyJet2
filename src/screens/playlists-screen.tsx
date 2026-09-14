import { useState } from 'react';

import { usePlaylists } from '@/data/queries';
import { navigate, useNavigation } from '@/nav/navigation';
import { DownloadedCover, LikedCover, PlaylistCover } from '@/ui/covers';
import { ItemRow } from '@/ui/item-row';
import { Page } from '@/ui/page';
import { LoadError, LoadingRows } from '@/ui/states';
import styles from './list-screens.module.css';

/** Liked Songs and Downloaded first, then the account's playlists. */
export function PlaylistsScreen() {
  const [term, setTerm] = useState('');
  const playlists = usePlaylists();
  const words = term.trim().toLowerCase();
  const matches = (name: string) => !words || name.toLowerCase().includes(words);
  const list = (playlists.data ?? []).filter((p) => matches(p.Name));

  return (
    <Page title="Playlists" search={{ value: term, onChange: setTerm, placeholder: 'Search playlists' }}>
      <div className={styles.rows}>
        {matches('Liked Songs') && (
          <ItemRow art={<LikedCover size={52} />} title="Liked Songs" onClick={() => navigate({ name: 'liked' })} />
        )}
        {matches('Downloaded') && (
          <ItemRow
            art={<DownloadedCover size={52} />}
            title="Downloaded"
            subtitle="Ready to play without internet"
            onClick={() => useNavigation.getState().selectTab('downloaded')}
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


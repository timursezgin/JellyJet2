import { useState, type ReactNode } from 'react';

import { filterTracks, useItem, useLikedSongs, usePlaylistTracks } from '@/data/queries';
import { playTracks } from '@/player/player';
import type { Track } from '@/player/track';
import type { SongContext } from '@/songs/song-menu';
import { LikedCover, PlaylistCover } from '@/ui/covers';
import { Hero } from '@/ui/hero';
import { Page } from '@/ui/page';
import { LoadError, LoadingRows } from '@/ui/states';
import { TRACK_ROW_HEIGHT, TrackRow } from '@/ui/track-row';
import { VirtualList } from '@/ui/virtual-list';
import { formatLength } from './album-screen';
import styles from './detail-screens.module.css';

export function PlaylistScreen({ id, title }: { id: string; title?: string }) {
  const playlist = useItem(id);
  const tracks = usePlaylistTracks(id);
  const name = playlist.data?.Name ?? title ?? '';
  return (
    <TrackCollection
      title={name}
      art={<PlaylistCover playlistId={id} size={200} />}
      query={tracks}
      empty="This playlist is empty."
      context={{ playlist: { id, name } }}
    />
  );
}

export function LikedSongsScreen() {
  const liked = useLikedSongs();
  return (
    <TrackCollection
      title="Liked Songs"
      art={<LikedCover size={200} />}
      query={liked}
      empty="Tap the heart on any song to add it here."
      confirmUnlike
    />
  );
}

interface TrackCollectionProps {
  title: string;
  art: ReactNode;
  query: { data?: Track[]; isPending: boolean; isError: boolean; refetch(): unknown };
  empty: string;
  context?: SongContext;
  /** Liked Songs: the heart opens an Unlike button; unliked rows fly out. */
  confirmUnlike?: boolean;
}

/** A playlist-shaped page: cover, Play/Shuffle, songs, swipe-down search. */
export function TrackCollection({ title, art, query, empty, context, confirmUnlike = false }: TrackCollectionProps) {
  const [term, setTerm] = useState('');
  const all = query.data ?? [];
  const searching = term.trim().length > 0;
  const shown = searching ? filterTracks(all, term) : all;
  const totalSeconds = all.reduce((sum, t) => sum + t.duration, 0);
  const meta = all.length
    ? `${all.length.toLocaleString()} ${all.length === 1 ? 'song' : 'songs'} · ${formatLength(totalSeconds)}`
    : undefined;

  return (
    <Page title={title} variant="detail" search={{ value: term, onChange: setTerm, placeholder: `Search ${title}` }}>
      {!searching && (
        <Hero
          layout="stacked"
          art={art}
          title={title}
          meta={meta}
          onPlay={all.length ? () => playTracks(all, 0, { shuffle: false }) : undefined}
          onShuffle={all.length ? () => playTracks(all, 0, { shuffle: true }) : undefined}
        />
      )}
      {query.isPending && <LoadingRows count={6} />}
      {query.isError && <LoadError onRetry={() => query.refetch()} />}
      {!query.isPending && !query.isError && shown.length === 0 && (
        <p className={styles.message}>{searching ? 'No songs match that.' : empty}</p>
      )}
      <VirtualList
        count={shown.length}
        rowHeight={TRACK_ROW_HEIGHT}
        rowKey={(i) => `${shown[i].id}:${shown[i].entryId ?? ''}`}
        animateMoves={confirmUnlike}
        renderRow={(i) => (
          <TrackRow
            track={shown[i]}
            context={context}
            confirmUnlike={confirmUnlike}
            onPlay={() => playTracks(shown, i, { shuffle: false })}
          />
        )}
      />
    </Page>
  );
}

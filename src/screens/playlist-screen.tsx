import { useState, type ReactNode } from 'react';

import { filterTracks, useItem, useLikedSongs, usePlaylistTracks } from '@/data/queries';
import { playTracks } from '@/player/player';
import type { Track } from '@/player/track';
import type { SongContext } from '@/songs/song-menu';
import { CollectionDownloadButton, useCollectionDownloadLabel } from '@/downloads/download-buttons';
import { artworkOf } from '@/jellyfin/api';
import { LikedCover, PlaylistCover } from '@/ui/covers';
import { Hero, heroIconClass } from '@/ui/hero';
import { Page } from '@/ui/page';
import { LoadError, LoadingRows } from '@/ui/states';
import { TRACK_ROW_HEIGHT, TrackRow } from '@/ui/track-row';
import { VirtualList } from '@/ui/virtual-list';
import { formatLength } from './album-screen';
import { useKeepInSync } from '@/downloads/use-keep-in-sync';
import styles from './detail-screens.module.css';

export function PlaylistScreen({ id, title }: { id: string; title?: string }) {
  const playlist = useItem(id);
  const tracks = usePlaylistTracks(id);
  const name = playlist.data?.Name ?? title ?? '';
  const info = { kind: 'playlist' as const, id, name, art: playlist.data ? artworkOf(playlist.data) : null };
  useKeepInSync('playlist', id, tracks.data);
  return (
    <TrackCollection
      title={name}
      art={<PlaylistCover playlistId={id} size={200} />}
      query={tracks}
      empty="This playlist is empty."
      context={{ playlist: { id, name } }}
      metaExtra={useCollectionDownloadLabel('playlist', id)}
      actions={<CollectionDownloadButton info={info} tracks={tracks.data} className={heroIconClass} />}
    />
  );
}

export function LikedSongsScreen() {
  const liked = useLikedSongs();
  useKeepInSync('liked', 'liked', liked.data);
  return (
    <TrackCollection
      title="Liked Songs"
      art={<LikedCover size={200} />}
      query={liked}
      empty="Tap the heart on any song to add it here."
      confirmUnlike
      metaExtra={useCollectionDownloadLabel('liked', 'liked')}
      actions={
        <CollectionDownloadButton
          info={{ kind: 'liked', id: 'liked', name: 'Liked Songs', art: null }}
          tracks={liked.data}
          className={heroIconClass}
        />
      }
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
  /** A small accent label above the title and a sentence under the details (mixes). */
  kicker?: string;
  note?: string;
  /** Added to the "12 songs · 40 min" line, e.g. "Downloaded". */
  metaExtra?: string;
  /** Extra square buttons after Play and Shuffle. */
  actions?: ReactNode;
  /** Shown between the header and the songs. */
  extra?: ReactNode;
  /** Rows below a removed one ease up into its place. */
  animateRemovals?: boolean;
}

/** A playlist-shaped page: cover, Play/Shuffle, songs, swipe-down search. */
export function TrackCollection({
  title,
  art,
  query,
  empty,
  context,
  confirmUnlike = false,
  kicker,
  note,
  metaExtra,
  actions,
  extra,
  animateRemovals = false,
}: TrackCollectionProps) {
  const [term, setTerm] = useState('');
  const all = query.data ?? [];
  const searching = term.trim().length > 0;
  const shown = searching ? filterTracks(all, term) : all;
  const totalSeconds = all.reduce((sum, t) => sum + t.duration, 0);
  const meta =
    [
      all.length ? `${all.length.toLocaleString()} ${all.length === 1 ? 'song' : 'songs'}` : undefined,
      all.length ? formatLength(totalSeconds) : undefined,
      metaExtra,
    ]
      .filter(Boolean)
      .join(' · ') || undefined;

  return (
    <Page title={title} variant="detail" search={{ value: term, onChange: setTerm, placeholder: `Search ${title}` }}>
      {!searching && (
        <Hero
          layout="stacked"
          art={art}
          title={title}
          kicker={kicker}
          note={note}
          meta={meta}
          onPlay={all.length ? () => playTracks(all, 0, { shuffle: false }) : undefined}
          onShuffle={all.length ? () => playTracks(all, 0, { shuffle: true }) : undefined}
          actions={actions}
        />
      )}
      {!searching && extra}
      {query.isPending && <LoadingRows count={6} />}
      {query.isError && !query.data && <LoadError onRetry={() => query.refetch()} />}
      {!query.isPending && !(query.isError && !query.data) && shown.length === 0 && (
        <p className={styles.message}>{searching ? 'No songs match that.' : empty}</p>
      )}
      <VirtualList
        count={shown.length}
        rowHeight={TRACK_ROW_HEIGHT}
        rowKey={(i) => `${shown[i].id}:${shown[i].entryId ?? ''}`}
        animateMoves={confirmUnlike || animateRemovals}
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

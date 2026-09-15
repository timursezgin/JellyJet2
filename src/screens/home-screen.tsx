import { Play } from 'lucide-react';

import { useSession } from '@/auth/session';
import { useLikedSongs, useRecentlyAddedAlbums, useRecentlyPlayedAlbums } from '@/data/queries';
import type { BaseItem } from '@/jellyfin/types';
import { navigate } from '@/nav/navigation';
import { continueIfCurrent, currentTrack, playTracks, usePlayer } from '@/player/player';
import { artistLine, type Track } from '@/player/track';
import { songContextMenu } from '@/songs/song-menu';
import { AlbumCard } from '@/ui/album-card';
import { Artwork } from '@/ui/artwork';
import { Page } from '@/ui/page';
import { SectionHeader, Shelf } from '@/ui/section';
import { MadeForYou, Stations } from './home-mixes';
import styles from './home-screen.module.css';

export function HomeScreen() {
  const serverName = useSession((s) => s.session?.serverName);
  const played = useRecentlyPlayedAlbums();
  const added = useRecentlyAddedAlbums();
  const liked = useLikedSongs();

  return (
    <Page
      title="Home"
      trailing={
        <span className={styles.pill}>
          <span className={styles.dot} />
          {serverName}
        </span>
      }
    >
      <SectionHeader title="Recently played" onOpen={() => navigate({ name: 'recent-albums', kind: 'played' })} />
      <AlbumShelf query={played} empty="Nothing played yet." />

      <SectionHeader title="Liked Songs" onOpen={() => navigate({ name: 'liked' })} />
      {liked.data && liked.data.length > 0 ? (
        <Shelf>
          {liked.data.slice(0, 20).map((track, i, list) => (
            <SongCard key={track.id} track={track} onPlay={() => playTracks(list, i)} />
          ))}
        </Shelf>
      ) : (
        <ShelfMessage loading={liked.isPending} text="Songs you like will show up here." />
      )}

      <MadeForYou />

      <SectionHeader title="Recently added" onOpen={() => navigate({ name: 'recent-albums', kind: 'added' })} />
      <AlbumShelf query={added} empty="Nothing added yet." />

      <Stations />
    </Page>
  );
}

/** A liked song on Home's shelf; with a mouse, a play symbol shows over the cover. */
function SongCard({ track, onPlay }: { track: Track; onPlay(): void }) {
  const isPlaying = usePlayer((s) => s.playing && currentTrack(s)?.id === track.id);
  return (
    <button
      type="button"
      className={styles.songCard}
      onClick={() => {
        if (!continueIfCurrent(track.id)) onPlay();
      }}
      onContextMenu={songContextMenu(track)}
    >
      <span className={styles.songCover}>
        <Artwork art={track.art} size={118} radius={10} />
        {!isPlaying && (
          <span className={styles.playHint} aria-hidden="true">
            <Play size={22} fill="currentColor" strokeWidth={0} />
          </span>
        )}
      </span>
      <span className={styles.songTitle}>{track.name}</span>
      <span className={styles.songArtist}>{artistLine(track)}</span>
    </button>
  );
}

function AlbumShelf({ query, empty }: { query: { data?: BaseItem[]; isPending: boolean }; empty: string }) {
  if (!query.data?.length) return <ShelfMessage loading={query.isPending} text={empty} />;
  return (
    <Shelf>
      {query.data.map((album) => (
        <AlbumCard key={album.Id} album={album} size={146} small />
      ))}
    </Shelf>
  );
}

function ShelfMessage({ loading, text }: { loading: boolean; text: string }) {
  if (loading) {
    return (
      <Shelf>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={styles.placeholder} />
        ))}
      </Shelf>
    );
  }
  return <p className={styles.empty}>{text}</p>;
}

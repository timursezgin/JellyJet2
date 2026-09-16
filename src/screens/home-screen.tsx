import { Play } from 'lucide-react';

import { useSession } from '@/auth/session';
import { useLikedAlbums, useLikedSongs, useRecentlyAddedAlbums, useRecentlyPlayedSongs } from '@/data/queries';
import type { BaseItem } from '@/jellyfin/types';
import { navigate } from '@/nav/navigation';
import { continueIfCurrent, currentTrack, playTracks, usePlayer } from '@/player/player';
import { artistLine, type Track } from '@/player/track';
import { songContextMenu } from '@/songs/song-menu';
import { AlbumCard } from '@/ui/album-card';
import { Artwork } from '@/ui/artwork';
import { Page } from '@/ui/page';
import { SectionHeader, Shelf } from '@/ui/section';
import { APP_VERSION } from '@/update/update';
import { UpdateNotice } from '@/update/update-notice';
import { MadeForYou, Stations } from './home-mixes';
import styles from './home-screen.module.css';

export function HomeScreen() {
  const serverName = useSession((s) => s.session?.serverName);
  const played = useRecentlyPlayedSongs();
  const added = useRecentlyAddedAlbums();
  const liked = useLikedSongs();
  const likedAlbums = useLikedAlbums();

  return (
    <Page
      title="Home"
      trailing={
        // The app's version beside the server, and under it the update offer when there is one.
        <span className={styles.status}>
          <span className={styles.version}>v{APP_VERSION}</span>
          <span className={styles.pill}>
            <span className={styles.dot} />
            {serverName}
          </span>
          <UpdateNotice className={styles.update} />
        </span>
      }
    >
      <SectionHeader title="Recently played" onOpen={() => navigate({ name: 'recent-songs' })} />
      <SongShelf query={played} empty="Nothing played yet." newestFirst />

      <SectionHeader title="Liked Songs" onOpen={() => navigate({ name: 'liked' })} />
      <SongShelf query={liked} empty="Songs you like will show up here." />

      <SectionHeader title="Liked Albums" onOpen={() => navigate({ name: 'liked-albums' })} />
      <AlbumShelf query={likedAlbums} empty="Albums you like will show up here." playable />

      <MadeForYou />

      <SectionHeader title="Recently added" onOpen={() => navigate({ name: 'recent-albums' })} />
      <AlbumShelf query={added} empty="Nothing added yet." newestFirst />

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

/** Up to 20 songs; tapping one plays the shelf from there. */
function SongShelf({
  query,
  empty,
  newestFirst,
}: {
  query: { data?: Track[]; isPending: boolean };
  empty: string;
  /** A "recent" row: slides back to show a newly arrived first card. */
  newestFirst?: boolean;
}) {
  if (!query.data?.length) return <ShelfMessage loading={query.isPending} text={empty} />;
  return (
    <Shelf newest={newestFirst ? query.data[0].id : undefined}>
      {query.data.slice(0, 20).map((track, i, list) => (
        <SongCard key={track.id} track={track} onPlay={() => playTracks(list, i)} />
      ))}
    </Shelf>
  );
}

function AlbumShelf({
  query,
  empty,
  playable,
  newestFirst,
}: {
  query: { data?: BaseItem[]; isPending: boolean };
  empty: string;
  playable?: boolean;
  /** A "recent" row: slides back to show a newly arrived first card. */
  newestFirst?: boolean;
}) {
  if (!query.data?.length) return <ShelfMessage loading={query.isPending} text={empty} />;
  return (
    <Shelf newest={newestFirst ? query.data[0].Id : undefined}>
      {query.data.slice(0, 20).map((album) => (
        <AlbumCard key={album.Id} album={album} size={146} small playable={playable} />
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

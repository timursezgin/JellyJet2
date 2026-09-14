import { useSession } from '@/auth/session';
import { useLikedSongs, useRecentlyAddedAlbums, useRecentlyPlayedAlbums } from '@/data/queries';
import type { BaseItem } from '@/jellyfin/types';
import { navigate } from '@/nav/navigation';
import { playTracks } from '@/player/player';
import { artistLine } from '@/player/track';
import { AlbumCard } from '@/ui/album-card';
import { Artwork } from '@/ui/artwork';
import { Page } from '@/ui/page';
import { SectionHeader, Shelf } from '@/ui/section';
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
            <button
              key={track.id}
              type="button"
              className={styles.songCard}
              onClick={() => playTracks(list, i)}
            >
              <Artwork art={track.art} size={118} radius={10} />
              <span className={styles.songTitle}>{track.name}</span>
              <span className={styles.songArtist}>{artistLine(track)}</span>
            </button>
          ))}
        </Shelf>
      ) : (
        <ShelfMessage loading={liked.isPending} text="Songs you like will show up here." />
      )}

      <SectionHeader title="Recently added" onOpen={() => navigate({ name: 'recent-albums', kind: 'added' })} />
      <AlbumShelf query={added} empty="Nothing added yet." />
    </Page>
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

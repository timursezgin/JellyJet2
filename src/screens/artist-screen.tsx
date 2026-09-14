import { useEffect, useRef, useState, type RefObject } from 'react';

import { filterTracks, useArtistAlbums, useArtistTracks, useItem } from '@/data/queries';
import { artworkOf } from '@/jellyfin/api';
import { playTracks } from '@/player/player';
import { AlbumCard } from '@/ui/album-card';
import { Artwork } from '@/ui/artwork';
import { Hero } from '@/ui/hero';
import { Page } from '@/ui/page';
import { SectionHeader } from '@/ui/section';
import { LoadError, LoadingRows } from '@/ui/states';
import { TrackRow } from '@/ui/track-row';
import styles from './detail-screens.module.css';

const TOP_SONGS = 5;

export function ArtistScreen({ id, title }: { id: string; title?: string }) {
  const [term, setTerm] = useState('');
  const artist = useItem(id);
  const tracks = useArtistTracks(id);
  const albums = useArtistAlbums(id);
  const allTracks = tracks.data ?? [];
  const allAlbums = albums.data ?? [];
  const name = artist.data?.Name ?? title ?? '';

  const searching = term.trim().length > 0;
  const words = term.trim().toLowerCase();
  const songs = searching ? filterTracks(allTracks, term) : allTracks.slice(0, TOP_SONGS);
  const albumList = searching ? allAlbums.filter((a) => a.Name.toLowerCase().includes(words)) : allAlbums;

  const meta = [
    allAlbums.length ? `${allAlbums.length} ${allAlbums.length === 1 ? 'album' : 'albums'}` : undefined,
    allTracks.length ? `${allTracks.length} ${allTracks.length === 1 ? 'song' : 'songs'}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  // Grid cells fill the page width, two to a row.
  const gridRef = useRef<HTMLDivElement>(null);
  const cellSize = useCellSize(gridRef);

  return (
    <Page
      title={name}
      variant="detail"
      search={{ value: term, onChange: setTerm, placeholder: `Search ${name || 'this artist'}` }}
    >
      {!searching && (
        <Hero
          layout="stacked"
          art={<Artwork art={artist.data ? artworkOf(artist.data) : null} size={104} round eager />}
          title={name}
          meta={meta}
          onPlay={allTracks.length ? () => playTracks(allTracks, 0, { shuffle: false }) : undefined}
          onShuffle={allTracks.length ? () => playTracks(allTracks, 0, { shuffle: true }) : undefined}
        />
      )}

      <SectionHeader title={searching ? 'Songs' : 'Top songs'} />
      {tracks.isPending && <LoadingRows count={TOP_SONGS} />}
      {tracks.isError && <LoadError onRetry={() => tracks.refetch()} />}
      {songs.map((track, i) => (
        <TrackRow
          key={track.id}
          track={track}
          subtitle={track.album}
          onPlay={() => playTracks(songs, i, { shuffle: false })}
        />
      ))}
      {searching && songs.length === 0 && !tracks.isPending && <p className={styles.message}>No songs match that.</p>}

      {(albumList.length > 0 || albums.isPending) && <SectionHeader title="Albums" />}
      <div ref={gridRef} className={styles.albums}>
        {cellSize > 0 &&
          albumList.map((album) => (
            <AlbumCard key={album.Id} album={album} size={cellSize} subtitle={album.ProductionYear ? String(album.ProductionYear) : ''} />
          ))}
      </div>
    </Page>
  );
}

function useCellSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setSize(Math.floor((inner - 16) / 2));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

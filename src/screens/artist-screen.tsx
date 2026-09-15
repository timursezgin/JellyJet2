import { useEffect, useRef, useState, type RefObject } from 'react';

import { filterTracks, useArtistAlbums, useArtistTracks, useItem } from '@/data/queries';
import { artworkOf } from '@/jellyfin/api';
import { playTracks } from '@/player/player';
import { AlbumCard } from '@/ui/album-card';
import { Artwork } from '@/ui/artwork';
import { HERO_ART, Hero } from '@/ui/hero';
import { Page } from '@/ui/page';
import { SectionHeader } from '@/ui/section';
import { LoadError, LoadingRows } from '@/ui/states';
import { sortTracks, useTrackSort } from '@/songs/track-sort';
import { TrackListHeader, TrackRow } from '@/ui/track-row';
import { gridColumns } from './albums-screen';
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
  const [sort, onSort] = useTrackSort();
  const songs = sortTracks(searching ? filterTracks(allTracks, term) : allTracks.slice(0, TOP_SONGS), sort);
  const albumList = searching ? allAlbums.filter((a) => a.Name.toLowerCase().includes(words)) : allAlbums;

  const meta = [
    allAlbums.length ? `${allAlbums.length} ${allAlbums.length === 1 ? 'album' : 'albums'}` : undefined,
    allTracks.length ? `${allTracks.length} ${allTracks.length === 1 ? 'song' : 'songs'}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  // Grid cells fill the page width, two to a row on a phone, more when wider.
  const gridRef = useRef<HTMLDivElement>(null);
  const { size: cellSize, columns } = useCellSize(gridRef);

  return (
    <Page
      title={name}
      variant="detail"
      search={{ value: term, onChange: setTerm, placeholder: `Search ${name || 'this artist'}` }}
    >
      {!searching && (
        <Hero
          layout="side"
          art={<Artwork art={artist.data ? artworkOf(artist.data) : null} size={HERO_ART} round eager />}
          title={name}
          meta={meta}
          onPlay={allTracks.length ? () => playTracks(allTracks, 0, { shuffle: false }) : undefined}
          onShuffle={allTracks.length ? () => playTracks(allTracks, 0, { shuffle: true }) : undefined}
        />
      )}

      <SectionHeader title={searching ? 'Songs' : 'Top songs'} />
      {songs.length > 0 && <TrackListHeader sort={sort} onSort={onSort} />}
      {tracks.isPending && <LoadingRows count={TOP_SONGS} />}
      {tracks.isError && !tracks.data && <LoadError onRetry={() => tracks.refetch()} />}
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
      <div ref={gridRef} className={styles.albums} style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {cellSize > 0 &&
          albumList.map((album) => (
            <AlbumCard key={album.Id} album={album} size={cellSize} subtitle={album.ProductionYear ? String(album.ProductionYear) : ''} />
          ))}
      </div>
    </Page>
  );
}

function useCellSize(ref: RefObject<HTMLDivElement | null>) {
  const [cells, setCells] = useState({ size: 0, columns: 2 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const columns = gridColumns(inner);
      const size = Math.floor((inner - 16 * (columns - 1)) / columns);
      setCells((c) => (c.size === size && c.columns === columns ? c : { size, columns }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return cells;
}

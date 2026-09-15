import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useSearch, type SearchFilter } from '@/data/queries';
import { artworkOf } from '@/jellyfin/api';
import { navigate } from '@/nav/navigation';
import { playTracks } from '@/player/player';
import { useSearchFocus } from '@/shell/shortcuts';
import { albumSubtitle } from '@/ui/album-card';
import { Artwork } from '@/ui/artwork';
import { ItemRow } from '@/ui/item-row';
import { Page } from '@/ui/page';
import { SectionHeader } from '@/ui/section';
import { sortTracks, useTrackSort } from '@/songs/track-sort';
import { TrackListHeader, TrackRow } from '@/ui/track-row';
import styles from './search-screen.module.css';

const FILTERS: { id: SearchFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'songs', label: 'Songs' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
];

const RECENT_KEY = 'jj.recentSearches';

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function SearchScreen() {
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('all');
  const [recent, setRecent] = useState(loadRecent);
  const results = useSearch(term, filter);
  const active = term.trim().length >= 2;
  const data = active ? results.data : undefined;

  const remember = () => {
    const value = term.trim();
    if (value.length < 2) return;
    const next = [value, ...recent.filter((r) => r.toLowerCase() !== value.toLowerCase())].slice(0, 8);
    setRecent(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  };

  const nothing = data && data.artists.length + data.albums.length + data.songs.length === 0;
  const [sort, onSort] = useTrackSort();
  const songs = sortTracks(data?.songs ?? [], sort);

  // Ctrl+F, / or Search in the sidebar: ready to type.
  const input = useRef<HTMLInputElement>(null);
  const focusRequests = useSearchFocus((s) => s.requests);
  useEffect(() => {
    if (!focusRequests) return;
    input.current?.focus();
    input.current?.select();
  }, [focusRequests]);

  return (
    <Page title="Search">
      <div className={styles.controls}>
        <label className={styles.field}>
          <Search size={17} strokeWidth={2.2} />
          <input
            ref={input}
            type="search"
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Artists, songs, albums"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                remember();
                e.currentTarget.blur();
              }
            }}
          />
          {term && (
            <button type="button" className={styles.clear} onClick={() => setTerm('')} aria-label="Clear search">
              <X size={14} strokeWidth={3} />
            </button>
          )}
        </label>
        <div className={styles.chips}>
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={styles.chip}
              data-active={filter === id || undefined}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!active && recent.length > 0 && (
        <>
          <p className={styles.recentTitle}>Recent searches</p>
          {recent.map((query) => (
            <button key={query} type="button" className={styles.recent} onClick={() => setTerm(query)}>
              {query}
            </button>
          ))}
        </>
      )}

      {nothing && <p className={styles.nothing}>Nothing matched that.</p>}

      {data && data.artists.length > 0 && (
        <>
          {filter === 'all' && <SectionHeader title="Artists" />}
          {data.artists.map((artist) => (
            <ItemRow
              key={artist.Id}
              art={<Artwork art={artworkOf(artist)} size={44} round />}
              title={artist.Name}
              subtitle="Artist"
              onClick={() => {
                remember();
                navigate({ name: 'artist', id: artist.Id, title: artist.Name });
              }}
            />
          ))}
        </>
      )}

      {data && data.albums.length > 0 && (
        <>
          {filter === 'all' && <SectionHeader title="Albums" />}
          {data.albums.map((album) => (
            <ItemRow
              key={album.Id}
              art={<Artwork art={artworkOf(album)} size={44} radius={8} />}
              title={album.Name}
              subtitle={['Album', albumSubtitle(album)].filter(Boolean).join(' · ')}
              onClick={() => {
                remember();
                navigate({ name: 'album', id: album.Id, title: album.Name });
              }}
            />
          ))}
        </>
      )}

      {songs.length > 0 && (
        <>
          {filter === 'all' && <SectionHeader title="Songs" />}
          <TrackListHeader sort={sort} onSort={onSort} />
          {songs.map((track, i) => (
            <TrackRow
              key={track.id}
              track={track}
              onPlay={() => {
                remember();
                playTracks(songs, i, { shuffle: false });
              }}
            />
          ))}
        </>
      )}
    </Page>
  );
}

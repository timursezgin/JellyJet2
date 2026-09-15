import { ChevronDown, ChevronUp, Play } from 'lucide-react';
import { useRef } from 'react';

import { useOnline } from '@/connectivity/connection';
import { useIsDownloaded } from '@/downloads/downloads';
import { navigate } from '@/nav/navigation';
import { continueIfCurrent, currentTrack, usePlayer } from '@/player/player';
import { artistLine, formatTime, type Track } from '@/player/track';
import { revealUnlike, setLiked, useIsLeaving, useIsRevealed } from '@/songs/likes';
import { SongButtons } from '@/songs/song-buttons';
import { beginSongDrag } from '@/songs/song-drag';
import { songContextMenu, type SongContext } from '@/songs/song-menu';
import type { SortKey, TrackSort } from '@/songs/track-sort';
import { Artwork } from './artwork';
import { TextLink } from './text-link';
import { toast } from './toast';
import { useCloseWhenTappedElsewhere } from './use-close-when-tapped-elsewhere';
import { useDesktop } from './use-desktop';
import styles from './track-row.module.css';

/** Fixed height, so long lists can be drawn only where they're visible. */
export const TRACK_ROW_HEIGHT = 56;

interface TrackRowProps {
  track: Track;
  onPlay(): void;
  /** `art` shows the cover; a number shows the track number (album pages). */
  leading?: 'art' | number;
  /** What goes under the title on a phone; defaults to "Artist · Album". */
  subtitle?: string;
  /** Desktop columns: an album page has no Album column (every song is from it). */
  hideAlbum?: boolean;
  /** Where the row is shown, for the (…) menu (e.g. inside a playlist). */
  context?: SongContext;
  /**
   * Liked Songs: the heart slides the row open to a red Unlike button instead
   * of unliking straight away, and an unliked row flies out.
   */
  confirmUnlike?: boolean;
}

/**
 * A song row: tap anywhere on the song to play it; heart, download and (…)
 * on the right are their own full-height buttons. On a computer the artist,
 * album and length get their own columns (see TrackListHeader), right-click
 * opens the (…) menu, and the row can be dragged onto a sidebar playlist.
 */
export function TrackRow({
  track,
  onPlay,
  leading = 'art',
  subtitle,
  hideAlbum = false,
  context,
  confirmUnlike = false,
}: TrackRowProps) {
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === track.id);
  const isPlaying = usePlayer((s) => s.playing && currentTrack(s)?.id === track.id);
  const leaving = useIsLeaving(track.id) && confirmUnlike;
  const revealed = useIsRevealed(track.id) && confirmUnlike && !leaving;
  const desktop = useDesktop();
  const unlikeButton = useRef<HTMLButtonElement>(null);
  const online = useOnline();
  const downloaded = useIsDownloaded(track.id);
  const unavailable = !online && !downloaded;
  // Clicking the song that's already playing does nothing, and one that can't play offline just explains.
  const willPlay = !unavailable && !isPlaying;

  const line = desktop ? '' : (subtitle ?? [artistLine(track), track.album].filter(Boolean).join(' · '));

  useCloseWhenTappedElsewhere(revealed, unlikeButton, () => revealUnlike(null));

  const play = () => {
    if (unavailable) {
      toast('Not downloaded - it needs a connection');
      return;
    }
    if (!continueIfCurrent(track.id)) onPlay();
  };

  const buttons = (
    <SongButtons
      track={track}
      context={context}
      onUnlikeRequest={confirmUnlike ? () => revealUnlike(track.id) : undefined}
    />
  );

  return (
    <div
      className={styles.row}
      data-current={isCurrent || undefined}
      data-revealed={revealed || undefined}
      data-leaving={leaving || undefined}
      data-unavailable={unavailable || undefined}
      onContextMenu={songContextMenu(track, context)}
      onPointerDown={(e) => beginSongDrag(e, track)}
      // The cover image would otherwise start the browser's own image drag.
      onDragStart={(e) => e.preventDefault()}
    >
      {confirmUnlike && (
        <button
          ref={unlikeButton}
          type="button"
          className={styles.unlike}
          tabIndex={revealed ? 0 : -1}
          aria-hidden={!revealed}
          onClick={() => {
            revealUnlike(null);
            void setLiked(track, false);
          }}
        >
          <span>Unlike</span>
        </button>
      )}
      <div className={styles.slide}>
        <button type="button" className={styles.main} onClick={play} aria-disabled={unavailable || undefined}>
          <span className={styles.lead} data-art={leading === 'art' || undefined}>
            {leading === 'art' ? (
              <Artwork art={track.art} size={40} radius={8} />
            ) : (
              <span className={styles.number}>{leading}</span>
            )}
            {/* Mouse only: shown on hover when clicking would start the song. */}
            {willPlay && (
              <span className={styles.playHint} aria-hidden="true">
                <Play size={16} fill="currentColor" strokeWidth={0} />
              </span>
            )}
          </span>
          <span className={styles.text}>
            <span className={styles.title}>{track.name}</span>
            {line && <span className={styles.subtitle}>{line}</span>}
          </span>
        </button>
        {desktop ? (
          <>
            <div className={`${styles.cell} ${styles.colArtist}`} onClick={play}>
              <span className={styles.cellText}>
                {track.artists.map((artist, i) => (
                  <span key={`${artist.name}-${i}`}>
                    {i > 0 && ', '}
                    {artist.id ? (
                      <TextLink
                        className={styles.link}
                        onOpen={() => navigate({ name: 'artist', id: artist.id!, title: artist.name })}
                      >
                        {artist.name}
                      </TextLink>
                    ) : (
                      artist.name
                    )}
                  </span>
                ))}
              </span>
            </div>
            {!hideAlbum && (
              <div className={`${styles.cell} ${styles.colAlbum}`} onClick={play}>
                <span className={styles.cellText}>
                  {track.album &&
                    (track.albumId ? (
                      <TextLink
                        className={styles.link}
                        onOpen={() => navigate({ name: 'album', id: track.albumId!, title: track.album })}
                      >
                        {track.album}
                      </TextLink>
                    ) : (
                      track.album
                    ))}
                </span>
              </div>
            )}
            <span className={`${styles.cell} ${styles.colLength}`} onClick={play}>
              {track.duration ? formatTime(track.duration) : ''}
            </span>
            <div className={styles.colActions}>{buttons}</div>
          </>
        ) : (
          buttons
        )}
      </div>
    </div>
  );
}

interface HeaderProps {
  sort: TrackSort | null;
  /** Leave out to show the column names without sorting. */
  onSort?(key: SortKey): void;
  /** Album pages: a # over the track numbers, and no Album column. */
  numbered?: boolean;
  hideAlbum?: boolean;
}

/** Desktop: the column names above a song list; click one to sort by it. */
export function TrackListHeader({ sort, onSort, numbered = false, hideAlbum = false }: HeaderProps) {
  const desktop = useDesktop();
  if (!desktop) return null;

  const column = (key: SortKey, label: string, className: string) => {
    const active = sort?.key === key;
    const Arrow = sort?.descending ? ChevronDown : ChevronUp;
    return (
      <div className={`${styles.headCell} ${className}`}>
        {onSort ? (
          <button
            type="button"
            className={styles.headButton}
            data-active={active || undefined}
            onClick={() => onSort(key)}
            aria-label={`Sort by ${label.toLowerCase()}`}
          >
            {label}
            {active && <Arrow size={14} strokeWidth={2.6} />}
          </button>
        ) : (
          <span className={styles.headLabel}>{label}</span>
        )}
      </div>
    );
  };

  return (
    <div className={styles.header}>
      <div className={styles.headMain}>
        <span className={styles.headLead} data-numbered={numbered || undefined}>
          {numbered ? '#' : ''}
        </span>
        {column('title', 'Title', '')}
      </div>
      {column('artist', 'Artist', styles.colArtist)}
      {!hideAlbum && column('album', 'Album', styles.colAlbum)}
      {column('duration', 'Length', styles.colLength)}
      <div className={styles.colActions} />
    </div>
  );
}

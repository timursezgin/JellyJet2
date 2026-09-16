import { ArrowDownToLine, Heart, Radio } from 'lucide-react';

import { usePlaylistCoverArt } from '@/data/queries';
import type { Track } from '@/player/track';
import { AlbumLikeIcon } from './album-like-icon';
import { Artwork } from './artwork';
import styles from './covers.module.css';

interface CoverProps {
  size: number;
  radius?: number;
}

/** A playlist's cover from its current songs: four albums in a grid, or one. */
export function PlaylistCover({ playlistId, size, radius = 10 }: CoverProps & { playlistId: string }) {
  return <ArtGrid art={usePlaylistCoverArt(playlistId).data ?? []} size={size} radius={radius} />;
}

/** Four different album covers from a list of songs, in a grid (or the first alone). */
export function SongsCover({ tracks, size, radius = 10 }: CoverProps & { tracks: Track[] }) {
  const seen = new Set<string>();
  const art: { id: string; tag: string }[] = [];
  for (const track of tracks) {
    const key = track.albumId ?? track.art?.id;
    if (!track.art || !key || seen.has(key)) continue;
    seen.add(key);
    art.push(track.art);
    if (art.length === 4) break;
  }
  return <ArtGrid art={art} size={size} radius={radius} />;
}

/** A station built on the phone (Artist mix). */
export function StationCover({ size, radius = 10 }: CoverProps) {
  return (
    <div className={`${styles.special} ${styles.station}`} style={{ width: size, height: size, borderRadius: radius }}>
      <Radio size={Math.round(size * 0.36)} strokeWidth={2} />
    </div>
  );
}

function ArtGrid({ art, size, radius }: { art: { id: string; tag: string }[]; size: number; radius: number }) {
  if (art.length < 4) return <Artwork art={art[0]} size={size} radius={radius} />;
  const half = size / 2;
  return (
    <div className={styles.grid} style={{ width: size, height: size, borderRadius: radius }}>
      {art.map((image) => (
        <Artwork key={image.id} art={image} size={half} radius={0} />
      ))}
    </div>
  );
}

/** The special Liked Songs playlist. */
export function LikedCover({ size, radius = 10 }: CoverProps) {
  return (
    <div className={`${styles.special} ${styles.liked}`} style={{ width: size, height: size, borderRadius: radius }}>
      <Heart size={Math.round(size * 0.4)} fill="currentColor" strokeWidth={0} />
    </div>
  );
}

/** Liked Albums: the album page's liked icon (a record with a filled heart), white on blue. */
export function LikedAlbumsCover({ size, radius = 10 }: CoverProps) {
  return (
    <div className={`${styles.special} ${styles.likedAlbums}`} style={{ width: size, height: size, borderRadius: radius }}>
      <AlbumLikeIcon size={Math.round(size * 0.5)} strokeWidth={2} fill="currentColor" />
    </div>
  );
}

/** The special Downloaded playlist. */
export function DownloadedCover({ size, radius = 10 }: CoverProps) {
  return (
    <div className={`${styles.special} ${styles.downloaded}`} style={{ width: size, height: size, borderRadius: radius }}>
      <ArrowDownToLine size={Math.round(size * 0.4)} strokeWidth={2.2} />
    </div>
  );
}

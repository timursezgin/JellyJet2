import { ArrowDownToLine, Heart } from 'lucide-react';

import { usePlaylistCoverArt } from '@/data/queries';
import { Artwork } from './artwork';
import styles from './covers.module.css';

interface CoverProps {
  size: number;
  radius?: number;
}

/** A playlist's cover from its current songs: four albums in a grid, or one. */
export function PlaylistCover({ playlistId, size, radius = 10 }: CoverProps & { playlistId: string }) {
  const art = usePlaylistCoverArt(playlistId).data ?? [];
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

/** The special Downloaded playlist. */
export function DownloadedCover({ size, radius = 10 }: CoverProps) {
  return (
    <div className={`${styles.special} ${styles.downloaded}`} style={{ width: size, height: size, borderRadius: radius }}>
      <ArrowDownToLine size={Math.round(size * 0.4)} strokeWidth={2.2} />
    </div>
  );
}

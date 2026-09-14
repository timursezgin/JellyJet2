import { Music } from 'lucide-react';
import { createContext, useContext, useState } from 'react';

import { useSession } from '@/auth/session';
import { imageUrl } from '@/jellyfin/api';
import styles from './artwork.module.css';

interface ArtworkProps {
  art: { id: string; tag: string } | null | undefined;
  /** Display size in px; the image is fetched sharp for the screen. */
  size: number;
  radius?: number;
  round?: boolean;
  className?: string;
  eager?: boolean;
}

// A few fixed sizes so the same picture is shared by the browser cache.
const BUCKETS = [96, 160, 256, 400, 640, 900];

/** Covers already shown this session: they appear at once, without fading in again. */
const shown = new Set<string>();

/**
 * Lists that only draw the rows near the screen load their covers straight
 * away (the list already limits how many), so they don't pop in while scrolling.
 */
export const EagerArtwork = createContext(false);

/** Cover art on the placeholder colour, with the design's 1px inner line. */
export function Artwork({ art, size, radius = 10, round = false, className, eager = false }: ArtworkProps) {
  const baseUrl = useSession((s) => s.session?.serverUrl);
  const inVirtualList = useContext(EagerArtwork);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const pixels = size * Math.min(window.devicePixelRatio || 1, 3);
  const bucket = BUCKETS.find((b) => b >= pixels) ?? BUCKETS[BUCKETS.length - 1];
  const src = art && baseUrl ? imageUrl(baseUrl, art.id, art.tag, bucket) : null;
  const showImage = src && failed !== src;
  const seen = !!src && shown.has(src);

  return (
    <div
      className={`${styles.art} ${className ?? ''}`}
      style={{ width: size, height: size, borderRadius: round ? '50%' : radius }}
    >
      {showImage ? (
        <img
          key={src}
          src={src}
          alt=""
          loading={eager || inVirtualList || seen ? 'eager' : 'lazy'}
          // A picture already in memory is drawn in the same frame as its row.
          decoding={seen ? 'sync' : 'async'}
          draggable={false}
          data-loaded={seen || loaded === src || undefined}
          data-instant={seen || undefined}
          onLoad={() => {
            shown.add(src);
            setLoaded(src);
          }}
          onError={() => setFailed(src)}
        />
      ) : (
        <Music className={styles.glyph} size={Math.round(size * 0.36)} strokeWidth={1.6} />
      )}
    </div>
  );
}

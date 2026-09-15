import { Play, X } from 'lucide-react';

import { Artwork } from '@/ui/artwork';
import { acceptHandoff, dismissHandoff, useHandoff } from './handoff';
import { artistLine, formatTime } from './track';
import styles from './handoff-offer.module.css';

/** "Left off on Mac (Chrome)" - a card offering to continue that song here. */
export function HandoffOffer() {
  const offer = useHandoff((s) => s.offer);
  if (!offer) return null;
  const track = offer.tracks[offer.index];
  const artist = artistLine(track);
  return (
    <div className={styles.offer} role="status">
      <Artwork art={track.art} size={44} radius={8} eager />
      <div className={styles.text}>
        <span className={styles.from}>Left off on {offer.deviceName}</span>
        <span className={styles.title}>{track.name}</span>
        <span className={styles.detail}>
          {[artist, offer.position > 0 ? formatTime(offer.position) : null].filter(Boolean).join(' · ')}
        </span>
      </div>
      <button type="button" className={styles.continue} onClick={acceptHandoff}>
        <Play size={14} fill="currentColor" strokeWidth={0} />
        Continue
      </button>
      <button type="button" className={styles.dismiss} onClick={dismissHandoff} aria-label="Not now">
        <X size={18} strokeWidth={2.2} />
      </button>
    </div>
  );
}

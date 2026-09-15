import { Play, X } from 'lucide-react';

import { currentTrack, play, usePlayer } from '@/player/player';
import { artistLine } from '@/player/track';
import { Artwork } from '@/ui/artwork';
import styles from '@/player/handoff-offer.module.css';

/**
 * Music was sent to this device, but iOS won't start sound without a tap (the
 * app hasn't played since it opened): one tap here starts it.
 */
export function TapToPlay() {
  const needsTap = usePlayer((s) => s.needsTap);
  const track = usePlayer((s) => currentTrack(s));
  if (!needsTap || !track) return null;
  return (
    <div className={styles.offer} role="status">
      <Artwork art={track.art} size={44} radius={8} eager />
      <div className={styles.text}>
        <span className={styles.from}>Ready to play here</span>
        <span className={styles.title}>{track.name}</span>
        <span className={styles.detail}>{artistLine(track)}</span>
      </div>
      <button type="button" className={styles.continue} onClick={play}>
        <Play size={14} fill="currentColor" strokeWidth={0} />
        Play
      </button>
      <button type="button" className={styles.dismiss} onClick={() => usePlayer.setState({ needsTap: false })} aria-label="Not now">
        <X size={18} strokeWidth={2.2} />
      </button>
    </div>
  );
}

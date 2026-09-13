import { useEffect, useState } from 'react';

import { audio, currentPosition } from './player';

/**
 * The playback position in seconds. `smooth` follows every frame while
 * playing (for a scrubber you watch); otherwise it updates a few times a second.
 */
export function usePosition(smooth = false): number {
  const [position, setPosition] = useState(currentPosition);

  useEffect(() => {
    const update = () => setPosition(currentPosition());
    const events = ['timeupdate', 'seeked', 'loadedmetadata', 'emptied'];
    for (const event of events) audio.addEventListener(event, update);

    let frame = 0;
    const tick = () => {
      update();
      frame = requestAnimationFrame(tick);
    };
    const startFrames = () => {
      if (smooth && !frame && document.visibilityState === 'visible') frame = requestAnimationFrame(tick);
    };
    const stopFrames = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    if (!audio.paused) startFrames();
    audio.addEventListener('playing', startFrames);
    audio.addEventListener('pause', stopFrames);
    update();

    return () => {
      for (const event of events) audio.removeEventListener(event, update);
      audio.removeEventListener('playing', startFrames);
      audio.removeEventListener('pause', stopFrames);
      stopFrames();
    };
  }, [smooth]);

  return position;
}

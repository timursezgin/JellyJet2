import { useEffect, useState } from 'react';

import { currentPosition, subscribePosition, usePlayer } from './player';

/**
 * The playback position in seconds - here, or on the device being controlled.
 * `smooth` follows every frame while playing (for a scrubber you watch);
 * otherwise it updates a few times a second.
 */
export function usePosition(smooth = false): number {
  const [position, setPosition] = useState(currentPosition);
  const playing = usePlayer((s) => s.playing);

  useEffect(() => {
    const update = () => setPosition(currentPosition());
    const unsubscribe = subscribePosition(update);
    update();

    let frame = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    if (playing && smooth && document.visibilityState === 'visible') {
      const tick = () => {
        update();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    } else if (playing) {
      // Playing elsewhere there are no progress events between updates.
      timer = setInterval(update, 500);
    }

    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
  }, [smooth, playing]);

  return position;
}

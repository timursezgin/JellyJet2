import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Keeps an overlay mounted while it animates out. Returns whether to render
 * it and a ref for its root; `enter`/`exit` start the element's animations.
 */
export function usePresence<T extends HTMLElement>(
  open: boolean,
  enter: (el: T) => Animation[],
  exit: (el: T) => Animation[],
) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  const ref = useRef<T>(null);
  const shown = useRef(false);
  const running = useRef<Animation[]>([]);
  const callbacks = useRef({ enter, exit });
  callbacks.current = { enter, exit };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !shown.current) {
      shown.current = true;
      for (const a of running.current) a.cancel();
      running.current = callbacks.current.enter(el);
    } else if (!open && shown.current) {
      shown.current = false;
      for (const a of running.current) a.cancel();
      const animations = callbacks.current.exit(el);
      running.current = animations;
      Promise.all(animations.map((a) => a.finished))
        .then(() => {
          if (!shown.current) setMounted(false);
        })
        .catch(() => {});
    }
  }, [open, mounted]);

  return { mounted, ref };
}

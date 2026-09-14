import { useEffect, type RefObject } from 'react';

/**
 * While a row is open, the next touch anywhere else (or a scroll) closes it -
 * and that first tap does nothing else, as in iOS lists.
 */
export function useCloseWhenTappedElsewhere(open: boolean, keep: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const swallowNextClick = () => {
      const stop = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      document.addEventListener('click', stop, { capture: true, once: true });
      // If the touch turns into a scroll there's no click; don't eat a later one.
      setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 600);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (keep.current?.contains(event.target as Node)) return;
      swallowNextClick();
      close();
    };
    const onScroll = () => close();
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [open, keep]); // eslint-disable-line react-hooks/exhaustive-deps
}

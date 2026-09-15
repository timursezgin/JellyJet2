import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useCloseWhenTappedElsewhere } from './use-close-when-tapped-elsewhere';
import styles from './swipe-row.module.css';

/** How much of the red row a swipe uncovers (px). */
const REVEAL = 100;
const SLOP = 8;
const EXIT_MS = 320;
const COLLAPSE_MS = 260;

interface SwipeRowProps {
  /** The word on the red row underneath ("Cancel", "Dismiss"). */
  actionLabel: string;
  /**
   * Tapping it: the row flies out left while this runs, then the rows below
   * ease up. Resolves false if it didn't work, and the row comes back.
   */
  onAction(): Promise<boolean>;
  /** After it worked and the row has fully gone: take it out of the list. */
  onGone(): void;
  /** Only one row is open at a time; the list keeps track of which. */
  open: boolean;
  onOpenChange(open: boolean): void;
  className?: string;
  children: ReactNode;
}

/**
 * A row that slides left under the finger to uncover a red action lying
 * beneath it, like iOS lists. Vertical scrolling is left alone; once the
 * finger is clearly moving sideways the row follows it.
 */
export function SwipeRow({ actionLabel, onAction, onGone, open, onOpenChange, className, children }: SwipeRowProps) {
  const row = useRef<HTMLDivElement>(null);
  const slide = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const latest = useRef({ open, onOpenChange });
  latest.current = { open, onOpenChange };

  useCloseWhenTappedElsewhere(open && !leaving, action, () => onOpenChange(false));

  useEffect(() => {
    const el = row.current;
    const content = slide.current;
    if (!el || !content) return;
    let gesture: { x: number; y: number; engaged: boolean; offset: number; samples: { x: number; t: number }[] } | null = null;

    const onStart = (event: TouchEvent) => {
      // An open row closes on any touch (see useCloseWhenTappedElsewhere).
      if (event.touches.length !== 1 || latest.current.open) {
        gesture = null;
        return;
      }
      const t = event.touches[0];
      gesture = { x: t.clientX, y: t.clientY, engaged: false, offset: 0, samples: [{ x: t.clientX, t: performance.now() }] };
    };

    const onMove = (event: TouchEvent) => {
      const g = gesture;
      if (!g) return;
      if (event.touches.length !== 1) {
        if (g.engaged) settle(false);
        gesture = null;
        return;
      }
      const t = event.touches[0];
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (!g.engaged) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        // Only a leftward, mostly sideways move opens the row.
        if (dx >= 0 || Math.abs(dy) > Math.abs(dx)) {
          gesture = null;
          return;
        }
        g.engaged = true;
        setDragging(true);
      }
      if (event.cancelable) event.preventDefault();
      // Past the red row's width it gives a little, then resists.
      const raw = Math.min(0, dx);
      g.offset = raw < -REVEAL ? -REVEAL + (raw + REVEAL) * 0.25 : raw;
      g.samples.push({ x: t.clientX, t: performance.now() });
      if (g.samples.length > 6) g.samples.shift();
      content.style.transform = `translateX(${g.offset}px)`;
    };

    const settle = (openIt: boolean) => {
      content.style.transform = '';
      setDragging(false);
      latest.current.onOpenChange(openIt);
    };

    const onEnd = (event: TouchEvent) => {
      const g = gesture;
      gesture = null;
      if (!g?.engaged) return;
      if (event.cancelable) event.preventDefault(); // no tap from the lifting finger
      const now = performance.now();
      const recent = g.samples.filter((s) => now - s.t < 100);
      const from = recent.length > 1 ? recent[0] : g.samples[0];
      const to = g.samples[g.samples.length - 1];
      const velocity = to.t > from.t ? (to.x - from.x) / (to.t - from.t) : 0;
      settle(velocity < -0.3 || (velocity < 0.3 && g.offset < -REVEAL / 2));
    };

    const onCancel = () => {
      if (gesture?.engaged) settle(false);
      gesture = null;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('touchcancel', onCancel);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, []);

  const run = async () => {
    const el = row.current;
    if (!el || leaving) return;
    setLeaving(true);
    const height = el.offsetHeight;
    const work = onAction();
    // Out to the left, then the space closes up.
    await new Promise((resolve) => window.setTimeout(resolve, EXIT_MS));
    const collapse = el.animate(
      [
        { height: `${height}px`, borderTopWidth: '1px' },
        { height: '0px', borderTopWidth: '0px' },
      ],
      { duration: COLLAPSE_MS, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' },
    );
    const ok = await work;
    await collapse.finished.catch(() => {});
    if (ok) {
      onGone();
      return;
    }
    // Didn't work: bring the row back.
    collapse.cancel();
    setLeaving(false);
    onOpenChange(false);
  };

  return (
    <div
      ref={row}
      className={`${styles.row} ${className ?? ''}`}
      data-open={open || undefined}
      data-dragging={dragging || undefined}
      data-leaving={leaving || undefined}
    >
      <button
        ref={action}
        type="button"
        className={styles.action}
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        onClick={() => void run()}
      >
        <span>{actionLabel}</span>
      </button>
      <div ref={slide} className={styles.slide}>
        {children}
        {/* A mouse can't swipe: the same action as a button shown on hover. */}
        <button type="button" className={styles.hoverAction} tabIndex={-1} onClick={() => void run()}>
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

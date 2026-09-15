import { useEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useDesktop } from './use-desktop';
import { usePresence } from './use-presence';
import styles from './sheet.module.css';

/** A point on screen (a right-click, a clicked button) a desktop menu opens beside. */
export interface Anchor {
  x: number;
  y: number;
  /** A button's top edge: a menu that opens upwards ends there, not over the button. */
  top?: number;
}

interface SheetProps {
  open: boolean;
  onClose(): void;
  title: string;
  subtitle?: string;
  /** The link on the right of the title; defaults to "Done". */
  closeLabel?: string;
  /** Replaces the title and subtitle (e.g. a song's cover and name). */
  header?: ReactNode;
  /** Desktop: open as a menu at this point instead of a centred window. */
  anchor?: Anchor | null;
  children: ReactNode;
}

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const MENU_WIDTH = 340;

/**
 * The design's bottom sheet: dimmed backdrop, rounded panel sliding up, grab
 * handle. Drag the top of the panel down (or tap the backdrop) to close.
 * On a computer it's a centred window, or a menu beside the mouse when
 * anchored; Escape or a click outside closes it.
 */
export function Sheet({ open, onClose, title, subtitle, closeLabel = 'Done', header, anchor, children }: SheetProps) {
  const desktop = useDesktop();
  const { mounted, ref } = usePresence<HTMLDivElement>(
    open,
    (root) => {
      const scrim = root.querySelector(`.${styles.scrim}`)!;
      const panel = root.querySelector(`.${styles.panel}`)!;
      if (desktop) {
        return [
          scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease' }),
          panel.animate([{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'scale(1)' }], {
            duration: 160,
            easing: EASE,
          }),
        ];
      }
      return [
        scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease' }),
        panel.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 300, easing: EASE }),
      ];
    },
    (root) => {
      const scrim = root.querySelector(`.${styles.scrim}`)!;
      const panel = root.querySelector<HTMLElement>(`.${styles.panel}`)!;
      if (desktop) {
        return [
          scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease', fill: 'forwards' }),
          panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease', fill: 'forwards' }),
        ];
      }
      const from = panel.style.transform || 'translateY(0)';
      panel.style.transform = '';
      return [
        scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease', fill: 'forwards' }),
        panel.animate([{ transform: from }, { transform: 'translateY(100%)' }], { duration: 260, easing: EASE, fill: 'forwards' }),
      ];
    },
  );

  // Escape closes the topmost sheet only (it's heard before anything else).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [open]);

  const drag = useRef<{ y: number; t: number; id: number; lastY: number; lastT: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (desktop) return;
    drag.current = { y: e.clientY, t: e.timeStamp, id: e.pointerId, lastY: e.clientY, lastT: e.timeStamp };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const panel = e.currentTarget.parentElement!;
    panel.style.transform = `translateY(${Math.max(0, e.clientY - d.y)}px)`;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    const panel = e.currentTarget.parentElement!;
    const dy = e.clientY - d.y;
    const velocity = (e.clientY - d.lastY) / Math.max(1, e.timeStamp - d.lastT);
    if (dy > 110 || (dy > 20 && velocity > 0.5)) {
      onClose();
    } else if (dy > 0) {
      panel.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 220, easing: EASE });
      panel.style.transform = '';
    } else {
      panel.style.transform = '';
    }
  };

  if (!mounted) return null;

  const anchored = desktop && anchor ? anchor : null;

  return createPortal(
    <div
      ref={ref}
      className={styles.root}
      data-closing={!open || undefined}
      data-desktop={desktop || undefined}
      data-anchored={anchored ? true : undefined}
    >
      <div
        className={styles.scrim}
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className={styles.panel} role="dialog" aria-label={title} style={anchored ? menuPosition(anchored) : undefined}>
        <div
          className={styles.header}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className={styles.grabber} />
          <div className={styles.titleRow}>
            <div className={styles.titles}>
              {header ?? (
                <>
                  <h2 className="t-sheet-title">{title}</h2>
                  {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
                </>
              )}
            </div>
            <button
              type="button"
              className={styles.close}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onClose}
            >
              {closeLabel}
            </button>
          </div>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Beside the point, flipped left or up when it would run off the window. */
function menuPosition({ x, y, top = y }: Anchor): CSSProperties {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const style: CSSProperties = {};
  if (x + MENU_WIDTH + 8 > width) style.right = Math.max(8, width - x);
  else style.left = x;
  if (y > height * 0.55) {
    style.bottom = height - top;
    style.maxHeight = top - 12;
  } else {
    style.top = y;
    style.maxHeight = height - y - 12;
  }
  return style;
}

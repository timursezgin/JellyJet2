import { useRef, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { usePresence } from './use-presence';
import styles from './sheet.module.css';

interface SheetProps {
  open: boolean;
  onClose(): void;
  title: string;
  subtitle?: string;
  /** The link on the right of the title; defaults to "Done". */
  closeLabel?: string;
  /** Replaces the title and subtitle (e.g. a song's cover and name). */
  header?: ReactNode;
  children: ReactNode;
}

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/**
 * The design's bottom sheet: dimmed backdrop, rounded panel sliding up, grab
 * handle. Drag the top of the panel down (or tap the backdrop) to close.
 */
export function Sheet({ open, onClose, title, subtitle, closeLabel = 'Done', header, children }: SheetProps) {
  const { mounted, ref } = usePresence<HTMLDivElement>(
    open,
    (root) => [
      root.querySelector(`.${styles.scrim}`)!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease' }),
      root
        .querySelector(`.${styles.panel}`)!
        .animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 300, easing: EASE }),
    ],
    (root) => {
      const panel = root.querySelector<HTMLElement>(`.${styles.panel}`)!;
      const from = panel.style.transform || 'translateY(0)';
      panel.style.transform = '';
      return [
        root.querySelector(`.${styles.scrim}`)!.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease', fill: 'forwards' }),
        panel.animate([{ transform: from }, { transform: 'translateY(100%)' }], { duration: 260, easing: EASE, fill: 'forwards' }),
      ];
    },
  );

  const drag = useRef<{ y: number; t: number; id: number; lastY: number; lastT: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
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

  return createPortal(
    <div ref={ref} className={styles.root} data-closing={!open || undefined}>
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.panel} role="dialog" aria-label={title}>
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

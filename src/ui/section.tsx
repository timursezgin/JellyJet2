import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import styles from './section.module.css';

interface SectionHeaderProps {
  title: string;
  /** Makes the whole header a button (e.g. "see all"). */
  onOpen?(): void;
  trailing?: ReactNode;
}

export function SectionHeader({ title, onOpen, trailing }: SectionHeaderProps) {
  const heading = (
    <>
      <h2 className="t-section-header">{title}</h2>
      {onOpen && <ChevronRight className={styles.chevron} size={20} strokeWidth={2.4} />}
    </>
  );
  return (
    <div className={styles.header}>
      {onOpen ? (
        <button type="button" className={styles.open} onClick={onOpen}>
          {heading}
        </button>
      ) : (
        <div className={styles.open}>{heading}</div>
      )}
      {trailing}
    </div>
  );
}

const pointerIsMouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * A row of cards that scrolls sideways. With a mouse, arrows at either end
 * (shown on hover) page through it, since a mouse can't swipe.
 */
export function Shelf({ children }: { children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ start: true, end: true, middle: 0 });

  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    const start = el.scrollLeft < 4;
    const end = el.scrollLeft + el.clientWidth > el.scrollWidth - 4;
    // The arrows sit level with the middle of the covers, not the captions under them.
    const card = el.firstElementChild as HTMLElement | null;
    const cover = (card?.firstElementChild as HTMLElement | null) ?? card;
    const box = cover?.getBoundingClientRect();
    const middle = box ? Math.round(box.top + box.height / 2 - el.getBoundingClientRect().top) : 0;
    setEnds((e) => (e.start === start && e.end === end && e.middle === middle ? e : { start, end, middle }));
  };

  // Only with a mouse; phones swipe and never pay for the measuring.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !pointerIsMouse) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Cards can arrive after the shelf is drawn.
  useEffect(() => {
    if (pointerIsMouse) measure();
  });

  const page = (direction: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <div className={styles.shelfFrame}>
      <div ref={scroller} className={styles.shelf} onScroll={pointerIsMouse ? measure : undefined}>
        {children}
      </div>
      {!ends.start && (
        <button
          type="button"
          className={styles.arrow}
          data-side="start"
          style={{ top: ends.middle }}
          onClick={() => page(-1)}
          aria-label="Scroll back"
        >
          <ChevronLeft size={20} strokeWidth={2.4} />
        </button>
      )}
      {!ends.end && (
        <button
          type="button"
          className={styles.arrow}
          data-side="end"
          style={{ top: ends.middle }}
          onClick={() => page(1)}
          aria-label="Scroll on"
        >
          <ChevronRight size={20} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

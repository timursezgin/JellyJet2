import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { EagerArtwork } from './artwork';
import { usePageScroller } from './page';

interface Range {
  start: number;
  end: number;
}

/**
 * Tracks which rows of a list inside the page's scroller are near the screen,
 * so thousands of songs cost no more than the handful being looked at.
 */
function useVisibleRows(
  container: RefObject<HTMLDivElement | null>,
  rowCount: number,
  rowHeight: number,
  overscan: number,
  onNearEnd?: () => void,
) {
  const scroller = usePageScroller();
  const [range, setRange] = useState<Range>({ start: 0, end: Math.min(rowCount, 20) });
  const nearEnd = useRef(onNearEnd);
  nearEnd.current = onNearEnd;

  useLayoutEffect(() => {
    const el = container.current;
    if (!scroller || !el || rowHeight <= 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const viewTop = -offset;
      const start = Math.max(0, Math.floor(viewTop / rowHeight) - overscan);
      const end = Math.min(rowCount, Math.ceil((viewTop + scroller.clientHeight) / rowHeight) + overscan);
      setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
      if (end >= rowCount - overscan) nearEnd.current?.();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [scroller, container, rowCount, rowHeight, overscan]);

  return range;
}

interface VirtualListProps {
  count: number;
  rowHeight: number;
  renderRow(index: number): ReactNode;
  /**
   * A stable identity for the row at an index. Without it rows are matched by
   * position, so when one is removed the next item takes over its element
   * (and any animation it was in the middle of).
   */
  rowKey?(index: number): string;
  /** When a row is removed, the rows below ease up into place (needs `rowKey`). */
  animateMoves?: boolean;
  /** Called when the last rows come into view (load the next page). */
  onNearEnd?(): void;
}

export function VirtualList({ count, rowHeight, renderRow, rowKey, animateMoves = false, onNearEnd }: VirtualListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { start, end } = useVisibleRows(ref, count, rowHeight, 10, onNearEnd);
  const rowElements = useRef(new Map<string, HTMLDivElement>());
  const lastTops = useRef(new Map<string, number>());

  // After drawing, rows that moved up by a row or two slide from where they
  // were to where they are now.
  useLayoutEffect(() => {
    if (!animateMoves || !rowKey) return;
    const tops = lastTops.current;
    const next = new Map<string, number>();
    for (const [key, element] of rowElements.current) {
      const top = parseFloat(element.style.top);
      next.set(key, top);
      const previous = tops.get(key);
      if (previous !== undefined && previous !== top && Math.abs(previous - top) <= rowHeight * 2) {
        element.animate([{ transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' }], {
          duration: 300,
          easing: 'cubic-bezier(0.25, 0.8, 0.25, 1)',
        });
      }
    }
    lastTops.current = next;
  });
  const rows: ReactNode[] = [];
  // The visible range is worked out after drawing, so when the list has just
  // shrunk (a search narrowing it) it can still point past the end.
  const last = Math.min(end, count);
  for (let i = start; i < last; i++) {
    rows.push(
      <div
        key={rowKey ? rowKey(i) : i}
        ref={
          animateMoves && rowKey
            ? (node) => {
                const key = rowKey(i);
                if (node) rowElements.current.set(key, node);
                else rowElements.current.delete(key);
              }
            : undefined
        }
        style={{ position: 'absolute', top: i * rowHeight, left: 0, right: 0, height: rowHeight }}
      >
        {renderRow(i)}
      </div>,
    );
  }
  return (
    <div ref={ref} style={{ position: 'relative', height: count * rowHeight }}>
      <EagerArtwork.Provider value={true}>{rows}</EagerArtwork.Provider>
    </div>
  );
}

interface VirtualGridProps {
  count: number;
  columns: number;
  /** Space between cells, horizontally and vertically (px). */
  gap: { row: number; column: number };
  /** Height of a cell given its width (a square cover plus its caption). */
  cellHeight(width: number): number;
  renderCell(index: number, width: number): ReactNode;
  onNearEnd?(): void;
}

export function VirtualGrid({ count, columns, gap, cellHeight, renderCell, onNearEnd }: VirtualGridProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cellWidth = width > 0 ? (width - gap.column * (columns - 1)) / columns : 0;
  const rowHeight = cellWidth > 0 ? cellHeight(cellWidth) + gap.row : 0;
  const rowCount = Math.ceil(count / columns);
  const { start, end } = useVisibleRows(ref, rowCount, rowHeight, 4, onNearEnd);

  const cells: ReactNode[] = [];
  if (cellWidth > 0) {
    for (let row = start; row < Math.min(end, rowCount); row++) {
      for (let col = 0; col < columns; col++) {
        const index = row * columns + col;
        if (index >= count) break;
        cells.push(
          <div
            key={index}
            style={{
              position: 'absolute',
              top: row * rowHeight,
              left: col * (cellWidth + gap.column),
              width: cellWidth,
            }}
          >
            {renderCell(index, cellWidth)}
          </div>,
        );
      }
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', height: rowCount * rowHeight }}>
      <EagerArtwork.Provider value={true}>{cells}</EagerArtwork.Provider>
    </div>
  );
}

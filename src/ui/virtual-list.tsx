import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

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
  /** Called when the last rows come into view (load the next page). */
  onNearEnd?(): void;
}

export function VirtualList({ count, rowHeight, renderRow, rowKey, onNearEnd }: VirtualListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { start, end } = useVisibleRows(ref, count, rowHeight, 10, onNearEnd);
  const rows: ReactNode[] = [];
  // The visible range is worked out after drawing, so when the list has just
  // shrunk (a search narrowing it) it can still point past the end.
  const last = Math.min(end, count);
  for (let i = start; i < last; i++) {
    rows.push(
      <div key={rowKey ? rowKey(i) : i} style={{ position: 'absolute', top: i * rowHeight, left: 0, right: 0, height: rowHeight }}>
        {renderRow(i)}
      </div>,
    );
  }
  return (
    <div ref={ref} style={{ position: 'relative', height: count * rowHeight }}>
      {rows}
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
      {cells}
    </div>
  );
}

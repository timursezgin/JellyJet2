import { GripVertical, X } from 'lucide-react';
import { useRef, useState, type ButtonHTMLAttributes, type PointerEvent } from 'react';

import { LikeButton } from '@/songs/song-buttons';
import { songContextMenu } from '@/songs/song-menu';
import { Artwork } from '@/ui/artwork';
import { Sheet } from '@/ui/sheet';
import { jumpTo, moveInQueue, removeFromQueue, setQueueOpen, usePlayer, type QueueItem } from './player';
import { artistLine } from './track';
import styles from './queue-sheet.module.css';

const ROW_HEIGHT = 60;

/** The queue: tap a song to play it, drag the grip to reorder, × to remove. */
export function QueueSheet() {
  const open = usePlayer((s) => s.queueOpen);
  return (
    <Sheet open={open} onClose={() => setQueueOpen(false)} title="Queue">
      <QueueList />
    </Sheet>
  );
}

/** Now playing and up next; in the phone's sheet or the desktop side panel. */
export function QueueList() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const remote = usePlayer((s) => s.remote);
  const current = queue[index];
  const upcoming = queue.slice(index + 1);

  return (
    <>
      {current && (
        <>
          <p className={`t-eyebrow ${styles.heading}`}>{remote ? `Now playing on ${remote.deviceName}` : 'Now playing'}</p>
          <QueueRow item={current} current />
        </>
      )}
      {upcoming.length > 0 &&
        (remote ? (
          // Another device's queue: tap a song to play it there; it's edited on that device.
          <>
            <p className={`t-eyebrow ${styles.heading}`}>Up next · {upcoming.length}</p>
            {upcoming.map((item, i) => (
              <QueueRow key={item.uid} item={item} onPlay={() => jumpTo(index + 1 + i)} />
            ))}
          </>
        ) : (
          <>
            <p className={`t-eyebrow ${styles.heading}`}>Up next · {upcoming.length}</p>
            <ReorderList items={upcoming} offset={index + 1} />
          </>
        ))}
    </>
  );
}

function ReorderList({ items, offset }: { items: QueueItem[]; offset: number }) {
  const [drag, setDrag] = useState<{ from: number; dy: number } | null>(null);
  const start = useRef<{ y: number; id: number } | null>(null);

  const target = drag ? clamp(drag.from + Math.round(drag.dy / ROW_HEIGHT), 0, items.length - 1) : -1;

  const onGripDown = (from: number) => (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { y: e.clientY, id: e.pointerId };
    setDrag({ from, dy: 0 });
  };
  const onGripMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    setDrag((d) => (d ? { ...d, dy: e.clientY - start.current!.y } : d));
  };
  const onGripUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (!start.current || start.current.id !== e.pointerId || !drag) return;
    start.current = null;
    if (target !== drag.from) moveInQueue(offset + drag.from, offset + target);
    setDrag(null);
  };

  return (
    <div className={styles.list}>
      {items.map((item, i) => {
        let shift = 0;
        if (drag) {
          if (i === drag.from) shift = drag.dy;
          else if (drag.from < target && i > drag.from && i <= target) shift = -ROW_HEIGHT;
          else if (drag.from > target && i < drag.from && i >= target) shift = ROW_HEIGHT;
        }
        return (
          <div
            key={item.uid}
            className={styles.slot}
            data-dragging={drag?.from === i || undefined}
            data-settling={(drag && drag.from !== i) || undefined}
            style={{ transform: shift ? `translateY(${shift}px)` : undefined }}
          >
            <QueueRow
              item={item}
              onPlay={() => jumpTo(offset + i)}
              onRemove={() => removeFromQueue(offset + i)}
              grip={{ onPointerDown: onGripDown(i), onPointerMove: onGripMove, onPointerUp: onGripUp, onPointerCancel: onGripUp }}
            />
          </div>
        );
      })}
    </div>
  );
}

interface QueueRowProps {
  item: QueueItem;
  current?: boolean;
  onPlay?(): void;
  onRemove?(): void;
  grip?: Pick<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
  >;
}

function QueueRow({ item, current = false, onPlay, onRemove, grip }: QueueRowProps) {
  return (
    <div className={styles.row} data-current={current || undefined} onContextMenu={songContextMenu(item)}>
      <button type="button" className={styles.main} onClick={onPlay} disabled={!onPlay}>
        <Artwork art={item.art} size={44} radius={8} />
        <span className={styles.text}>
          <span className={styles.title}>{item.name}</span>
          <span className={styles.artist}>{artistLine(item)}</span>
        </span>
      </button>
      <LikeButton track={item} />
      {onRemove && (
        <button type="button" className={styles.icon} onClick={onRemove} aria-label={`Remove ${item.name} from the queue`}>
          <X size={18} strokeWidth={2} />
        </button>
      )}
      {grip && (
        <button type="button" className={`${styles.icon} ${styles.grip}`} aria-label="Drag to reorder" {...grip}>
          <GripVertical size={18} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

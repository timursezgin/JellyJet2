import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';

import { PageContext, type PageInfo } from './page-context';
import { routeTitle, useNavigation, type Route, type StackEntry } from './navigation';
import styles from './stack-view.module.css';

// iOS page motion: the new page slides in from the right while the one below
// drifts a third of the way left under a light shade.
const DURATION = 420;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const UNDER_SHIFT = -0.3;
const SHADE = 0.18;
/** How far in from the left edge a swipe-back may start (px). */
const EDGE = 28;

interface Props {
  entries: StackEntry[];
  /** Whether this tab is the visible one. */
  visible: boolean;
  renderRoute(route: Route): ReactNode;
}

export function StackView({ entries, visible, renderRoute }: Props) {
  const pop = useNavigation((s) => s.pop);
  const instant = useNavigation((s) => s.instant);

  // A popped page stays on screen until its slide-out finishes.
  const [exiting, setExiting] = useState<StackEntry | null>(null);
  const previous = useRef(entries);
  const pageRefs = useRef(new Map<string, HTMLDivElement>());
  const container = useRef<HTMLDivElement>(null);
  const animating = useRef<Animation[]>([]);

  const rendered = exiting ? [...entries, exiting] : entries;

  // Work out push/pop during render so the exiting page never blinks out.
  const prevEntries = previous.current;
  if (prevEntries !== entries) {
    const prevTop = prevEntries[prevEntries.length - 1];
    const stillThere = entries.some((e) => e.key === prevTop.key);
    if (!stillThere && !instant && visible && exiting?.key !== prevTop.key) {
      setExiting(prevTop);
    }
  }

  useLayoutEffect(() => {
    const prevEntries = previous.current;
    previous.current = entries;
    if (prevEntries === entries || !visible || instant) return;

    const top = entries[entries.length - 1];
    const prevTop = prevEntries[prevEntries.length - 1];
    const width = container.current?.clientWidth ?? window.innerWidth;
    finishRunning();

    if (!prevEntries.some((e) => e.key === top.key)) {
      // Push: the new page slides in over the old top.
      slide(top.key, width, 0);
      slide(prevTop.key, 0, UNDER_SHIFT * width, 0, SHADE);
    } else if (!entries.some((e) => e.key === prevTop.key)) {
      // Pop: the old top slides out, uncovering the page below.
      slide(prevTop.key, 0, width, 0, 0, () => setExiting(null));
      slide(top.key, UNDER_SHIFT * width, 0, SHADE, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  function finishRunning() {
    for (const animation of animating.current) animation.finish();
    animating.current = [];
  }

  function slide(key: string, from: number, to: number, shadeFrom = 0, shadeTo = 0, done?: () => void) {
    const page = pageRefs.current.get(key);
    if (!page) {
      done?.();
      return;
    }
    const options: KeyframeAnimationOptions = { duration: DURATION, easing: EASE };
    const move = page.animate(
      [{ transform: `translate3d(${from}px,0,0)` }, { transform: `translate3d(${to}px,0,0)` }],
      options,
    );
    animating.current.push(move);
    const shade = page.querySelector<HTMLElement>(`.${styles.shade}`);
    if (shade && (shadeFrom || shadeTo)) {
      animating.current.push(shade.animate([{ opacity: shadeFrom }, { opacity: shadeTo }], options));
    }
    move.onfinish = () => done?.();
  }

  // --- Swipe back from the left edge -------------------------------------
  const gesture = useRef<{
    id: number;
    startX: number;
    startY: number;
    engaged: boolean;
    samples: { x: number; t: number }[];
  } | null>(null);

  function topPages() {
    const top = entries[entries.length - 1];
    const under = entries[entries.length - 2];
    return {
      top: pageRefs.current.get(top.key),
      under: under ? pageRefs.current.get(under.key) : undefined,
    };
  }

  function setDrag(dx: number, width: number) {
    const { top, under } = topPages();
    if (top) top.style.transform = `translate3d(${dx}px,0,0)`;
    if (under) {
      under.style.transform = `translate3d(${UNDER_SHIFT * (width - dx)}px,0,0)`;
      const shade = under.querySelector<HTMLElement>(`.${styles.shade}`);
      if (shade) shade.style.opacity = String(SHADE * (1 - dx / width));
    }
  }

  function clearDrag() {
    const { top, under } = topPages();
    for (const page of [top, under]) {
      if (!page) continue;
      page.style.transform = '';
      const shade = page.querySelector<HTMLElement>(`.${styles.shade}`);
      if (shade) shade.style.opacity = '';
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (entries.length < 2 || exiting || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX - rect.left > EDGE) return;
    gesture.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      engaged: false,
      samples: [{ x: event.clientX, t: event.timeStamp }],
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    if (!g.engaged) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        gesture.current = null; // it's a scroll
        return;
      }
      if (dx < 8) return;
      g.engaged = true;
      finishRunning();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    g.samples.push({ x: event.clientX, t: event.timeStamp });
    if (g.samples.length > 5) g.samples.shift();
    setDrag(Math.max(0, dx), event.currentTarget.clientWidth);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.id !== event.pointerId || !g.engaged) return;
    const width = event.currentTarget.clientWidth;
    const dx = Math.max(0, event.clientX - g.startX);
    const first = g.samples[0];
    const last = g.samples[g.samples.length - 1];
    const velocity = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    const complete = event.type === 'pointerup' && (dx > width * 0.4 || velocity > 0.45);

    const { top, under } = topPages();
    const remaining = complete ? (width - dx) / width : dx / width;
    const duration = Math.max(160, DURATION * remaining);
    const options: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };

    const topTo = complete ? width : 0;
    const underFrom = UNDER_SHIFT * (width - dx);
    const underTo = complete ? 0 : UNDER_SHIFT * width;
    const shadeFrom = SHADE * (1 - dx / width);

    clearDrag();
    if (top) {
      const move = top.animate(
        [{ transform: `translate3d(${dx}px,0,0)` }, { transform: `translate3d(${topTo}px,0,0)` }],
        { ...options, fill: complete ? 'forwards' : 'none' },
      );
      move.onfinish = () => {
        if (complete) {
          pop({ instant: true });
          // The page is gone next render; drop the held frame then.
          requestAnimationFrame(() => move.cancel());
        }
      };
    }
    if (under) {
      under.animate(
        [{ transform: `translate3d(${underFrom}px,0,0)` }, { transform: `translate3d(${underTo}px,0,0)` }],
        options,
      );
      const shade = under.querySelector<HTMLElement>(`.${styles.shade}`);
      shade?.animate([{ opacity: shadeFrom }, { opacity: complete ? 0 : SHADE }], options);
    }
  }

  const backInfo = useMemo(
    () =>
      entries.map((_, index): PageInfo => {
        const below = entries[index - 1];
        const label = below ? (index === 1 ? routeTitle(below.route) : 'Back') : null;
        return { backLabel: label, goBack: () => pop(), active: false };
      }),
    [entries, pop],
  );

  return (
    <div
      ref={container}
      className={styles.stack}
      data-visible={visible || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {rendered.map((item, index) => {
        const isExiting = item === exiting;
        const depthFromTop = entries.length - 1 - index;
        // Only the top page and the one below it need painting.
        const hidden = !isExiting && depthFromTop > (exiting ? 0 : 1);
        const info = isExiting
          ? { backLabel: null, goBack: () => {}, active: false }
          : { ...backInfo[index], active: visible && depthFromTop === 0 && !exiting };
        return (
          <div
            key={item.key}
            ref={(node) => {
              if (node) pageRefs.current.set(item.key, node);
              else pageRefs.current.delete(item.key);
            }}
            className={styles.page}
            data-hidden={hidden || undefined}
            data-covered={(!isExiting && depthFromTop > 0) || undefined}
            aria-hidden={!info.active || undefined}
            inert={!info.active || undefined}
          >
            <PageContext.Provider value={info}>{renderRoute(item.route)}</PageContext.Provider>
            <div className={styles.shade} />
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

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
    // A page sliding out (`done` given) holds its final position until it's
    // removed; otherwise it would jump back to where it started for a frame.
    const options: KeyframeAnimationOptions = { duration: DURATION, easing: EASE, fill: done ? 'forwards' : 'none' };
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
  //
  // Built on touch events (not pointer events) because only a touchmove can
  // stop the page from scrolling: once the finger is clearly moving sideways
  // the gesture is locked - the page follows the finger, vertical scrolling is
  // frozen and nothing underneath can be tapped - until the finger lifts.

  // The listeners are attached once, so they read the latest state from refs.
  const latest = useRef({ entries, exiting, pop });
  latest.current = { entries, exiting, pop };

  function topPages() {
    const list = latest.current.entries;
    const top = list[list.length - 1];
    const under = list[list.length - 2];
    return {
      top: top ? pageRefs.current.get(top.key) : undefined,
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

  /** Finish a swipe: slide the rest of the way back, or settle where it was. */
  function release(dx: number, velocity: number, cancelled: boolean) {
    const el = container.current;
    if (!el) return;
    const width = el.clientWidth;
    // Where the page would coast to, so a quick flick counts as much as a drag.
    const projected = dx + velocity * 200;
    const complete = !cancelled && velocity > -0.15 && (projected > width * 0.5 || velocity > 0.5);

    const { top, under } = topPages();
    const distance = complete ? width - dx : dx;
    const speed = Math.max(Math.abs(velocity), 1.2); // px per ms
    const duration = Math.min(DURATION, Math.max(140, distance / speed));
    const options: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(0.25, 0.9, 0.3, 1)' };

    const topTo = complete ? width : 0;
    const underFrom = UNDER_SHIFT * (width - dx);
    const underTo = complete ? 0 : UNDER_SHIFT * width;
    const shadeFrom = SHADE * (1 - dx / width);

    clearDrag();
    const finished: Promise<unknown>[] = [];
    if (top) {
      const move = top.animate(
        [{ transform: `translate3d(${dx}px,0,0)` }, { transform: `translate3d(${topTo}px,0,0)` }],
        { ...options, fill: 'forwards' },
      );
      animating.current.push(move);
      finished.push(move.finished);
      move.onfinish = () => {
        if (complete) {
          latest.current.pop({ instant: true });
          // The page is gone next render; drop the held frame then.
          requestAnimationFrame(() => move.cancel());
        } else {
          move.cancel();
        }
      };
    }
    if (under) {
      const move = under.animate(
        [{ transform: `translate3d(${underFrom}px,0,0)` }, { transform: `translate3d(${underTo}px,0,0)` }],
        options,
      );
      animating.current.push(move);
      const shade = under.querySelector<HTMLElement>(`.${styles.shade}`);
      if (shade) animating.current.push(shade.animate([{ opacity: shadeFrom }, { opacity: complete ? 0 : SHADE }], options));
    }
    // Taps come back once the page has settled.
    void Promise.allSettled(finished).then(() => delete el.dataset.dragging);
  }

  useEffect(() => {
    const el = container.current;
    if (!el) return;

    let gesture: {
      startX: number;
      startY: number;
      dx: number;
      engaged: boolean;
      samples: { x: number; t: number }[];
    } | null = null;

    const onStart = (event: TouchEvent) => {
      gesture = null;
      const { entries, exiting } = latest.current;
      if (event.touches.length !== 1 || entries.length < 2 || exiting) return;
      const touch = event.touches[0];
      if (touch.clientX - el.getBoundingClientRect().left > EDGE) return;
      gesture = {
        startX: touch.clientX,
        startY: touch.clientY,
        dx: 0,
        engaged: false,
        samples: [{ x: touch.clientX, t: performance.now() }],
      };
    };

    const onMove = (event: TouchEvent) => {
      const g = gesture;
      if (!g) return;
      if (event.touches.length !== 1) {
        if (g.engaged) finish(true);
        else gesture = null;
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - g.startX;
      const dy = touch.clientY - g.startY;

      if (!g.engaged) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (dx <= 0 || Math.abs(dy) > dx) {
          gesture = null; // a scroll (or a swipe the other way) - leave it be
          return;
        }
        g.engaged = true;
        for (const animation of animating.current) animation.finish();
        animating.current = [];
        el.dataset.dragging = 'true';
      }

      // Locked sideways: the page must not scroll or react to the finger.
      event.preventDefault();
      g.dx = Math.max(0, dx);
      g.samples.push({ x: touch.clientX, t: performance.now() });
      if (g.samples.length > 6) g.samples.shift();
      setDrag(g.dx, el.clientWidth);
    };

    const finish = (cancelled: boolean) => {
      const g = gesture;
      gesture = null;
      if (!g?.engaged) return;
      // Speed over roughly the last tenth of a second.
      const now = performance.now();
      const recent = g.samples.filter((s) => now - s.t < 100);
      const from = recent.length > 1 ? recent[0] : g.samples[Math.max(0, g.samples.length - 2)];
      const to = g.samples[g.samples.length - 1];
      const velocity = to.t > from.t ? (to.x - from.x) / (to.t - from.t) : 0;
      release(g.dx, velocity, cancelled);
    };

    const onEnd = (event: TouchEvent) => {
      if (gesture?.engaged) event.preventDefault();
      finish(false);
    };
    const onCancel = () => finish(true);

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
    // Attached once; everything changing is read through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const backInfo = useMemo(
    () =>
      entries.map((_, index): PageInfo => {
        const below = entries[index - 1];
        const label = below ? routeTitle(below.route) : null;
        return { backLabel: label, goBack: () => pop(), active: false };
      }),
    [entries, pop],
  );

  return (
    <div
      ref={container}
      className={styles.stack}
      data-visible={visible || undefined}
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

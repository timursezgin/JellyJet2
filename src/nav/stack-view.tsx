import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

import { PageContext, type PageInfo } from './page-context';
import { routeTitle, useNavigation, type Route, type StackEntry, type TabId } from './navigation';
import styles from './stack-view.module.css';

// iOS page motion: the new page slides in from the right while the one below
// drifts a third of the way left under a light shade.
const DURATION = 420;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const UNDER_SHIFT = -0.3;
const SHADE = 0.18;
/** How far in from the left edge a swipe-back may start (px). */
const EDGE = 28;
/** How far the finger moves before the swipe decides what it is (px). */
const SLOP = 8;

interface Props {
  tab: TabId;
  entries: StackEntry[];
  /** Whether this tab is the visible one. */
  visible: boolean;
  renderRoute(route: Route): ReactNode;
}

/** A swipe-back in progress, from the finger landing to it lifting. */
interface Drag {
  id: number;
  startX: number;
  startY: number;
  dx: number;
  engaged: boolean;
  samples: { x: number; t: number }[];
  /** The pages it moves, fixed when the finger lands. */
  topKey: string;
  top: HTMLDivElement;
  under: HTMLDivElement | undefined;
  detach(): void;
}

const shadeOf = (page: HTMLElement | undefined) => page?.querySelector<HTMLElement>(`.${styles.shade}`) ?? undefined;

export function StackView({ tab, entries, visible, renderRoute }: Props) {
  const pop = useNavigation((s) => s.pop);
  const instant = useNavigation((s) => s.instant);

  // A popped page stays on screen until its slide-out finishes.
  const [exiting, setExiting] = useState<StackEntry | null>(null);
  const previous = useRef(entries);
  const pageRefs = useRef(new Map<string, HTMLDivElement>());
  const container = useRef<HTMLDivElement>(null);
  const animating = useRef<Animation[]>([]);
  const drag = useRef<Drag | null>(null);
  /** Ends a released swipe's slide at once (set only while it's sliding). */
  const settleRef = useRef<((sync: boolean) => void) | null>(null);

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
    if (prevEntries === entries) return;
    // The stack changed some other way: nothing may be left mid-swipe.
    settleRef.current?.(false);
    abandonDrag();
    if (!visible || instant) return;

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
      slide(prevTop.key, 0, width, 0, 0, () =>
        setExiting((current) => (current?.key === prevTop.key ? null : current)),
      );
      slide(top.key, UNDER_SHIFT * width, 0, SHADE, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  useEffect(() => {
    if (visible) return;
    settleRef.current?.(false);
    abandonDrag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function finishRunning() {
    const running = animating.current;
    animating.current = [];
    for (const animation of running) animation.finish();
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
    const shade = shadeOf(page);
    const moves = [move];
    if (shade && (shadeFrom || shadeTo)) moves.push(shade.animate([{ opacity: shadeFrom }, { opacity: shadeTo }], options));
    animating.current.push(...moves);
    // An animation can report finishing more than once (finishing it again
    // later does); its follow-up must only ever happen the first time.
    let finished = false;
    move.onfinish = () => {
      if (finished) return;
      finished = true;
      animating.current = animating.current.filter((a) => !moves.includes(a));
      done?.();
    };
  }

  // --- Swipe back from the left edge -------------------------------------
  //
  // Built on touch events (not pointer events) because only a touchmove can
  // stop the page from scrolling: once the finger is clearly moving sideways
  // the gesture is locked - the page follows the finger, vertical scrolling is
  // frozen and nothing underneath can be tapped - until the finger lifts.

  // The start listener is attached once, so it reads the latest state here.
  const latest = useRef({ entries, exiting, tab });
  latest.current = { entries, exiting, tab };

  function setDrag(g: Drag, width: number) {
    g.top.style.transform = `translate3d(${g.dx}px,0,0)`;
    if (g.under) {
      g.under.style.transform = `translate3d(${UNDER_SHIFT * (width - g.dx)}px,0,0)`;
      const shade = shadeOf(g.under);
      if (shade) shade.style.opacity = String(SHADE * (1 - g.dx / width));
    }
  }

  /** Drop a swipe without finishing it: the pages go straight back. */
  function abandonDrag() {
    const g = drag.current;
    if (!g) return;
    drag.current = null;
    g.detach();
    for (const page of [g.top, g.under]) {
      if (!page) continue;
      page.style.transform = '';
      const shade = shadeOf(page);
      if (shade) shade.style.opacity = '';
    }
    if (container.current) delete container.current.dataset.dragging;
  }

  /** Finish a swipe: slide the rest of the way back, or settle where it was. */
  function release(g: Drag, velocity: number, cancelled: boolean) {
    drag.current = null;
    g.detach();
    const el = container.current;
    if (!el) return;
    const width = el.clientWidth;
    // Where the page would coast to, so a quick flick counts as much as a drag.
    const projected = g.dx + velocity * 200;
    const complete =
      !cancelled && velocity > -0.15 && (projected > width * 0.5 || (velocity > 0.5 && g.dx > 20));

    const distance = complete ? width - g.dx : g.dx;
    const speed = Math.max(Math.abs(velocity), 1.2); // px per ms
    const duration = Math.min(DURATION, Math.max(140, distance / speed));
    const options: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(0.25, 0.9, 0.3, 1)' };

    // The pages' resting places go on their styles first; the animations run
    // from where the finger left them to there, and nothing is held after.
    const shade = shadeOf(g.under);
    g.top.style.transform = complete ? `translate3d(${width}px,0,0)` : '';
    const moves = [
      g.top.animate(
        [{ transform: `translate3d(${g.dx}px,0,0)` }, { transform: `translate3d(${complete ? width : 0}px,0,0)` }],
        options,
      ),
    ];
    if (g.under) {
      g.under.style.transform = '';
      moves.push(
        g.under.animate(
          [
            { transform: `translate3d(${UNDER_SHIFT * (width - g.dx)}px,0,0)` },
            { transform: `translate3d(${complete ? 0 : UNDER_SHIFT * width}px,0,0)` },
          ],
          options,
        ),
      );
    }
    if (shade) {
      shade.style.opacity = '';
      moves.push(shade.animate([{ opacity: SHADE * (1 - g.dx / width) }, { opacity: complete ? 0 : SHADE }], options));
    }

    // Runs exactly once: when the slide ends, or earlier if something needs
    // the pages settled right now (a new touch, a tab switch, a stack change).
    let settled = false;
    const settle = (sync: boolean) => {
      if (settled) return;
      settled = true;
      if (settleRef.current === settle) settleRef.current = null;
      for (const move of moves) move.cancel();
      if (complete) {
        const { tab } = latest.current;
        const goBack = () => useNavigation.getState().pop({ instant: true, tab, key: g.topKey });
        // In step with the slide ending, so the page is gone before the next frame.
        if (sync) flushSync(goBack);
        else goBack();
        // If the stack changed meanwhile and the page is still there, bring it back.
        if (useNavigation.getState().stacks[tab].some((e) => e.key === g.topKey)) g.top.style.transform = '';
      }
      delete el.dataset.dragging;
    };
    settleRef.current = settle;
    moves[0].finished.then(
      () => settle(true),
      () => {},
    );
  }

  useEffect(() => {
    const el = container.current;
    if (!el) return;

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return; // a second finger: the swipe's own listeners cancel it
      // Its end was never heard (shouldn't happen): don't leave pages shifted.
      abandonDrag();
      // Still sliding from the last swipe: finish that now, so this touch
      // works on the pages as they're about to be.
      settleRef.current?.(true);

      const { entries, exiting } = latest.current;
      if (entries.length < 2 || exiting) return;
      const touch = event.touches[0];
      if (touch.clientX - el.getBoundingClientRect().left > EDGE) return;
      const topKey = entries[entries.length - 1].key;
      const top = pageRefs.current.get(topKey);
      if (!top) return;

      // Listen on the touched element itself: touch events keep going to it
      // even if it's taken off the page, when they'd no longer reach `el`.
      const target = event.target instanceof Node ? event.target : el;
      const g: Drag = {
        id: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        dx: 0,
        engaged: false,
        samples: [{ x: touch.clientX, t: performance.now() }],
        topKey,
        top,
        under: pageRefs.current.get(entries[entries.length - 2].key),
        detach: () => {
          target.removeEventListener('touchmove', onMove);
          target.removeEventListener('touchend', onEnd);
          target.removeEventListener('touchcancel', onCancel);
        },
      };

      function onMove(event: Event) {
        if (drag.current !== g) return;
        const touches = (event as TouchEvent).touches;
        if (touches.length !== 1 || touches[0].identifier !== g.id) {
          if (g.engaged) finish(true);
          else abandonDrag();
          return;
        }
        const touch = touches[0];
        const dx = touch.clientX - g.startX;
        const dy = touch.clientY - g.startY;

        if (!g.engaged) {
          if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
          if (dx <= 0 || Math.abs(dy) > dx) {
            abandonDrag(); // a scroll (or a swipe the other way) - leave it be
            return;
          }
          g.engaged = true;
          finishRunning();
          el!.dataset.dragging = 'true';
        }

        // Locked sideways: the page must not scroll or react to the finger.
        if (event.cancelable) event.preventDefault();
        g.dx = Math.max(0, dx);
        g.samples.push({ x: touch.clientX, t: performance.now() });
        if (g.samples.length > 6) g.samples.shift();
        setDrag(g, el!.clientWidth);
      }

      function finish(cancelled: boolean) {
        if (!g.engaged) {
          abandonDrag();
          return;
        }
        // Speed over roughly the last tenth of a second.
        const now = performance.now();
        const recent = g.samples.filter((s) => now - s.t < 100);
        const from = recent.length > 1 ? recent[0] : g.samples[Math.max(0, g.samples.length - 2)];
        const to = g.samples[g.samples.length - 1];
        const velocity = to.t > from.t ? (to.x - from.x) / (to.t - from.t) : 0;
        release(g, velocity, cancelled);
      }

      function onEnd(event: Event) {
        if (drag.current !== g) return;
        const ended = Array.from((event as TouchEvent).changedTouches).some((t) => t.identifier === g.id);
        if (!ended) return;
        if (g.engaged && event.cancelable) event.preventDefault(); // no tap from the lifting finger
        finish(false);
      }

      function onCancel() {
        if (drag.current === g) finish(true);
      }

      target.addEventListener('touchmove', onMove, { passive: false });
      target.addEventListener('touchend', onEnd, { passive: false });
      target.addEventListener('touchcancel', onCancel);
      drag.current = g;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      abandonDrag();
    };
    // Attached once; everything changing is read through refs.
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

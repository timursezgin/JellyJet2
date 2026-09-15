import { useEffect } from 'react';
import { create } from 'zustand';

import { useNavigation } from '@/nav/navigation';
import { closePlayer, currentPosition, next, previous, seek, togglePlay, usePlayer } from '@/player/player';

/** Bumped to ask the Search page to put the cursor in its field. */
export const useSearchFocus = create(() => ({ requests: 0 }));

/** Go to Search, ready to type. */
export function focusSearch() {
  const nav = useNavigation.getState();
  if (nav.tab !== 'search') nav.selectTab('search');
  else nav.popToRoot('search');
  closePlayer();
  useSearchFocus.setState((s) => ({ requests: s.requests + 1 }));
}

function goBack() {
  if (usePlayer.getState().expanded) closePlayer();
  else useNavigation.getState().pop();
}

const SEEK_STEP = 10;

/** Typing into a field keeps its keys to itself. */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches('input, textarea, select');
}

/**
 * Keyboard and mouse shortcuts for computers:
 * Space play/pause · ←/→ back or forward 10s · Ctrl+←/→ previous/next song ·
 * Ctrl+F or / Search · Alt+← or the mouse's back button: back a page.
 */
export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const hasQueue = usePlayer.getState().queue.length > 0;

      if (e.key === ' ' && !mod && !e.altKey) {
        // Space means play/pause even when a button has focus (never "click it").
        e.preventDefault();
        if (hasQueue && !e.repeat) togglePlay();
      } else if ((e.key === 'f' && mod && !e.shiftKey) || (e.key === '/' && !mod)) {
        e.preventDefault();
        focusSearch();
      } else if (e.key === 'ArrowLeft' && e.altKey) {
        e.preventDefault();
        goBack();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.shiftKey && hasQueue) {
        e.preventDefault();
        const forward = e.key === 'ArrowRight';
        if (mod) {
          if (forward) next();
          else previous();
        } else {
          seek(Math.max(0, currentPosition() + (forward ? SEEK_STEP : -SEEK_STEP)));
        }
      } else if (e.key === 'BrowserBack') {
        e.preventDefault();
        goBack();
      }
    };

    // A button with focus would still "click" when Space is let go.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && !isTyping(e.target)) e.preventDefault();
    };

    // The back button on the side of a mouse.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 3) return;
      e.preventDefault();
      goBack();
    };
    const swallow = (e: MouseEvent) => {
      if (e.button === 3) e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', swallow);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', swallow);
    };
  }, []);
}

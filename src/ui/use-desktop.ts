import { useSyncExternalStore } from 'react';

/**
 * Wide windows (a computer) get the desktop layout: sidebar, player bar, song
 * columns. Keep in step with `@media (min-width: 1000px)` in the CSS. Below
 * this width the phone layout is exactly as it always was.
 */
export const DESKTOP_QUERY = '(min-width: 1000px)';

const media = window.matchMedia(DESKTOP_QUERY);

export const isDesktop = () => media.matches;

const subscribe = (onChange: () => void) => {
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};

export function useDesktop() {
  return useSyncExternalStore(subscribe, isDesktop);
}

import { create } from 'zustand';

/**
 * Five tabs, each with its own stack of pages (like an iPhone app). Switching
 * tabs keeps every other tab's stack exactly where it was.
 */

export const TAB_IDS = ['home', 'search', 'library', 'settings'] as const;
export type TabId = (typeof TAB_IDS)[number];

/** Every page the app can show. Each tab's first page is its tab root. */
export type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'library' }
  | { name: 'downloaded' }
  | { name: 'settings' }
  | { name: 'playlists' }
  | { name: 'artists' }
  | { name: 'albums'; genreId?: string; title?: string }
  | { name: 'tracks' }
  | { name: 'genres' }
  | { name: 'recent-albums' }
  | { name: 'recent-songs' }
  | { name: 'liked' }
  | { name: 'liked-albums' }
  | { name: 'album'; id: string; title?: string }
  | { name: 'artist'; id: string; title?: string }
  | { name: 'playlist'; id: string; title?: string }
  | { name: 'mix'; id: string; title?: string }
  | { name: 'station'; id: string; title?: string }
  | { name: 'artist-mix' }
  | { name: 'add-albums' }
  | { name: 'album-result'; id: string; title?: string };

export interface StackEntry {
  key: string;
  route: Route;
}

interface NavigationState {
  tab: TabId;
  stacks: Record<TabId, StackEntry[]>;
  /** Set when the next stack change must not animate (a finished swipe-back). */
  instant: boolean;
  selectTab(tab: TabId): void;
  push(route: Route): void;
  /**
   * Go back one page. `tab` and `key` pin it to a particular page: nothing
   * happens if that page is no longer on top of that tab.
   */
  pop(options?: { instant?: boolean; tab?: TabId; key?: string }): void;
  popToRoot(tab?: TabId): void;
  /** Desktop sidebar: show this page straight on top of Library's first page. */
  openInLibrary(route: Route): void;
  reset(): void;
}

let counter = 0;
const entry = (route: Route): StackEntry => ({ key: `page-${++counter}`, route });

const initialStacks = (): Record<TabId, StackEntry[]> => ({
  home: [entry({ name: 'home' })],
  search: [entry({ name: 'search' })],
  library: [entry({ name: 'library' })],
  settings: [entry({ name: 'settings' })],
});

export const useNavigation = create<NavigationState>((set, get) => ({
  tab: 'home',
  stacks: initialStacks(),
  instant: false,

  selectTab(tab) {
    // Tapping the tab you're already on goes back to its first page.
    if (get().tab === tab) get().popToRoot(tab);
    else set({ tab, instant: false });
  },

  push(route) {
    const { tab, stacks } = get();
    set({ instant: false, stacks: { ...stacks, [tab]: [...stacks[tab], entry(route)] } });
  },

  pop(options) {
    const { stacks } = get();
    const tab = options?.tab ?? get().tab;
    const stack = stacks[tab];
    if (stack.length < 2) return;
    if (options?.key && stack[stack.length - 1].key !== options.key) return;
    set({ instant: options?.instant ?? false, stacks: { ...stacks, [tab]: stack.slice(0, -1) } });
  },

  popToRoot(tab = get().tab) {
    const { stacks } = get();
    if (stacks[tab].length < 2) return;
    set({ instant: false, stacks: { ...stacks, [tab]: stacks[tab].slice(0, 1) } });
  },

  openInLibrary(route) {
    const { tab, stacks } = get();
    const stack = stacks.library;
    const top = stack[stack.length - 1].route;
    if (tab === 'library' && sameRoute(top, route)) return;
    set({ tab: 'library', instant: true, stacks: { ...stacks, library: [stack[0], entry(route)] } });
  },

  reset() {
    set({ tab: 'home', stacks: initialStacks(), instant: true });
  },
}));

/** Whether two routes show the same page (titles aside). */
export function sameRoute(a: Route, b: Route) {
  return a.name === b.name && ('id' in a ? a.id : '') === ('id' in b ? b.id : '');
}

/** Open a page on the current tab. */
export const navigate = (route: Route) => useNavigation.getState().push(route);

/** The title a page shows, used for the back button on the page above it. */
export function routeTitle(route: Route): string {
  switch (route.name) {
    case 'home':
      return 'Home';
    case 'search':
      return 'Search';
    case 'library':
      return 'Library';
    case 'downloaded':
      return 'Downloaded';
    case 'settings':
      return 'Settings';
    case 'playlists':
      return 'Playlists';
    case 'artists':
      return 'Artists';
    case 'albums':
      return route.title ?? 'Albums';
    case 'tracks':
      return 'Tracks';
    case 'genres':
      return 'Genres';
    case 'recent-albums':
      return 'Recently added';
    case 'recent-songs':
      return 'Recently played';
    case 'liked':
      return 'Liked Songs';
    case 'liked-albums':
      return 'Liked Albums';
    case 'artist-mix':
      return 'Artist mix';
    case 'add-albums':
      return 'Add albums';
    case 'album':
    case 'artist':
    case 'playlist':
    case 'mix':
    case 'station':
    case 'album-result':
      return route.title ?? 'Back';
  }
}

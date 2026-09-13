import { create } from 'zustand';

/**
 * Five tabs, each with its own stack of pages (like an iPhone app). Switching
 * tabs keeps every other tab's stack exactly where it was.
 */

export const TAB_IDS = ['home', 'search', 'library', 'downloaded', 'settings'] as const;
export type TabId = (typeof TAB_IDS)[number];

/** Every page the app can show. Each tab's first page is its tab root. */
export type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'library' }
  | { name: 'downloaded' }
  | { name: 'settings' }
  | { name: 'placeholder'; title: string };

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
  pop(options?: { instant?: boolean }): void;
  popToRoot(tab?: TabId): void;
  reset(): void;
}

let counter = 0;
const entry = (route: Route): StackEntry => ({ key: `page-${++counter}`, route });

const initialStacks = (): Record<TabId, StackEntry[]> => ({
  home: [entry({ name: 'home' })],
  search: [entry({ name: 'search' })],
  library: [entry({ name: 'library' })],
  downloaded: [entry({ name: 'downloaded' })],
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
    const { tab, stacks } = get();
    if (stacks[tab].length < 2) return;
    set({ instant: options?.instant ?? false, stacks: { ...stacks, [tab]: stacks[tab].slice(0, -1) } });
  },

  popToRoot(tab = get().tab) {
    const { stacks } = get();
    if (stacks[tab].length < 2) return;
    set({ instant: false, stacks: { ...stacks, [tab]: stacks[tab].slice(0, 1) } });
  },

  reset() {
    set({ tab: 'home', stacks: initialStacks(), instant: true });
  },
}));

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
    case 'placeholder':
      return route.title;
  }
}

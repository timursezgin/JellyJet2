import { createContext, useContext } from 'react';

import type { Route } from './navigation';

export interface PageInfo {
  /** Label for the back button, or null on a tab's first page. */
  backLabel: string | null;
  goBack(): void;
  /** False while the page is covered by another page or its tab is hidden. */
  active: boolean;
  /** The page being shown (null outside a page stack). */
  route: Route | null;
}

export const PageContext = createContext<PageInfo>({
  backLabel: null,
  goBack: () => {},
  active: true,
  route: null,
});

export const usePage = () => useContext(PageContext);

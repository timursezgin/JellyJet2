import { createContext, useContext } from 'react';

export interface PageInfo {
  /** Label for the back button, or null on a tab's first page. */
  backLabel: string | null;
  goBack(): void;
  /** False while the page is covered by another page or its tab is hidden. */
  active: boolean;
}

export const PageContext = createContext<PageInfo>({
  backLabel: null,
  goBack: () => {},
  active: true,
});

export const usePage = () => useContext(PageContext);

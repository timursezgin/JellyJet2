import { ChevronLeft, CloudOff, Search, X } from 'lucide-react';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react';

import { useOnline } from '@/connectivity/connection';
import { navigate } from '@/nav/navigation';
import { usePage } from '@/nav/page-context';
import styles from './page.module.css';

/** The page's scrolling element, for lists that only draw what's on screen. */
const ScrollContext = createContext<HTMLDivElement | null>(null);
export const usePageScroller = () => useContext(ScrollContext);

export interface HiddenSearch {
  value: string;
  onChange(value: string): void;
  placeholder: string;
}

interface PageProps {
  title: string;
  /**
   * `large`: tab and category pages with a big title.
   * `detail`: album, artist and playlist pages, whose artwork header is the
   * title; a small title fades into the bar once it scrolls away.
   */
  variant?: 'large' | 'detail';
  /** Shown at the right end of the title row. */
  trailing?: ReactNode;
  /** A search bar tucked above the content; pull the page down to reveal it. */
  search?: HiddenSearch;
  children?: ReactNode;
}

const SEARCH_HEIGHT = 52;
/** How far a detail page scrolls before its title shows in the bar (the hero's title is under it by then). */
const DETAIL_TITLE_AFTER = 100;

export function Page({ title, variant = 'large', trailing, search, children }: PageProps) {
  const { backLabel, goBack, route } = usePage();
  const online = useOnline();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [showTitle, setShowTitle] = useState(false);
  const searchStarted = useRef(false);

  // Start with the search bar tucked out of sight, as iOS lists do.
  const searchBox = useRef<HTMLDivElement>(null);

  /** The search bar fades as it tucks under the see-through title bar, as in iOS. */
  const fadeSearch = (top: number) => {
    const el = searchBox.current;
    if (!el) return;
    // Fully shown while at least 60% of it is pulled down, gone once tucked.
    el.style.opacity = String(Math.max(0, Math.min(1, (SEARCH_HEIGHT - top) / (SEARCH_HEIGHT * 0.6))));
  };

  useLayoutEffect(() => {
    if (scroller && search && !search.value && !searchStarted.current) scroller.scrollTop = SEARCH_HEIGHT;
    if (scroller) fadeSearch(scroller.scrollTop);
    // Only when the page first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    if (search) fadeSearch(top);
    const nextScrolled = top > (search ? SEARCH_HEIGHT : 0) + 1;
    if (nextScrolled !== scrolled) setScrolled(nextScrolled);
    if (variant === 'detail') {
      const nextTitle = top - (search ? SEARCH_HEIGHT : 0) > DETAIL_TITLE_AFTER;
      if (nextTitle !== showTitle) setShowTitle(nextTitle);
    }
  };

  // Just the chevron: the page's own title says where you are.
  const back = backLabel && (
    <button type="button" className={styles.back} onClick={goBack} aria-label={`Back to ${backLabel}`}>
      <ChevronLeft size={26} strokeWidth={2.2} />
    </button>
  );

  return (
    <div
      className={styles.page}
      data-variant={variant}
      data-has-back={backLabel ? true : undefined}
      data-has-search={search ? true : undefined}
      data-offline={!online || undefined}
    >
      {variant === 'large' ? (
        <header className={styles.bar} data-scrolled={scrolled || undefined}>
          <div className={styles.titleRow}>
            {back}
            <h1 className={styles.title}>{title}</h1>
            {trailing && <div className={styles.trailing}>{trailing}</div>}
          </div>
          {!online && <OfflineNotice onDownloaded={route?.name === 'downloaded'} />}
        </header>
      ) : (
        <header className={styles.detailBar} data-scrolled={scrolled || undefined} data-title={showTitle || undefined}>
          <div className={styles.detailRow}>
            <div className={styles.detailSide}>{back}</div>
            <div className={styles.detailTitle}>{title}</div>
            <div className={`${styles.detailSide} ${styles.detailTrailing}`}>{trailing}</div>
          </div>
          {!online && <OfflineNotice onDownloaded={route?.name === 'downloaded'} />}
        </header>
      )}
      <div ref={setScroller} className={styles.scroll} onScroll={onScroll}>
        <div className={styles.content}>
          {search && (
            <div ref={searchBox} className={styles.search}>
              <label className={styles.searchField}>
                <Search size={17} strokeWidth={2.2} />
                <input
                  type="search"
                  enterKeyHint="search"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={search.placeholder}
                  value={search.value}
                  onChange={(e) => {
                    searchStarted.current = true;
                    search.onChange(e.target.value);
                  }}
                />
                {search.value && (
                  <button type="button" className={styles.clear} onClick={() => search.onChange('')} aria-label="Clear search">
                    <X size={14} strokeWidth={3} />
                  </button>
                )}
              </label>
            </div>
          )}
          <ScrollContext.Provider value={scroller}>{children}</ScrollContext.Provider>
        </div>
      </div>
    </div>
  );
}

/** Under the title while the server can't be reached, with a way to the Downloaded list. */
function OfflineNotice({ onDownloaded }: { onDownloaded: boolean }) {
  return (
    <p className={styles.offline} role="status">
      <CloudOff size={14} strokeWidth={2.4} />
      <span>
        Offline
        {!onDownloaded && (
          <>
            {' • '}
            <button type="button" className={styles.offlineLink} onClick={() => navigate({ name: 'downloaded' })}>
              Go to Downloaded
            </button>
          </>
        )}
      </span>
    </p>
  );
}

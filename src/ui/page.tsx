import { ChevronLeft } from 'lucide-react';
import { useState, type ReactNode, type UIEvent } from 'react';

import { usePage } from '@/nav/page-context';
import styles from './page.module.css';

interface PageProps {
  title: string;
  /** Shown at the right end of the title row. */
  trailing?: ReactNode;
  children?: ReactNode;
}

/**
 * The shell for tab and category pages: a large title in a band that stays put,
 * with the blur and hairline fading in once content scrolls under it. Pages in
 * a stack get a back button above the title.
 */
export function Page({ title, trailing, children }: PageProps) {
  const { backLabel, goBack } = usePage();
  const [scrolled, setScrolled] = useState(false);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const next = event.currentTarget.scrollTop > 0;
    if (next !== scrolled) setScrolled(next);
  };

  return (
    <div className={styles.page} data-has-back={backLabel ? true : undefined}>
      <header className={styles.bar} data-scrolled={scrolled || undefined}>
        {backLabel && (
          <button type="button" className={styles.back} onClick={goBack}>
            <ChevronLeft size={26} strokeWidth={2.2} />
            <span>{backLabel}</span>
          </button>
        )}
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {trailing && <div className={styles.trailing}>{trailing}</div>}
        </div>
      </header>
      <div className={styles.scroll} onScroll={onScroll}>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}

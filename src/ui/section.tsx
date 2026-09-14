import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import styles from './section.module.css';

interface SectionHeaderProps {
  title: string;
  /** Makes the whole header a button (e.g. "see all"). */
  onOpen?(): void;
  trailing?: ReactNode;
}

export function SectionHeader({ title, onOpen, trailing }: SectionHeaderProps) {
  const heading = (
    <>
      <h2 className="t-section-header">{title}</h2>
      {onOpen && <ChevronRight className={styles.chevron} size={20} strokeWidth={2.4} />}
    </>
  );
  return (
    <div className={styles.header}>
      {onOpen ? (
        <button type="button" className={styles.open} onClick={onOpen}>
          {heading}
        </button>
      ) : (
        <div className={styles.open}>{heading}</div>
      )}
      {trailing}
    </div>
  );
}

/** A row of cards that scrolls sideways. */
export function Shelf({ children }: { children: ReactNode }) {
  return <div className={styles.shelf}>{children}</div>;
}

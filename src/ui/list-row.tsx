import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import styles from './list-row.module.css';

interface ListRowProps {
  label: ReactNode;
  value?: ReactNode;
  chevron?: boolean;
  tone?: 'default' | 'accent';
  onClick?(): void;
}

/** A full-width text row with a hairline above it; the whole row is the button. */
export function ListRow({ label, value, chevron = false, tone = 'default', onClick }: ListRowProps) {
  const content = (
    <>
      <span className={styles.label}>{label}</span>
      {value !== undefined && <span className={styles.value}>{value}</span>}
      {chevron && <ChevronRight className={styles.chevron} size={17} strokeWidth={2} />}
    </>
  );
  if (!onClick) {
    return (
      <div className={styles.row} data-tone={tone}>
        {content}
      </div>
    );
  }
  return (
    <button type="button" className={styles.row} data-tone={tone} onClick={onClick}>
      {content}
    </button>
  );
}

export function ListGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      {title && <h2 className={`t-eyebrow ${styles.groupTitle}`}>{title}</h2>}
      <div className={styles.rows}>{children}</div>
    </section>
  );
}

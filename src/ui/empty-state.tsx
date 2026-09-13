import type { ReactNode } from 'react';

import styles from './empty-state.module.css';

/** A quiet centred message for pages with nothing to show yet. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <p className="t-row-title">{title}</p>
      {children && <p className="t-secondary">{children}</p>}
    </div>
  );
}

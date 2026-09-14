import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import styles from './item-row.module.css';

export const ITEM_ROW_HEIGHT = 60;

interface ItemRowProps {
  art: ReactNode;
  title: string;
  subtitle?: string;
  /** Accent-coloured title and no chevron (an action like "New playlist"). */
  accent?: boolean;
  onClick(): void;
}

/** An artist, album or playlist row: picture, name, detail, chevron. */
export function ItemRow({ art, title, subtitle, accent = false, onClick }: ItemRowProps) {
  return (
    <button type="button" className={styles.row} data-accent={accent || undefined} onClick={onClick}>
      {art}
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </span>
      {!accent && <ChevronRight className={styles.chevron} size={17} strokeWidth={2} />}
    </button>
  );
}

import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import styles from './item-row.module.css';

export const ITEM_ROW_HEIGHT = 70;

interface ItemRowProps {
  art: ReactNode;
  title: string;
  subtitle?: string;
  onClick(): void;
}

/** An artist, album or playlist row: picture, name, detail, chevron. */
export function ItemRow({ art, title, subtitle, onClick }: ItemRowProps) {
  return (
    <button type="button" className={styles.row} onClick={onClick}>
      {art}
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </span>
      <ChevronRight className={styles.chevron} size={17} strokeWidth={2} />
    </button>
  );
}

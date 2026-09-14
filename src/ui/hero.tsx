import { Play, Shuffle } from 'lucide-react';
import type { ReactNode } from 'react';

import styles from './hero.module.css';

/** For buttons that want the hero's 44×44 square look. */
export const heroIconClass = styles.icon;

interface HeroProps {
  /** `side`: cover beside the title (albums). `stacked`: cover above (playlists, artists). */
  layout: 'side' | 'stacked';
  art: ReactNode;
  title: string;
  /** A small accent label above the title ("Genre mix"). */
  kicker?: string;
  /** A sentence under the meta line (why a mix was made). */
  note?: string;
  /** A tappable line under the title, in the accent colour (the album's artist). */
  link?: { label: string; onClick?(): void };
  meta?: string;
  onPlay?(): void;
  onShuffle?(): void;
  /** Extra square buttons after Play and Shuffle (download, add…). */
  actions?: ReactNode;
}

/** The top of an album, playlist or artist page. */
export function Hero({ layout, art, title, kicker, note, link, meta, onPlay, onShuffle, actions }: HeroProps) {
  return (
    <section className={styles.hero} data-layout={layout}>
      <div className={styles.top}>
        <div className={styles.art}>{art}</div>
        <div className={styles.text}>
          {kicker && <p className={`t-kicker ${styles.kicker}`}>{kicker}</p>}
          <h1 className={styles.title}>{title}</h1>
          {link &&
            (link.onClick ? (
              <button type="button" className={styles.link} onClick={link.onClick}>
                {link.label}
              </button>
            ) : (
              <span className={styles.link}>{link.label}</span>
            ))}
          {meta && <p className={styles.meta}>{meta}</p>}
          {note && <p className={styles.note}>{note}</p>}
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.play} onClick={onPlay} disabled={!onPlay}>
          <Play size={17} fill="currentColor" strokeWidth={0} />
          Play
        </button>
        <button type="button" className={styles.shuffle} onClick={onShuffle} disabled={!onShuffle}>
          <Shuffle size={17} strokeWidth={2.2} />
          Shuffle
        </button>
        {actions}
      </div>
    </section>
  );
}

/** A 44×44 square button for the hero's action row. */
export function HeroIconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={styles.icon} data-active={active || undefined} onClick={onClick} aria-label={label}>
      {children}
    </button>
  );
}

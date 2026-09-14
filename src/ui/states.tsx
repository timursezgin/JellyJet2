import { useOnline } from '@/connectivity/connection';
import styles from './states.module.css';

function OfflineMessage() {
  return (
    <div className={styles.error}>
      <p>You’re offline.</p>
      <p className={styles.hint}>This page shows up here once it’s been opened with a connection.</p>
    </div>
  );
}

/** Placeholder rows while a list loads. */
export function LoadingRows({ count = 8, height = 56 }: { count?: number; height?: number }) {
  const online = useOnline();
  if (!online) return <OfflineMessage />;
  return (
    <div className={styles.rows} aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.row} style={{ height }}>
          <div className={styles.block} />
          <div className={styles.lines}>
            <div className={styles.line} style={{ width: `${55 + ((i * 17) % 35)}%` }} />
            <div className={styles.lineShort} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A quiet message with an optional retry, for failed loads. */
export function LoadError({ onRetry }: { onRetry(): void }) {
  const online = useOnline();
  if (!online) return <OfflineMessage />;
  return (
    <div className={styles.error}>
      <p>Couldn’t load this.</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

import styles from './states.module.css';

/** Placeholder rows while a list loads. */
export function LoadingRows({ count = 8, height = 64 }: { count?: number; height?: number }) {
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
  return (
    <div className={styles.error}>
      <p>Couldn’t load this.</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

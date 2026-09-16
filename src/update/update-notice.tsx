import { applyUpdate, useUpdate } from './update';
import styles from './update-notice.module.css';

/**
 * "New version available. Update?" - shown under the app's version (Home's
 * title row, Settings' version card) when a newer JellyJet has been
 * published. Tapping it loads the new version.
 */
export function UpdateNotice({ className }: { className?: string }) {
  const { available, latest, refreshing } = useUpdate();
  if (!available) return null;
  return (
    <button
      type="button"
      className={`${styles.update} ${className ?? ''}`}
      onClick={() => void applyUpdate()}
      disabled={refreshing}
      title={latest ? `JellyJet ${latest}` : undefined}
    >
      {refreshing ? 'Updating…' : 'New version available. Update?'}
    </button>
  );
}

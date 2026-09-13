import { useSession } from '@/auth/session';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import styles from './home-screen.module.css';

export function HomeScreen() {
  const serverName = useSession((s) => s.session?.serverName);
  return (
    <Page
      title="Home"
      trailing={
        <span className={styles.pill}>
          <span className={styles.dot} />
          {serverName}
        </span>
      }
    >
      <EmptyState title="Recently played, Made for you and Recently added">
        These shelves arrive in step 3.
      </EmptyState>
    </Page>
  );
}

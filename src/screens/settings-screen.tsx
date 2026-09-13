import { useSession } from '@/auth/session';
import { CLIENT_VERSION } from '@/jellyfin/identity';
import { useNavigation } from '@/nav/navigation';
import { ListGroup, ListRow } from '@/ui/list-row';
import { Page } from '@/ui/page';
import styles from './settings-screen.module.css';

export function SettingsScreen() {
  const session = useSession((s) => s.session);
  const signOut = useSession((s) => s.signOut);
  const resetNavigation = useNavigation((s) => s.reset);

  if (!session) return null;
  const address = session.serverUrl.replace(/^https?:\/\//, '');
  const role = session.permissions.isAdmin ? 'Admin' : 'User';

  return (
    <Page title="Settings">
      <section className={styles.server}>
        <p className={styles.status}>
          <span className={styles.dot} />
          Connected
        </p>
        <p className={styles.name}>{session.serverName}</p>
        <p className={styles.detail}>
          {address} · signed in as {session.userName}
        </p>
      </section>

      <ListGroup title="Account">
        <ListRow label="Role" value={role} />
        <ListRow label="Downloads" value={session.permissions.canDownload ? 'Allowed' : 'Not allowed'} />
        <ListRow
          label="Sign out"
          tone="accent"
          onClick={() => {
            void signOut();
            resetNavigation();
          }}
        />
      </ListGroup>

      <p className={`t-caption ${styles.footnote}`}>JellyJet {CLIENT_VERSION}</p>
    </Page>
  );
}

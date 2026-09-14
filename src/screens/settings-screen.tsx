import { useEffect, useState } from 'react';

import { useSession } from '@/auth/session';
import { useOnline } from '@/connectivity/connection';
import { useDownloads } from '@/downloads/downloads';
import { removeAllDownloads } from '@/downloads/engine';
import { clearAccountCache } from '@/downloads/lifecycle';
import { requestPersistentStorage } from '@/downloads/support';
import { CLIENT_VERSION } from '@/jellyfin/identity';
import { useNavigation } from '@/nav/navigation';
import { unloadMixes } from '@/mixes/mixes';
import { forgetPipeline } from '@/pipeline/pipeline';
import { clearQueue } from '@/player/player';
import { updateSettings, useSettings } from '@/settings/settings';
import { confirm } from '@/ui/confirm';
import { ListGroup, ListRow } from '@/ui/list-row';
import { Page } from '@/ui/page';
import { formatBytes } from './downloaded-screen';
import { songCount as songLabel } from './playlists-screen';
import styles from './settings-screen.module.css';

export function SettingsScreen() {
  const session = useSession((s) => s.session);
  const signOut = useSession((s) => s.signOut);
  const resetNavigation = useNavigation((s) => s.reset);
  const online = useOnline();

  if (!session) return null;
  const address = session.serverUrl.replace(/^https?:\/\//, '');
  const role = session.permissions.isAdmin ? 'Admin' : 'User';

  return (
    <Page title="Settings">
      <section className={styles.server}>
        <p className={styles.status} data-offline={!online || undefined}>
          <span className={styles.dot} />
          {online ? 'Connected' : 'Can’t reach the server'}
        </p>
        <p className={styles.name}>{session.serverName}</p>
        <p className={styles.detail}>
          {address} · signed in as {session.userName}
        </p>
      </section>

      {session.permissions.canDownload && <DownloadSettings />}

      <ListGroup title="Account">
        <ListRow label="Role" value={role} />
        <ListRow label="Downloads" value={session.permissions.canDownload ? 'Allowed' : 'Not allowed'} />
        <ListRow
          label="Sign out"
          tone="accent"
          onClick={() => {
            clearQueue();
            unloadMixes();
            forgetPipeline();
            void clearAccountCache();
            void signOut();
            resetNavigation();
          }}
        />
      </ListGroup>

      <p className={`t-caption ${styles.footnote}`}>JellyJet {CLIENT_VERSION}</p>
    </Page>
  );
}

function DownloadSettings() {
  const quality = useSettings((s) => s.downloadQuality);
  const songCount = useDownloads((s) => Object.keys(s.songs).length);
  const bytes = useDownloads((s) => Object.values(s.songs).reduce((sum, song) => sum + song.size, 0));
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null));
  }, [songCount]);

  return (
    <>
      <ListGroup title="Downloads">
        <ListRow
          label="Download quality"
          value={quality === 'original' ? 'Original' : 'Smaller'}
          chevron
          onClick={() => updateSettings({ downloadQuality: quality === 'original' ? 'smaller' : 'original' })}
        />
        <ListRow label="On this device" value={songCount ? `${songLabel(songCount)} · ${formatBytes(bytes)}` : 'Nothing yet'} />
        <ListRow
          label="Protected from clean-up"
          value={persisted === null ? '-' : persisted ? 'Yes' : 'Not yet'}
          onClick={
            persisted
              ? undefined
              : () => {
                  void requestPersistentStorage().then(setPersisted);
                }
          }
        />
        {songCount > 0 && (
          <ListRow
            label="Remove all downloads"
            tone="accent"
            onClick={async () => {
              const ok = await confirm({
                title: 'Remove all downloads?',
                message: `${songLabel(songCount)} will be deleted from this device. Your playlists and likes aren’t affected.`,
                confirmLabel: 'Remove all',
                destructive: true,
              });
              if (ok) await removeAllDownloads();
            }}
          />
        )}
      </ListGroup>
      <p className={styles.note}>
        {quality === 'original'
          ? 'Original keeps the exact file from your server. Songs this device can’t play are stored as smaller copies.'
          : 'Smaller stores compressed copies (about 1.5 MB a minute) to save space.'}{' '}
        Downloads are kept by this Home Screen app; deleting its icon or clearing Safari’s website data removes them.
      </p>
    </>
  );
}

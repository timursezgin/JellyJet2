import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';

import { useSession } from '@/auth/session';
import { useOnline } from '@/connectivity/connection';
import { useDownloads } from '@/downloads/downloads';
import { removeAllDownloads } from '@/downloads/engine';
import { clearAccountCache } from '@/downloads/lifecycle';
import { requestPersistentStorage } from '@/downloads/support';
import {
  CLIENT_VERSION,
  deviceName,
  guessedDeviceName,
  MAX_DEVICE_NAME,
  onDeviceNameChange,
  setDeviceName,
} from '@/jellyfin/identity';
import { useNavigation } from '@/nav/navigation';
import { unloadMixes } from '@/mixes/mixes';
import { forgetPipeline } from '@/pipeline/pipeline';
import { clearQueue } from '@/player/player';
import { announceDevice } from '@/remote/socket';
import { updateSettings, useSettings } from '@/settings/settings';
import { confirm } from '@/ui/confirm';
import { ListGroup, ListRow } from '@/ui/list-row';
import { Page } from '@/ui/page';
import { Sheet } from '@/ui/sheet';
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

      <DeviceSettings />

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

const subscribeName = (listener: () => void) => onDeviceNameChange(listener);

/** "This device": the name the account's other devices see ("Playing on Tim's iPhone"). */
function DeviceSettings() {
  const name = useSyncExternalStore(subscribeName, deviceName);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <ListGroup title="This device">
        <ListRow label="Device name" value={name} chevron onClick={() => setEditing(true)} />
      </ListGroup>
      <p className={styles.note}>Shown on your other devices when you play music on this one, and in Jellyfin.</p>
      <Sheet open={editing} onClose={() => setEditing(false)} title="Device name" closeLabel="Cancel">
        {editing && <DeviceNameForm current={name} onDone={() => setEditing(false)} />}
      </Sheet>
    </>
  );
}

function DeviceNameForm({ current, onDone }: { current: string; onDone(): void }) {
  const [value, setValue] = useState(current);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setDeviceName(value);
    announceDevice();
    onDone();
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <input
        className={styles.input}
        placeholder={guessedDeviceName()}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        enterKeyHint="done"
        maxLength={MAX_DEVICE_NAME}
        autoFocus
        aria-label="Device name"
      />
      <button type="submit" className={styles.save}>
        Save
      </button>
      <p className={styles.formNote}>Like “Tim’s iPhone” or “tim-desktop”. Leave it empty to go back to “{guessedDeviceName()}”.</p>
    </form>
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

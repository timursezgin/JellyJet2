import { useEffect, useState, type FormEvent } from 'react';

import { useSession } from '@/auth/session';
import { JellyfinError } from '@/jellyfin/client';
import { defaultServerUrl, fetchPublicInfo } from '@/lib/server';
import styles from './sign-in-screen.module.css';

/**
 * Username and password for the Jellyfin server behind this address. Other
 * servers can be reached through "Use a different server".
 */
export function SignInScreen() {
  const signIn = useSession((s) => s.signIn);
  const [serverName, setServerName] = useState<string | null>(null);
  const [customServer, setCustomServer] = useState(false);
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchPublicInfo(defaultServerUrl, controller.signal)
      .then((info) => setServerName(info.ServerName))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const url = customServer ? server.trim() : defaultServerUrl;
    if (!url || !username.trim()) {
      setError(customServer && !url ? 'Enter the server address.' : 'Enter your username.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(url, username.trim(), password);
    } catch (e) {
      setError(e instanceof JellyfinError ? e.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className={styles.screen}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <img className={styles.icon} src="/icons/Icon-192.png?v=2" alt="" width={64} height={64} />
        <h1 className="t-large-title">Sign in</h1>
        <p className={`t-secondary ${styles.subtitle}`}>
          {customServer
            ? 'Enter your Jellyfin server’s address, then sign in.'
            : serverName
              ? `Use your Jellyfin account on ${serverName}.`
              : 'Use your Jellyfin account.'}
        </p>

        {customServer && (
          <label className={styles.field}>
            <span className="t-eyebrow">Server address</span>
            <input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="jellyfin.example.com"
              value={server}
              onChange={(e) => setServer(e.target.value)}
            />
          </label>
        )}

        <label className={styles.field}>
          <span className="t-eyebrow">Username</span>
          <input
            type="text"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span className="t-eyebrow">Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? <span className={styles.spinner} /> : 'Sign in'}
        </button>

        <button
          type="button"
          className={styles.link}
          onClick={() => {
            setCustomServer(!customServer);
            setError(null);
          }}
        >
          {customServer ? `Use ${serverName ?? 'this server'}` : 'Use a different server'}
        </button>
      </form>
    </div>
  );
}

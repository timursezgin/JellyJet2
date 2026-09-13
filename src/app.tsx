import { useEffect, useState } from 'react';
import { ArrowDownToLine, House, Library, Search, SlidersHorizontal } from 'lucide-react';

import { defaultServerUrl, fetchPublicInfo, type PublicServerInfo } from './lib/server';
import styles from './app.module.css';

// Step 0 placeholder: proves the design tokens, the home-screen layout (status
// bar, notch, home indicator) and the connection to Jellyfin. The real shell
// replaces this in step 1.

const TABS = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'downloaded', label: 'Downloaded', icon: ArrowDownToLine },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = useState<TabId>('home');
  const [server, setServer] = useState<PublicServerInfo | 'error' | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchPublicInfo(defaultServerUrl, controller.signal)
      .then(setServer)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.warn('Jellyfin check failed', error);
          setServer('error');
        }
      });
    return () => controller.abort();
  }, []);

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className={styles.app}>
      <main className={styles.page}>
        <h1 className="t-large-title">{current.label}</h1>
        <p className="t-secondary">JellyJet 2 is being built.</p>

        <section className={styles.card}>
          <div className="t-eyebrow">Server</div>
          {server === null && <p className="t-secondary">Checking…</p>}
          {server === 'error' && <p className={styles.error}>Can’t reach Jellyfin</p>}
          {server && server !== 'error' && (
            <p className={styles.status}>
              <span className={styles.dot} />
              <span className="t-row-title">{server.ServerName}</span>
              <span className="t-meta">Jellyfin {server.Version}</span>
            </p>
          )}
        </section>
      </main>

      <nav className={styles.tabBar}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={styles.tab}
            data-active={id === tab || undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={23} strokeWidth={id === tab ? 2.2 : 1.8} />
            <span className="t-tab-label">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

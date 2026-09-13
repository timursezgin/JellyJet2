import { ArrowDownToLine, House, Library, Search, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';

import { FullPlayer } from '@/player/full-player';
import { MiniPlayer } from '@/player/mini-player';
import { restoreQueue, usePlayer } from '@/player/player';
import { ToastHost } from '@/ui/toast';
import { StackView } from '@/nav/stack-view';
import { TAB_IDS, useNavigation, type Route, type TabId } from '@/nav/navigation';
import { DownloadedScreen } from '@/screens/downloaded-screen';
import { HomeScreen } from '@/screens/home-screen';
import { LibraryScreen } from '@/screens/library-screen';
import { PlaceholderScreen } from '@/screens/placeholder-screen';
import { SearchScreen } from '@/screens/search-screen';
import { SettingsScreen } from '@/screens/settings-screen';
import styles from './app-shell.module.css';

const TABS: Record<TabId, { label: string; icon: LucideIcon }> = {
  home: { label: 'Home', icon: House },
  search: { label: 'Search', icon: Search },
  library: { label: 'Library', icon: Library },
  downloaded: { label: 'Downloaded', icon: ArrowDownToLine },
  settings: { label: 'Settings', icon: SlidersHorizontal },
};

function renderRoute(route: Route) {
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'search':
      return <SearchScreen />;
    case 'library':
      return <LibraryScreen />;
    case 'downloaded':
      return <DownloadedScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'placeholder':
      return <PlaceholderScreen title={route.title} />;
  }
}

/** The signed-in app: five tabs, each with its own stack of pages. */
export function AppShell() {
  const tab = useNavigation((s) => s.tab);
  const stacks = useNavigation((s) => s.stacks);
  const selectTab = useNavigation((s) => s.selectTab);
  const hasQueue = usePlayer((s) => s.queue.length > 0);

  useEffect(restoreQueue, []);

  return (
    <div className={styles.shell} data-mini={hasQueue || undefined}>
      <FullPlayer />
      <ToastHost />
      <MiniPlayer />
      <div className={styles.stacks}>
        {TAB_IDS.map((id) => (
          <StackView key={id} entries={stacks[id]} visible={id === tab} renderRoute={renderRoute} />
        ))}
      </div>

      <nav className={styles.tabBar}>
        {TAB_IDS.map((id) => {
          const { label, icon: Icon } = TABS[id];
          const active = id === tab;
          return (
            <button
              key={id}
              type="button"
              className={styles.tab}
              data-active={active || undefined}
              aria-current={active ? 'page' : undefined}
              onClick={() => selectTab(id)}
            >
              <Icon size={23} strokeWidth={active ? 2.2 : 1.9} />
              <span className="t-tab-label">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

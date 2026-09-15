import { House, Library, Search, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { useEffect, type CSSProperties } from 'react';

import { useSession } from '@/auth/session';
import { startOfflineServices } from '@/downloads/lifecycle';
import { FullPlayer } from '@/player/full-player';
import { MiniPlayer } from '@/player/mini-player';
import { startHandoff } from '@/player/handoff';
import { DevicePickerHost } from '@/remote/device-picker';
import { startReceiver } from '@/remote/receiver';
import { startRemote } from '@/remote/remote';
import { startSocket } from '@/remote/socket';
import { TapToPlay } from '@/remote/tap-to-play';
import { HandoffOffer } from '@/player/handoff-offer';
import { PlayerBar } from '@/player/player-bar';
import { SidePanel, useSidePanel } from '@/player/side-panel';
import { SongDragGhost } from '@/songs/song-drag';
import { useDesktop } from '@/ui/use-desktop';
import { restoreQueue, usePlayer } from '@/player/player';
import { NewPlaylistHost, SongMenuHost } from '@/songs/song-menu';
import { ConfirmHost } from '@/ui/confirm';
import { ToastHost } from '@/ui/toast';
import { StackView } from '@/nav/stack-view';
import { TAB_IDS, useNavigation, type Route, type TabId } from '@/nav/navigation';
import { AddAlbumsScreen } from '@/screens/add-albums-screen';
import { AlbumResultScreen } from '@/screens/album-result-screen';
import { AlbumScreen } from '@/screens/album-screen';
import { ArtistMixScreen } from '@/screens/artist-mix-screen';
import { MixScreen, StationScreen } from '@/screens/mix-screen';
import { AlbumsScreen, RecentAlbumsScreen } from '@/screens/albums-screen';
import { ArtistScreen } from '@/screens/artist-screen';
import { ArtistsScreen } from '@/screens/artists-screen';
import { DownloadedScreen } from '@/screens/downloaded-screen';
import { GenresScreen } from '@/screens/genres-screen';
import { HomeScreen } from '@/screens/home-screen';
import { LibraryScreen } from '@/screens/library-screen';
import { LikedSongsScreen, PlaylistScreen } from '@/screens/playlist-screen';
import { PlaylistsScreen } from '@/screens/playlists-screen';
import { SearchScreen } from '@/screens/search-screen';
import { TracksScreen } from '@/screens/tracks-screen';
import { SettingsScreen } from '@/screens/settings-screen';
import { useShortcuts } from './shortcuts';
import { Sidebar } from './sidebar';
import styles from './app-shell.module.css';

const TABS: Record<TabId, { label: string; icon: LucideIcon }> = {
  home: { label: 'Home', icon: House },
  search: { label: 'Search', icon: Search },
  library: { label: 'Library', icon: Library },
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
    case 'playlists':
      return <PlaylistsScreen />;
    case 'artists':
      return <ArtistsScreen />;
    case 'albums':
      return <AlbumsScreen title={route.title} genreId={route.genreId} />;
    case 'tracks':
      return <TracksScreen />;
    case 'genres':
      return <GenresScreen />;
    case 'recent-albums':
      return <RecentAlbumsScreen kind={route.kind} />;
    case 'liked':
      return <LikedSongsScreen />;
    case 'album':
      return <AlbumScreen id={route.id} title={route.title} />;
    case 'artist':
      return <ArtistScreen id={route.id} title={route.title} />;
    case 'playlist':
      return <PlaylistScreen id={route.id} title={route.title} />;
    case 'mix':
      return <MixScreen id={route.id} title={route.title} />;
    case 'station':
      return <StationScreen id={route.id} title={route.title} />;
    case 'artist-mix':
      return <ArtistMixScreen />;
    case 'add-albums':
      return <AddAlbumsScreen />;
    case 'album-result':
      return <AlbumResultScreen id={route.id} title={route.title} />;
  }
}

/** The signed-in app: five tabs, each with its own stack of pages. */
export function AppShell() {
  const tab = useNavigation((s) => s.tab);
  const stacks = useNavigation((s) => s.stacks);
  const selectTab = useNavigation((s) => s.selectTab);
  const hasQueue = usePlayer((s) => s.queue.length > 0);
  const session = useSession((s) => s.session);
  const desktop = useDesktop();
  const sidePanel = useSidePanel((s) => s.view);
  const sidePanelWidth = useSidePanel((s) => s.width);

  useEffect(restoreQueue, []);
  // Downloads, offline changes and the backup run while signed in.
  useEffect(() => (session ? startOfflineServices(session) : undefined), [session?.userId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the "where was I" note on the account, and offer one from another device.
  useEffect(() => (session ? startHandoff() : undefined), [session?.userId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The live connection: take commands from other devices, and control theirs.
  useEffect(() => {
    if (!session) return undefined;
    const stops = [startSocket(), startReceiver(), startRemote()];
    return () => stops.forEach((stop) => stop());
  }, [session?.userId]); // eslint-disable-line react-hooks/exhaustive-deps
  useShortcuts();

  const pages = (
    <div className={styles.stacks}>
      {TAB_IDS.map((id) => (
        <StackView key={id} tab={id} entries={stacks[id]} visible={id === tab} renderRoute={renderRoute} />
      ))}
    </div>
  );

  // A computer: sidebar on the left, pages beside it, queue or lyrics in a
  // frame at the right, the player bar along the bottom. No full-screen player.
  if (desktop) {
    const panel = hasQueue ? sidePanel : null;
    return (
      <div
        className={styles.shell}
        data-desktop
        data-mini={hasQueue || undefined}
        data-panel={panel || undefined}
        // Never more than half the window, even if the window has shrunk since.
        style={{ '--side-panel-width': `min(${sidePanelWidth}px, 50vw)` } as CSSProperties}
      >
        <SongMenuHost />
        <NewPlaylistHost />
        <ConfirmHost />
        <ToastHost />
        <div className={styles.sidebar}>
          <Sidebar tabs={TABS} />
        </div>
        {pages}
        {panel && (
          <div className={styles.sidePanel}>
            <SidePanel view={panel} />
          </div>
        )}
        <SongDragGhost />
        <HandoffOffer />
        <TapToPlay />
        <DevicePickerHost />
        {hasQueue && (
          <div className={styles.playerBar}>
            <PlayerBar />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.shell} data-mini={hasQueue || undefined}>
      <FullPlayer />
      <SongMenuHost />
      <NewPlaylistHost />
      <ConfirmHost />
      <ToastHost />
      <MiniPlayer />
      <HandoffOffer />
      <TapToPlay />
      <DevicePickerHost />
      {pages}

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

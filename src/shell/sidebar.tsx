import { Plus, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { usePlaylists } from '@/data/queries';
import { sameRoute, TAB_IDS, useNavigation, type Route, type TabId } from '@/nav/navigation';
import { useSongDrag } from '@/songs/song-drag';
import { openNewPlaylist } from '@/songs/song-menu';
import { DownloadedCover, LikedCover, PlaylistCover } from '@/ui/covers';
import { focusSearch } from './shortcuts';
import styles from './sidebar.module.css';

/** Desktop: sections, Liked Songs, Downloaded and playlists down the left side. */
export function Sidebar({ tabs }: { tabs: Record<TabId, { label: string; icon: LucideIcon }> }) {
  const tab = useNavigation((s) => s.tab);
  const libraryTop = useNavigation((s) => s.stacks.library[s.stacks.library.length - 1].route);
  const selectTab = useNavigation((s) => s.selectTab);
  const openInLibrary = useNavigation((s) => s.openInLibrary);
  const playlists = usePlaylists().data ?? [];
  const dragging = useSongDrag((s) => s.track !== null);
  const dropTarget = useSongDrag((s) => s.target?.id);

  const isOpen = (route: Route) => tab === 'library' && sameRoute(libraryTop, route);

  return (
    <nav className={styles.sidebar} aria-label="Sections" data-dragging={dragging || undefined}>
      <div className={styles.sections}>
        {TAB_IDS.map((id) => {
          const { label, icon: Icon } = tabs[id];
          const active = id === tab;
          return (
            <button
              key={id}
              type="button"
              className={styles.section}
              data-active={active || undefined}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                selectTab(id);
                if (id === 'search') focusSearch();
              }}
              title={id === 'search' ? 'Search (Ctrl+F)' : undefined}
            >
              <Icon size={20} strokeWidth={active ? 2.3 : 2} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.divider} />

      <div className={styles.scroll}>
        <SidebarItem
          art={<LikedCover size={36} radius={6} />}
          label="Liked Songs"
          active={isOpen({ name: 'liked' })}
          onClick={() => openInLibrary({ name: 'liked' })}
          drop={{ id: 'liked', name: 'Liked Songs', over: dropTarget === 'liked' }}
        />
        <SidebarItem
          art={<DownloadedCover size={36} radius={6} />}
          label="Downloaded"
          active={isOpen({ name: 'downloaded' })}
          onClick={() => openInLibrary({ name: 'downloaded' })}
        />

        <div className={styles.heading}>
          <button type="button" className={styles.headingLink} onClick={() => openInLibrary({ name: 'playlists' })}>
            Playlists
          </button>
          <button type="button" className={styles.add} onClick={openNewPlaylist} aria-label="New playlist" title="New playlist">
            <Plus size={16} strokeWidth={2.4} />
          </button>
        </div>
        {playlists.map((playlist) => {
          const route: Route = { name: 'playlist', id: playlist.Id, title: playlist.Name };
          return (
            <SidebarItem
              key={playlist.Id}
              art={<PlaylistCover playlistId={playlist.Id} size={36} radius={6} />}
              label={playlist.Name}
              active={isOpen(route)}
              onClick={() => openInLibrary(route)}
              drop={{ id: playlist.Id, name: playlist.Name, over: dropTarget === playlist.Id }}
            />
          );
        })}
      </div>
    </nav>
  );
}

function SidebarItem({
  art,
  label,
  active,
  onClick,
  drop,
}: {
  art: ReactNode;
  label: string;
  active: boolean;
  onClick(): void;
  /** Somewhere a dragged song can be dropped: a playlist, or Liked Songs ("liked"). */
  drop?: { id: string; name: string; over: boolean };
}) {
  return (
    <button
      type="button"
      className={styles.item}
      data-active={active || undefined}
      data-drop-id={drop?.id}
      data-drop-name={drop?.name}
      data-drop-over={drop?.over || undefined}
      onClick={onClick}
      title={label}
    >
      {art}
      <span className={styles.itemLabel}>{label}</span>
    </button>
  );
}

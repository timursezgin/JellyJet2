import { Plus } from 'lucide-react';

import { useSession } from '@/auth/session';
import { useLibraryCounts, useLikedSongs } from '@/data/queries';
import { useDownloads } from '@/downloads/downloads';
import { navigate, type Route } from '@/nav/navigation';
import { DownloadedCover, LikedCover } from '@/ui/covers';
import { ItemRow } from '@/ui/item-row';
import { ListGroup, ListRow } from '@/ui/list-row';
import { Page } from '@/ui/page';
import styles from './library-screen.module.css';
import { songCount } from './playlists-screen';

type CountKey = 'playlists' | 'artists' | 'albums' | 'tracks' | 'genres';

const CATEGORIES: { label: string; count: CountKey; route: Route }[] = [
  { label: 'Playlists', count: 'playlists', route: { name: 'playlists' } },
  { label: 'Artists', count: 'artists', route: { name: 'artists' } },
  { label: 'Albums', count: 'albums', route: { name: 'albums' } },
  { label: 'Tracks', count: 'tracks', route: { name: 'tracks' } },
  { label: 'Genres', count: 'genres', route: { name: 'genres' } },
];

export function LibraryScreen() {
  const counts = useLibraryCounts().data;
  const liked = useLikedSongs().data;
  const downloadedCount = useDownloads((s) => Object.keys(s.songs).length);
  // Adding to the library is for admins who may also change it.
  const canAddAlbums = useSession((s) => s.session?.permissions.canDeleteFromLibrary ?? false);
  return (
    <Page
      title="Library"
      trailing={
        canAddAlbums && (
          <button type="button" className={styles.add} onClick={() => navigate({ name: 'add-albums' })}>
            <Plus size={15} strokeWidth={2.6} />
            Add albums
          </button>
        )
      }
    >
      <div className={styles.special}>
        <ItemRow
          art={<LikedCover size={44} />}
          title="Liked Songs"
          subtitle={liked ? songCount(liked.length) : undefined}
          onClick={() => navigate({ name: 'liked' })}
        />
        <ItemRow
          art={<DownloadedCover size={44} />}
          title="Downloaded"
          subtitle={downloadedCount ? songCount(downloadedCount) : 'Ready to play without internet'}
          onClick={() => navigate({ name: 'downloaded' })}
        />
      </div>
      <ListGroup>
        {CATEGORIES.map(({ label, count, route }) => (
          <ListRow
            key={label}
            label={label}
            value={counts ? counts[count].toLocaleString() : undefined}
            chevron
            onClick={() => navigate(route)}
          />
        ))}
      </ListGroup>
    </Page>
  );
}

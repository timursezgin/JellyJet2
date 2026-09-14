import { useLibraryCounts } from '@/data/queries';
import { navigate, type Route } from '@/nav/navigation';
import { ListGroup, ListRow } from '@/ui/list-row';
import { Page } from '@/ui/page';

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
  return (
    <Page title="Library">
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

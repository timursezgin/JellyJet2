import { useNavigation } from '@/nav/navigation';
import { ListGroup, ListRow } from '@/ui/list-row';
import { Page } from '@/ui/page';

const CATEGORIES = ['Playlists', 'Artists', 'Albums', 'Tracks', 'Genres'];

export function LibraryScreen() {
  const push = useNavigation((s) => s.push);
  return (
    <Page title="Library">
      <ListGroup>
        {CATEGORIES.map((title) => (
          <ListRow
            key={title}
            label={title}
            chevron
            onClick={() => push({ name: 'placeholder', title })}
          />
        ))}
      </ListGroup>
    </Page>
  );
}

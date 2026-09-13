import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';

export function SearchScreen() {
  return (
    <Page title="Search">
      <EmptyState title="Search your library">Searching arrives in step 3.</EmptyState>
    </Page>
  );
}

import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';

/** Stands in for library pages until step 3 builds them. */
export function PlaceholderScreen({ title }: { title: string }) {
  return (
    <Page title={title}>
      <EmptyState title={`${title} arrive in step 3`}>
        Swipe from the left edge or tap Library to go back.
      </EmptyState>
    </Page>
  );
}

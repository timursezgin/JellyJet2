import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';

export function DownloadedScreen() {
  return (
    <Page title="Downloaded">
      <EmptyState title="Nothing downloaded yet">
        Songs, albums and playlists you download will be here, ready to play without internet.
      </EmptyState>
    </Page>
  );
}

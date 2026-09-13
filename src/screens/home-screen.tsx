import { useQuery } from '@tanstack/react-query';
import { Shuffle } from 'lucide-react';

import { useClient, useSession } from '@/auth/session';
import { recentlyAddedTracks } from '@/jellyfin/api';
import { playTracks } from '@/player/player';
import { trackFromItem } from '@/player/track';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { TrackRow } from '@/ui/track-row';
import styles from './home-screen.module.css';

export function HomeScreen() {
  const serverName = useSession((s) => s.session?.serverName);
  const userId = useSession((s) => s.session?.userId);
  const client = useClient();

  // Until step 3 builds the real shelves, Home lists the newest songs so the
  // player has something to play.
  const recent = useQuery({
    queryKey: ['recently-added-tracks', userId],
    queryFn: async () => (await recentlyAddedTracks(client, userId!)).Items.map(trackFromItem),
    enabled: !!userId,
  });
  const tracks = recent.data ?? [];

  return (
    <Page
      title="Home"
      trailing={
        <span className={styles.pill}>
          <span className={styles.dot} />
          {serverName}
        </span>
      }
    >
      <div className={styles.header}>
        <h2 className="t-section-header">Recently added songs</h2>
        {tracks.length > 0 && (
          <button type="button" className={styles.shuffle} onClick={() => playTracks(tracks, 0, { shuffle: true })}>
            <Shuffle size={16} strokeWidth={2.2} />
            Shuffle
          </button>
        )}
      </div>
      {recent.isPending && <EmptyState title="Loading…" />}
      {recent.isError && <EmptyState title="Couldn’t load songs">Check the connection and reopen the app.</EmptyState>}
      {tracks.map((track, i) => (
        <TrackRow key={track.id} track={track} onPlay={() => playTracks(tracks, i)} />
      ))}
    </Page>
  );
}

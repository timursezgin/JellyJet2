import { TrackCollection } from './playlist-screen';
import { DownloadedCover } from '@/ui/covers';

/**
 * The Downloaded tab: a special playlist of every downloaded song. Downloads
 * arrive in step 5; until then it's empty.
 */
export function DownloadedScreen() {
  return (
    <TrackCollection
      title="Downloaded"
      art={<DownloadedCover size={200} />}
      query={{ data: [], isPending: false, isError: false, refetch: () => {} }}
      empty="Songs, albums and playlists you download will be here, ready to play without internet."
    />
  );
}

import { useEffect } from 'react';

import type { Track } from '@/player/track';
import { collectionKey, useDownloads, type CollectionKind } from './downloads';
import { applyTrackList } from './engine';

/**
 * While a downloaded album/playlist is open and its songs have just been
 * loaded, bring its downloads in line straight away (new songs fetched,
 * removed ones let go).
 */
export function useKeepInSync(kind: CollectionKind, id: string, tracks: Track[] | undefined) {
  const downloaded = useDownloads((s) => !!s.collections[collectionKey(kind, id)]);
  useEffect(() => {
    if (downloaded && tracks) applyTrackList(collectionKey(kind, id), tracks);
  }, [downloaded, tracks, kind, id]);
}

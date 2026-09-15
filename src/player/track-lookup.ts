import { useSession } from '@/auth/session';
import * as api from '@/jellyfin/api';
import type { ItemsResult } from '@/jellyfin/types';
import { trackFromItem, type Track } from './track';

/** Songs by id, 100 per request; ids no longer in the library are simply missing. */
export async function lookUpTracks(ids: string[]): Promise<Map<string, Track>> {
  const { client, session } = useSession.getState();
  const found = new Map<string, Track>();
  if (!client || !session) return found;
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    const result = await client.get<ItemsResult>('/Items', {
      query: { userId: session.userId, Ids: unique.slice(i, i + 100).join(','), Fields: api.TRACK_FIELDS, EnableUserData: true },
    });
    for (const item of result.Items) if (item.Type === 'Audio') found.set(item.Id, trackFromItem(item));
  }
  return found;
}

/**
 * A queue of song ids as songs, in order, with where `index` (and the song
 * position) ends up once songs that are gone are skipped: if the song that
 * was on is gone, the next one plays from its start.
 */
export async function queueFromIds(ids: string[], index: number, position: number) {
  const found = await lookUpTracks(ids);
  const tracks: Track[] = [];
  let start = -1;
  let at = position;
  ids.forEach((id, i) => {
    const track = found.get(id);
    if (!track) return;
    if (start < 0 && i >= index) {
      start = tracks.length;
      if (i !== index) at = 0;
    }
    tracks.push(track);
  });
  if (start < 0) {
    start = Math.max(0, tracks.length - 1);
    at = 0;
  }
  return { tracks, index: start, position: at };
}

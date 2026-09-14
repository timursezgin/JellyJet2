import { useSession } from '@/auth/session';
import { isOnline } from '@/connectivity/connection';
import { queryClient } from '@/data/query-client';
import * as api from '@/jellyfin/api';
import { JellyfinError } from '@/jellyfin/client';

/**
 * Changes made while offline, sent to Jellyfin once it's reachable again.
 * Saved on the phone so they survive closing the app.
 */

export type OutboxOp =
  | { kind: 'favorite'; itemId: string; value: boolean }
  | { kind: 'playlist-add'; playlistId: string; ids: string[] }
  | { kind: 'playlist-remove'; playlistId: string; entryIds: string[] }
  | { kind: 'played'; itemId: string; date: string };

const key = () => {
  const userId = useSession.getState().session?.userId;
  return userId ? `jj.outbox.${userId}` : null;
};

function read(): OutboxOp[] {
  const k = key();
  if (!k) return [];
  try {
    return JSON.parse(localStorage.getItem(k) ?? '[]') as OutboxOp[];
  } catch {
    return [];
  }
}

function write(ops: OutboxOp[]) {
  const k = key();
  if (!k) return;
  if (ops.length) localStorage.setItem(k, JSON.stringify(ops));
  else localStorage.removeItem(k);
}

export function enqueue(op: OutboxOp) {
  let ops = read();
  // Only the latest like/unlike of a song matters.
  if (op.kind === 'favorite') ops = ops.filter((o) => !(o.kind === 'favorite' && o.itemId === op.itemId));
  write([...ops, op]);
}

/** Pending like/unlike for a song, so the heart shows it before it's synced. */
export function pendingFavorites(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const op of read()) if (op.kind === 'favorite') result[op.itemId] = op.value;
  return result;
}

let flushing = false;

export async function flushOutbox() {
  const { client, session } = useSession.getState();
  if (flushing || !client || !session || !isOnline()) return;
  flushing = true;
  try {
    let ops = read();
    while (ops.length) {
      const op = ops[0];
      try {
        if (op.kind === 'favorite') await api.setFavorite(client, session.userId, op.itemId, op.value);
        else if (op.kind === 'playlist-add') await api.addToPlaylist(client, session.userId, op.playlistId, op.ids);
        else if (op.kind === 'playlist-remove') await api.removeFromPlaylist(client, op.playlistId, op.entryIds);
        else if (op.kind === 'played') {
          await client.post(`/UserPlayedItems/${op.itemId}`, { query: { userId: session.userId, datePlayed: op.date } });
        }
      } catch (error) {
        // Unreachable again: stop and keep the rest. Refused by the server
        // (e.g. the playlist was deleted): drop it and carry on.
        if (error instanceof JellyfinError && error.network) break;
      }
      ops = read().slice(1);
      write(ops);
    }
    void queryClient.invalidateQueries();
  } finally {
    flushing = false;
  }
}

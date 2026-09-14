import { create } from 'zustand';

import { useSession } from '@/auth/session';
import { isOnline } from '@/connectivity/connection';
import * as api from '@/jellyfin/api';
import type { BaseItem, ItemsResult } from '@/jellyfin/types';
import { trackFromItem } from '@/player/track';
import { collectionKey, onDownloadsChanged, useDownloads, type CollectionKind } from './downloads';
import { downloadCollection, downloadSong, syncCollection } from './engine';

/**
 * A copy of the list of downloads (not the files) on the Jellyfin account, so
 * if this phone's storage is ever cleared - or JellyJet is added to a new
 * phone - everything can be downloaded again with one tap.
 *
 * Kept in Jellyfin's per-user display preferences under this app's name.
 */

const PREFS_ID = 'jellyjet-downloads';
const CLIENT = 'JellyJet';
const KEY = 'downloads';

interface BackupData {
  v: 1;
  /** Songs downloaded on their own. */
  songs: string[];
  /** Downloaded collections and the songs removed from them by hand. */
  collections: { kind: CollectionKind; id: string; excluded: string[] }[];
}

interface BackupState {
  /** A backup found while nothing is downloaded here: offer to restore it. */
  available: BackupData | null;
  restoring: boolean;
}

export const useBackup = create<BackupState>(() => ({ available: null, restoring: false }));

type Prefs = { CustomPrefs?: Record<string, string | null> } & Record<string, unknown>;

async function readPrefs(): Promise<Prefs | null> {
  const { client, session } = useSession.getState();
  if (!client || !session) return null;
  return client.get<Prefs>(`/DisplayPreferences/${PREFS_ID}`, { query: { userId: session.userId, client: CLIENT } });
}

function currentData(): BackupData {
  const { songs, collections } = useDownloads.getState();
  return {
    v: 1,
    songs: Object.entries(songs)
      .filter(([, s]) => s.sources.includes('song'))
      .map(([id]) => id),
    collections: Object.values(collections).map((c) => ({ kind: c.kind, id: c.id, excluded: c.excluded })),
  };
}

let writeTimer: ReturnType<typeof setTimeout> | undefined;
let lastWritten = '';

async function writeBackup() {
  const { client, session } = useSession.getState();
  if (!client || !session || !isOnline() || !useDownloads.getState().loaded) return;
  const value = JSON.stringify(currentData());
  if (value === lastWritten) return;
  try {
    const prefs = (await readPrefs()) ?? {};
    await client.post(`/DisplayPreferences/${PREFS_ID}`, {
      query: { userId: session.userId, client: CLIENT },
      body: { ...prefs, Id: PREFS_ID, Client: CLIENT, CustomPrefs: { ...(prefs.CustomPrefs ?? {}), [KEY]: value } },
    });
    lastWritten = value;
  } catch {
    // Tried again on the next change or reconnect.
  }
}

export function startBackup() {
  onDownloadsChanged(() => {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => void writeBackup(), 5000);
  });
}

/** Called once downloads are loaded and the server answers. */
export async function checkBackup() {
  const { songs, collections, jobs } = useDownloads.getState();
  const empty = !Object.keys(songs).length && !Object.keys(collections).length && !jobs.length;
  try {
    const raw = (await readPrefs())?.CustomPrefs?.[KEY];
    if (!raw) {
      if (!empty) void writeBackup();
      return;
    }
    const data = JSON.parse(raw) as BackupData;
    lastWritten = empty ? '' : lastWritten;
    const hasSomething = data.songs.length > 0 || data.collections.length > 0;
    if (empty && hasSomething) useBackup.setState({ available: data });
    else if (!empty) void writeBackup();
  } catch {
    // No backup reachable right now.
  }
}

export const dismissBackup = () => useBackup.setState({ available: null });

/** Download everything the backup lists. */
export async function restoreBackup() {
  const data = useBackup.getState().available;
  const { client, session } = useSession.getState();
  if (!data || !client || !session) return;
  useBackup.setState({ restoring: true });
  try {
    // Songs downloaded on their own.
    for (let i = 0; i < data.songs.length; i += 100) {
      const ids = data.songs.slice(i, i + 100);
      const result = await client.get<ItemsResult>('/Items', {
        query: { userId: session.userId, Ids: ids.join(','), Fields: api.TRACK_FIELDS, EnableUserData: true },
      });
      for (const item of result.Items) if (item.Type === 'Audio') downloadSong(trackFromItem(item));
    }
    // Collections, with the songs removed from them kept removed.
    for (const entry of data.collections) {
      let name = 'Liked Songs';
      let art = null;
      if (entry.kind !== 'liked') {
        try {
          const item: BaseItem = await api.item(client, session.userId, entry.id);
          name = item.Name;
          art = api.artworkOf(item);
        } catch {
          continue; // deleted on the server since
        }
      }
      downloadCollection({ kind: entry.kind, id: entry.id, name, art }, []);
      const key = collectionKey(entry.kind, entry.id);
      useDownloads.setState((s) => ({
        collections: { ...s.collections, [key]: { ...s.collections[key], excluded: entry.excluded } },
      }));
      await syncCollection(key);
    }
    useBackup.setState({ available: null });
  } finally {
    useBackup.setState({ restoring: false });
  }
}

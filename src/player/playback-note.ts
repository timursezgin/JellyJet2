import type { JellyfinClient } from '@/jellyfin/client';
import type { Repeat } from './player';

/**
 * The playback note: while music plays on a device, which songs are queued,
 * which one is on and how far in, kept on the Jellyfin account (display
 * preferences under this app's name). Written by handoff.ts; read to offer
 * "Continue" on another device, and by a device following the one that plays
 * (remote.ts) to show its queue - Jellyfin's own session queue isn't kept
 * from playback reports.
 */

export const PREFS_ID = 'jellyjet-playback';
export const CLIENT = 'JellyJet';
export const KEY = 'nowPlaying';

export interface PlaybackNote {
  v: 1;
  device: string;
  deviceName: string;
  /** When the listening happened (ms since 1970). */
  at: number;
  ids: string[];
  index: number;
  position: number;
  shuffle: boolean;
  repeat: Repeat;
}

export type Prefs = { CustomPrefs?: Record<string, string | null> } & Record<string, unknown>;

/** The display preferences document, and the note in it (null if none or unreadable). */
export async function readPlaybackNote(client: JellyfinClient, userId: string): Promise<{ prefs: Prefs; note: PlaybackNote | null }> {
  const prefs = (await client.get<Prefs>(`/DisplayPreferences/${PREFS_ID}`, { query: { userId, client: CLIENT } })) ?? {};
  const raw = prefs.CustomPrefs?.[KEY];
  if (!raw) return { prefs, note: null };
  try {
    const note = JSON.parse(raw) as PlaybackNote;
    return { prefs, note: note.v === 1 && Array.isArray(note.ids) ? note : null };
  } catch {
    return { prefs, note: null };
  }
}

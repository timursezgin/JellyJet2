import { useSession } from '@/auth/session';
import { isOnline } from '@/connectivity/connection';
import { queryClient } from '@/data/query-client';
import { useDownloads } from '@/downloads/downloads';
import * as api from '@/jellyfin/api';
import type { BaseItem } from '@/jellyfin/types';
import { playTracks } from '@/player/player';
import { trackFromItem, type Track } from '@/player/track';
import { toast } from '@/ui/toast';
import { shuffle } from './generator';

/**
 * Stations on Home: Library radio (everything, shuffled), Decade radio, and
 * the Artist mix builder, whose result is a temporary list you can play or
 * save as a playlist.
 */

export interface Station {
  id: string;
  name: string;
  tracks: Track[];
}

// Built stations only live until the app closes.
const stations = new Map<string, Station>();
let counter = 0;

export function keepStation(name: string, tracks: Track[]): Station {
  const station = { id: `station-${++counter}`, name, tracks };
  stations.set(station.id, station);
  return station;
}

export const findStation = (id: string) => stations.get(id);

async function account() {
  const { client, session } = useSession.getState();
  if (!client || !session) return null;
  const parentId = await queryClient.fetchQuery({
    queryKey: ['music-library', session.userId],
    queryFn: () => api.musicLibraryId(client),
    staleTime: Infinity,
  });
  return { client, userId: session.userId, parentId };
}

const toTracks = (items: BaseItem[]) => items.filter((i) => i.Type === 'Audio').map(trackFromItem);

/** Plays a shuffled slice of the whole library (offline: all downloaded songs, shuffled). */
export async function startLibraryRadio() {
  if (!isOnline()) {
    const downloaded = Object.values(useDownloads.getState().songs).map((s) => s.track);
    if (!downloaded.length) {
      toast('Library radio needs a connection');
      return;
    }
    playTracks(shuffle(downloaded), 0, { shuffle: false });
    return;
  }
  try {
    const a = await account();
    if (!a) return;
    const tracks = toTracks((await api.randomSongs(a.client, a.userId, a.parentId, 500)).Items);
    if (!tracks.length) {
      toast('No songs to play yet');
      return;
    }
    playTracks(tracks, 0, { shuffle: false });
  } catch {
    toast('Couldn’t start Library radio');
  }
}

export const DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020];

const decadeYears = (decade: number) => Array.from({ length: 10 }, (_, i) => decade + i);

/**
 * Plays songs from a decade. Many libraries only date the album, not each
 * song, so if too few songs carry a year it uses songs from that decade's albums.
 */
export async function startDecadeRadio(decade: number) {
  const label = `the ${decade}s`;
  if (!isOnline()) {
    toast('Decade radio needs a connection');
    return;
  }
  try {
    const a = await account();
    if (!a) return;
    const years = decadeYears(decade);
    let tracks = toTracks((await api.randomSongsFromYears(a.client, a.userId, a.parentId, years, 150)).Items);
    if (tracks.length < 20) {
      const albums = (await api.randomAlbumsFromYears(a.client, a.userId, a.parentId, years, 20)).Items;
      const lists = await Promise.all(albums.map((album) => api.albumTracks(a.client, a.userId, album.Id)));
      const seen = new Set<string>();
      tracks = shuffle([...tracks, ...lists.flatMap((l) => toTracks(l.Items))])
        .filter((t) => !seen.has(t.id) && !!seen.add(t.id))
        .slice(0, 150);
    }
    if (!tracks.length) {
      toast(`Nothing from ${label} in your library`);
      return;
    }
    playTracks(tracks, 0, { shuffle: false });
  } catch {
    toast(`Couldn’t start ${label} radio`);
  }
}

/** Songs strictly by the picked artists, shuffled - nothing "similar" added. */
export async function buildArtistMix(artists: { id: string; name: string }[]): Promise<Station | null> {
  if (!isOnline()) {
    toast('Building a mix needs a connection');
    return null;
  }
  try {
    const a = await account();
    if (!a) return null;
    const pool = toTracks((await api.randomSongsByArtists(a.client, a.userId, a.parentId, artists.map((x) => x.id), 200)).Items);
    const tracks = shuffle(pool).slice(0, 80);
    if (!tracks.length) {
      toast('No songs by those artists');
      return null;
    }
    const names = artists.map((x) => x.name);
    const name =
      names.length === 1
        ? `${names[0]} Mix`
        : names.length === 2
          ? `${names[0]} & ${names[1]} Mix`
          : `${names[0]}, ${names[1]} +${names.length - 2} Mix`;
    return keepStation(name, tracks);
  } catch {
    toast('Couldn’t build the mix');
    return null;
  }
}

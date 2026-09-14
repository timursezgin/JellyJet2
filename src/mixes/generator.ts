import * as api from '@/jellyfin/api';
import type { JellyfinClient } from '@/jellyfin/client';
import type { BaseItem } from '@/jellyfin/types';
import { trackFromItem, type Track } from '@/player/track';

/**
 * "Made for you": mixes built on the phone from what the server knows about
 * your listening (play counts, last played, likes, genres, years). The same
 * recipes as the original JellyJet.
 */

export type MixKind = 'genre' | 'decade' | 'rediscover' | 'on-repeat' | 'favourites';

export interface Mix {
  id: string;
  kind: MixKind;
  name: string;
  /** Why this mix exists, in a sentence. */
  why: string;
  tracks: Track[];
}

export const MIX_KICKER: Record<MixKind, string> = {
  genre: 'Genre mix',
  decade: 'Decade mix',
  rediscover: 'Rediscover',
  'on-repeat': 'On repeat',
  favourites: 'Favourites',
};

const MIX_SIZE = 25;
const RECENT_DAYS = 90;
const HEAVY_DAYS = 30;
const REDISCOVER_DAYS = 182;
const DAY = 24 * 60 * 60 * 1000;

interface Concept {
  kind: MixKind;
  name: string;
  why: string;
  picked: BaseItem[];
  /** More candidates, to fill in songs another mix already took. */
  extra: BaseItem[];
}

const plays = (item: BaseItem) => item.UserData?.PlayCount ?? 0;
const lastPlayed = (item: BaseItem) => {
  const date = item.UserData?.LastPlayedDate;
  return date ? Date.parse(date) : undefined;
};

export async function generateMixes(client: JellyfinClient, userId: string, parentId: string | null): Promise<Mix[]> {
  const now = Date.now();
  const [played, top, favourites, oldestPlayed] = await Promise.all([
    api.playedSongs(client, userId, parentId, 3000).then((r) => r.Items),
    api.mostPlayedSongs(client, userId, parentId, 40).then((r) => r.Items),
    api.favouriteSongs(client, userId, parentId, 400).then((r) => r.Items),
    api.playedSongs(client, userId, parentId, 300, true).then((r) => r.Items),
  ]);

  const daysSince = (item: BaseItem) => {
    const at = lastPlayed(item);
    return at === undefined ? Infinity : (now - at) / DAY;
  };
  const recent = played.filter((t) => daysSince(t) <= RECENT_DAYS);
  const heavy = recent.filter((t) => daysSince(t) <= HEAVY_DAYS);
  // Not much recent listening: lean on all-time favourites instead.
  const thin = recent.length < 40;
  const basis = thin ? top : recent;
  const top3 = new Set(top.slice(0, 3).map((t) => t.Id));
  const weight = (t: BaseItem) => Math.min(50, Math.max(1, plays(t)));

  const concepts: Concept[] = [];

  // Genre mixes: your three most-played genres.
  const genreScore = new Map<string, number>();
  for (const t of basis) for (const g of t.Genres ?? []) genreScore.set(g, (genreScore.get(g) ?? 0) + weight(t));
  const topGenres = [...genreScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const genrePools = await Promise.all(
    topGenres.map(([genre]) => api.randomSongsInGenre(client, userId, parentId, genre, 60).then((r) => r.Items)),
  );
  topGenres.forEach(([genre], i) => {
    const candidates = shuffle(genrePools[i].filter((t) => !top3.has(t.Id)));
    if (candidates.length < 12) return;
    const picked = diversify(candidates, MIX_SIZE, 3);
    concepts.push({
      kind: 'genre',
      name: `${genre} Mix`,
      why: thin
        ? `${picked.length} songs from ${genre}, your most-played genre.`
        : `${picked.length} ${genre} songs, leaning on your last 90 days of listening.`,
      picked,
      extra: candidates,
    });
  });

  // Decade mixes: the decade you play most, and one you've been neglecting.
  const decadeScore = new Map<number, number>();
  for (const t of basis) {
    const year = t.ProductionYear;
    if (!year || year < 1900) continue;
    const decade = Math.floor(year / 10) * 10;
    decadeScore.set(decade, (decadeScore.get(decade) ?? 0) + weight(t));
  }
  const rankedDecades = [...decadeScore.entries()].sort((a, b) => b[1] - a[1]);
  const totalDecadeScore = [...decadeScore.values()].reduce((a, b) => a + b, 0);

  if (rankedDecades.length > 0) {
    const [dominant, dominantScore] = rankedDecades[0];
    const pool = (await api.randomSongsFromYears(client, userId, parentId, decadeYears(dominant), 60)).Items;
    if (pool.length >= 12) {
      const candidates = shuffle(pool);
      const picked = diversify(candidates, MIX_SIZE, 3);
      const share = totalDecadeScore ? dominantScore / totalDecadeScore : 0;
      concepts.push({
        kind: 'decade',
        name: decadeName(dominant),
        why:
          share >= 0.3
            ? `${shareText(share)} of your last 90 days sits in ${decadeName(dominant).replace('The', 'the')}. Here are ${picked.length} more.`
            : `${decadeName(dominant)}: ${picked.length} songs from the decade you keep coming back to.`,
        picked,
        extra: candidates,
      });
    }

    // A decade well stocked in the library but light in recent plays.
    const candidatesDecades = [...new Set([...rankedDecades.map(([d]) => d), dominant - 10, dominant + 10, dominant + 20])].filter(
      (d) => d !== dominant && d >= 1900,
    );
    const [libraryTotal, ...counts] = await Promise.all([
      api.countSongsFromYears(client, userId, parentId, Array.from({ length: 150 }, (_, i) => 1900 + i)),
      ...candidatesDecades.map((d) => api.countSongsFromYears(client, userId, parentId, decadeYears(d))),
    ]);
    let best: { decade: number; gap: number } | null = null;
    candidatesDecades.forEach((decade, i) => {
      if (counts[i] < 30 || libraryTotal === 0) return;
      const gap = counts[i] / libraryTotal - (totalDecadeScore ? (decadeScore.get(decade) ?? 0) / totalDecadeScore : 0);
      if (gap > 0.05 && (!best || gap > best.gap)) best = { decade, gap };
    });
    if (best) {
      const { decade } = best;
      const pool = (await api.randomSongsFromYears(client, userId, parentId, decadeYears(decade), 60)).Items;
      if (pool.length >= 12) {
        const candidates = shuffle(pool);
        const picked = diversify(candidates, MIX_SIZE, 3);
        concepts.push({
          kind: 'decade',
          name: decadeName(decade),
          why: `${decadeName(decade)} is big in your library but light in your recent plays. ${picked.length} songs to fix that.`,
          picked,
          extra: candidates,
        });
      }
    }
  }

  // Rediscover: played once upon a time, then left alone for six months.
  const cutoff = now - REDISCOVER_DAYS * DAY;
  const rediscover = oldestPlayed.filter((t) => plays(t) > 0 && (lastPlayed(t) ?? Infinity) < cutoff);
  if (rediscover.length >= 12) {
    const picked = shuffle(rediscover).slice(0, MIX_SIZE);
    const newest = new Date(Math.max(...picked.map((t) => lastPlayed(t) ?? 0)));
    concepts.push({
      kind: 'rediscover',
      name:
        newest.getFullYear() === new Date(now).getFullYear()
          ? `Untouched Since ${newest.toLocaleString('en-GB', { month: 'long' })}`
          : `Untouched Since ${newest.getFullYear()}`,
      why: `${picked.length} songs you played and then left alone for six months or more.`,
      picked,
      extra: rediscover,
    });
  }

  // Forgotten favourites: liked, then not played for six months.
  const forgotten = favourites.filter((t) => (lastPlayed(t) ?? -Infinity) < cutoff);
  if (forgotten.length >= 10) {
    const picked = shuffle(forgotten).slice(0, MIX_SIZE);
    concepts.push({
      kind: 'rediscover',
      name: 'Forgotten Favourites',
      why: `${picked.length} songs you liked and then stopped playing.`,
      picked,
      extra: forgotten,
    });
  }

  // On repeat: this month's most played (or all-time, if the month is quiet).
  const rotation = [...heavy].sort((a, b) => plays(b) - plays(a));
  if (rotation.length >= 15) {
    const picked = rotation.slice(0, MIX_SIZE);
    concepts.push({
      kind: 'on-repeat',
      name: 'Heavy Rotation',
      why: `Your ${picked.length} most-played songs of the last 30 days.`,
      picked,
      extra: rotation,
    });
  } else if (top.length >= 15) {
    const picked = top.slice(0, MIX_SIZE);
    concepts.push({ kind: 'on-repeat', name: 'Heavy Rotation', why: `Your ${picked.length} most-played songs.`, picked, extra: top });
  }

  // Favourites, shuffled.
  if (favourites.length >= 10) {
    const picked = shuffle(favourites).slice(0, MIX_SIZE);
    concepts.push({
      kind: 'favourites',
      name: 'Everything You’ve Liked',
      why: `${picked.length} liked songs, shuffled.`,
      picked,
      extra: favourites,
    });
  }

  return assemble(concepts, now);
}

/** Final song lists (no song in two mixes), in a varied display order. */
function assemble(concepts: Concept[], stamp: number): Mix[] {
  // Mixes with little slack choose first; genre and decade mixes have plenty
  // of candidates to fill in with.
  const priority: MixKind[] = ['on-repeat', 'rediscover', 'favourites', 'decade', 'genre'];
  const claimed = new Set<string>();
  const finished = new Map<Concept, BaseItem[]>();
  for (const concept of [...concepts].sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind))) {
    const kept: BaseItem[] = [];
    const inMix = new Set<string>();
    for (const t of [...concept.picked, ...concept.extra]) {
      if (kept.length >= MIX_SIZE) break;
      if (claimed.has(t.Id) || inMix.has(t.Id)) continue;
      inMix.add(t.Id);
      kept.push(t);
    }
    if (kept.length >= 10) {
      for (const t of kept) claimed.add(t.Id);
      finished.set(concept, kept);
    }
  }

  // Take turns by kind so the cards in view are a spread, not three genre mixes.
  const order: MixKind[] = ['genre', 'decade', 'on-repeat', 'rediscover', 'favourites'];
  const byKind = new Map<MixKind, Concept[]>();
  for (const c of concepts) if (finished.has(c)) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
  const display: Concept[] = [];
  for (let added = true; added; ) {
    added = false;
    for (const kind of order) {
      const next = byKind.get(kind)?.shift();
      if (next) {
        display.push(next);
        added = true;
      }
    }
  }
  return display.map((c, i) => ({
    id: `${c.kind}-${stamp}-${i}`,
    kind: c.kind,
    name: c.name,
    why: c.why,
    tracks: finished.get(c)!.map(trackFromItem),
  }));
}

/** Up to `n` songs with no more than `maxPerArtist` from one artist, topped up if that runs short. */
function diversify(source: BaseItem[], n: number, maxPerArtist: number) {
  const perArtist = new Map<string, number>();
  const out: BaseItem[] = [];
  for (const t of source) {
    if (out.length >= n) break;
    const artist = t.AlbumArtist ?? t.Artists?.[0] ?? '?';
    if ((perArtist.get(artist) ?? 0) >= maxPerArtist) continue;
    perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1);
    out.push(t);
  }
  for (const t of source) {
    if (out.length >= n) break;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

export function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const decadeYears = (decade: number) => Array.from({ length: 10 }, (_, i) => decade + i);
const decadeName = (decade: number) => `The ${decade}s`;
const shareText = (share: number) => (share >= 0.45 && share <= 0.55 ? 'Half' : `${Math.round(share * 100)}%`);

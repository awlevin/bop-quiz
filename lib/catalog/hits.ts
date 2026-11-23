// The draw for Difficulty mode (lib/game/setlist.ts): only the best-known
// songs of each decade. data/decade-ranks.json lists every catalog song by
// decade, most recognisable first; Easy takes the top 10 of each decade,
// Medium 20, Hard 30. Kept apart from lib/catalog/index.ts, which loads the
// whole catalog, so the host screen can count a pool without it.

import ranks from '@/data/decade-ranks.json';
import type { Song } from '@/lib/game/types';

import { primaryArtist } from './util';

const DECADE_RANKS: [number, number[]][] = Object.entries(ranks as Record<string, unknown>)
  .filter((entry): entry is [string, number[]] => /^\d{4}$/.test(entry[0]) && Array.isArray(entry[1]))
  .map(([decade, ids]) => [Number(decade), ids]);

/** Each ranked song's place within its decade: 0 for the best known. */
const RANK = new Map<number, number>(DECADE_RANKS.flatMap(([, ids]) => ids.map((id, i) => [id, i] as const)));

/** The decades, oldest first, with how many ranked songs each holds. */
export const DECADE_SIZES: readonly { decade: number; songs: number }[] = DECADE_RANKS.map(
  ([decade, ids]) => ({ decade, songs: ids.length }),
).sort((a, b) => a.decade - b.decade);

/** A song's place in its decade, 0 for the best known, or undefined when it is not ranked. */
export function decadeRank(id: number): number | undefined {
  return RANK.get(id);
}

/** How many songs the top `depth` of every decade comes to: 68 on Easy, the '60s having only 8. */
export function hitsCount(depth: number): number {
  return DECADE_SIZES.reduce((sum, d) => sum + Math.min(d.songs, depth), 0);
}

/**
 * The songs a Difficulty draw takes from: the top `depth` of every decade.
 *
 * A room that plays Easy all night would run through its 68 songs in a few
 * games, and then hear the same ones again. Rather than repeat, the pool
 * widens a rank at a time, the 11th best-known song of each decade joining,
 * then the 12th, until it holds `count` artists the room has not heard (or
 * every song). So repeats only come once the whole catalog is spent, as in
 * Classic, and the songs that join are the next easiest there are.
 */
export function hitsPool(
  songs: readonly Song[],
  depth: number,
  excludeIds: readonly number[],
  count: number,
): Song[] {
  const exclude = new Set(excludeIds);
  const ranked = songs.filter((s) => RANK.has(s.id));
  const deepest = Math.max(0, ...DECADE_SIZES.map((d) => d.songs));
  for (let d = Math.max(depth, 1); ; d++) {
    const pool = ranked.filter((s) => RANK.get(s.id)! < d);
    const artists = new Set(pool.filter((s) => !exclude.has(s.id)).map((s) => primaryArtist(s.artist)));
    if (artists.size >= count || d >= deepest) return pool;
  }
}

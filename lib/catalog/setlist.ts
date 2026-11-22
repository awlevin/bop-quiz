// The draw for Crowd picks and Host picks (lib/game/setlist.ts): songs that
// match what people asked for, every person's taste getting its turn, and
// when a pick is too narrow for a whole game, the closest songs instead.

import { ROUNDS_PER_GAME } from '@/lib/game/config';
import { decadeOf, familyOfGenre, type GenreFamily, type Taste } from '@/lib/game/setlist';
import type { Song } from '@/lib/game/types';

import { primaryArtist, shuffle } from './util';

/**
 * How far off the wrong genre is, in decades. A song in the genre someone
 * picked but a decade out sits closer than the right decade in the wrong
 * genre; two decades out, in the genre, is further than either.
 */
export const GENRE_MISS = 1.5;

/**
 * Each song's genre family. iTunes names that say nothing about the sound
 * (Soundtrack: "Lose Yourself" and "Shallow") go with the artist's other
 * songs in `songs`, and to Pop when there are none.
 */
export function familyResolver(songs: readonly Song[]): (song: Song) => GenreFamily {
  const byArtist = new Map<string, Map<GenreFamily, number>>();
  for (const song of songs) {
    const family = familyOfGenre(song.genre);
    if (!family) continue;
    const artist = primaryArtist(song.artist);
    const counts = byArtist.get(artist) ?? new Map<GenreFamily, number>();
    counts.set(family, (counts.get(family) ?? 0) + 1);
    byArtist.set(artist, counts);
  }
  return (song) => {
    const known = familyOfGenre(song.genre);
    if (known) return known;
    const counts = byArtist.get(primaryArtist(song.artist));
    return counts ? [...counts].sort((a, b) => b[1] - a[1])[0][0] : 'pop';
  };
}

/** 0 for a song the taste asked for; otherwise decades off, plus `GENRE_MISS` for the wrong genre. */
export function tasteDistance(taste: Taste, family: GenreFamily, decade: number): number {
  const genre = taste.genres.length === 0 || taste.genres.includes(family) ? 0 : GENRE_MISS;
  const decades =
    taste.decades.length === 0 ? 0 : Math.min(...taste.decades.map((d) => Math.abs(d - decade))) / 10;
  return genre + decades;
}

function pick<T>(items: readonly T[], weights: readonly number[], random: () => number): T {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Up to `count` songs from `fresh` for these tastes, no artist twice.
 *
 * Tastes take turns, and the turn always goes to the taste with the smallest
 * share so far. A song's share is split between every taste it matches (and
 * the taste whose turn it was), so four people who all want 2010s pop share
 * their songs four ways, and a lone fan of 70s soul still gets one song in
 * five: everyone gets their share, and a taste more people hold gets more
 * songs. On each turn a song is drawn with weight equal to the number of
 * tastes it matches, so the more people want it, the likelier it is.
 *
 * On its turn a taste draws from the songs closest to it (`tasteDistance`):
 * exact matches while there are any, then a neighbouring decade in the same
 * genre, and so on outwards. It stops only when every artist in `fresh` is
 * used, so the caller fills any gap from songs the room has heard.
 *
 * `songs` is the whole playable catalog, for working out genre families.
 * The game's rounds come back shuffled, so nobody's songs bunch up at one
 * end; anything past them (the spares) follows in draw order.
 */
export function drawForTastes(
  tastes: readonly Taste[],
  count: number,
  fresh: readonly Song[],
  random: () => number = Math.random,
  songs: readonly Song[] = fresh,
): Song[] {
  const familyOf = familyResolver(songs);
  const distances = new Map(
    fresh.map((s) => {
      const family = familyOf(s);
      const decade = decadeOf(s.year);
      return [s.id, tastes.map((t) => tasteDistance(t, family, decade))];
    }),
  );
  const votes = (s: Song) => distances.get(s.id)!.filter((d) => d === 0).length;

  const shares = tastes.map(() => 0);
  const picked: Song[] = [];
  const artists = new Set<string>();
  let available = fresh.slice();
  while (picked.length < count && tastes.length > 0) {
    available = available.filter((s) => !artists.has(primaryArtist(s.artist)));
    if (available.length === 0) break;

    const fewest = Math.min(...shares);
    const turns = shares.flatMap((n, i) => (n - fewest < 1e-9 ? [i] : []));
    const turn = turns[Math.floor(random() * turns.length)];
    const closest = Math.min(...available.map((s) => distances.get(s.id)![turn]));
    const options = available.filter((s) => distances.get(s.id)![turn] === closest);
    const song = pick(options, options.map((s) => Math.max(1, votes(s))), random);

    picked.push(song);
    artists.add(primaryArtist(song.artist));
    const takers = distances.get(song.id)!.flatMap((d, i) => (i === turn || d === 0 ? [i] : []));
    for (const i of takers) shares[i] += 1 / takers.length;
  }

  const rounds = Math.min(picked.length, ROUNDS_PER_GAME);
  return [...shuffle(picked.slice(0, rounds), random), ...picked.slice(rounds)];
}

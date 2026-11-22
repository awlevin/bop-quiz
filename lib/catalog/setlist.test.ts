import { describe, expect, it } from 'vitest';

import catalog from '@/data/catalog.json';
import { ROUNDS_PER_GAME, SPARE_SONGS } from '@/lib/game/config';
import { decadeOf, type Taste } from '@/lib/game/setlist';
import type { Song } from '@/lib/game/types';

import { chooseSongs } from './index';
import { drawForTastes, familyResolver, GENRE_MISS, tasteDistance } from './setlist';
import { primaryArtist } from './util';

const SONGS = catalog as Song[];
const GAME = ROUNDS_PER_GAME + SPARE_SONGS;

/** A repeatable Math.random. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextId = 1;
function song(genre: string, year: number, over: Partial<Song> = {}): Song {
  const id = nextId++;
  return {
    id,
    title: `Song ${id}`,
    artist: `Artist ${id}`,
    album: `Album ${id}`,
    year,
    genre,
    artworkUrl: '',
    previewUrl: '',
    ...over,
  };
}

const familyOf = familyResolver(SONGS);
const matches = (taste: Taste, s: Song) => tasteDistance(taste, familyOf(s), decadeOf(s.year)) === 0;

describe('genre families', () => {
  it('folds the rare iTunes genres into five families', () => {
    const byGenre = (genre: string) => familyOf(SONGS.find((s) => s.genre === genre)!);
    expect(byGenre('Hard Rock')).toBe('rock');
    expect(byGenre('New Wave')).toBe('alt');
    expect(byGenre('Indie Rock')).toBe('alt');
    expect(byGenre('Contemporary R&B')).toBe('rnb');
    expect(byGenre('Hip-Hop')).toBe('hiphop');
    expect(byGenre('Country')).toBe('pop');
    expect(byGenre('Latin')).toBe('pop');
    expect(new Set(SONGS.map(familyOf))).toEqual(new Set(['pop', 'rock', 'rnb', 'hiphop', 'alt']));
  });

  it('files a Soundtrack song with the artist’s other songs', () => {
    const lose = SONGS.find((s) => s.title === 'Lose Yourself')!;
    const shallow = SONGS.find((s) => s.title === 'Shallow')!;
    expect(lose.genre).toBe('Soundtrack');
    expect(familyOf(lose)).toBe('hiphop');
    expect(familyOf(shallow)).toBe('pop');
    expect(familyResolver([])(song('Soundtrack', 2000))).toBe('pop');
  });
});

describe('taste distance', () => {
  const taste: Taste = { genres: ['rock'], decades: [1980] };
  it('is zero for a match, decades off otherwise, and more for the wrong genre', () => {
    expect(tasteDistance(taste, 'rock', 1980)).toBe(0);
    expect(tasteDistance(taste, 'rock', 1990)).toBe(1);
    expect(tasteDistance(taste, 'pop', 1980)).toBe(GENRE_MISS);
    expect(tasteDistance(taste, 'rock', 2000)).toBe(2);
    expect(tasteDistance({ genres: ['rock'], decades: [] }, 'rock', 2020)).toBe(0);
    expect(tasteDistance({ genres: [], decades: [1960, 2000] }, 'pop', 1980)).toBe(2);
  });
});

describe('drawing for tastes', () => {
  it('draws exactly as Classic when nobody picked anything', () => {
    for (let seed = 1; seed < 20; seed++) {
      expect(chooseSongs(GAME, [], seeded(seed), SONGS, [])).toEqual(
        chooseSongs(GAME, [], seeded(seed), SONGS),
      );
    }
  });

  it('fills a narrow pick from the closest songs: next decade, then the right decade in another genre', () => {
    const exact = [song('Rock', 1981), song('Hard Rock', 1985), song('Rock', 1989)];
    const nextDecade = [song('Rock', 1991), song('Rock', 1992), song('Rock', 1993), song('Rock', 1994)];
    const sameDecade = Array.from({ length: 5 }, (_, i) => song('Pop', 1980 + i));
    const far = Array.from({ length: 20 }, (_, i) => song('Pop', 2010 + (i % 10)));
    const songs = [...far, ...sameDecade, ...nextDecade, ...exact];
    const host: Taste = { genres: ['rock'], decades: [1980] };
    for (let seed = 1; seed < 30; seed++) {
      const ids = new Set(drawForTastes([host], 10, songs, seeded(seed), songs).map((s) => s.id));
      expect(exact.every((s) => ids.has(s.id))).toBe(true);
      expect(nextDecade.every((s) => ids.has(s.id))).toBe(true);
      expect(sameDecade.filter((s) => ids.has(s.id))).toHaveLength(3);
      expect(far.some((s) => ids.has(s.id))).toBe(false);
    }
  });

  it('gives every taste its turn, not just the majority’s', () => {
    const tastes: Taste[] = [
      { genres: ['rock', 'alt'], decades: [1980, 1990] },
      { genres: ['pop'], decades: [2010, 2020] },
      { genres: ['rnb'], decades: [1960, 1970] },
    ];
    for (let seed = 1; seed < 60; seed++) {
      const rounds = chooseSongs(GAME, [], seeded(seed), SONGS, tastes).slice(0, ROUNDS_PER_GAME);
      for (const taste of tastes) {
        expect(rounds.filter((s) => matches(taste, s)).length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('gives a bigger crowd more songs, and a lone fan still their share', () => {
    const pop: Taste = { genres: ['pop'], decades: [2010] };
    const soul: Taste = { genres: ['rnb'], decades: [1960] };
    let soulSongs = 0;
    for (let seed = 1; seed < 60; seed++) {
      const rounds = chooseSongs(GAME, [], seeded(seed), SONGS, [pop, pop, pop, pop, soul]).slice(
        0,
        ROUNDS_PER_GAME,
      );
      const n = rounds.filter((s) => matches(soul, s)).length;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(3);
      expect(rounds.filter((s) => matches(pop, s)).length).toBeGreaterThanOrEqual(7);
      soulSongs += n;
    }
    expect(soulSongs / 59).toBeLessThan(3);
  });

  it('prefers the songs more people asked for', () => {
    // Two tastes that overlap on 1980s rock: those songs should come up far
    // more often than their share of either taste alone.
    const a: Taste = { genres: ['rock'], decades: [] };
    const b: Taste = { genres: [], decades: [1980] };
    const both = (s: Song) => matches(a, s) && matches(b, s);
    const pool = SONGS.filter((s) => matches(a, s) || matches(b, s));
    const baseline = pool.filter(both).length / pool.length;
    let shared = 0;
    let total = 0;
    for (let seed = 1; seed < 80; seed++) {
      const rounds = chooseSongs(GAME, [], seeded(seed), SONGS, [a, b]).slice(0, ROUNDS_PER_GAME);
      shared += rounds.filter(both).length;
      total += rounds.length;
    }
    expect(shared / total).toBeGreaterThan(baseline * 1.3);
  });

  it('keeps the old rules: no artist twice, and songs the room heard only once the rest run out', () => {
    const tastes: Taste[] = [{ genres: ['hiphop'], decades: [2000] }];
    const heardIds = SONGS.filter((s) => matches(tastes[0], s)).map((s) => s.id);
    for (let seed = 1; seed < 20; seed++) {
      const drawn = chooseSongs(GAME, heardIds, seeded(seed), SONGS, tastes);
      expect(drawn).toHaveLength(GAME);
      expect(new Set(drawn.map((s) => primaryArtist(s.artist))).size).toBe(GAME);
      expect(drawn.some((s) => heardIds.includes(s.id))).toBe(false);
    }

    // A catalog of five artists cannot fill a game without repeats or reruns:
    // it falls back exactly as Classic does, heard songs oldest first.
    const tiny = Array.from({ length: 5 }, (_, i) => song('Rock', 1980 + i, { artist: `Band ${i}` }));
    const drawn = chooseSongs(8, [tiny[3].id, tiny[4].id], seeded(1), tiny, tastes);
    expect(drawn).toHaveLength(5);
    expect(drawn.slice(0, 3).map((s) => s.id).sort()).toEqual([tiny[0].id, tiny[1].id, tiny[2].id].sort());
    expect(drawn.slice(3).map((s) => s.id)).toEqual([tiny[3].id, tiny[4].id]);
  });

  it('leaves benched songs out: it only draws from the songs it is given', () => {
    const taste: Taste = { genres: ['rnb'], decades: [1960] };
    const benched = new Set(SONGS.filter((s) => matches(taste, s)).slice(0, 3).map((s) => s.id));
    const playable = SONGS.filter((s) => !benched.has(s.id));
    const drawn = chooseSongs(GAME, [], seeded(7), playable, [taste]);
    expect(drawn.some((s) => benched.has(s.id))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import catalog from '@/data/catalog.json';
import ranks from '@/data/decade-ranks.json';
import { decadeOf } from '@/lib/game/setlist';
import type { Song } from '@/lib/game/types';

import { decadeRank, hitsCount, hitsPool } from './hits';
import { drawGame } from './preview';
import { primaryArtist } from './util';

const SONGS = catalog as Song[];
const RANKS = Object.entries(ranks).filter(([key]) => /^\d{4}$/.test(key)) as [string, number[]][];

describe('decade rankings', () => {
  it('rank every catalog song exactly once, in its own decade', () => {
    const ranked = RANKS.flatMap(([, ids]) => ids);
    expect(new Set(ranked).size).toBe(ranked.length);
    expect(ranked.sort()).toEqual(SONGS.map((s) => s.id).sort());
    for (const [decade, ids] of RANKS) {
      for (const id of ids) expect(decadeOf(SONGS.find((s) => s.id === id)!.year)).toBe(Number(decade));
    }
  });

  it('count the top N of each decade, short decades and all', () => {
    const sizes = RANKS.map(([, ids]) => ids.length);
    for (const depth of [1, 10, 20, 30, 50]) {
      expect(hitsCount(depth)).toBe(sizes.reduce((sum, n) => sum + Math.min(n, depth), 0));
    }
    expect(hitsCount(50)).toBe(SONGS.length);
  });
});

describe('Difficulty pool', () => {
  it('takes only the top N songs of each decade', () => {
    const pool = hitsPool(SONGS, 10, [], 13);
    expect(pool).toHaveLength(hitsCount(10));
    expect(pool.every((s) => decadeRank(s.id)! < 10)).toBe(true);
    const decades = new Set(pool.map((s) => decadeOf(s.year)));
    expect([...decades].sort()).toEqual([1960, 1970, 1980, 1990, 2000, 2010, 2020]);
    expect(hitsPool(SONGS, 30, [], 13)).toHaveLength(hitsCount(30));
  });

  it('widens a rank at a time once the room has heard the top songs, rather than repeat them', () => {
    const easy = hitsPool(SONGS, 10, [], 13);
    const heard = easy.map((s) => s.id);
    const wider = hitsPool(SONGS, 10, heard, 13);
    const fresh = wider.filter((s) => !heard.includes(s.id));
    expect(new Set(fresh.map((s) => primaryArtist(s.artist))).size).toBeGreaterThanOrEqual(13);
    // The next easiest songs join, not the deep cuts.
    expect(Math.max(...wider.map((s) => decadeRank(s.id)!))).toBeLessThan(20);
  });

  it('stretches a depth too small for a game until it can fill one', () => {
    const pool = hitsPool(SONGS, 1, [], 13);
    expect(new Set(pool.map((s) => primaryArtist(s.artist))).size).toBeGreaterThanOrEqual(13);
  });

  it('is what the shuffle preview draws Easy from', async () => {
    const draw = await drawGame('hits');
    expect(draw.mode).toBe('hits');
    for (const round of draw.rounds) expect(decadeRank(round.song.id)).toBeLessThan(10);
  });
});

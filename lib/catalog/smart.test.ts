import { describe, expect, it } from 'vitest';

import catalog from '@/data/catalog.json';
import { seeded } from '@/lib/game/smart';
import type { Song } from '@/lib/game/types';

import { decadeRank } from './hits';
import { drawGame } from './preview';
import { MAX_POOL, MIN_POOL, poolSize, smartPool } from './smart';
import { primaryArtist } from './util';

const SONGS = catalog as Song[];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('the Smart pool', () => {
  it('holds three songs a round, within bounds', () => {
    expect(poolSize(10)).toBe(MIN_POOL);
    expect(poolSize(20)).toBe(60);
    expect(poolSize(40)).toBe(MAX_POOL);
  });

  it('draws no artist twice, and nothing the room has heard while fresh songs remain', () => {
    const heard = SONGS.slice(0, 50).map((s) => s.id);
    const pool = smartPool(SONGS, heard, 10, seeded(1));
    expect(pool).toHaveLength(MIN_POOL);
    const artists = pool.map((c) => primaryArtist(c.song.artist));
    expect(new Set(artists).size).toBe(artists.length);
    expect(pool.some((c) => heard.includes(c.song.id))).toBe(false);
  });

  it('leans toward the best-known songs, with deep cuts still in reach', () => {
    const catalogRank = mean(SONGS.map((s) => decadeRank(s.id)!));
    const poolRanks = Array.from({ length: 20 }, (_, seed) =>
      smartPool(SONGS, [], 10, seeded(seed)).map((c) => decadeRank(c.song.id)!),
    );
    expect(mean(poolRanks.map(mean))).toBeLessThan(catalogRank - 3);
    expect(Math.max(...poolRanks.flat())).toBeGreaterThan(25);
  });

  it('orders easier songs as easier', () => {
    const pool = smartPool(SONGS, [], 10, seeded(2));
    for (const a of pool) {
      for (const b of pool) {
        if (decadeRank(a.song.id)! < decadeRank(b.song.id)!) expect(a.difficulty).toBeLessThan(b.difficulty);
      }
    }
  });

  it('brings back the songs heard longest ago once the catalog runs dry', () => {
    const heard = SONGS.map((s) => s.id);
    const pool = smartPool(SONGS, heard, 10, seeded(3));
    expect(pool).toHaveLength(MIN_POOL);
    expect(pool[0].song.id).toBe(heard[0]);
  });

  it('previews on /shuffle as a full game', async () => {
    const draw = await drawGame('smart');
    expect(draw.mode).toBe('smart');
    expect(draw.rounds).toHaveLength(10);
    expect(draw.rounds.every((r) => r.song)).toBe(true);
    expect(draw.spares).toHaveLength(3);
    // It opens with a song nearly everyone knows.
    expect(decadeRank(draw.rounds[0].song.id)).toBeLessThan(6);
  });
});

import { describe, expect, it } from 'vitest';

import { GUESS_MS, ROUND_KINDS } from './config';
import {
  cleanFormat,
  DEFAULT_FORMAT,
  describeFormat,
  guessMsFor,
  isDefaultFormat,
  roundCount,
  roundGuessMs,
  roundKinds,
} from './format';

describe('game format', () => {
  it('plays the game as it always was by default', () => {
    expect(roundKinds(DEFAULT_FORMAT)).toEqual(ROUND_KINDS);
    expect(roundCount(DEFAULT_FORMAT)).toBe(10);
    expect(guessMsFor(DEFAULT_FORMAT.plays)).toBe(GUESS_MS);
    expect(isDefaultFormat(DEFAULT_FORMAT)).toBe(true);
  });

  it('lays rounds out easiest first, skipping a kind with none', () => {
    const format = { counts: { title: 1, artist: 0, year: 2, album: 1 }, plays: 1 };
    expect(roundKinds(format)).toEqual(['title', 'year', 'year', 'album']);
    expect(roundCount(format)).toBe(4);
  });

  it('makes the window one clip long per play', () => {
    expect(guessMsFor(2)).toBe(2 * GUESS_MS);
    expect(guessMsFor(3)).toBe(3 * GUESS_MS);
    expect(guessMsFor(9)).toBe(3 * GUESS_MS);
    expect(roundGuessMs({ plays: 2 })).toBe(2 * GUESS_MS);
    // A round from before formats played once.
    expect(roundGuessMs({})).toBe(GUESS_MS);
  });

  it('cleans untrusted input, rounding every number into range', () => {
    expect(
      cleanFormat({ counts: { title: 12, artist: -3, year: 2.4, album: 1, extra: 5 }, plays: 7 }),
    ).toEqual({ counts: { title: 10, artist: 0, year: 2, album: 1 }, plays: 3 });
    expect(cleanFormat({ counts: { title: 1, artist: 0, year: 0, album: 0 }, plays: 0 })).toEqual({
      counts: { title: 1, artist: 0, year: 0, album: 0 },
      plays: 1,
    });
  });

  it('refuses what is not a format, or one with no rounds', () => {
    expect(cleanFormat(null)).toBeNull();
    expect(cleanFormat('3/3/2/2')).toBeNull();
    expect(cleanFormat({ counts: { title: 3, artist: 3, year: 2 }, plays: 1 })).toBeNull();
    expect(cleanFormat({ counts: { title: '3', artist: 3, year: 2, album: 2 }, plays: 1 })).toBeNull();
    expect(cleanFormat({ counts: { title: 3, artist: 3, year: 2, album: 2 }, plays: Number.NaN })).toBeNull();
    expect(cleanFormat({ counts: { title: 0, artist: 0, year: 0, album: 0 }, plays: 2 })).toBeNull();
  });

  it('describes itself in one line', () => {
    expect(describeFormat({ counts: { title: 4, artist: 4, year: 2, album: 2 }, plays: 2 })).toBe(
      '12 songs · 4 title, 4 artist, 2 year, 2 album · each plays twice',
    );
    expect(describeFormat({ counts: { title: 1, artist: 0, year: 0, album: 0 }, plays: 1 })).toBe(
      '1 song · 1 title',
    );
  });
});

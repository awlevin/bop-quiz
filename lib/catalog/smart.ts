// The candidates for a Smart game (lib/game/smart.ts). The reducer chooses
// each round's song from them as the game goes, so they are drawn at Start
// and stored in the room: enough to choose from at every level, few enough
// that the room stays a small thing to store and one iTunes lookup refreshes
// them all.
//
// The easy end matters most. A room that is stuck, and every year and album
// round, wants the best-known songs, so the draw leans toward them: a
// decade's top song is twice as likely to be in the pool as its 12th, and
// four times as likely as its 36th. Deeper cuts still turn up for a room on
// a roll.

import { difficultyOfRank, type SmartCandidate } from '@/lib/game/smart';
import type { Song } from '@/lib/game/types';

import { decadeRank } from './hits';
import { primaryArtist } from './util';

export const MIN_POOL = 40;
export const MAX_POOL = 80;

/** Three candidates a round, but never fewer than MIN_POOL, so short games still have a spread. */
export function poolSize(rounds: number): number {
  return Math.min(Math.max(rounds * 3, MIN_POOL), MAX_POOL);
}

/** How much likelier a well-known song is to make the pool: halves by rank EASE. */
const EASE = 12;
const UNRANKED = 25;

function weight(song: Song): number {
  return 1 / (1 + (decadeRank(song.id) ?? UNRANKED) / EASE);
}

/**
 * Candidates for a game of `rounds` rounds, no artist twice. Songs this room
 * has not heard come first, drawn leaning toward the best known (weighted
 * sampling without replacement); only when those run out do heard ones join,
 * the longest ago first. `excludeIds` is oldest first.
 */
export function smartPool(
  songs: readonly Song[],
  excludeIds: readonly number[],
  rounds: number,
  random: () => number = Math.random,
): SmartCandidate[] {
  const size = poolSize(rounds);
  const exclude = new Set(excludeIds);
  const lastHeard = new Map(excludeIds.map((id, i) => [id, i]));
  // Efraimidis–Spirakis: each song's key is u^(1/w), and the biggest keys win.
  const fresh = songs
    .filter((s) => !exclude.has(s.id))
    .map((song) => ({ song, key: Math.pow(random(), 1 / weight(song)) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.song);
  const heard = songs
    .filter((s) => exclude.has(s.id))
    .sort((a, b) => lastHeard.get(a.id)! - lastHeard.get(b.id)!);

  const picked: Song[] = [];
  const repeats: Song[] = [];
  const artists = new Set<string>();
  for (const song of [...fresh, ...heard]) {
    if (picked.length === size) break;
    const artist = primaryArtist(song.artist);
    if (artists.has(artist)) {
      repeats.push(song);
      continue;
    }
    artists.add(artist);
    picked.push(song);
  }
  return [...picked, ...repeats]
    .slice(0, size)
    .map((song) => ({ song, difficulty: difficultyOfRank(decadeRank(song.id)) }));
}

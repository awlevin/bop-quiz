// One game's worth of songs, laid out the way a room would play them, for
// the shuffle preview page. It draws through `drawSongs` so what it shows is
// what pressing Start would have produced.

import { ROUND_KINDS, ROUNDS_PER_GAME, SPARE_SONGS } from '@/lib/game/config';
import { DEFAULT_DEPTH, type GenreFamily, type SetlistMode, type Taste } from '@/lib/game/setlist';
import type { QuestionKind, Song } from '@/lib/game/types';

import { drawSongs, songFamily } from './index';

export interface DrawnRound {
  kind: QuestionKind;
  song: Song;
}

/** Made-up picks, so the page can show what each setlist mode draws. */
export const SAMPLE_PICKS: Record<SetlistMode, { who: string; taste: Taste }[]> = {
  classic: [],
  crowd: [
    { who: 'Ana', taste: { genres: ['rock', 'alt'], decades: [1980, 1990] } },
    { who: 'Ben', taste: { genres: ['pop'], decades: [2010, 2020] } },
    { who: 'Cy', taste: { genres: ['rnb'], decades: [1960, 1970] } },
  ],
  host: [{ who: 'The host', taste: { genres: ['hiphop'], decades: [1990, 2000] } }],
  hits: [],
};

/** The depth the page draws Difficulty mode at: Easy. */
export const SAMPLE_DEPTH = DEFAULT_DEPTH;

export interface GameDraw {
  /** In playing order, each with the question it would have asked. */
  rounds: DrawnRound[];
  /** In the order they would be swapped in, should a preview refuse to play. */
  spares: Song[];
  /** In the order they would play over the final scores. */
  finales: Song[];
  /** The setlist mode drawn for, and the sample picks it followed. */
  mode: SetlistMode;
  picks: { who: string; taste: Taste }[];
  /** Each drawn song's genre family, by id. */
  families: Record<number, GenreFamily>;
  drawnAt: number;
}

export function layOut(
  songs: Song[],
  finales: Song[],
  drawnAt: number,
  mode: SetlistMode = 'classic',
): GameDraw {
  return {
    rounds: ROUND_KINDS.map((kind, i) => ({ kind, song: songs[i] })),
    spares: songs.slice(ROUNDS_PER_GAME),
    finales,
    mode,
    picks: SAMPLE_PICKS[mode],
    families: Object.fromEntries(songs.map((s) => [s.id, songFamily(s)])),
    drawnAt,
  };
}

/** A fresh room's first game: nothing heard yet, no finale to avoid. */
export async function drawGame(mode: SetlistMode = 'classic'): Promise<GameDraw> {
  const tastes = SAMPLE_PICKS[mode].map((p) => p.taste);
  const depth = mode === 'hits' ? SAMPLE_DEPTH : null;
  const { songs, finales } = await drawSongs(ROUNDS_PER_GAME + SPARE_SONGS, [], undefined, tastes, depth);
  return layOut(songs, finales, Date.now(), mode);
}

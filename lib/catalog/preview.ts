// One game's worth of songs, laid out the way a room would play them, for
// the shuffle preview page. It draws through `drawSongs` so what it shows is
// what pressing Start would have produced. Smart mode lays out how a fresh
// room's game would open, if every song went as planned; in a real game each
// song after the first is chosen again at the reveal before it.

import { ROUND_KINDS, ROUNDS_PER_GAME, SPARE_SONGS } from '@/lib/game/config';
import { DEFAULT_DEPTH, type GenreFamily, type SetlistMode, type Taste } from '@/lib/game/setlist';
import { beginSmart, planRest } from '@/lib/game/smart';
import type { QuestionKind, Song } from '@/lib/game/types';

import { drawSmart, drawSongs, songFamily } from './index';

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
  smart: [],
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
  if (mode === 'smart') return drawSmartGame();
  const tastes = SAMPLE_PICKS[mode].map((p) => p.taste);
  const depth = mode === 'hits' ? SAMPLE_DEPTH : null;
  const { songs, finales } = await drawSongs(
    ROUNDS_PER_GAME + SPARE_SONGS,
    [],
    undefined,
    tastes,
    ROUNDS_PER_GAME,
    depth,
  );
  return layOut(songs, finales, Date.now(), mode);
}

/** Smart mode's opening plan for a fresh room, with the pool's next few candidates as the spares. */
async function drawSmartGame(): Promise<GameDraw> {
  const { pool, finales } = await drawSmart(ROUNDS_PER_GAME, []);
  const smart = beginSmart(undefined, pool, Math.floor(Math.random() * 2 ** 32));
  const songs = planRest(smart, ROUND_KINDS, [])?.songs ?? [];
  const planned = new Set(songs.map((s) => s.id));
  const spares = pool.filter((c) => !planned.has(c.song.id)).slice(0, SPARE_SONGS);
  return layOut([...songs, ...spares.map((c) => c.song)], finales, Date.now(), 'smart');
}

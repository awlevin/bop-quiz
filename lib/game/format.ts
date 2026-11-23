// The game's format: how many rounds of each kind of question, and how many
// times each song plays. The host picks it in the settings menu; like the
// setlist, it is copied into the room between games, because a phone can
// press Start too. Rooms from before formats play the default.

import { GUESS_MS } from './config';
import type { QuestionKind, Round } from './types';

export interface GameFormat {
  /** Rounds of each kind. They always run in this order: title, artist, year, album. */
  counts: Record<QuestionKind, number>;
  /** How many times each round's clip is heard. The guessing window is this many clips long. */
  plays: number;
}

/** Easiest attribute first, hardest last. */
export const FORMAT_KINDS: readonly QuestionKind[] = ['title', 'artist', 'year', 'album'];

export const MAX_PER_KIND = 10;
export const MAX_PLAYS = 3;

/** Three title, three artist, two year, two album, each played once: the game as it always was. */
export const DEFAULT_FORMAT: GameFormat = {
  counts: { title: 3, artist: 3, year: 2, album: 2 },
  plays: 1,
};

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(Math.round(n), min), max);

/**
 * A format from untrusted input, with every number rounded into range. Null
 * when it is not a format at all, or would have no rounds.
 */
export function cleanFormat(raw: unknown): GameFormat | null {
  if (!raw || typeof raw !== 'object') return null;
  const { counts, plays } = raw as { counts?: unknown; plays?: unknown };
  if (!counts || typeof counts !== 'object' || typeof plays !== 'number' || !Number.isFinite(plays)) {
    return null;
  }
  const clean = {} as Record<QuestionKind, number>;
  for (const kind of FORMAT_KINDS) {
    const n = (counts as Record<string, unknown>)[kind];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    clean[kind] = clamp(n, 0, MAX_PER_KIND);
  }
  const format = { counts: clean, plays: clamp(plays, 1, MAX_PLAYS) };
  return roundCount(format) > 0 ? format : null;
}

export function roundCount(format: GameFormat): number {
  return FORMAT_KINDS.reduce((sum, kind) => sum + format.counts[kind], 0);
}

/** One entry per round, in playing order. */
export function roundKinds(format: GameFormat): QuestionKind[] {
  return FORMAT_KINDS.flatMap((kind) => Array<QuestionKind>(format.counts[kind]).fill(kind));
}

/** How long players have to answer when the clip plays `plays` times. */
export function guessMsFor(plays: number): number {
  return GUESS_MS * clamp(plays, 1, MAX_PLAYS);
}

/** A round's guessing window. Rounds from before formats played once. */
export function roundGuessMs(round: Pick<Round, 'plays'>): number {
  return guessMsFor(round.plays ?? 1);
}

export function sameFormat(a: GameFormat, b: GameFormat): boolean {
  return a.plays === b.plays && FORMAT_KINDS.every((kind) => a.counts[kind] === b.counts[kind]);
}

export function isDefaultFormat(format: GameFormat): boolean {
  return sameFormat(format, DEFAULT_FORMAT);
}

const TIMES = ['once', 'twice', 'three times'];

/** "twice" */
export function timesLabel(plays: number): string {
  return TIMES[clamp(plays, 1, MAX_PLAYS) - 1];
}

/** "12 songs · 4 title, 4 artist, 2 year, 2 album · each plays twice". Playing once goes without saying. */
export function describeFormat(format: GameFormat): string {
  const total = roundCount(format);
  const kinds = FORMAT_KINDS.filter((kind) => format.counts[kind] > 0)
    .map((kind) => `${format.counts[kind]} ${kind}`)
    .join(', ');
  const parts = [`${total} ${total === 1 ? 'song' : 'songs'}`, kinds];
  if (format.plays > 1) parts.push(`each plays ${timesLabel(format.plays)}`);
  return parts.join(' · ');
}

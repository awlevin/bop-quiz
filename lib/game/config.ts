import type { QuestionKind } from './types';

/** How long players have to answer once the audio starts. */
export const GUESS_MS = 15_000;
/** How long the reveal lasts before the next song starts on its own. */
export const REVEAL_MS = 15_000;
/** Network slack: an answer stamped this far past the deadline still counts. */
export const ANSWER_GRACE_MS = 300;

/** Easiest attribute first, hardest last. One entry per round. */
export const ROUND_KINDS: readonly QuestionKind[] = [
  'title',
  'title',
  'title',
  'artist',
  'artist',
  'artist',
  'year',
  'year',
  'album',
  'album',
];

export const ROUNDS_PER_GAME = ROUND_KINDS.length;
export const SPARE_SONGS = 3;

export const MAX_PLAYERS = 12;
export const MAX_NAME_LENGTH = 14;
export const MAX_ANSWER_LENGTH = 80;

export const MAX_POINTS = 1000;
export const MIN_POINTS = 500;

/** Folding is a bet that nobody gets the song: it pays this when the room is stumped. */
export const STUMPER_POINTS = 300;
/** Ride along (a house rule, off by default): a folder takes this share of their pick's points. */
export const RIDE_SHARE = 0.25;

/** Folded players heckle from their phones; one per player this often, at most. */
export const HECKLE_COOLDOWN_MS = 700;
/** And no more than this many in one round, so a round stays a small thing to store. */
export const MAX_HECKLES_PER_ROUND = 80;
/** How long one heckle stays on the television. */
export const HECKLE_MS = 2600;

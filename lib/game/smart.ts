// Smart setlist mode: a setlist that reads the room as it plays.
//
// The idea comes from adaptive practice systems (Pelánek's Elo for students
// and items, Klinkenberg's Math Garden). Treat each round as a match between
// the room and the song. The room has a skill and each song a difficulty, on
// the same logistic scale, and the chance that the room gets a song is
//
//   P = σ(skill − difficulty − KIND_OFFSET[kind])
//
// After each reveal the room's skill moves by K × (what the room scored −
// what P expected). A room that is stuck slides down and gets easier songs;
// a room that is cruising climbs and gets deeper cuts.
//
// A song's difficulty starts from its rank in data/decade-ranks.json (the
// best-known song of a decade is the easiest). The catalog side draws the
// candidates (lib/catalog/smart.ts). Everything here is pure, so the reducer
// can plan each next song itself at the reveal.
//
// The target is not a fixed number. Each round aims at a chance of success
// drawn around TARGET_MEAN, as Math Garden does, and a small schedule shapes
// it into something that feels good to play:
//   - Warm up: the first song is one nearly everyone knows.
//   - Gimmes: now and then, at random, a banger everyone sings along to. An
//     unpredictable reward lands harder than a regular one, and no two come
//     in a row.
//   - Pity timer: after STUMPED_STREAK rounds that nearly nobody got, the next
//     one is a gimme for sure, so a drought never runs long (Dota's critical
//     hits work the same way).
//   - Stretch: after CRUISING_STREAK rounds that nearly everybody got, the next
//     reaches a little.
//   - Finale: the last song is easy too, so the game ends on a high (the
//     peak-end rule).

import { primaryArtist } from '@/lib/catalog/util';

import { yearShare } from './score';
import type { Player, QuestionKind, Round, Song } from './types';

/** A song the planner may choose, with how hard it is on the skill scale. */
export interface SmartCandidate {
  song: Song;
  difficulty: number;
}

export interface SmartState {
  /** The room's skill, on the same scale as a song's difficulty. Carries over between games. */
  skill: number;
  /** How many rounds the skill has learned from. The step shrinks as it grows. */
  seen: number;
  /** This game's candidates. Emptied when the game ends. */
  pool: SmartCandidate[];
  /** For each round played this game, the share of the room that got it, 0 to 1. */
  credits: number[];
  /** For each round planned this game, the chance of success it aimed at. */
  targets: number[];
  /** Seeds this game's random choices, so a replay of the same state plans the same songs. */
  seed: number;
}

// ---------------------------------------------------------------------------
// The model

/**
 * How much harder each kind of question is than naming the title. Year
 * rounds earn partial credit for a near miss, which softens them. Album
 * rounds are the hard ones: the planner gives them the best-known songs.
 */
export const KIND_OFFSET: Record<QuestionKind, number> = {
  title: 0,
  artist: 0.2,
  year: 1.4,
  album: 1.8,
};

/** A decade's best-known song: about 90% of a fresh room names it. */
const EASIEST = -2.2;
const RANK_STEP = 0.45;
/** Where a song with no rank sits: about the 25th best known of its decade. */
const UNRANKED = 25;

/**
 * A song's difficulty from its place in its decade (0 for the best known).
 * The gaps shrink further down the list: the 2nd and 5th best-known songs
 * differ more than the 32nd and 35th. For a fresh room naming the title:
 * rank 0 → 90%, 10 → 70%, 20 → 57%, 30 → 46%.
 */
export function difficultyOfRank(rank: number | undefined): number {
  return EASIEST + RANK_STEP * Math.sqrt(Math.max(rank ?? UNRANKED, 0));
}

export const DEFAULT_DIFFICULTY = difficultyOfRank(undefined);

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

/** The chance the room gets this song, asked this way. */
export function predict(skill: number, difficulty: number, kind: QuestionKind): number {
  return sigmoid(skill - difficulty - KIND_OFFSET[kind]);
}

/** A fresh room's skill, and how far it may drift either way. */
const START_SKILL = 0;
const MAX_SKILL = 4;
/** The step: big while the room is new, settling as it learns. */
const K_START = 1.6;
const K_MIN = 0.5;
/** Between games a room keeps this share of its skill, since the crowd may have changed. */
const CARRY = 0.75;
/** And the step opens up again, as if it had seen only this many rounds. */
const SEEN_CARRIED = 3;

export function stepSize(seen: number): number {
  return K_MIN + (K_START - K_MIN) / (1 + seen / 5);
}

/** Elo's update: move toward what happened, by how surprising it was. */
export function updateSkill(skill: number, seen: number, credit: number, expected: number): number {
  const next = skill + stepSize(seen) * (credit - expected);
  return Math.min(Math.max(next, -MAX_SKILL), MAX_SKILL);
}

/**
 * How much of the room got this round, 0 to 1. A right answer counts 1, a
 * year counts by how close it was (the score's own bell curve), and a
 * give-up, a miss or no answer counts 0. Null with nobody in the room.
 */
export function roundCredit(round: Round, players: readonly Player[]): number | null {
  if (players.length === 0) return null;
  let total = 0;
  for (const p of players) {
    const a = round.answers[p.id];
    if (!a || a.gaveUp) continue;
    if (round.kind === 'year') total += a.yearsOff === undefined ? 0 : yearShare(a.yearsOff);
    else if (a.correct) total += 1;
  }
  return total / players.length;
}

// ---------------------------------------------------------------------------
// The schedule

export const TARGET_MEAN = 0.72;
const TARGET_SD = 0.08;
const TARGET_MIN = 0.55;
const TARGET_MAX = 0.88;
/** A warm-up, gimme or finale aims here. */
export const GIMME = 0.92;
export const WARM_UP = 0.86;
export const FINALE = 0.86;
/** A stretch, after a run of easy ones. */
export const STRETCH = 0.45;
/** How often a gimme turns up out of the blue. */
const GIMME_CHANCE = 1 / 6;
/** A round this few got counts as stumping the room; this many got, as cruising. */
const STUMPED = 0.25;
const CRUISING = 0.85;
export const STUMPED_STREAK = 2;
export const CRUISING_STREAK = 2;
/** One stumper nudges the next target up by this much. */
const AFTER_STUMPER = 0.08;

function trailing(credits: readonly number[], test: (c: number) => boolean): number {
  let n = 0;
  for (let i = credits.length - 1; i >= 0 && test(credits[i]); i--) n++;
  return n;
}

/** A normal draw (Box–Muller). */
function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/**
 * The chance of success round `index` should aim at, given how the rounds so
 * far went (`credits`) and what they aimed at (`targets`).
 */
export function targetFor(
  index: number,
  total: number,
  credits: readonly number[],
  targets: readonly number[],
  random: () => number,
): number {
  if (index === 0) return WARM_UP;
  if (index === total - 1 && total > 2) return FINALE;
  const stumped = trailing(credits, (c) => c < STUMPED);
  if (stumped >= STUMPED_STREAK) return GIMME;
  if (trailing(credits, (c) => c >= CRUISING) >= CRUISING_STREAK) return STRETCH;
  const lastWasGimme = (targets[index - 1] ?? 0) >= GIMME;
  // Drawn every time, so the dice roll the same way whatever else happened.
  const surprise = random() < GIMME_CHANCE;
  if (surprise && !lastWasGimme) return GIMME;
  const target = TARGET_MEAN + TARGET_SD * gaussian(random) + (stumped ? AFTER_STUMPER : 0);
  return Math.min(Math.max(target, TARGET_MIN), TARGET_MAX);
}

// ---------------------------------------------------------------------------
// The pick

/** How tightly a pick hugs its target, in logits. Loose enough that two games differ. */
const SPREAD = 0.4;

/**
 * One of `candidates` for this round: the closer its chance of success to
 * the target, the likelier, on a bell curve in logits.
 */
export function chooseCandidate(
  candidates: readonly SmartCandidate[],
  kind: QuestionKind,
  skill: number,
  target: number,
  random: () => number,
): SmartCandidate | undefined {
  if (candidates.length === 0) return undefined;
  const aim = logit(target);
  const gaps = candidates.map((c) => skill - c.difficulty - KIND_OFFSET[kind] - aim);
  // Measured from the nearest, so a target out of reach still picks the nearest songs.
  const nearest = Math.min(...gaps.map((g) => g * g));
  const weights = gaps.map((g) => Math.exp(-(g * g - nearest) / (2 * SPREAD * SPREAD)));
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = random() * sum;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r < 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** A small seeded generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The dice for planning round `index`: the same for the same game and round. */
function diceFor(seed: number, index: number): () => number {
  return seeded(seed ^ Math.imul(index + 1, 0x9e3779b1));
}

/**
 * Songs for every round from `played.length` on, with the target each aimed
 * at. `played` are the songs of the rounds already heard, in order; their
 * songs and artists are not chosen again. Rounds after the next are only a
 * sketch, planned as if every round hit its target: each is planned again,
 * with what the room did, when the round before it reveals.
 *
 * Null when the pool has nothing left to offer.
 */
export function planRest(
  smart: SmartState,
  kinds: readonly QuestionKind[],
  played: readonly Song[],
): { songs: Song[]; targets: number[] } | null {
  const taken = new Set(played.map((s) => s.id));
  const artists = new Set(played.map((s) => primaryArtist(s.artist)));
  const credits = smart.credits.slice(0, played.length);
  const targets = smart.targets.slice(0, played.length);
  const songs: Song[] = [];
  for (let i = played.length; i < kinds.length; i++) {
    const random = diceFor(smart.seed, i);
    const target = targetFor(i, kinds.length, credits, targets, random);
    const open = smart.pool.filter((c) => !taken.has(c.song.id));
    const fresh = open.filter((c) => !artists.has(primaryArtist(c.song.artist)));
    const pick = chooseCandidate(fresh.length ? fresh : open, kinds[i], smart.skill, target, random);
    if (!pick) return null;
    songs.push(pick.song);
    taken.add(pick.song.id);
    artists.add(primaryArtist(pick.song.artist));
    targets.push(target);
    credits.push(target);
  }
  return { songs, targets };
}

/** A game's smart state: last game's skill, eased back a little, and a new pool. */
export function beginSmart(prior: SmartState | undefined, pool: SmartCandidate[], seed: number): SmartState {
  return {
    skill: prior ? prior.skill * CARRY : START_SKILL,
    seen: Math.min(prior?.seen ?? 0, SEEN_CARRIED),
    pool,
    credits: [],
    targets: [],
    seed: seed >>> 0,
  };
}

/** How hard a song in this game's pool is. Songs from outside it count as average. */
export function difficultyIn(smart: SmartState, song: Song): number {
  return smart.pool.find((c) => c.song.id === song.id)?.difficulty ?? DEFAULT_DIFFICULTY;
}

/** Learn from a revealed round: the room's new skill, and the round's credit noted. */
export function learn(smart: SmartState, round: Round, players: readonly Player[]): SmartState {
  const credit = roundCredit(round, players);
  // With nobody to learn from, the round counts as having gone to plan.
  if (credit === null) {
    return { ...smart, credits: [...smart.credits, smart.targets[smart.credits.length] ?? TARGET_MEAN] };
  }
  const expected = predict(smart.skill, difficultyIn(smart, round.song), round.kind);
  return {
    ...smart,
    skill: updateSkill(smart.skill, smart.seen, credit, expected),
    seen: smart.seen + 1,
    credits: [...smart.credits, credit],
  };
}

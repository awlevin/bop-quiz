import { describe, expect, it } from 'vitest';

import { DEFAULT_FORMAT, roundKinds } from './format';
import { createRoom, reduce } from './reducer';
import {
  beginSmart,
  chooseCandidate,
  CRUISING_STREAK,
  difficultyOfRank,
  FINALE,
  GIMME,
  planRest,
  predict,
  roundCredit,
  seeded,
  type SmartCandidate,
  type SmartState,
  STRETCH,
  STUMPED_STREAK,
  targetFor,
  updateSkill,
  WARM_UP,
} from './smart';
import type { Action, Answer, Player, QuestionKind, RoomState, Round, Song } from './types';
import { viewFor } from './views';

function song(id: number, artist = `Artist ${id}`): Song {
  return {
    id,
    title: `Song ${id}`,
    artist,
    album: `Album ${id}`,
    year: 1980 + (id % 40),
    genre: 'Pop',
    artworkUrl: '',
    previewUrl: `https://audio/${id}.m4a`,
  };
}

/** Forty songs, from a decade's best known (rank 0) to deep cuts (rank 39). */
const POOL: SmartCandidate[] = Array.from({ length: 40 }, (_, rank) => ({
  song: song(rank + 1),
  difficulty: difficultyOfRank(rank),
}));
const rankOf = (s: Song) => s.id - 1;

const player = (id: string): Player => ({ id, token: `t-${id}`, name: id, score: 0 });

function answer(partial: Partial<Answer>): Answer {
  return { text: 'x', elapsedMs: 1000, correct: false, points: 0, ...partial };
}

function roundOf(kind: QuestionKind, answers: Record<string, Answer>): Round {
  return { kind, song: song(1), guessStartedAt: 0, revealStartedAt: null, answers };
}

function state(partial: Partial<SmartState> = {}): SmartState {
  return { ...beginSmart(undefined, POOL, 7), ...partial };
}

describe('the model', () => {
  it('rates a decade’s best-known songs easiest, with smaller gaps further down', () => {
    expect(difficultyOfRank(0)).toBeLessThan(difficultyOfRank(10));
    expect(difficultyOfRank(10) - difficultyOfRank(0)).toBeGreaterThan(difficultyOfRank(40) - difficultyOfRank(30));
    // Unranked songs sit with the deeper cuts, not at either end.
    expect(difficultyOfRank(undefined)).toBe(difficultyOfRank(25));
  });

  it('expects a fresh room to name the biggest hits and struggle with deep album cuts', () => {
    expect(predict(0, difficultyOfRank(0), 'title')).toBeCloseTo(0.9, 1);
    expect(predict(0, difficultyOfRank(10), 'title')).toBeCloseTo(0.7, 1);
    expect(predict(0, difficultyOfRank(30), 'album')).toBeLessThan(0.2);
  });

  it('counts how much of the room got a round', () => {
    const players = ['a', 'b', 'c', 'd'].map(player);
    const round = roundOf('title', {
      a: answer({ correct: true, points: 900 }),
      b: answer({ correct: false }),
      c: answer({ gaveUp: true }),
      // d never answered
    });
    expect(roundCredit(round, players)).toBe(0.25);
    expect(roundCredit(round, [])).toBeNull();
  });

  it('gives a year round partial credit for a near miss, as the score does', () => {
    const players = ['a', 'b'].map(player);
    const round = roundOf('year', { a: answer({ yearsOff: 0, correct: true }), b: answer({ yearsOff: 1 }) });
    expect(roundCredit(round, players)).toBeCloseTo((1 + 0.92) / 2, 2);
  });

  it('moves the skill toward what happened, by how surprising it was, in steps that settle', () => {
    expect(updateSkill(0, 0, 0, 0.7)).toBeLessThan(0);
    expect(updateSkill(0, 0, 1, 0.7)).toBeGreaterThan(0);
    expect(updateSkill(0, 0, 0.7, 0.7)).toBe(0);
    // A surprise moves it further than the expected.
    expect(updateSkill(0, 0, 0, 0.9)).toBeLessThan(updateSkill(0, 0, 0, 0.5));
    // A room the model knows well moves less.
    expect(Math.abs(updateSkill(0, 30, 0, 0.7))).toBeLessThan(Math.abs(updateSkill(0, 0, 0, 0.7)));
    expect(updateSkill(3.9, 0, 1, 0)).toBe(4);
  });
});

describe('the schedule', () => {
  const dice = seeded(1);

  it('warms up with a sure thing and ends on one', () => {
    expect(targetFor(0, 10, [], [], dice)).toBe(WARM_UP);
    expect(targetFor(9, 10, [0, 0, 0], [], dice)).toBe(FINALE);
  });

  it(`throws a gimme after ${STUMPED_STREAK} stumpers in a row`, () => {
    expect(targetFor(5, 10, [0.9, 0.1, 0], [0.7, 0.7, 0.7], dice)).toBe(GIMME);
  });

  it(`reaches after ${CRUISING_STREAK} rounds the whole room got`, () => {
    expect(targetFor(5, 10, [0.9, 1, 1], [0.7, 0.7, 0.7], dice)).toBe(STRETCH);
  });

  it('springs the odd gimme at random, never two in a row, and otherwise aims around 72%', () => {
    const plain: number[] = [];
    let gimmes = 0;
    for (let seed = 0; seed < 600; seed++) {
      const target = targetFor(2, 10, [0.6, 0.7], [0.7, 0.7], seeded(seed));
      if (target === GIMME) gimmes++;
      else plain.push(target);
      expect(targetFor(2, 10, [0.6, 0.7], [0.7, GIMME], seeded(seed))).toBeLessThan(GIMME);
    }
    expect(gimmes / 600).toBeGreaterThan(0.1);
    expect(gimmes / 600).toBeLessThan(0.25);
    const mean = plain.reduce((a, b) => a + b, 0) / plain.length;
    expect(mean).toBeGreaterThan(0.68);
    expect(mean).toBeLessThan(0.76);
    expect(Math.min(...plain)).toBeGreaterThanOrEqual(0.55);
  });
});

describe('the pick', () => {
  it('picks songs near the target', () => {
    // A fresh room aiming at 70% on a title round wants about the 10th best-known song.
    const ranks = Array.from({ length: 200 }, (_, seed) => rankOf(chooseCandidate(POOL, 'title', 0, 0.7, seeded(seed))!.song));
    const mean = ranks.reduce((a, b) => a + b, 0) / ranks.length;
    expect(mean).toBeGreaterThan(5);
    expect(mean).toBeLessThan(16);
    // But not always the same one.
    expect(new Set(ranks).size).toBeGreaterThan(4);
  });

  it('still picks the nearest songs when the target is out of reach', () => {
    const pick = chooseCandidate(POOL, 'album', -4, 0.95, seeded(3));
    expect(rankOf(pick!.song)).toBeLessThan(3);
  });

  it('plans the rest of the game with no song or artist twice, the same way for the same seed', () => {
    const kinds = roundKinds(DEFAULT_FORMAT);
    const pool = [...POOL, { song: song(99, 'Artist 1'), difficulty: difficultyOfRank(0) }];
    const played = [pool[0].song];
    const plan = planRest(state({ pool, credits: [1], targets: [WARM_UP] }), kinds, played)!;
    expect(plan.songs).toHaveLength(kinds.length - 1);
    expect(plan.targets).toHaveLength(kinds.length);
    const artists = [...played, ...plan.songs].map((s) => s.artist);
    expect(new Set(artists).size).toBe(artists.length);
    expect(planRest(state({ pool, credits: [1], targets: [WARM_UP] }), kinds, played)).toEqual(plan);
  });

  it('gives up when the pool has nothing left', () => {
    expect(planRest(state({ pool: POOL.slice(0, 3) }), roundKinds(DEFAULT_FORMAT), [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// In a room

function run(s: RoomState, action: Action, now = 0): RoomState {
  const result = reduce(s, action, now);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function lobby(names: string[]): RoomState {
  let s = createRoom('ABCD', 'host', 0);
  names.forEach((name, i) => {
    s = run(s, { type: 'join', playerId: `p${i}`, token: `t${i}`, name });
  });
  return run(run(s, { type: 'audio-check' }), { type: 'setlist', mode: 'smart', taste: { genres: [], decades: [] } });
}

function startSmart(s: RoomState, seed: number): RoomState {
  return run(s, { type: 'start', songs: [], spares: [], finales: [], pool: POOL, seed });
}

const rightAnswer = (r: Round) => (r.kind === 'year' ? String(r.song.year) : r.song[r.kind]);

/** Play the current round: `knows(song)` says whether a player gets it. Ends at its reveal. */
function playRound(s: RoomState, knows: (rank: number, player: number) => boolean): RoomState {
  s = run(s, { type: 'audio-started', roundIndex: s.roundIndex });
  const round = s.rounds[s.roundIndex];
  s.players.forEach((p, i) => {
    s = run(s, { type: 'answer', playerId: p.id, text: knows(rankOf(round.song), i) ? rightAnswer(round) : 'no idea' });
  });
  expect(s.phase).toBe('reveal');
  return s;
}

function playGame(seed: number, knows: (rank: number, player: number) => boolean): RoomState {
  let s = startSmart(lobby(['Ana', 'Ben', 'Cy']), seed);
  while (s.phase !== 'finished') {
    s = playRound(s, knows);
    s = run(s, { type: 'next', roundIndex: s.roundIndex });
  }
  return s;
}

const meanRank = (rounds: Round[]) => rounds.reduce((sum, r) => sum + rankOf(r.song), 0) / rounds.length;

describe('a Smart game', () => {
  it('plans the whole game at Start but counts only the first song as heard', () => {
    const s = startSmart(lobby(['Ana']), 1);
    expect(s.rounds).toHaveLength(10);
    expect(s.playedSongIds).toEqual([s.rounds[0].song.id]);
    // The opener is a song nearly everyone knows.
    expect(rankOf(s.rounds[0].song)).toBeLessThan(6);
  });

  it('refuses a pool too small for the game', () => {
    const result = reduce(lobby(['Ana']), { type: 'start', songs: [], spares: [], pool: POOL.slice(0, 5), seed: 1 }, 0);
    expect(result).toEqual({ ok: false, error: 'Not enough songs to start.' });
  });

  it('chooses the next song at each reveal, and only then counts it heard', () => {
    let s = startSmart(lobby(['Ana']), 2);
    s = playRound(s, () => true);
    expect(s.playedSongIds).toEqual([s.rounds[0].song.id, s.rounds[1].song.id]);
    expect(s.smart!.credits).toEqual([1]);
    expect(s.smart!.skill).toBeGreaterThan(0);
  });

  it('gives a struggling room easier songs than a room on a roll', () => {
    let struggling = 0;
    let cruising = 0;
    for (let seed = 0; seed < 20; seed++) {
      // Only the very best-known songs land for one room; everything does for the other.
      struggling += meanRank(playGame(seed, (rank) => rank < 3).rounds.slice(1, 6));
      cruising += meanRank(playGame(seed, () => true).rounds.slice(1, 6));
    }
    expect(struggling / 20).toBeLessThan(cruising / 20 - 4);
  });

  it('follows a stumper with an easier song', () => {
    let easier = 0;
    for (let seed = 0; seed < 30; seed++) {
      let s = startSmart(lobby(['Ana', 'Ben']), seed);
      s = playRound(s, () => true);
      s = run(s, { type: 'next', roundIndex: 0 });
      s = playRound(s, () => false);
      const stumper = s.rounds[1].song;
      // Planned again at the reveal: same kind of question, an easier song.
      if (s.rounds[2].kind === s.rounds[1].kind && rankOf(s.rounds[2].song) < rankOf(stumper)) easier++;
    }
    expect(easier).toBeGreaterThan(20);
  });

  it('shows the next song to the TV only once it is chosen', () => {
    let s = startSmart(lobby(['Ana']), 3);
    s = run(s, { type: 'audio-started', roundIndex: 0 });
    expect(viewFor(s, { role: 'host' }, 0).round!.nextPreviewUrl).toBeUndefined();
    s = run(s, { type: 'answer', playerId: 'p0', text: 'no idea' });
    expect(viewFor(s, { role: 'host' }, 0).round!.nextPreviewUrl).toBe(s.rounds[1].song.previewUrl);
  });

  it('swaps a song that will not play for another from the pool, and never offers it again', () => {
    let s = startSmart(lobby(['Ana']), 4);
    const broken = s.rounds[0].song;
    s = run(s, { type: 'audio-failed', roundIndex: 0 });
    expect(s.rounds[0].song.id).not.toBe(broken.id);
    expect(s.smart!.pool.some((c) => c.song.id === broken.id)).toBe(false);
    expect(s.playedSongIds).toEqual([broken.id, s.rounds[0].song.id]);
  });

  it('forgets the pool when the game ends but remembers the room, eased back, next game', () => {
    const done = playGame(5, () => true);
    expect(done.smart!.pool).toEqual([]);
    expect(done.smart!.skill).toBeGreaterThan(1);
    const again = startSmart(done, 6);
    expect(again.smart!.skill).toBeCloseTo(done.smart!.skill * 0.75);
    expect(again.smart!.credits).toEqual([]);
  });

  it('puts the songs it had not got to back in the catalog when the game is ended early', () => {
    let s = startSmart(lobby(['Ana']), 7);
    s = playRound(s, () => true);
    const [first, second] = s.rounds.map((r) => r.song.id);
    expect(s.playedSongIds).toEqual([first, second]);
    s = run(s, { type: 'pause', by: 'Ana' });
    s = run(s, { type: 'end-game', playerId: null });
    // The second song was chosen at the reveal, but never played.
    expect(s.playedSongIds).toEqual([first]);
    expect(s.smart!.pool).toEqual([]);
  });

  it('leaves other setlist modes as they were', () => {
    const songs = Array.from({ length: 13 }, (_, i) => song(i + 1));
    const s = run(lobby(['Ana']), { type: 'start', songs: songs.slice(0, 10), spares: songs.slice(10) });
    expect(s.smart).toBeUndefined();
    expect(s.playedSongIds).toHaveLength(10);
  });
});

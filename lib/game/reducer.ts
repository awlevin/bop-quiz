// The whole game as one pure function: (state, action, now) → state.
//
// Nothing here owns a timer. Phases end on deadlines derived from timestamps
// in the state, and every call settles overdue deadlines before it looks at
// the action. Any screen may send `tick` when its own clock says a deadline
// passed; the first one moves the room on, the rest are no-ops. That is what
// lets the server be a set of stateless functions.

import {
  ANSWER_GRACE_MS,
  HECKLE_COOLDOWN_MS,
  MAX_ANSWER_LENGTH,
  MAX_HECKLES_PER_ROUND,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  REVEAL_MS,
  RIDE_SHARE,
  STUMPER_POINTS,
} from './config';
import { DEFAULT_FORMAT, type GameFormat, roundGuessMs, roundKinds } from './format';
import { DEFAULT_GIVE_UP_NOTICE } from './giveUpNotice';
import { grade } from './score';
import { CLASSIC } from './setlist';
import { beginSmart, learn, planRest, type SmartState } from './smart';
import type { Action, Answer, Player, ReduceResult, RoomState, Round, Song } from './types';

export function createRoom(
  code: string,
  hostToken: string,
  now: number,
  lobbyUrl: string | null = null,
): RoomState {
  return {
    code,
    version: 1,
    hostToken,
    phase: 'lobby',
    players: [],
    rounds: [],
    roundIndex: 0,
    spares: [],
    finales: [],
    pause: null,
    lobbyUrl,
    playedSongIds: [],
    audioChecked: false,
    setlist: CLASSIC,
    format: DEFAULT_FORMAT,
    createdAt: now,
  };
}

export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

const fail = (error: string): ReduceResult => ({ ok: false, error });

function currentRound(state: RoomState): Round | undefined {
  return state.rounds[state.roundIndex];
}

function withRound(state: RoomState, round: Round): RoomState {
  const rounds = state.rounds.slice();
  rounds[state.roundIndex] = round;
  return { ...state, rounds };
}

/**
 * Pay out the folds. Folding calls a stumper: it pays when someone stayed in
 * and nobody who did scored a point, which is exactly when the TV says
 * "Nobody got it". A ride takes a share of what its pick scored by answering.
 */
export function settleFolds(answers: Record<string, Answer>, players: Player[]): Record<string, Answer> {
  const stayedIn = players.filter((p) => !answers[p.id]?.gaveUp);
  const stumped = stayedIn.length > 0 && stayedIn.every((p) => !answers[p.id]?.points);
  const here = new Set(players.map((p) => p.id));
  const settled = { ...answers };
  for (const [id, answer] of Object.entries(answers)) {
    if (!answer.gaveUp) continue;
    if (answer.ride) {
      const pick = here.has(answer.ride) ? answers[answer.ride] : undefined;
      const earned = pick && !pick.gaveUp ? pick.points : 0;
      settled[id] = { ...answer, points: Math.round(earned * RIDE_SHARE) };
    } else {
      settled[id] = { ...answer, stumper: stumped, points: stumped ? STUMPER_POINTS : 0 };
    }
  }
  return settled;
}

function startReveal(prev: RoomState, now: number): RoomState {
  const before = currentRound(prev)!;
  const state = withRound(prev, { ...before, answers: settleFolds(before.answers, prev.players) });
  const round = currentRound(state)!;
  const players = state.players.map((p) => ({
    ...p,
    score: p.score + (round.answers[p.id]?.points ?? 0),
  }));
  const revealed: RoomState = { ...withRound(state, { ...round, revealStartedAt: now }), players, phase: 'reveal' };
  return state.smart?.pool.length ? smartReveal(revealed) : revealed;
}

/**
 * Smart mode, at each reveal: learn from how the room did, then choose the
 * next round's song for the room as it is now. It counts as heard from here,
 * as a Classic game's songs do from Start.
 */
function smartReveal(state: RoomState): RoomState {
  const round = currentRound(state)!;
  const smart = learn(state.smart!, round, state.players);
  const next = state.roundIndex + 1;
  if (next >= state.rounds.length) return { ...state, smart };
  const replanned = replan({ ...state, smart }, next);
  if (!replanned) return { ...state, smart };
  return { ...replanned, playedSongIds: [...replanned.playedSongIds, replanned.rounds[next].song.id] };
}

/** Smart mode: choose songs again for every round from `from` on. Null when the pool has run dry. */
function replan(state: RoomState, from: number): RoomState | null {
  const smart = state.smart!;
  const played = state.rounds.slice(0, from).map((r) => r.song);
  const plan = planRest(smart, state.rounds.map((r) => r.kind), played);
  if (!plan) return null;
  const rounds = state.rounds.map((r, i) => (i < from ? r : { ...r, song: plan.songs[i - from] }));
  return { ...state, rounds, smart: { ...smart, targets: [...smart.targets.slice(0, from), ...plan.targets] } };
}

/** The game is over: the pool goes, what the room showed it knows stays. */
function dropPool(smart: SmartState | undefined): SmartState | undefined {
  return smart && { ...smart, pool: [] };
}

function advance(state: RoomState): RoomState {
  const last = state.roundIndex >= state.rounds.length - 1;
  return last
    ? { ...state, phase: 'finished', smart: dropPool(state.smart) }
    : { ...state, phase: 'loading', roundIndex: state.roundIndex + 1 };
}

/**
 * Stop the game where it stands and go back to the lobby. Only the game's own
 * progress goes: the room, who is in it, and anything it was set up with stay.
 */
function backToLobby(state: RoomState): RoomState {
  // The songs still to come were never heard, so they may come up another time.
  const unheard = new Set(state.rounds.slice(state.roundIndex + 1).map((r) => r.song.id));
  return {
    ...state,
    phase: 'lobby',
    rounds: [],
    roundIndex: 0,
    spares: [],
    finales: [],
    pause: null,
    players: state.players.map((p) => ({ ...p, score: 0 })),
    playedSongIds: state.playedSongIds.filter((id) => !unheard.has(id)),
    smart: dropPool(state.smart),
  };
}

/** Move past any deadline that `now` has already crossed. */
export function settle(state: RoomState, now: number): RoomState {
  const round = currentRound(state);
  if (!round || state.pause) return state;
  const guessMs = roundGuessMs(round);
  if (
    state.phase === 'guessing' &&
    round.guessStartedAt !== null &&
    now >= round.guessStartedAt + guessMs + ANSWER_GRACE_MS
  ) {
    // Stamp the reveal at the deadline itself, so a late tick cannot stretch it.
    return settle(startReveal(state, round.guessStartedAt + guessMs), now);
  }
  if (
    state.phase === 'reveal' &&
    round.revealStartedAt !== null &&
    now >= round.revealStartedAt + REVEAL_MS
  ) {
    return advance(state);
  }
  return state;
}

// Each round carries its own window, so nothing about the room can change a game once it is running.
function newRounds(format: GameFormat, songs: Song[]): Round[] {
  return roundKinds(format).map((kind, i) => ({
    kind,
    song: songs[i],
    guessStartedAt: null,
    revealStartedAt: null,
    answers: {},
    plays: format.plays,
  }));
}

export function reduce(prev: RoomState, action: Action, now: number): ReduceResult {
  const state = settle(prev, now);
  const next = apply(state, action, now);
  if (!next.ok) {
    // The action was refused, but a deadline may still have passed.
    return state === prev ? next : { ok: true, state: bump(prev, state) };
  }
  return { ok: true, state: bump(prev, next.state) };
}

function bump(prev: RoomState, next: RoomState): RoomState {
  return next === prev ? prev : { ...next, version: prev.version + 1 };
}

function apply(state: RoomState, action: Action, now: number): ReduceResult {
  switch (action.type) {
    case 'join': {
      const name = cleanName(action.name);
      if (!name) return fail('Enter a name to join.');
      if (state.players.length >= MAX_PLAYERS) return fail('This room is full.');
      if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        return fail(`Someone here is already called ${name}. Pick another name.`);
      }
      const player = { id: action.playerId, token: action.token, name, score: 0 };
      return { ok: true, state: { ...state, players: [...state.players, player] } };
    }

    case 'rename': {
      const name = cleanName(action.name);
      if (!name) return fail('Enter a name.');
      if (
        state.players.some(
          (p) => p.id !== action.playerId && p.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        return fail(`Someone here is already called ${name}.`);
      }
      const players = state.players.map((p) => (p.id === action.playerId ? { ...p, name } : p));
      return { ok: true, state: { ...state, players } };
    }

    case 'remove-player': {
      if (!state.players.some((p) => p.id === action.playerId)) return { ok: true, state };
      const players = state.players.filter((p) => p.id !== action.playerId);
      const next = { ...state, players };
      // Nobody should wait on a player who has gone.
      return { ok: true, state: allAnswered(next) ? startReveal(next, now) : next };
    }

    case 'start': {
      if (state.phase !== 'lobby' && state.phase !== 'finished') {
        return fail('The game is already running.');
      }
      if (state.players.length === 0) return fail('Wait for a player to join first.');
      // `false`, not falsy: a room from before the sound check starts as it always did.
      if (state.audioChecked === false) return fail('Check the sound on the big screen first.');
      const format = state.format ?? DEFAULT_FORMAT;
      const started: RoomState = {
        ...state,
        phase: 'loading',
        roundIndex: 0,
        rounds: [],
        spares: action.spares,
        finales: action.finales ?? [],
        pause: null,
        players: state.players.map((p) => ({ ...p, score: 0 })),
        smart: dropPool(state.smart),
      };

      if (action.pool) {
        // Smart: lay the game out from the pool now, then choose again at every reveal.
        const kinds = roundKinds(format);
        if (action.pool.length < kinds.length) return fail('Not enough songs to start.');
        const smart = beginSmart(state.smart, action.pool, action.seed ?? 0);
        const sketch = newRounds(format, Array<Song>(kinds.length).fill(action.pool[0].song));
        const planned = replan({ ...started, rounds: sketch, smart }, 0);
        if (!planned) return fail('Not enough songs to start.');
        // Only the first song is heard for sure; the rest are chosen as the game goes.
        return {
          ok: true,
          state: { ...planned, playedSongIds: [...state.playedSongIds, planned.rounds[0].song.id] },
        };
      }

      const rounds = newRounds(format, action.songs);
      if (action.songs.length < rounds.length) return fail('Not enough songs to start.');
      // Only the songs that become rounds count as heard.
      const songs = action.songs.slice(0, rounds.length);
      return {
        ok: true,
        state: { ...started, rounds, playedSongIds: [...state.playedSongIds, ...songs.map((s) => s.id)] },
      };
    }

    case 'audio-started': {
      if (state.phase !== 'loading' || action.roundIndex !== state.roundIndex) {
        return { ok: true, state };
      }
      const round = currentRound(state)!;
      return {
        ok: true,
        state: { ...withRound(state, { ...round, guessStartedAt: now }), phase: 'guessing' },
      };
    }

    case 'audio-failed': {
      if (state.phase !== 'loading' || action.roundIndex !== state.roundIndex) {
        return { ok: true, state };
      }
      const round = currentRound(state)!;
      if (state.smart?.pool.length) {
        // Smart: the song that would not play leaves the pool, and the round chooses again.
        const pool = state.smart.pool.filter((c) => c.song.id !== round.song.id);
        const replanned = replan({ ...state, smart: { ...state.smart, pool } }, state.roundIndex);
        if (replanned) {
          const song = replanned.rounds[state.roundIndex].song;
          return { ok: true, state: { ...replanned, playedSongIds: [...state.playedSongIds, song.id] } };
        }
      }
      const [spare, ...spares] = state.spares;
      if (!spare) return { ok: true, state: advance(state) };
      return {
        ok: true,
        state: {
          ...withRound(state, { ...round, song: spare }),
          spares,
          playedSongIds: [...state.playedSongIds, spare.id],
        },
      };
    }

    case 'pause': {
      // Only while a clock is running: there is nothing to hold otherwise.
      if (state.pause || (state.phase !== 'guessing' && state.phase !== 'reveal')) {
        return { ok: true, state };
      }
      return { ok: true, state: { ...state, pause: { at: now, by: action.by } } };
    }

    case 'resume': {
      if (!state.pause) return { ok: true, state };
      // Slide the round's clocks forward by the length of the pause, so every
      // deadline, and every answer's speed, is measured in playing time.
      const held = Math.max(now - state.pause.at, 0);
      const round = currentRound(state);
      const resumed = { ...state, pause: null };
      if (!round) return { ok: true, state: resumed };
      return {
        ok: true,
        state: withRound(resumed, {
          ...round,
          guessStartedAt: round.guessStartedAt === null ? null : round.guessStartedAt + held,
          revealStartedAt: round.revealStartedAt === null ? null : round.revealStartedAt + held,
        }),
      };
    }

    case 'answer': {
      if (state.pause) return fail('The game is paused.');
      const round = currentRound(state);
      if (state.phase !== 'guessing' || !round || round.guessStartedAt === null) {
        return fail('Time is up for this song.');
      }
      if (!state.players.some((p) => p.id === action.playerId)) return fail('You are not in this room.');
      if (round.answers[action.playerId]) return fail('You already locked in an answer.');
      const text = action.text.trim().slice(0, MAX_ANSWER_LENGTH);
      if (!text) return fail('Type an answer first.');

      const guessMs = roundGuessMs(round);
      const elapsedMs = Math.min(Math.max(now - round.guessStartedAt, 0), guessMs);
      const answer = grade(round.kind, round.song, text, elapsedMs, guessMs);
      const next = withRound(state, {
        ...round,
        answers: { ...round.answers, [action.playerId]: answer },
      });
      return { ok: true, state: allAnswered(next) ? startReveal(next, now) : next };
    }

    case 'give-up': {
      if (state.pause) return fail('The game is paused.');
      const round = currentRound(state);
      if (state.phase !== 'guessing' || !round || round.guessStartedAt === null) {
        return { ok: true, state };
      }
      if (!state.players.some((p) => p.id === action.playerId)) return fail('You are not in this room.');
      if (round.answers[action.playerId]) return fail('You already locked in an answer.');
      const elapsedMs = Math.min(Math.max(now - round.guessStartedAt, 0), roundGuessMs(round));
      const fold: Answer = { text: '', elapsedMs, correct: false, gaveUp: true, points: 0 };
      if (action.ride !== undefined) {
        if (!state.rideAlong) return fail('This room is not playing Ride along.');
        const pick = state.players.find((p) => p.id === action.ride);
        if (!pick || pick.id === action.playerId) return fail('Pick someone else to ride with.');
        if (round.answers[pick.id]?.gaveUp) return fail(`${pick.name} gave up too.`);
        fold.ride = pick.id;
      }
      const next = withRound(state, {
        ...round,
        answers: { ...round.answers, [action.playerId]: fold },
      });
      return { ok: true, state: allAnswered(next) ? startReveal(next, now) : next };
    }

    case 'heckle': {
      const round = currentRound(state);
      if (state.pause || state.phase !== 'guessing' || !round) return { ok: true, state };
      if (!round.answers[action.playerId]?.gaveUp) return fail('Heckling is for players who gave up.');
      const heckles = round.heckles ?? [];
      const last = heckles.findLast((h) => h.playerId === action.playerId);
      // Too soon, or too many: drop it quietly. A thumb on the key is not an error.
      if (heckles.length >= MAX_HECKLES_PER_ROUND || (last && now - last.at < HECKLE_COOLDOWN_MS)) {
        return { ok: true, state };
      }
      const heckle = { id: heckles.length, playerId: action.playerId, kind: action.kind, at: now };
      return { ok: true, state: withRound(state, { ...round, heckles: [...heckles, heckle] }) };
    }

    case 'rules': {
      // Like the setlist, a rule changes only between games.
      if (state.phase !== 'lobby' && state.phase !== 'finished') return fail('The game is already running.');
      if (Boolean(state.rideAlong) === action.rideAlong) return { ok: true, state };
      return { ok: true, state: { ...state, rideAlong: action.rideAlong } };
    }

    case 'next': {
      if (state.pause) return { ok: true, state };
      if (state.phase !== 'reveal' || action.roundIndex !== state.roundIndex) {
        return { ok: true, state };
      }
      return { ok: true, state: advance(state) };
    }

    case 'audio-check': {
      if (state.audioChecked) return { ok: true, state };
      return { ok: true, state: { ...state, audioChecked: true } };
    }

    case 'end-game': {
      if (action.playerId !== null && state.players[0]?.id !== action.playerId) {
        return fail('Only the host can end the game.');
      }
      // Ending is offered on the pause screen, so a game that has since resumed carries on.
      if (!state.pause) return fail('Pause the game before ending it.');
      return { ok: true, state: backToLobby(state) };
    }

    case 'setlist': {
      // Picks shape the next draw, so they change only between games.
      if (state.phase !== 'lobby' && state.phase !== 'finished') return fail('The game is already running.');
      const setlist = { ...(state.setlist ?? CLASSIC), mode: action.mode, host: action.taste };
      if (action.depth !== undefined) setlist.depth = action.depth;
      return { ok: true, state: { ...state, setlist } };
    }

    case 'taste': {
      if (state.phase !== 'lobby' && state.phase !== 'finished') return fail('The game is already running.');
      const setlist = state.setlist ?? CLASSIC;
      if (setlist.mode !== 'crowd') return fail('The host is picking the songs.');
      if (!state.players.some((p) => p.id === action.playerId)) return fail('You are not in this room.');
      const picks = { ...setlist.picks, [action.playerId]: action.taste };
      return { ok: true, state: { ...state, setlist: { ...setlist, picks } } };
    }

    case 'give-up-notice': {
      // Unchanged is a no-op, so the host screen re-sending it redraws nobody.
      if ((state.giveUpNotice ?? DEFAULT_GIVE_UP_NOTICE) === action.notice) return { ok: true, state };
      return { ok: true, state: { ...state, giveUpNotice: action.notice } };
    }

    case 'format': {
      // The rounds are laid out at Start, so the format changes only between games.
      if (state.phase !== 'lobby' && state.phase !== 'finished') return fail('The game is already running.');
      return { ok: true, state: { ...state, format: action.format } };
    }

    case 'tick':
      return { ok: true, state };
  }
}

function allAnswered(state: RoomState): boolean {
  if (state.phase !== 'guessing') return false;
  const round = currentRound(state);
  if (!round || state.players.length === 0) return false;
  return state.players.every((p) => round.answers[p.id]);
}

import { describe, expect, it } from 'vitest';

import { chooseFinales, chooseSongs } from '@/lib/catalog';
import { createSoloRoom } from '@/lib/solo/local';

import { ANSWER_GRACE_MS, GUESS_MS, REVEAL_MS, ROUND_KINDS, ROUNDS_PER_GAME } from './config';
import { phaseDeadline } from './deadline';
import type { GameFormat } from './format';
import { matchesArtist, matchesText, parseYear } from './match';
import { createRoom, reduce } from './reducer';
import { grade, speedPoints, yearShare } from './score';
import type { Action, RoomState, Song } from './types';
import { viewFor } from './views';

function song(id: number, over: Partial<Song> = {}): Song {
  return {
    id,
    title: `Song ${id}`,
    artist: `Artist ${id}`,
    album: `Album ${id}`,
    year: 1990 + id,
    genre: 'Pop',
    artworkUrl: `https://art/${id}.jpg`,
    previewUrl: `https://audio/${id}.m4a`,
    ...over,
  };
}

const SONGS = Array.from({ length: ROUNDS_PER_GAME }, (_, i) => song(i + 1));
const SPARES = [song(101), song(102)];

function run(state: RoomState, action: Action, now: number): RoomState {
  const result = reduce(state, action, now);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

/** A lobby with these players in it, its sound already checked unless `checked` is false. */
function lobbyWith(names: string[], { checked = true } = {}): RoomState {
  let state = createRoom('ABCD', 'host-token', 0);
  names.forEach((name, i) => {
    state = run(state, { type: 'join', playerId: `p${i}`, token: `t${i}`, name }, 0);
  });
  return checked ? run(state, { type: 'audio-check' }, 0) : state;
}

function guessing(names: string[], now = 1000): RoomState {
  let state = lobbyWith(names);
  state = run(state, { type: 'start', songs: SONGS, spares: SPARES }, now);
  return run(state, { type: 'audio-started', roundIndex: 0 }, now);
}

describe('matching', () => {
  it('forgives case, punctuation, accents and a dropped article', () => {
    expect(matchesText('mr brightside', 'Mr. Brightside')).toBe(true);
    expect(matchesText('dont stop believing', "Don't Stop Believin'")).toBe(true);
    expect(matchesText('beyonce', 'Beyoncé')).toBe(true);
    expect(matchesArtist('killers', 'The Killers')).toBe(true);
  });

  it('forgives typos in proportion to length', () => {
    expect(matchesText('bohemian rapsody', 'Bohemian Rhapsody')).toBe(true);
    expect(matchesText('help', 'Hell')).toBe(false);
    expect(matchesText('yellow submarine', 'Yesterday')).toBe(false);
  });

  it('ignores edition and featuring decorations', () => {
    expect(matchesText('umbrella', 'Umbrella (feat. JAY-Z)')).toBe(true);
    expect(matchesText('come together', 'Come Together - Remastered 2009')).toBe(true);
    expect(matchesText('i cant get no satisfaction', "(I Can't Get No) Satisfaction")).toBe(true);
    expect(matchesText('satisfaction', "(I Can't Get No) Satisfaction")).toBe(true);
  });

  it('accepts any one credited artist', () => {
    expect(matchesArtist('david bowie', 'Queen & David Bowie')).toBe(true);
    expect(matchesArtist('queen', 'Queen & David Bowie')).toBe(true);
    expect(matchesArtist('simon and garfunkel', 'Simon & Garfunkel')).toBe(true);
    expect(matchesArtist('prince', 'Queen & David Bowie')).toBe(false);
  });

  it('parses only four-digit years', () => {
    expect(parseYear(' 1984 ')).toBe(1984);
    expect(parseYear('84')).toBeNull();
    expect(parseYear('nineteen')).toBeNull();
  });
});

describe('scoring', () => {
  it('pays more for speed', () => {
    expect(speedPoints(0)).toBe(1000);
    expect(speedPoints(GUESS_MS)).toBe(500);
    expect(speedPoints(3000)).toBeGreaterThan(speedPoints(9000));
  });

  it('pays a year guess by closeness, falling away fast past a few years', () => {
    const shares = [0, 1, 2, 3, 4, 5, 6, 7].map(yearShare);
    expect(shares[0]).toBe(1);
    for (let d = 1; d < shares.length; d++) expect(shares[d]).toBeLessThan(shares[d - 1]);
    // Each extra year costs more than the one before, up to the knee of the curve.
    expect(shares[0] - shares[1]).toBeLessThan(shares[1] - shares[2]);
    expect(shares[1] - shares[2]).toBeLessThan(shares[2] - shares[3]);
    expect(shares[3]).toBeGreaterThan(0.4);
    expect(shares[5]).toBeLessThan(0.15);
    expect(shares[7]).toBe(0);
  });

  it('pays part of the pot for a near-miss year', () => {
    const s = song(1, { year: 1984 });
    expect(grade('year', s, '1984', 0)).toMatchObject({ correct: true, points: 1000, yearsOff: 0 });
    expect(grade('year', s, '1985', 0)).toMatchObject({ correct: false, points: 923, yearsOff: 1 });
    expect(grade('year', s, '1982', 0)).toMatchObject({ correct: false, points: 726 });
    expect(grade('year', s, '1981', 0).points).toBe(487);
    expect(grade('year', s, '1989', 0).points).toBe(135);
    expect(grade('year', s, '1992', 0).points).toBe(0);
    expect(grade('year', s, 'dunno', 0).points).toBe(0);
  });
});

describe('room', () => {
  it('refuses duplicate names and empty rooms', () => {
    const state = lobbyWith(['Ana']);
    expect(reduce(state, { type: 'join', playerId: 'x', token: 'y', name: ' ana ' }, 0).ok).toBe(false);
    const empty = createRoom('ABCD', 'h', 0);
    expect(reduce(empty, { type: 'start', songs: SONGS, spares: [] }, 0).ok).toBe(false);
  });

  it('starts the clock only when the host reports audio', () => {
    let state = lobbyWith(['Ana']);
    state = run(state, { type: 'start', songs: SONGS, spares: SPARES }, 500);
    expect(state.phase).toBe('loading');
    expect(reduce(state, { type: 'answer', playerId: 'p0', text: 'x' }, 600).ok).toBe(false);
    state = run(state, { type: 'audio-started', roundIndex: 0 }, 2000);
    expect(state.phase).toBe('guessing');
    expect(state.rounds[0].guessStartedAt).toBe(2000);
  });

  it('reveals as soon as everyone has answered, and scores by speed', () => {
    let state = guessing(['Ana', 'Ben']);
    state = run(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, 1000 + 3000);
    expect(state.phase).toBe('guessing');
    expect(state.players[0].score).toBe(0);
    state = run(state, { type: 'answer', playerId: 'p1', text: 'wrong' }, 1000 + 6000);
    expect(state.phase).toBe('reveal');
    expect(state.players[0].score).toBe(900);
    expect(state.players[1].score).toBe(0);
  });

  it('counts giving up as done, publicly, for no points', () => {
    let state = guessing(['Ana', 'Ben']);
    state = run(state, { type: 'give-up', playerId: 'p1' }, 4000);
    const host = viewFor(state, { role: 'host' }, 4000);
    expect(host.players[1]).toMatchObject({ answered: true, gaveUp: true });
    expect(reduce(state, { type: 'answer', playerId: 'p1', text: 'song 1' }, 4500).ok).toBe(false);
    state = run(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, 5000);
    expect(state.phase).toBe('reveal');
    expect(state.players[1].score).toBe(0);
  });

  it('stops every clock while paused, and gives the time back on resume', () => {
    let state = guessing(['Ana', 'Ben']);
    state = run(state, { type: 'pause', by: 'Ben' }, 1000 + 4000);
    expect(viewFor(state, { role: 'host' }, 0).pause).toEqual({ at: 5000, by: 'Ben' });

    // An hour passes. Nothing times out, and nobody can answer into the silence.
    const later = 5000 + 3_600_000;
    expect(run(state, { type: 'tick' }, later)).toBe(state);
    expect(reduce(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, later).ok).toBe(false);

    state = run(state, { type: 'resume' }, later);
    expect(state.pause).toBeNull();
    // Ana answers 2 s after the resume: 6 s of playing time, not an hour.
    state = run(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, later + 2000);
    expect(state.rounds[0].answers.p0.elapsedMs).toBe(6000);
    // The remaining 9 s still run out on schedule.
    state = run(state, { type: 'tick' }, later + 11_000 + ANSWER_GRACE_MS);
    expect(state.phase).toBe('reveal');
  });

  it('ignores a pause when no clock is running', () => {
    const lobby = lobbyWith(['Ana']);
    expect(run(lobby, { type: 'pause', by: 'Ana' }, 5)).toBe(lobby);
  });

  it('takes one answer per player', () => {
    let state = guessing(['Ana', 'Ben']);
    state = run(state, { type: 'answer', playerId: 'p0', text: 'nope' }, 2000);
    expect(reduce(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, 2500).ok).toBe(false);
  });

  it('times out on any tick after the deadline, stamped at the deadline', () => {
    let state = guessing(['Ana', 'Ben']);
    const early = run(state, { type: 'tick' }, 1000 + GUESS_MS - 1);
    expect(early).toBe(state);
    state = run(state, { type: 'tick' }, 1000 + GUESS_MS + ANSWER_GRACE_MS + 250);
    expect(state.phase).toBe('reveal');
    expect(state.rounds[0].revealStartedAt).toBe(1000 + GUESS_MS);
  });

  it('settles the deadline before a late answer, and says nothing went wrong', () => {
    const state = guessing(['Ana']);
    const result = reduce(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, 1000 + GUESS_MS + 5000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.phase).toBe('reveal');
      expect(result.state.players[0].score).toBe(0);
    }
  });

  it('moves on when the reveal ends or anyone asks, but only once', () => {
    let state = guessing(['Ana']);
    state = run(state, { type: 'answer', playerId: 'p0', text: 'x' }, 2000);
    const skipped = run(state, { type: 'next', roundIndex: 0 }, 3000);
    expect(skipped.phase).toBe('loading');
    expect(skipped.roundIndex).toBe(1);
    // A second "next" for the old round must not skip round two.
    expect(run(skipped, { type: 'next', roundIndex: 0 }, 3001)).toBe(skipped);

    const waited = run(state, { type: 'tick' }, 2000 + REVEAL_MS);
    expect(waited.roundIndex).toBe(1);
  });

  it('swaps in a spare when a preview will not play', () => {
    let state = lobbyWith(['Ana']);
    state = run(state, { type: 'start', songs: SONGS, spares: SPARES }, 0);
    state = run(state, { type: 'audio-failed', roundIndex: 0 }, 10);
    expect(state.rounds[0].song.id).toBe(101);
    expect(state.spares).toHaveLength(1);
    expect(state.phase).toBe('loading');
  });

  it('does not wait for a player who left', () => {
    let state = guessing(['Ana', 'Ben']);
    state = run(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, 2000);
    state = run(state, { type: 'remove-player', playerId: 'p1' }, 2500);
    expect(state.phase).toBe('reveal');
  });

  it('plays ten rounds, finishes, and can start again with scores reset', () => {
    let state = lobbyWith(['Ana']);
    let now = 0;
    state = run(state, { type: 'start', songs: SONGS, spares: SPARES }, now);
    for (let i = 0; i < ROUNDS_PER_GAME; i++) {
      state = run(state, { type: 'audio-started', roundIndex: i }, (now += 100));
      state = run(state, { type: 'answer', playerId: 'p0', text: String(state.rounds[i].song[state.rounds[i].kind]) }, (now += 100));
      expect(state.phase).toBe('reveal');
      state = run(state, { type: 'next', roundIndex: i }, (now += 100));
    }
    expect(state.phase).toBe('finished');
    expect(state.players[0].score).toBeGreaterThan(9000);

    state = run(state, { type: 'start', songs: SONGS, spares: [] }, (now += 100));
    expect(state.phase).toBe('loading');
    expect(state.players[0].score).toBe(0);
    expect(state.playedSongIds).toHaveLength(ROUNDS_PER_GAME * 2);
  });
});

describe('sound check', () => {
  it('holds the start until the host screen has heard its test sound', () => {
    let state = lobbyWith(['Ana'], { checked: false });
    expect(state.audioChecked).toBe(false);
    expect(viewFor(state, { role: 'player', playerId: 'p0' }, 0).audioChecked).toBe(false);
    const refused = reduce(state, { type: 'start', songs: SONGS, spares: SPARES }, 10);
    expect(refused).toEqual({ ok: false, error: 'Check the sound on the big screen first.' });

    state = run(state, { type: 'audio-check' }, 20);
    expect(viewFor(state, { role: 'host' }, 20).audioChecked).toBe(true);
    // A second confirmation changes nothing, so nobody's screen redraws for it.
    expect(run(state, { type: 'audio-check' }, 30)).toBe(state);
    expect(run(state, { type: 'start', songs: SONGS, spares: SPARES }, 40).phase).toBe('loading');
  });

  it('lets a room from before the check start as it always did', () => {
    const legacy: RoomState = { ...lobbyWith(['Ana'], { checked: false }) };
    delete legacy.audioChecked;
    expect(viewFor(legacy, { role: 'host' }, 0).audioChecked).toBe(true);
    expect(run(legacy, { type: 'start', songs: SONGS, spares: SPARES }, 10).phase).toBe('loading');
  });

  it('never asks a solo game', () => {
    const solo = createSoloRoom(0);
    expect(run(solo, { type: 'start', songs: SONGS, spares: SPARES }, 10).phase).toBe('loading');
  });
});

describe('ending a game', () => {
  /** Ana and Ben, three songs in and paused, with points on the board. */
  function pausedMidGame(): RoomState {
    let state = guessing(['Ana', 'Ben']);
    let now = 1000;
    for (let i = 0; i < 3; i++) {
      if (i > 0) state = run(state, { type: 'audio-started', roundIndex: i }, (now += 100));
      state = run(state, { type: 'answer', playerId: 'p0', text: `song ${i + 1}` }, (now += 100));
      state = run(state, { type: 'give-up', playerId: 'p1' }, (now += 100));
      if (i < 2) state = run(state, { type: 'next', roundIndex: i }, (now += 100));
    }
    expect(state).toMatchObject({ phase: 'reveal', roundIndex: 2 });
    return run(state, { type: 'pause', by: 'Ben' }, (now += 100));
  }

  it('is for the host screen or the leader, and nobody else', () => {
    const state = pausedMidGame();
    expect(reduce(state, { type: 'end-game', playerId: 'p1' }, 9000)).toEqual({
      ok: false,
      error: 'Only the host can end the game.',
    });
    expect(reduce(state, { type: 'end-game', playerId: 'nobody' }, 9000).ok).toBe(false);
    expect(run(state, { type: 'end-game', playerId: 'p0' }, 9000).phase).toBe('lobby');
    expect(run(state, { type: 'end-game', playerId: null }, 9000).phase).toBe('lobby');
  });

  it('only from the pause screen', () => {
    const playing = guessing(['Ana']);
    expect(reduce(playing, { type: 'end-game', playerId: null }, 2000).ok).toBe(false);
    const lobby = lobbyWith(['Ana']);
    expect(reduce(lobby, { type: 'end-game', playerId: null }, 2000).ok).toBe(false);
  });

  it('goes back to the lobby with everyone still in, scores cleared and the room as it was', () => {
    const before = pausedMidGame();
    expect(before.players[0].score).toBeGreaterThan(0);
    const state = run(before, { type: 'end-game', playerId: null }, 9000);

    expect(state).toMatchObject({
      phase: 'lobby',
      pause: null,
      rounds: [],
      roundIndex: 0,
      spares: [],
      finales: [],
      code: before.code,
      hostToken: before.hostToken,
      lobbyUrl: before.lobbyUrl,
      audioChecked: true,
      createdAt: before.createdAt,
    });
    expect(state.version).toBe(before.version + 1);
    expect(state.players.map((p) => [p.id, p.token, p.name, p.score])).toEqual([
      ['p0', 't0', 'Ana', 0],
      ['p1', 't1', 'Ben', 0],
    ]);
    // The three songs heard stay heard; the seven never played may come up again.
    expect(state.playedSongIds).toEqual(SONGS.slice(0, 3).map((s) => s.id));

    const host = viewFor(state, { role: 'host' }, 9000);
    expect(host).toMatchObject({ phase: 'lobby', round: null, pause: null, audioChecked: true });
    expect(host.finaleUrls).toBeUndefined();
    expect(host.players.every((p) => !p.answered && !p.gaveUp && p.score === 0)).toBe(true);
  });

  it('keeps anything else the room holds, so later lobby settings survive', () => {
    const before = { ...pausedMidGame(), somePreference: 'kept' } as RoomState;
    const state = run(before, { type: 'end-game', playerId: null }, 9000);
    expect((state as RoomState & { somePreference: string }).somePreference).toBe('kept');
  });

  it('can start a fresh game straight away, without checking the sound again', () => {
    let state = run(pausedMidGame(), { type: 'end-game', playerId: 'p0' }, 9000);
    const fresh = SONGS.map((s) => song(s.id + 500));
    state = run(state, { type: 'start', songs: fresh, spares: SPARES }, 9100);
    expect(state).toMatchObject({ phase: 'loading', roundIndex: 0, pause: null });
    expect(state.rounds[0].song.id).toBe(501);
    state = run(state, { type: 'audio-started', roundIndex: 0 }, 9200);
    state = run(state, { type: 'answer', playerId: 'p0', text: 'song 501' }, 9300);
    expect(state.rounds[0].answers.p0.correct).toBe(true);
    expect(state.playedSongIds).toEqual([1, 2, 3, ...fresh.map((s) => s.id)]);
  });
});

describe('game format', () => {
  const TWELVE: GameFormat = { counts: { title: 4, artist: 4, year: 2, album: 2 }, plays: 1 };
  const many = (n: number) => Array.from({ length: n }, (_, i) => song(i + 1));

  function startWith(format: GameFormat, names = ['Ana'], songs = many(30)): RoomState {
    let state = run(lobbyWith(names), { type: 'format', format }, 0);
    state = run(state, { type: 'start', songs, spares: SPARES }, 500);
    return state;
  }

  it('starts a fresh room in the default format', () => {
    const state = lobbyWith(['Ana']);
    expect(viewFor(state, { role: 'host' }, 0).format).toEqual({
      counts: { title: 3, artist: 3, year: 2, album: 2 },
      plays: 1,
    });
  });

  it('lays out the rounds the room asked for, easiest first', () => {
    const state = startWith(TWELVE);
    expect(state.rounds.map((r) => r.kind)).toEqual([
      ...Array(4).fill('title'),
      ...Array(4).fill('artist'),
      'year',
      'year',
      'album',
      'album',
    ]);
    // Only the songs that became rounds count as heard.
    expect(state.playedSongIds).toEqual(many(12).map((s) => s.id));
    const view = viewFor(state, { role: 'player', playerId: 'p0' }, 500);
    expect(view.round).toMatchObject({
      total: 12,
      kinds: state.rounds.map((r) => r.kind),
      plays: 1,
      guessMs: GUESS_MS,
    });
  });

  it('skips a kind with no rounds, and announces each kind that is played', () => {
    let state = startWith({ counts: { title: 1, artist: 0, year: 0, album: 2 }, plays: 1 });
    expect(state.rounds.map((r) => r.kind)).toEqual(['title', 'album', 'album']);
    const changed: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      changed.push(viewFor(state, { role: 'host' }, 0).round!.kindChanged);
      state = run(state, { type: 'audio-started', roundIndex: i }, 1000 * (i + 1));
      state = run(state, { type: 'give-up', playerId: 'p0' }, 1000 * (i + 1) + 10);
      state = run(state, { type: 'next', roundIndex: i }, 1000 * (i + 1) + 20);
    }
    expect(changed).toEqual([true, true, false]);
    expect(state.phase).toBe('finished');
  });

  it('wants a song for every round before it starts', () => {
    const state = run(lobbyWith(['Ana']), { type: 'format', format: TWELVE }, 0);
    expect(reduce(state, { type: 'start', songs: many(11), spares: SPARES }, 10)).toEqual({
      ok: false,
      error: 'Not enough songs to start.',
    });
    const two: GameFormat = { counts: { title: 2, artist: 0, year: 0, album: 0 }, plays: 1 };
    const short = run(lobbyWith(['Ana']), { type: 'format', format: two }, 0);
    expect(run(short, { type: 'start', songs: many(2), spares: [] }, 10).rounds).toHaveLength(2);
  });

  it('gives a song played twice twice the window, deadline and all', () => {
    let state = startWith({ ...TWELVE, plays: 2 }, ['Ana', 'Ben']);
    state = run(state, { type: 'audio-started', roundIndex: 0 }, 1000);
    const view = viewFor(state, { role: 'host' }, 1000);
    expect(view.round).toMatchObject({ plays: 2, guessMs: 2 * GUESS_MS });
    expect(phaseDeadline(view)).toBe(1000 + 2 * GUESS_MS + ANSWER_GRACE_MS);

    // Still open after the first play is over.
    expect(run(state, { type: 'tick' }, 1000 + GUESS_MS + ANSWER_GRACE_MS + 1)).toBe(state);
    const timedOut = run(state, { type: 'tick' }, 1000 + 2 * GUESS_MS + ANSWER_GRACE_MS);
    expect(timedOut.phase).toBe('reveal');
    expect(timedOut.rounds[0].revealStartedAt).toBe(1000 + 2 * GUESS_MS);
  });

  it('scores speed across every play, so waiting for the replay costs points', () => {
    let state = startWith({ ...TWELVE, plays: 2 }, ['Ana', 'Ben', 'Cy']);
    state = run(state, { type: 'audio-started', roundIndex: 0 }, 1000);
    // Ana at the end of the first play, halfway through the window: 750, not the buzzer's 500.
    state = run(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, 1000 + GUESS_MS);
    expect(state.rounds[0].answers.p0).toMatchObject({ correct: true, points: 750, elapsedMs: GUESS_MS });
    // Ben during the replay, near the buzzer, and Cy taps out after it would have ended once.
    state = run(state, { type: 'give-up', playerId: 'p2' }, 1000 + GUESS_MS + 5000);
    expect(state.rounds[0].answers.p2.elapsedMs).toBe(GUESS_MS + 5000);
    state = run(state, { type: 'answer', playerId: 'p1', text: 'song 1' }, 1000 + 2 * GUESS_MS);
    expect(state.rounds[0].answers.p1.points).toBe(500);
    expect(state.phase).toBe('reveal');
  });

  it('only changes between games', () => {
    const playing = guessing(['Ana']);
    expect(reduce(playing, { type: 'format', format: TWELVE }, 2000)).toEqual({
      ok: false,
      error: 'The game is already running.',
    });
    // A running game keeps the window its rounds were laid out with.
    const twice = startWith({ ...TWELVE, plays: 2 });
    expect(twice.rounds.every((r) => r.plays === 2)).toBe(true);
    expect(run(lobbyWith(['Ana']), { type: 'format', format: TWELVE }, 0).format).toEqual(TWELVE);
  });

  it('keeps the format through the end of a game and back to the lobby', () => {
    let state = startWith(TWELVE, ['Ana']);
    state = run(state, { type: 'audio-started', roundIndex: 0 }, 1000);
    state = run(state, { type: 'pause', by: 'Ana' }, 1100);
    state = run(state, { type: 'end-game', playerId: null }, 1200);
    expect(state.format).toEqual(TWELVE);
  });

  it('plays a room from before formats, and a game from before them, as it always did', () => {
    const legacy: RoomState = { ...lobbyWith(['Ana']) };
    delete legacy.format;
    expect(viewFor(legacy, { role: 'host' }, 0).format.counts.title).toBe(3);
    let state = run(legacy, { type: 'start', songs: SONGS, spares: SPARES }, 0);
    expect(state.rounds.map((r) => r.kind)).toEqual(ROUND_KINDS);

    // Rounds stored without a window, mid-game when the code changed.
    state = {
      ...state,
      rounds: state.rounds.map((r) => {
        const old = { ...r };
        delete old.plays;
        return old;
      }),
    };
    state = run(state, { type: 'audio-started', roundIndex: 0 }, 1000);
    expect(viewFor(state, { role: 'host' }, 1000).round).toMatchObject({ plays: 1, guessMs: GUESS_MS });
    expect(run(state, { type: 'tick' }, 1000 + GUESS_MS + ANSWER_GRACE_MS).phase).toBe('reveal');
  });
});

describe('views', () => {
  it('keeps the answer away from every screen until the reveal', () => {
    let state = guessing(['Ana', 'Ben']);
    state = run(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, 2000);

    const player = viewFor(state, { role: 'player', playerId: 'p0' }, 2000);
    const host = viewFor(state, { role: 'host' }, 2000);
    expect(JSON.stringify(player)).not.toContain('Song 1');
    expect(JSON.stringify(player)).not.toContain('audio/');
    expect(JSON.stringify(player)).not.toContain('t0');
    expect(JSON.stringify(host)).not.toContain('Song 1');
    expect(host.round?.previewUrl).toBe('https://audio/1.m4a');
    expect(player.you?.answer).toEqual({ text: 'song 1', elapsedMs: 1000, gaveUp: false });
    expect(player.players.map((p) => p.answered)).toEqual([true, false]);

    state = run(state, { type: 'answer', playerId: 'p1', text: 'x' }, 3000);
    const revealed = viewFor(state, { role: 'player', playerId: 'p1' }, 3000);
    expect(revealed.round?.song?.title).toBe('Song 1');
    expect(revealed.round?.answers).toHaveLength(2);
    expect(JSON.stringify(revealed)).not.toContain('host-token');
  });
});

describe('catalog', () => {
  it('never repeats an artist or a heard song while it has a choice', () => {
    const songs = [
      ...Array.from({ length: 20 }, (_, i) => song(i + 1)),
      song(50, { artist: 'Artist 1' }),
    ];
    const picked = chooseSongs(10, [1, 2, 3], Math.random, songs);
    expect(picked).toHaveLength(10);
    expect(new Set(picked.map((s) => s.artist)).size).toBe(10);
    expect(picked.some((s) => [1, 2, 3].includes(s.id))).toBe(false);
  });

  it('treats a duet as the lead artist for variety', () => {
    const songs = [song(1, { artist: 'Queen' }), song(2, { artist: 'Queen & David Bowie' }), song(3)];
    const picked = chooseSongs(2, [], Math.random, songs);
    expect(picked.map((s) => s.artist).filter((a) => a.startsWith('Queen'))).toHaveLength(1);
  });

  it('ends on party songs the game did not ask about, opening on a different one each game', () => {
    const all = chooseFinales([]);
    expect(all.length).toBeGreaterThan(3);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (let i = 0; i < 20; i++) {
      const next = chooseFinales([all[1]], all[0].id);
      expect(next[0].id).not.toBe(all[0].id);
      expect(next.some((s) => s.id === all[1].id)).toBe(false);
    }
  });

  it('repeats the songs heard longest ago first, once everything has been heard', () => {
    const songs = Array.from({ length: 6 }, (_, i) => song(i + 1));
    const picked = chooseSongs(2, [4, 2, 6, 1, 5, 3], Math.random, songs);
    expect(picked.map((s) => s.id)).toEqual([4, 2]);
  });

  it('falls back to repeats rather than coming up short', () => {
    const songs = Array.from({ length: 6 }, (_, i) => song(i + 1, { artist: 'Same' }));
    expect(chooseSongs(5, [1, 2], Math.random, songs)).toHaveLength(5);
  });
});

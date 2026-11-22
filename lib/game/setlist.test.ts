import { describe, expect, it } from 'vitest';

import { ROUNDS_PER_GAME } from './config';
import { createRoom, reduce } from './reducer';
import {
  CLASSIC,
  cleanTaste,
  combineTastes,
  familyOfGenre,
  NO_TASTE,
  tastesFor,
  type Setlist,
  type Taste,
} from './setlist';
import type { Action, RoomState, Song } from './types';
import { viewFor } from './views';

function song(id: number): Song {
  return {
    id,
    title: `Song ${id}`,
    artist: `Artist ${id}`,
    album: `Album ${id}`,
    year: 1990,
    genre: 'Pop',
    artworkUrl: '',
    previewUrl: `https://audio/${id}.m4a`,
  };
}

const SONGS = Array.from({ length: ROUNDS_PER_GAME }, (_, i) => song(i + 1));
const ROCK_80S: Taste = { genres: ['rock'], decades: [1980] };
const POP: Taste = { genres: ['pop'], decades: [] };

function run(state: RoomState, action: Action, now = 0): RoomState {
  const result = reduce(state, action, now);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function refused(state: RoomState, action: Action): string {
  const result = reduce(state, action, 0);
  if (result.ok) throw new Error(`${action.type} was allowed`);
  return result.error;
}

function lobby(names: string[]): RoomState {
  let state = createRoom('ABCD', 'host-token', 0);
  names.forEach((name, i) => {
    state = run(state, { type: 'join', playerId: `p${i}`, token: `t${i}`, name });
  });
  return state;
}

describe('setlist picks', () => {
  it('keeps only known genres and decades, in order, from untrusted input', () => {
    expect(cleanTaste({ genres: ['alt', 'jazz', 'pop', 'pop'], decades: [2020, 1985, 1960] })).toEqual({
      genres: ['pop', 'alt'],
      decades: [1960, 2020],
    });
    expect(cleanTaste({ genres: [], decades: [] })).toEqual(NO_TASTE);
    expect(cleanTaste(null)).toBeNull();
    expect(cleanTaste({ genres: 'pop', decades: [] })).toBeNull();
    expect(cleanTaste('rock')).toBeNull();
  });

  it('knows the iTunes genres by family, and leaves Soundtrack to the artist', () => {
    expect(familyOfGenre('Hip-Hop/Rap')).toBe('hiphop');
    expect(familyOfGenre('R&B/Soul')).toBe('rnb');
    expect(familyOfGenre('Hard Rock')).toBe('rock');
    expect(familyOfGenre('Alternative')).toBe('alt');
    expect(familyOfGenre('Adult Contemporary')).toBe('pop');
    expect(familyOfGenre('Soundtrack')).toBeNull();
  });

  it('follows the mode: no tastes in Classic, the host’s in Host picks, present players’ in Crowd picks', () => {
    const setlist: Setlist = { mode: 'classic', host: ROCK_80S, picks: { p0: POP, p1: ROCK_80S, gone: POP } };
    expect(tastesFor(setlist, ['p0', 'p1'])).toEqual([]);
    expect(tastesFor({ ...setlist, mode: 'host' }, ['p0', 'p1'])).toEqual([ROCK_80S]);
    expect(tastesFor({ ...setlist, mode: 'host', host: NO_TASTE }, ['p0'])).toEqual([]);
    expect(tastesFor({ ...setlist, mode: 'crowd' }, ['p0', 'p1'])).toEqual([POP, ROCK_80S]);
    expect(tastesFor({ ...setlist, mode: 'crowd', picks: { p0: NO_TASTE } }, ['p0'])).toEqual([]);
    expect(tastesFor(undefined, ['p0'])).toEqual([]);
  });

  it('adds the room’s picks up for the TV', () => {
    const { genres, decades } = combineTastes([POP, ROCK_80S, { genres: ['rock'], decades: [1990] }]);
    expect(genres.map((g) => [g.id, g.votes])).toEqual([
      ['rock', 2],
      ['pop', 1],
    ]);
    expect(decades.map((d) => [d.id, d.votes])).toEqual([
      [1980, 1],
      [1990, 1],
    ]);
  });
});

describe('setlist actions', () => {
  it('starts every room on Classic', () => {
    expect(createRoom('ABCD', 'h', 0).setlist).toEqual(CLASSIC);
  });

  it('lets the host set the mode and their picks between games', () => {
    let state = run(lobby(['Ana']), { type: 'setlist', mode: 'host', taste: ROCK_80S });
    expect(state.setlist).toEqual({ mode: 'host', host: ROCK_80S, picks: {} });

    state = run(state, { type: 'start', songs: SONGS, spares: [] });
    expect(refused(state, { type: 'setlist', mode: 'classic', taste: NO_TASTE })).toMatch(/running/);
  });

  it('takes a player’s picks in Crowd picks only, and keeps them when the mode changes', () => {
    let state = lobby(['Ana', 'Ben']);
    expect(refused(state, { type: 'taste', playerId: 'p0', taste: POP })).toMatch(/host/);

    state = run(state, { type: 'setlist', mode: 'crowd', taste: NO_TASTE });
    state = run(state, { type: 'taste', playerId: 'p0', taste: POP });
    state = run(state, { type: 'taste', playerId: 'p1', taste: ROCK_80S });
    state = run(state, { type: 'taste', playerId: 'p0', taste: ROCK_80S });
    expect(state.setlist!.picks).toEqual({ p0: ROCK_80S, p1: ROCK_80S });
    expect(refused(state, { type: 'taste', playerId: 'stranger', taste: POP })).toMatch(/not in this room/);

    state = run(state, { type: 'setlist', mode: 'classic', taste: NO_TASTE });
    state = run(state, { type: 'setlist', mode: 'crowd', taste: NO_TASTE });
    expect(state.setlist!.picks).toEqual({ p0: ROCK_80S, p1: ROCK_80S });

    state = run(state, { type: 'start', songs: SONGS, spares: [] });
    expect(refused(state, { type: 'taste', playerId: 'p0', taste: POP })).toMatch(/running/);
  });

  it('copes with a room stored before setlists existed', () => {
    const old = { ...lobby(['Ana']), setlist: undefined } as RoomState;
    expect(viewFor(old, { role: 'host' }, 0).setlist).toEqual({ mode: 'classic', host: NO_TASTE });
    expect(refused(old, { type: 'taste', playerId: 'p0', taste: POP })).toMatch(/host/);
    expect(run(old, { type: 'setlist', mode: 'crowd', taste: POP }).setlist).toEqual({
      mode: 'crowd',
      host: POP,
      picks: {},
    });
  });
});

describe('setlist views', () => {
  function crowd(): RoomState {
    let state = run(lobby(['Ana', 'Ben', 'Cy']), { type: 'setlist', mode: 'crowd', taste: ROCK_80S });
    state = run(state, { type: 'taste', playerId: 'p0', taste: POP });
    state = run(state, { type: 'taste', playerId: 'p2', taste: ROCK_80S });
    return run(state, { type: 'remove-player', playerId: 'p2' });
  }

  it('shows the TV the picks of players still here', () => {
    const host = viewFor(crowd(), { role: 'host' }, 0);
    expect(host.setlist).toEqual({ mode: 'crowd', host: ROCK_80S, picks: { p0: POP } });
  });

  it('shows a phone the mode and its own picks, and nobody else’s', () => {
    const ana = viewFor(crowd(), { role: 'player', playerId: 'p0' }, 0);
    expect(ana.setlist).toEqual({ mode: 'crowd' });
    expect(ana.you!.taste).toEqual(POP);
    const ben = viewFor(crowd(), { role: 'player', playerId: 'p1' }, 0);
    expect(ben.you!.taste).toBeNull();
    expect(JSON.stringify(ben)).not.toContain('"pop"');
  });

  it('keeps the host’s picks off the phones in Host picks', () => {
    const state = run(lobby(['Ana']), { type: 'setlist', mode: 'host', taste: ROCK_80S });
    const ana = viewFor(state, { role: 'player', playerId: 'p0' }, 0);
    expect(ana.setlist).toEqual({ mode: 'host' });
    expect(viewFor(state, { role: 'host' }, 0).setlist.picks).toBeUndefined();
  });
});

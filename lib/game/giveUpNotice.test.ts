import { describe, expect, it } from 'vitest';

import { ROUNDS_PER_GAME } from './config';
import { DEFAULT_GIVE_UP_NOTICE, isGiveUpNotice } from './giveUpNotice';
import { createRoom, reduce } from './reducer';
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

function run(state: RoomState, action: Action, now = 0): RoomState {
  const result = reduce(state, action, now);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function lobby(names: string[]): RoomState {
  let state = createRoom('ABCD', 'host-token', 0);
  names.forEach((name, i) => {
    state = run(state, { type: 'join', playerId: `p${i}`, token: `t${i}`, name });
  });
  return run(state, { type: 'audio-check' });
}

function guessing(names: string[]): RoomState {
  let state = run(lobby(names), { type: 'start', songs: SONGS, spares: [] }, 1000);
  state = run(state, { type: 'audio-started', roundIndex: 0 }, 1000);
  return state;
}

const player = (state: RoomState, playerId: string, now = 0) =>
  viewFor(state, { role: 'player', playerId }, now);

describe('give-up notices', () => {
  it('go to everyone’s phones by default, in new rooms and in rooms from before the setting', () => {
    expect(DEFAULT_GIVE_UP_NOTICE).toBe('everyone');
    const fresh = lobby(['Ana']);
    expect(player(fresh, 'p0').giveUpNotice).toBe('everyone');

    const legacy: RoomState = { ...fresh };
    delete legacy.giveUpNotice;
    expect(player(legacy, 'p0').giveUpNotice).toBe('everyone');
    expect(viewFor(legacy, { role: 'host' }, 0).giveUpNotice).toBe('everyone');
  });

  it('follow the host’s choice, on every screen', () => {
    const before = lobby(['Ana', 'Ben']);
    const state = run(before, { type: 'give-up-notice', notice: 'host' });
    expect(state.giveUpNotice).toBe('host');
    expect(state.version).toBe(before.version + 1);
    expect(player(state, 'p0').giveUpNotice).toBe('host');
    expect(player(state, 'p1').giveUpNotice).toBe('host');
    expect(viewFor(state, { role: 'host' }, 0).giveUpNotice).toBe('host');

    const back = run(state, { type: 'give-up-notice', notice: 'everyone' });
    expect(player(back, 'p1').giveUpNotice).toBe('everyone');
  });

  it('change nothing when the room already has that choice, so nobody redraws', () => {
    const state = lobby(['Ana']);
    expect(run(state, { type: 'give-up-notice', notice: 'everyone' })).toBe(state);
    const legacy: RoomState = { ...state };
    delete legacy.giveUpNotice;
    expect(run(legacy, { type: 'give-up-notice', notice: 'everyone' })).toBe(legacy);
  });

  it('may change mid-game without touching the round', () => {
    let state = guessing(['Ana', 'Ben']);
    state = run(state, { type: 'give-up', playerId: 'p1' }, 2000);
    const changed = run(state, { type: 'give-up-notice', notice: 'host' }, 2100);
    expect(changed).toMatchObject({ phase: 'guessing', giveUpNotice: 'host' });
    expect(changed.rounds).toBe(state.rounds);
  });

  it('rely on a give-up being public to the other phones the moment it happens', () => {
    let state = guessing(['Ana', 'Ben', 'Cleo']);
    state = run(state, { type: 'give-up', playerId: 'p1' }, 2000);
    const ana = player(state, 'p0', 2000);
    expect(ana.phase).toBe('guessing');
    expect(ana.players.map((p) => [p.name, p.gaveUp])).toEqual([
      ['Ana', false],
      ['Ben', true],
      ['Cleo', false],
    ]);
  });

  it('only accept the two choices', () => {
    expect(isGiveUpNotice('everyone')).toBe(true);
    expect(isGiveUpNotice('host')).toBe(true);
    expect(isGiveUpNotice('nobody')).toBe(false);
    expect(isGiveUpNotice(undefined)).toBe(false);
    expect(isGiveUpNotice({})).toBe(false);
  });
});

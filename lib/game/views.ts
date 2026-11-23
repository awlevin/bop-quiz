import { CLASSIC } from './setlist';
import type { RoomState, RoomView, RoundView } from './types';

export type Viewer = { role: 'host' } | { role: 'player'; playerId: string };

/** What one screen is allowed to know. The answer stays server-side until the reveal. */
export function viewFor(state: RoomState, viewer: Viewer, now: number): RoomView {
  const round = state.rounds[state.roundIndex];
  const inRound = state.phase !== 'lobby' && round !== undefined;
  const revealed = state.phase === 'reveal' || state.phase === 'finished';

  let roundView: RoundView | null = null;
  if (inRound) {
    roundView = {
      index: state.roundIndex,
      total: state.rounds.length,
      kind: round.kind,
      kindChanged: state.rounds[state.roundIndex - 1]?.kind !== round.kind,
      guessStartedAt: round.guessStartedAt,
      revealStartedAt: round.revealStartedAt,
    };
    if (viewer.role === 'host') {
      roundView.previewUrl = round.song.previewUrl;
      roundView.nextPreviewUrl = state.rounds[state.roundIndex + 1]?.song.previewUrl;
    }
    if (viewer.role === 'host' && state.phase === 'guessing' && round.heckles?.length) {
      roundView.heckles = round.heckles;
    }
    if (revealed) {
      roundView.song = round.song;
      roundView.answers = Object.entries(round.answers).map(([playerId, a]) => ({
        playerId,
        ...a,
      }));
    }
  }

  const setlist = state.setlist ?? CLASSIC;
  const view: RoomView = {
    code: state.code,
    version: state.version,
    phase: state.phase,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      answered: inRound && Boolean(round.answers[p.id]),
      gaveUp: inRound && Boolean(round.answers[p.id]?.gaveUp),
      ridingWith: (inRound && round.answers[p.id]?.ride) || null,
    })),
    round: roundView,
    pause: state.pause ?? null,
    audioChecked: state.audioChecked !== false,
    rideAlong: Boolean(state.rideAlong),
    setlist: { mode: setlist.mode },
    serverNow: now,
  };

  if (viewer.role === 'host') {
    view.setlist.host = setlist.host;
    // Only the picks of players still here: someone who left no longer counts.
    if (setlist.mode === 'crowd') {
      view.setlist.picks = Object.fromEntries(
        state.players.flatMap((p) => (setlist.picks[p.id] ? [[p.id, setlist.picks[p.id]]] : [])),
      );
    }
  }

  const lastRound = state.roundIndex === state.rounds.length - 1;
  if (viewer.role === 'host' && revealed && lastRound && state.finales?.length) {
    view.finaleUrls = state.finales.map((s) => s.previewUrl);
  }

  if (viewer.role === 'host' && state.phase === 'lobby' && state.lobbyUrl) {
    view.lobbyUrl = state.lobbyUrl;
  }

  if (viewer.role === 'player') {
    const mine = inRound ? round.answers[viewer.playerId] : undefined;
    view.you = {
      id: viewer.playerId,
      leader: state.players[0]?.id === viewer.playerId,
      answer: mine
        ? { text: mine.text, elapsedMs: mine.elapsedMs, gaveUp: Boolean(mine.gaveUp), ride: mine.ride ?? null }
        : null,
      taste: setlist.picks[viewer.playerId] ?? null,
    };
  }
  return view;
}

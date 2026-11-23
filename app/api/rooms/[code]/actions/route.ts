import { pickSongs } from '@/lib/catalog';
import { ROUNDS_PER_GAME, SPARE_SONGS } from '@/lib/game/config';
import { isHeckleKind } from '@/lib/game/heckles';
import { cleanTaste, isSetlistMode, tastesFor } from '@/lib/game/setlist';
import type { Action } from '@/lib/game/types';
import { dispatch, identify, newPlayerId, newToken, normalizeCode } from '@/lib/realtime/rooms';
import { getStore } from '@/lib/realtime/store';

export const dynamic = 'force-dynamic';

const refuse = (status: number, error: string) => Response.json({ error }, { status });

interface Body {
  type?: string;
  token?: string;
  name?: string;
  text?: string;
  playerId?: string;
  roundIndex?: number;
  mode?: unknown;
  taste?: unknown;
  ride?: unknown;
  kind?: unknown;
  rideAlong?: unknown;
}

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/rooms/[code]/actions'>,
): Promise<Response> {
  const code = normalizeCode((await ctx.params).code);
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.type) return refuse(400, 'Missing action.');

  if (body.type === 'join') {
    const playerId = newPlayerId();
    const token = newToken();
    const result = await dispatch(code, {
      type: 'join',
      playerId,
      token,
      name: String(body.name ?? ''),
    });
    if (!result.ok) return refuse(result.status, result.error);
    return Response.json({ playerId, token });
  }

  const room = await getStore().get(code);
  if (!room) return refuse(404, 'That room has closed.');
  const viewer = identify(room, body.token ?? null);
  if (!viewer) return refuse(401, 'You are not in this room.');

  const roundIndex = Number(body.roundIndex);
  let action: Action | null = null;

  // Setlist picks are checked here, before any of it reaches the room.
  const taste = cleanTaste(body.taste);
  if ((body.type === 'setlist' || body.type === 'taste') && !taste) return refuse(400, 'That is not a pick.');
  if (body.type === 'setlist' && !isSetlistMode(body.mode)) return refuse(400, 'There is no such setlist.');

  if (body.type === 'tick') action = { type: 'tick' };
  if (body.type === 'next') action = { type: 'next', roundIndex };
  if (body.type === 'resume') action = { type: 'resume' };
  if (body.type === 'pause') {
    const by =
      viewer.role === 'player'
        ? (room.players.find((p) => p.id === viewer.playerId)?.name ?? 'Someone')
        : 'The host';
    action = { type: 'pause', by };
  }

  // The TV can start a game, and so can the first player, from their phone.
  const leader = viewer.role === 'player' && room.players[0]?.id === viewer.playerId;
  if (body.type === 'start' && (viewer.role === 'host' || leader)) {
    // The reducer refuses too; this just skips drawing songs for nothing.
    if (room.audioChecked === false) return refuse(409, 'Check the sound on the big screen first.');
    const { songs, finales } = await pickSongs(
      ROUNDS_PER_GAME + SPARE_SONGS,
      room.playedSongIds,
      room.finales?.[0]?.id,
      // Crowd picks or Host picks; none at all is a Classic draw.
      tastesFor(room.setlist, room.players.map((p) => p.id)),
    );
    action = {
      type: 'start',
      songs: songs.slice(0, ROUNDS_PER_GAME),
      spares: songs.slice(ROUNDS_PER_GAME),
      finales,
    };
  }

  // Ending a game is the host's call: the TV, or the leader on their phone.
  if (body.type === 'end-game') {
    if (viewer.role === 'player' && !leader) return refuse(403, 'Only the host can end the game.');
    action = { type: 'end-game', playerId: viewer.role === 'host' ? null : viewer.playerId };
  }

  if (viewer.role === 'host') {
    // Only the host screen plays sound, so only it can say it was heard.
    if (body.type === 'audio-check') action = { type: 'audio-check' };
    if (body.type === 'audio-started') action = { type: 'audio-started', roundIndex };
    if (body.type === 'audio-failed') action = { type: 'audio-failed', roundIndex };
    if (body.type === 'remove-player' && body.playerId) {
      action = { type: 'remove-player', playerId: body.playerId };
    }
    if (body.type === 'setlist' && isSetlistMode(body.mode) && taste) {
      action = { type: 'setlist', mode: body.mode, taste };
    }
    if (body.type === 'rules') action = { type: 'rules', rideAlong: body.rideAlong === true };
  } else {
    const { playerId } = viewer;
    if (body.type === 'answer') action = { type: 'answer', playerId, text: String(body.text ?? '') };
    if (body.type === 'give-up') {
      action = { type: 'give-up', playerId, ...(typeof body.ride === 'string' && { ride: body.ride }) };
    }
    if (body.type === 'heckle') {
      if (!isHeckleKind(body.kind)) return refuse(400, 'That is not a heckle.');
      action = { type: 'heckle', playerId, kind: body.kind };
    }
    if (body.type === 'rename') action = { type: 'rename', playerId, name: String(body.name ?? '') };
    if (body.type === 'leave') action = { type: 'remove-player', playerId };
    if (body.type === 'taste' && taste) action = { type: 'taste', playerId, taste };
  }

  if (!action) return refuse(403, 'That action is not available to you.');
  const result = await dispatch(code, action);
  if (!result.ok) return refuse(result.status, result.error);
  return Response.json({ ok: true });
}

import { drawGame } from '@/lib/catalog/preview';
import { isSetlistMode } from '@/lib/game/setlist';

export const dynamic = 'force-dynamic';

/** One game's draw, as `/shuffle` shows it. Every call is a fresh shuffle; `?mode=crowd` follows sample picks. */
export async function GET(request: Request): Promise<Response> {
  const mode = new URL(request.url).searchParams.get('mode');
  return Response.json(await drawGame(isSetlistMode(mode) ? mode : 'classic'), {
    headers: { 'cache-control': 'no-store' },
  });
}

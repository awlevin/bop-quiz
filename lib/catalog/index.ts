// Where songs come from. Today the catalog is a JSON file in the repo; the
// plan (docs/ROADMAP.md) is to move it to a database that grows as people
// play. Everything outside this folder goes through `pickSongs`, so that move
// touches nothing else.

import catalog from '@/data/catalog.json';
import finales from '@/data/finales.json';
import lobby from '@/data/lobby.json';
import { benchedSongIds } from '@/lib/feedback/store';
import type { GenreFamily, Taste } from '@/lib/game/setlist';
import type { Song } from '@/lib/game/types';

import { refreshPreviews } from './itunes';
import { drawForTastes, familyResolver } from './setlist';
import { primaryArtist, shuffle } from './util';

const SONGS = catalog as Song[];
/** Party songs for the final scores: "Celebration" and friends. One plays per game. */
const FINALES = finales as Song[];

/**
 * `count` songs this room has not heard, no artist twice. Only when the
 * catalog runs dry does it repeat, and then the songs heard longest ago come
 * first. `excludeIds` is oldest first.
 *
 * With `tastes` (Crowd picks or Host picks), the unheard songs are drawn for
 * those tastes, closest first (`drawForTastes`); without, at random.
 */
export function chooseSongs(
  count: number,
  excludeIds: readonly number[],
  random: () => number = Math.random,
  songs: readonly Song[] = SONGS,
  tastes: readonly Taste[] = [],
): Song[] {
  const exclude = new Set(excludeIds);
  const fresh = shuffle(
    songs.filter((s) => !exclude.has(s.id)),
    random,
  );
  const lastHeard = new Map(excludeIds.map((id, i) => [id, i]));
  const heard = songs
    .filter((s) => exclude.has(s.id))
    .sort((a, b) => lastHeard.get(a.id)! - lastHeard.get(b.id)!);

  const picked = tastes.length ? drawForTastes(tastes, count, fresh, random, songs) : [];
  const taken = new Set(picked.map((s) => s.id));
  const artists = new Set(picked.map((s) => primaryArtist(s.artist)));
  const leftovers: Song[] = [];
  for (const song of [...fresh, ...heard]) {
    if (picked.length === count) break;
    if (taken.has(song.id)) continue;
    const artist = primaryArtist(song.artist);
    if (artists.has(artist)) {
      leftovers.push(song);
      continue;
    }
    artists.add(artist);
    picked.push(song);
  }
  return [...picked, ...leftovers].slice(0, count);
}

/**
 * Songs for one game and the finale, exactly as a room draws them, but with
 * the preview URLs still as stored. The shuffle preview page uses this to
 * show what a game would have played without a trip to iTunes.
 */
export async function drawSongs(
  count: number,
  excludeIds: readonly number[],
  lastFinaleId?: number,
  tastes: readonly Taste[] = [],
): Promise<{ songs: Song[]; finales: Song[] }> {
  // Songs someone has reported sit out until the report is closed.
  const benched = new Set(await benchedSongIds().catch(() => []));
  const playable = SONGS.filter((s) => !benched.has(s.id));
  const songs = chooseSongs(count, excludeIds, Math.random, playable, tastes);
  return { songs, finales: chooseFinales(songs, lastFinaleId) };
}

/** Songs for one game and the finale, with preview URLs fetched fresh from iTunes. */
export async function pickSongs(
  count: number,
  excludeIds: readonly number[],
  lastFinaleId?: number,
  tastes: readonly Taste[] = [],
): Promise<{ songs: Song[]; finales: Song[] }> {
  const { songs, finales } = await drawSongs(count, excludeIds, lastFinaleId, tastes);
  const fresh = await refreshPreviews([...songs, ...finales]);
  return { songs: fresh.slice(0, songs.length), finales: fresh.slice(songs.length) };
}

let families: ((song: Song) => GenreFamily) | null = null;

/** The genre family a setlist pick would file this song under. */
export function songFamily(song: Song): GenreFamily {
  families ??= familyResolver(SONGS);
  return families(song);
}

/** A catalog song by iTunes id, or undefined. Finales count. */
export function findSong(id: number): Song | undefined {
  return SONGS.find((s) => s.id === id) ?? FINALES.find((s) => s.id === id);
}

/** "Feel It Still", for the lobby, with a fresh preview URL. */
export async function lobbySong(): Promise<Song> {
  return (await refreshPreviews([lobby as Song]))[0];
}

/**
 * The party songs for the final scores, shuffled: none that this game asked
 * about, and not opening on the one the last game opened on.
 */
export function chooseFinales(
  questions: readonly Song[],
  lastFinaleId?: number,
  random: () => number = Math.random,
): Song[] {
  const asked = new Set(questions.map((s) => s.id));
  const order = shuffle(
    FINALES.filter((s) => !asked.has(s.id)),
    random,
  );
  if (order.length > 1 && order[0].id === lastFinaleId) order.push(order.shift()!);
  return order;
}

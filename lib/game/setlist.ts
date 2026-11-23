// Setlist modes: where a game's songs come from.
//
// Classic draws from the whole catalog. Crowd picks lets each player choose
// the genres and decades they like, on their phone, and draws from everyone's
// picks together. Host picks lets the TV choose for the room. Difficulty
// draws from the best-known songs of every decade: the top 10 of each on
// Easy, 20 on Medium, 30 on Hard, or any number the host types. The picks live
// in the room so that whoever presses Start, TV or phone, gets the same draw.
// The draw itself is `chooseSongs` in lib/catalog.

export type SetlistMode = 'classic' | 'crowd' | 'host' | 'hits';

export const SETLIST_MODES: readonly { id: SetlistMode; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classic', hint: 'Songs from the whole catalog.' },
  { id: 'crowd', label: 'Crowd picks', hint: 'Each phone picks genres and decades.' },
  { id: 'host', label: 'Host picks', hint: 'This screen picks genres and decades.' },
  { id: 'hits', label: 'Difficulty', hint: 'Easy, Medium or Hard: the top hits of every decade.' },
];

/**
 * Difficulty presets: how many of each decade's best-known songs the game
 * draws from. The host can type any other number between MIN_DEPTH and
 * MAX_DEPTH instead. Rankings live in data/decade-ranks.json.
 */
export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: readonly { id: Difficulty; label: string; depth: number }[] = [
  { id: 'easy', label: 'Easy', depth: 10 },
  { id: 'medium', label: 'Medium', depth: 20 },
  { id: 'hard', label: 'Hard', depth: 30 },
];

export const MIN_DEPTH = 1;
/** More than any decade holds: the whole catalog. */
export const MAX_DEPTH = 50;
export const DEFAULT_DEPTH = DIFFICULTIES[0].depth;

/** The preset a depth matches, or null for a custom number. */
export function difficultyOf(depth: number): Difficulty | null {
  return DIFFICULTIES.find((d) => d.depth === depth)?.id ?? null;
}

/** A depth from untrusted input: a whole number, clamped into range. Null when it is not a number at all. */
export function cleanDepth(raw: unknown): number | null {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.round(n), MIN_DEPTH), MAX_DEPTH);
}

/** Broad families over the iTunes genre names, which are too fine to pick from. */
export type GenreFamily = 'pop' | 'rock' | 'rnb' | 'hiphop' | 'alt';

export const GENRE_FAMILIES: readonly { id: GenreFamily; label: string }[] = [
  { id: 'pop', label: 'Pop' },
  { id: 'rock', label: 'Rock' },
  { id: 'rnb', label: 'R&B & Soul' },
  { id: 'hiphop', label: 'Hip-Hop' },
  { id: 'alt', label: 'Alt & Indie' },
];

export const DECADES: readonly number[] = [1960, 1970, 1980, 1990, 2000, 2010, 2020];

/** What one person wants to hear. An empty list means any genre, or any decade. */
export interface Taste {
  genres: GenreFamily[];
  decades: number[];
}

export const NO_TASTE: Taste = { genres: [], decades: [] };

export interface Setlist {
  mode: SetlistMode;
  /** The TV's picks, used in host mode. */
  host: Taste;
  /** Each player's picks, by player id, used in crowd mode. */
  picks: Record<string, Taste>;
  /** Difficulty mode: how many of each decade's top songs to draw from. Absent: DEFAULT_DEPTH. */
  depth?: number;
}

export const CLASSIC: Setlist = { mode: 'classic', host: NO_TASTE, picks: {} };

// iTunes genre name -> family. Rarities fold into their nearest neighbour:
// Hard Rock into Rock, New Wave and Indie Rock into Alt, the crossover
// Country and Latin hits into Pop. A name not listed here (Soundtrack, or a
// genre a future catalog brings) takes the family of the artist's other
// songs; see `familyResolver` in lib/catalog.
const FAMILY_OF_GENRE: Record<string, GenreFamily> = {
  pop: 'pop',
  'adult contemporary': 'pop',
  vocal: 'pop',
  'pop/rock': 'pop',
  'teen pop': 'pop',
  dance: 'pop',
  electronic: 'pop',
  disco: 'pop',
  country: 'pop',
  latin: 'pop',
  'urbano latino': 'pop',
  'k-pop': 'pop',
  'singer/songwriter': 'pop',
  rock: 'rock',
  'hard rock': 'rock',
  metal: 'rock',
  'heavy metal': 'rock',
  'rock & roll': 'rock',
  'r&b/soul': 'rnb',
  'contemporary r&b': 'rnb',
  soul: 'rnb',
  funk: 'rnb',
  motown: 'rnb',
  'hip-hop/rap': 'hiphop',
  'hip-hop': 'hiphop',
  rap: 'hiphop',
  alternative: 'alt',
  'indie rock': 'alt',
  'indie pop': 'alt',
  'new wave': 'alt',
  punk: 'alt',
  grunge: 'alt',
};

/** The family an iTunes genre belongs to, or null when the name alone does not say. */
export function familyOfGenre(genre: string): GenreFamily | null {
  return FAMILY_OF_GENRE[genre.trim().toLowerCase()] ?? null;
}

export function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

export function isSetlistMode(value: unknown): value is SetlistMode {
  return SETLIST_MODES.some((m) => m.id === value);
}

/**
 * A taste from untrusted input: known genres and decades only, each once,
 * in display order. Null when it is not a taste at all.
 */
export function cleanTaste(raw: unknown): Taste | null {
  if (!raw || typeof raw !== 'object') return null;
  const { genres, decades } = raw as { genres?: unknown; decades?: unknown };
  if (!Array.isArray(genres) || !Array.isArray(decades)) return null;
  return {
    genres: GENRE_FAMILIES.map((g) => g.id).filter((id) => genres.includes(id)),
    decades: DECADES.filter((d) => decades.includes(d)),
  };
}

export function isEmptyTaste(taste: Taste): boolean {
  return taste.genres.length === 0 && taste.decades.length === 0;
}

export function sameTaste(a: Taste, b: Taste): boolean {
  return a.genres.join() === b.genres.join() && a.decades.join() === b.decades.join();
}

/**
 * The tastes a draw should follow: none in Classic, the host's in Host picks,
 * and in Crowd picks one per player still in the room who has picked
 * something. No tastes at all means a Classic draw.
 */
export function tastesFor(setlist: Setlist | undefined, playerIds: readonly string[]): Taste[] {
  if (!setlist) return [];
  if (setlist.mode === 'host') return isEmptyTaste(setlist.host) ? [] : [setlist.host];
  if (setlist.mode === 'crowd') {
    return playerIds.flatMap((id) => {
      const taste = setlist.picks[id];
      return taste && !isEmptyTaste(taste) ? [taste] : [];
    });
  }
  return [];
}

/** How deep into each decade's hits a draw goes: a number in Difficulty mode, null otherwise. */
export function depthFor(setlist: Setlist | undefined): number | null {
  return setlist?.mode === 'hits' ? (setlist.depth ?? DEFAULT_DEPTH) : null;
}

/** How many of `tastes` asked for each genre and each decade, most asked first. */
export function combineTastes(tastes: readonly Taste[]): {
  genres: { id: GenreFamily; label: string; votes: number }[];
  decades: { id: number; votes: number }[];
} {
  const genres = GENRE_FAMILIES.map((g) => ({
    ...g,
    votes: tastes.filter((t) => t.genres.includes(g.id)).length,
  }));
  const decades = DECADES.map((id) => ({ id, votes: tastes.filter((t) => t.decades.includes(id)).length }));
  return {
    genres: genres.filter((g) => g.votes > 0).sort((a, b) => b.votes - a.votes),
    decades: decades.filter((d) => d.votes > 0).sort((a, b) => b.votes - a.votes),
  };
}

/** "1980s", or "’80s" when short. */
export function decadeLabel(decade: number, short = false): string {
  return short ? `’${String(decade).slice(2)}s` : `${decade}s`;
}

// The frozen contract between the server reducer and both screens.
//
// RoomState is the full, secret-bearing state that lives in the store. Screens
// never see it: they get a RoomView, built per recipient by `views.ts`, which
// holds back the answer until the reveal.

import type { GiveUpNotice } from './giveUpNotice';
import type { GameFormat } from './format';
import type { Setlist, SetlistMode, Taste } from './setlist';
import type { SmartCandidate, SmartState } from './smart';

export type QuestionKind = 'title' | 'artist' | 'year' | 'album';

export type Phase = 'lobby' | 'loading' | 'guessing' | 'reveal' | 'finished';

export interface Song {
  /** iTunes trackId. */
  id: number;
  title: string;
  artist: string;
  album: string;
  year: number;
  genre: string;
  artworkUrl: string;
  previewUrl: string;
}

export interface Player {
  id: string;
  /** Secret the phone keeps in localStorage; proves it owns this seat. */
  token: string;
  name: string;
  score: number;
}

export interface Answer {
  text: string;
  /** Milliseconds between the audio starting and the server receiving this. */
  elapsedMs: number;
  correct: boolean;
  /** Year rounds only: how many years off the guess was. */
  yearsOff?: number;
  /** The player tapped out instead of answering. */
  gaveUp?: boolean;
  /** Ride along: the player this folder backed instead of calling a stumper. */
  ride?: string;
  /** Set at the reveal: this folder called a stumper, and nobody got it. */
  stumper?: boolean;
  points: number;
}

/** What a folded player can throw at the television. The faces live in `heckles.ts`. */
export type HeckleKind = 'tomato' | 'horn' | 'snore' | 'clap' | 'clock' | 'cheer';

export interface Heckle {
  /** In order within the round. */
  id: number;
  playerId: string;
  kind: HeckleKind;
  /** Server clock. */
  at: number;
}

export interface Round {
  kind: QuestionKind;
  song: Song;
  /** Server clock when the host reported the audio playing. */
  guessStartedAt: number | null;
  revealStartedAt: number | null;
  answers: Record<string, Answer>;
  /** What the folded players threw while the song played. Absent before the first. */
  heckles?: Heckle[];
  /** How many times the clip plays; the window is that many GUESS_MS. Absent in rounds from before formats: once. */
  plays?: number;
}

export interface RoomState {
  code: string;
  version: number;
  hostToken: string;
  phase: Phase;
  players: Player[];
  rounds: Round[];
  roundIndex: number;
  /** Swapped in when a preview refuses to play. */
  spares: Song[];
  /** What the host plays over the final scores, in order, each fading into the next. */
  finales: Song[];
  /** Set while someone has the game paused. Every deadline waits for it. */
  pause: { at: number; by: string } | null;
  /** What the host plays while people join. */
  lobbyUrl: string | null;
  /** Every song this room has heard, so "play again" never repeats one. */
  playedSongIds: number[];
  /**
   * Someone at the host screen heard its test sound. No game starts until
   * they have, and it holds for the life of the room, back in the lobby too.
   * Absent in rooms made before the check, which start as they always did.
   */
  audioChecked?: boolean;
  /** Where the songs come from. Absent in rooms older than setlist modes: Classic. */
  setlist?: Setlist;
  /** House rule: folding can back another player instead of calling a stumper. Absent is off. */
  rideAlong?: boolean;
  /** Where give-ups are announced. Absent in rooms older than the setting: everyone's phones. */
  giveUpNotice?: GiveUpNotice;
  /** How many rounds of each kind, and plays per song. Absent in rooms older than formats: the default. */
  format?: GameFormat;
  /** Smart mode: what the room has shown it knows, and this game's candidates. Absent until a Smart game. */
  smart?: SmartState;
  createdAt: number;
}

export type Action =
  | { type: 'join'; playerId: string; token: string; name: string }
  | { type: 'rename'; playerId: string; name: string }
  | { type: 'remove-player'; playerId: string }
  /**
   * With `pool` (Smart mode), the reducer picks every round's song from it
   * as the game goes, and `songs` is ignored. `seed` seeds those picks.
   */
  | { type: 'start'; songs: Song[]; spares: Song[]; finales?: Song[]; pool?: SmartCandidate[]; seed?: number }
  | { type: 'pause'; by: string }
  | { type: 'resume' }
  | { type: 'audio-started'; roundIndex: number }
  | { type: 'audio-failed'; roundIndex: number }
  | { type: 'answer'; playerId: string; text: string }
  /** `ride`: who to back, when the room plays Ride along. Without it, the fold calls a stumper. */
  | { type: 'give-up'; playerId: string; ride?: string }
  | { type: 'heckle'; playerId: string; kind: HeckleKind }
  /** The host's house rules, between games. */
  | { type: 'rules'; rideAlong: boolean }
  | { type: 'next'; roundIndex: number }
  | { type: 'audio-check' }
  /** Back to the lobby from a paused game. `playerId` is null from the host screen; a phone must be the leader's. */
  | { type: 'end-game'; playerId: string | null }
  | { type: 'tick' }
  /** The host's setlist mode and picks, between games. */
  | { type: 'setlist'; mode: SetlistMode; taste: Taste; depth?: number }
  /** A player's picks for Crowd picks, between games. */
  | { type: 'taste'; playerId: string; taste: Taste }
  /** The host's choice of where give-ups are announced. Any time: it only changes who sees a banner. */
  | { type: 'give-up-notice'; notice: GiveUpNotice }
  /** The host's game format, between games. */
  | { type: 'format'; format: GameFormat };

export type ReduceResult = { ok: true; state: RoomState } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Views

export interface PlayerView {
  id: string;
  name: string;
  score: number;
  /** True once this player has locked in an answer for the current round, or given up. */
  answered: boolean;
  /** Giving up is public the moment it happens: the TV makes a scene of it. */
  gaveUp: boolean;
  /** Ride along: who this folder backed, public too. Null otherwise. */
  ridingWith: string | null;
}

export interface RevealedAnswer extends Answer {
  playerId: string;
}

export interface RoundView {
  index: number;
  total: number;
  kind: QuestionKind;
  /** True on the first round of each kind: the screens announce the new question. */
  kindChanged: boolean;
  /** Every round's kind in this game, in order, for the progress pips and the announcements. */
  kinds: QuestionKind[];
  /** The guessing window: GUESS_MS for each play of the clip. */
  guessMs: number;
  /** How many times the clip plays in that window. */
  plays: number;
  guessStartedAt: number | null;
  revealStartedAt: number | null;
  /** Host only: what to play. A preview URL does not name the song. */
  previewUrl?: string;
  /** Host only: the next round's preview, so it can be fetched ahead. */
  nextPreviewUrl?: string;
  /** Present from the reveal onwards. */
  song?: Song;
  answers?: RevealedAnswer[];
  /** Host only, while the song plays: what the folded players are throwing. */
  heckles?: Heckle[];
}

export interface RoomView {
  code: string;
  version: number;
  phase: Phase;
  players: PlayerView[];
  round: RoundView | null;
  /** Host only, from the last reveal on: the songs for the final scores. */
  finaleUrls?: string[];
  /** While paused: when it began on the server clock (timers freeze there), and who did it. */
  pause: { at: number; by: string } | null;
  /** Host only, in the lobby: music to join by. */
  lobbyUrl?: string;
  /** False until the host screen's sound has been checked; starting waits for it. */
  audioChecked: boolean;
  /** House rule: a fold can back another player. */
  rideAlong: boolean;
  setlist: {
    mode: SetlistMode;
    /** Host only: the TV's own picks. */
    host?: Taste;
    /** Host only, in Crowd picks: what each player still in the room has picked, by id. */
    picks?: Record<string, Taste>;
    /** In Difficulty mode: how many of each decade's top songs the draw takes from. */
    depth?: number;
  };
  /** Where give-ups are announced: phones show other players' only with 'everyone'. */
  giveUpNotice: GiveUpNotice;
  /** The room's format: the running game's, or between games the next one's. */
  format: GameFormat;
  /** Players only. */
  you?: {
    id: string;
    /** The first player in the room runs it from their phone: start, play again. */
    leader: boolean;
    /** What this player locked in. Whether it was right waits for the reveal. */
    answer: { text: string; elapsedMs: number; gaveUp: boolean; ride: string | null } | null;
    /** This player's Crowd picks, or null before they pick. */
    taste: Taste | null;
  };
  /** Server clock when this view was built; screens derive their offset from it. */
  serverNow: number;
}

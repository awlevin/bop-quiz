'use client';

import { Fragment, useEffect, useRef } from 'react';

import { describeTaste, TasteChips, TasteTally } from '@/components/setlist/TasteChips';
import { send } from '@/lib/client/api';
import { updateSettings, useSettings } from '@/lib/client/settings';
import {
  DEFAULT_DEPTH,
  isEmptyTaste,
  NO_TASTE,
  SETLIST_MODES,
  type SetlistMode,
  type Taste,
} from '@/lib/game/setlist';
import type { RoomView } from '@/lib/game/types';

import { DifficultyPicker } from './Difficulty';
import styles from './host.module.css';
import setlist from './setlist.module.css';

// The depth only counts in Difficulty mode, so it is left out of the key otherwise.
const keyOf = (mode: SetlistMode, taste: Taste, depth: number) =>
  `${mode}|${taste.genres.join()}|${taste.decades.join()}|${mode === 'hits' ? depth : ''}`;

/**
 * The setlist mode and the host's picks are settings of this screen, kept in
 * this browser, but the draw happens on the server at Start, and a phone can
 * press Start too. So between games this copies them into the room whenever
 * the two differ.
 */
export function useSetlistSync(view: RoomView | null, token: string | null): void {
  const { setlistMode, hostTaste, hitsDepth } = useSettings();
  const wanted = keyOf(setlistMode, hostTaste, hitsDepth);
  const inRoom = view
    ? keyOf(view.setlist.mode, view.setlist.host ?? NO_TASTE, view.setlist.depth ?? DEFAULT_DEPTH)
    : null;
  const between = view?.phase === 'lobby' || view?.phase === 'finished';
  const code = view?.code;

  const sent = useRef<string | null>(null);
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!code || !token || !between || inRoom === null) return;
    // The room moved: whatever was in flight has landed, or lost a race.
    if (inRoom !== seen.current) {
      seen.current = inRoom;
      sent.current = null;
    }
    if (inRoom === wanted || sent.current === wanted) return;
    sent.current = wanted;
    void send(code, token, { type: 'setlist', mode: setlistMode, taste: hostTaste, depth: hitsDepth }).then(
      (result) => {
        if (!result.ok && sent.current === wanted) sent.current = null;
      },
    );
  }, [code, token, between, inRoom, wanted, setlistMode, hostTaste, hitsDepth]);
}

/** The players who have picked something, in Crowd picks. */
export function pickedPlayers(view: RoomView): Set<string> {
  const picks = view.setlist.mode === 'crowd' ? (view.setlist.picks ?? {}) : {};
  return new Set(Object.entries(picks).flatMap(([id, taste]) => (isEmptyTaste(taste) ? [] : [id])));
}

/** For the settings menu: Classic, Crowd picks, Host picks or Difficulty, with Difficulty's levels under it. */
export function SetlistModeSetting() {
  const { setlistMode } = useSettings();
  return (
    <div className={setlist.setting} role="radiogroup" aria-label="Setlist mode">
      <p className={setlist.settingTitle}>
        Setlist mode <small>Experimental</small>
      </p>
      {SETLIST_MODES.map((mode) => (
        <Fragment key={mode.id}>
          <button
            type="button"
            role="radio"
            aria-checked={setlistMode === mode.id}
            className={setlist.option}
            onClick={() => updateSettings({ setlistMode: mode.id })}
          >
            <span className={setlist.optionDot} aria-hidden />
            <span className={setlist.optionText}>
              <span>{mode.label}</span>
              <small>{mode.hint}</small>
            </span>
          </button>
          {mode.id === 'hits' && setlistMode === 'hits' && <DifficultyPicker tone="paper" />}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * The lobby's setlist panel. Host picks: genre and decade keys to press on
 * this screen. Crowd picks: what the phones have asked for so far.
 * Difficulty: Easy, Medium, Hard or a custom depth. Classic shows nothing.
 */
export function SetlistLobby({ view }: { view: RoomView }) {
  const { hostTaste } = useSettings();
  const mode = view.setlist.mode;
  if (mode === 'classic') return null;

  if (mode === 'hits') {
    return (
      <section className={setlist.panel} data-setlist="hits">
        <h2 className={styles.panelTitle}>Difficulty</h2>
        <DifficultyPicker tone="booth" />
      </section>
    );
  }

  if (mode === 'host') {
    return (
      <section className={setlist.panel} data-setlist="host">
        <h2 className={styles.panelTitle}>Host picks</h2>
        <TasteChips
          className={setlist.chips}
          taste={hostTaste}
          onChange={(taste) => updateSettings({ hostTaste: taste })}
        />
        <p className={setlist.note}>
          {isEmptyTaste(hostTaste)
            ? 'Pick genres and decades for the setlist. Nothing picked plays from the whole catalog.'
            : `${describeTaste(hostTaste)}. The closest songs fill any gap.`}
        </p>
      </section>
    );
  }

  const picked = pickedPlayers(view);
  const picks = view.setlist.picks ?? {};
  const tastes = view.players.flatMap((p) => (picked.has(p.id) ? [picks[p.id]] : []));
  const waiting = view.players.filter((p) => !picked.has(p.id)).map((p) => p.name);
  return (
    <section className={setlist.panel} data-setlist="crowd">
      <h2 className={styles.panelTitle}>
        Crowd picks
        {view.players.length > 0 && ` · ${picked.size} of ${view.players.length} picked`}
      </h2>
      {tastes.length > 0 && <TasteTally className={setlist.chips} tastes={tastes} />}
      <p className={setlist.note}>
        {view.players.length === 0
          ? 'Everyone picks genres and decades on their phone. The setlist follows the room.'
          : tastes.length === 0
            ? 'Phones are picking genres and decades. Nobody picking plays from the whole catalog.'
            : waiting.length > 0
              ? `Still picking: ${waiting.join(', ')}.`
              : 'Everyone has picked. Each taste gets its turn in the setlist.'}
      </p>
    </section>
  );
}

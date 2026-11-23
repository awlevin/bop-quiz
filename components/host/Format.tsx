'use client';

import { useEffect, useRef } from 'react';

import { send } from '@/lib/client/api';
import { updateSettings, useSettings } from '@/lib/client/settings';
import {
  DEFAULT_FORMAT,
  describeFormat,
  FORMAT_KINDS,
  type GameFormat,
  guessMsFor,
  isDefaultFormat,
  MAX_PER_KIND,
  MAX_PLAYS,
  roundCount,
  timesLabel,
} from '@/lib/game/format';
import type { QuestionKind, RoomView } from '@/lib/game/types';

import format from './format.module.css';
import setlist from './setlist.module.css';

const keyOf = (f: GameFormat) => `${FORMAT_KINDS.map((kind) => f.counts[kind]).join()}|${f.plays}`;

/**
 * The format is a setting of this screen, kept in this browser, but the
 * rounds are laid out on the server at Start, and a phone can press Start
 * too. So between games this copies it into the room whenever the two differ.
 */
export function useFormatSync(view: RoomView | null, token: string | null): void {
  const { format: chosen } = useSettings();
  const wanted = keyOf(chosen);
  const inRoom = view ? keyOf(view.format) : null;
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
    void send(code, token, { type: 'format', format: chosen }).then((result) => {
      if (!result.ok && sent.current === wanted) sent.current = null;
    });
  }, [code, token, between, inRoom, wanted, chosen]);
}

const KIND_LABELS: Record<QuestionKind, string> = {
  title: 'Song title',
  artist: 'Artist',
  year: 'Year',
  album: 'Album',
};

// aria-disabled rather than disabled: a button disabled under focus drops it,
// and the settings menu closes when focus leaves.
function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className={format.row} role="group" aria-label={label}>
      <span className={format.rowLabel}>{label}</span>
      <button
        type="button"
        className={format.step}
        aria-label={`Fewer: ${label}`}
        aria-disabled={value <= min}
        onClick={() => value > min && onChange(value - 1)}
      >
        −
      </button>
      <output className={format.value} aria-live="polite">
        {value}
      </output>
      <button
        type="button"
        className={format.step}
        aria-label={`More: ${label}`}
        aria-disabled={value >= max}
        onClick={() => value < max && onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

/** For the settings menu: how many rounds of each kind, and how many times each song plays. */
export function FormatSetting() {
  const { format: current } = useSettings();
  const total = roundCount(current);
  const set = (patch: Partial<GameFormat>) => updateSettings({ format: { ...current, ...patch } });
  const setting = useRef<HTMLDivElement>(null);
  const reset = () => {
    updateSettings({ format: DEFAULT_FORMAT });
    // Reset goes away once pressed: keep focus in the menu, so Escape and blur still close it.
    setting.current?.focus();
  };

  return (
    <div className={`${setlist.setting} ${format.setting}`} ref={setting} tabIndex={-1}>
      <p className={setlist.settingTitle}>
        Rounds <small>Experimental</small>
      </p>
      {FORMAT_KINDS.map((kind) => (
        <Stepper
          key={kind}
          label={KIND_LABELS[kind]}
          value={current.counts[kind]}
          // A game needs at least one round.
          min={total - current.counts[kind] > 0 ? 0 : 1}
          max={MAX_PER_KIND}
          onChange={(n) => set({ counts: { ...current.counts, [kind]: n } })}
        />
      ))}
      <div className={format.total}>
        <span>
          {total} {total === 1 ? 'song' : 'songs'}, easiest first
        </span>
        {!isDefaultFormat(current) && (
          <button type="button" className={format.reset} onClick={reset}>
            Reset
          </button>
        )}
      </div>
      <Stepper
        label="Plays per song"
        value={current.plays}
        min={1}
        max={MAX_PLAYS}
        onChange={(plays) => set({ plays })}
      />
      <small className={format.hint}>
        Each {guessMsFor(1) / 1000}-second clip plays {timesLabel(current.plays)}:{' '}
        {guessMsFor(current.plays) / 1000} seconds to answer.
      </small>
    </div>
  );
}

/** One quiet line in the lobby when the game is not the usual ten songs played once. */
export function FormatLobby({ view }: { view: RoomView }) {
  if (isDefaultFormat(view.format)) return null;
  return (
    <p className={format.lobby} data-format>
      {describeFormat(view.format)}
    </p>
  );
}

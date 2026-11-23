'use client';

import { useState } from 'react';

import { hitsCount } from '@/lib/catalog/hits';
import { updateSettings, useSettings } from '@/lib/client/settings';
import { cleanDepth, DIFFICULTIES, difficultyOf, MAX_DEPTH, MIN_DEPTH } from '@/lib/game/setlist';

import styles from './difficulty.module.css';

/**
 * Easy, Medium, Hard, or a number of the host's own: how many of each
 * decade's best-known songs the draw takes from. It sits in the settings
 * menu under the Difficulty option (paper) and in the lobby (booth); both
 * edit the same setting.
 */
export function DifficultyPicker({ tone }: { tone: 'paper' | 'booth' }) {
  const { hitsDepth } = useSettings();
  const preset = difficultyOf(hitsDepth);
  // Custom stays open once chosen, even on a number that happens to be a preset.
  const [customChosen, setCustomChosen] = useState(false);
  const custom = customChosen || preset === null;
  // What is typed, while it is being typed: an empty box is not a depth yet.
  const [draft, setDraft] = useState<string | null>(null);

  const set = (depth: number) => updateSettings({ hitsDepth: depth });

  return (
    <div className={styles.difficulty} data-tone={tone}>
      <div className={styles.keys} role="radiogroup" aria-label="Difficulty">
        {DIFFICULTIES.map((d) => (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={!custom && preset === d.id}
            className={styles.key}
            onClick={() => {
              setCustomChosen(false);
              set(d.depth);
            }}
          >
            {d.label}
            <small>Top {d.depth}</small>
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={custom}
          className={styles.key}
          onClick={() => setCustomChosen(true)}
        >
          Custom
          <small>{custom ? `Top ${hitsDepth}` : 'Your pick'}</small>
        </button>
      </div>

      {custom && (
        <div className={styles.custom}>
          <span>Top</span>
          <button
            type="button"
            className={styles.step}
            aria-label="Fewer"
            disabled={hitsDepth <= MIN_DEPTH}
            onClick={() => set(hitsDepth - 1)}
          >
            −
          </button>
          <input
            className={styles.number}
            type="number"
            inputMode="numeric"
            min={MIN_DEPTH}
            max={MAX_DEPTH}
            aria-label="Songs from each decade"
            value={draft ?? String(hitsDepth)}
            onChange={(e) => {
              setDraft(e.target.value);
              const depth = cleanDepth(e.target.value);
              if (depth !== null) set(depth);
            }}
            onBlur={() => setDraft(null)}
          />
          <button
            type="button"
            className={styles.step}
            aria-label="More"
            disabled={hitsDepth >= MAX_DEPTH}
            onClick={() => set(hitsDepth + 1)}
          >
            +
          </button>
          <span>songs from each decade</span>
        </div>
      )}

      <p className={styles.summary}>
        The {hitsDepth === 1 ? 'top song' : `top ${hitsDepth} songs`} of every decade, ’60s to today:{' '}
        <b>{hitsCount(hitsDepth)} songs</b> to draw from.
      </p>
    </div>
  );
}

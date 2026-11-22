'use client';

import { useEffect, useRef, useState } from 'react';

import { describeTaste, TasteChips } from '@/components/setlist/TasteChips';
import setlist from '@/components/setlist/setlist.module.css';
import { send } from '@/lib/client/api';
import { isEmptyTaste, NO_TASTE, type Taste } from '@/lib/game/setlist';
import type { RoomView } from '@/lib/game/types';

import styles from './play.module.css';

/** Taps this close together go to the server as one pick. */
const SETTLE_MS = 300;

/** Crowd picks, in the lobby: the genres and decades this player wants to hear. */
export function TastePicker({ view, token }: { view: RoomView; token: string }) {
  const [taste, setTaste] = useState<Taste>(view.you?.taste ?? NO_TASTE);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const change = (next: Taste) => {
    setTaste(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const result = await send(view.code, token, { type: 'taste', taste: next });
      setError(result.ok ? '' : result.error);
    }, SETTLE_MS);
  };

  return (
    <section className={setlist.picker} aria-labelledby="taste-title">
      <p id="taste-title" className={styles.eyebrow}>
        What should play?
      </p>
      <TasteChips taste={taste} onChange={change} />
      <p className={setlist.pickerNote} role={error ? 'alert' : undefined}>
        {error ||
          (isEmptyTaste(taste)
            ? 'Pick the genres and decades you like. The setlist mixes everyone’s picks.'
            : `${describeTaste(taste)}. You will get your share.`)}
      </p>
    </section>
  );
}

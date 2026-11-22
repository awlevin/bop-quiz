'use client';

import { type ReactNode, useState } from 'react';

import { Key } from '@/components/ds';
import { send } from '@/lib/client/api';

import styles from './endgame.module.css';

interface Props {
  code: string;
  token: string;
  /** Full-width keys, stacked: for a phone. */
  block?: boolean;
  /** The pause screen's other way out, Resume. The question takes its place while it is asked. */
  children?: ReactNode;
}

/**
 * The host's way out of a paused game, on the TV and on the leader's phone.
 * It asks first, because everyone's scores go. The room goes back to the
 * lobby with everyone still in it, ready for a new game.
 */
export function EndGame({ code, token, block, children }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState('');

  if (!confirming) {
    return (
      <>
        {children}
        <Key variant="quiet" block={block} onClick={() => setConfirming(true)}>
          End game
        </Key>
      </>
    );
  }

  const end = async () => {
    setEnding(true);
    setError('');
    const result = await send(code, token, { type: 'end-game' });
    // On success this unmounts along with the pause screen.
    if (!result.ok) {
      setError(result.error);
      setEnding(false);
    }
  };

  return (
    <div className={styles.confirm} data-block={block} role="group" aria-label="End the game">
      <p className={styles.question}>End the game for everyone?</p>
      <p className={styles.detail}>Scores go back to zero. Everyone stays in the room, back in the lobby.</p>
      <div className={styles.keys}>
        <Key block={block} onClick={() => void end()} disabled={ending}>
          {ending ? 'Ending…' : 'Yes, end the game'}
        </Key>
        <Key variant="quiet" block={block} onClick={() => setConfirming(false)} disabled={ending}>
          Keep playing
        </Key>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

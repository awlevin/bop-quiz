'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { Key } from '@/components/ds';
import { send } from '@/lib/client/api';
import type { RoomView } from '@/lib/game/types';

import styles from './audioCheck.module.css';
import type { Director } from './useDirector';

// The settings menu can ask for the check again, from outside the lobby's tree.
const listeners = new Set<() => void>();
let reopened = false;

function setReopened(next: boolean) {
  reopened = next;
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** Show the sound check again, even though this room has passed it. */
export function reopenAudioCheck(): void {
  setReopened(true);
}

type Status = 'idle' | 'playing' | 'asking' | 'blocked';

/**
 * The lobby's sound check: a chime through the same jukebox the songs play
 * on, and someone at this screen saying they heard it. The room cannot start
 * until they have, once per room. It is also the click that lets this screen
 * make sound, so the first song never waits on one.
 */
export function AudioCheck({ view, token, director }: { view: RoomView; token: string; director: Director }) {
  const again = useSyncExternalStore(subscribe, () => reopened, () => false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  // A request from the settings menu lasts as long as this lobby does.
  useEffect(() => () => void (reopened = false), []);

  if (view.audioChecked && !again) return null;

  const play = async () => {
    setStatus('playing');
    setError('');
    try {
      await director.enableSound();
      await director.jukebox?.chime();
      setStatus('asking');
    } catch {
      setStatus('blocked');
    }
  };

  const heard = async () => {
    const result = await send(view.code, token, { type: 'audio-check' });
    if (!result.ok) return setError(result.error);
    setReopened(false);
    setStatus('idle');
  };

  const close = () => {
    setReopened(false);
    setStatus('idle');
  };

  let line = 'Play a short chime here, so you know the room can hear the music.';
  if (status === 'playing') line = 'Listen…';
  if (status === 'asking') line = 'Did you hear a chime? No sound: check the volume and the speaker this plays on.';
  if (status === 'blocked') line = 'The browser held the sound back. Try once more.';

  return (
    <section className={styles.check} aria-label="Sound check" data-status={status}>
      <SpeakerIcon />
      <div className={styles.text}>
        <h3>Sound check</h3>
        <p role="status">{error || line}</p>
      </div>
      <div className={styles.keys}>
        {status === 'asking' ? (
          <>
            <Key variant="paper" onClick={() => void heard()}>
              I heard it
            </Key>
            <Key variant="quiet" onClick={() => void play()}>
              Play again
            </Key>
          </>
        ) : (
          <Key variant="quiet" onClick={() => void play()} disabled={status === 'playing'}>
            {status === 'playing' ? 'Playing…' : 'Play test sound'}
          </Key>
        )}
        {view.audioChecked && status !== 'playing' && (
          <button type="button" className={styles.close} onClick={close} aria-label="Close the sound check">
            ×
          </button>
        )}
      </div>
    </section>
  );
}

function SpeakerIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      <path d="M15.5 9a4 4 0 0 1 0 6" />
      <path d="M18.3 6.3a8 8 0 0 1 0 11.4" />
    </svg>
  );
}

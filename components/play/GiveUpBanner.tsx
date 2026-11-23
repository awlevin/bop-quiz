'use client';

import { useCallback, useEffect, useState } from 'react';

import type { RoomView } from '@/lib/game/types';

import styles from './giveUpBanner.module.css';

/** How long a banner stays in, after sliding in and before sliding out. */
const SHOW_MS = 2500;
/** The slide out, as long as `.pill[data-leaving]`'s animation. */
const LEAVE_MS = 240;
/** More than this at once wait their turn, so a room tapping out together stays a slim stack. */
const MAX_SHOWN = 3;
/**
 * The last give-up ends the round at once, so the phones first hear of it
 * with the reveal. One that fresh still gets its banner; an older one (a
 * reconnect mid-reveal) is old news.
 */
const LATE_MS = 2000;

interface Notice {
  key: string;
  name: string;
}

/** The other players who have given up this round, keyed by round so the next round starts afresh. */
function giveUps(view: RoomView): Notice[] {
  const round = view.round;
  if (!round) return [];
  return view.players
    .filter((p) => p.gaveUp && p.id !== view.you?.id)
    .map((p) => ({ key: `${round.index}:${p.id}`, name: p.name }));
}

function live(view: RoomView): boolean {
  if (view.giveUpNotice !== 'everyone') return false;
  if (view.phase === 'guessing') return true;
  const startedAt = view.round?.revealStartedAt;
  return view.phase === 'reveal' && startedAt != null && view.serverNow - startedAt < LATE_MS;
}

/**
 * "Ben gave up", along the top of the other phones: slides in, stays a
 * moment, slides out. It never takes a tap or the focus, and never moves the
 * answer box. The TV makes the scene; this is just the news.
 */
export function GiveUpBanner({ view }: { view: RoomView }) {
  // The give-ups this phone already knows of (null before its first view), and the banners still to go.
  const [known, setKnown] = useState<string[] | null>(null);
  const [queue, setQueue] = useState<Notice[]>([]);

  // Adjusting state while rendering, as React suggests for state that follows props.
  const current = giveUps(view);
  const keys = current.map((n) => n.key);
  if (known === null || keys.join() !== known.join()) {
    // On first sight, a reload mid-round, whatever already happened is not news.
    const fresh = known === null ? [] : current.filter((n) => !known.includes(n.key));
    setKnown(keys);
    if (fresh.length > 0 && live(view)) setQueue([...queue, ...fresh]);
  }

  const done = useCallback((key: string) => setQueue((q) => q.filter((n) => n.key !== key)), []);

  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {queue.slice(0, MAX_SHOWN).map((n) => (
        <Pill key={n.key} id={n.key} name={n.name} onDone={done} />
      ))}
    </div>
  );
}

function Pill({ id, name, onDone }: { id: string; name: string; onDone: (id: string) => void }) {
  const [leaving, setLeaving] = useState(false);
  // The timers run in JS, not in the animation: with reduced motion the slides
  // are stilled (globals.css), but the banner still stays its 2.5 seconds.
  useEffect(() => {
    const out = setTimeout(() => setLeaving(true), SHOW_MS);
    const gone = setTimeout(() => onDone(id), SHOW_MS + LEAVE_MS);
    return () => {
      clearTimeout(out);
      clearTimeout(gone);
    };
  }, [id, onDone]);

  return (
    <p className={styles.pill} data-leaving={leaving}>
      <span className={styles.badge} aria-hidden>
        <svg viewBox="0 0 16 16">
          <path d="M4 2v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M4.8 2.6h7.4l-1.8 2.7 1.8 2.7H4.8z" fill="currentColor" />
        </svg>
      </span>
      <span className={styles.text}>
        <strong>{name}</strong> gave up
      </span>
    </p>
  );
}

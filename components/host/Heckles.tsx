'use client';

import { useServerNow } from '@/lib/client/useNow';
import { HECKLE_MS } from '@/lib/game/config';
import { heckleFor } from '@/lib/game/heckles';
import type { Heckle, PlayerView } from '@/lib/game/types';

import styles from './host.module.css';

/** A stable spread across the deck for each heckle, so a re-render keeps it in place. */
function spot(seed: number): { x: number; tilt: number } {
  const n = Math.sin(seed * 12.9898) * 43758.5453;
  const r = n - Math.floor(n);
  return { x: r, tilt: Math.round((r * 2 - 1) * 14) };
}

interface Props {
  round: number;
  heckles: Heckle[];
  players: PlayerView[];
  clockOffset: number;
  frozenAt?: number | null;
}

/** What the folded players throw from their phones: it floats up over the record and is gone. */
export function HeckleLayer({ round, heckles, players, clockOffset, frozenAt }: Props) {
  const now = useServerNow(clockOffset, heckles.length > 0, frozenAt);
  // A screen that joins late, or reloads, skips the ones that have already been and gone.
  const live = heckles.filter((h) => now - h.at < HECKLE_MS);
  if (live.length === 0) return null;
  return (
    <div className={styles.heckles} aria-hidden>
      {live.map((h) => {
        const { face, label } = heckleFor(h.kind);
        const { x, tilt } = spot(round * 1000 + h.id);
        const name = players.find((p) => p.id === h.playerId)?.name;
        return (
          <div
            key={`${round}:${h.id}`}
            className={styles.heckle}
            data-kind={h.kind}
            style={{ '--x': x, '--tilt': `${tilt}deg` } as React.CSSProperties}
          >
            <span className={styles.heckleFace}>{face}</span>
            <span className={styles.heckleName}>{name ? `${name} · ${label}` : label}</span>
          </div>
        );
      })}
    </div>
  );
}

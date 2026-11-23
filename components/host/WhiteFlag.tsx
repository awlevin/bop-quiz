'use client';

import { TitleStrip } from '@/components/ds';
import type { QuestionKind } from '@/lib/game/types';

import styles from './host.module.css';

const EXCUSES = [
  'has left the building',
  'pleads the fifth',
  'has never heard music before',
  'is phoning a friend. No answer.',
  'blames the speakers',
  'is more of a podcast person',
  'knew it a second ago, honest',
  'will sit this one out, thanks',
  'only listens to the B-sides',
  'requests a different song',
];

function pick(seed: string): string {
  let sum = 0;
  for (const c of seed) sum = (sum * 31 + c.charCodeAt(0)) >>> 0;
  return EXCUSES[sum % EXCUSES.length];
}

interface Props {
  name: string;
  /** Ride along: the name of who this player backed. */
  ridingWith?: string;
  /** Stable per player and round, so a re-render keeps the same excuse. */
  seed: string;
  /** Flags that land together fan out instead of stacking. */
  slot: number;
  tone: QuestionKind;
}

/**
 * Someone gave up. The room should see it: drops in, hangs its head, falls
 * off. Silently. Giving up is a bet that nobody gets it, or, in Ride along,
 * a vote for someone who might, and the flag says which.
 */
export function WhiteFlag({ name, ridingWith, seed, slot, tone }: Props) {
  return (
    <div className={styles.flag} style={{ '--slot': slot } as React.CSSProperties} role="status">
      <TitleStrip
        tone={tone}
        top={name}
        label={ridingWith ? 'Gave up · Riding along' : 'Gave up · Calls a stumper'}
        bottom={ridingWith ? `is riding with ${ridingWith}` : pick(seed)}
      />
    </div>
  );
}

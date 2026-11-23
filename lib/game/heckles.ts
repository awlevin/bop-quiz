import type { HeckleKind } from './types';

/** Phone keys and TV pop-ups, in the order the phone lays them out. */
export const HECKLES: readonly { kind: HeckleKind; face: string; label: string }[] = [
  { kind: 'tomato', face: '🍅', label: 'Tomato' },
  { kind: 'horn', face: '📯', label: 'Air horn' },
  { kind: 'snore', face: '😴', label: 'Snore' },
  { kind: 'clap', face: '👏', label: 'Slow clap' },
  { kind: 'clock', face: '⏰', label: 'Tick tock' },
  { kind: 'cheer', face: '🙌', label: 'You got this' },
];

export function isHeckleKind(value: unknown): value is HeckleKind {
  return HECKLES.some((h) => h.kind === value);
}

export function heckleFor(kind: HeckleKind) {
  return HECKLES.find((h) => h.kind === kind)!;
}

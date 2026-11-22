'use client';

import type { CSSProperties } from 'react';

import {
  combineTastes,
  DECADES,
  decadeLabel,
  GENRE_FAMILIES,
  type GenreFamily,
  type Taste,
} from '@/lib/game/setlist';

import styles from './setlist.module.css';

interface TasteChipsProps {
  taste: Taste;
  onChange: (taste: Taste) => void;
  className?: string;
}

function toggle<T>(list: readonly T[], item: T, order: readonly T[]): T[] {
  const next = list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  return order.filter((x) => next.includes(x));
}

const GENRE_ORDER = GENRE_FAMILIES.map((g) => g.id);

/** Genres on one row and decades on the next, each a key that stays down when pressed. */
export function TasteChips({ taste, onChange, className = '' }: TasteChipsProps) {
  const genre = (id: GenreFamily, label: string) => (
    <button
      key={id}
      type="button"
      className={styles.chip}
      aria-pressed={taste.genres.includes(id)}
      onClick={() => onChange({ ...taste, genres: toggle(taste.genres, id, GENRE_ORDER) })}
    >
      {label}
    </button>
  );
  const decade = (id: number) => (
    <button
      key={id}
      type="button"
      className={styles.chip}
      aria-pressed={taste.decades.includes(id)}
      aria-label={decadeLabel(id)}
      onClick={() => onChange({ ...taste, decades: toggle(taste.decades, id, DECADES) })}
    >
      {decadeLabel(id, true)}
    </button>
  );
  return (
    <div className={`${styles.chips} ${className}`}>
      <div className={styles.row} role="group" aria-label="Genres">
        {GENRE_FAMILIES.map((g) => genre(g.id, g.label))}
      </div>
      <div className={styles.row} role="group" aria-label="Decades">
        {DECADES.map(decade)}
      </div>
    </div>
  );
}

/** One line in words: "Rock and Pop from the ’80s and ’90s". Empty when nothing is picked. */
export function describeTaste(taste: Taste): string {
  const list = (items: string[]) =>
    items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  const genres = list(GENRE_FAMILIES.filter((g) => taste.genres.includes(g.id)).map((g) => g.label));
  const decades = list(taste.decades.map((d) => decadeLabel(d, true)));
  if (genres && decades) return `${genres} from the ${decades}`;
  if (genres) return `${genres}, any decade`;
  if (decades) return `Anything from the ${decades}`;
  return '';
}

/** What a room asked for, together: each genre and decade anyone picked, with how many did. */
export function TasteTally({ tastes, className = '' }: { tastes: readonly Taste[]; className?: string }) {
  const { genres, decades } = combineTastes(tastes);
  const items = [
    ...genres.map((g) => ({ key: g.id, label: g.label, votes: g.votes })),
    ...decades.map((d) => ({ key: String(d.id), label: decadeLabel(d.id, true), votes: d.votes })),
  ];
  return (
    <ul className={`${styles.tally} ${className}`} aria-label="What the room picked">
      {items.map((item) => {
        const share = item.votes / Math.max(tastes.length, 1);
        return (
          <li
            key={item.key}
            className={styles.tallyItem}
            data-faint={share < 0.5}
            style={{ '--share': 0.25 + share * 0.75 } as CSSProperties}
          >
            {item.label}
            <b aria-label={`${item.votes} ${item.votes === 1 ? 'pick' : 'picks'}`}>{item.votes}</b>
          </li>
        );
      })}
    </ul>
  );
}

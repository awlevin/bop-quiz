// Holds content/changelog.md to the shape AGENTS.md describes, so a malformed
// entry fails CI instead of quietly rendering wrong on /changelog.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CATEGORIES, parseChangelog, parseDayHeading } from './parse';

const file = readFileSync(fileURLToPath(new URL('../../content/changelog.md', import.meta.url)), 'utf8');
const log = parseChangelog(file);

describe('content/changelog.md', () => {
  it('has a title, a lead and at least one day', () => {
    expect(log.title).not.toBe('');
    expect(log.lead).not.toBe('');
    expect(log.days.length).toBeGreaterThan(0);
  });

  it('heads every day "Month D, YYYY", newest first, no day twice', () => {
    let previous = Infinity;
    for (const day of log.days) {
      const date = parseDayHeading(day.heading);
      expect(date, `"${day.heading}" is not a "Month D, YYYY" date`).not.toBeNull();
      expect(date!.getTime(), `"${day.heading}" is out of order or repeated`).toBeLessThan(previous);
      previous = date!.getTime();
    }
  });

  it('uses only the three categories, in order, each at most once a day', () => {
    for (const day of log.days) {
      expect(day.sections.length, `${day.heading} has no sections`).toBeGreaterThan(0);
      const order = day.sections.map((s) => CATEGORIES.indexOf(s.title as (typeof CATEGORIES)[number]));
      for (const [i, index] of order.entries()) {
        expect(index, `${day.heading}: unknown section "${day.sections[i].title}"`).toBeGreaterThanOrEqual(0);
        if (i > 0) expect(index, `${day.heading}: sections out of order`).toBeGreaterThan(order[i - 1]);
      }
    }
  });

  it('fills every section with "-" bullets and nothing else', () => {
    for (const day of log.days) {
      for (const section of day.sections) {
        const where = `${day.heading} / ${section.title}`;
        const lines = section.markdown.split('\n').filter((l) => l.trim());
        expect(lines.length, `${where} is empty`).toBeGreaterThan(0);
        for (const line of lines) expect(line, `${where}: not a "- " bullet`).toMatch(/^(- |\s{2,})/);
      }
    }
  });
});

describe('parseDayHeading', () => {
  it('reads real dates and refuses the rest', () => {
    expect(parseDayHeading('November 22, 2026')?.toISOString()).toBe('2026-11-22T00:00:00.000Z');
    expect(parseDayHeading('Nov 22, 2026')).toBeNull();
    expect(parseDayHeading('November 22 2026')).toBeNull();
    expect(parseDayHeading('February 30, 2026')).toBeNull();
    expect(parseDayHeading('2026-11-22')).toBeNull();
  });
});

describe('parseChangelog', () => {
  it('refuses text under a day that is outside any section', () => {
    expect(() => parseChangelog('# T\n\nLead.\n\n## May 1, 2026\n\n- stray\n')).toThrow(/outside any section/);
  });
});

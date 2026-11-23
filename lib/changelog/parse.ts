// The public changelog is one markdown file, content/changelog.md, in a fixed
// shape: a `#` title, a lead paragraph, then one `## Month D, YYYY` per day
// (newest first), each with `###` category sections of `-` bullets. This
// splits it into days and sections so the page can lay each day out as a
// card, and so a test can hold the file to that shape.

export const CATEGORIES = ['🔥 New Features', '🐛 Bug fixes', '💅 Nits'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface ChangelogSection {
  title: string;
  /** The section's bullets, still markdown. */
  markdown: string;
}

export interface ChangelogDay {
  /** The heading as written, e.g. "November 22, 2026". */
  heading: string;
  sections: ChangelogSection[];
}

export interface Changelog {
  title: string;
  lead: string;
  days: ChangelogDay[];
}

export function parseChangelog(markdown: string): Changelog {
  const log: Changelog = { title: '', lead: '', days: [] };
  const lead: string[] = [];
  let day: ChangelogDay | null = null;
  let section: ChangelogSection | null = null;

  for (const line of markdown.split('\n')) {
    if (line.startsWith('# ')) {
      log.title = line.slice(2).trim();
    } else if (line.startsWith('## ')) {
      day = { heading: line.slice(3).trim(), sections: [] };
      section = null;
      log.days.push(day);
    } else if (line.startsWith('### ')) {
      if (!day) throw new Error(`Changelog section "${line}" comes before any day`);
      section = { title: line.slice(4).trim(), markdown: '' };
      day.sections.push(section);
    } else if (section) {
      section.markdown += `${line}\n`;
    } else if (!day) {
      lead.push(line);
    } else if (line.trim()) {
      throw new Error(`Changelog text under "${day.heading}" is outside any section: "${line}"`);
    }
  }

  log.lead = lead.join('\n').trim();
  for (const d of log.days) for (const s of d.sections) s.markdown = s.markdown.trim();
  return log;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "November 22, 2026" → a UTC date, or null if the heading is not that shape. */
export function parseDayHeading(heading: string): Date | null {
  const match = /^([A-Z][a-z]+) ([1-9]\d?), (\d{4})$/.exec(heading);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1]);
  if (month < 0) return null;
  const date = new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
  // Rejects days past the end of the month, such as "February 30".
  return date.getUTCDate() === Number(match[2]) ? date : null;
}

/** Turns "🔥 New Features" into a tone the page can colour by. */
export function categoryTone(title: string): 'feature' | 'fix' | 'nit' {
  if (title === '🔥 New Features') return 'feature';
  if (title === '🐛 Bug fixes') return 'fix';
  return 'nit';
}

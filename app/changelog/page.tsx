import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Metadata } from 'next';
import Link from 'next/link';
import ReactMarkdown, { type Components } from 'react-markdown';

import { Wordmark } from '@/components/ds';
import { categoryTone, parseChangelog } from '@/lib/changelog/parse';

import styles from './changelog.module.css';

export const metadata: Metadata = {
  title: "What's new",
  description: 'What changed in Bop Quiz, newest first.',
};

// The changelog is a plain markdown file: edit content/changelog.md and this
// page re-renders it. It is read at build time and ships with the deploy, so
// the page is static.
async function loadChangelog() {
  return parseChangelog(await readFile(path.join(process.cwd(), 'content', 'changelog.md'), 'utf8'));
}

const components: Components = {
  a: ({ href = '', children }) =>
    href.startsWith('/') ? <Link href={href}>{children}</Link> : <a href={href}>{children}</a>,
};

export default async function ChangelogPage() {
  const log = await loadChangelog();

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <Wordmark href="/" className={styles.mark} />
      </header>

      <h1 className={styles.title}>What&apos;s new</h1>
      <p className={styles.lead}>
        {log.lead} Something off? Tell us from the game, and follow it on the{' '}
        <Link href="/feedback">feedback board</Link>.
      </p>

      <ol className={styles.days}>
        {log.days.map((day) => (
          <li key={day.heading} className={styles.day}>
            <h2 className={styles.date}>{day.heading}</h2>
            <div className={styles.card}>
              {day.sections.map((section) => (
                <section key={section.title} className={styles.section} data-kind={categoryTone(section.title)}>
                  <h3 className={styles.kind}>{section.title}</h3>
                  <div className={styles.notes}>
                    <ReactMarkdown components={components}>{section.markdown}</ReactMarkdown>
                  </div>
                </section>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}

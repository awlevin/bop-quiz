<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Changelog

There's a public, player-facing changelog at `content/changelog.md`, rendered at `/changelog` and linked from the home screen. Maintain it proactively: when you ship a change worth a player's attention, add it in the same commit. Don't wait to be asked. This includes fixes made while working the feedback queue (`docs/FEEDBACK.md`).

What belongs there:
- **Player-facing changes only.** Describe what a player can see or do, in their words. Never list internal or technical work: refactors, the reducer, Redis, the catalog build script, e2e runs, deploy plumbing, lint or build fixes. Translate it into a benefit or leave it out.
- **Skip the too-small stuff.** Copy and wording tweaks and pixel nudges are below the bar. Leave them out entirely. When unsure, leave it out.
- **Catalog fixes count when a player would notice.** "The right song plays for Faith" belongs; a corrected artwork URL does not. Group a batch of song fixes into one bullet.

Format (`lib/changelog/changelog.test.ts` checks it in `npm test`, so a malformed entry fails CI):
- Newest day on top. One `## <Month D, YYYY>` heading per day (the day it reaches `main`, which Vercel deploys). If today's heading already exists, add to it.
- Under each day, group items by `### 🔥 New Features`, then `### 🐛 Bug fixes`, then `### 💅 Nits`, in that order. Only include the categories that have items.
- Reserve `🔥 New Features` for substantial, net-new capabilities. Smaller polish goes under `💅 Nits`, including extending an existing feature to another screen (e.g. "X now also shows in quick play"), display tweaks, and minor UX refinements. When torn between Features and Nits, choose Nits.
- `-` bullets, one line each; bold a short lead-in on notable items. Keep it concise and lightly playful. Links to other pages in the game are relative (`[/shuffle](/shuffle)`).

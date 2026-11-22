// End-to-end run of the lobby's sound check and ending a game from the pause
// screen: lobby → sound check → start → pause → end → lobby → start again.
//   node e2e/end-game.mjs        (expects the app on BASE_URL, default :3210)
// Screenshots land in e2e/shots/.

import { mkdirSync } from 'node:fs';

import { chromium, devices } from 'playwright';

import { fakeAudio } from './fake-audio.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3210';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const problems = [];
const watch = (page, who) => {
  page.on('pageerror', (e) => problems.push(`${who}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${who}: ${m.text()}`));
};

const hostCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const host = await hostCtx.newPage();
watch(host, 'host');
// The jukebox's players never join the page, so keep a note of every one that plays.
await host.addInitScript(() => {
  const media = new Set();
  window.__media = media;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    media.add(this);
    return play.call(this);
  };
});
await fakeAudio(host);

/** What the host screen is playing right now, ignoring silent blobs. */
const playing = () =>
  host.evaluate(() =>
    [...window.__media].filter((m) => !m.paused && !m.src.startsWith('blob:')).map((m) => ({ src: m.src, loop: m.loop })),
  );

await host.goto(BASE);
await host.waitForLoadState('networkidle');
await host.getByRole('button', { name: 'Host a game' }).click();
await host.waitForURL(/\/host\/[A-Z]{4}$/);
const code = host.url().slice(-4);
console.log('room', code);

const phones = [];
for (const name of ['Ana', 'Ben']) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await ctx.newPage();
  watch(page, name);
  await page.goto(`${BASE}/play/${code}`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Join game' }).click();
  await page.getByText(`You are in, ${name}`).waitFor();
  phones.push(page);
}
const [ana, ben] = phones;
await host.getByText('In the room · 2').waitFor();

// --- Sound check -----------------------------------------------------------

const hostStart = host.getByRole('button', { name: 'Start game' });
if (!(await hostStart.isDisabled())) problems.push('the TV could start before the sound check');
if (!(await ana.getByRole('button', { name: 'Start game' }).isDisabled())) problems.push('Ana could start before the sound check');
await host.screenshot({ path: `${SHOTS}30-host-sound-check-idle.png` });
await ana.screenshot({ path: `${SHOTS}31-phone-waiting-for-sound-check.png` });

// A start that slips past the screens is refused by the server too.
const token = await ana.evaluate((room) => JSON.parse(localStorage.getItem(`mm:seat:${room}`)), code);
const sneak = (await ana.request.post(`${BASE}/api/rooms/${code}/actions`, { data: { type: 'start', token } })).status();
if (sneak !== 409) problems.push(`an unchecked start answered ${sneak}, not 409`);

await host.getByRole('button', { name: 'Play test sound' }).click();
await host.getByRole('button', { name: 'I heard it' }).waitFor();
await host.screenshot({ path: `${SHOTS}32-host-sound-check-asking.png` });
await host.getByRole('button', { name: 'I heard it' }).click();
await host.getByRole('region', { name: 'Sound check' }).waitFor({ state: 'detached' });
await hostStart.waitFor();
if (await hostStart.isDisabled()) problems.push('the TV still could not start after the sound check');

// It can be run again from the settings menu, and closed without changing anything.
await host.getByRole('button', { name: 'Settings' }).click();
await host.getByRole('button', { name: 'Check the sound' }).click();
await host.getByRole('region', { name: 'Sound check' }).waitFor();
await host.screenshot({ path: `${SHOTS}33-host-sound-check-again.png` });
await host.getByRole('button', { name: 'Close the sound check' }).click();
await host.getByRole('region', { name: 'Sound check' }).waitFor({ state: 'detached' });

// --- First game, ended from the TV ----------------------------------------

await ana.getByRole('button', { name: 'Start game' }).click();
await ana.getByRole('button', { name: 'Lock it in' }).waitFor({ timeout: 25000 });
await ana.getByRole('textbox').fill('a wild guess');
await ana.getByRole('button', { name: 'Lock it in' }).click();
await host.getByText(/Locked in · 1 of 2/).waitFor();
const gameSong = (await playing()).find((m) => !m.loop)?.src;
if (!gameSong) problems.push('no song was playing during the first round');

await ben.getByRole('button', { name: 'Pause the game' }).click();
await host.getByRole('heading', { name: 'Intermission' }).waitFor();
if (await ben.getByRole('button', { name: 'End game' }).count()) problems.push('Ben, not the leader, was offered End game');
await ana.getByRole('button', { name: 'End game' }).waitFor();
await host.screenshot({ path: `${SHOTS}34-host-intermission-end.png` });

// It asks first, and backing out leaves the game paused.
await host.getByRole('button', { name: 'End game' }).click();
await host.getByText('End the game for everyone?').waitFor();
await host.screenshot({ path: `${SHOTS}35-host-end-confirm.png` });
await host.getByRole('button', { name: 'Keep playing' }).click();
await host.getByRole('heading', { name: 'Intermission' }).waitFor();
await host.getByRole('button', { name: 'End game' }).click();
await host.getByRole('button', { name: 'Yes, end the game' }).click();

await host.getByRole('heading', { name: 'Intermission' }).waitFor({ state: 'hidden' });
await host.getByText('In the room · 2').waitFor();
await ana.getByText('You are in, Ana').waitFor();
await ben.getByText('You are in, Ben').waitFor();
if (await host.getByRole('region', { name: 'Sound check' }).count()) problems.push('the sound check came back after ending');
await host.waitForTimeout(2500);
const afterEnd = await playing();
if (afterEnd.some((m) => m.src === gameSong)) problems.push('the ended game’s song kept playing in the lobby');
if (afterEnd.length !== 1 || !afterEnd[0].loop) problems.push(`the lobby should play only its music, got ${JSON.stringify(afterEnd)}`);
await host.screenshot({ path: `${SHOTS}36-host-lobby-after-end.png` });
await ana.screenshot({ path: `${SHOTS}37-phone-lobby-after-end.png` });

// --- Second game, from the TV, ended from the leader's phone ---------------

await hostStart.click();
await host.getByText(/Get ready to name the/).waitFor();
await ben.getByRole('button', { name: 'Lock it in' }).waitFor({ timeout: 25000 });
const score = await host.locator('[class*=chipValue]').allTextContents();
if (score.some((s) => s.trim() !== '0')) problems.push(`scores did not start from zero: ${score}`);

await ana.getByRole('button', { name: 'Pause the game' }).click();
await ana.getByRole('button', { name: 'End game' }).click();
await ana.screenshot({ path: `${SHOTS}38-phone-end-confirm.png` });
await ana.getByRole('button', { name: 'Yes, end the game' }).click();
await host.getByText('In the room · 2').waitFor();
await ben.getByText('You are in, Ben').waitFor();
await ana.getByRole('button', { name: 'Start game' }).waitFor();
if (await ana.getByRole('button', { name: 'Start game' }).isDisabled()) problems.push('Ana could not start again');

await browser.close();
if (problems.length) {
  console.error('PROBLEMS:\n' + [...new Set(problems)].join('\n'));
  process.exit(1);
}
console.log('ok');

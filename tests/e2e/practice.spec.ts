import { expect, test, type Page } from '@playwright/test';
import type { Profile } from '@/features/practice/model/types';

const storageKey = 'wordstride.profile.v1';
const letters = 'abcdefghijklmnopqrstuvwxyz';
const fixtureWords = (letter: string) => [...letters.slice(0, 25)].map(suffix => letter + 'test' + suffix);
const keyButton = (page: Page, key: string) => page.locator('.key-choice[data-key="' + key + '"]');
const input = (page: Page) => page.getByRole('textbox', { name: 'Typing input' });

test.beforeEach(async ({ page }) => {
  await page.route('**/words/en/*.json', route => {
    const letter = route.request().url().split('/').at(-1)!.replace('.json', '');
    return route.fulfill({ json: fixtureWords(letter) });
  });
  await page.route('https://api.dictionaryapi.dev/**', route => {
    const word = route.request().url().split('/').at(-1)!;
    return route.fulfill({ json: [{ word, meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A test definition for ' + word + '.', example: 'This example uses ' + word + '.' }] }], sourceUrls: ['https://en.wiktionary.org/'], license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' } }] });
  });
  await page.addInitScript(() => {
    const state = window as typeof window & { audioStarts: number };
    state.audioStarts = 0;
    class FakeAudioContext {
      currentTime = 0;
      state = 'running';
      destination = {};
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createOscillator() {
        return { type: 'sine', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {}, disconnect() {}, start() { state.audioStarts++; }, stop() {} };
      }
      createGain() {
        return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} };
      }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  });
});

async function storedProfile(page: Page): Promise<Profile> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey);
}
async function sounds(page: Page) {
  return page.evaluate(() => (window as typeof window & { audioStarts: number }).audioStarts);
}
async function startKey(page: Page, key: string, targets?: { wpm: number; accuracy: number; dailyGoal: number }) {
  await keyButton(page, key).click();
  if (targets) {
    await page.getByLabel('Speed target', { exact: true }).fill(String(targets.wpm));
    await page.getByLabel('Accuracy target', { exact: true }).fill(String(targets.accuracy));
    await page.getByLabel('Daily goal', { exact: true }).fill(String(targets.dailyGoal));
  }
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.locator('.current-word')).toBeVisible();
  await input(page).focus();
}
async function nextWord(page: Page) { return (await page.locator('.current-word').getAttribute('data-word'))!; }
async function completeWord(page: Page) {
  const word = await nextWord(page);
  await input(page).pressSequentially(word);
  await page.keyboard.press('Space');
  return word;
}
async function readBatch(page: Page) {
  await expect(page.locator('.word')).toHaveCount(25);
  return page.locator('.word').evaluateAll(words => words.map(word => word.getAttribute('data-word')!));
}
async function controlledClock(page: Page) {
  const time = new Date('2026-11-22T09:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
}

test('All keys start unchecked and clickable; practice begins with explicit selection', async ({ page }) => {
  await page.goto('/');
  const keys = page.locator('.key-choice');
  await expect(keys).toHaveCount(26);
  await expect(page.locator('.key-choice.locked[data-mastered="false"]')).toHaveCount(26);
  await expect(page.locator('.all-keys .key-check')).toHaveCount(0);
  expect(await keys.evaluateAll(elements => elements.every(element => !(element as HTMLButtonElement).disabled))).toBe(true);
  await expect(input(page)).toHaveCount(0);
  await expect(page.locator('.lesson-toolbar')).toHaveCount(0);
  await expect(page.getByLabel('Practice mode')).toHaveCount(0);
  await keyButton(page, 'z').click();
  await expect(page.getByLabel('Speed target', { exact: true })).toHaveValue('45');
  await expect(page.getByLabel('Accuracy target', { exact: true })).toHaveValue('97');
  await expect(page.getByLabel('Daily goal', { exact: true })).toHaveValue('20');
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.locator('.current-word')).toHaveAttribute('data-word', /^z/);
  await expect(keyButton(page, 'z')).toHaveAttribute('aria-pressed', 'true');
  await expect(keyButton(page, 'z')).toHaveAttribute('data-mastered', 'false');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/wordstride-mobile.png', fullPage: true });
});

test('Per-key targets and daily practice persist without changing other keys', async ({ page }) => {
  await controlledClock(page);
  await page.goto('/');
  await startKey(page, 'r', { wpm: 60, accuracy: 99, dailyGoal: 15 });
  await completeWord(page);
  await page.clock.runFor(5000);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('.practice-targets')).toContainText('Target for R');
  await expect(page.locator('.practice-targets')).toContainText('60 WPM / 99%');
  await expect(page.locator('.goal-label')).toContainText('/ 15 min');
  const saved = await storedProfile(page);
  expect(saved.selectedKey).toBe('r');
  expect(saved.keys.r.targets).toEqual({ wpm: 60, accuracy: 99, dailyGoal: 15 });
  expect(Object.values(saved.keys.r.daily).reduce((sum, ms) => sum + ms, 0)).toBe(5000);
  expect(saved.keys.a.targets).toEqual({ wpm: 45, accuracy: 97, dailyGoal: 20 });
  expect(saved.keys.a.daily).toEqual({});
  await keyButton(page, 'r').click();
  await expect(page.getByLabel('Speed target', { exact: true })).toHaveValue('60');
  await expect(page.getByLabel('Accuracy target', { exact: true })).toHaveValue('99');
  await expect(page.getByLabel('Daily goal', { exact: true })).toHaveValue('15');
});

test('Batches contain 25 distinct prefix words and remain available after reuse', async ({ page }) => {
  await page.goto('/');
  await startKey(page, 'r');
  const first = await readBatch(page);
  expect(new Set(first).size).toBe(25);
  expect(first.every(word => word.startsWith('r'))).toBe(true);
  for (let index = 0; index < 25; index++) await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: 'One word closer.' })).toBeVisible();
  await page.getByRole('button', { name: 'Next batch' }).click();
  const second = await readBatch(page);
  expect(new Set(second)).toEqual(new Set(first));
  expect(new Set(second).size).toBe(25);
  await expect(page.getByText('You have finished the available words here.')).toHaveCount(0);
  await input(page).focus();
  await page.keyboard.press('Tab');
  expect(new Set(await readBatch(page))).toEqual(new Set(first));
  await page.reload();
  expect(new Set(await readBatch(page))).toEqual(new Set(first));
});

test('Only correct Space submissions reveal meaning and play success audio', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await startKey(page, 'r');
  const first = await nextWord(page);
  await input(page).pressSequentially(first);
  await expect(page.locator('.vocabulary-word h2')).toHaveText('Your next word');
  expect(await sounds(page)).toBe(0);
  await page.keyboard.press('Enter');
  expect(await sounds(page)).toBe(0);
  await page.keyboard.press('Space');
  await expect(page.locator('.vocabulary-word h2')).toHaveText(first);
  await expect(page.locator('.definition')).toHaveText('A test definition for ' + first + '.');
  await expect(page.locator('.example')).toContainText('This example uses ' + first + '.');
  await expect(page.getByRole('link', { name: 'Dictionary source' })).toBeVisible();
  await expect(page.getByRole('link', { name: /CC BY/ })).toHaveCount(0);
  const successSounds = await sounds(page);
  expect(successSounds).toBeGreaterThan(0);
  await input(page).pressSequentially('q');
  await page.keyboard.press('Space');
  await expect(page.locator('.vocabulary-word h2')).toHaveText(first);
  await expect(page.locator('.typing-hint')).toContainText('Word skipped');
  expect(await sounds(page)).toBe(successSounds);
  await page.keyboard.press('Space');
  expect(await sounds(page)).toBe(successSounds);
  await page.getByRole('button', { name: 'Sound on', exact: true }).click();
  await input(page).focus();
  await page.keyboard.press('Enter');
  await completeWord(page);
  expect(await sounds(page)).toBe(successSounds);
  await page.screenshot({ path: 'test-results/wordstride-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('Backspace preserves mistake accounting and Shift Tab leaves the input', async ({ page }) => {
  await page.goto('/');
  await startKey(page, 'r');
  const word = await nextWord(page);
  await input(page).pressSequentially('q');
  await page.keyboard.press('Backspace');
  await input(page).pressSequentially(word);
  await page.keyboard.press('Space');
  await expect(page.locator('.vocabulary-word h2')).toHaveText(word);
  await expect(page.locator('.metric').filter({ hasText: 'ACCURACY' }).locator('strong')).not.toHaveText('100.0%');
  await page.keyboard.press('Shift+Tab');
  await expect(input(page)).not.toBeFocused();
});

test('Escape and inactivity pause time, and the configured session duration finishes practice', async ({ page }) => {
  await controlledClock(page);
  await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({ version: 2, settings: { duration: 30 } })), storageKey);
  await page.goto('/');
  await startKey(page, 'r');
  await completeWord(page);
  await page.clock.runFor(2000);
  await page.keyboard.press('Escape');
  await expect(page.locator('.typing-hint')).toContainText('paused');
  const before = await storedProfile(page);
  await page.clock.runFor(20000);
  expect((await storedProfile(page)).keys.r.daily).toEqual(before.keys.r.daily);
  await page.keyboard.press('Enter');
  await completeWord(page);
  await page.clock.runFor(4999);
  await expect(page.locator('.typing-hint')).not.toContainText('paused');
  await page.clock.runFor(1);
  await expect(page.locator('.typing-hint')).toContainText('paused');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 6; i++) { await completeWord(page); await page.clock.runFor(4000); }
  await expect(page.getByRole('heading', { name: 'One word closer.' })).toBeVisible();
  expect(Object.values((await storedProfile(page)).keys.r.daily).reduce((sum, ms) => sum + ms, 0)).toBe(30000);
});

test('Meeting both configured targets in a completed session checks off only its key', async ({ page }) => {
  await controlledClock(page);
  await page.goto('/');
  await startKey(page, 'r', { wpm: 60, accuracy: 99, dailyGoal: 15 });
  await completeWord(page);
  await page.clock.runFor(1000);
  await expect(keyButton(page, 'r')).toHaveAttribute('data-mastered', 'false');
  for (let index = 1; index < 25; index++) await completeWord(page);
  await expect(page.getByRole('heading', { name: 'One word closer.' })).toBeVisible();
  await expect(keyButton(page, 'r')).toHaveAttribute('data-mastered', 'true');
  await expect(keyButton(page, 'r').locator('.key-check')).toHaveText('✓');
  await expect(page.locator('.key-choice[data-mastered="true"]')).toHaveCount(1);
  await page.reload();
  await expect(keyButton(page, 'r')).toHaveAttribute('data-mastered', 'true');
  const saved = await storedProfile(page);
  expect(saved.keys.r.history[0].accuracy).toBe(100);
  expect(saved.keys.r.history[0].wpm).toBeGreaterThanOrEqual(60);
});

test('A completed session below the accuracy target leaves its key unchecked', async ({ page }) => {
  await controlledClock(page);
  await page.goto('/');
  await startKey(page, 'r');
  await page.keyboard.press('Space');
  await page.clock.runFor(1000);
  for (let index = 1; index < 25; index++) await completeWord(page);
  await expect(page.getByRole('heading', { name: 'One word closer.' })).toBeVisible();
  await expect(keyButton(page, 'r')).toHaveAttribute('data-mastered', 'false');
  expect((await storedProfile(page)).keys.r.history[0].accuracy).toBe(96);
});

test('Profile menu provides sound preview and a graph with independent key statistics', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({
    version: 2, selectedKey: 'r', bestWpm: 62, settings: { sound: false },
    keys: {
      r: { bestWpm: 62, mastered: true, history: [{ key: 'r', date: '2026-11-22', wpm: 62, accuracy: 99, correct: 25, skipped: 0 }] },
      a: { bestWpm: 24, history: [{ key: 'a', date: '2026-11-22', wpm: 24, accuracy: 96, correct: 24, skipped: 1 }] },
    },
  })), storageKey);
  await page.goto('/');
  await page.locator('.profile-menu summary').click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Preview sound' }).click();
  await expect.poll(() => sounds(page)).toBeGreaterThan(0);
  await expect(page.getByRole('checkbox', { name: /Success sound/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('.profile-menu summary').click();
  await page.getByRole('button', { name: 'Statistics', exact: true }).click();
  await expect(page.locator('.chart-column')).toHaveCount(26);
  await expect(page.getByRole('button', { name: 'R: 62.0 WPM, achieved', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'A: 24.0 WPM', exact: true }).click();
  await expect(page.getByLabel('Statistics for key')).toHaveValue('a');
  await expect(page.locator('.key-statistics')).toContainText('24.0 WPM');
  await expect(page.locator('.key-statistics')).toContainText('96.0%');
  await expect(page.locator('.history-list')).toContainText('2026-11-22 · A');
  await page.getByLabel('Statistics for key').selectOption('z');
  await expect(page.locator('.statistics-dialog')).toContainText('Complete a session to record');
  expect((await storedProfile(page)).selectedKey).toBe('r');
});

test('Clearing storage while idle resets the visible score and survives reload', async ({ page }) => {
  await page.goto('/');
  await startKey(page, 'r');
  await completeWord(page);
  await page.keyboard.press('Escape');
  const score = page.locator('.metric').filter({ hasText: 'SCORE' }).locator('strong');
  await expect(score).not.toHaveText('0');
  await page.evaluate(() => localStorage.clear());
  await expect(score).toHaveText('0');
  await expect(input(page)).toHaveCount(0);
  await expect(page.locator('.key-choice[data-mastered="false"]')).toHaveCount(26);
  await page.reload();
  await expect(score).toHaveText('0');
  expect((await storedProfile(page)).keys.r.daily).toEqual({});
});

test('Deleting progress immediately before a lifecycle save cannot restore old data', async ({ page }) => {
  await page.goto('/');
  await startKey(page, 'r');
  await completeWord(page);
  await page.evaluate(key => {
    localStorage.removeItem(key);
    window.dispatchEvent(new Event('pagehide'));
  }, storageKey);
  await expect(page.locator('.metric').filter({ hasText: 'SCORE' }).locator('strong')).toHaveText('0');
  await page.reload();
  expect((await storedProfile(page)).score).toBe(0);
  expect((await storedProfile(page)).selectedKey).toBeNull();
});

test('Clearing progress in another tab resets the original tab', async ({ page, context }) => {
  await page.goto('/');
  await startKey(page, 'r');
  await completeWord(page);
  const other = await context.newPage();
  await other.goto('/');
  await other.evaluate(() => localStorage.clear());
  await expect(page.locator('.metric').filter({ hasText: 'SCORE' }).locator('strong')).toHaveText('0');
  await page.reload();
  expect((await storedProfile(page)).score).toBe(0);
  await other.close();
});

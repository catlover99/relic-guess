import { expect, gotoMenu, placeGuess, startGame, test } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Sharing a result.
 *
 * The value that matters is what ends up on the clipboard, not what the button
 * looks like, so these read the clipboard back.
 */

async function playThrough(page: Page): Promise<void> {
  for (let round = 1; round <= 5; round++) {
    await placeGuess(page);
    await page.getByRole('button', { name: /lock in guess/i }).click();
    await page
      .getByRole('button', { name: round === 5 ? /see your results/i : /next artifact/i })
      .click();
  }
  await expect(page.getByText(/round by round/i)).toBeVisible();
}

async function copiedText(page: Page): Promise<string> {
  await page.getByRole('button', { name: /share result/i }).click();
  await expect(page.getByRole('button', { name: /copied/i })).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('share', () => {
  test('a daily result names the game, the number, the score and the site', async ({ page }) => {
    await gotoMenu(page);
    await page.getByRole('button', { name: /today's challenge/i }).click();
    await expect(page.getByRole('application')).toBeVisible({ timeout: 60_000 });
    await playThrough(page);

    const text = await copiedText(page);
    const lines = text.split('\n');

    expect(lines[0]).toMatch(/^Relic — Daily #\d+$/);
    expect(lines[1]).toMatch(/^[\d,]+ \/ 25,000$/);
    expect(text).toContain('RelicGuess.com');
    // The URL has to be in the copied text, not only a link in the page.
    expect(lines[lines.length - 1]).toBe('RelicGuess.com');
  });

  test('a daily result gives nothing away', async ({ page }) => {
    await gotoMenu(page);
    await page.getByRole('button', { name: /today's challenge/i }).click();
    await expect(page.getByRole('application')).toBeVisible({ timeout: 60_000 });
    await playThrough(page);

    const text = await copiedText(page);

    // None of the answers, in any form.
    for (const spoiler of [
      'Sphinx',
      'Lamassu',
      'Amphora',
      'Moche',
      'Benin',
      'Testland',
      'findspot',
      'km',
    ]) {
      expect(text).not.toContain(spoiler);
    }
    expect(text).not.toMatch(/-?\d+\.\d+/);
  });

  test('the same daily number is shown on screen and in the copied text', async ({ page }) => {
    await gotoMenu(page);
    await page.getByRole('button', { name: /today's challenge/i }).click();
    await expect(page.getByRole('application')).toBeVisible({ timeout: 60_000 });
    await playThrough(page);

    const heading = await page
      .getByText(/daily #\d+/i)
      .first()
      .textContent();
    const shown = heading?.match(/#(\d+)/)?.[1];
    const text = await copiedText(page);
    expect(shown).toBeTruthy();
    expect(text).toContain(`Daily #${shown}`);
  });

  test('a normal game is not labelled as the daily', async ({ page }) => {
    await startGame(page);
    await playThrough(page);

    const text = await copiedText(page);
    expect(text).not.toContain('Daily');
    expect(text.split('\n')[0]).toMatch(/^Relic — \w+/);
    expect(text).toContain('RelicGuess.com');
  });

  test('the result is compact enough to paste anywhere', async ({ page }) => {
    await startGame(page);
    await playThrough(page);

    const text = await copiedText(page);
    expect(text.split('\n')).toHaveLength(5);
    expect(text.length).toBeLessThan(120);
  });
});

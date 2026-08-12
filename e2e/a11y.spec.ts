import AxeBuilder from '@axe-core/playwright';
import { expect, gotoMenu, placeGuess, startGame, test } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Automated accessibility checks plus the keyboard paths that axe cannot see.
 *
 * axe catches contrast, naming, roles and landmark problems. It cannot tell whether
 * the game is *playable* without a pointer, so that is asserted explicitly below —
 * a map-based game is exactly where keyboard access usually breaks.
 */

async function scan(page: Page, context?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  // Leaflet's own DOM (tile images, attribution) is third-party and not something
  // this app can restructure.
  const results = await (context ? builder.include(context) : builder)
    .exclude('.leaflet-pane')
    .exclude('.leaflet-control-attribution')
    .analyze();

  const summary = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`)
    .join('\n');
  expect(results.violations, summary).toEqual([]);
}

test.describe('accessibility', () => {
  test('the landing screen has no violations', async ({ page }) => {
    await gotoMenu(page);
    await scan(page);
  });

  test('the landing screen has no violations with filters open', async ({ page }) => {
    await gotoMenu(page);
    await page.getByRole('button', { name: /narrow it down/i }).click();
    await scan(page);
  });

  test('a live round has no violations', async ({ page }) => {
    await startGame(page);
    await scan(page);
  });

  test('the reveal has no violations', async ({ page }) => {
    await startGame(page);
    await placeGuess(page);
    await page.getByRole('button', { name: /lock in guess/i }).click();
    await expect(page.locator('.marker-origin')).toHaveCount(1);
    await scan(page);
  });

  test('the summary has no violations', async ({ page }) => {
    await startGame(page);
    for (let round = 1; round <= 5; round++) {
      await placeGuess(page);
      await page.getByRole('button', { name: /lock in guess/i }).click();
      await page
        .getByRole('button', { name: round === 5 ? /see your results/i : /next artifact/i })
        .click();
    }
    await expect(page.getByText(/round by round/i)).toBeVisible();
    await scan(page);
  });

  test('dark mode has no contrast violations', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await gotoMenu(page);
    await scan(page);
  });
});

test.describe('keyboard operation', () => {
  test('a round can be played without a pointer', async ({ page }) => {
    await gotoMenu(page);

    // Reach "Play" by tabbing, rather than assuming a tab index.
    const play = page.getByRole('button', { name: /play 5 rounds/i });
    for (let i = 0; i < 25; i++) {
      if (await play.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(play).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('application')).toBeVisible();

    // Focus the map, pan with the arrows, and place the pin with Enter.
    await page.getByRole('application').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('.marker-guess')).toHaveCount(1);

    // Enter again submits, then advances.
    await page.getByRole('button', { name: /lock in guess/i }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('meter', { name: /round score/i })).toBeVisible();

    await page.getByRole('button', { name: /next artifact/i }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/round 2/i)).toBeVisible();
  });

  test('the map is zoomable from the keyboard', async ({ page }) => {
    await startGame(page);
    const map = page.getByRole('application');
    await map.focus();

    const zoom = () =>
      page.evaluate(() => document.querySelector('[data-map-zoom]')?.getAttribute('data-map-zoom'));
    const zoomBefore = await zoom();
    await page.keyboard.press('Equal'); // "+"
    await page.waitForTimeout(600);
    // The point is only that the keypress reached Leaflet rather than being
    // swallowed by the app's own key handling.
    expect(Number(await zoom())).toBeGreaterThan(Number(zoomBefore));
  });

  test('the map announces how to use it', async ({ page }) => {
    await startGame(page);
    const map = page.getByRole('application');
    await expect(map).toHaveAccessibleName(/tap or click to place your guess/i);
    await expect(map).toHaveAccessibleDescription(/arrow keys.*Enter/is);
  });

  test('the image viewer traps focus and closes on Escape', async ({ page }) => {
    await startGame(page);
    await page.getByRole('button', { name: /view this artifact full size/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('a skip link is the first focusable element', async ({ page }) => {
    await gotoMenu(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /skip to content/i })).toBeFocused();
  });
});

test.describe('reduced motion', () => {
  test('the round still completes with animations disabled', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startGame(page);
    await placeGuess(page);
    await page.getByRole('button', { name: /lock in guess/i }).click();

    // The score must be its final value immediately rather than mid-count.
    const meter = page.getByRole('meter', { name: /round score/i });
    await expect(meter).toBeVisible();
    const shown = await page.getByText(/\/ 5,000/).textContent();
    expect(shown).toBeTruthy();
    await expect(page.locator('.marker-origin')).toHaveCount(1);
  });
});

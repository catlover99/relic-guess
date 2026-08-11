import { expect, placeGuess, test, useLargeBundle } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Broken photographs must never become playable rounds.
 *
 * The photograph *is* the round: an artifact whose image will not load cannot be
 * guessed at. These tests exercise the real browser path — an `<img>` that 404s, a
 * host that never responds, a 200 carrying HTML — because that is where the previous
 * behaviour surfaced as "This photograph could not be loaded. You can still place a
 * guess."
 *
 * They run at desktop and mobile sizes because the artifact panel is a different
 * component tree in each layout.
 */

/** Serves a real, decodable image. */
const GOOD_IMAGE = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="#b08a4a"/></svg>',
);

/** Fails every artifact photograph whose URL matches `pattern`. */
async function breakImages(page: Page, pattern: RegExp, mode: 'abort' | 'notfound' | 'html') {
  await page.route(pattern, (route) => {
    if (mode === 'abort') return route.abort();
    if (mode === 'notfound') return route.fulfill({ status: 404, body: 'gone' });
    // A 200 carrying HTML — the classic hotlink failure, which `onload` alone accepts.
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: '<html>nope</html>' });
  });
}

/** Serves working images for everything not already routed. */
async function serveGoodImages(page: Page) {
  await page.route(/images\.test/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: GOOD_IMAGE }),
  );
}

test.describe('broken artifact photographs', () => {
  // Breaking several photographs needs a pool with room to replace them from.
  test.beforeEach(async ({ page }) => {
    await useLargeBundle(page, 40);
  });

  test('a round is never presented without a working photograph', async ({ page }) => {
    // Break the first two artifacts outright; the rest load.
    await breakImages(page, /images\.test\/[12]\.jpg/, 'notfound');
    await serveGoodImages(page);

    await page.goto('/');
    await page.getByRole('button', { name: /play 5 rounds/i }).click();
    await expect(page.getByRole('application')).toBeVisible({ timeout: 60_000 });

    // The old failure copy must never appear.
    await expect(page.getByText(/you can still place a guess/i)).toHaveCount(0);

    // Whatever artifact we landed on, its photograph is on screen and has real size.
    const image = page.getByRole('img', { name: /photograph of/i }).first();
    await expect(image).toBeVisible();
    const box = await image.boundingBox();
    expect(box!.width).toBeGreaterThan(50);
  });

  test('a full five rounds are still playable when images are broken', async ({ page }) => {
    await breakImages(page, /images\.test\/[1234]\.jpg/, 'abort');
    await serveGoodImages(page);

    await page.goto('/');
    await page.getByRole('button', { name: /play 5 rounds/i }).click();
    await expect(page.getByRole('application')).toBeVisible({ timeout: 60_000 });

    for (let round = 1; round <= 5; round++) {
      await expect(page.getByText(new RegExp(`round ${round}`, 'i'))).toBeVisible();
      await expect(page.getByText(/you can still place a guess/i)).toHaveCount(0);
      await placeGuess(page);
      await page.getByRole('button', { name: /lock in guess/i }).click();
      await page
        .getByRole('button', { name: round === 5 ? /see your results/i : /next artifact/i })
        .click();
    }

    // Session length preserved despite the rejections.
    await expect(page.getByText(/round by round/i)).toBeVisible();
    await expect(page.locator('ol li a')).toHaveCount(5);
  });

  test('a photograph that dies mid-round is replaced, not guessed at', async ({ page }) => {
    await serveGoodImages(page);
    await page.goto('/');
    await page.getByRole('button', { name: /play 5 rounds/i }).click();
    await expect(page.getByRole('application')).toBeVisible({ timeout: 60_000 });

    const firstSrc = await page
      .getByRole('img', { name: /photograph of/i })
      .first()
      .getAttribute('src');
    expect(firstSrc).toBeTruthy();

    // The image now fails on reload, simulating an expired CDN URL, and the app
    // re-renders it by changing the src.
    await page.route(firstSrc!, (route) => route.abort());
    await page.evaluate((src) => {
      const img = [...document.querySelectorAll('img')].find((i) => i.src === src);
      // Force a reload of the same URL, which now aborts.
      if (img) img.src = `${src}#retry`;
    }, firstSrc);

    // Either a replacement arrives or the original recovers — but the player is never
    // told to guess without a photograph.
    await expect(page.getByText(/you can still place a guess/i)).toHaveCount(0);
    await expect(page.getByRole('application')).toBeVisible();
  });

  test('a 200 response carrying HTML is treated as a failure', async ({ page }) => {
    await breakImages(page, /images\.test\/1\.jpg/, 'html');
    await serveGoodImages(page);

    await page.goto('/');
    await page.getByRole('button', { name: /play 5 rounds/i }).click();
    await expect(page.getByRole('application')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/you can still place a guess/i)).toHaveCount(0);
  });

  test('an unreachable collection of photographs reports a recoverable error', async ({ page }) => {
    // Every artifact photograph fails.
    await page.route(/images\.test/, (route) => route.abort());

    await page.goto('/');
    await page.getByRole('button', { name: /play 5 rounds/i }).click();

    await expect(
      page.getByText(/couldn't find enough artifacts with available photographs/i),
    ).toBeVisible({ timeout: 90_000 });
    // Recoverable: a way back, not a dead end.
    await expect(page.getByRole('button', { name: /back to the menu|try again/i })).toBeVisible();
  });

  test('the daily challenge only uses verified photographs', async ({ page }) => {
    await breakImages(page, /images\.test\/[13]\.jpg/, 'notfound');
    await serveGoodImages(page);

    await page.goto('/');
    await page.getByRole('button', { name: /today's challenge/i }).click();
    await expect(page.getByRole('application')).toBeVisible({ timeout: 60_000 });

    await expect(page.getByText(/you can still place a guess/i)).toHaveCount(0);
    const src = await page
      .getByRole('img', { name: /photograph of/i })
      .first()
      .getAttribute('src');
    expect(src).not.toMatch(/\/(1|3)\.jpg/);
  });

  test('the daily challenge is identical across reloads despite broken images', async ({
    page,
  }) => {
    await breakImages(page, /images\.test\/[24]\.jpg/, 'notfound');
    await serveGoodImages(page);

    const idsFor = async () => {
      await page.goto('/');
      await page.getByRole('button', { name: /today's challenge/i }).click();
      await expect(page.getByRole('application')).toBeVisible({ timeout: 60_000 });
      return page.locator('[data-artifact-id]').first().getAttribute('data-artifact-id');
    };

    const first = await idsFor();
    const second = await idsFor();
    expect(second).toBe(first);
  });
});

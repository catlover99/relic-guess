import { expect, placeGuess, startGame, test } from './fixtures';

/**
 * The guessing map.
 *
 * Players reported two things that made the old raster basemap unusable: country
 * names appeared in the local language, and they were too small to read on a phone
 * even after zooming in. Both are properties of the *rendered page* rather than of
 * any function, so they are checked here.
 */

test.describe('basemap', () => {
  test('labels countries in English', async ({ page }) => {
    await startGame(page);
    const labels = page.locator('.atlas-country-label');
    await expect(labels.first()).toBeVisible();

    const names = await labels.allTextContents();
    expect(names.length).toBeGreaterThan(0);

    /*
     * Every name on screen comes from our own basemap, in Latin script. The real
     * file takes them from Natural Earth's NAME_EN; the point of the assertion is
     * that no localised name can leak in from a tile server's baked-in labels.
     */
    for (const name of names) {
      expect(name).toMatch(/^(Testland|Country [NS]\d+E-?\d+)$/);
      expect(name).toMatch(/^[\p{Script=Latin}\p{P}\s\d-]+$/u);
    }
  });

  test('never falls back to a tile provider', async ({ page }) => {
    const tileRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (/tile|\.pbf|arcgisonline|wikimedia|cartocdn|basemaps/.test(url)) tileRequests.push(url);
    });

    await startGame(page);
    await page.waitForTimeout(1000);

    // A POI-heavy raster fallback appearing silently is exactly the regression
    // this guards: the map must be drawn from the bundled basemap alone.
    expect(tileRequests).toEqual([]);
    await expect(page.locator('img.leaflet-tile')).toHaveCount(0);
  });

  test('shows no navigation clutter', async ({ page }) => {
    await startGame(page);
    await expect(page.locator('.atlas-country-label').first()).toBeVisible();

    // The data contains countries, lakes and capitals — there is no road, shop or
    // transit layer to render, so nothing can reintroduce them.
    const text = (await page.locator('.leaflet-pane').first().innerText()).toLowerCase();
    for (const clutter of ['restaurant', 'hotel', 'hospital', 'station', 'motorway', 'cafe']) {
      expect(text).not.toContain(clutter);
    }
  });

  test('credits the map data', async ({ page }) => {
    await startGame(page);
    await expect(page.getByRole('link', { name: /natural earth/i })).toBeVisible();
  });

  test('keeps country labels legible while zooming', async ({ page }) => {
    await startGame(page);
    const label = page.locator('.atlas-country-label').first();
    await expect(label).toBeVisible();

    const sizeAt = async () =>
      label.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    const before = await sizeAt();

    const map = page.getByRole('application');
    await map.focus();
    await page.keyboard.press('Equal');
    await page.waitForTimeout(700);

    // Real text, not pixels baked into a tile: zooming must not shrink it.
    await expect(page.locator('.atlas-country-label').first()).toBeVisible();
    expect(await sizeAt()).toBeGreaterThanOrEqual(before);
  });

  test('labels do not swallow taps meant for the map', async ({ page }) => {
    await startGame(page);
    await expect(page.locator('.atlas-country-label').first()).toBeVisible();

    /*
     * Tap directly on a country name, choosing one well inside the map so the
     * test is about pointer-events rather than about hitting the map's edge or
     * the overlaid hint.
     */
    const map = page.getByRole('application');
    const mapBox = (await map.boundingBox())!;
    const target = await page.evaluate((rect) => {
      const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      let best: { x: number; y: number; d: number } | null = null;
      for (const node of document.querySelectorAll('.atlas-country-label')) {
        const box = node.getBoundingClientRect();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        // Must be comfortably inside the map, away from every edge.
        if (x < rect.x + 60 || x > rect.x + rect.width - 60) continue;
        if (y < rect.y + 80 || y > rect.y + rect.height - 80) continue;
        const d = Math.hypot(x - centre.x, y - centre.y);
        if (!best || d < best.d) best = { x, y, d };
      }
      return best;
    }, mapBox);

    expect(target, 'no country label sits inside the map').not.toBeNull();
    await page.mouse.move(target!.x, target!.y);
    await page.mouse.down();
    await page.mouse.up();

    await expect(page.locator('.marker-guess')).toHaveCount(1);
  });

  test('the guess and origin markers stay distinguishable', async ({ page }) => {
    await startGame(page);
    await placeGuess(page);
    await page.getByRole('button', { name: /lock in guess/i }).click();

    const guess = page.locator('.marker-guess');
    const origin = page.locator('.marker-origin');
    await expect(guess).toHaveCount(1);
    await expect(origin).toHaveCount(1);

    // Different shapes, not just different colours.
    const guessShape = await guess.locator('svg').innerHTML();
    const originShape = await origin.locator('svg').innerHTML();
    expect(guessShape).not.toBe(originShape);
  });
});

test.describe('basemap — mobile readability', () => {
  /*
   * Only the stacked layout. Label size follows the *layout*, not the device: a
   * phone held in landscape gets the split layout with a wide map, where the
   * desktop size is the right one. The condition mirrors the split-layout media
   * query in RoundScreen — (min-width: 64rem) or (min-width: 40rem) and
   * (max-height: 34rem).
   */
  test.skip(({ viewport }) => {
    const width = viewport?.width ?? 0;
    const height = viewport?.height ?? 0;
    const split = width >= 1024 || (width >= 640 && height <= 544);
    return split;
  }, 'about the stacked phone layout specifically');

  test('country names are large enough to read on a phone', async ({ page }) => {
    await startGame(page);
    const label = page.locator('.atlas-country-label').first();
    await expect(label).toBeVisible();

    const fontSize = await label.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    // The old raster basemap effectively rendered ~6px text on a 3x phone.
    expect(fontSize).toBeGreaterThanOrEqual(14);
  });

  test('labels are larger on a phone than on a desktop', async ({ page }) => {
    await startGame(page);
    const compact = await page
      .locator('.atlas-country-label')
      .first()
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));

    // Same page, desktop width: the phone must not be getting the smaller type.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);
    const wide = await page
      .locator('.atlas-country-label')
      .first()
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));

    expect(compact).toBeGreaterThan(wide);
  });

  test('every country label has a halo so it stays readable over land and sea', async ({
    page,
  }) => {
    await startGame(page);
    const label = page.locator('.atlas-country-label').first();
    await expect(label).toBeVisible();
    const stroke = await label.evaluate((node) => getComputedStyle(node).webkitTextStrokeWidth);
    expect(parseFloat(stroke)).toBeGreaterThan(0);
  });
});

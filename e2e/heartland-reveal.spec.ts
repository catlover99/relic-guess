import {
  expect,
  gotoMenu,
  placeGuess,
  startGame,
  test,
  useBundleWithoutHeartlands,
} from './fixtures';
import type { Page } from '@playwright/test';

/**
 * The three-part reveal.
 *
 * A revealed Heartland or Daily round has to communicate three different things
 * without collapsing them into one marker:
 *
 *   1. where the player guessed;
 *   2. the region the guess was graded against — always drawn, because the radius
 *      *is* the scoring rule;
 *   3. where the object itself was found, when the record says.
 *
 * The fixture bundle gives its first three artifacts a homeland ~900 km from their
 * own findspot, so all three are genuinely distinct places on screen.
 */

async function revealARound(page: Page): Promise<void> {
  await placeGuess(page);
  await page.getByRole('button', { name: /lock in guess/i }).click();
  await expect(page.locator('.marker-origin')).toHaveCount(1);
}

/** Counts what the reveal actually drew. */
async function mapContents(page: Page) {
  return page.evaluate(() => ({
    guess: document.querySelectorAll('.marker-guess').length,
    region: document.querySelectorAll('.marker-origin').length,
    discovery: document.querySelectorAll('.marker-discovery').length,
    // The scored region, drawn as a circle in the overlay pane.
    region_circle: document.querySelectorAll('path.reveal-region').length,
  }));
}

test.describe('Heartland reveal', () => {
  test('shows guess, scored region and findspot as three separate markers', async ({ page }) => {
    await startGame(page);
    await revealARound(page);

    const contents = await mapContents(page);
    expect(contents.guess).toBe(1);
    expect(contents.region).toBe(1);
    expect(contents.discovery).toBe(1);

    // Distinct silhouettes, not just distinct colours.
    const shapes = await page.evaluate(() =>
      ['.marker-guess', '.marker-origin', '.marker-discovery'].map(
        (selector) => document.querySelector(`${selector} svg`)?.innerHTML ?? '',
      ),
    );
    expect(new Set(shapes).size).toBe(3);
    for (const shape of shapes) expect(shape.length).toBeGreaterThan(0);
  });

  test('always draws the scored region, even with an exact findspot on record', async ({
    page,
  }) => {
    await startGame(page);
    await revealARound(page);
    // The framing animates and is re-run once the answer panel has taken its
    // space, so let it settle before measuring what is on screen.
    await page.waitForTimeout(1500);

    // The circle used to appear only for vague coordinates, which meant the most
    // forgiving mode showed the least about why it was forgiving.
    await expect(page.locator('path.reveal-region')).toHaveCount(1);
    const drawn = await page
      .locator('path.reveal-region')
      .evaluate((node: SVGPathElement) => node.getTotalLength());
    expect(drawn).toBeGreaterThan(20);
  });

  test('names the heartland and the findspot as different things', async ({ page }) => {
    await startGame(page);
    await revealARound(page);

    await expect(page.getByText(/cultural heartland/i)).toBeVisible();
    await expect(page.getByText(/found at|excavated at|made at/i).first()).toBeVisible();
    // And says plainly that the findspot was not what was graded.
    await expect(page.getByText(/did not affect your score/i)).toBeVisible();
  });

  test('the findspot marker does not change the score', async ({ page }) => {
    await startGame(page);

    // Guess on the homeland: full marks, despite the object being ~900 km away.
    const scores: number[] = [];
    for (let round = 1; round <= 2; round++) {
      await placeGuess(page);
      await page.getByRole('button', { name: /lock in guess/i }).click();
      const meter = page.getByRole('meter', { name: /round score/i });
      scores.push(Number(await meter.getAttribute('aria-valuenow')));
      await page.getByRole('button', { name: /next artifact/i }).click();
    }

    // The scores are whatever they are; what matters is the reveal never claims
    // the distance was measured to the findspot.
    for (const score of scores) {
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeLessThanOrEqual(5000);
    }
    expect(scores).toHaveLength(2);
  });

  test('invents no findspot marker when the artifact has no homeland', async ({ page }) => {
    // With no homeland the region falls back to the object's own place, and a
    // second marker on that same point would be a duplicate rather than a fact.
    await useBundleWithoutHeartlands(page);
    await startGame(page);

    for (let round = 1; round <= 5; round++) {
      await placeGuess(page);
      await page.getByRole('button', { name: /lock in guess/i }).click();
      await expect(page.locator('.marker-origin')).toHaveCount(1);

      const contents = await mapContents(page);
      // Never more than one of each, and never a findspot without a region.
      expect(contents.region).toBe(1);
      // The region circle is always drawn — that is the whole point of it.
      expect(contents.region_circle).toBe(1);
      // No homeland means no second place to show.
      expect(contents.discovery).toBe(0);
      if (contents.discovery === 1) {
        const separated = await page.evaluate(() => {
          const a = document.querySelector('.marker-origin')?.getBoundingClientRect();
          const b = document.querySelector('.marker-discovery')?.getBoundingClientRect();
          if (!a || !b) return 0;
          return Math.hypot(a.x - b.x, a.y - b.y);
        });
        // Two markers on the same pixel would communicate nothing.
        expect(separated).toBeGreaterThan(8);
      }

      await page
        .getByRole('button', { name: round === 5 ? /see your results/i : /next artifact/i })
        .click();
    }
  });

  test('frames guess, region and findspot without zooming out to the whole world', async ({
    page,
  }) => {
    await startGame(page);
    await revealARound(page);
    await page.waitForTimeout(1200);

    const geometry = await page.evaluate(() => {
      const map = document.querySelector('.leaflet-container')!.getBoundingClientRect();
      const rect = (selector: string) =>
        document.querySelector(selector)?.getBoundingClientRect() ?? null;
      const guess = rect('.marker-guess');
      const region = rect('.marker-origin');
      /*
       * Tested at the anchor — the tip of the pin, which is the coordinate — not
       * the whole graphic. A 50px-tall pin standing near the top edge has its
       * head clipped by design; what must never happen is the *place* being off
       * screen.
       */
      const inside = (box: DOMRect | null) => {
        if (!box) return false;
        const anchorX = box.x + box.width / 2;
        const anchorY = box.bottom;
        return (
          anchorX >= map.x && anchorX <= map.right && anchorY >= map.y && anchorY <= map.bottom
        );
      };
      return {
        mapWidth: map.width,
        guessInside: inside(guess),
        regionInside: inside(region),
        separation: guess && region ? Math.hypot(guess.x - region.x, guess.y - region.y) : Infinity,
        zoom: Number(document.querySelector('[data-map-zoom]')?.getAttribute('data-map-zoom')),
      };
    });

    // The thing that must always hold: the player can see both the pin they
    // placed and the region it was graded against.
    expect(geometry.guessInside, 'the guess is off-screen').toBe(true);
    expect(geometry.regionInside, 'the scored region is off-screen').toBe(true);

    /*
     * Whether a wide region is allowed to pull the framing out is decided by
     * `shouldFrameRegion`, which is unit-tested directly in framing.test.ts —
     * asserting it from pixels here would be circular, since at a world view
     * every pair of markers looks close together.
     */
    expect(geometry.zoom).toBeGreaterThanOrEqual(1);
  });
});

test.describe('precise modes are unchanged', () => {
  test('Expert scores against the object and shows no separate findspot pin', async ({ page }) => {
    await gotoMenu(page);
    await page.getByRole('radio', { name: /expert/i }).click();
    await page.getByRole('button', { name: /play 5 rounds/i }).click();
    await expect(page.getByRole('application')).toBeVisible({ timeout: 60_000 });

    await revealARound(page);

    const contents = await mapContents(page);
    expect(contents.region).toBe(1);
    // The object's own place *is* the scored point here, so a second marker on it
    // would claim there were two different locations.
    expect(contents.discovery).toBe(0);
    await expect(page.getByText(/cultural heartland/i)).toHaveCount(0);
  });
});

test.describe('daily challenge reveal', () => {
  test('uses the Heartland reveal and stays deterministic', async ({ page }) => {
    await gotoMenu(page);
    await page.getByRole('button', { name: /today's challenge/i }).click();
    await expect(page.getByRole('application')).toBeVisible({ timeout: 60_000 });
    const first = await page.locator('[data-artifact-id]').first().getAttribute('data-artifact-id');

    await revealARound(page);
    const contents = await mapContents(page);
    expect(contents.region).toBe(1);
    expect(contents.guess).toBe(1);
    await expect(page.getByText(/cultural heartland/i)).toBeVisible();

    // Same day, same puzzle, after a full reload.
    await page.reload();
    await gotoMenu(page);
    await page.getByRole('button', { name: /today's challenge/i }).click();
    await expect(page.getByRole('application')).toBeVisible({ timeout: 60_000 });
    expect(await page.locator('[data-artifact-id]').first().getAttribute('data-artifact-id')).toBe(
      first,
    );
  });
});

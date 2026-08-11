import { expect, gotoMenu, placeGuess, startGame, test } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Layout verification at every required viewport.
 *
 * These are the assertions that catch what CSS breakpoints alone do not: that
 * nothing overflows horizontally, that the primary action is actually on screen,
 * that touch targets are large enough, and that the map is big enough to play on.
 */

/** No element may push the document wider than the viewport. */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      // Identify the widest offender to make failures diagnosable.
      culprit: (() => {
        for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.right > doc.clientWidth + 1) {
            return `${element.tagName.toLowerCase()}.${element.className}`.slice(0, 120);
          }
        }
        return null;
      })(),
    };
  });
  expect(
    overflow.scrollWidth,
    `horizontal overflow; widest offender: ${overflow.culprit ?? 'unknown'}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/**
 * Every visible interactive element must be big enough to hit and horizontally
 * on-screen.
 *
 * Vertical position is deliberately *not* asserted: the landing and summary screens
 * scroll, so a control below the fold is reachable rather than broken. Controls that
 * must be visible without scrolling are asserted individually with `toBeInViewport`.
 */
async function expectUsableTargets(page: Page, minSize = 40) {
  const problems = await page.evaluate((min) => {
    const found: string[] = [];
    const viewportWidth = window.innerWidth;

    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>('button, a[href], [role="radio"], [role="button"]'),
    )) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
        continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const label = `${element.tagName.toLowerCase()}:${(
        element.textContent ??
        element.getAttribute('aria-label') ??
        ''
      )
        .trim()
        .slice(0, 40)}`;

      // Leaflet's own attribution links are intentionally small print.
      if (element.closest('.leaflet-control-attribution')) continue;
      // The skip link is parked off-screen by design until it receives focus.
      if (element.classList.contains('skip-link')) continue;
      // Inline links inside prose are not tap targets in the button sense.
      if (element.tagName === 'A' && rect.height < min && element.closest('p, dd, footer'))
        continue;

      if (rect.height < min) found.push(`too short (${Math.round(rect.height)}px): ${label}`);
      if (rect.right < 0 || rect.left > viewportWidth) found.push(`off-screen x: ${label}`);
    }
    return found;
  }, minSize);

  expect(problems, problems.join('\n')).toEqual([]);
}

test.describe('landing screen', () => {
  test('fits the viewport with no horizontal overflow', async ({ page }) => {
    await gotoMenu(page);
    await expectNoHorizontalOverflow(page);
  });

  test('primary action is visible without scrolling past it', async ({ page }, testInfo) => {
    // A phone in landscape has ~390px of height in total; the rules plus the
    // difficulty control cannot fit above the fold there, and the landing screen
    // is allowed to scroll because it is not part of the gameplay loop.
    test.skip(testInfo.project.name === 'mobile-landscape', 'no room above the fold at 844×390');
    await gotoMenu(page);
    await expect(page.getByRole('button', { name: /play 5 rounds/i })).toBeInViewport();
  });

  test('all controls are reachable and adequately sized', async ({ page }) => {
    await gotoMenu(page);
    await expectUsableTargets(page);
  });

  test('the filter panel does not break the layout when opened', async ({ page }) => {
    await gotoMenu(page);
    await page.getByRole('button', { name: /narrow it down/i }).click();
    await expect(page.getByRole('radiogroup', { name: /region/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectUsableTargets(page);
  });
});

test.describe('round screen', () => {
  test('no horizontal overflow while guessing', async ({ page }) => {
    await startGame(page);
    await expectNoHorizontalOverflow(page);
  });

  test('no horizontal overflow after the reveal', async ({ page }) => {
    await startGame(page);
    await placeGuess(page);
    await page.getByRole('button', { name: /lock in guess/i }).click();
    await expect(page.locator('.marker-origin')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
  });

  test('the page itself never scrolls — the panels do', async ({ page }) => {
    // Excessive scrolling during the core loop is the failure mode this guards.
    await startGame(page);
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    );
    expect(scrollable).toBeLessThanOrEqual(2);
  });

  test('the primary action stays on screen', async ({ page }) => {
    await startGame(page);
    await expect(
      page.getByRole('button', { name: /tap the map to place a pin/i }),
    ).toBeInViewport();

    await placeGuess(page);
    const submit = page.getByRole('button', { name: /lock in guess/i });
    await expect(submit).toBeInViewport();

    await submit.click();
    await expect(page.getByRole('button', { name: /next artifact/i })).toBeInViewport();
  });

  test('the map gets a usable share of the viewport', async ({ page }) => {
    await startGame(page);
    const box = (await page.getByRole('application').boundingBox())!;
    const viewport = page.viewportSize()!;

    // A map smaller than this is not explorable; the old 40vh slab failed here.
    expect(box.height).toBeGreaterThanOrEqual(180);
    expect(box.height / viewport.height).toBeGreaterThan(0.3);
    expect(box.width).toBeGreaterThan(viewport.width * 0.45);
  });

  test('map controls are inside the viewport and large enough', async ({ page }) => {
    await startGame(page);
    const zoomIn = page.locator('.leaflet-control-zoom-in');
    await expect(zoomIn).toBeInViewport();
    const box = (await zoomIn.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.height).toBeGreaterThanOrEqual(40);
  });

  test('round controls are reachable and adequately sized', async ({ page }) => {
    await startGame(page);
    await expectUsableTargets(page);
  });

  test('the artifact image never exceeds its container', async ({ page }) => {
    await startGame(page);
    const overflowing = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        // Leaflet's tiles sit in zero-sized absolutely-positioned containers by
        // design, so they always "overflow" and are not what this checks.
        .filter((image) => !image.closest('.leaflet-pane'))
        .filter((image) => {
          const parent = image.parentElement;
          if (!parent) return false;
          const a = image.getBoundingClientRect();
          const b = parent.getBoundingClientRect();
          return a.width > b.width + 1 || a.height > b.height + 1;
        })
        .map((image) => image.getAttribute('alt') ?? image.src),
    );
    expect(overflowing, overflowing.join(', ')).toEqual([]);
  });

  test('the reveal panel is scrollable rather than clipped', async ({ page }) => {
    await startGame(page);
    await placeGuess(page);
    await page.getByRole('button', { name: /lock in guess/i }).click();

    // The source link lives at the bottom of the reveal; it must be reachable.
    const link = page.getByRole('link', { name: /view the original record/i });
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeInViewport();
  });
});

test.describe('stacked layout', () => {
  test('collapsing the artifact card gives its space to the map', async ({ page }) => {
    await startGame(page);
    // Which layout is active is decided by viewport area, not by project name, so
    // the collapse control's presence is the reliable signal.
    const toggle = page.getByRole('button', { name: /hide artifact/i });
    test.skip((await toggle.count()) === 0, 'this viewport uses the split layout');

    const map = page.getByRole('application');
    const before = (await map.boundingBox())!.height;

    await toggle.click();
    await expect(page.getByRole('button', { name: /show artifact/i })).toBeVisible();

    const after = (await map.boundingBox())!.height;
    expect(after).toBeGreaterThan(before);
  });
});

test.describe('split layout', () => {
  test('splits the viewport with the map taking most of the width', async ({ page }) => {
    await startGame(page);
    const panel = page.getByRole('complementary');
    test.skip((await panel.count()) === 0, 'this viewport uses the stacked layout');

    const panelBox = (await panel.boundingBox())!;
    const mapBox = (await page.getByRole('application').boundingBox())!;

    // Panel on the left, map on the right, no overlap.
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(mapBox.x + 2);
    expect(mapBox.width).toBeGreaterThan(panelBox.width);
    // Both are full height, so there is no scrolling between artifact and map.
    expect(mapBox.height).toBeGreaterThan(page.viewportSize()!.height * 0.7);
  });
});

test.describe('summary screen', () => {
  test('fits and stays reachable', async ({ page }) => {
    await startGame(page);
    for (let round = 1; round <= 5; round++) {
      await placeGuess(page);
      await page.getByRole('button', { name: /lock in guess/i }).click();
      await page
        .getByRole('button', { name: round === 5 ? /see your results/i : /next artifact/i })
        .click();
    }
    await expect(page.getByText(/round by round/i)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectUsableTargets(page);
  });
});

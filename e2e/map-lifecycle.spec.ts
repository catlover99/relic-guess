import { expect, placeGuess, startGame, test } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Regression guard for the Leaflet container being destroyed mid-session.
 *
 * The original bug: a conditional Tailwind class (`is-guessing`) sat on the very
 * element Leaflet manages. Leaflet adds `leaflet-container`, `leaflet-touch`,
 * `leaflet-grab` and friends to that node imperatively, so when `locked` flipped on
 * submit React rewrote `node.className` and wiped all of them. Every rule that
 * positions the panes and clips the viewport is scoped to `.leaflet-container`, so
 * the map stopped rendering while its event handlers kept working — an invisible but
 * clickable rectangle that never recovered, not even on the next round.
 *
 * These assertions therefore check Leaflet's *own* DOM, not just the wrapper the app
 * renders. Asserting on `role="application"` or on marker counts alone is exactly
 * what let the bug through: the wrapper keeps its size and the markers keep existing
 * as detached, unpositioned nodes.
 */

interface MapHealth {
  containerExists: boolean;
  containerClasses: string[];
  width: number;
  height: number;
  visibility: string;
  opacity: string;
  panes: { map: boolean; tile: boolean; marker: boolean; overlay: boolean };
  tileCount: number;
  positionedTiles: number;
  zoomControlVisible: boolean;
  mapInstances: number;
}

async function mapHealth(page: Page): Promise<MapHealth> {
  return page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('.leaflet-container');
    const rect = container?.getBoundingClientRect();
    const style = container ? getComputedStyle(container) : null;
    const tiles = Array.from(document.querySelectorAll<HTMLElement>('.leaflet-tile'));

    return {
      containerExists: Boolean(container),
      containerClasses: container ? Array.from(container.classList) : [],
      width: Math.round(rect?.width ?? 0),
      height: Math.round(rect?.height ?? 0),
      visibility: style?.visibility ?? 'n/a',
      opacity: style?.opacity ?? 'n/a',
      panes: {
        map: Boolean(document.querySelector('.leaflet-map-pane')),
        tile: Boolean(document.querySelector('.leaflet-tile-pane')),
        marker: Boolean(document.querySelector('.leaflet-marker-pane')),
        overlay: Boolean(document.querySelector('.leaflet-overlay-pane')),
      },
      tileCount: tiles.length,
      // A tile that lost its positioning is the visible symptom of the bug.
      positionedTiles: tiles.filter((tile) => getComputedStyle(tile).position === 'absolute')
        .length,
      zoomControlVisible: (() => {
        const zoom = document.querySelector('.leaflet-control-zoom');
        if (!zoom) return false;
        const box = zoom.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })(),
      // Duplicate instances would show up as more than one container.
      mapInstances: document.querySelectorAll('.leaflet-container').length,
    };
  });
}

function expectHealthy(health: MapHealth, phase: string) {
  expect(health.containerExists, `${phase}: .leaflet-container missing from the DOM`).toBe(true);
  expect(health.containerClasses, `${phase}: Leaflet's own classes were wiped`).toContain(
    'leaflet-container',
  );
  expect(health.mapInstances, `${phase}: expected exactly one map instance`).toBe(1);
  expect(health.width, `${phase}: container has no width`).toBeGreaterThan(100);
  expect(health.height, `${phase}: container has no height`).toBeGreaterThan(100);
  expect(health.visibility, `${phase}: container hidden`).toBe('visible');
  expect(Number(health.opacity), `${phase}: container transparent`).toBeGreaterThan(0);
  expect(health.panes.map, `${phase}: map pane missing`).toBe(true);
  expect(health.panes.tile, `${phase}: tile pane missing`).toBe(true);
  expect(health.panes.marker, `${phase}: marker pane missing`).toBe(true);
  expect(health.panes.overlay, `${phase}: overlay pane missing`).toBe(true);
  expect(health.tileCount, `${phase}: no tiles rendered`).toBeGreaterThan(0);
  expect(health.positionedTiles, `${phase}: tiles lost absolute positioning`).toBe(
    health.tileCount,
  );
  expect(health.zoomControlVisible, `${phase}: zoom control not visible`).toBe(true);
}

test.describe('Leaflet map lifecycle', () => {
  test('the map survives guess, reveal and three round transitions', async ({ page }) => {
    await startGame(page);
    await expect(page.locator('.leaflet-container')).toBeVisible();
    expectHealthy(await mapHealth(page), 'round 1 before guess');

    for (const round of [1, 2, 3]) {
      // --- guessing ---
      expectHealthy(await mapHealth(page), `round ${round} guessing`);

      await placeGuess(page, round * 12 - 24, round * 10 - 20);
      await expect(page.locator('.marker-guess')).toHaveCount(1);
      expectHealthy(await mapHealth(page), `round ${round} pin placed`);

      // --- reveal: the exact transition that used to destroy the container ---
      await page.getByRole('button', { name: /lock in guess/i }).click();
      await expect(page.locator('.marker-origin')).toHaveCount(1);

      const revealed = await mapHealth(page);
      expectHealthy(revealed, `round ${round} reveal`);

      // Both markers, the connecting line and the distance label must be present.
      await expect(page.locator('.marker-guess')).toHaveCount(1);
      await expect(page.locator('.marker-origin')).toHaveCount(1);
      await expect(page.locator('.reveal-line').first()).toBeVisible();
      await expect(page.locator('.distance-badge')).toBeVisible();

      // --- advance --- (rounds 1–3 of 5, so the label is always "Next artifact")
      await page.getByRole('button', { name: /next artifact/i }).click();
      await expect(page.locator('.marker-origin')).toHaveCount(0);
      expectHealthy(await mapHealth(page), `round ${round + 1} after advancing`);
    }
  });

  test('the guess cursor toggles without touching the Leaflet container', async ({ page }) => {
    // The conditional class must live on the wrapper, so that flipping it cannot
    // disturb the classes Leaflet owns.
    await startGame(page);
    const guessingBefore = await page.evaluate(
      () => document.querySelectorAll('.is-guessing .leaflet-container').length,
    );
    expect(guessingBefore).toBe(1);

    await placeGuess(page);
    await page.getByRole('button', { name: /lock in guess/i }).click();
    await expect(page.locator('.marker-origin')).toHaveCount(1);

    const after = await page.evaluate(() => ({
      guessing: document.querySelectorAll('.is-guessing .leaflet-container').length,
      container: document.querySelectorAll('.leaflet-container').length,
      wrapperHasClass: Boolean(document.querySelector('.is-guessing')),
    }));
    // Locked, so the wrapper drops the class — but the container is untouched.
    expect(after.guessing).toBe(0);
    expect(after.wrapperHasClass).toBe(false);
    expect(after.container).toBe(1);
    expectHealthy(await mapHealth(page), 'after lock-in');
  });

  test('a brand new game gets a working map without a reload', async ({ page }) => {
    await startGame(page);
    await placeGuess(page);
    await page.getByRole('button', { name: /lock in guess/i }).click();
    await expect(page.locator('.marker-origin')).toHaveCount(1);

    // Leave to the menu mid-session, then start again.
    await page.getByRole('button', { name: /return to the menu/i }).click();
    await expect(page.getByRole('button', { name: /play 5 rounds/i })).toBeEnabled();
    await page.getByRole('button', { name: /play 5 rounds/i }).click();
    await expect(page.getByRole('application')).toBeVisible();

    expectHealthy(await mapHealth(page), 'second game');
    await placeGuess(page);
    await expect(page.locator('.marker-guess')).toHaveCount(1);
  });

  test('no duplicate handlers accumulate across rounds', async ({ page }) => {
    // One tap must move the single existing pin, never add another.
    await startGame(page);
    for (const round of [1, 2, 3]) {
      await placeGuess(page, round * 15, round * 8);
      await expect(page.locator('.marker-guess')).toHaveCount(1);
      await placeGuess(page, -round * 15, -round * 8);
      await expect(page.locator('.marker-guess')).toHaveCount(1);
      await page.getByRole('button', { name: /lock in guess/i }).click();
      await expect(page.locator('.marker-origin')).toHaveCount(1);
      await page.getByRole('button', { name: /next artifact/i }).click();
      await expect(page.locator('.marker-origin')).toHaveCount(0);
    }
    expectHealthy(await mapHealth(page), 'after three rounds');
  });
});

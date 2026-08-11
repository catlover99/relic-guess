import {
  currentArtifactId,
  expect,
  gotoMenu,
  placeGuess,
  startGame,
  test,
  TEST_ARTIFACTS,
} from './fixtures';

test.describe('core gameplay loop', () => {
  test('start game → guess → submit → reveal → score → next round', async ({ page }) => {
    await startGame(page);

    // A round is live: the artifact is shown and the primary action tells the
    // player what to do.
    await expect(page.getByRole('img', { name: /photograph of/i }).first()).toBeVisible();
    const primary = page.getByRole('button', { name: /tap the map to place a pin/i });
    await expect(primary).toBeVisible();
    await expect(primary).toBeDisabled();

    await placeGuess(page);

    // The pin is placed and the action becomes available.
    const submit = page.getByRole('button', { name: /lock in guess/i });
    await expect(submit).toBeEnabled();
    await expect(page.locator('.marker-guess')).toHaveCount(1);

    await submit.click();

    // Reveal: the true origin marker, the distance and a score all appear.
    await expect(page.locator('.marker-origin')).toHaveCount(1);
    await expect(page.locator('.marker-guess')).toHaveCount(1);
    await expect(page.locator('.reveal-line').first()).toBeVisible();
    await expect(page.locator('.distance-badge')).toBeVisible();
    await expect(page.getByRole('meter', { name: /round score/i })).toBeVisible();
    await expect(page.getByText(/off by/i)).toBeVisible();

    // The answer is stated in words, not only on the map.
    await expect(page.getByText(/findspot/i).first()).toBeVisible();

    // Advancing works and resets the round state.
    await page.getByRole('button', { name: /next artifact/i }).click();
    await expect(page.locator('.marker-origin')).toHaveCount(0);
    await expect(page.locator('.marker-guess')).toHaveCount(0);
    await expect(page.getByText(/round 2/i)).toBeVisible();
  });

  test('completes five rounds and shows a session summary', async ({ page }) => {
    await startGame(page);

    for (let round = 1; round <= 5; round++) {
      await expect(page.getByText(new RegExp(`round ${round}`, 'i'))).toBeVisible();
      await placeGuess(page);
      await page.getByRole('button', { name: /lock in guess/i }).click();
      const advance = page.getByRole('button', {
        name: round === 5 ? /see your results/i : /next artifact/i,
      });
      await expect(advance).toBeVisible();
      await advance.click();
    }

    // Summary: a rank, a total, and one row per round.
    await expect(page.getByText(/round by round/i)).toBeVisible();
    const rows = page.locator('ol li a');
    await expect(rows).toHaveCount(5);
    await expect(page.getByRole('button', { name: /play again/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /share result/i })).toBeVisible();
  });

  test('a pin can be repositioned before submitting', async ({ page }) => {
    await startGame(page);

    await placeGuess(page, -80, -40);
    const marker = page.locator('.marker-guess');
    await expect(marker).toHaveCount(1);
    const first = await marker.boundingBox();

    // Tapping elsewhere moves the existing pin rather than adding a second.
    await placeGuess(page, 90, 50);
    await expect(marker).toHaveCount(1);
    const second = await marker.boundingBox();
    expect(second!.x).not.toBeCloseTo(first!.x, 0);
  });

  test('the pin can be cleared', async ({ page }) => {
    await startGame(page);
    await placeGuess(page);
    await expect(page.locator('.marker-guess')).toHaveCount(1);

    await page.getByRole('button', { name: /clear pin/i }).click();
    await expect(page.locator('.marker-guess')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /tap the map to place a pin/i })).toBeDisabled();
  });

  test('dragging the map does not place an accidental guess', async ({ page }) => {
    await startGame(page);
    const map = page.getByRole('application');
    const box = (await map.boundingBox())!;

    // A deliberate pan, well beyond the tap-slop threshold.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2 + 60, { steps: 12 });
    await page.mouse.up();

    await expect(page.locator('.marker-guess')).toHaveCount(0);
  });

  test('the score is reported within the round maximum', async ({ page }) => {
    await startGame(page);
    await placeGuess(page);
    await page.getByRole('button', { name: /lock in guess/i }).click();

    const meter = page.getByRole('meter', { name: /round score/i });
    await expect(meter).toHaveAttribute('aria-valuemax', '5000');
    await expect(meter).toHaveAttribute('aria-valuemin', '0');
    const value = Number(await meter.getAttribute('aria-valuenow'));
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(5000);
  });

  test('the reveal names the artifact and links to its source record', async ({ page }) => {
    await startGame(page);
    await placeGuess(page);
    await page.getByRole('button', { name: /lock in guess/i }).click();

    const titles = TEST_ARTIFACTS.map((artifact) => artifact.title);
    const heading = await page.getByRole('heading', { level: 3 }).first().textContent();
    expect(titles).toContain(heading?.trim());
    // The title appears only now: before the guess it would name the answer.

    const link = page.getByRole('link', { name: /view the original record/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noreferrer/);
  });

  test('the daily challenge is identical on a repeat visit', async ({ page }) => {
    await gotoMenu(page);
    await page.getByRole('button', { name: /today's challenge/i }).click();
    const first = await currentArtifactId(page);

    await page.reload();
    await gotoMenu(page);
    await page.getByRole('button', { name: /today's challenge/i }).click();
    expect(await currentArtifactId(page)).toBe(first);
  });

  test('difficulty controls how much is revealed before guessing', async ({ page }) => {
    await gotoMenu(page);

    await page.getByRole('radio', { name: /expert/i }).click();
    await page.getByRole('button', { name: /play 5 rounds/i }).click();
    await expect(page.getByRole('application')).toBeVisible();
    // Expert shows the object type only.
    await expect(page.getByText('Object', { exact: true })).toBeVisible();
    await expect(page.getByText('Culture', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Made of', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: /return to the menu/i }).click();
    await page.getByRole('radio', { name: /explorer/i }).click();
    await page.getByRole('button', { name: /play 5 rounds/i }).click();
    await expect(page.getByRole('application')).toBeVisible();
    // Explorer adds culture, era, date and material.
    await expect(page.getByText('Culture', { exact: true })).toBeVisible();
    await expect(page.getByText('Made of', { exact: true })).toBeVisible();
  });

  test('the artifact is not named before the guess is locked in', async ({ page }) => {
    // The photograph's alternative text must not identify the object either: a
    // screen-reader user would otherwise be handed the answer outright.
    await startGame(page);
    const image = page.getByRole('img').first();
    await expect(image).toHaveAttribute('alt', /artifact for this round/i);
    for (const { title } of TEST_ARTIFACTS) {
      await expect(page.getByText(title, { exact: false })).toHaveCount(0);
    }

    await placeGuess(page);
    await page.getByRole('button', { name: /lock in guess/i }).click();
    await expect(page.getByRole('heading', { level: 3 })).toBeVisible();
  });
});

test.describe('error handling', () => {
  test('shows a retry path when the collection cannot be loaded', async ({ page }) => {
    await page.route('**/data/artifacts.json', (route) => route.fulfill({ status: 503, body: '' }));
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /something went wrong/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();
  });

  test('a broken artifact photograph never becomes a playable round', async ({ page }) => {
    await page.route(/images\.test/, (route) => route.abort());
    await gotoMenu(page);
    await page.getByRole('button', { name: /play 5 rounds/i }).click();

    /*
     * This used to start the round anyway and tell the player they could still guess,
     * which is nonsense: the photograph is the only thing there is to guess from. With
     * every photograph unreachable there is no session to build, so the game says so
     * and offers a way out. Replacement from a healthy pool is covered in
     * broken-images.spec.ts.
     */
    await expect(
      page.getByText(/couldn't find enough artifacts with available photographs/i),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: /back to the menu|try again/i })).toBeVisible();
    await expect(page.getByRole('application')).toHaveCount(0);
  });

  test('still works when map tiles fail to load', async ({ page }) => {
    await page.route(/tile\.openstreetmap\.org/, (route) => route.abort());
    await startGame(page);
    await placeGuess(page);
    await page.getByRole('button', { name: /lock in guess/i }).click();
    await expect(page.getByRole('meter', { name: /round score/i })).toBeVisible();
  });
});

import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared setup for every end-to-end test.
 *
 * Three things are stubbed so the suite is fast, deterministic and does not touch
 * third-party services:
 *
 * 1. **Map tiles** are served as a 1×1 PNG. Loading real tiles would put test
 *    traffic on a donation-funded service, and their latency dominates runtime.
 * 2. **Artifact photographs** are served as a local placeholder for the same
 *    reasons.
 * 3. **The artifact bundle** is replaced with a fixed five-artifact set, so
 *    assertions about titles, distances and scores are stable regardless of what
 *    the last ingest produced.
 */

/** 1×1 transparent PNG. Fine for map tiles, which are only ever decoration here. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * A stand-in artifact photograph with real dimensions.
 *
 * Deliberately not the 1×1 pixel: the app rejects images too small to be played on,
 * so a placeholder that size would make every artifact ineligible and every test
 * fail at the menu — which is exactly what it did.
 */
const PHOTOGRAPH = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">' +
    '<rect width="900" height="1200" fill="#b08a4a"/></svg>',
);

export interface TestArtifact {
  title: string;
  lat: number;
  lon: number;
}

/** Five artifacts, far apart, spanning regions and eras so selection accepts them. */
export const TEST_ARTIFACTS: TestArtifact[] = [
  { title: 'Sphinx of Hatshepsut', lat: 25.7381, lon: 32.6064 },
  { title: 'Lamassu of Nimrud', lat: 36.0983, lon: 43.3283 },
  { title: 'Panathenaic Amphora', lat: 37.9715, lon: 23.7267 },
  { title: 'Moche Stirrup Vessel', lat: -8.1583, lon: -78.9964 },
  { title: 'Benin Bronze Plaque', lat: 6.335, lon: 5.6222 },
];

export function bundle(extra = 0) {
  const cultures = ['Ancient Egyptian', 'Assyrian', 'Ancient Greek', 'Moche', 'Edo'];
  const years = [-1450, -860, -520, 400, 1550];
  const cultureAt = (i: number) => cultures[i % cultures.length]!;
  const yearAt = (i: number) => years[i % years.length]! + i * 3;

  return {
    version: 1,
    generatedAt: '2026-08-09T00:00:00.000Z',
    sources: [
      {
        provider: 'met',
        name: 'The Metropolitan Museum of Art',
        url: 'https://www.metmuseum.org/',
        metadataLicense: 'CC0 1.0',
        imageLicense: 'Public domain',
        attribution: 'The Metropolitan Museum of Art',
        count: 5,
      },
    ],
    artifacts: [
      ...TEST_ARTIFACTS,
      /*
       * Filler artifacts, spread far apart so the diversity constraints accept them.
       * Tests that break several photographs need somewhere to replace them from.
       */
      ...Array.from({ length: extra }, (_, i) => ({
        title: `Filler artifact ${i + 1}`,
        lat: -60 + ((i * 17) % 120),
        lon: -170 + ((i * 43) % 340),
      })),
    ].map((artifact, index) => ({
      id: `met:${index + 1}`,
      provider: 'met',
      providerObjectId: String(index + 1),
      title: artifact.title,
      description: `A test description for ${artifact.title}.`,
      culture: cultureAt(index),
      period: 'Test period',
      yearStart: yearAt(index),
      yearEnd: yearAt(index),
      dateDisplay: `ca. ${Math.abs(yearAt(index))} ${yearAt(index) < 0 ? 'BCE' : 'CE'}`,
      material: 'Stone',
      objectType: 'Sculpture',
      origin: {
        lat: artifact.lat,
        lon: artifact.lon,
        label: `${artifact.title} findspot`,
        country: 'Testland',
        tier: 'findspot',
        kind: 'findspot',
        confidence: 0.98,
        // Zero tolerance keeps the expected scores exact.
        uncertaintyKm: 0,
        resolvedBy: 'curated',
        resolvedId: null,
      },
      discovery: 'Excavated during testing',
      heldBy: 'The Test Museum',
      image: {
        url: `https://images.test/${index + 1}.jpg`,
        // No alternates: a broken primary must cost the artifact, so the tests
        // exercise replacement rather than silent fallback.
        alternates: [],
        verifiedAt: '2026-08-10T00:00:00.000Z',
        thumbUrl: `https://images.test/${index + 1}-thumb.jpg`,
        width: 1200,
        height: 900,
        license: 'CC0 1.0',
        attribution: 'The Test Museum',
      },
      metadataLicense: 'CC0 1.0',
      sourceUrl: `https://example.test/object/${index + 1}`,
      accessionNumber: `TEST.${index + 1}`,
      tags: ['Test'],
      quality: 0.9,
      // Above the Explorer floor so every difficulty can use them.
      fame: 0.9,
      lastSyncedAt: '2026-08-09T00:00:00.000Z',
    })),
  };
}

export async function stubNetwork(page: Page): Promise<void> {
  await page.route('**/data/artifacts.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(bundle()),
    }),
  );

  await page.route(/tile\.openstreetmap\.org|basemaps\.cartocdn\.com|tiles\./, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  );

  await page.route(
    /images\.test|metmuseum\.org|wikimedia\.org|clevelandart\.org|artic\.edu/,
    (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PHOTOGRAPH }),
  );

  // Analytics is irrelevant to behaviour and adds a flaky external request.
  await page.route(/vercel-insights|vitals\.vercel/, (route) => route.abort());
}

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    await stubNetwork(page);
    await use(page);
  },
});

/**
 * Serves a larger collection, for tests that deliberately break several
 * photographs and need somewhere to replace them from.
 */
export async function useLargeBundle(page: Page, extra = 30): Promise<void> {
  await page.route('**/data/artifacts.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(bundle(extra)),
    }),
  );
}

/**
 * The id of the artifact in the current round.
 *
 * The round screen exposes it as a data attribute because the artifact's title is
 * deliberately hidden until the reveal — there is no user-visible text that
 * identifies a live round, and there should not be.
 */
export async function currentArtifactId(page: Page): Promise<string | null> {
  return page.locator('[data-artifact-id]').first().getAttribute('data-artifact-id');
}

/** Waits for the landing screen to be interactive. */
export async function gotoMenu(page: Page): Promise<void> {
  await page.goto('/', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: /play 5 rounds/i })).toBeEnabled({
    timeout: 60_000,
  });
}

/**
 * Starts a classic game and waits for the map to be ready.
 *
 * The generous timeout is for the dev-server target: the round screen is a lazy
 * chunk, so the first time it is requested Vite transforms it — along with Leaflet
 * and framer-motion — on demand. Against the production bundle this resolves in
 * milliseconds.
 */
export async function startGame(page: Page): Promise<void> {
  await gotoMenu(page);
  await page.getByRole('button', { name: /play 5 rounds/i }).click();
  await expect(page.getByRole('application')).toBeVisible({ timeout: 60_000 });
  // Leaflet initialises in an effect once the chunk has arrived.
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 60_000 });
}

/**
 * Places a guess by clicking the centre of the map.
 *
 * Uses a real mouse down/up pair at one position so it exercises the app's own
 * tap-vs-drag discrimination rather than bypassing it.
 */
export async function placeGuess(page: Page, offsetX = 0, offsetY = 0): Promise<void> {
  const map = page.getByRole('application');
  const box = await map.boundingBox();
  if (!box) throw new Error('Map has no bounding box');
  const x = box.x + box.width / 2 + offsetX;
  const y = box.y + box.height / 2 + offsetY;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

export { expect };

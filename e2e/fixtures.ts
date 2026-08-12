import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared setup for every end-to-end test.
 *
 * Three things are stubbed so the suite is fast, deterministic and does not touch
 * third-party services:
 *
 * 1. **The basemap** is replaced with a small fixed set of countries. The real
 *    one is a 750 KB Natural Earth extract; a handful of squares exercises the
 *    same rendering and label code in a fraction of the time.
 * 2. **Artifact photographs** are served as a local placeholder for the same
 *    reasons.
 * 3. **The artifact bundle** is replaced with a fixed five-artifact set, so
 *    assertions about titles, distances and scores are stable regardless of what
 *    the last ingest produced.
 */

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

export function bundle(extra = 0, withHeartlands = true) {
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
      /*
       * Every artifact carries a cultural homeland ~900 km from where the object
       * itself was found. That is the case the reveal has to keep separate: the
       * score is measured to the homeland, the findspot is shown as context.
       * `useBundleWithoutHeartlands` serves the same collection with none, for the
       * "homeland unknown" path.
       */
      heartland: withHeartlands
        ? {
            lat: artifact.lat + 6,
            lon: artifact.lon + 6,
            label: `${cultureAt(index)} homeland`,
            country: 'Testland',
            radiusKm: 380,
            culture: cultureAt(index),
            confidence: 0.42,
            resolvedId: `culture:test-${index}`,
          }
        : null,
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

/**
 * A stand-in atlas: a grid of named boxes covering the globe.
 *
 * Deliberately not a slice of the real file — tests assert on these names, so a
 * regenerated basemap can never quietly break them. It has to cover the whole
 * world rather than a few boxes, because the reveal zooms to wherever the
 * artifact came from and "no labels here" would otherwise look like the map
 * having died.
 */
export const TEST_BASEMAP = {
  version: 1,
  attribution: 'Natural Earth',
  countries: worldGrid(),
  lakes: [ring(10, 10, 3)],
  capitals: [{ name: 'Testville', at: [33, 26], minZoom: 3 }],
};

function worldGrid() {
  const lats = [-60, -20, 20, 60];
  const lons = [-165, -135, -105, -75, -45, -15, 15, 45, 75, 105, 135, 165];
  const countries = [];
  for (const lat of lats) {
    for (const lon of lons) {
      // One recognisable name the specs can assert on, over the region the test
      // artifacts come from; the rest are unique but unremarkable.
      const named = lat === 20 && lon === 45;
      countries.push(
        box(
          named ? 'Testland' : `Country ${lat >= 0 ? 'N' : 'S'}${Math.abs(lat)}E${lon}`,
          lat,
          lon,
        ),
      );
    }
  }
  return countries;
}

function ring(lat: number, lon: number, size: number): Array<[number, number]> {
  return [
    [lon - size, lat - size],
    [lon + size, lat - size],
    [lon + size, lat + size],
    [lon - size, lat + size],
    [lon - size, lat - size],
  ];
}

function box(name: string, lat: number, lon: number) {
  return {
    name,
    shapes: [ring(lat, lon, 15)],
    label: [lon, lat],
    minZoom: 1,
    maxZoom: 12,
    rank: 2,
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

  await page.route('**/data/basemap.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(TEST_BASEMAP),
    }),
  );

  /*
   * Any request to a tile server is a bug now, not a slow test: the map is drawn
   * from the bundled basemap and must never silently fall back to a POI-heavy
   * raster provider. Aborting makes that fail loudly.
   */
  await page.route(
    /tile\.openstreetmap\.org|basemaps\.cartocdn\.com|tiles\.|\.pbf|arcgisonline|maps\.wikimedia/,
    (route) => route.abort(),
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
 * Serves the same collection with no cultural homelands.
 *
 * Heartland then falls back to grading against each object's own place, which is
 * what happens for the majority of the real collection.
 */
export async function useBundleWithoutHeartlands(page: Page): Promise<void> {
  await page.route('**/data/artifacts.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(bundle(0, false)),
    }),
  );
}

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

  /*
   * The round screen's stylesheet is part of the same lazy chunk, and arrives as
   * a separate <link>. Leaflet's container can therefore exist, and be visible,
   * for a frame or two before map.css applies — during which the zoom control is
   * an unstyled 18px anchor. Any measurement taken then is meaningless, so wait
   * for the styling to land rather than for the element.
   */
  await expect
    .poll(
      () =>
        page
          .locator('.leaflet-control-zoom-in')
          .evaluate((node) => node.getBoundingClientRect().height),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(24);
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

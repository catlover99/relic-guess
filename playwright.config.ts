import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end, responsive, accessibility and map-lifecycle tests.
 *
 * External requests (map tiles, museum image CDNs) are stubbed in the test fixtures
 * rather than here, so the suite neither depends on nor sends traffic to third-party
 * services.
 */
/*
 * The suite can target either build of the app.
 *
 *   npm run test:e2e        production bundle via `vite preview`
 *   npm run test:e2e:dev    dev server, with Vite's transform pipeline and React's
 *                           development build (including StrictMode double-invoke)
 *
 * Both matter: the Leaflet-container regression was only observable in a real
 * browser, and the dev build exercises effect double-invocation that production
 * does not. Playwright owns the server's lifecycle in both cases, so no process is
 * left behind. `PW_BASE_URL` overrides everything for a server started elsewhere.
 */
const TARGET = process.env.PW_TARGET === 'dev' ? 'dev' : 'preview';
const PORT = TARGET === 'dev' ? 5174 : 4173;
const EXTERNAL_BASE_URL = process.env.PW_BASE_URL;
const BASE_URL = EXTERNAL_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /*
   * The dev target runs single-threaded: Vite transforms modules on demand, so four
   * workers hitting a cold server all block on the same compile and every one of
   * them times out. Serial keeps the first page load the only slow one.
   */
  workers: TARGET === 'dev' ? 1 : process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: TARGET === 'dev' ? 120_000 : 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // The viewport list is the one the responsive suite is required to cover.
    {
      name: 'mobile-360',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'mobile-390',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'mobile-430',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 430, height: 932 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'mobile-landscape',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 844, height: 390 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'tablet-768',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    {
      name: 'laptop-1366',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
    },
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'desktop-1920',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],

  // Skipped when PW_BASE_URL targets a server the caller is already running.
  webServer: EXTERNAL_BASE_URL
    ? undefined
    : {
        command:
          TARGET === 'dev'
            ? `npx vite --port ${PORT} --strictPort`
            : `npx vite preview --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        // A cold dev start on a mounted filesystem includes dependency
        // optimisation and the first Tailwind pass, which is slow.
        timeout: 240_000,
      },
});

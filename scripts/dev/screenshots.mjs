/**
 * Captures the whole game flow at every required viewport, in both themes, for
 * visual review.
 *
 *   npx vite build && npx vite preview --port 4173 &
 *   node scripts/dev/screenshots.mjs [outputDir]
 *
 * Basemap tiles and artifact photographs are stubbed with local placeholders: this
 * is a layout check, and it must not send traffic to a donation-funded tile service
 * or depend on museum CDN latency.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Opaque stand-in basemap tile. A transparent stub makes headless Chromium
// composite the tile layer as solid red, which looks like a bug but is not one.
const TILE = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e9e5da"/><path d="M0 128h256M128 0v256" stroke="#d3cfc1" stroke-width="1.5"/><path d="M40 200 Q120 150 230 190" stroke="#b9cddc" stroke-width="10" fill="none"/></svg>',
);
// A real-looking artifact photo so the image well can be judged: 3:4 portrait.
function jpegish(w,h,color){
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#d8cfbe"/><ellipse cx="${w/2}" cy="${h*0.55}" rx="${w*0.28}" ry="${h*0.32}" fill="${color}"/><rect x="${w*0.42}" y="${h*0.12}" width="${w*0.16}" height="${h*0.3}" fill="${color}"/></svg>`;
  return Buffer.from(svg);
}

const VIEWPORTS = [
  ['360x800', 360, 800], ['390x844', 390, 844], ['430x932', 430, 932],
  ['844x390-landscape', 844, 390],
  ['768x1024', 768, 1024], ['1366x768', 1366, 768],
  ['1440x900', 1440, 900], ['1920x1080', 1920, 1080],
];

const OUT = process.argv[2] ?? '.cache/shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
for (const [name, width, height] of VIEWPORTS) {
  for (const theme of ['light','dark']) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme, hasTouch: width < 900, isMobile: width < 500 });
    await page.route(/tile\.openstreetmap\.org/, r => r.fulfill({ status:200, contentType:'image/svg+xml', body: TILE }));
    await page.route(/images\.metmuseum\.org|upload\.wikimedia\.org|openaccess-cdn|artic\.edu\/iiif/, r =>
      r.fulfill({ status:200, contentType:'image/svg+xml', body: jpegish(900, 1200, '#8a6a3c') }));
    await page.route(/vercel/, r => r.abort());

    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
    await page.getByRole('button', { name: /play 5 rounds/i }).waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}-${theme}-1-menu.png` });

    await page.getByRole('button', { name: /play 5 rounds/i }).click();
    await page.getByRole('application').waitFor();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${name}-${theme}-2-round.png` });

    // Place a guess and reveal.
    const box = await page.getByRole('application').boundingBox();
    await page.mouse.move(box.x + box.width*0.42, box.y + box.height*0.45);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}-${theme}-3-pinned.png` });

    await page.getByRole('button', { name: /lock in guess/i }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${name}-${theme}-4-reveal.png` });

    // Play the remaining rounds, varying the tap position so the existing pin
    // never sits under the next click.
    for (let round = 2; round <= 5; round++) {
      const next = page.getByRole('button', { name: /next artifact|see your results/i });
      if (await next.count() === 0) break;
      await next.click();
      await page.waitForTimeout(400);
      const b = await page.getByRole('application').boundingBox().catch(() => null);
      if (!b) break;
      // Stay inside the middle band: the bottom-right corner holds the zoom
      // controls, which correctly refuse to place a pin.
      const fx = 0.3 + 0.09 * (round % 4);
      const fy = 0.28 + 0.08 * (round % 3);
      await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(250);
      const submit = page.getByRole('button', { name: /lock in guess/i });
      if (await submit.count()) {
        await submit.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(700);
      }
    }
    const finish = page.getByRole('button', { name: /see your results/i });
    if (await finish.count()) { await finish.click().catch(() => {}); }
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${name}-${theme}-5-summary.png`, fullPage: true });
    await page.close();
  }
  console.log('captured', name);
}
await browser.close();

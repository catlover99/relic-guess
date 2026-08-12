/**
 * Build-time artifact ingestion.
 *
 *   npm run ingest              # all providers, default limits
 *   npm run ingest -- --provider=met --limit=300
 *   npm run ingest -- --dry     # report only, do not write the bundle
 *
 * Output: public/data/artifacts.json — a static asset. The game makes no
 * third-party requests at play time, which is what makes rounds instant and
 * immune to museum API outages.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Artifact, ArtifactBundle, ProviderId } from '../src/data/schema.js';
import { Gazetteer } from './lib/gazetteer.js';
import type { ProviderAdapter } from './lib/provider.js';
import { dedupe } from './lib/dedupe.js';
import { rejectArtifact } from './lib/quality.js';
import { verifyArtifactImages } from './lib/verifyImages.js';
import { attachHeartlands } from './lib/heartland.js';
import { TIER_PROFILE } from './lib/geoTiers.js';
import { metProvider } from './providers/met.js';
import { aicProvider } from './providers/aic.js';
import { cmaProvider } from './providers/cma.js';
import { wikidataProvider } from './providers/wikidata.js';
import { regionOf } from '../src/game/regions.js';
import { eraOf } from '../src/game/eras.js';

const ADAPTERS: ProviderAdapter[] = [wikidataProvider, metProvider, cmaProvider, aicProvider];

/** Default candidate budget per provider, before filtering and dedupe. */
const DEFAULT_LIMITS: Record<ProviderId, number> = {
  wikidata: 2000,
  met: 4200,
  cma: 2400,
  aic: 1200,
};

const OUTPUT = path.resolve(process.cwd(), 'public/data/artifacts.json');

interface Args {
  providers: ProviderId[];
  limit: number | null;
  dry: boolean;
  seed: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    providers: ADAPTERS.map((a) => a.id),
    limit: null,
    dry: false,
    seed: 20260809,
  };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'provider' && value) args.providers = value.split(',') as ProviderId[];
    else if (key === 'limit' && value) args.limit = Number(value);
    else if (key === 'seed' && value) args.seed = Number(value);
    else if (key === 'dry') args.dry = true;
  }
  return args;
}

function tally<T>(items: readonly T[], key: (item: T) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item) ?? 'unknown';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return new Map([...counts].sort((a, b) => b[1] - a[1]));
}

function printTally(title: string, counts: Map<string, number>, limit = 12): void {
  console.log(`\n${title}`);
  let shown = 0;
  for (const [key, count] of counts) {
    if (shown++ >= limit) {
      console.log(`  … and ${counts.size - limit} more`);
      break;
    }
    console.log(`  ${String(count).padStart(5)}  ${key}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date().toISOString();

  console.log('Loading gazetteer…');
  const gazetteer = new Gazetteer();
  await gazetteer.load();

  const harvested: Artifact[] = [];
  const perProvider = new Map<ProviderId, number>();

  for (const adapter of ADAPTERS) {
    if (!args.providers.includes(adapter.id)) continue;
    const limit = args.limit ?? DEFAULT_LIMITS[adapter.id];
    if (limit <= 0) continue;

    console.log(`\n▸ ${adapter.name} (limit ${limit})`);
    const started = Date.now();
    try {
      const results = await adapter.harvest({
        gazetteer,
        limit,
        now,
        seed: args.seed,
        log: (message) => console.log(message),
      });
      harvested.push(...results);
      perProvider.set(adapter.id, results.length);
      console.log(
        `  ${adapter.id}: ${results.length} normalized in ${((Date.now() - started) / 1000).toFixed(0)}s`,
      );
    } catch (error) {
      // One dead provider must not lose the other three.
      console.error(`  ${adapter.id}: FAILED — ${(error as Error).message}`);
      perProvider.set(adapter.id, 0);
    }
    await gazetteer.persist();
  }

  await gazetteer.persist();

  console.log(`\nHarvested ${harvested.length} candidate records.`);

  /* ---- Filter ---------------------------------------------------- */
  const rejections = new Map<string, number>();
  let passed: Artifact[] = [];
  for (const artifact of harvested) {
    const reason = rejectArtifact(artifact);
    if (reason) {
      rejections.set(reason.id, (rejections.get(reason.id) ?? 0) + 1);
      continue;
    }
    passed.push(artifact);
  }
  printTally(
    'Rejected records by reason:',
    new Map([...rejections].sort((a, b) => b[1] - a[1])),
    20,
  );
  console.log(`\n${passed.length} records passed quality filtering.`);

  /* ---- Cultural homelands ---------------------------------------- */
  /*
   * Runs for every artifact, including the ones that already have a precise
   * findspot. That is the point: the reveal has to be able to show where an
   * object was dug up *and* the region its culture occupied, which the old
   * culture-as-last-resort behaviour made impossible.
   */
  const heartlands = attachHeartlands(passed);
  passed = heartlands.artifacts;
  console.log(
    `\nCultural homelands: ${heartlands.stats.attached} attached` +
      ` (${heartlands.stats.distinct} meaningfully apart from the object's own place)` +
      `, ${heartlands.stats.unmatched} cultures not in the table` +
      `, ${heartlands.stats.noCulture} without a culture` +
      `, ${heartlands.stats.implausible} rejected as implausibly far.`,
  );

  /* ---- Verify photographs ---------------------------------------- */
  /*
   * Runs before dedupe so a dead image cannot win a duplicate contest against a live
   * one. Results are cached on disk per URL, so only genuinely new images cost a
   * request — a re-run of an unchanged bundle verifies nothing.
   */
  const imageCheck = await verifyArtifactImages(passed, { log: (m) => console.log(m) });
  const confirmed = imageCheck.artifacts.length - imageCheck.unverified.length;
  console.log(
    `\nPhotographs: ${confirmed} confirmed` +
      ` (${imageCheck.checked} checked now, ${imageCheck.fromCache} from cache)` +
      `, ${imageCheck.dropped.length} dropped, ${imageCheck.unverified.length} kept unverified` +
      `, ${imageCheck.promoted} using a fallback rendition.`,
  );
  if (imageCheck.dropped.length > 0) {
    printTally(
      'Photograph failures by reason:',
      tally(imageCheck.dropped, (d) => d.reason),
      8,
    );
  }
  if (imageCheck.unverified.length > 0) {
    // Not failures: the server never gave a usable answer, so the browser decides.
    printTally(
      'Photographs left unverified by reason:',
      tally(imageCheck.unverified, (u) => u.reason),
      8,
    );
  }

  /* ---- Deduplicate ----------------------------------------------- */
  const { kept, removed } = dedupe(imageCheck.artifacts);
  printTally(
    'Duplicates removed by rule:',
    tally(removed, (r) => r.rule),
    10,
  );
  console.log(`\n${kept.length} unique artifacts.`);

  /* ---- Report ---------------------------------------------------- */
  printTally(
    'By provider:',
    tally(kept, (a) => a.provider),
  );
  printTally(
    'By coordinate tier:',
    tally(kept, (a) => a.origin.tier),
  );
  printTally(
    'By origin kind:',
    tally(kept, (a) => a.origin.kind),
  );
  printTally(
    'By region:',
    tally(kept, (a) => regionOf(a)),
  );
  printTally(
    'By era:',
    tally(kept, (a) => eraOf(a)),
  );
  printTally(
    'Top countries:',
    tally(kept, (a) => a.origin.country),
    15,
  );

  const withDescription = kept.filter((a) => a.description).length;
  const famous = kept.filter((a) => a.fame >= 0.45).length;
  console.log(
    `\nEducational text: ${withDescription}/${kept.length} (${Math.round((withDescription / Math.max(1, kept.length)) * 100)}%)` +
      `\nExplorer-tier (fame ≥ 0.45): ${famous}` +
      `\nMean coordinate confidence: ${(kept.reduce((sum, a) => sum + a.origin.confidence, 0) / Math.max(1, kept.length)).toFixed(3)}` +
      `\nMean uncertainty: ${Math.round(kept.reduce((sum, a) => sum + a.origin.uncertaintyKm, 0) / Math.max(1, kept.length))} km` +
      ` (tier baselines: ${Object.entries(TIER_PROFILE)
        .map(([tier, p]) => `${tier} ${p.uncertaintyKm}`)
        .join(', ')})`,
  );

  if (args.dry) {
    console.log('\n--dry: bundle not written.');
    return;
  }

  /* ---- Write ----------------------------------------------------- */
  // Sorting by quality keeps the JSON diff-stable between runs and puts the
  // best records first, which helps when eyeballing the file.
  kept.sort((a, b) => b.quality - a.quality || a.id.localeCompare(b.id));

  const bundle: ArtifactBundle = {
    version: 1,
    generatedAt: now,
    sources: ADAPTERS.filter((adapter) => (perProvider.get(adapter.id) ?? 0) > 0).map(
      (adapter) => ({
        provider: adapter.id,
        name: adapter.name,
        url: adapter.url,
        metadataLicense: adapter.metadataLicense,
        imageLicense: adapter.imageLicense,
        attribution: adapter.attribution,
        count: kept.filter((a) => a.provider === adapter.id).length,
      }),
    ),
    artifacts: kept,
  };

  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(bundle));
  const sizeKb = Math.round(Buffer.byteLength(JSON.stringify(bundle)) / 1024);
  console.log(`\nWrote ${OUTPUT} (${kept.length} artifacts, ${sizeKb} KB).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Artifact } from '../../src/data/schema.js';
import { mapLimit, USER_AGENT } from './http.js';

/**
 * Build-time image verification.
 *
 * Catches the images that are *already* dead when the bundle is generated, so those
 * artifacts never ship. It cannot catch images that die afterwards — third-party CDNs
 * expire URLs and change hotlink policy — which is why the browser verifies again at
 * runtime. The two layers answer different questions:
 *
 *   - **URL present**: the provider gave us a string. Says nothing at all.
 *   - **Verified at ingest** (`image.verifiedAt`): it loaded from this machine when
 *     the bundle was built. Good enough to seed the daily challenge from.
 *   - **Verified this session**: it loaded in the player's browser, on their network.
 *     Only this makes a round playable.
 *
 * Results are cached on disk and keyed by URL, so a re-run costs nothing for images
 * already checked. Without that, verifying several thousand images would roughly
 * double an already slow ingest.
 */

const CACHE_PATH = path.resolve(process.cwd(), '.cache/image-verify.json');

/** Long enough for a slow museum CDN, short enough not to stall the run. */
const TIMEOUT_MS = 15_000;

/** Re-check a previously good URL after this long; failures are retried sooner. */
const GOOD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BAD_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The verdict on one URL.
 *
 * `inconclusive` is the important one. A 429, a 5xx or a timeout says something about
 * the server's mood, not about the photograph, and treating those as failures is how
 * a first run dropped 1,026 perfectly good Met artifacts in one go. Inconclusive
 * results are retried, never cached, and never cause a drop.
 */
type Verdict = 'ok' | 'bad' | 'inconclusive';

interface CacheEntry {
  ok: boolean;
  checkedAt: string;
  status?: number;
  contentType?: string | null;
  reason?: string;
}

interface CheckResult extends CacheEntry {
  verdict: Verdict;
  /** What the server asked us to wait, when it said so. */
  retryAfterMs?: number;
}

/**
 * Minimum gap between requests to the same host.
 *
 * Museum image CDNs are far less tolerant than their metadata APIs, and Wikimedia's
 * `Special:FilePath` endpoint — a redirect service, not a static file — is the
 * strictest of the lot: unpaced it answers `429 Retry-After: 10` almost immediately.
 * Pacing per host rather than globally keeps the fast hosts fast.
 */
const HOST_INTERVAL_MS: Array<[RegExp, number]> = [
  [/wikimedia\.org$|wikipedia\.org$/, 1200],
  [/metmuseum\.org$/, 150],
];
const DEFAULT_HOST_INTERVAL_MS = 100;

/** The tail of the per-host request queue, so requests to one host stay spaced out. */
const hostQueues = new Map<string, Promise<void>>();

function hostIntervalFor(host: string): number {
  for (const [pattern, interval] of HOST_INTERVAL_MS) {
    if (pattern.test(host)) return interval;
  }
  return DEFAULT_HOST_INTERVAL_MS;
}

/** Waits for this host's turn, then reserves the next slot. */
async function takeHostSlot(url: string): Promise<void> {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return;
  }
  const interval = hostIntervalFor(host);
  const previous = hostQueues.get(host) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  hostQueues.set(
    host,
    previous.then(() => next),
  );
  await previous;
  setTimeout(release, interval);
}

/** Statuses that mean "ask again later", not "this image is gone". */
function statusVerdict(status: number): Verdict {
  if (status === 429 || status === 408 || status >= 500) return 'inconclusive';
  // 401/403 are ambiguous, but museum CDNs use them for throttling as often as for
  // real denial, and the runtime layer will catch a genuinely unusable image.
  if (status === 401 || status === 403) return 'inconclusive';
  return 'bad';
}

type Cache = Record<string, CacheEntry>;

async function loadCache(cachePath: string): Promise<Cache> {
  try {
    return JSON.parse(await readFile(cachePath, 'utf8')) as Cache;
  } catch {
    return {};
  }
}

async function saveCache(cachePath: string, cache: Cache): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache));
}

function isFresh(entry: CacheEntry): boolean {
  const age = Date.now() - Date.parse(entry.checkedAt);
  if (Number.isNaN(age)) return false;
  return age < (entry.ok ? GOOD_TTL_MS : BAD_TTL_MS);
}

/**
 * Checks one URL over HTTP.
 *
 * Node has no `<img>`, so this validates what it can from the response itself:
 * status, content type, and the file's magic bytes. Only the first two kilobytes are
 * requested — enough to identify the format without downloading megabytes.
 *
 * `HEAD` is deliberately not used alone: several museum CDNs answer HEAD with 403 or
 * 405 while serving GET perfectly.
 */
export async function verifyImageUrl(url: string): Promise<CheckResult> {
  await takeHostSlot(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(url, {
      headers: {
        // Range keeps this cheap; a server that ignores it just sends more.
        Range: 'bytes=0-2047',
        Accept: 'image/*,*/*;q=0.8',
        // The same contactable agent the harvest uses. Wikimedia's policy requires
        // one, and answers anonymous clients with 429 almost immediately.
        'User-Agent': USER_AGENT,
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type');
    if (!response.ok && response.status !== 206) {
      const retryAfter = Number(response.headers.get('retry-after'));
      return {
        verdict: statusVerdict(response.status),
        ok: false,
        checkedAt,
        status: response.status,
        contentType,
        reason: `http-${response.status}`,
        // Capped: a server asking for an hour is telling us to give up for this run.
        retryAfterMs:
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter, 30) * 1000
            : undefined,
      };
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const signature = imageSignature(bytes);
    if (!signature) {
      /*
       * A 200 carrying an HTML error page is the classic hotlink failure — but a
       * server that ignores `Range` and streams a huge original can also hand back a
       * first chunk we truncate mid-header, so an empty body is treated as
       * inconclusive rather than as a dead image.
       */
      const empty = bytes.length === 0;
      return {
        verdict: empty ? 'inconclusive' : 'bad',
        ok: false,
        checkedAt,
        status: response.status,
        contentType,
        reason: empty
          ? 'empty-body'
          : contentType?.includes('text')
            ? 'html-not-image'
            : 'unrecognised-bytes',
      };
    }

    return {
      verdict: 'ok',
      ok: true,
      checkedAt,
      status: response.status,
      contentType,
      reason: signature,
    };
  } catch (error) {
    // A timeout or a dropped connection says nothing about the photograph.
    return {
      verdict: 'inconclusive',
      ok: false,
      checkedAt,
      reason: (error as Error).name === 'AbortError' ? 'timeout' : 'network',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifies a URL, retrying while the answer stays inconclusive.
 *
 * Backoff is generous because the signal being waited out is rate limiting: the
 * first run of this stage hit `429` on a thousand Met images by asking too fast.
 */
async function verifyWithRetry(url: string, attempts = 3, delayMs = 1500): Promise<CheckResult> {
  let result = await verifyImageUrl(url);
  for (let attempt = 1; attempt < attempts && result.verdict === 'inconclusive'; attempt++) {
    if (delayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** (attempt - 1)));
    result = await verifyImageUrl(url);
  }
  return result;
}

/** Identifies an image format from its leading bytes, or null if it is not one. */
function imageSignature(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  const [b0, b1, b2, b3] = bytes;
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'jpeg';
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'png';
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return 'gif';
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) return 'webp';
  if (b0 === 0x49 && b1 === 0x49 && b2 === 0x2a) return 'tiff';
  if (b0 === 0x4d && b1 === 0x4d && b2 === 0x00) return 'tiff';
  // SVG and other XML-based images arrive as text; treat as not usable here.
  return null;
}

export interface VerifyImagesResult {
  artifacts: Artifact[];
  checked: number;
  fromCache: number;
  dropped: Array<{ id: string; url: string; reason: string }>;
  /** Kept, but with no confirmed rendition — the server never gave a clear answer. */
  unverified: Array<{ id: string; url: string; reason: string }>;
  promoted: number;
}

/**
 * Verifies every artifact's photograph, dropping those known to have none that works.
 *
 * An artifact survives if *any* of its renditions loads; the working one is promoted
 * to `image.url` so the player gets it first, and `image.verifiedAt` is stamped only
 * on the rendition actually confirmed.
 *
 * An artifact whose renditions came back **inconclusive** — throttled, timed out,
 * connection dropped — is kept with `verifiedAt` left null. Dropping it would mean
 * letting a rate limiter decide the contents of the dataset, and the browser verifies
 * again before anything becomes a round, so an unverified record costs at most one
 * skipped candidate at play time.
 */
export async function verifyArtifactImages(
  artifacts: readonly Artifact[],
  options: {
    concurrency?: number;
    log?: (message: string) => void;
    /** Overridable so tests never touch the real ingest cache. */
    cachePath?: string;
    /** Base backoff between retries. Tests set it to 0; the ingest should not. */
    retryDelayMs?: number;
  } = {},
): Promise<VerifyImagesResult> {
  /*
   * Politeness is enforced per host (see HOST_INTERVAL_MS) rather than by keeping the
   * worker count low, so a slow host stalls only the worker waiting on it. Verifying
   * the whole bundle at concurrency 8 with no pacing produced a thousand 429s.
   */
  const { concurrency = 6, log = () => {}, cachePath = CACHE_PATH, retryDelayMs } = options;
  const cache = await loadCache(cachePath);

  let checked = 0;
  let fromCache = 0;
  let promoted = 0;
  const dropped: VerifyImagesResult['dropped'] = [];
  const unverified: VerifyImagesResult['unverified'] = [];

  const check = async (url: string): Promise<CheckResult> => {
    const cached = cache[url];
    if (cached && isFresh(cached)) {
      fromCache++;
      return { ...cached, verdict: cached.ok ? 'ok' : 'bad' };
    }
    const result = await verifyWithRetry(url, 3, retryDelayMs);
    // Inconclusive results are never cached: caching "the server was busy" would
    // turn one bad afternoon into three days of missing artifacts.
    if (result.verdict !== 'inconclusive') {
      cache[url] = {
        ok: result.ok,
        checkedAt: result.checkedAt,
        status: result.status,
        contentType: result.contentType,
        reason: result.reason,
      };
    }
    checked++;
    return result;
  };

  const verified = await mapLimit(
    artifacts as Artifact[],
    concurrency,
    async (artifact) => {
      const candidates = [artifact.image.url, ...artifact.image.alternates];
      let lastReason = 'no-candidates';
      let anyInconclusive = false;

      for (const [index, url] of candidates.entries()) {
        const entry = await check(url);
        if (entry.verdict !== 'ok') {
          anyInconclusive ||= entry.verdict === 'inconclusive';
          lastReason = entry.reason ?? 'unknown';
          continue;
        }
        if (index > 0) promoted++;
        return {
          ...artifact,
          image: {
            ...artifact.image,
            // The confirmed rendition becomes the primary one.
            url,
            alternates: candidates.filter((candidate) => candidate !== url),
            verifiedAt: entry.checkedAt,
          },
        } satisfies Artifact;
      }

      if (anyInconclusive) {
        unverified.push({ id: artifact.id, url: artifact.image.url, reason: lastReason });
        return artifact;
      }

      dropped.push({ id: artifact.id, url: artifact.image.url, reason: lastReason });
      return null;
    },
    (done, total) => {
      if (done % 500 === 0 || done === total) log(`  images: ${done}/${total}`);
    },
  );

  await saveCache(cachePath, cache);
  return { artifacts: verified, checked, fromCache, dropped, unverified, promoted };
}

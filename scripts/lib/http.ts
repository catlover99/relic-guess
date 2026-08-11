import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CACHE_DIR = path.resolve(process.cwd(), '.cache/http');

export interface FetchOptions {
  /** Extra headers. A descriptive User-Agent is added automatically. */
  headers?: Record<string, string>;
  /** Skip the on-disk cache for this request. */
  noCache?: boolean;
  /** Retries on 5xx / network failure. */
  retries?: number;
  timeoutMs?: number;
}

/**
 * Providers ask for a contactable User-Agent (Wikimedia's policy requires one
 * and will 403 the default Node agent). Override via INGEST_CONTACT.
 */
const CONTACT = process.env.INGEST_CONTACT ?? 'https://github.com/relicguess (ingest script)';
export const USER_AGENT = `relicguess-ingest/1.0 (+${CONTACT})`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function cachePath(url: string, headers?: Record<string, string>): string {
  const key = createHash('sha256')
    .update(url + JSON.stringify(headers ?? {}))
    .digest('hex');
  // Shard so a few hundred thousand entries stay navigable.
  return path.join(CACHE_DIR, key.slice(0, 2), `${key}.json`);
}

/**
 * Fetches JSON with retry, timeout and a persistent on-disk cache.
 *
 * The cache is what makes iterating on the pipeline practical: a full ingest
 * makes tens of thousands of requests, and re-running it to tweak normalisation
 * must not re-hammer the museums' APIs.
 */
export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { headers, noCache = false, retries = 3, timeoutMs = 30_000 } = options;
  const file = cachePath(url, headers);

  if (!noCache) {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch {
      // Cache miss — fall through to the network.
    }
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
        signal: controller.signal,
      });

      /*
       * 403 is retryable here, which is unusual but necessary: the Met's WAF
       * answers throttled clients with 403 rather than 429, and it blocks for
       * minutes at a time. Treating it as permanent silently loses most of a
       * harvest — a run that should have produced ~1,000 records produced 44,
       * with 430 of 601 requests "failing" against an API that was perfectly
       * healthy a minute later.
       */
      if (response.status === 429 || response.status === 503 || response.status === 403) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000);
        lastError = new Error(`${response.status} ${response.statusText} for ${url}`);
        continue;
      }
      if (!response.ok) {
        // Any other 4xx is a genuine client error and will not fix itself.
        throw Object.assign(new Error(`HTTP ${response.status} for ${url}`), {
          status: response.status,
        });
      }

      const data = (await response.json()) as T;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(data));
      return data;
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 429 && status !== 403) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}

/**
 * Runs `worker` over `items` with bounded concurrency, tolerating individual
 * failures. One dead object id must not abort a 5,000-object harvest.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R | null>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  let done = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        const value = await worker(items[index]!, index);
        if (value !== null) results.push(value);
      } catch {
        // Skipped: logged by the caller's summary counts.
      }
      done++;
      if (onProgress && done % 25 === 0) onProgress(done, items.length);
    }
  });

  await Promise.all(runners);
  onProgress?.(items.length, items.length);
  return results;
}

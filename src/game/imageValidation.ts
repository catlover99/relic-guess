import type { Artifact } from '@/data/schema';

/**
 * Central authority on whether an artifact's photograph can actually be shown.
 *
 * A usable photograph is the whole game: an artifact whose image will not load is
 * not a playable round, it is a broken one. Every check therefore happens *before*
 * the artifact reaches the player, and this module is the only place that decides.
 *
 * **Why an `<img>` element and not `fetch`.** These images are hotlinked from museum
 * CDNs that mostly do not send CORS headers. `fetch()` would fail on images a plain
 * `<img>` renders perfectly, so a fetch-based check would reject good artifacts —
 * the opposite of the bug it is meant to prevent. Loading through an actual `<img>`
 * tests exactly what the browser will do, and `decode()` additionally catches
 * responses that arrive with a 200 but are not decodable images (an HTML error page
 * served as `image/jpeg`, a truncated file).
 */

/** How long a single image may take before it is treated as unavailable. */
export const IMAGE_TIMEOUT_MS = 8000;

/**
 * Minimum edge length for a gameplay photograph. A thumbnail is a legitimate
 * fallback for the results grid but not for the round itself — the player is asked
 * to read material and decoration off it.
 */
export const MIN_GAMEPLAY_EDGE_PX = 320;

type Verdict = 'good' | 'bad';

/**
 * Session-scoped memory of what loaded and what did not.
 *
 * Keyed by URL rather than artifact, because providers reuse renditions and because
 * a URL that failed once in this session will almost certainly fail again. Kept in
 * memory only: a URL that is down now may be back tomorrow, so nothing is persisted.
 */
const verdicts = new Map<string, Verdict>();

/** De-duplicates concurrent checks of the same URL. */
const inFlight = new Map<string, Promise<boolean>>();

export interface ImageProbe {
  url: string;
  ok: boolean;
  /** Natural dimensions, when the browser reported them. */
  width: number | null;
  height: number | null;
  reason: 'loaded' | 'error' | 'timeout' | 'too-small' | 'decode-failed';
}

/**
 * Loads a URL through an `<img>` and reports whether it is usable.
 *
 * Resolves rather than rejects: an unavailable image is an expected condition, not
 * an exception.
 */
export async function probeImage(
  url: string,
  { timeoutMs = IMAGE_TIMEOUT_MS, minEdge = 0 } = {},
): Promise<ImageProbe> {
  if (typeof Image === 'undefined') {
    // Non-browser environment (SSR, some test runners): cannot verify, do not block.
    return { url, ok: true, width: null, height: null, reason: 'loaded' };
  }

  return new Promise<ImageProbe>((resolve) => {
    const image = new Image();
    let settled = false;

    const finish = (probe: ImageProbe) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      // Abandon an in-flight request so a slow host cannot hold a connection open.
      if (!probe.ok) image.src = '';
      resolve(probe);
    };

    const timer = window.setTimeout(
      () => finish({ url, ok: false, width: null, height: null, reason: 'timeout' }),
      timeoutMs,
    );

    image.onerror = () => finish({ url, ok: false, width: null, height: null, reason: 'error' });

    image.onload = () => {
      const width = image.naturalWidth || null;
      const height = image.naturalHeight || null;
      // A 1×1 tracking pixel or a placeholder is technically a valid image and
      // useless as a round.
      if (minEdge > 0 && (!width || !height || Math.max(width, height) < minEdge)) {
        finish({ url, ok: false, width, height, reason: 'too-small' });
        return;
      }
      // `decode()` surfaces corrupt or non-image payloads that `onload` accepted.
      const decoded = typeof image.decode === 'function' ? image.decode() : Promise.resolve();
      decoded.then(
        () => finish({ url, ok: true, width, height, reason: 'loaded' }),
        () => finish({ url, ok: false, width, height, reason: 'decode-failed' }),
      );
    };

    // No `crossOrigin`: setting it would opt into CORS and break the many museum
    // CDNs that serve images without the header.
    image.decoding = 'async';
    image.src = url;
  });
}

/** Verifies one URL, memoised for the session. */
export async function verifyImageUrl(url: string, minEdge = 0): Promise<boolean> {
  const cached = verdicts.get(url);
  if (cached) return cached === 'good';

  const existing = inFlight.get(url);
  if (existing) return existing;

  const promise = probeImage(url, { minEdge })
    .then((probe) => {
      verdicts.set(url, probe.ok ? 'good' : 'bad');
      if (!probe.ok && import.meta.env.DEV) {
        // Development only: enough to identify the provider and rendition at fault,
        // without spamming a production console.
        console.warn(`[image] rejected (${probe.reason}) ${url}`);
      }
      return probe.ok;
    })
    .finally(() => {
      inFlight.delete(url);
    });

  inFlight.set(url, promise);
  return promise;
}

/**
 * Ordered list of renditions to try for an artifact, best first.
 *
 * The thumbnail is deliberately excluded: it is fine for the summary grid but too
 * small to guess from. Provider-specific fallbacks live in the data model
 * (`image.alternates`, populated at ingest), never in the UI.
 */
export function imageCandidates(artifact: Artifact): string[] {
  const candidates = [artifact.image.url, ...(artifact.image.alternates ?? [])];
  return [...new Set(candidates.filter((url): url is string => Boolean(url)))];
}

/**
 * Finds the first rendition of an artifact that actually loads.
 *
 * Returns the usable URL, or null when every candidate failed — in which case the
 * artifact is not playable and the caller must replace it.
 */
export async function resolveArtifactImage(artifact: Artifact): Promise<string | null> {
  for (const url of imageCandidates(artifact)) {
    if (await verifyImageUrl(url, MIN_GAMEPLAY_EDGE_PX)) return url;
  }
  return null;
}

/**
 * Records that a URL failed in the wild.
 *
 * Called when an `<img>` already on screen errors — the round was presented on the
 * strength of a successful probe, but CDNs expire and networks drop.
 */
export function markImageUnavailable(url: string): void {
  verdicts.set(url, 'bad');
  if (import.meta.env.DEV) console.warn(`[image] failed after presentation: ${url}`);
}

/** Whether a URL is already known bad, without triggering a check. */
export function isKnownBad(url: string): boolean {
  return verdicts.get(url) === 'bad';
}

/** Test seam: forget everything learned this session. */
export function resetImageVerdicts(): void {
  verdicts.clear();
  inFlight.clear();
}

/** Diagnostics for the dev console and tests. */
export function imageVerdictStats(): { good: number; bad: number } {
  let good = 0;
  let bad = 0;
  for (const verdict of verdicts.values()) {
    if (verdict === 'good') good++;
    else bad++;
  }
  return { good, bad };
}

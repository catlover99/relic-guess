import type { Artifact } from '@/data/schema';
import { rngFromSeed, shuffle } from './random';
import { orderCandidates, pickDiverseRounds, type SelectionOptions } from './selection';

/**
 * Builds a playable session: artifacts whose photographs are confirmed loadable.
 *
 * The invariant this exists to guarantee is that **if an artifact is presented as a
 * round, its photograph has already loaded at least once**. That has to happen
 * before selection rather than after, and the daily challenge makes the ordering
 * requirement strict.
 *
 * ## Why validation must precede selection
 *
 * The obvious implementation — select five, discover one is broken, substitute — is
 * wrong for the daily challenge: two players hitting different CDN failures would get
 * different puzzles for the same date. So the flow is:
 *
 *   1. filter the pool to eligible artifacts (deterministic)
 *   2. order them by the date-seeded shuffle (deterministic)
 *   3. walk that fixed order, verifying photographs
 *   4. keep the verified ones **in step 2's order**, never in completion order
 *   5. run the diversity selection over the verified list
 *
 * Step 4 is the subtle one. Collecting results as they arrive would make the puzzle
 * depend on which CDN answered first, so verification is concurrent but results are
 * written back into a fixed-size slot array and read in index order.
 */

export interface SessionBuildOptions extends Omit<SelectionOptions, 'rng'> {
  pool: readonly Artifact[];
  /** Seed for the deterministic ordering. The daily uses the date. */
  seed: string;
  /**
   * Verifies one artifact's photograph, returning the usable URL or null.
   * Injected so tests can drive it without a browser.
   */
  verify: (artifact: Artifact) => Promise<string | null>;
  /**
   * How many artifacts may be verified before giving up. Bounds the network cost of
   * a pool where many images are dead.
   */
  maxVerifications?: number;
  /** How many photographs to verify at a time. Does not affect the outcome. */
  concurrency?: number;
  signal?: AbortSignal;
}

export interface SessionBuildResult {
  rounds: Artifact[];
  /** The verified URL for each chosen artifact, by artifact id. */
  imageUrls: Record<string, string>;
  /** Artifacts whose every rendition failed; excluded from future attempts. */
  rejected: string[];
  /** True when the pool ran out before a full session could be assembled. */
  exhausted: boolean;
  verifiedCount: number;
  /**
   * How many artifacts matched the filters before any photograph was checked.
   *
   * Lets the caller tell "these filters match nothing" apart from "these filters match
   * plenty, but their photographs are dead" — two different problems that deserve
   * two different messages.
   */
  eligibleCount: number;
}

const DEFAULT_MAX_VERIFICATIONS = 90;
const DEFAULT_CONCURRENCY = 6;

/**
 * How many candidates are verified between selection attempts.
 *
 * Deliberately a constant, **not** the concurrency. When the two were the same, a
 * client verifying 12 at a time saw a larger verified pool at its first selection
 * attempt than one verifying 3 at a time, and picked different artifacts — the daily
 * challenge would then have depended on a tuning parameter. Concurrency now controls
 * only how fast a chunk is processed, never where the chunk boundaries fall.
 */
const VERIFICATION_CHUNK = 12;

/**
 * Verifies a slice of candidates concurrently, preserving input order.
 *
 * The returned array is index-aligned with `candidates`; completion order is
 * discarded. This is what keeps the daily challenge stable.
 */
async function verifySlice(
  candidates: readonly Artifact[],
  verify: SessionBuildOptions['verify'],
  concurrency: number,
  signal?: AbortSignal,
): Promise<Array<string | null>> {
  const results = new Array<string | null>(candidates.length).fill(null);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= candidates.length) return;
      if (signal?.aborted) return;
      try {
        results[index] = await verify(candidates[index]!);
      } catch {
        results[index] = null;
      }
    }
  });

  await Promise.all(workers);
  return results;
}

export async function buildSession(options: SessionBuildOptions): Promise<SessionBuildResult> {
  const {
    pool,
    seed,
    verify,
    rounds: roundCount,
    maxVerifications = DEFAULT_MAX_VERIFICATIONS,
    concurrency = DEFAULT_CONCURRENCY,
    signal,
    ...selection
  } = options;

  const rng = rngFromSeed(seed);
  // Steps 1 and 2: a fixed candidate order that depends only on the seed.
  const ordered = orderCandidates(pool, { ...selection, rounds: roundCount, rng });

  const imageUrls: Record<string, string> = {};
  const rejected: string[] = [];
  const verified: Artifact[] = [];
  let verifiedCount = 0;
  let cursor = 0;

  /*
   * Verify in chunks, attempting the diversity selection after each one. Chunking
   * bounds bandwidth — a five-round game normally verifies a couple of chunks, not
   * the whole pool — while the fixed traversal order keeps the outcome deterministic.
   */
  while (cursor < ordered.length && verifiedCount < maxVerifications) {
    if (signal?.aborted) break;

    const slice = ordered.slice(cursor, cursor + VERIFICATION_CHUNK);
    cursor += slice.length;
    verifiedCount += slice.length;

    // Parallelism never exceeds the chunk, so it cannot pull work forward across a
    // boundary and change what the next selection attempt sees.
    const urls = await verifySlice(
      slice,
      verify,
      Math.min(concurrency, VERIFICATION_CHUNK),
      signal,
    );
    // Read back in index order, never completion order.
    slice.forEach((artifact, index) => {
      const url = urls[index];
      if (url) {
        imageUrls[artifact.id] = url;
        verified.push(artifact);
      } else {
        rejected.push(artifact.id);
      }
    });

    const picked = pickDiverseRounds(verified, roundCount);
    if (picked.length === roundCount) {
      return {
        rounds: picked,
        imageUrls: Object.fromEntries(picked.map((a) => [a.id, imageUrls[a.id]!])),
        rejected,
        exhausted: false,
        verifiedCount,
        eligibleCount: ordered.length,
      };
    }
  }

  // Ran out of candidates or budget. Return the best full-or-partial set we have so
  // the caller can decide whether a short session is acceptable (it is not).
  const picked = pickDiverseRounds(verified, roundCount);
  return {
    rounds: picked,
    imageUrls: Object.fromEntries(picked.map((a) => [a.id, imageUrls[a.id]!])),
    rejected,
    exhausted: picked.length < roundCount,
    verifiedCount,
    eligibleCount: ordered.length,
  };
}

/**
 * Finds one replacement artifact, for when a photograph dies mid-round.
 *
 * Deliberately separate from `buildSession`: this is the non-deterministic path, used
 * only when an already-verified image fails in the wild. The daily challenge reaches
 * it just as rarely, and when it does, a playable round matters more than matching
 * everyone else's puzzle.
 */
export async function findReplacement(options: {
  pool: readonly Artifact[];
  exclude: readonly string[];
  seed: string;
  verify: SessionBuildOptions['verify'];
  difficulty: SelectionOptions['difficulty'];
  region?: SelectionOptions['region'];
  era?: SelectionOptions['era'];
  maxVerifications?: number;
  signal?: AbortSignal;
}): Promise<{ artifact: Artifact; imageUrl: string } | null> {
  const {
    pool,
    exclude,
    seed,
    verify,
    difficulty,
    region,
    era,
    maxVerifications = 24,
    signal,
  } = options;

  const excluded = new Set(exclude);
  const rng = rngFromSeed(seed);
  const candidates = shuffle(
    orderCandidates(pool, { rounds: 1, difficulty, region, era, rng }).filter(
      (artifact) => !excluded.has(artifact.id),
    ),
    rng,
  );

  for (let index = 0; index < Math.min(candidates.length, maxVerifications); index++) {
    if (signal?.aborted) return null;
    const artifact = candidates[index]!;
    const url = await verify(artifact);
    if (url) return { artifact, imageUrl: url };
  }
  return null;
}

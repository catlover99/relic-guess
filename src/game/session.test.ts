import { describe, expect, it, vi } from 'vitest';
import { buildSession, findReplacement } from './session';
import { makePool } from '@/test/factories';
import type { Artifact } from '@/data/schema';

/**
 * A verifier driven by a set of deliberately broken URLs.
 *
 * `delays` lets a test make verification complete out of order, which is the failure
 * mode the daily challenge must be immune to.
 */
function makeVerifier(
  options: {
    broken?: Set<string>;
    delays?: Map<string, number>;
    onVerify?: (artifact: Artifact) => void;
  } = {},
) {
  const { broken = new Set(), delays = new Map(), onVerify } = options;
  const calls: string[] = [];

  const verify = async (artifact: Artifact): Promise<string | null> => {
    calls.push(artifact.id);
    onVerify?.(artifact);
    const delay = delays.get(artifact.id) ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    for (const url of [artifact.image.url, ...artifact.image.alternates]) {
      if (!broken.has(url)) return url;
    }
    return null;
  };

  return { verify, calls };
}

const baseOptions = {
  rounds: 5,
  difficulty: 'expert' as const,
};

describe('buildSession — broken photographs never become rounds', () => {
  it('excludes artifacts whose image fails and still returns a full session', async () => {
    const pool = makePool(60);
    // Break the first twenty artifacts outright.
    const broken = new Set(pool.slice(0, 20).map((a) => a.image.url));
    const { verify } = makeVerifier({ broken });

    const result = await buildSession({ ...baseOptions, pool, seed: 'a', verify });

    expect(result.rounds).toHaveLength(5);
    expect(result.exhausted).toBe(false);
    for (const round of result.rounds) {
      expect(broken.has(round.image.url), `${round.id} has a broken image`).toBe(false);
      expect(result.imageUrls[round.id]).toBeTruthy();
    }
  });

  it('reports every rejected artifact so it is not offered again', async () => {
    const pool = makePool(60);
    const broken = new Set(pool.slice(0, 10).map((a) => a.image.url));
    const { verify } = makeVerifier({ broken });

    const result = await buildSession({ ...baseOptions, pool, seed: 'b', verify });
    const rejectedIds = new Set(result.rejected);

    expect(result.rejected.length).toBeGreaterThan(0);
    // Nothing rejected may appear in the session.
    for (const round of result.rounds) expect(rejectedIds.has(round.id)).toBe(false);
  });

  it('falls back to an alternate rendition rather than discarding the artifact', async () => {
    const pool = makePool(30).map((artifact) => ({
      ...artifact,
      image: {
        ...artifact.image,
        alternates: [`${artifact.image.url}?fallback`],
      },
    }));
    // Every primary rendition is dead; every fallback works.
    const broken = new Set(pool.map((a) => a.image.url));
    const { verify } = makeVerifier({ broken });

    const result = await buildSession({ ...baseOptions, pool, seed: 'c', verify });

    expect(result.rounds).toHaveLength(5);
    for (const round of result.rounds) {
      expect(result.imageUrls[round.id]).toMatch(/\?fallback$/);
    }
  });

  it('verifies only a bounded number of images, not the whole pool', async () => {
    const pool = makePool(400);
    const { verify, calls } = makeVerifier();

    await buildSession({ ...baseOptions, pool, seed: 'd', verify });

    // A five-round session must not pull hundreds of photographs.
    expect(calls.length).toBeLessThanOrEqual(24);
  });

  it('reports exhaustion instead of looping when every image is broken', async () => {
    const pool = makePool(40);
    const broken = new Set(pool.flatMap((a) => [a.image.url, ...a.image.alternates]));
    const { verify, calls } = makeVerifier({ broken });

    const result = await buildSession({ ...baseOptions, pool, seed: 'e', verify });

    expect(result.rounds).toHaveLength(0);
    expect(result.exhausted).toBe(true);
    // Bounded: it gave up rather than retrying for ever.
    expect(calls.length).toBeLessThanOrEqual(90);
  });

  it('never verifies the same artifact twice in one build', async () => {
    const pool = makePool(60);
    const { verify, calls } = makeVerifier();
    await buildSession({ ...baseOptions, pool, seed: 'f', verify });
    expect(new Set(calls).size).toBe(calls.length);
  });
});

describe('buildSession — daily challenge determinism', () => {
  const dailySeed = 'daily:2026-08-10';

  it('produces identical artifact ids for two independent runs', async () => {
    const pool = makePool(80);
    const broken = new Set(pool.filter((_, i) => i % 3 === 0).map((a) => a.image.url));

    const first = await buildSession({
      ...baseOptions,
      pool,
      seed: dailySeed,
      verify: makeVerifier({ broken }).verify,
    });
    const second = await buildSession({
      ...baseOptions,
      pool,
      seed: dailySeed,
      verify: makeVerifier({ broken }).verify,
    });

    expect(first.rounds.map((a) => a.id)).toEqual(second.rounds.map((a) => a.id));
    expect(first.rounds).toHaveLength(5);
  });

  it('is unaffected by the order in which verification completes', async () => {
    const pool = makePool(80);
    const broken = new Set(pool.filter((_, i) => i % 4 === 0).map((a) => a.image.url));

    // Run one build with uniform timing, and another where completion order is
    // deliberately scrambled — later candidates resolve first.
    const fast = await buildSession({
      ...baseOptions,
      pool,
      seed: dailySeed,
      verify: makeVerifier({ broken }).verify,
    });

    const delays = new Map(pool.map((artifact, index) => [artifact.id, (pool.length - index) % 7]));
    const scrambled = await buildSession({
      ...baseOptions,
      pool,
      seed: dailySeed,
      verify: makeVerifier({ broken, delays }).verify,
    });

    expect(scrambled.rounds.map((a) => a.id)).toEqual(fast.rounds.map((a) => a.id));
  });

  it('is unaffected by the verification concurrency', async () => {
    const pool = makePool(80);
    const broken = new Set(pool.filter((_, i) => i % 5 === 0).map((a) => a.image.url));

    const results = await Promise.all(
      [1, 3, 6, 12].map((concurrency) =>
        buildSession({
          ...baseOptions,
          pool,
          seed: dailySeed,
          concurrency,
          verify: makeVerifier({ broken }).verify,
        }),
      ),
    );

    const ids = results.map((result) => result.rounds.map((a) => a.id).join(','));
    expect(new Set(ids).size, `concurrency changed the daily: ${ids.join(' | ')}`).toBe(1);
  });

  it('contains only verified-good photographs', async () => {
    const pool = makePool(80);
    const broken = new Set(pool.filter((_, i) => i % 2 === 0).map((a) => a.image.url));
    const verified: string[] = [];

    const result = await buildSession({
      ...baseOptions,
      pool,
      seed: dailySeed,
      verify: makeVerifier({ broken, onVerify: (a) => verified.push(a.id) }).verify,
    });

    expect(result.rounds).toHaveLength(5);
    for (const round of result.rounds) {
      // Every chosen artifact went through verification…
      expect(verified).toContain(round.id);
      // …and the URL handed to the UI is not one of the broken ones.
      expect(broken.has(result.imageUrls[round.id]!)).toBe(false);
    }
  });

  it('differs between dates', async () => {
    const pool = makePool(80);
    const monday = await buildSession({
      ...baseOptions,
      pool,
      seed: 'daily:2026-08-10',
      verify: makeVerifier().verify,
    });
    const tuesday = await buildSession({
      ...baseOptions,
      pool,
      seed: 'daily:2026-08-11',
      verify: makeVerifier().verify,
    });
    expect(monday.rounds.map((a) => a.id)).not.toEqual(tuesday.rounds.map((a) => a.id));
  });
});

describe('findReplacement', () => {
  it('finds a working artifact excluding the ones already used', async () => {
    const pool = makePool(40);
    const exclude = pool.slice(0, 10).map((a) => a.id);
    const { verify } = makeVerifier();

    const replacement = await findReplacement({
      pool,
      exclude,
      seed: 'r1',
      difficulty: 'expert',
      verify,
    });

    expect(replacement).not.toBeNull();
    expect(exclude).not.toContain(replacement!.artifact.id);
    expect(replacement!.imageUrl).toBeTruthy();
  });

  it('returns null rather than looping when nothing is usable', async () => {
    const pool = makePool(20);
    const broken = new Set(pool.flatMap((a) => [a.image.url, ...a.image.alternates]));
    const { verify, calls } = makeVerifier({ broken });

    const replacement = await findReplacement({
      pool,
      exclude: [],
      seed: 'r2',
      difficulty: 'expert',
      verify,
    });

    expect(replacement).toBeNull();
    expect(calls.length).toBeLessThanOrEqual(24);
  });

  it('respects an abort signal', async () => {
    const pool = makePool(40);
    const controller = new AbortController();
    controller.abort();
    const { verify, calls } = makeVerifier();

    const replacement = await findReplacement({
      pool,
      exclude: [],
      seed: 'r3',
      difficulty: 'expert',
      verify,
      signal: controller.signal,
    });

    expect(replacement).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('buildSession — diversity is preserved under verification', () => {
  it('still spreads rounds geographically', async () => {
    const pool = makePool(80);
    const { verify } = makeVerifier();
    const result = await buildSession({ ...baseOptions, pool, seed: 'g', verify });

    const labels = result.rounds.map((round) => round.origin.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('honours the difficulty filter', async () => {
    const pool = makePool(60).map((artifact, index) => ({
      ...artifact,
      fame: index < 20 ? 0.9 : 0.05,
    }));
    const { verify } = makeVerifier();

    const result = await buildSession({
      pool,
      rounds: 5,
      difficulty: 'heartland',
      seed: 'h',
      verify,
    });

    for (const round of result.rounds) expect(round.fame).toBeGreaterThanOrEqual(0.45);
  });
});

describe('buildSession — abort', () => {
  it('stops verifying once aborted', async () => {
    const pool = makePool(200);
    const controller = new AbortController();
    const { verify, calls } = makeVerifier({
      onVerify: () => {
        if (calls.length >= 6) controller.abort();
      },
    });

    const result = await buildSession({
      ...baseOptions,
      pool,
      seed: 'i',
      verify,
      signal: controller.signal,
    });

    expect(calls.length).toBeLessThan(30);
    expect(result.rounds.length).toBeLessThanOrEqual(5);
  });
});

describe('verification is not called with a stale pool', () => {
  it('passes the artifact object itself to the verifier', async () => {
    const pool = makePool(20);
    const seen: Artifact[] = [];
    const verify = vi.fn(async (artifact: Artifact) => {
      seen.push(artifact);
      return artifact.image.url;
    });

    await buildSession({ ...baseOptions, pool, seed: 'j', verify });

    for (const artifact of seen) {
      expect(pool.some((candidate) => candidate.id === artifact.id)).toBe(true);
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  countEligible,
  difficulty,
  isClueVisible,
  selectRounds,
  toleranceFor,
  type DifficultyId,
} from './selection';
import { distanceKm } from './geo';
import { regionOf } from './regions';
import { rngFromSeed } from './random';
import { makeArtifact, makePool } from '@/test/factories';

describe('selectRounds', () => {
  it('returns the requested number of rounds', () => {
    const rounds = selectRounds(makePool(60), {
      rounds: 5,
      difficulty: 'expert',
      rng: rngFromSeed('a'),
    });
    expect(rounds).toHaveLength(5);
  });

  it('never repeats an artifact within a session', () => {
    const rounds = selectRounds(makePool(60), {
      rounds: 5,
      difficulty: 'expert',
      rng: rngFromSeed('b'),
    });
    expect(new Set(rounds.map((r) => r.id)).size).toBe(rounds.length);
  });

  it('is deterministic for a given seed', () => {
    const pool = makePool(60);
    const first = selectRounds(pool, {
      rounds: 5,
      difficulty: 'expert',
      rng: rngFromSeed('daily:2026-08-09'),
    });
    const second = selectRounds(pool, {
      rounds: 5,
      difficulty: 'expert',
      rng: rngFromSeed('daily:2026-08-09'),
    });
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
  });

  it('produces different sessions for different seeds', () => {
    const pool = makePool(60);
    const a = selectRounds(pool, { rounds: 5, difficulty: 'expert', rng: rngFromSeed('one') });
    const b = selectRounds(pool, { rounds: 5, difficulty: 'expert', rng: rngFromSeed('two') });
    expect(a.map((r) => r.id)).not.toEqual(b.map((r) => r.id));
  });

  it('spreads rounds geographically', () => {
    // The regression this guards: a pool with ten objects from one site used to
    // serve all ten in a row.
    const rounds = selectRounds(makePool(60), {
      rounds: 5,
      difficulty: 'expert',
      rng: rngFromSeed('geo'),
    });
    for (let i = 0; i < rounds.length; i++) {
      for (let j = i + 1; j < rounds.length; j++) {
        expect(distanceKm(rounds[i]!.origin, rounds[j]!.origin)).toBeGreaterThan(500);
      }
    }
  });

  it('does not let one region dominate', () => {
    const rounds = selectRounds(makePool(60), {
      rounds: 5,
      difficulty: 'expert',
      rng: rngFromSeed('spread'),
    });
    const counts = new Map<string, number>();
    for (const round of rounds) {
      const key = regionOf(round) ?? 'unknown';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
  });

  it('avoids recently seen artifacts when the pool allows', () => {
    const pool = makePool(60);
    const seen = pool.slice(0, 30).map((a) => a.id);
    const rounds = selectRounds(pool, {
      rounds: 5,
      difficulty: 'expert',
      exclude: seen,
      rng: rngFromSeed('seen'),
    });
    expect(rounds.every((round) => !seen.includes(round.id))).toBe(true);
  });

  it('still fills a session when every artifact has been seen', () => {
    // A player who exhausts the pool must not get an empty round list.
    const pool = makePool(20);
    const rounds = selectRounds(pool, {
      rounds: 5,
      difficulty: 'expert',
      exclude: pool.map((a) => a.id),
      rng: rngFromSeed('exhausted'),
    });
    expect(rounds).toHaveLength(5);
  });

  it('relaxes the separation constraint rather than returning a short session', () => {
    // Every artifact sits within a few km of the others, so the first pass
    // cannot possibly fill five rounds.
    const clustered = Array.from({ length: 12 }, (_, index) =>
      makeArtifact({
        id: `met:${index}`,
        providerObjectId: String(index),
        title: `Cluster ${index}`,
        fame: 0.5,
        origin: { lat: 25.7 + index * 0.001, lon: 32.6, label: `Spot ${index}` },
      }),
    );
    const rounds = selectRounds(clustered, {
      rounds: 5,
      difficulty: 'expert',
      rng: rngFromSeed('cluster'),
    });
    expect(rounds).toHaveLength(5);
  });

  it('respects the difficulty fame floor', () => {
    const pool = makePool(60).map((artifact, index) =>
      makeArtifact({ ...artifact, fame: index < 30 ? 0.9 : 0.05 }),
    );
    const rounds = selectRounds(pool, {
      rounds: 5,
      difficulty: 'heartland',
      rng: rngFromSeed('fame'),
    });
    expect(rounds.every((round) => round.fame >= difficulty('heartland').minFame)).toBe(true);
  });

  it('honours a region filter', () => {
    const rounds = selectRounds(makePool(80), {
      rounds: 3,
      difficulty: 'expert',
      region: 'americas',
      rng: rngFromSeed('region'),
    });
    expect(rounds.length).toBeGreaterThan(0);
    expect(rounds.every((round) => regionOf(round) === 'americas')).toBe(true);
  });

  it('returns an empty session when nothing matches the filters', () => {
    const rounds = selectRounds(makePool(20), {
      rounds: 5,
      difficulty: 'expert',
      region: 'oceania',
      rng: rngFromSeed('none'),
    });
    expect(rounds).toHaveLength(0);
  });

  it('handles an empty pool', () => {
    expect(selectRounds([], { rounds: 5, difficulty: 'expert', rng: rngFromSeed('x') })).toEqual(
      [],
    );
  });
});

describe('countEligible', () => {
  it('counts only artifacts matching difficulty and filters', () => {
    const pool = makePool(40);
    expect(countEligible(pool, { difficulty: 'expert' })).toBe(40);
    // The factory pool sits at fame 0.5, above Explorer's 0.45 floor.
    expect(countEligible(pool, { difficulty: 'heartland' })).toBe(40);
    expect(countEligible(pool, { difficulty: 'expert', region: 'oceania' })).toBe(0);
  });

  it('excludes artifacts below the difficulty fame floor', () => {
    const obscure = makePool(20).map((artifact) => makeArtifact({ ...artifact, fame: 0.05 }));
    expect(countEligible(obscure, { difficulty: 'heartland' })).toBe(0);
    expect(countEligible(obscure, { difficulty: 'expert' })).toBe(20);
  });
});

describe('isClueVisible', () => {
  it('reveals date and culture on Explorer', () => {
    expect(isClueVisible('heartland', 'culture')).toBe(true);
    expect(isClueVisible('heartland', 'date')).toBe(true);
  });

  it('hides culture and date on Scholar', () => {
    expect(isClueVisible('scholar', 'culture')).toBe(false);
    expect(isClueVisible('scholar', 'date')).toBe(false);
    expect(isClueVisible('scholar', 'era')).toBe(true);
  });

  it('shows only the object type on Expert', () => {
    expect(isClueVisible('expert', 'objectType')).toBe(true);
    expect(isClueVisible('expert', 'era')).toBe(false);
    expect(isClueVisible('expert', 'material')).toBe(false);
  });
});

describe('difficulty modes', () => {
  it('defaults to Heartland', () => {
    expect(DEFAULT_DIFFICULTY).toBe('heartland');
    // The default must be the first option a player sees, not buried.
    expect(DIFFICULTIES[0]!.id).toBe('heartland');
  });

  it('asks for less precision the easier the mode', () => {
    const tolerances = DIFFICULTIES.map((mode) => mode.toleranceKm);
    for (let i = 1; i < tolerances.length; i++) {
      expect(tolerances[i]!).toBeLessThan(tolerances[i - 1]!);
    }
    expect(toleranceFor('heartland')).toBeGreaterThanOrEqual(300);
    expect(toleranceFor('expert')).toBe(0);
  });

  it('gives Heartland a regional tolerance, not a site-level one', () => {
    // A cultural heartland is hundreds of km across; anything less would still be
    // asking for the dig site.
    expect(toleranceFor('heartland')).toBeGreaterThan(toleranceFor('scholar'));
  });

  it('shows more clues the easier the mode', () => {
    const counts = DIFFICULTIES.map((mode) => mode.clues.length);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!).toBeLessThanOrEqual(counts[i - 1]!);
    }
  });

  it('explains each mode in plain words', () => {
    for (const mode of DIFFICULTIES) {
      expect(mode.aim.length).toBeGreaterThan(10);
      // No jargon in player-facing copy.
      expect(mode.aim.toLowerCase()).not.toContain('confidence');
      expect(mode.aim.toLowerCase()).not.toContain('uncertainty');
      expect(mode.aim.toLowerCase()).not.toContain('coordinate');
      expect(mode.blurb.toLowerCase()).not.toContain('coordinate confidence');
    }
  });

  it('keeps the harder, more precise modes available', () => {
    expect(DIFFICULTIES.map((mode) => mode.id)).toEqual(['heartland', 'scholar', 'expert']);
  });

  it('falls back to the default mode for an unknown id', () => {
    expect(difficulty('nonsense' as DifficultyId).id).toBe(DEFAULT_DIFFICULTY);
  });

  it('keeps a usable pool at the default difficulty', () => {
    // Heartland is the mode most players will ever see, so its fame floor must
    // not starve the selector.
    const pool = makePool(60).map((artifact, index) => ({ ...artifact, fame: index / 60 }));
    expect(countEligible(pool, { difficulty: 'heartland' })).toBeGreaterThanOrEqual(5);
  });
});

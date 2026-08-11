import { describe, expect, it } from 'vitest';
import { MAX_ROUND_SCORE, formatScore, scoreBand, scoreGuess, sessionRank } from './scoring';
import type { OriginPlace } from '@/data/schema';

const origin = (overrides: Partial<OriginPlace> = {}): OriginPlace => ({
  lat: 25.7188,
  lon: 32.6573,
  label: 'Thebes, Egypt',
  country: 'Egypt',
  tier: 'site',
  kind: 'findspot',
  confidence: 0.92,
  uncertaintyKm: 0,
  resolvedBy: 'curated',
  resolvedId: null,
  ...overrides,
});

describe('scoreGuess', () => {
  it('awards the maximum for an exact hit', () => {
    const result = scoreGuess({ lat: 25.7188, lon: 32.6573 }, origin());
    expect(result.score).toBe(MAX_ROUND_SCORE);
    expect(result.distanceKm).toBeCloseTo(0, 6);
    expect(result.band).toBe('bullseye');
  });

  it('never exceeds the maximum or drops below zero', () => {
    const near = scoreGuess({ lat: 25.7188, lon: 32.6573 }, origin());
    const far = scoreGuess({ lat: -40, lon: -170 }, origin());
    expect(near.score).toBeLessThanOrEqual(MAX_ROUND_SCORE);
    expect(far.score).toBeGreaterThanOrEqual(0);
  });

  it('decreases monotonically with distance', () => {
    const target = origin();
    const scores = [0.1, 1, 5, 20, 100, 500, 1500, 4000, 9000].map((offsetDeg) => {
      // Move north by a fixed number of degrees to get increasing distances.
      const lat = Math.min(89, target.lat + offsetDeg / 111);
      return scoreGuess({ lat, lon: target.lon }, target).score;
    });
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]!);
    }
  });

  it('is continuous across the old bucket boundaries', () => {
    // The previous implementation jumped from 1500 to 1000 points between 199 and
    // 201 km. Two guesses 2 km apart must now differ only marginally.
    const target = origin();
    const at199 = scoreGuess({ lat: target.lat + 199 / 111, lon: target.lon }, target).score;
    const at201 = scoreGuess({ lat: target.lat + 201 / 111, lon: target.lon }, target).score;
    expect(Math.abs(at199 - at201)).toBeLessThan(30);
  });

  it('forgives distance up to the origin uncertainty', () => {
    // A cultural-region origin may be 380 km from the real place, so a guess
    // inside that radius is as good as the data allows.
    const coarse = origin({ tier: 'culture-region', uncertaintyKm: 380 });
    const result = scoreGuess({ lat: coarse.lat + 300 / 111, lon: coarse.lon }, coarse);
    expect(result.score).toBe(MAX_ROUND_SCORE);
    expect(result.distanceKm).toBeGreaterThan(250);
    expect(result.toleranceKm).toBe(380);
  });

  it('charges only the distance beyond the tolerance', () => {
    const coarse = origin({ uncertaintyKm: 200 });
    const precise = origin({ uncertaintyKm: 0 });
    const guess = { lat: coarse.lat + 700 / 111, lon: coarse.lon };
    const coarseResult = scoreGuess(guess, coarse);
    const preciseResult = scoreGuess(guess, precise);
    expect(coarseResult.effectiveKm).toBeCloseTo(preciseResult.effectiveKm - 200, 0);
    expect(coarseResult.score).toBeGreaterThan(preciseResult.score);
  });

  it('scores a wrong continent near zero', () => {
    const result = scoreGuess({ lat: -33.9, lon: 151.2 }, origin());
    expect(result.score).toBeLessThan(50);
    expect(result.band).toBe('lost');
  });

  it('returns an integer score', () => {
    const result = scoreGuess({ lat: 30, lon: 30 }, origin());
    expect(Number.isInteger(result.score)).toBe(true);
  });

  it('reports a fraction consistent with the score', () => {
    const result = scoreGuess({ lat: 28, lon: 31 }, origin());
    expect(result.fraction).toBeCloseTo(result.score / MAX_ROUND_SCORE, 6);
  });
});

describe('scoreBand', () => {
  it('assigns a band to every score in range', () => {
    for (const score of [0, 1, 399, 400, 1499, 1500, 2749, 2750, 3999, 4000, 4899, 4900, 5000]) {
      expect(scoreBand(score).id).toBeTruthy();
    }
  });

  it('orders bands by score', () => {
    expect(scoreBand(5000).id).toBe('bullseye');
    expect(scoreBand(4200).id).toBe('excellent');
    expect(scoreBand(3000).id).toBe('strong');
    expect(scoreBand(1600).id).toBe('close');
    expect(scoreBand(500).id).toBe('far');
    expect(scoreBand(0).id).toBe('lost');
  });
});

describe('sessionRank', () => {
  it('gives the top rank for a perfect session', () => {
    expect(sessionRank(5 * MAX_ROUND_SCORE, 5).id).toBe('curator');
  });

  it('gives the bottom rank for a zero session', () => {
    expect(sessionRank(0, 5).id).toBe('tourist');
  });

  it('does not divide by zero on an empty session', () => {
    expect(() => sessionRank(0, 0)).not.toThrow();
    expect(sessionRank(0, 0).fraction).toBe(0);
  });
});

describe('formatScore', () => {
  it('groups thousands', () => {
    expect(formatScore(12500, 'en-US')).toBe('12,500');
  });
});

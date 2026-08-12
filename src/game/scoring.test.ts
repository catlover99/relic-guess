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

  /*
   * The curve itself, pinned.
   *
   * These are the numbers the curve was chosen for — forgiving through the first
   * few hundred kilometres, clearly graded across a continent, near zero on the
   * far side of the world. A change here is a change to how the game feels, so it
   * should fail loudly rather than drift.
   */
  it.each([
    [0, 5000],
    [50, 4975],
    [100, 4936],
    [250, 4782],
    [500, 4462],
    [750, 4107],
    [1000, 3740],
    [1500, 3027],
    [2000, 2386],
    [3000, 1391],
    [5000, 391],
    [10000, 8],
    [15000, 0],
  ])('scores a %i km miss at %i', (km, expected) => {
    const target = origin();
    // Move due north, where a degree of latitude is a constant ~111.19 km.
    const result = scoreGuess({ lat: target.lat + km / 111.19, lon: target.lon }, target);
    expect(result.score).toBeCloseTo(expected, -1);
  });

  it('is more forgiving than the curve it replaced at every distance', () => {
    const target = origin();
    const previous = (km: number) => 5000 * Math.exp(-km / 1500);
    for (const km of [100, 250, 500, 1000, 2000, 3000]) {
      const result = scoreGuess({ lat: target.lat + km / 111.19, lon: target.lon }, target);
      expect(result.score).toBeGreaterThan(previous(km));
    }
  });

  it('still separates an excellent guess from a merely good one', () => {
    const target = origin();
    const at = (km: number) =>
      scoreGuess({ lat: target.lat + km / 111.19, lon: target.lon }, target).score;
    // Being ten times closer has to be worth having.
    expect(at(100) - at(1000)).toBeGreaterThan(1000);
  });
});

describe('scoreGuess — mode tolerance', () => {
  it('forgives the mode radius even when the coordinate is exact', () => {
    // Heartland asks which region an object is from, so a guess 250 km from a
    // precisely recorded findspot is a correct answer to the question asked.
    const precise = origin({ tier: 'findspot', uncertaintyKm: 0 });
    const result = scoreGuess({ lat: precise.lat + 250 / 111.19, lon: precise.lon }, precise, {
      minToleranceKm: 300,
    });
    expect(result.score).toBe(MAX_ROUND_SCORE);
    expect(result.toleranceKm).toBe(300);
  });

  it('says which of the two forgave the distance', () => {
    const precise = origin({ tier: 'findspot', uncertaintyKm: 0 });
    const coarse = origin({ tier: 'culture-region', uncertaintyKm: 380 });
    const guess = { lat: 0, lon: 0 };

    // Heartland over a precisely recorded findspot: the *mode* is being generous,
    // and telling the player the museum's record is vague would be untrue.
    expect(scoreGuess(guess, precise, { minToleranceKm: 300 }).toleranceSource).toBe('mode');
    expect(scoreGuess(guess, coarse, { minToleranceKm: 300 }).toleranceSource).toBe('coordinate');
    expect(scoreGuess(guess, precise).toleranceSource).toBe('none');
  });

  it('takes the larger of the mode floor and the coordinate uncertainty', () => {
    const coarse = origin({ tier: 'culture-region', uncertaintyKm: 380 });
    expect(scoreGuess({ lat: 0, lon: 0 }, coarse, { minToleranceKm: 300 }).toleranceKm).toBe(380);
    expect(scoreGuess({ lat: 0, lon: 0 }, coarse, { minToleranceKm: 500 }).toleranceKm).toBe(500);
  });

  it('leaves Expert scored against the coordinate itself', () => {
    const precise = origin({ uncertaintyKm: 0 });
    const guess = { lat: precise.lat + 250 / 111.19, lon: precise.lon };
    expect(scoreGuess(guess, precise, { minToleranceKm: 0 }).score).toBe(
      scoreGuess(guess, precise).score,
    );
  });

  it('cannot push a score above the maximum', () => {
    const result = scoreGuess({ lat: 25.7188, lon: 32.6573 }, origin(), {
      minToleranceKm: 5000,
    });
    expect(result.score).toBe(MAX_ROUND_SCORE);
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
    expect(scoreBand(4500).id).toBe('excellent');
    expect(scoreBand(3500).id).toBe('strong');
    expect(scoreBand(2000).id).toBe('close');
    expect(scoreBand(500).id).toBe('far');
    expect(scoreBand(0).id).toBe('lost');
  });

  it('bands correspond to the distances they are named for', () => {
    const target = origin();
    const bandAt = (km: number) =>
      scoreGuess({ lat: target.lat + km / 111.19, lon: target.lon }, target).band;
    expect(bandAt(80)).toBe('bullseye');
    expect(bandAt(400)).toBe('excellent');
    expect(bandAt(1100)).toBe('strong');
    expect(bandAt(2400)).toBe('close');
    expect(bandAt(4500)).toBe('far');
    expect(bandAt(9000)).toBe('lost');
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

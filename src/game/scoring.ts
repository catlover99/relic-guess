import type { GeoPoint } from '@/data/schema';
import { distanceKm } from './geo';

/**
 * Anything a guess can be graded against.
 *
 * Structural rather than `OriginPlace`, because what a round is scored against is
 * not always the object's own place: Heartland grades against a cultural homeland
 * with its own radius. `game/geography.ts` decides which; this module only needs a
 * centre and how much it forgives.
 */
export interface ScoreTarget extends GeoPoint {
  /** Radius forgiven because of what the target itself is. */
  uncertaintyKm: number;
}

export const MAX_ROUND_SCORE = 5000;

/**
 * The scoring curve: `5000 · e^(−(d / SCALE)^SHAPE)`.
 *
 * The original curve was a plain exponential, `5000 · e^(−d/1500)`, which players
 * found punishing — and they were right. It charged 28% of the round for a 500 km
 * miss, but 500 km is *inside* several of the cultural regions this game asks
 * about: the Achaemenid heartland alone is wider than that. A curve that steep
 * turns "you correctly identified the culture, and were a little off on where its
 * centre was" into a mediocre score.
 *
 * `SHAPE > 1` fixes the part that mattered. It flattens the curve near zero, so
 * the first few hundred kilometres cost very little, and steepens it in the
 * middle, so a continent-scale error still separates clearly from a regional one.
 * The far tail is unchanged in spirit: a guess on the wrong side of the world
 * scores single digits.
 *
 *      km      old     new
 *       0     5000    5000
 *     250     4232    4782
 *     500     3583    4462
 *    1000     2567    3740
 *    2000     1318    2386
 *    3000      677    1391
 *    5000      178     391
 *   10000        6       8
 *
 * See `scoring.test.ts`, which pins these values so the curve cannot drift.
 */
const SCALE_KM = 2500;
const SHAPE = 1.35;

/** Below this the round is treated as a bullseye, avoiding 4998-style scores. */
const PERFECT_EPSILON_KM = 5;

export interface ScoreBreakdown {
  distanceKm: number;
  /** Distance actually charged after tolerance is forgiven. */
  effectiveKm: number;
  /** Radius forgiven: the origin's own uncertainty, or the mode's floor. */
  toleranceKm: number;
  /**
   * Which of the two set that radius.
   *
   * They mean different things to a player: `coordinate` says the museum's own
   * record is vague, `mode` says the game only ever asked for the region. Telling
   * them apart is the difference between an honest explanation and a wrong one.
   */
  toleranceSource: 'coordinate' | 'mode' | 'none';
  score: number;
  /** 0–1, for progress bars. */
  fraction: number;
  band: ScoreBand;
}

/**
 * Bands, chosen by what distance they correspond to rather than round numbers:
 * bullseye ≈ 100 km, excellent ≈ 500 km, strong ≈ 1,200 km, warm ≈ 2,500 km,
 * cold ≈ 5,000 km.
 */
export const SCORE_BANDS = [
  { id: 'bullseye', label: 'Bullseye', min: 4900 },
  { id: 'excellent', label: 'Excellent', min: 4400 },
  { id: 'strong', label: 'Strong', min: 3400 },
  { id: 'close', label: 'Warm', min: 1800 },
  { id: 'far', label: 'Cold', min: 350 },
  { id: 'lost', label: 'Way off', min: 0 },
] as const;

export type ScoreBand = (typeof SCORE_BANDS)[number]['id'];

export function scoreBand(score: number): (typeof SCORE_BANDS)[number] {
  return SCORE_BANDS.find((b) => score >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1]!;
}

export interface ScoreOptions {
  /**
   * Smallest radius forgiven regardless of how precise the source coordinate is.
   *
   * This is what makes Heartland a different *game* rather than just a different
   * clue list: the question becomes "which region is this from", so being inside
   * the region is a correct answer even when the museum happens to know the exact
   * trench the object came out of.
   */
  minToleranceKm?: number;
}

/**
 * Scores a guess against an artifact's origin.
 *
 * Three properties matter for fairness:
 *
 * 1. **Continuity.** A 199 km miss and a 201 km miss must not differ by a third
 *    of the round score, which is what a bucketed step function does.
 * 2. **Honesty about the source data.** When the best coordinate we have is a
 *    cultural heartland, the true origin may be hundreds of km from it, so the
 *    player is not charged for that portion of the error. `uncertaintyKm` comes
 *    from the coordinate tier — see docs/GEO_CONFIDENCE.md.
 * 3. **Honesty about the question.** The mode's tolerance floor says how precise
 *    an answer was ever being asked for.
 */
export function scoreGuess(
  guess: GeoPoint,
  target: ScoreTarget,
  options: ScoreOptions = {},
): ScoreBreakdown {
  const raw = distanceKm(guess, target);
  const coordinateKm = Math.max(0, target.uncertaintyKm);
  const modeKm = Math.max(0, options.minToleranceKm ?? 0);
  const toleranceKm = Math.max(coordinateKm, modeKm);
  const effectiveKm = Math.max(0, raw - toleranceKm);
  const toleranceSource =
    toleranceKm === 0 ? 'none' : coordinateKm >= modeKm ? 'coordinate' : 'mode';

  const score =
    effectiveKm <= PERFECT_EPSILON_KM
      ? MAX_ROUND_SCORE
      : Math.round(MAX_ROUND_SCORE * Math.exp(-((effectiveKm / SCALE_KM) ** SHAPE)));

  return {
    distanceKm: raw,
    effectiveKm,
    toleranceKm,
    toleranceSource,
    score,
    fraction: score / MAX_ROUND_SCORE,
    band: scoreBand(score).id,
  };
}

/**
 * Session-level rating shown on the summary screen.
 *
 * Deliberately no overlap with the mode names (Heartland / Scholar / Expert):
 * a summary reading "Daily #11 — Scholar" would look like the mode played rather
 * than how well it went.
 */
export const SESSION_RANKS = [
  { id: 'curator', label: 'Chief Curator', min: 0.92 },
  { id: 'archaeologist', label: 'Field Archaeologist', min: 0.78 },
  { id: 'researcher', label: 'Researcher', min: 0.6 },
  { id: 'surveyor', label: 'Surveyor', min: 0.4 },
  { id: 'apprentice', label: 'Apprentice', min: 0.2 },
  { id: 'tourist', label: 'Tourist', min: 0 },
] as const;

export function sessionRank(totalScore: number, roundCount: number) {
  const possible = Math.max(1, roundCount * MAX_ROUND_SCORE);
  const fraction = totalScore / possible;
  return {
    ...(SESSION_RANKS.find((r) => fraction >= r.min) ?? SESSION_RANKS[SESSION_RANKS.length - 1]!),
    fraction,
  };
}

export function formatScore(score: number, locale?: string): string {
  return Math.round(score).toLocaleString(locale);
}

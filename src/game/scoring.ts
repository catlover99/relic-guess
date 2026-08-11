import type { OriginPlace, GeoPoint } from '@/data/schema';
import { distanceKm } from './geo';

export const MAX_ROUND_SCORE = 5000;

/**
 * Decay constant in km. At `d = SCALE_KM` the player keeps 1/e (≈37%) of the
 * round score. 1500 km puts a same-region guess in the 3000s and a
 * wrong-continent guess near zero, which matches how concentrated ancient
 * material culture actually is.
 */
const SCALE_KM = 1500;

/** Below this the round is treated as a bullseye, avoiding 4998-style scores. */
const PERFECT_EPSILON_KM = 5;

export interface ScoreBreakdown {
  distanceKm: number;
  /** Distance actually charged after the origin's uncertainty is forgiven. */
  effectiveKm: number;
  /** Radius forgiven because the source coordinate is imprecise. */
  toleranceKm: number;
  score: number;
  /** 0–1, for progress bars. */
  fraction: number;
  band: ScoreBand;
}

export const SCORE_BANDS = [
  { id: 'bullseye', label: 'Bullseye', min: 4900 },
  { id: 'excellent', label: 'Excellent', min: 4000 },
  { id: 'strong', label: 'Strong', min: 2750 },
  { id: 'close', label: 'Warm', min: 1500 },
  { id: 'far', label: 'Cold', min: 400 },
  { id: 'lost', label: 'Way off', min: 0 },
] as const;

export type ScoreBand = (typeof SCORE_BANDS)[number]['id'];

export function scoreBand(score: number): (typeof SCORE_BANDS)[number] {
  return SCORE_BANDS.find((b) => score >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1]!;
}

/**
 * Scores a guess against an artifact's origin.
 *
 * Two properties matter for fairness:
 *
 * 1. **Continuity.** A 199 km miss and a 201 km miss must not differ by a third
 *    of the round score, which is what a bucketed step function does.
 * 2. **Honesty about the source data.** When the best coordinate we have is a
 *    country centroid, the true origin may be 400 km away from it, so the
 *    player is not charged for that portion of the error. `uncertaintyKm` comes
 *    from the coordinate tier — see docs/GEO_CONFIDENCE.md.
 */
export function scoreGuess(guess: GeoPoint, origin: OriginPlace): ScoreBreakdown {
  const raw = distanceKm(guess, origin);
  const toleranceKm = Math.max(0, origin.uncertaintyKm);
  const effectiveKm = Math.max(0, raw - toleranceKm);

  const score =
    effectiveKm <= PERFECT_EPSILON_KM
      ? MAX_ROUND_SCORE
      : Math.round(MAX_ROUND_SCORE * Math.exp(-effectiveKm / SCALE_KM));

  return {
    distanceKm: raw,
    effectiveKm,
    toleranceKm,
    score,
    fraction: score / MAX_ROUND_SCORE,
    band: scoreBand(score).id,
  };
}

/** Session-level rating shown on the summary screen. */
export const SESSION_RANKS = [
  { id: 'curator', label: 'Chief Curator', min: 0.92 },
  { id: 'archaeologist', label: 'Field Archaeologist', min: 0.78 },
  { id: 'scholar', label: 'Scholar', min: 0.6 },
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

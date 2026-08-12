import type { Artifact, HeartlandPlace } from '../../src/data/schema.js';
import { resolveCulture } from './cultures.js';
import { TIER_PROFILE } from './geoTiers.js';

/**
 * Resolves the cultural homeland for an artifact.
 *
 * Runs for *every* artifact, including ones that already have a precise findspot —
 * that is the whole point. Previously the culture table was consulted only as a
 * last resort when no place could be resolved, so an object with a known dig site
 * never carried its culture's region and the reveal could not explain the area the
 * guess was graded against.
 *
 * The radius comes from the culture table's own tier rather than a flat number, so
 * "Attica" (a subregion, 160 km) and "the Aegean Greek world" (a cultural region,
 * 380 km) describe genuinely different extents.
 */

/**
 * Beyond this, treat the culture match as unreliable rather than as evidence of a
 * well-travelled object.
 *
 * A Greek vase found in Etruria is real and interesting at ~1,000 km. A "match"
 * putting the homeland 9,000 km from the recorded findspot is a bad token hit, and
 * making it the thing a player is scored against would be indefensible. Only a
 * handful of records in the collection are affected.
 */
export const MAX_HEARTLAND_DRIFT_KM = 3000;

const EARTH_RADIUS_KM = 6371;

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export interface HeartlandResult {
  heartland: HeartlandPlace | null;
  /** Why nothing was attached, for the ingest report. */
  reason: 'ok' | 'no-culture' | 'unmatched-culture' | 'implausible-drift';
  /** Distance from the artifact's own origin, when both exist. */
  driftKm: number | null;
}

export function resolveHeartland(artifact: Pick<Artifact, 'culture' | 'origin'>): HeartlandResult {
  if (!artifact.culture) return { heartland: null, reason: 'no-culture', driftKm: null };

  const match = resolveCulture(artifact.culture);
  if (!match) return { heartland: null, reason: 'unmatched-culture', driftKm: null };

  const drift = distanceKm(artifact.origin, match);
  if (drift > MAX_HEARTLAND_DRIFT_KM) {
    return { heartland: null, reason: 'implausible-drift', driftKm: drift };
  }

  const profile = TIER_PROFILE[match.tier];
  return {
    heartland: {
      lat: match.lat,
      lon: match.lon,
      label: match.label,
      country: match.country,
      radiusKm: profile.uncertaintyKm,
      culture: artifact.culture,
      confidence: profile.confidence,
      resolvedId: `culture:${match.matchedToken}`,
    },
    reason: 'ok',
    driftKm: drift,
  };
}

export interface HeartlandStats {
  attached: number;
  noCulture: number;
  unmatched: number;
  implausible: number;
  /** Attached and meaningfully separate from the object's own location. */
  distinct: number;
}

/** Attaches a heartland to every artifact that has a defensible one. */
export function attachHeartlands(artifacts: readonly Artifact[]): {
  artifacts: Artifact[];
  stats: HeartlandStats;
} {
  const stats: HeartlandStats = {
    attached: 0,
    noCulture: 0,
    unmatched: 0,
    implausible: 0,
    distinct: 0,
  };

  const out = artifacts.map((artifact) => {
    const { heartland, reason, driftKm } = resolveHeartland(artifact);
    if (reason === 'no-culture') stats.noCulture++;
    else if (reason === 'unmatched-culture') stats.unmatched++;
    else if (reason === 'implausible-drift') stats.implausible++;
    else {
      stats.attached++;
      if ((driftKm ?? 0) > 50) stats.distinct++;
    }
    return { ...artifact, heartland } satisfies Artifact;
  });

  return { artifacts: out, stats };
}

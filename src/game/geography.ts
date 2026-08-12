import type { Artifact, GeoPoint, HeartlandPlace, OriginPlace } from '@/data/schema';
import { difficulty, type DifficultyId } from './selection';

/**
 * What a round means geographically.
 *
 * One module decides this, and the map, the reveal panel and the scorer all read
 * the same answer. When the three worked it out independently the map could draw a
 * circle round one place while the panel described another.
 *
 * A revealed round has up to three distinct concepts, and they must not be
 * collapsed into one marker:
 *
 *   1. **The guess** — where the player clicked.
 *   2. **The scored region** — the area the guess was graded against. In Heartland
 *      and Daily that is the cultural homeland; in the precise modes it is the
 *      object's own recorded location. Either way it is drawn as a circle, because
 *      the radius *is* the scoring rule.
 *   3. **The object's own location** — where this artifact was found or made,
 *      shown whenever it is a genuinely artifact-specific place and is not already
 *      the centre of the scored region. Purely educational: it never affects the
 *      score.
 */

/** A scored region: a centre plus the radius the mode forgives around it. */
export interface ScoredRegion extends GeoPoint {
  label: string;
  radiusKm: number;
  /** Whether the centre is a cultural homeland or the object's own place. */
  kind: 'heartland' | 'origin';
  /** Present when the region came from the culture table. */
  culture: string | null;
}

/**
 * Object-specific locations worth pinning.
 *
 * Strictly *not* included: the holding museum, acquisition or collection place,
 * dealer or collector, a culture centre, or a country centroid. Those are either
 * about the object's modern custody or about a people rather than this object, and
 * pinning them as "found here" would be a lie.
 */
export interface ObjectLocation extends GeoPoint {
  label: string;
  /** Copy for the reveal, chosen from what the location actually is. */
  role: 'found' | 'excavated' | 'made' | 'attributed';
  country: string | null;
}

export interface RoundGeography {
  /** What the score was computed against. Always present. */
  region: ScoredRegion;
  /** The object's own findspot or production place, when distinct and reliable. */
  objectLocation: ObjectLocation | null;
  /** True when the scored region is a cultural homeland rather than the object's place. */
  regionIsHeartland: boolean;
}

/**
 * Tiers precise enough to pin as "this object was here".
 *
 * `culture-region` and `country` are excluded by definition: a region hundreds of
 * kilometres across, or a national centroid, is not a place an object was found.
 */
const PINNABLE_TIERS: ReadonlySet<OriginPlace['tier']> = new Set([
  'findspot',
  'site',
  'city',
  'subregion',
]);

/**
 * Origin kinds that describe *this object*.
 *
 * `cultural-origin` is excluded: it is a statement about the people who made the
 * object, which is precisely what the heartland already expresses.
 */
const OBJECT_KINDS: ReadonlySet<OriginPlace['kind']> = new Set([
  'findspot',
  'creation',
  'attributed',
]);

/** Below this the two centres are the same place and a second pin is just noise. */
export const MIN_PIN_SEPARATION_KM = 25;

const EARTH_RADIUS_KM = 6371;

export function separationKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Whether a mode grades against the cultural homeland rather than the object. */
export function scoresAgainstHeartland(id: DifficultyId): boolean {
  return difficulty(id).scoresAgainst === 'heartland';
}

/**
 * The region a guess is graded against.
 *
 * Heartland and Daily use the cultural homeland when the artifact has one, which is
 * what makes them a different question rather than a looser version of the same
 * one. Everything else — and any artifact whose culture the table does not cover —
 * is graded against the object's own recorded place, exactly as before.
 */
export function scoredRegion(artifact: Artifact, id: DifficultyId): ScoredRegion {
  const mode = difficulty(id);
  const heartland = scoresAgainstHeartland(id) ? artifact.heartland : null;

  if (heartland) {
    return {
      lat: heartland.lat,
      lon: heartland.lon,
      label: heartland.label,
      // The mode's floor still applies: a compact homeland must not be graded
      // more harshly than the mode promises.
      radiusKm: Math.max(heartland.radiusKm, mode.toleranceKm),
      kind: 'heartland',
      culture: heartland.culture,
    };
  }

  return {
    lat: artifact.origin.lat,
    lon: artifact.origin.lon,
    label: artifact.origin.label,
    radiusKm: Math.max(artifact.origin.uncertaintyKm, mode.toleranceKm),
    kind: 'origin',
    culture: null,
  };
}

/** Reveal copy for the object's own place, from what that place actually is. */
function roleFor(origin: OriginPlace, discovery: string | null): ObjectLocation['role'] {
  if (origin.kind === 'creation') return 'made';
  if (origin.kind === 'attributed') return 'attributed';
  // A findspot the museum describes as an excavation earns the stronger word.
  if (origin.tier === 'findspot' && /excavat|dig|expedition/i.test(discovery ?? '')) {
    return 'excavated';
  }
  return 'found';
}

/**
 * The object's own location, when it is worth showing as a separate pin.
 *
 * Returns null when the scored region is already centred on it — two markers on one
 * point communicate nothing — or when the recorded place is too coarse or too vague
 * to honestly claim the object was there.
 */
export function objectLocation(artifact: Artifact, region: ScoredRegion): ObjectLocation | null {
  const { origin } = artifact;

  if (!OBJECT_KINDS.has(origin.kind)) return null;
  if (!PINNABLE_TIERS.has(origin.tier)) return null;
  // A coordinate derived from the culture table describes a people, not a dig.
  if (origin.resolvedBy === 'culture') return null;
  if (separationKm(origin, region) < MIN_PIN_SEPARATION_KM) return null;

  return {
    lat: origin.lat,
    lon: origin.lon,
    label: origin.label,
    country: origin.country,
    role: roleFor(origin, artifact.discovery),
  };
}

/** Everything the reveal needs to describe a round's geography. */
export function roundGeography(artifact: Artifact, id: DifficultyId): RoundGeography {
  const region = scoredRegion(artifact, id);
  return {
    region,
    objectLocation: objectLocation(artifact, region),
    regionIsHeartland: region.kind === 'heartland',
  };
}

/** The heartland an artifact carries, whether or not the mode scores against it. */
export function heartlandOf(artifact: Artifact): HeartlandPlace | null {
  return artifact.heartland;
}

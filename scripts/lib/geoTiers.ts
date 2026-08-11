import type {
  CoordTier,
  OriginKind,
  OriginPlace,
  OriginProvenance,
} from '../../src/data/schema.js';

/**
 * Baseline uncertainty and confidence per coordinate tier.
 *
 * `uncertaintyKm` is a deliberately conservative estimate of how far the true
 * origin may sit from the coordinate we hold. It is the number scoring forgives,
 * so it must be defensible rather than flattering — see docs/GEO_CONFIDENCE.md.
 */
export const TIER_PROFILE: Record<CoordTier, { uncertaintyKm: number; confidence: number }> = {
  // A surveyed dig site or a named building within one.
  findspot: { uncertaintyKm: 15, confidence: 0.98 },
  // A named ancient settlement: Nimrud, Knossos, Vulci.
  site: { uncertaintyKm: 30, confidence: 0.92 },
  // A city, ancient or modern, without a more precise locus.
  city: { uncertaintyKm: 60, confidence: 0.84 },
  // "Upper Egypt, Thebes"; "Attica". Real but extended.
  subregion: { uncertaintyKm: 160, confidence: 0.62 },
  // "Mesopotamia", "Thrace", "Nubia" — hundreds of km across.
  'culture-region': { uncertaintyKm: 380, confidence: 0.42 },
  // Modern national centroid. Barely a location for archaeological purposes.
  country: { uncertaintyKm: 520, confidence: 0.25 },
};

/** How the reason for the association affects trust in the coordinate. */
const KIND_MODIFIER: Record<OriginKind, { confidence: number; uncertainty: number }> = {
  findspot: { confidence: 1, uncertainty: 1 },
  creation: { confidence: 0.97, uncertainty: 1.05 },
  // Attributed to a culture rather than a place: the object may have travelled.
  'cultural-origin': { confidence: 0.8, uncertainty: 1.35 },
  // The provider itself hedges ("Said to be from…").
  attributed: { confidence: 0.7, uncertainty: 1.5 },
};

/**
 * Tiers a player can reasonably be asked to find. Anything coarser than a
 * cultural region is excluded from the playable pool: guessing the centroid of
 * Egypt is a trivia question about borders, not archaeology.
 *
 * Country-tier records are still ingested — they are useful for statistics and
 * become playable if a better coordinate is found on a later sync — but
 * `isPlayableTier` gates what reaches the game bundle.
 */
export const PLAYABLE_TIERS: readonly CoordTier[] = [
  'findspot',
  'site',
  'city',
  'subregion',
  'culture-region',
];

/**
 * Floor for forgiven distance. Even a perfectly surveyed dig site cannot be
 * pinned by hand on a world map to better than a few kilometres, so charging a
 * player for the last 8 km would only measure their mouse precision.
 */
const MIN_UNCERTAINTY_KM = 8;

export function isPlayableTier(tier: CoordTier): boolean {
  return PLAYABLE_TIERS.includes(tier);
}

export interface BuildOriginInput {
  lat: number;
  lon: number;
  label: string;
  country: string | null;
  tier: CoordTier;
  kind: OriginKind;
  resolvedBy: OriginPlace['resolvedBy'];
  resolvedId?: string | null;
  /**
   * Gazetteer-reported precision. Pleiades marks many places "rough" (a
   * bounding box rather than a surveyed point), which must widen uncertainty
   * even at findspot tier.
   */
  precision?: 'precise' | 'rough' | 'unknown';
  /**
   * Measured radius of the place from the gazetteer, when available. Preferred
   * over the tier default because it is evidence rather than an estimate.
   */
  extentKm?: number | null;
  /** Diagnostics describing how this coordinate was derived. */
  provenance?: OriginProvenance;
}

export function buildOrigin(input: BuildOriginInput): OriginPlace {
  const profile = TIER_PROFILE[input.tier];
  const kind = KIND_MODIFIER[input.kind];

  const precisionPenalty =
    input.precision === 'rough' ? 2 : input.precision === 'unknown' ? 1.4 : 1;
  const precisionConfidence =
    input.precision === 'rough' ? 0.85 : input.precision === 'unknown' ? 0.93 : 1;

  // A measured extent beats a tier default, but only downwards-bounded: a
  // gazetteer box tighter than the tier baseline is trustworthy evidence, while a
  // suspiciously tiny box on a broad region is not a licence to score harshly.
  const tierUncertainty = profile.uncertaintyKm * kind.uncertainty * precisionPenalty;
  const measured =
    input.extentKm != null && Number.isFinite(input.extentKm) && input.extentKm > 0
      ? input.extentKm * kind.uncertainty
      : null;
  const uncertaintyKm =
    measured != null
      ? Math.max(MIN_UNCERTAINTY_KM, Math.min(tierUncertainty, measured))
      : tierUncertainty;

  return {
    lat: round6(input.lat),
    lon: round6(input.lon),
    label: input.label,
    country: input.country,
    tier: input.tier,
    kind: input.kind,
    confidence: clamp01(profile.confidence * kind.confidence * precisionConfidence),
    uncertaintyKm: Math.round(uncertaintyKm),
    resolvedBy: input.resolvedBy,
    resolvedId: input.resolvedId ?? null,
    provenance: input.provenance,
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number(v.toFixed(3))));
const round6 = (v: number) => Number(v.toFixed(6));

/** Chooses the most historically meaningful of several candidate origins. */
export function bestOrigin(candidates: readonly OriginPlace[]): OriginPlace | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, next) => (next.confidence > best.confidence ? next : best));
}

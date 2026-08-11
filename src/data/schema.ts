/**
 * Normalized artifact model.
 *
 * This module is the single contract between the build-time ingestion pipeline
 * (`scripts/`) and the runtime game (`src/`). Provider adapters emit `Artifact`
 * values; the game consumes them and never sees provider-specific shapes.
 *
 * It deliberately has no imports so it can be loaded from Node scripts, the
 * browser bundle and tests alike.
 */

export const PROVIDERS = ['wikidata', 'met', 'cma', 'aic'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/**
 * What a coordinate actually *means*. Museums expose several
 * non-equivalent places per object and conflating them produces rounds that ask
 * the player to guess, say, the location of a museum in New York for an
 * Egyptian statue. See docs/GEO_CONFIDENCE.md.
 *
 * Ordered from most to least historically specific.
 */
export const COORD_TIERS = [
  'findspot', // Documented excavation findspot ("Senenmut Quarry, Deir el-Bahri")
  'site', // Named ancient site or settlement of origin ("Nimrud", "Knossos")
  'city', // City of origin ("Athens", "Ravenna")
  'subregion', // Archaeological / administrative subregion ("Upper Egypt, Thebes")
  'culture-region', // Broad cultural region ("Mesopotamia", "Thrace")
  'country', // Modern country centroid ("Egypt")
] as const;
export type CoordTier = (typeof COORD_TIERS)[number];

/**
 * Why this place is associated with the object. Kept separate from the tier
 * because a *findspot* can be country-precision and a *creation* place can be
 * exact.
 */
export const ORIGIN_KINDS = [
  'findspot', // Where it was dug up / discovered
  'creation', // Where it was made
  'cultural-origin', // Where the producing culture was centred
  'attributed', // "Said to be from" — provider itself flags uncertainty
] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface OriginPlace extends GeoPoint {
  /** Human-readable place, most specific first: "Deir el-Bahri, Upper Egypt, Egypt". */
  label: string;
  /** Modern country, when known. Used for balancing and the reveal copy. */
  country: string | null;
  tier: CoordTier;
  kind: OriginKind;
  /** 0–1. Derived from tier, kind and how the coordinate was resolved. */
  confidence: number;
  /**
   * Radius in km within which the true origin plausibly lies. Scoring widens
   * its tolerance by this amount so a country-centroid answer is not graded as
   * strictly as a surveyed dig site.
   */
  uncertaintyKm: number;
  /** Which gazetteer produced the lat/lon. */
  resolvedBy: 'provider' | 'pleiades' | 'wikidata' | 'curated' | 'culture';
  /** Gazetteer record id, for traceability (e.g. "pleiades:727070"). */
  resolvedId: string | null;
  /**
   * How this coordinate was arrived at.
   *
   * Internal diagnostics, not shown in the UI. It exists so a bad match can be
   * traced without re-deriving the pipeline: the earlier "Attic → Attichy, France"
   * and "North Coast → Gribskov Municipality, Denmark" failures each took a full
   * re-investigation to attribute, because nothing recorded what had been looked
   * up or what matched it.
   */
  provenance?: OriginProvenance;
}

export interface OriginProvenance {
  /** Which provider field the geography came from, e.g. "met.region", "met.culture". */
  source: string;
  /** The provider's raw text, before normalisation. */
  rawText: string;
  /** The normalised string actually looked up. */
  query: string;
  /** How the match was made. */
  matchType:
    | 'curated-exact'
    | 'pleiades-exact'
    | 'wikidata-exact'
    | 'culture-table'
    | 'country-fallback'
    | 'provider-coordinate';
  /** The matched record's own label, before provider context was appended. */
  matchedLabel: string;
  /** The matched record's id in its source gazetteer. */
  matchedId: string | null;
  /** The matched record's own type/description, for auditing implausible matches. */
  semanticType: string | null;
  /** Country the match was checked against, when the provider supplied one. */
  countryChecked: string | null;
  /** Distance from that country's centroid, when checked. */
  countryDistanceKm: number | null;
  /** Free-text explanation, e.g. why a culture centre was used. */
  reason: string | null;
}

export interface ArtifactImage {
  /** Preferred rendition for the round. */
  url: string;
  /**
   * Further renditions to try if `url` fails, best first.
   *
   * Museum CDNs expire URLs, block hotlinks and occasionally serve an HTML error
   * page as `image/jpeg`. Every provider here can offer more than one rendition of
   * the same photograph — the Met has `additionalImages`, Cleveland has print and
   * full sizes, and the IIIF and Commons endpoints take a width parameter — so a
   * single dead URL need not cost the artifact.
   *
   * Deliberately excludes `thumbUrl`: it is fine for the results grid but too small
   * to guess material and decoration from.
   */
  alternates: string[];
  /** Smaller variant for the round-summary grid and prefetching. */
  thumbUrl: string;
  width: number | null;
  height: number | null;
  /**
   * When the ingest last confirmed this photograph loads, ISO-8601, or null if it
   * was never checked.
   *
   * Three distinct states are worth keeping apart:
   *   - **URL present** — the provider gave us a string. Says nothing.
   *   - **Verified at ingest** (`verifiedAt` set) — it loaded when the bundle was
   *     built. Can go stale: third-party images disappear.
   *   - **Verified this session** — checked in the player's own browser, from their
   *     network. Only this one guarantees the round is playable, which is why runtime
   *     verification still runs over an ingest-verified bundle.
   */
  verifiedAt: string | null;
  /** SPDX-ish identifier or provider rights statement. */
  license: string;
  /** Verbatim credit line the provider asks us to display. */
  attribution: string;
}

export interface Artifact {
  /** Stable internal id: `${provider}:${providerObjectId}`. */
  id: string;
  provider: ProviderId;
  providerObjectId: string;

  title: string;
  /** 1–3 sentences. Shown only after the guess is locked in. */
  description: string | null;

  culture: string | null;
  period: string | null;
  /** Negative = BCE. Both null when the provider gives no usable date. */
  yearStart: number | null;
  yearEnd: number | null;
  /** Provider's own human-readable date, e.g. "ca. 1473–1458 BCE". */
  dateDisplay: string | null;

  material: string | null;
  objectType: string | null;

  /** The location the game asks the player to find. */
  origin: OriginPlace;
  /** Excavation or acquisition circumstances, e.g. "MMA excavations, 1926–28". */
  discovery: string | null;
  /** Where the object is held today. Never the answer; shown in the reveal. */
  heldBy: string | null;

  image: ArtifactImage;

  metadataLicense: string;
  sourceUrl: string;
  accessionNumber: string | null;

  tags: string[];
  /** 0–1 composite of metadata richness + coordinate confidence. */
  quality: number;
  /** How well-known the object is, 0 (obscure) – 1 (famous). Drives difficulty. */
  fame: number;
  lastSyncedAt: string;
}

export interface ArtifactBundle {
  version: 1;
  generatedAt: string;
  /** Attribution blocks the UI must surface, keyed by provider. */
  sources: Array<{
    provider: ProviderId;
    name: string;
    url: string;
    metadataLicense: string;
    imageLicense: string;
    attribution: string;
    count: number;
  }>;
  artifacts: Artifact[];
}

/* ------------------------------------------------------------------ *
 * Runtime validation
 *
 * The bundle is a static asset that can go stale or be partially written by a
 * failed ingest. Validating on load means a bad record is dropped instead of
 * crashing a live session.
 * ------------------------------------------------------------------ */

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function isValidArtifact(value: unknown): value is Artifact {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as Record<string, unknown>;

  if (!isNonEmptyString(a.id) || !isNonEmptyString(a.title)) return false;
  if (!PROVIDERS.includes(a.provider as ProviderId)) return false;

  const img = a.image as Record<string, unknown> | undefined;
  if (!img || !isNonEmptyString(img.url) || !isNonEmptyString(img.thumbUrl)) return false;

  const o = a.origin as Record<string, unknown> | undefined;
  if (!o) return false;
  if (!isFiniteNumber(o.lat) || !isFiniteNumber(o.lon)) return false;
  if (o.lat < -90 || o.lat > 90 || o.lon < -180 || o.lon > 180) return false;
  // (0, 0) is in the Atlantic; every provider that fails to resolve a place
  // ends up there, so it is always a bug rather than a real origin.
  if (o.lat === 0 && o.lon === 0) return false;
  if (!COORD_TIERS.includes(o.tier as CoordTier)) return false;
  if (!ORIGIN_KINDS.includes(o.kind as OriginKind)) return false;
  if (!isFiniteNumber(o.confidence) || o.confidence < 0 || o.confidence > 1) return false;
  if (!isFiniteNumber(o.uncertaintyKm) || o.uncertaintyKm < 0) return false;
  if (!isNonEmptyString(o.label)) return false;

  return true;
}

/** Drops invalid records rather than throwing, and reports what was dropped. */
export function parseBundle(raw: unknown): { artifacts: Artifact[]; dropped: number } {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as ArtifactBundle).artifacts)
      ? (raw as ArtifactBundle).artifacts
      : [];

  const artifacts: Artifact[] = [];
  for (const item of list) {
    if (isValidArtifact(item)) artifacts.push(item);
  }
  return { artifacts, dropped: list.length - artifacts.length };
}

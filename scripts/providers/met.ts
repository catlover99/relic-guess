import type { Artifact, OriginKind, OriginPlace } from '../../src/data/schema.js';
import { buildOrigin } from '../lib/geoTiers.js';
import { fetchJson, mapLimit } from '../lib/http.js';
import type { HarvestContext, ProviderAdapter } from '../lib/provider.js';
import { fameScore, qualityScore } from '../lib/quality.js';
import { joinPlaceParts, tidyMaterial } from '../lib/text.js';
import { resolveCulture } from '../lib/cultures.js';
import type { ResolvedPlace } from '../lib/gazetteer.js';
import { mulberry32 } from '../../src/game/random.js';

const BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';

/**
 * Departments to harvest, with the share of the budget each receives.
 *
 * The weights are not arbitrary. Geographic coverage in the Met's collection is
 * wildly department-specific — measured over the full 484,956-row open-access
 * dataset, `country` is populated on only ~16% of objects overall — so an even
 * sample wastes most of its requests on records that cannot produce a round:
 *
 * - **Egyptian Art** is by far the richest: `geographyType` is populated on ~94%
 *   of records, and `locale`/`locus` give genuine dig-site precision.
 * - **Islamic Art** is the only department that uses "Excavated in".
 * - **Ancient West Asian Art** leaves `geographyType` empty but does populate
 *   `region`/`subregion` ("Mesopotamia" / "Nimrud (ancient Kalhu)").
 * - **Greek and Roman Art** populates no geography fields at all and is reachable
 *   only through the `culture` fallback, so it gets a modest share.
 * - **Asian Art** is excluded entirely: 34,000 objects with no geography fields
 *   and `culture` values that resolve no finer than a country.
 */
const DEPARTMENTS = [
  { id: 10, label: 'Egyptian Art', weight: 0.38 },
  { id: 3, label: 'Ancient West Asian Art', weight: 0.24 },
  { id: 13, label: 'Greek and Roman Art', weight: 0.14 },
  { id: 14, label: 'Islamic Art', weight: 0.12 },
  { id: 5, label: 'Arts of Africa, Oceania, and the Americas', weight: 0.06 },
  { id: 17, label: 'Medieval Art', weight: 0.06 },
];

interface MetObject {
  objectID: number;
  isHighlight?: boolean;
  accessionNumber?: string;
  isPublicDomain?: boolean;
  primaryImage?: string;
  primaryImageSmall?: string;
  additionalImages?: string[];
  title?: string;
  culture?: string;
  period?: string;
  dynasty?: string;
  objectDate?: string;
  objectBeginDate?: number;
  objectEndDate?: number;
  medium?: string;
  classification?: string;
  objectName?: string;
  geographyType?: string;
  city?: string;
  state?: string;
  county?: string;
  country?: string;
  region?: string;
  subregion?: string;
  locale?: string;
  locus?: string;
  excavation?: string;
  river?: string;
  department?: string;
  creditLine?: string;
  objectURL?: string;
  repository?: string;
  tags?: Array<{ term?: string }> | null;
}

/**
 * `geographyType` is the Met's own statement about what the place means. It is
 * free text, so it is matched by pattern rather than enumerated.
 *
 * "Excavated in" / "From" / "Found at" describe a findspot. "Made in" describes
 * production. "Said to be from" / "Probably from" are the Met flagging its own
 * uncertainty, which we must carry through to the coordinate confidence rather
 * than silently promoting to a fact.
 */
export function originKindFromGeographyType(geographyType: string | undefined): OriginKind {
  const value = firstSegment(geographyType).toLowerCase();
  if (/probably|possibly|presumably|attributed|reportedly/.test(value)) return 'attributed';
  if (/excavat|found|discover|^from\b|unearthed|original from/.test(value)) return 'findspot';
  if (/made|manufactur|produc|painted|written|carved|woven|mint/.test(value)) return 'creation';
  if (/style of|culture|country of origin/.test(value)) return 'cultural-origin';
  /*
   * No statement at all — 87.6% of the Met's corpus.
   *
   * This is an origin of *unknown sense*, not a cultural one. Calling it
   * `cultural-origin` made the reveal say "Where its culture was centred" over a real
   * excavated site like Dinkha Tepe, and made every audit check that reasons about
   * culture inference fire on records that were never culture-derived.
   * `attributed` is the honest label: the museum names a place without saying in what
   * sense, so the reveal reads "Where it is thought to be from".
   */
  return value ? 'findspot' : 'attributed';
}

/**
 * `geographyType` values the game must not use.
 *
 * "Said to be from" is dealer hearsay the Met itself does not assert; "Formerly
 * considered made in" is a *superseded* attribution; "Object place" is a
 * modern/contemporary-art field whose relationship to the object is unspecified.
 * Scoring a player against any of these would be scoring them against a claim the
 * museum has disowned.
 */
const EXCLUDED_GEOGRAPHY_TYPES = /said to be|formerly considered|object place/i;

/**
 * Met geography fields are pipe-delimited multi-values, positionally aligned with
 * `geographyType`. Only the first assertion is used: later segments belong to
 * alternative or secondary attributions.
 */
function firstSegment(value: string | undefined): string {
  return (value ?? '').split('|')[0]?.trim() ?? '';
}

/**
 * Candidate place strings, narrowest first.
 *
 * The Met's hierarchy is not strictly nested — `subregion` frequently holds the
 * actual site ("Nimrud (ancient Kalhu)") while `region` holds a cultural area
 * ("Mesopotamia") — so every populated field is offered to the gazetteer and the
 * most confident resolution wins.
 */
export function metPlaceCandidates(object: MetObject): string[] {
  return [
    object.locus,
    object.locale,
    object.subregion,
    object.city,
    object.region,
    object.county,
    object.state,
    object.country,
  ]
    .map((value) => firstSegment(value))
    .filter((value) => value.length > 1);
}

/**
 * Builds the display label: "Deir el-Bahri, Upper Egypt, Egypt".
 *
 * Provider context (region, country) is appended **only** when the resolver
 * confirmed the match is consistent with that country. Otherwise the label is the
 * matched record's own label and nothing else, so the label and the coordinate
 * always describe the same entity.
 */
function originLabel(object: MetObject, resolved: ResolvedPlace): string {
  const contextIsConsistent = resolved.country !== null;
  if (!contextIsConsistent) return resolved.matchedLabel;
  return joinPlaceParts([
    resolved.matchedLabel,
    firstSegment(object.region),
    firstSegment(object.country),
  ]);
}

/**
 * The Met serves derivatives under predictable path segments. `web-large`
 * (~90 KB) is the right default for the artifact panel; `mobile-large` (~34 KB)
 * is the thumbnail. `original` is deliberately avoided — those files run to
 * several megabytes.
 */
function thumbFrom(webLarge: string): string {
  return webLarge.replace('/web-large/', '/mobile-large/');
}

/**
 * Why records were skipped, tallied per run.
 *
 * The Met's yield is low by nature — geography is populated on a minority of the
 * collection — so distinguishing "no geography" from "gazetteer miss" from
 * "request failed" is the only way to tell a data limitation from a regression.
 */
export interface MetSkipCounts {
  notPublicDomain: number;
  excludedGeographyType: number;
  noImage: number;
  noPlaceCandidates: number;
  unresolvedPlace: number;
  requestFailed: number;
}

async function normalize(
  object: MetObject,
  context: HarvestContext,
  skips: MetSkipCounts,
): Promise<Artifact | null> {
  if (!object.isPublicDomain) {
    skips.notPublicDomain++;
    return null;
  }
  if (EXCLUDED_GEOGRAPHY_TYPES.test(object.geographyType ?? '')) {
    skips.excludedGeographyType++;
    return null;
  }
  // `primaryImageSmall` is the web-large derivative; fall back by rewriting the
  // original's path rather than shipping a multi-megabyte file to phones.
  const image =
    object.primaryImageSmall || object.primaryImage?.replace('/original/', '/web-large/');
  if (!image || !object.title) {
    skips.noImage++;
    return null;
  }

  const countryHint = firstSegment(object.country) || null;
  const geoCandidates = metPlaceCandidates(object);
  const kind = originKindFromGeographyType(object.geographyType);

  const resolutions: OriginPlace[] = [];

  /*
   * Provider geography first. Each candidate is resolved independently and the
   * label comes from the matched record alone — provider context is appended only
   * when it is consistent with that record (see `originLabel`). Splicing
   * unconditionally produced labels such as "Gribskov Municipality, North Coast,
   * Peru", where the city, the region and the country came from three different
   * places and only the first supplied the coordinate.
   */
  for (const candidate of geoCandidates) {
    const resolved = await context.gazetteer.resolve(candidate, { country: countryHint });
    if (!resolved) continue;
    resolutions.push(
      buildOrigin({
        lat: resolved.lat,
        lon: resolved.lon,
        label: originLabel(object, resolved),
        country: resolved.country,
        tier: resolved.tier,
        kind,
        resolvedBy: resolved.resolvedBy,
        resolvedId: resolved.resolvedId,
        precision: resolved.precision,
        extentKm: resolved.extentKm ?? null,
        provenance: {
          source: 'met.geography',
          rawText: candidate,
          query: resolved.query,
          matchType: resolved.matchType,
          matchedLabel: resolved.matchedLabel,
          matchedId: resolved.resolvedId,
          semanticType: resolved.semanticType,
          countryChecked: countryHint,
          countryDistanceKm: null,
          reason: `Met geography field, geographyType="${firstSegment(object.geographyType)}"`,
        },
      }),
    );
  }

  /*
   * Culture second, and only through the controlled table. Culture strings are never
   * handed to a place gazetteer: "Attic" resolved to Attichy in France, "Chimú" to a
   * Danish municipality. See scripts/lib/cultures.ts.
   */
  const cultureHit = resolveCulture(object.culture);
  if (cultureHit) {
    resolutions.push(
      buildOrigin({
        lat: cultureHit.lat,
        lon: cultureHit.lon,
        label: cultureHit.label,
        country: cultureHit.country,
        tier: cultureHit.tier,
        kind: 'cultural-origin',
        resolvedBy: 'culture',
        resolvedId: `culture:${cultureHit.matchedToken}`,
        precision: 'precise',
        provenance: {
          source: 'met.culture',
          rawText: object.culture ?? '',
          query: cultureHit.matchedToken,
          matchType: 'culture-table',
          matchedLabel: cultureHit.label,
          matchedId: `culture:${cultureHit.matchedToken}`,
          semanticType: cultureHit.tier,
          countryChecked: countryHint,
          countryDistanceKm: null,
          reason: cultureHit.note,
        },
      }),
    );
  }

  if (resolutions.length === 0) {
    skips.noPlaceCandidates++;
    return null;
  }

  /*
   * Best by confidence. A real findspot therefore still beats a cultural centre,
   * while a culture centre beats a coarse country fallback — which is what makes the
   * Moche bottle resolve to the Peruvian north coast rather than to "Peru" or to an
   * unresolvable "North Coast".
   */
  const origin = resolutions.reduce((best, next) =>
    next.confidence > best.confidence ? next : best,
  );

  const tags = (object.tags ?? [])
    .map((t) => t.term?.trim())
    .filter((t): t is string => Boolean(t))
    .slice(0, 6);

  const period =
    [firstSegment(object.period), firstSegment(object.dynasty)].filter(Boolean).join(', ') || null;

  const artifact: Artifact = {
    id: `met:${object.objectID}`,
    provider: 'met',
    providerObjectId: String(object.objectID),
    title: object.title.trim(),
    // The Met's public API exposes no narrative description, so the reveal
    // leans on its (excellent) structured fields instead of inventing prose.
    description: null,
    culture: object.culture?.trim() || null,
    period,
    yearStart: Number.isFinite(object.objectBeginDate) ? object.objectBeginDate! : null,
    yearEnd: Number.isFinite(object.objectEndDate) ? object.objectEndDate! : null,
    dateDisplay: object.objectDate?.trim() || null,
    material: tidyMaterial(object.medium),
    objectType: object.classification?.trim() || object.objectName?.trim() || null,
    origin,
    /*
     * The Met's public API exposes no narrative description, so the reveal leans on
     * its structured fields. `excavation` is the best of them ("MMA excavations,
     * 1926–28"); `creditLine` is the fallback and is often genuinely interesting
     * provenance ("Given to the United States by Egypt in 1965").
     */
    discovery: firstSegment(object.excavation) || firstSegment(object.creditLine) || null,
    heldBy: object.repository?.trim() || 'The Metropolitan Museum of Art, New York',
    image: {
      url: image,
      /*
       * The Met publishes every additional view of an object. They show the same
       * artifact from another angle, so any of them is a usable round if the primary
       * rendition 404s. Rewritten to the `web-large` derivative — `original` files
       * run to several megabytes.
       */
      alternates: (object.additionalImages ?? [])
        .map((url) => url.replace('/original/', '/web-large/'))
        .filter((url) => url !== image)
        .slice(0, 3),
      verifiedAt: null,
      thumbUrl: thumbFrom(image),
      width: null,
      height: null,
      license: 'Public domain (CC0 1.0 — Met Open Access)',
      attribution: 'The Metropolitan Museum of Art',
    },
    metadataLicense: 'CC0 1.0',
    sourceUrl:
      object.objectURL || `https://www.metmuseum.org/art/collection/search/${object.objectID}`,
    accessionNumber: object.accessionNumber?.trim() || null,
    tags,
    quality: 0,
    fame: 0,
    lastSyncedAt: context.now,
  };

  artifact.quality = qualityScore(artifact);
  artifact.fame = fameScore({
    isHighlight: object.isHighlight,
    imageCount: 1 + (object.additionalImages?.length ?? 0),
    hasDescription: false,
    title: artifact.title,
  });
  return artifact;
}

export const metProvider: ProviderAdapter = {
  id: 'met',
  name: 'The Metropolitan Museum of Art',
  url: 'https://www.metmuseum.org/about-the-met/policies-and-documents/open-access',
  metadataLicense: 'CC0 1.0',
  imageLicense: 'Public domain (Open Access images)',
  attribution: 'The Metropolitan Museum of Art, New York',

  async harvest(context: HarvestContext): Promise<Artifact[]> {
    const rng = mulberry32(context.seed);
    const ids: number[] = [];

    for (const department of DEPARTMENTS) {
      const perDepartment = Math.ceil(context.limit * department.weight);
      const search = await fetchJson<{ total: number; objectIDs: number[] | null }>(
        `${BASE}/search?departmentId=${department.id}&hasImages=true&isPublicDomain=true&q=*`,
      );
      const pool = search.objectIDs ?? [];
      context.log(`  met/${department.label}: ${pool.length} public-domain objects with images`);

      // Deterministic sample: the API returns ids in relevance order, which
      // clusters by accession batch, so taking the head would harvest whole
      // excavations at once.
      const sampled = pool
        .map((id) => ({ id, sort: rng() }))
        .sort((a, b) => a.sort - b.sort)
        .slice(0, perDepartment)
        .map((entry) => entry.id);
      ids.push(...sampled);
    }

    context.log(`  met: fetching ${ids.length} objects`);
    const skips: MetSkipCounts = {
      notPublicDomain: 0,
      excludedGeographyType: 0,
      noImage: 0,
      noPlaceCandidates: 0,
      unresolvedPlace: 0,
      requestFailed: 0,
    };

    const artifacts = await mapLimit(
      ids,
      // The Met documents 80 req/s but returns transient 403s under sustained
      // parallel load, and a 403 is not retried. Four at a time is comfortably
      // within its tolerance.
      4,
      async (id) => {
        try {
          const object = await fetchJson<MetObject>(`${BASE}/objects/${id}`);
          return await normalize(object, context, skips);
        } catch {
          skips.requestFailed++;
          return null;
        }
      },
      (done, total) => {
        if (done % 1000 === 0 || done === total) context.log(`  met: ${done}/${total}`);
      },
    );

    context.log(
      `  met: skipped — ${Object.entries(skips)
        .filter(([, count]) => count > 0)
        .map(([reason, count]) => `${reason} ${count}`)
        .join(', ')}`,
    );
    return artifacts;
  },
};

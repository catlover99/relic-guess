import type { Artifact, OriginKind } from '../../src/data/schema.js';
import { buildOrigin } from '../lib/geoTiers.js';
import { fetchJson } from '../lib/http.js';
import type { HarvestContext, ProviderAdapter } from '../lib/provider.js';
import { fameScore, qualityScore } from '../lib/quality.js';
import { joinPlaceParts, summarize, tidyMaterial } from '../lib/text.js';

const BASE = 'https://api.artic.edu/api/v1';

/** AIC asks API consumers to identify themselves with this header. */
const HEADERS = { 'AIC-User-Agent': 'relicguess-ingest (https://github.com/relicguess)' };

const DEPARTMENTS = [
  'Arts of Asia',
  'Arts of Africa',
  'Arts of the Americas',
  'Applied Arts of Europe',
  'Ancient and Byzantine Art',
];

/**
 * `place_of_origin` is a trap and must never be used on its own.
 *
 * It is a flattened single string with no qualifier, and in a 500-record sample
 * roughly 89% of AIC's underlying place assertions are the **artist's
 * nationality** rather than a place of production. Hokusai's *Great Wave* carries
 * `place_of_origin: "Japan"` via `qualifier_title: "Artist's nationality:"` — for
 * a Japanese print that happens to be harmless, but the same mechanism would
 * place a Picasso made in Paris in Spain.
 *
 * The `place_pivots` relationship exposes the qualifier, so a record is only
 * accepted when a pivot actually asserts production.
 */
const ACCEPTED_QUALIFIERS: Record<string, { kind: OriginKind; hedged: boolean }> = {
  'object made in:': { kind: 'creation', hedged: false },
  'object designed in:': { kind: 'creation', hedged: false },
  'object probably made in': { kind: 'creation', hedged: true },
  'object possibly made in': { kind: 'creation', hedged: true },
};

/**
 * Qualifiers that look geographic but are not the object's origin. Listed
 * explicitly so an unrecognised new qualifier is rejected by default rather than
 * silently trusted.
 */
const REJECTED_QUALIFIERS = new Set([
  "artist's nationality:",
  'place depicted:',
  'building address:',
  'object made for:',
]);

const FIELDS = [
  'id',
  'title',
  'place_of_origin',
  'place_pivots',
  'date_display',
  'date_start',
  'date_end',
  'medium_display',
  'artwork_type_title',
  'classification_title',
  'department_title',
  'image_id',
  'is_public_domain',
  'short_description',
  'style_title',
  'main_reference_number',
  'is_boosted',
  'category_titles',
].join(',');

interface PlacePivot {
  place_title?: string | null;
  qualifier_title?: string | null;
  is_preferred?: boolean;
}

interface AicRecord {
  id: number;
  title?: string;
  place_of_origin?: string | null;
  place_pivots?: PlacePivot[] | null;
  date_display?: string | null;
  date_start?: number | null;
  date_end?: number | null;
  medium_display?: string | null;
  artwork_type_title?: string | null;
  classification_title?: string | null;
  department_title?: string | null;
  image_id?: string | null;
  is_public_domain?: boolean;
  short_description?: string | null;
  style_title?: string | null;
  main_reference_number?: string | null;
  is_boosted?: boolean;
  category_titles?: string[];
}

/**
 * IIIF Image API. AIC's docs recommend `/full/843,/0/default.jpg` specifically,
 * because that is the width their own site requests and is therefore already warm
 * in their CDN cache.
 */
function iiif(imageId: string, width: number): string {
  return `https://www.artic.edu/iiif/2/${imageId}/full/${width},/0/default.jpg`;
}

/** Picks the best production-place pivot, or null if none asserts production. */
export function selectProductionPivot(
  pivots: readonly PlacePivot[] | null | undefined,
): { place: string; kind: OriginKind; hedged: boolean } | null {
  if (!pivots) return null;

  const candidates = pivots
    .map((pivot) => {
      const place = pivot.place_title?.trim();
      const qualifier = pivot.qualifier_title?.trim().toLowerCase();
      if (!place || !qualifier) return null;
      if (REJECTED_QUALIFIERS.has(qualifier)) return null;
      const accepted = ACCEPTED_QUALIFIERS[qualifier];
      if (!accepted) return null;
      return { place, ...accepted, preferred: pivot.is_preferred === true };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  if (candidates.length === 0) return null;
  // Prefer an unhedged, preferred assertion.
  candidates.sort(
    (a, b) => Number(b.preferred) - Number(a.preferred) || Number(a.hedged) - Number(b.hedged),
  );
  return candidates[0]!;
}

async function normalize(record: AicRecord, context: HarvestContext): Promise<Artifact | null> {
  if (!record.is_public_domain || !record.image_id || !record.title) return null;

  const pivot = selectProductionPivot(record.place_pivots);
  if (!pivot) return null;

  const resolved = await context.gazetteer.resolve(pivot.place);
  if (!resolved) return null;

  const origin = buildOrigin({
    lat: resolved.lat,
    lon: resolved.lon,
    // Label and coordinate always come from the same matched record.
    label: joinPlaceParts([resolved.matchedLabel, resolved.country]),
    country: resolved.country,
    tier: resolved.tier,
    // A hedged qualifier ("probably made in") is the museum flagging its own
    // uncertainty, which must reach the confidence score.
    kind: pivot.hedged ? 'attributed' : pivot.kind,
    resolvedBy: resolved.resolvedBy,
    resolvedId: resolved.resolvedId,
    precision: resolved.precision,
    extentKm: resolved.extentKm ?? null,
    provenance: {
      source: 'aic.place_pivots',
      rawText: pivot.place,
      query: resolved.query,
      matchType: resolved.matchType,
      matchedLabel: resolved.matchedLabel,
      matchedId: resolved.resolvedId,
      semanticType: resolved.semanticType,
      countryChecked: null,
      countryDistanceKm: null,
      reason: `AIC place pivot qualified as production${pivot.hedged ? ' (hedged)' : ''}`,
    },
  });

  const description = summarize(record.short_description);

  const artifact: Artifact = {
    id: `aic:${record.id}`,
    provider: 'aic',
    providerObjectId: String(record.id),
    title: record.title.trim(),
    description,
    culture: record.style_title?.trim() || null,
    period: null,
    yearStart: record.date_start ?? null,
    yearEnd: record.date_end ?? null,
    dateDisplay: record.date_display?.trim() || null,
    material: tidyMaterial(record.medium_display),
    objectType: record.classification_title?.trim() || record.artwork_type_title?.trim() || null,
    origin,
    discovery: null,
    heldBy: 'Art Institute of Chicago',
    image: {
      url: iiif(record.image_id, 843),
      /*
       * IIIF renders any width on demand. 843 is the width AIC's own site requests,
       * so it is usually warm in their CDN; the others are fallbacks for the rare
       * case that one derivative fails to generate.
       */
      alternates: [iiif(record.image_id, 1686), iiif(record.image_id, 600)],
      verifiedAt: null,
      thumbUrl: iiif(record.image_id, 400),
      width: 843,
      height: null,
      license: 'Public domain (CC0 1.0)',
      attribution: 'Art Institute of Chicago',
    },
    // AIC states in every response that all data is CC0 **except**
    // `short_description`/`description`, which are CC BY 4.0 and therefore
    // require attribution wherever the text is shown.
    metadataLicense: description
      ? 'CC0 1.0; description text CC BY 4.0 (Art Institute of Chicago)'
      : 'CC0 1.0',
    sourceUrl: `https://www.artic.edu/artworks/${record.id}`,
    accessionNumber: record.main_reference_number?.trim() || null,
    tags: (record.category_titles ?? []).slice(0, 6),
    quality: 0,
    fame: 0,
    lastSyncedAt: context.now,
  };

  artifact.quality = qualityScore(artifact);
  artifact.fame = fameScore({
    isHighlight: record.is_boosted,
    hasDescription: Boolean(description),
    title: artifact.title,
  });
  return artifact;
}

export const aicProvider: ProviderAdapter = {
  id: 'aic',
  name: 'Art Institute of Chicago',
  url: 'https://api.artic.edu/docs/',
  metadataLicense: 'CC0 1.0 (description text: CC BY 4.0)',
  imageLicense: 'Public domain (CC0); non-public-domain images are not ingested',
  attribution: 'Art Institute of Chicago',

  async harvest(context: HarvestContext): Promise<Artifact[]> {
    /* Two phases, because `place_pivots` is a relationship: the search endpoint
       silently omits it even when asked, while `/artworks?ids=` returns it. */
    const ids: number[] = [];
    const perPage = 100;
    const pages = Math.ceil(context.limit / perPage);

    for (let page = 1; page <= pages; page++) {
      const query = {
        query: {
          bool: {
            must: [
              { term: { is_public_domain: true } },
              { exists: { field: 'image_id' } },
              { exists: { field: 'place_of_origin' } },
              { terms: { 'department_title.keyword': DEPARTMENTS } },
            ],
            must_not: [{ range: { date_start: { gte: 1750 } } }],
          },
        },
      };
      const url =
        `${BASE}/artworks/search?fields=id&limit=${perPage}&page=${page}` +
        `&params=${encodeURIComponent(JSON.stringify(query))}`;

      try {
        const response = await fetchJson<{ data?: Array<{ id: number }> }>(url, {
          headers: HEADERS,
        });
        const batch = response.data ?? [];
        if (batch.length === 0) break;
        ids.push(...batch.map((item) => item.id));
        if (batch.length < perPage) break;
      } catch (error) {
        context.log(`  aic: search page ${page} failed (${(error as Error).message}); stopping`);
        break;
      }
    }

    context.log(`  aic: ${ids.length} candidate ids; fetching details with place qualifiers`);

    const artifacts: Artifact[] = [];
    const batchSize = 50;
    let rejectedQualifier = 0;

    for (let offset = 0; offset < ids.length; offset += batchSize) {
      const batch = ids.slice(offset, offset + batchSize);
      const url = `${BASE}/artworks?ids=${batch.join(',')}&fields=${FIELDS}&include=place_pivots`;
      try {
        const response = await fetchJson<{ data?: AicRecord[] }>(url, { headers: HEADERS });
        for (const record of response.data ?? []) {
          const artifact = await normalize(record, context);
          if (artifact) artifacts.push(artifact);
          else if (!selectProductionPivot(record.place_pivots)) rejectedQualifier++;
        }
      } catch (error) {
        context.log(`  aic: batch at ${offset} failed (${(error as Error).message})`);
      }
    }

    context.log(
      `  aic: ${artifacts.length} kept; ${rejectedQualifier} rejected for having no production-place qualifier`,
    );
    return artifacts;
  },
};

import type { Artifact, OriginKind, OriginPlace } from '../../src/data/schema.js';
import { buildOrigin } from '../lib/geoTiers.js';
import { fetchJson } from '../lib/http.js';
import type { HarvestContext, ProviderAdapter } from '../lib/provider.js';
import { fameScore, qualityScore } from '../lib/quality.js';
import { joinPlaceParts, summarize, tidyMaterial } from '../lib/text.js';
import { resolveCulture } from '../lib/cultures.js';

const BASE = 'https://openaccess-api.clevelandart.org/api';

const DEPARTMENTS = [
  'Egyptian and Ancient Near Eastern Art',
  'Greek and Roman Art',
  'Chinese Art',
  'Japanese Art',
  'Korean Art',
  'Indian and Southeast Asian Art',
  'Islamic Art',
  'African Art',
  'Art of the Americas',
  'Medieval Art',
  'Pre-Columbian Art',
  'Textiles',
];

interface CmaImage {
  url?: string;
  width?: string;
  height?: string;
}

interface CmaRecord {
  id: number;
  accession_number?: string;
  share_license_status?: string;
  title?: string;
  creation_date?: string | null;
  creation_date_earliest?: number | null;
  creation_date_latest?: number | null;
  culture?: string[] | null;
  technique?: string | null;
  department?: string | null;
  type?: string | null;
  /** Cleveland's explicit findspot field — the single best geography we get. */
  find_spot?: string | null;
  description?: string | null;
  did_you_know?: string | null;
  url?: string;
  images?: { web?: CmaImage; print?: CmaImage; full?: CmaImage } | null;
  is_highlight?: boolean;
  creditline?: string | null;
  legal_status?: string | null;
}

/**
 * Cleveland's `find_spot` is free text that mixes verified findspots with explicit
 * dealer hearsay in the same field:
 *
 *   "palace of Ashur-nasirapal II in Calah (Nimrud)"          ← usable
 *   "Said by Jacob Hirsch to have been excavated at Kerch"    ← hearsay
 *
 * A hearsay findspot is a claim the museum records without endorsing, so it must
 * not become a scored answer.
 */
const HEARSAY_PREFIX = /^\s*(said|reported|reputed|alleged|probabl|possibl|perhaps|purported)/i;

export function isHearsayFindspot(findSpot: string): boolean {
  return HEARSAY_PREFIX.test(findSpot);
}

/**
 * Cleveland's `culture` strings look like
 * "Egypt, New Kingdom (1540–1069 BCE), Dynasty 18, reign of Amenhotep II".
 *
 * The leading segment is a place; the rest is periodisation. Splitting on the
 * first comma isolates the place without dragging dynasty names into the
 * gazetteer, where they would either miss or — worse — match something unrelated.
 */
export function placeFromCulture(culture: string): string | null {
  const head = culture.split(',')[0]?.trim();
  if (!head || head.length < 3) return null;
  // Reject leading segments that are clearly not places.
  if (/dynasty|period|kingdom of|reign|century|bce|ce\b/i.test(head)) return null;
  return head;
}

/** The period portion, for display: everything after the leading place. */
export function periodFromCulture(culture: string): string | null {
  const parts = culture.split(',').slice(1).join(',').trim();
  return parts.length > 2 ? parts.replace(/\s+/g, ' ') : null;
}

async function normalize(record: CmaRecord, context: HarvestContext): Promise<Artifact | null> {
  // Only CC0-cleared records: everything else has unresolved image rights.
  if (record.share_license_status !== 'CC0') return null;
  const web = record.images?.web;
  if (!web?.url || !record.title) return null;

  const cultureString = record.culture?.[0] ?? null;

  const candidates: Array<{
    place: string;
    kind: OriginKind;
    source: string;
    reason: string;
    countryHint: string | null;
  }> = [];
  const findSpot = record.find_spot?.trim();
  if (findSpot && !isHearsayFindspot(findSpot)) {
    candidates.push({
      place: findSpot,
      kind: 'findspot',
      source: 'cma.find_spot',
      reason: 'Cleveland records an explicit findspot for this object',
      // The findspot string usually ends with its country ("Thebes, Egypt").
      countryHint: findSpot.split(',').pop()?.trim() ?? null,
    });
  }
  if (cultureString) {
    const place = placeFromCulture(cultureString);
    if (place)
      candidates.push({
        place,
        kind: 'creation',
        source: 'cma.culture.place',
        reason: "leading segment of Cleveland's culture string, which names a place",
        countryHint: place,
      });
  }
  if (candidates.length === 0) return null;

  const resolutions: OriginPlace[] = [];
  for (const candidate of candidates) {
    const resolved = await context.gazetteer.resolve(candidate.place, {
      country: candidate.countryHint,
    });
    if (!resolved) continue;
    resolutions.push(
      buildOrigin({
        lat: resolved.lat,
        lon: resolved.lon,
        // Label and coordinate always come from the same matched record.
        label: joinPlaceParts([resolved.matchedLabel, resolved.country]),
        country: resolved.country,
        tier: resolved.tier,
        kind: candidate.kind,
        resolvedBy: resolved.resolvedBy,
        resolvedId: resolved.resolvedId,
        precision: resolved.precision,
        extentKm: resolved.extentKm ?? null,
        provenance: {
          source: candidate.source,
          rawText: candidate.place,
          query: resolved.query,
          matchType: resolved.matchType,
          matchedLabel: resolved.matchedLabel,
          matchedId: resolved.resolvedId,
          semanticType: resolved.semanticType,
          countryChecked: candidate.countryHint,
          countryDistanceKm: null,
          reason: candidate.reason,
        },
      }),
    );
  }

  /*
   * Cleveland's `culture` is a descriptive string ("Egypt, New Kingdom …"). Its
   * leading segment is often a real place, handled above, but where the string names
   * a *culture* the controlled table is the only safe route.
   */
  const cultureHit = resolveCulture(cultureString);
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
          source: 'cma.culture',
          rawText: cultureString ?? '',
          query: cultureHit.matchedToken,
          matchType: 'culture-table',
          matchedLabel: cultureHit.label,
          matchedId: `culture:${cultureHit.matchedToken}`,
          semanticType: cultureHit.tier,
          countryChecked: null,
          countryDistanceKm: null,
          reason: cultureHit.note,
        },
      }),
    );
  }
  if (resolutions.length === 0) return null;

  const origin = resolutions.reduce((best, next) =>
    next.confidence > best.confidence ? next : best,
  );

  // `did_you_know` is written for gallery visitors and is exactly the register
  // the reveal screen wants, so it is preferred over the longer catalogue text.
  const description =
    summarize(record.did_you_know, 240) ?? summarize(record.description, 420) ?? null;

  const artifact: Artifact = {
    id: `cma:${record.id}`,
    provider: 'cma',
    providerObjectId: String(record.id),
    title: record.title.trim(),
    description,
    /*
     * Cleveland's `culture` is a single descriptive string that already contains
     * both the cultural attribution and the periodisation ("Egypt, New Kingdom
     * (1540–1069 BCE), Dynasty 18"). Its leading segment is parsed out for
     * *geographic* resolution above, but it must not be presented as the culture:
     * labelling a reveal "Culture: Pakistan" states a place as a people.
     */
    culture: cultureString,
    period: null,
    yearStart: record.creation_date_earliest ?? null,
    yearEnd: record.creation_date_latest ?? null,
    dateDisplay: record.creation_date?.trim() || null,
    material: tidyMaterial(record.technique),
    objectType: record.type?.trim() || null,
    origin,
    discovery: findSpot && !isHearsayFindspot(findSpot) ? `Findspot recorded as ${findSpot}` : null,
    heldBy: 'The Cleveland Museum of Art',
    image: {
      url: web.url,
      // Cleveland serves the same photograph at print and full resolution.
      alternates: [record.images?.print?.url, record.images?.full?.url].filter(
        (url): url is string => Boolean(url) && url !== web.url,
      ),
      verifiedAt: null,
      // The `web` derivative is ~900px and ~80 KB; there is no smaller
      // derivative, so the thumbnail reuses it and is downscaled by the browser.
      thumbUrl: web.url,
      width: Number(web.width) || null,
      height: Number(web.height) || null,
      license: 'CC0 1.0',
      attribution: 'The Cleveland Museum of Art',
    },
    metadataLicense: 'CC0 1.0',
    sourceUrl: record.url || `https://clevelandart.org/art/${record.accession_number ?? record.id}`,
    accessionNumber: record.accession_number?.trim() || null,
    tags: [record.department?.trim(), record.type?.trim()].filter((t): t is string => Boolean(t)),
    quality: 0,
    fame: 0,
    lastSyncedAt: context.now,
  };

  artifact.quality = qualityScore(artifact);
  artifact.fame = fameScore({
    isHighlight: record.is_highlight,
    hasDescription: Boolean(description),
    title: artifact.title,
  });
  return artifact;
}

export const cmaProvider: ProviderAdapter = {
  id: 'cma',
  name: 'The Cleveland Museum of Art',
  url: 'https://openaccess-api.clevelandart.org/',
  metadataLicense: 'CC0 1.0',
  imageLicense: 'CC0 1.0 (only records flagged share_license_status = CC0 are ingested)',
  attribution: 'The Cleveland Museum of Art',

  async harvest(context: HarvestContext): Promise<Artifact[]> {
    const artifacts: Artifact[] = [];
    const perPage = 100;
    const perDepartment = Math.max(perPage, Math.ceil(context.limit / DEPARTMENTS.length));

    for (const department of DEPARTMENTS) {
      let kept = 0;
      for (let skip = 0; skip < perDepartment; skip += perPage) {
        const url =
          `${BASE}/artworks/?cc0=1&has_image=1&limit=${perPage}&skip=${skip}` +
          `&department=${encodeURIComponent(department)}`;

        let response: { data?: CmaRecord[] };
        try {
          response = await fetchJson(url);
        } catch (error) {
          context.log(`  cma/${department}: request failed (${(error as Error).message})`);
          break;
        }

        const records = response.data ?? [];
        if (records.length === 0) break;
        for (const record of records) {
          const artifact = await normalize(record, context);
          if (artifact) {
            artifacts.push(artifact);
            kept++;
          }
        }
        if (records.length < perPage) break;
      }
      context.log(`  cma/${department}: ${kept} kept`);
    }

    return artifacts;
  },
};

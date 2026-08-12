import type { Artifact, CoordTier, OriginKind } from '../../src/data/schema.js';
import { buildOrigin } from '../lib/geoTiers.js';
import { fetchJson } from '../lib/http.js';
import { countryCompatible, normalizePlaceKey } from '../lib/gazetteer.js';
import { COUNTRY_ALIASES, COUNTRY_CENTROIDS } from '../lib/places.curated.js';
import type { HarvestContext, ProviderAdapter } from '../lib/provider.js';
import { fameScore, qualityScore } from '../lib/quality.js';
import { joinPlaceParts, summarize, tidyMaterial } from '../lib/text.js';

const ENDPOINT = 'https://query.wikidata.org/sparql';

/**
 * Root classes for the harvest. `P31/P279* wd:Q220659` ("archaeological
 * artifact") is the tightest filter that still yields ~20,000 illustrated items
 * with located findspots, and it excludes the fossils, meteorites and taxa that a
 * bare `P189` (findspot) query drags in. Sculpture is added because much ancient
 * statuary is not typed as an archaeological artifact.
 */
const ARTIFACT_CLASS = 'wd:Q220659';
const SCULPTURE_CLASS = 'wd:Q860861';

/**
 * Page size for the notability-ordered subquery.
 *
 * Kept deliberately small: the public endpoint enforces a 60-second limit, and a
 * 500-item page already takes ~40 s. Exceeding it returns a *truncated* JSON body
 * rather than an error, so an over-large page fails as a parse error.
 */
const PAGE_SIZE = 400;

/**
 * Two passes with different geographic semantics:
 *
 * - `P189` (location of discovery) is a findspot — the strongest signal there is.
 * - `P1071` (location of creation) is where the object was made, used only for
 *   items with no recorded findspot so the two never compete for one object.
 *
 * Wikidata deliberately keeps these separate; collapsing them would be exactly
 * the mistake of treating "excavated at Nimrud" and "made in Athens" as one fact.
 */
const PASSES: Array<{
  property: string;
  kind: OriginKind;
  classes: string[];
  requireNoFindspot: boolean;
}> = [
  {
    property: 'wdt:P189',
    kind: 'findspot',
    classes: [ARTIFACT_CLASS, SCULPTURE_CLASS],
    requireNoFindspot: false,
  },
  {
    property: 'wdt:P1071',
    kind: 'creation',
    classes: [ARTIFACT_CLASS],
    requireNoFindspot: true,
  },
];

/**
 * Builds the harvest query.
 *
 * Two structural choices matter:
 *
 * 1. **The inner subquery** bounds the expensive `P279*` class walk and orders by
 *    sitelink count, so paging returns the most recognisable objects first — which
 *    is also what the difficulty tiers need.
 * 2. **Aggregation.** Ten `OPTIONAL` patterns produce a cartesian product; the
 *    unaggregated form returned 12,000 rows for 950 objects and overran the
 *    endpoint's response limit. `GROUP BY ?item` collapses it to one row each.
 *    `rdfs:label` with an explicit language filter replaces `SERVICE
 *    wikibase:label`, which cannot be combined with aggregation.
 */
function buildQuery(
  property: string,
  klass: string,
  requireNoFindspot: boolean,
  limit: number,
  offset: number,
): string {
  const noFindspot = requireNoFindspot ? 'FILTER NOT EXISTS { ?item wdt:P189 ?fs }' : '';
  return `
SELECT ?item ?sitelinks
  (SAMPLE(?itemLbl) AS ?label) (SAMPLE(?itemDesc) AS ?description)
  (SAMPLE(?image) AS ?img) (SAMPLE(?inception) AS ?date) (SAMPLE(?article) AS ?wiki)
  (SAMPLE(?placeLbl) AS ?place) (SAMPLE(?coord) AS ?point) (SAMPLE(?countryLbl) AS ?country)
  (GROUP_CONCAT(DISTINCT ?placeTypeLbl; separator="|") AS ?placeTypes)
  (GROUP_CONCAT(DISTINCT ?materialLbl; separator="|") AS ?materials)
  (GROUP_CONCAT(DISTINCT ?typeLbl; separator="|") AS ?types)
  (SAMPLE(?cultureLbl) AS ?culture) (SAMPLE(?collectionLbl) AS ?collection)
WHERE {
  { SELECT ?item ?sitelinks WHERE {
      ?item wdt:P31/wdt:P279* ${klass} ; wdt:P18 ?anyImage ; ${property} ?anyPlace .
      ?anyPlace wdt:P625 ?anyCoord .
      ?item wikibase:sitelinks ?sitelinks .
      ${noFindspot}
    } ORDER BY DESC(?sitelinks) ?item LIMIT ${limit} OFFSET ${offset} }
  ?item wdt:P18 ?image ; ${property} ?place_ .
  ?place_ wdt:P625 ?coord .
  ?item rdfs:label ?itemLbl . FILTER(LANG(?itemLbl) = "en")
  ?place_ rdfs:label ?placeLbl . FILTER(LANG(?placeLbl) = "en")
  OPTIONAL { ?item schema:description ?itemDesc . FILTER(LANG(?itemDesc) = "en") }
  OPTIONAL { ?place_ wdt:P17/rdfs:label ?countryLbl . FILTER(LANG(?countryLbl) = "en") }
  OPTIONAL { ?place_ wdt:P31/rdfs:label ?placeTypeLbl . FILTER(LANG(?placeTypeLbl) = "en") }
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { ?item wdt:P2596/rdfs:label ?cultureLbl . FILTER(LANG(?cultureLbl) = "en") }
  OPTIONAL { ?item wdt:P186/rdfs:label ?materialLbl . FILTER(LANG(?materialLbl) = "en") }
  OPTIONAL { ?item wdt:P31/rdfs:label ?typeLbl . FILTER(LANG(?typeLbl) = "en") }
  OPTIONAL { ?item wdt:P195/rdfs:label ?collectionLbl . FILTER(LANG(?collectionLbl) = "en") }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
}
GROUP BY ?item ?sitelinks`;
}

interface SparqlBinding {
  [key: string]: { value: string; type: string; datatype?: string } | undefined;
}

/** `Point(12.105 42.0075)` → `{ lon: 12.105, lat: 42.0075 }` (WKT is lon-first). */
export function parseWkt(wkt: string): { lat: number; lon: number } | null {
  const match = /Point\(\s*(-?[\d.eE]+)\s+(-?[\d.eE]+)\s*\)/.exec(wkt);
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/**
 * Wikidata timestamps use an astronomical year: "-0599-01-01" means 599 BCE.
 * Years beyond ±9999 use additional digits.
 */
export function parseWikidataYear(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(-?)(\d{4,})-/.exec(value);
  if (!match) return null;
  const year = Number(match[2]);
  if (!Number.isFinite(year)) return null;
  return match[1] === '-' ? -year : year;
}

const TIER_ORDER: CoordTier[] = [
  'findspot',
  'site',
  'city',
  'subregion',
  'culture-region',
  'country',
];

/**
 * Wikidata gives a coordinate for the findspot *entity*, which may be anything
 * from a trench to a country. The entity's own `P31` values are the only
 * granularity signal available, so the most specific one decides the tier.
 */
export function tierFromPlaceTypes(placeTypes: string | undefined): CoordTier {
  const values = (placeTypes ?? '')
    .split('|')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (values.length === 0) return 'city';

  let best: CoordTier = 'country';
  for (const value of values) {
    const tier = classifyPlaceType(value);
    if (TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(best)) best = tier;
  }
  return best;
}

function classifyPlaceType(value: string): CoordTier {
  if (/^country$|sovereign state|island country/.test(value)) return 'country';
  if (
    /continent|subcontinent|cultural region|historical region|geographic(al)? region|ancient region/.test(
      value,
    )
  )
    return 'culture-region';
  if (
    /province|governorate|prefecture|region of|department of|county|district|oblast|state of|emirate/.test(
      value,
    )
  )
    return 'subregion';
  if (
    /tomb|grave|cave|shipwreck|necropolis|tumulus|barrow|hoard|quarry|mine|temple|sanctuary|excavation|burial/.test(
      value,
    )
  )
    return 'findspot';
  if (
    /archaeological site|ancient city|ruins|tell|settlement site|hillfort|oppidum|ghost town|former settlement/.test(
      value,
    )
  )
    return 'site';
  if (/city|town|village|municipality|commune|comune|human settlement|borough|hamlet/.test(value))
    return 'city';
  return 'site';
}

/** Commons `Special:FilePath` accepts a `width` parameter — use it for thumbs. */
function commonsImage(url: string, width: number): string {
  return `${url.replace(/^http:\/\//, 'https://')}?width=${width}`;
}

/**
 * Wikipedia lead paragraphs are the best educational text available for these
 * objects and, unlike museum catalogue prose, are written for a general reader.
 * Fetched once at build time and baked into the bundle, so the game never makes a
 * third-party request during play.
 */
async function fetchExtract(articleUrl: string): Promise<string | null> {
  const title = articleUrl.split('/wiki/').pop();
  if (!title) return null;
  try {
    const data = await fetchJson<{ extract?: string }>(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`,
    );
    return summarize(data.extract, 420);
  } catch {
    return null;
  }
}

async function runQuery(query: string, context: HarvestContext): Promise<SparqlBinding[]> {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  try {
    const data = await fetchJson<{ results?: { bindings?: SparqlBinding[] } }>(url, {
      headers: { Accept: 'application/sparql-results+json' },
      timeoutMs: 120_000,
    });
    return data.results?.bindings ?? [];
  } catch (error) {
    context.log(`  wikidata: query failed (${(error as Error).message})`);
    return [];
  }
}

/**
 * Decides whether the provider's own country claim can be trusted.
 *
 * Wikidata place entities disagree with themselves often enough to have produced
 * "Cyprus, United Kingdom", "Malta, Russia" and "Babylonia, Iran" — the coordinate
 * from `P625` on one entity, the country from `P17` on another. Two independent
 * guards, either of which is enough to reject:
 *
 * 1. **Geometry.** The coordinate must plausibly lie in the claimed country. This
 *    cannot run for countries whose territory spans oceans, and an unverifiable claim
 *    is not asserted — dropping a country from a label costs nothing, stating a wrong
 *    one is a factual error.
 * 2. **The label.** If the place's own name *is* a different country, the claim is
 *    self-contradictory regardless of geometry. That is what catches Cyprus/UK, where
 *    the geometric check abstains because the UK has overseas territory.
 */
function trustProviderCountry(
  placeLabel: string | null,
  country: string | null,
  point: { lat: number; lon: number },
): string | null {
  if (!country) return null;

  const compat = countryCompatible(point.lat, point.lon, country);
  if (compat.checked && !compat.ok) return null;

  const labelKey = normalizePlaceKey(placeLabel ?? '');
  const claimKey = normalizePlaceKey(country);
  const labelIsCountry = COUNTRY_ALIASES[labelKey] ?? labelKey;
  const claimIsCountry = COUNTRY_ALIASES[claimKey] ?? claimKey;
  if (labelIsCountry in COUNTRY_CENTROIDS && labelIsCountry !== claimIsCountry) return null;

  // Verified, or unverifiable-but-not-contradicted by a country-named label.
  return compat.checked ? country : null;
}

async function normalize(
  binding: SparqlBinding,
  kind: OriginKind,
  context: HarvestContext,
): Promise<Artifact | null> {
  const itemUri = binding.item?.value;
  const label = binding.label?.value?.trim();
  const image = binding.img?.value;
  const wkt = binding.point?.value;
  if (!itemUri || !label || !image || !wkt) return null;

  const qid = itemUri.split('/').pop()!;
  // An unlabelled item surfaces as its own Q-id; it has nothing to show a player.
  if (/^Q\d+$/.test(label)) return null;

  const providerPoint = parseWkt(wkt);
  if (!providerPoint) return null;

  const placeLabel = binding.place?.value?.trim() ?? null;
  const country = binding.country?.value?.trim() ?? null;
  const providerTier = tierFromPlaceTypes(binding.placeTypes?.value);

  // Prefer a curated or Pleiades resolution when it is at least as specific as
  // what the Wikidata place entity's own typing implies: those layers know that
  // "Thebes" is a site rather than a modern municipality.
  const resolved = placeLabel ? await context.gazetteer.resolve(placeLabel, { country }) : null;
  const useGazetteer =
    resolved !== null &&
    resolved.resolvedBy !== 'wikidata' &&
    TIER_ORDER.indexOf(resolved.tier) <= TIER_ORDER.indexOf(providerTier);

  /*
   * The label must describe whichever entity supplied the coordinate. When the
   * gazetteer wins, its own label is authoritative; when the provider's own P625 is
   * used, the provider's place label is. Mixing them produced labels such as
   * "Cyprus, United Kingdom" — the coordinate in Cyprus, the country from Wikidata's
   * P17 on a different entity.
   */
  /*
   * When the provider's own P625 is used, its P17 country is only trustworthy if the
   * coordinate actually falls there. Wikidata place entities disagree with themselves
   * often enough to have produced "Cyprus, United Kingdom", "Malta, Russia" and
   * "Babylonia, Iran" — coordinate from one field, country from another.
   */
  const trustedCountry = useGazetteer
    ? resolved!.country
    : trustProviderCountry(placeLabel, country, providerPoint);

  const originLabel = useGazetteer
    ? joinPlaceParts([resolved!.matchedLabel, resolved!.country])
    : joinPlaceParts([placeLabel, trustedCountry]);

  const origin = buildOrigin({
    lat: useGazetteer ? resolved!.lat : providerPoint.lat,
    lon: useGazetteer ? resolved!.lon : providerPoint.lon,
    label: originLabel || 'Unknown',
    country: trustedCountry,
    tier: useGazetteer ? resolved!.tier : providerTier,
    kind,
    resolvedBy: useGazetteer ? resolved!.resolvedBy : 'provider',
    resolvedId: useGazetteer ? resolved!.resolvedId : qid,
    precision: useGazetteer ? resolved!.precision : 'unknown',
    extentKm: useGazetteer ? (resolved!.extentKm ?? null) : null,
    provenance: {
      source: useGazetteer ? 'wikidata.place.gazetteer' : 'wikidata.P625',
      rawText: placeLabel ?? '',
      query: useGazetteer ? resolved!.query : (placeLabel ?? ''),
      matchType: useGazetteer ? resolved!.matchType : 'provider-coordinate',
      matchedLabel: useGazetteer ? resolved!.matchedLabel : (placeLabel ?? ''),
      matchedId: useGazetteer ? resolved!.resolvedId : qid,
      semanticType: useGazetteer ? resolved!.semanticType : (binding.placeTypes?.value ?? null),
      countryChecked: country,
      countryDistanceKm: null,
      reason:
        kind === 'findspot'
          ? 'Wikidata P189 location of discovery'
          : 'Wikidata P1071 location of creation',
    },
  });

  const article = binding.wiki?.value ?? null;
  const description = article
    ? ((await fetchExtract(article)) ?? summarize(binding.description?.value, 240))
    : summarize(binding.description?.value, 240);

  const year = parseWikidataYear(binding.date?.value);
  const types = (binding.types?.value ?? '').split('|').filter(Boolean);
  const sitelinks = Number(binding.sitelinks?.value ?? 0);

  const artifact: Artifact = {
    id: `wikidata:${qid}`,
    provider: 'wikidata',
    providerObjectId: qid,
    title: label,
    description,
    culture: binding.culture?.value?.trim() || null,
    period: null,
    yearStart: year,
    yearEnd: year,
    dateDisplay: null,
    material: tidyMaterial((binding.materials?.value ?? '').split('|').join(', ')),
    objectType: types[0] ?? null,
    origin,
    // Attached centrally by the ingest once the final origin is known, so the
    // implausible-drift check can compare the two. See lib/heartland.ts.
    heartland: null,
    discovery: kind === 'findspot' && placeLabel ? `Recorded findspot: ${placeLabel}` : null,
    heldBy: binding.collection?.value?.trim() || null,
    image: {
      url: commonsImage(image, 1200),
      /*
       * Commons renders thumbnails on demand and occasionally fails on a specific
       * width for very large source files; the original always exists.
       */
      alternates: [commonsImage(image, 800), image.replace(/^http:\/\//, 'https://')],
      verifiedAt: null,
      thumbUrl: commonsImage(image, 400),
      width: 1200,
      height: null,
      // Commons files are licensed individually; linking to the file page is the
      // only attribution we can honestly bake in without fetching every file's
      // rights metadata.
      license: 'See Wikimedia Commons file page',
      attribution: 'Wikimedia Commons',
    },
    metadataLicense: 'CC0 1.0',
    sourceUrl: article ?? `https://www.wikidata.org/wiki/${qid}`,
    accessionNumber: null,
    tags: types.slice(0, 4),
    quality: 0,
    fame: 0,
    lastSyncedAt: context.now,
  };

  artifact.quality = qualityScore(artifact);
  artifact.fame = fameScore({
    sitelinks,
    hasDescription: Boolean(description),
    title: artifact.title,
  });
  return artifact;
}

export const wikidataProvider: ProviderAdapter = {
  id: 'wikidata',
  name: 'Wikidata & Wikimedia Commons',
  url: 'https://www.wikidata.org/',
  metadataLicense: 'CC0 1.0 (Wikidata)',
  imageLicense: 'Per-file on Wikimedia Commons — see each image page',
  attribution: 'Wikidata contributors; images via Wikimedia Commons',

  async harvest(context: HarvestContext): Promise<Artifact[]> {
    const artifacts: Artifact[] = [];
    const seen = new Set<string>();

    const queryCount = PASSES.reduce((sum, pass) => sum + pass.classes.length, 0);
    const pagesPerQuery = Math.max(1, Math.round(context.limit / PAGE_SIZE / queryCount));

    for (const pass of PASSES) {
      for (const klass of pass.classes) {
        for (let page = 0; page < pagesPerQuery; page++) {
          const bindings = await runQuery(
            buildQuery(pass.property, klass, pass.requireNoFindspot, PAGE_SIZE, page * PAGE_SIZE),
            context,
          );
          if (bindings.length === 0) break;

          let kept = 0;
          for (const binding of bindings) {
            const qid = binding.item?.value?.split('/').pop();
            if (!qid || seen.has(qid)) continue;
            seen.add(qid);
            const artifact = await normalize(binding, pass.kind, context);
            if (artifact) {
              artifacts.push(artifact);
              kept++;
            }
          }
          context.log(
            `  wikidata ${pass.property} ${klass} page ${page + 1}/${pagesPerQuery}: ${bindings.length} rows → ${kept} kept`,
          );
        }
      }
    }

    return artifacts;
  },
};

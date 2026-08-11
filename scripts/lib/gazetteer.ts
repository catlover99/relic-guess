import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import type { CoordTier } from '../../src/data/schema.js';
import { fetchJson } from './http.js';
import { COUNTRY_ALIASES, COUNTRY_CENTROIDS, CURATED_PLACES } from './places.curated.js';

const GAZ_DIR = path.resolve(process.cwd(), '.cache/gazetteer');
const PLEIADES_PLACES_URL =
  'https://atlantides.org/downloads/pleiades/dumps/pleiades-places-latest.csv.gz';
const PLEIADES_NAMES_URL =
  'https://atlantides.org/downloads/pleiades/dumps/pleiades-names-latest.csv.gz';

export interface ResolvedPlace {
  lat: number;
  lon: number;
  tier: CoordTier;
  country: string | null;
  label: string;
  resolvedBy: 'pleiades' | 'wikidata' | 'curated' | 'culture';
  resolvedId: string | null;
  precision: 'precise' | 'rough' | 'unknown';
  /** How the match was made, for provenance and auditing. */
  matchType:
    'curated-exact' | 'pleiades-exact' | 'wikidata-exact' | 'culture-table' | 'country-fallback';
  /** The normalised string that was looked up. */
  query: string;
  /** The gazetteer record's own label, before any provider context is added. */
  matchedLabel: string;
  /** The gazetteer's description or feature typing, for auditing implausible types. */
  semanticType: string | null;
  /**
   * Measured extent of the place, when the gazetteer publishes one. Pleiades
   * ships a `bbox` per place, which is a far better uncertainty estimate than a
   * tier-wide default: Amarna's box is ~1.5 km across, Mesopotamia's is hundreds.
   */
  extentKm?: number | null;
}

/**
 * Lower-case, strip diacritics and punctuation, collapse whitespace.
 *
 * Hyphens and apostrophes survive because they are load-bearing in real place
 * names ("Deir el-Bahri", "Xi'an"), but a key containing no letters or digits at
 * all is punctuation debris and must not become a gazetteer lookup.
 */
export function normalizePlaceKey(input: string): string {
  const key = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /[a-z0-9]/.test(key) ? key : '';
}

/**
 * Descriptive terms that are not place names.
 *
 * These only mean something relative to a country ("the north coast" — of where?),
 * yet somewhere in the world a real settlement or district carries each as its
 * literal name or alias. They therefore pass an exact-match test and resolve to
 * nonsense: "North Coast" reached a Danish municipality for a Peruvian object, and
 * "Southwest" landed an Ancestral Pueblo vessel in Africa.
 *
 * A country hint cannot save these, because the providers that emit them (AIC) often
 * supply no country at all. They are rejected outright; the record then falls back to
 * its culture, which for both examples above gives the right answer.
 */
const GENERIC_PLACE_DESCRIPTORS = new Set([
  'north coast',
  'south coast',
  'east coast',
  'west coast',
  'northern coast',
  'southern coast',
  'coast',
  'coastal',
  'north',
  'south',
  'east',
  'west',
  'northeast',
  'northwest',
  'southeast',
  'southwest',
  'north-central',
  'central',
  'highlands',
  'lowlands',
  'interior',
  'northern highlands',
  'southern highlands',
  'central highlands',
  'north highlands',
  'unknown',
  'unidentified',
  'various places',
  'no place',
  'probably',
  'possibly',
]);

/** Whether a normalised query is too generic to resolve on its own. */
export function isGenericDescriptor(key: string): boolean {
  return GENERIC_PLACE_DESCRIPTORS.has(key);
}

/**
 * Splits a museum geography string into candidate place names, most specific
 * first. "Upper Egypt, Thebes, Deir el-Bahri" is stored by some providers as a
 * single comma-joined field, and the *last* element is usually the narrowest.
 */
export function candidateNames(raw: string): string[] {
  const parts = raw
    .split(/[,;|]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);
  // Most specific first, then the whole string as a fallback.
  const out = [...parts.reverse(), raw.trim()];
  return [...new Set(out.map((p) => p.replace(/^(probably|possibly|perhaps)\s+/i, '')))];
}

/* ------------------------------------------------------------------ *
 * Pleiades
 * ------------------------------------------------------------------ */

interface PleiadesEntry {
  id: string;
  lat: number;
  lon: number;
  title: string;
  precision: 'precise' | 'rough' | 'unknown';
  featureTypes: string;
  /** Half the bbox diagonal, in km: the radius that contains the place. */
  extentKm: number | null;
}

/**
 * Pleiades `bbox` is "minLon, minLat, maxLon, maxLat". Half the diagonal is the
 * radius of a circle containing the place, which is exactly the uncertainty the
 * scorer should forgive.
 */
function extentFromBbox(bbox: string): number | null {
  const parts = bbox.split(',').map((value) => Number(value.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const dLatKm = (maxLat - minLat) * 111.32;
  const dLonKm = (maxLon - minLon) * 111.32 * Math.cos(midLat);
  const diagonal = Math.hypot(dLatKm, dLonKm);
  return diagonal > 0 ? diagonal / 2 : null;
}

/**
 * Pleiades feature types mapped to our tiers. Anything not listed falls back to
 * `site`, which is the modal case for an archaeological gazetteer.
 */
function tierFromFeatureTypes(featureTypes: string): CoordTier {
  const types = featureTypes.toLowerCase();
  if (/region|people|province|kingdom|empire|island-group/.test(types)) return 'culture-region';
  if (/^\s*$/.test(types)) return 'site';
  if (/settlement-modern|urban/.test(types)) return 'city';
  if (
    /temple|tomb|villa|sanctuary|church|fort|amphitheatre|theatre|bath|cemetery|mine|quarry|production|find-spot|findspot|building/.test(
      types,
    )
  )
    return 'findspot';
  return 'site';
}

async function ensureFile(url: string, gzName: string, csvName: string): Promise<string> {
  await mkdir(GAZ_DIR, { recursive: true });
  const csvPath = path.join(GAZ_DIR, csvName);
  try {
    const info = await stat(csvPath);
    if (info.size > 0) return csvPath;
  } catch {
    // Not downloaded yet.
  }

  const gzPath = path.join(GAZ_DIR, gzName);
  console.log(`  downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download gazetteer: HTTP ${response.status}`);
  }
  await writeFile(gzPath, Buffer.from(await response.arrayBuffer()));
  await pipeline(createReadStream(gzPath), createGunzip(), createWriteStream(csvPath));
  return csvPath;
}

/**
 * Parses a coordinate column, treating blank as missing.
 *
 * `Number('')` is `0`, and `Number.isFinite(0)` is true, so a blank `reprLat` in
 * the Pleiades names dump silently produced the coordinate (0, 0) — an island in
 * the Gulf of Guinea. 285 records in the previous bundle resolved there.
 */
function parseCoordinate(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const text = raw.trim();
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Minimal RFC4180 CSV row parser — Pleiades quotes fields containing commas. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

async function* csvRows(file: string): AsyncGenerator<Record<string, string>> {
  const reader = createInterface({
    input: createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });
  let header: string[] | null = null;
  let buffer = '';
  for await (const line of reader) {
    // A quoted field may contain newlines; accumulate until quotes balance.
    buffer = buffer ? `${buffer}\n${line}` : line;
    const quoteCount = (buffer.match(/"/g) ?? []).length;
    if (quoteCount % 2 !== 0) continue;

    const cells = parseCsvLine(buffer);
    buffer = '';
    if (!header) {
      header = cells;
      continue;
    }
    const row: Record<string, string> = {};
    header.forEach((key, index) => {
      row[key] = cells[index] ?? '';
    });
    yield row;
  }
}

/**
 * Rough radius within which a coordinate may sit and still plausibly belong to a
 * given country. Generous on purpose — this is a sanity check against
 * cross-continental nonsense, not a border test.
 *
 * Large countries need a wider allowance, so the radius scales with the country's
 * own extent; everything else gets a flat 1,200 km.
 */
const WIDE_COUNTRIES: Record<string, number> = {
  russia: 5000,
  canada: 4000,
  china: 2600,
  brazil: 2600,
  australia: 2400,
  kazakhstan: 1600,
  india: 1800,
  argentina: 1800,
  indonesia: 2600,
  mexico: 1400,
  algeria: 1400,
  libya: 1400,
  sudan: 1400,
  iran: 1400,
  turkey: 1200,
};

/**
 * Countries a centroid cannot usefully model, because their territory spans oceans.
 *
 * Hawaii is 6,200 km from the contiguous United States' centroid and French Guiana
 * 7,000 km from central France — further than Berlin is from either. No single radius
 * separates "legitimately far-flung" from "wrong continent" for these, so rather than
 * tune a threshold until it looks right, the check declines to run and says so. The
 * caller then treats the country as unverified and does not assert it on the label.
 *
 * Every country here is compact enough elsewhere in the dataset that the loss is
 * negligible: the matches this guard exists to catch (Peru, Greece, Egypt, Iraq)
 * all involve countries that *are* well modelled by a centroid.
 */
const UNCONSTRAINABLE_COUNTRIES = new Set([
  'united states',
  'france',
  'netherlands',
  'united kingdom',
  'denmark',
  'norway',
  'portugal',
  'spain',
  'chile',
  'ecuador',
  'new zealand',
]);

/**
 * Radius for everything else.
 *
 * Deliberately loose. The check exists to reject a coordinate on the wrong
 * continent, not to test borders, and its failure mode must be conservative: at
 * worst it discards a usable record, never admits an impossible one.
 */
const DEFAULT_COUNTRY_RADIUS_KM = 1200;

const EARTH_RADIUS_KM = 6371.0088;

function greatCircleKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether a coordinate is compatible with a country the provider named.
 *
 * This is the guard that would have caught "North Coast" resolving to Gribskov
 * Municipality: the Met record said Peru, and Denmark is 10,000 km away. Wikidata
 * genuinely lists "North Coast" as an English alias of that Danish municipality, so
 * exact-match alone does not reject it — only the country check does.
 *
 * Returns `null` when there is no hint to check against, so callers can tell
 * "compatible" from "not checked".
 */
export function countryCompatible(
  lat: number,
  lon: number,
  countryHint: string | null | undefined,
): { checked: boolean; ok: boolean; distanceKm: number | null } {
  if (!countryHint) return { checked: false, ok: true, distanceKm: null };
  const key = normalizePlaceKey(countryHint);
  const canonical = COUNTRY_ALIASES[key] ?? key;
  const centroid = COUNTRY_CENTROIDS[canonical];
  // An unrecognised hint cannot constrain anything.
  if (!centroid) return { checked: false, ok: true, distanceKm: null };
  // Neither can a centroid for a country whose territory spans oceans.
  if (UNCONSTRAINABLE_COUNTRIES.has(canonical))
    return { checked: false, ok: true, distanceKm: null };

  const allowed = WIDE_COUNTRIES[canonical] ?? DEFAULT_COUNTRY_RADIUS_KM;
  const distanceKm = greatCircleKm(lat, lon, centroid.lat, centroid.lon);
  return { checked: true, ok: distanceKm <= allowed, distanceKm };
}

export class Gazetteer {
  /** normalized name -> best entry for that name */
  private pleiades = new Map<string, PleiadesEntry>();
  private wikidataCache = new Map<string, ResolvedPlace | null>();
  private wikidataCachePath = path.join(GAZ_DIR, 'wikidata-places.json');
  private wikidataDirty = false;

  async load(): Promise<void> {
    const placesCsv = await ensureFile(PLEIADES_PLACES_URL, 'pleiades.csv.gz', 'pleiades.csv');
    const namesCsv = await ensureFile(
      PLEIADES_NAMES_URL,
      'pleiades-names.csv.gz',
      'pleiades-names.csv',
    );

    for await (const row of csvRows(placesCsv)) {
      const lat = parseCoordinate(row.reprLat);
      const lon = parseCoordinate(row.reprLong);
      if (lat === null || lon === null) continue;
      if (!row.title) continue;
      const precision =
        row.locationPrecision === 'precise'
          ? 'precise'
          : row.locationPrecision === 'rough'
            ? 'rough'
            : 'unknown';
      const entry: PleiadesEntry = {
        id: row.id ?? '',
        lat,
        lon,
        title: row.title,
        precision,
        featureTypes: row.featureTypes ?? '',
        extentKm: row.bbox ? extentFromBbox(row.bbox) : null,
      };
      // Titles look like "Consabura/Consabrum" — index each variant.
      for (const variant of row.title.split('/')) {
        this.addPleiades(variant, entry);
      }
    }

    // Alternate/attested names give us "Nimrud" for "Kalhu" etc.
    for await (const row of csvRows(namesCsv)) {
      const lat = parseCoordinate(row.reprLat);
      const lon = parseCoordinate(row.reprLong);
      if (lat === null || lon === null) continue;
      const name = row.nameTransliterated || row.nameAttested || row.title;
      if (!name) continue;
      const entry: PleiadesEntry = {
        id: row.pid || row.id || '',
        lat,
        lon,
        title: name,
        precision: row.locationPrecision === 'precise' ? 'precise' : 'rough',
        featureTypes: '',
        extentKm: row.bbox ? extentFromBbox(row.bbox) : null,
      };
      for (const variant of name.split(/[,/]/)) this.addPleiades(variant, entry);
    }

    try {
      const raw = await readFile(this.wikidataCachePath, 'utf8');
      for (const [key, value] of Object.entries(JSON.parse(raw) as Record<string, ResolvedPlace>)) {
        this.wikidataCache.set(key, value);
      }
    } catch {
      // First run.
    }

    console.log(
      `  gazetteer ready: ${this.pleiades.size} Pleiades names, ${this.wikidataCache.size} cached Wikidata places`,
    );
  }

  private addPleiades(rawName: string, entry: PleiadesEntry) {
    const key = normalizePlaceKey(rawName);
    if (key.length < 3) return;
    const existing = this.pleiades.get(key);
    // Prefer precise coordinates, then richer feature typing.
    if (
      !existing ||
      (existing.precision !== 'precise' && entry.precision === 'precise') ||
      (existing.featureTypes === '' && entry.featureTypes !== '')
    ) {
      this.pleiades.set(key, entry);
    }
  }

  /**
   * Resolves a place string to coordinates.
   *
   * Order matters: curated entries win because they are the only layer that
   * knows "Thebes" means Egypt in an Egyptian-department record. Pleiades comes
   * next because it is purpose-built for ancient places. Wikidata is the global
   * fallback, and a country centroid is the floor.
   */
  async resolve(
    raw: string,
    hints: { country?: string | null } = {},
  ): Promise<ResolvedPlace | null> {
    for (const name of candidateNames(raw)) {
      const key = normalizePlaceKey(name);
      if (!key) continue;
      if (isGenericDescriptor(key)) continue;

      const curated = CURATED_PLACES[key];
      if (curated) {
        const compat = countryCompatible(curated.lat, curated.lon, hints.country);
        // A curated entry is hand-checked, so a country clash means the provider's
        // country contradicts it — skip and let a later candidate try.
        if (compat.checked && !compat.ok) continue;
        return {
          lat: curated.lat,
          lon: curated.lon,
          tier: curated.tier,
          country: curated.country,
          label: curated.label ?? titleCase(name),
          resolvedBy: 'curated',
          resolvedId: `curated:${key}`,
          precision: 'precise',
          matchType: 'curated-exact',
          query: key,
          matchedLabel: curated.label ?? titleCase(name),
          semanticType: curated.tier,
        };
      }

      const pleiades = this.pleiades.get(key);
      if (pleiades) {
        const compat = countryCompatible(pleiades.lat, pleiades.lon, hints.country);
        if (compat.checked && !compat.ok) continue;
        return {
          lat: pleiades.lat,
          lon: pleiades.lon,
          tier: tierFromFeatureTypes(pleiades.featureTypes),
          // Only claim the hinted country when the coordinate is actually
          // consistent with it. Copying the hint blindly produced labels such as
          // "Cyprus, United Kingdom".
          country: compat.checked && compat.ok ? (hints.country ?? null) : null,
          label: pleiades.title,
          resolvedBy: 'pleiades',
          resolvedId: `pleiades:${pleiades.id}`,
          precision: pleiades.precision,
          extentKm: pleiades.extentKm,
          matchType: 'pleiades-exact',
          query: key,
          matchedLabel: pleiades.title,
          semanticType: pleiades.featureTypes || null,
        };
      }
    }

    // Wikidata: one lookup per distinct string, cached to disk across runs.
    for (const name of candidateNames(raw).slice(0, 2)) {
      if (isGenericDescriptor(normalizePlaceKey(name))) continue;
      const resolved = await this.resolveViaWikidata(name, hints);
      if (resolved) return resolved;
    }

    return this.resolveCountry(hints.country ?? raw);
  }

  resolveCountry(raw: string | null): ResolvedPlace | null {
    if (!raw) return null;
    const key = normalizePlaceKey(raw);
    const canonical = COUNTRY_ALIASES[key] ?? key;
    const centroid = COUNTRY_CENTROIDS[canonical];
    if (!centroid) return null;
    return {
      lat: centroid.lat,
      lon: centroid.lon,
      tier: 'country',
      country: centroid.name,
      label: centroid.name,
      resolvedBy: 'curated',
      resolvedId: `country:${canonical}`,
      precision: 'unknown',
      matchType: 'country-fallback',
      query: key,
      matchedLabel: centroid.name,
      semanticType: 'country',
    };
  }

  /**
   * Wikidata fallback for places outside Pleiades' classical remit.
   *
   * `wbsearchentities` is a *search*, not a lookup: it returns prefix and alias
   * matches ranked by popularity. Accepting its first place-shaped hit produced the
   * worst errors in this project — "Attic" → **Attichy** (a commune in Oise) and
   * "North Coast" → **Gribskov Municipality** (Denmark, for a Peruvian object).
   *
   * Three constraints now apply, and a candidate must satisfy all of them:
   *
   * 1. **Exact match.** The text Wikidata actually matched (`match.text`, which may
   *    be a label or an alias) must normalise to exactly the query. This alone kills
   *    "Attic" → "Attichy", which was a prefix match.
   * 2. **Country compatibility.** If the provider named a country, the coordinate
   *    must plausibly lie in it. This is what kills "North Coast" → Denmark:
   *    Wikidata really does list "North Coast" as an English alias of that
   *    municipality, so the exact-match rule passes it and only geography rejects it.
   * 3. **Plausible semantic type.** The description must read like a settlement,
   *    region or archaeological site — not a band, a language, a river or a statue.
   *
   * All surviving candidates are then *scored* and the best is taken, rather than
   * the first. If nothing survives, this returns null: a dropped record is far
   * cheaper than a confidently wrong answer.
   */
  private async resolveViaWikidata(
    name: string,
    hints: { country?: string | null } = {},
  ): Promise<ResolvedPlace | null> {
    const key = normalizePlaceKey(name);
    if (key.length < 3) return null;

    // The country hint participates in the cache key: the same string can resolve
    // differently depending on which country constrains it.
    const cacheKey = `${key}|${normalizePlaceKey(hints.country ?? '')}`;
    if (this.wikidataCache.has(cacheKey)) return this.wikidataCache.get(cacheKey) ?? null;

    let result: ResolvedPlace | null = null;
    try {
      const search = await fetchJson<{
        search?: Array<{
          id: string;
          label?: string;
          description?: string;
          match?: { type?: string; text?: string };
        }>;
      }>(
        `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&uselang=en&type=item&limit=10&search=${encodeURIComponent(name)}`,
      );

      const scored = (search.search ?? [])
        .map((hit) => {
          const description = (hit.description ?? '').toLowerCase();
          const rank = rankPlaceCandidate(description);
          // Constraint 1: what Wikidata matched must *be* the query, not start with it.
          const matchedText = normalizePlaceKey(hit.match?.text ?? hit.label ?? '');
          const labelText = normalizePlaceKey(hit.label ?? '');
          const exact = matchedText === key || labelText === key;
          return { hit, description, rank, exact };
        })
        .filter((entry) => entry.rank > 0 && entry.exact)
        // Constraint 3 is folded into `rank`; higher is a better place type.
        .sort((a, b) => b.rank - a.rank);

      for (const { hit, description, rank } of scored) {
        const entity = await fetchJson<{
          entities?: Record<string, { claims?: Record<string, unknown[]> }>;
        }>(`https://www.wikidata.org/wiki/Special:EntityData/${hit.id}.json`);

        const claims = entity.entities?.[hit.id]?.claims as
          Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> | undefined;
        const coordClaim = claims?.P625?.[0]?.mainsnak?.datavalue?.value as
          { latitude?: number; longitude?: number } | undefined;
        if (
          !coordClaim ||
          !Number.isFinite(coordClaim.latitude) ||
          !Number.isFinite(coordClaim.longitude)
        )
          continue;

        const lat = coordClaim.latitude!;
        const lon = coordClaim.longitude!;

        // Constraint 2.
        const compat = countryCompatible(lat, lon, hints.country);
        if (compat.checked && !compat.ok) continue;

        result = {
          lat,
          lon,
          tier: inferTierFromDescription(description),
          country: compat.checked && compat.ok ? (hints.country ?? null) : null,
          label: hit.label ?? titleCase(name),
          resolvedBy: 'wikidata',
          resolvedId: hit.id,
          // Wikidata exposes a per-statement precision, but ~40% of these claim
          // sub-metre accuracy for whole archaeological sites, so it is not a
          // usable signal. Treat every Wikidata point as unknown precision.
          precision: 'unknown',
          extentKm: null,
          matchType: 'wikidata-exact',
          query: key,
          matchedLabel: hit.label ?? titleCase(name),
          semanticType: hit.description ?? null,
        };
        void rank;
        break;
      }
    } catch {
      result = null;
    }

    this.wikidataCache.set(cacheKey, result);
    this.wikidataDirty = true;
    return result;
  }

  async persist(): Promise<void> {
    if (!this.wikidataDirty) return;
    await mkdir(GAZ_DIR, { recursive: true });
    await writeFile(
      this.wikidataCachePath,
      JSON.stringify(Object.fromEntries(this.wikidataCache), null, 0),
    );
  }
}

/**
 * How place-like a Wikidata search hit is, from its one-line description.
 * 0 means "reject". Higher is a better match for an artifact's origin.
 */
function rankPlaceCandidate(rawDescription: string): number {
  const description = rawDescription.toLowerCase();
  if (!description) return 0;

  // Modern infrastructure and anything that is plainly not a place.
  if (
    /railway station|metro station|underground station|tram stop|bus station|airport|road|street|motorway|highway|bridge|tunnel|hotel|restaurant|shopping|stadium|school|university|hospital|company|business|band|album|song|film|book|novel|journal|genus|species|family of|surname|given name|footballer|politician|painter|writer|athlete|singer|actor|television|video game|software/.test(
      description,
    )
  ) {
    return 0;
  }

  if (
    /archaeological site|ancient city|ruins|necropolis|tell |excavation|ancient settlement/.test(
      description,
    )
  )
    return 6;
  if (/^ancient|historical region|ancient region|cultural region/.test(description)) return 5;
  if (/city|town|village|municipality|commune|comune|human settlement|settlement/.test(description))
    return 4;
  if (
    /province|governorate|prefecture|region|state of|department of|county|district|island/.test(
      description,
    )
  )
    return 3;
  if (/country|sovereign state/.test(description)) return 2;
  return 0;
}

function inferTierFromDescription(description: string): CoordTier {
  if (/archaeological site|ruins|excavation|tell |necropolis|tomb|temple/.test(description))
    return 'site';
  if (/region|province|state|prefecture|governorate|department/.test(description))
    return 'subregion';
  if (/country|sovereign state/.test(description)) return 'country';
  if (/city|town|village|municipality|settlement|commune/.test(description)) return 'city';
  return 'city';
}

function titleCase(input: string): string {
  return input.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

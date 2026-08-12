/**
 * Builds the guessing map from Natural Earth.
 *
 * The game does not use a tile provider. It needs country shapes, country names in
 * English and a handful of capitals — nothing a navigation basemap is designed
 * around — and every keyless raster provider fails at least one of those:
 *
 *   - OpenStreetMap standard tiles label places in the local language, so a player
 *     who cannot read Greek is shown "Ελλάδα".
 *   - Wikimedia's `osm-intl` style does translate, but its policy states the tiles
 *     "may only be embedded on wikis and sites hosted by Wikimedia Foundation or
 *     Wikimedia Affiliates".
 *   - Esri's keyless raster basemaps are legacy endpoints that Esri documents as
 *     removable without notice, with no clear commercial licence.
 *   - Vector tiles (OpenFreeMap and friends) solve language and clutter, but their
 *     planet tiles run 0.6–1.5 MB *each* at the zooms this game opens at.
 *
 * Natural Earth is public domain, ships `NAME_EN` plus cartographer-placed label
 * anchors, and contains no roads, shops or transit to strip out in the first place.
 * Baking it into one static file also means the map has no runtime third-party
 * dependency, no rate limit and no attribution obligation beyond a courtesy credit.
 *
 * Run with `npm run basemap`. Output: public/data/basemap.json.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const CACHE_DIR = path.resolve(process.cwd(), '.cache/basemap');
const OUTPUT = path.resolve(process.cwd(), 'public/data/basemap.json');

/**
 * Simplification tolerance in degrees, per dataset.
 *
 * 0.03° is roughly 3 km at the equator — under a pixel at the zooms this map
 * allows — and it removes three quarters of Natural Earth's vertices. Coordinates
 * are then quantised to three decimals (~110 m), finer than the stroke width.
 * Pushing to 0.05 saves another 60 KB but starts dropping small island states,
 * which a geography game cannot afford.
 */
const COUNTRY_TOLERANCE = 0.03;
const LAKE_TOLERANCE = 0.04;
const PRECISION = 3;

/** Lakes below this area (deg²) are dropped: they render as specks and cost bytes. */
const MIN_LAKE_AREA = 0.35;

type Position = [number, number];
type Ring = Position[];

interface GeoFeature {
  properties: Record<string, unknown>;
  geometry: {
    type: 'Polygon' | 'MultiPolygon' | string;
    coordinates: unknown;
  } | null;
}

interface GeoJson {
  features: GeoFeature[];
}

/** A country as the client needs it: shape, English name, label anchor. */
export interface BasemapCountry {
  /** English name, from Natural Earth's own NAME_EN field. */
  name: string;
  /** Polygon rings, outer rings only — holes are invisible at these zooms. */
  shapes: Ring[];
  /** Natural Earth's cartographer-placed label anchor: [lon, lat]. */
  label: Position;
  /** Lowest map zoom at which this label should appear. */
  minZoom: number;
  /** Highest map zoom at which this label should appear. */
  maxZoom: number;
  /** 1 (most prominent) to 10, used to break label collisions. */
  rank: number;
}

export interface BasemapCapital {
  name: string;
  /** [lon, lat] */
  at: Position;
  /** Lowest zoom at which the dot and name appear. */
  minZoom: number;
}

export interface Basemap {
  version: number;
  generatedAt: string;
  attribution: string;
  countries: BasemapCountry[];
  lakes: Ring[];
  capitals: BasemapCapital[];
}

async function load(name: string): Promise<GeoJson> {
  const file = path.join(CACHE_DIR, `${name}.geojson`);
  try {
    return JSON.parse(await readFile(file, 'utf8')) as GeoJson;
  } catch {
    // Cache miss — fetch once and keep it, so re-running is offline and instant.
  }
  const url = `${SOURCE_BASE}/${name}.geojson`;
  console.log(`  fetching ${name}…`);
  const response = await fetch(url, { headers: { 'User-Agent': 'relicguess-basemap/1.0' } });
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  const text = await response.text();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, text);
  return JSON.parse(text) as GeoJson;
}

/**
 * Ramer–Douglas–Peucker.
 *
 * Operates on raw degrees rather than projected metres: the distortion that
 * introduces near the poles only ever removes *more* detail from Antarctica and
 * northern Canada, which is exactly where it is least missed.
 */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 4) return ring;

  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, ring.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDistance = 0;
    let index = -1;
    const a = ring[first]!;
    const b = ring[last]!;

    for (let i = first + 1; i < last; i++) {
      const distance = perpendicularDistance(ring[i]!, a, b);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }

    if (index !== -1 && maxDistance > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return ring.filter((_, index) => keep[index] === 1);
}

function perpendicularDistance(point: Position, a: Position, b: Position): number {
  const [px, py] = point;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function quantise(ring: Ring): Ring {
  const factor = 10 ** PRECISION;
  const out: Ring = [];
  for (const [lon, lat] of ring) {
    const point: Position = [Math.round(lon * factor) / factor, Math.round(lat * factor) / factor];
    // Drop consecutive duplicates created by rounding.
    const previous = out[out.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) out.push(point);
  }
  return out;
}

/** Shoelace area in square degrees; used only to rank features by visual weight. */
function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j]![0] + ring[i]![0]) * (ring[j]![1] - ring[i]![1]);
  }
  return Math.abs(sum / 2);
}

/** Outer rings of a Polygon or MultiPolygon, simplified and quantised. */
function outerRings(geometry: GeoFeature['geometry'], tolerance: number): Ring[] {
  if (!geometry) return [];
  const polygons: Ring[][] =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as Ring[]]
      : geometry.type === 'MultiPolygon'
        ? (geometry.coordinates as Ring[][])
        : [];

  const rings: Ring[] = [];
  for (const polygon of polygons) {
    const outer = polygon[0];
    if (!outer) continue;
    const simplified = quantise(simplifyRing(outer, tolerance));
    // Fewer than four points cannot enclose an area once the ring is closed.
    if (simplified.length >= 4) rings.push(simplified);
  }
  return rings;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Label anchors need a sanity check.
 *
 * Natural Earth's LABEL_X/LABEL_Y are hand-placed and generally excellent, but a
 * few are null. Falling back to the centroid of the largest ring keeps every
 * country labelled somewhere inside itself.
 */
function labelAnchor(properties: Record<string, unknown>, shapes: Ring[]): Position | null {
  const x = properties.LABEL_X;
  const y = properties.LABEL_Y;
  if (typeof x === 'number' && typeof y === 'number') return [x, y];

  let largest: Ring | null = null;
  let largestArea = 0;
  for (const ring of shapes) {
    const area = ringArea(ring);
    if (area > largestArea) {
      largestArea = area;
      largest = ring;
    }
  }
  if (!largest) return null;

  const sum = largest.reduce<Position>((acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat], [0, 0]);
  return [sum[0] / largest.length, sum[1] / largest.length];
}

export async function buildBasemap(): Promise<Basemap> {
  console.log('Building basemap from Natural Earth…');

  const [countryData, lakeData, placeData] = await Promise.all([
    load('ne_50m_admin_0_countries'),
    load('ne_50m_lakes'),
    load('ne_50m_populated_places_simple'),
  ]);

  const countries: BasemapCountry[] = [];
  for (const feature of countryData.features) {
    const properties = feature.properties;
    const name = typeof properties.NAME_EN === 'string' ? properties.NAME_EN : null;
    if (!name) continue;

    const shapes = outerRings(feature.geometry, COUNTRY_TOLERANCE);
    if (shapes.length === 0) continue;

    const label = labelAnchor(properties, shapes);
    if (!label) continue;

    countries.push({
      name,
      shapes,
      label,
      /*
       * Natural Earth ships its own guidance on when a country is worth naming
       * (MIN_LABEL/MAX_LABEL, in web-mercator-ish zooms). Using it rather than a
       * rule of our own is what keeps the map from labelling Vatican City at
       * world view and dropping Brazil when zoomed in.
       */
      minZoom: numberOr(properties.MIN_LABEL, 3),
      maxZoom: numberOr(properties.MAX_LABEL, 10),
      rank: numberOr(properties.LABELRANK, 5),
    });
  }

  const lakes: Ring[] = [];
  for (const feature of lakeData.features) {
    for (const ring of outerRings(feature.geometry, LAKE_TOLERANCE)) {
      if (ringArea(ring) >= MIN_LAKE_AREA) lakes.push(ring);
    }
  }

  const capitals: BasemapCapital[] = [];
  for (const feature of placeData.features) {
    const properties = feature.properties;
    // National capitals only. Every other class is exactly the kind of clutter
    // this map exists to avoid.
    if (properties.featurecla !== 'Admin-0 capital') continue;
    const name =
      typeof properties.nameascii === 'string' && properties.nameascii.length > 0
        ? properties.nameascii
        : typeof properties.name === 'string'
          ? properties.name
          : null;
    const lat = properties.latitude;
    const lon = properties.longitude;
    if (!name || typeof lat !== 'number' || typeof lon !== 'number') continue;

    const factor = 10 ** PRECISION;
    capitals.push({
      name,
      at: [Math.round(lon * factor) / factor, Math.round(lat * factor) / factor],
      // Capitals are context, not answers: they stay out of the way until the
      // player has zoomed past continent level.
      minZoom: Math.max(4, numberOr(properties.min_zoom, 4)),
    });
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    attribution: 'Natural Earth',
    countries,
    lakes,
    capitals,
  };
}

async function main(): Promise<void> {
  const basemap = await buildBasemap();
  const json = JSON.stringify(basemap);
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, json);

  const vertices = basemap.countries.reduce(
    (sum, country) => sum + country.shapes.reduce((n, ring) => n + ring.length, 0),
    0,
  );
  console.log(
    `\nWrote ${OUTPUT}\n` +
      `  ${basemap.countries.length} countries (${vertices.toLocaleString()} vertices)\n` +
      `  ${basemap.lakes.length} lakes, ${basemap.capitals.length} capitals\n` +
      `  ${(json.length / 1024).toFixed(0)} KB`,
  );
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

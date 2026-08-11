import type { GeoPoint } from '@/data/schema';

/** Mean Earth radius (km), IUGG. */
const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Great-circle distance in km.
 *
 * Uses haversine, which is numerically stable for the small distances that
 * matter most for scoring (the law-of-cosines form loses precision below ~1km).
 */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Initial bearing from `a` to `b` in degrees clockwise from north.
 * Used to label the reveal line ("your guess was 1,240 km NW").
 */
export function bearingDeg(a: GeoPoint, b: GeoPoint): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export function compassDirection(a: GeoPoint, b: GeoPoint): string {
  const index = Math.round(bearingDeg(a, b) / 45) % 8;
  return COMPASS[index] ?? 'N';
}

/**
 * Samples a great-circle path, split into segments that never cross the
 * antimeridian.
 *
 * Leaflet draws a polyline in projected space, so a path from Japan to
 * California rendered as one array of points streaks backwards across the whole
 * map. Splitting on the ±180° crossing keeps the line following the shortest
 * real-world route.
 */
export function greatCircleSegments(a: GeoPoint, b: GeoPoint, samples = 96): GeoPoint[][] {
  const lat1 = toRad(a.lat);
  const lon1 = toRad(a.lon);
  const lat2 = toRad(b.lat);
  const lon2 = toRad(b.lon);

  const d =
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin((lat2 - lat1) / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
        ),
      ),
    );

  if (d < 1e-9) return [[a, b]];

  const points: GeoPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const f = i / samples;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    points.push({
      lat: toDeg(Math.atan2(z, Math.hypot(x, y))),
      lon: toDeg(Math.atan2(y, x)),
    });
  }

  const segments: GeoPoint[][] = [];
  let current: GeoPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[i - 1];
    if (prev && Math.abs(p.lon - prev.lon) > 180) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length > 1) segments.push(current);
  return segments.length > 0 ? segments : [[a, b]];
}

/** Point halfway along the great circle — where the distance label is anchored. */
export function midpoint(a: GeoPoint, b: GeoPoint): GeoPoint {
  const segments = greatCircleSegments(a, b, 2);
  const flat = segments.flat();
  return flat[Math.floor(flat.length / 2)] ?? a;
}

/** "1,240 km" / "820 m" / "12,400 km" — locale-aware, no false precision. */
export function formatDistance(km: number, locale?: string): string {
  if (km < 1) return `${Math.round(km * 1000).toLocaleString(locale)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString(locale)} km`;
}

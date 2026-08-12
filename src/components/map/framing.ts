/**
 * Reveal framing arithmetic.
 *
 * Pure and Leaflet-free so the policy can be tested without a browser: how much
 * padding a container can spare, how far a scored region extends, and whether the
 * region is worth framing at all.
 */

/** Never frame a reveal below this zoom — see `shouldFrameRegion`. */
export const REVEAL_MIN_ZOOM = 3;

/** Padding may never claim more than this share of an axis. */
export const MAX_PADDING_SHARE = 0.55;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Shrinks a padding request until the map keeps a usable middle.
 *
 * On a 360px phone the map is ~250px tall and the answer panel already claims 76px
 * of it; adding a fixed 48/64px margin left under 50px to fit two markers into, and
 * Leaflet responded by placing the scored region off-screen entirely. Each axis is
 * capped and scaled proportionally, so the asymmetry that keeps a marker clear of
 * the action bar survives even when the request has to be halved.
 */
export function clampPadding(request: Insets, width: number, height: number): Insets {
  const scaleAxis = (a: number, b: number, extent: number): [number, number] => {
    const budget = Math.max(0, extent) * MAX_PADDING_SHARE;
    const total = a + b;
    if (total <= budget || total === 0) return [a, b];
    const factor = budget / total;
    return [a * factor, b * factor];
  };

  const [left, right] = scaleAxis(request.left, request.right, width);
  const [top, bottom] = scaleAxis(request.top, request.bottom, height);
  return { left, right, top, bottom };
}

/**
 * How far a scored region reaches, in degrees.
 *
 * Longitude degrees shrink towards the poles, so the east–west extent is divided by
 * cos(latitude); without that a high-latitude region would be framed far too
 * tightly. Clamped near the poles, where the division explodes.
 */
export function regionSpan(lat: number, radiusKm: number): { latDelta: number; lonDelta: number } {
  const latDelta = radiusKm / 111.19;
  const cos = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  return { latDelta, lonDelta: Math.min(60, latDelta / cos) };
}

/**
 * Whether to frame the whole scored region, or only the markers.
 *
 * Fitting a 380 km radius on a phone can force zoom 1, where both markers are
 * specks and the basemap labels drop out. When that happens the markers win and
 * the circle simply extends past the viewport — which still reads as "this region
 * is larger than the screen".
 *
 * A guess on the far side of the world is a different matter: the *points* need a
 * world view, and no framing policy can fix that.
 */
export function shouldFrameRegion(zoomWithRegion: number, zoomWithPointsOnly: number): boolean {
  if (zoomWithRegion >= REVEAL_MIN_ZOOM) return true;
  // Including the region costs nothing if the markers alone are just as wide.
  return zoomWithRegion >= zoomWithPointsOnly;
}

import L from 'leaflet';

/**
 * Map markers.
 *
 * The player's guess and the true origin must be distinguishable without
 * relying on colour, so each differs along three axes:
 *
 * | role   | shape          | fill              | glyph |
 * |--------|----------------|-------------------|-------|
 * | guess  | teardrop pin   | hollow, dashed    | "?"   |
 * | origin | flag on a post | solid             | trowel|
 *
 * They are `divIcon`s containing inline SVG rather than image files: the shapes
 * then inherit theme tokens via `currentColor`, need no network request, and
 * cannot break the way the previous implementation's hotlinked images could.
 */

const GUESS_SIZE: [number, number] = [40, 50];
const ORIGIN_SIZE: [number, number] = [42, 52];

const guessSvg = `
<svg viewBox="0 0 40 50" width="40" height="50" class="marker-pin" aria-hidden="true">
  <path d="M20 49C20 49 35 30.5 35 19.5C35 10.94 28.28 4 20 4S5 10.94 5 19.5C5 30.5 20 49 20 49Z"
        fill="var(--surface)" stroke="currentColor" stroke-width="3" stroke-dasharray="5 3.5"/>
  <text x="20" y="26" text-anchor="middle" font-size="17" font-weight="700"
        font-family="Georgia, serif" fill="currentColor">?</text>
</svg>`;

const originSvg = `
<svg viewBox="0 0 42 52" width="42" height="52" class="marker-pin" aria-hidden="true">
  <!-- post -->
  <rect x="19" y="20" width="4" height="30" rx="2" fill="currentColor"/>
  <!-- pennant -->
  <path d="M21 3H38L32 11.5L38 20H21Z" fill="currentColor"/>
  <!-- trowel glyph on the pennant -->
  <path d="M26.4 8.2h4.4l-2.2 6.4-2.2-6.4Z" fill="var(--surface)"/>
  <rect x="27.8" y="6.1" width="1.6" height="2.6" rx="0.8" fill="var(--surface)"/>
  <!-- ground -->
  <ellipse cx="21" cy="50" rx="7" ry="2.2" fill="currentColor" opacity="0.35"/>
</svg>`;

export function createGuessIcon(draggable: boolean): L.DivIcon {
  return L.divIcon({
    className: `marker-root marker-guess${draggable ? ' is-draggable' : ''}`,
    html: guessSvg,
    iconSize: GUESS_SIZE,
    // Anchor at the point of the pin so it indicates an exact coordinate.
    iconAnchor: [GUESS_SIZE[0] / 2, GUESS_SIZE[1]],
  });
}

export function createOriginIcon(): L.DivIcon {
  return L.divIcon({
    className: 'marker-root marker-origin',
    html: `<span class="marker-halo"></span>${originSvg}`,
    iconSize: ORIGIN_SIZE,
    // The flagpole's foot is the coordinate.
    iconAnchor: [21, ORIGIN_SIZE[1] - 2],
  });
}

/**
 * A ring showing the origin's uncertainty radius.
 *
 * Drawn only for coarse coordinates: it is the visual counterpart of the scoring
 * tolerance, and it is honest about the fact that "somewhere in Mesopotamia" is
 * not a pin.
 */
export function uncertaintyCircleOptions(): L.CircleMarkerOptions {
  return {
    color: 'var(--origin)',
    weight: 1.5,
    opacity: 0.55,
    fillColor: 'var(--origin)',
    fillOpacity: 0.08,
    dashArray: '4 5',
    interactive: false,
  };
}

/** Below this radius the ring is smaller than the marker and just adds noise. */
export const MIN_UNCERTAINTY_RING_KM = 80;

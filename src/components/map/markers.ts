import L from 'leaflet';

/**
 * Map markers.
 *
 * The player's guess and the true origin must be distinguishable without
 * relying on colour, so each differs along three axes:
 *
 * | role      | shape          | fill              | glyph  |
 * |-----------|----------------|-------------------|--------|
 * | guess     | teardrop pin   | hollow, dashed    | "?"    |
 * | region    | flag on a post | solid             | trowel |
 * | discovery | square stake   | solid, notched    | spade  |
 *
 * The third one matters as much as the first two. A revealed Heartland round shows
 * where the player guessed, the region the guess was graded against, and — when the
 * museum records one — where the object itself was actually dug up. Those are three
 * different claims, so they get three different silhouettes rather than three
 * colours: colour alone would fail for a red-green colour-blind player and vanish
 * entirely in forced-colors mode.
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

const DISCOVERY_SIZE: [number, number] = [34, 42];

/**
 * The object's own findspot.
 *
 * A surveyor's stake rather than a pin: squared off, planted in the ground, with a
 * spade blade on the marker board. It reads as "something was excavated here"
 * rather than as an answer, which is the point — this marker never affects the
 * score.
 */
const discoverySvg = `
<svg viewBox="0 0 34 42" width="34" height="42" class="marker-pin" aria-hidden="true">
  <!-- stake -->
  <rect x="15" y="16" width="3.2" height="24" rx="1.4" fill="currentColor"/>
  <!-- notched board -->
  <path d="M3 2h28v14H3l4-7Z" fill="currentColor"/>
  <!-- spade blade, knocked out of the board -->
  <path d="M17 5.4c2.6 2.2 4 3.7 4 5.2a2.6 2.6 0 0 1-2.8 2.5h-2.4A2.6 2.6 0 0 1 13 10.6c0-1.5 1.4-3 4-5.2Z"
        fill="var(--surface)"/>
  <rect x="16.2" y="11.6" width="1.6" height="2.6" rx="0.6" fill="var(--surface)"/>
  <!-- ground -->
  <ellipse cx="16.6" cy="40" rx="6" ry="1.9" fill="currentColor" opacity="0.35"/>
</svg>`;

export function createDiscoveryIcon(): L.DivIcon {
  return L.divIcon({
    className: 'marker-root marker-discovery',
    html: discoverySvg,
    iconSize: DISCOVERY_SIZE,
    // The foot of the stake is the coordinate.
    iconAnchor: [16.6, DISCOVERY_SIZE[1] - 2],
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
 * The region a guess was graded against.
 *
 * Always drawn on a Heartland or Daily reveal, including when the object has an
 * exact findspot, because the radius *is* the scoring rule: everything inside it
 * scored as if it were on the spot. Hiding it whenever a precise coordinate
 * existed left the most forgiving mode looking arbitrary.
 */
export function uncertaintyCircleOptions(): L.CircleMarkerOptions {
  return {
    // Named so the stylesheet and the reveal tests can both refer to it, rather
    // than identifying it as "the path without a class".
    className: 'reveal-region',
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

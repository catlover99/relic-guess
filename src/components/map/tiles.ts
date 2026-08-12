/**
 * Basemap configuration.
 *
 * The map no longer talks to a tile server. Country shapes, English names and
 * capitals are baked into `public/data/basemap.json` from Natural Earth at build
 * time — see scripts/basemap.ts for the full reasoning, and atlas.ts for the
 * rendering. Three consequences worth knowing here:
 *
 *   - There is no tile-usage policy to comply with, no `Referer` requirement and
 *     no rate limit, so the app no longer depends on a donation-funded service.
 *   - Attribution is a courtesy rather than an obligation: Natural Earth is public
 *     domain. It is shown anyway, because crediting the cartographers is right.
 *   - Dark mode needs no filter hack. The basemap is vector geometry and DOM text
 *     styled from CSS custom properties, so it themes like the rest of the app.
 */
export const ATLAS_ATTRIBUTION =
  'Map data <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a>';

/**
 * Zoom bounds.
 *
 * The lower bound keeps the whole world reachable; the upper one is deliberately
 * modest. This is a game about regions and cultural heartlands, not about hunting
 * for a labelled village, and the basemap is generalised to about 3 km — past
 * zoom 8 that generalisation would start to show.
 */
/*
 * Zoom 0 puts the entire world in 256px.
 *
 * It looks extreme on a desktop, but a 390px phone at zoom 1 shows only three
 * quarters of the world at once — so a reveal with the guess and the scored region
 * on opposite sides of the globe could not frame both, and a player could not see
 * the whole map to place a guess on in the first place.
 */
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 8;

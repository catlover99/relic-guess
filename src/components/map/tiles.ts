/**
 * Basemap configuration.
 *
 * The default is the OpenStreetMap Foundation's standard tile layer. That choice
 * is about permission, not aesthetics: OSMF publishes an explicit Tile Usage
 * Policy that a free public web app can comply with, whereas CARTO's basemaps
 * document no free tier at all (their only relevant statement is that commercial
 * use requires an Enterprise licence) and Stadia's free plan forbids commercial
 * use and needs a registered domain. Relying on undocumented tolerance is not a
 * dependency worth taking.
 *
 * Complying with the OSMF policy imposes three requirements this app meets:
 *
 * 1. Visible attribution linking to openstreetmap.org/copyright (rendered by
 *    Leaflet's attribution control).
 * 2. A real `Referer` header — so the app must not set a restrictive
 *    `Referrer-Policy`. See index.html.
 * 3. No bulk prefetching or offline caching of tiles.
 *
 * To move to a keyed provider, set these at build time; nothing else changes:
 *   VITE_TILE_URL_LIGHT, VITE_TILE_URL_DARK, VITE_TILE_ATTRIBUTION, VITE_TILE_SUBDOMAINS
 */
const OSM_STANDARD = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/**
 * Required by the OSMF Attribution Guidelines. "© OpenStreetMap contributors"
 * with the text linking to the copyright page is one of the forms they list as
 * acceptable.
 */
export const TILE_ATTRIBUTION =
  import.meta.env.VITE_TILE_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

export function tileUrl(theme: 'light' | 'dark'): string {
  const light = import.meta.env.VITE_TILE_URL_LIGHT ?? OSM_STANDARD;
  // OSM publishes no dark style. Rather than pull in a second provider, the dark
  // theme reuses the same tiles and adjusts them with a CSS filter — see
  // `.leaflet-tile-pane` in styles/index.css. The URL is still overridable so a
  // deployment with a keyed dark style can use it.
  return theme === 'dark' ? (import.meta.env.VITE_TILE_URL_DARK ?? light) : light;
}

/**
 * Whether the active dark URL is just the light one, in which case the CSS
 * filter should be applied. A provider-supplied dark style must not be filtered.
 */
export const DARK_NEEDS_FILTER = !import.meta.env.VITE_TILE_URL_DARK;

/**
 * Subdomain rotation is deliberately empty for OSM: their policy names the
 * single `tile.openstreetmap.org` host, and the `{s}` placeholder pattern is
 * discouraged for it.
 */
export const TILE_SUBDOMAINS = import.meta.env.VITE_TILE_SUBDOMAINS ?? 'abc';

/**
 * Zoom bounds. 9 is enough to place a site confidently without inviting the
 * player to hunt for a labelled village name, and it keeps tile counts (and
 * therefore load on a donation-funded service) modest.
 */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 9;

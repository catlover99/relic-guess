import L from 'leaflet';

/**
 * The guessing basemap.
 *
 * Drawn from `public/data/basemap.json` (Natural Earth, public domain) rather than
 * fetched from a tile server. See scripts/basemap.ts for why no keyless tile
 * provider works for this game; the short version is that they label places in the
 * local language and fill the map with restaurants.
 *
 * What that buys, beyond English names:
 *
 * - **Clutter is impossible, not filtered.** The data contains countries, lakes and
 *   national capitals. There is no road, shop or transit stop to hide.
 * - **Label size is ours.** A raster tile bakes 11px text into the image; here the
 *   labels are DOM elements, so they can be bigger on a phone and stay crisp at
 *   any device pixel ratio.
 * - **No third-party runtime dependency**, rate limit, or tile-policy compliance
 *   burden, and the map works offline once the file is cached.
 *
 * Geometry goes through Leaflet's own canvas renderer, and labels are `divIcon`
 * markers, so nothing here reimplements Leaflet's pan/zoom bookkeeping.
 */

export interface AtlasCountry {
  name: string;
  shapes: Array<Array<[number, number]>>;
  label: [number, number];
  minZoom: number;
  maxZoom: number;
  rank: number;
}

export interface AtlasCapital {
  name: string;
  at: [number, number];
  minZoom: number;
}

export interface AtlasData {
  version: number;
  attribution: string;
  countries: AtlasCountry[];
  lakes: Array<Array<[number, number]>>;
  capitals: AtlasCapital[];
}

let cached: Promise<AtlasData> | null = null;

/** Loads the basemap once per tab. */
export function loadAtlas(): Promise<AtlasData> {
  cached ??= fetch(`${import.meta.env.BASE_URL}data/basemap.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`basemap ${response.status}`);
      return response.json() as Promise<AtlasData>;
    })
    .catch((error: unknown) => {
      // Reset so a transient failure can be retried by the next round.
      cached = null;
      throw error;
    });
  return cached;
}

/** Test seam: lets unit tests supply data without a network. */
export function __setAtlasForTests(data: AtlasData | null): void {
  cached = data ? Promise.resolve(data) : null;
}

/**
 * Label sizing.
 *
 * The complaint that started this was that country names were unreadable on a
 * phone *even after zooming in*, because OSM's raster tiles bake ~11px text into
 * an image that `detectRetina` then draws at half scale. These are real text at
 * real sizes, and the phone gets the larger one — a 360px-wide screen is held
 * closer but has far less room, so shrinking type there is exactly backwards.
 */
const COUNTRY_FONT_PX = { compact: 15, wide: 13 };
const CAPITAL_FONT_PX = { compact: 12, wide: 11 };

/**
 * Rough width of a label in px, for collision testing.
 *
 * 0.62em average advance for the display face, plus a little breathing room. It
 * only has to be good enough to reject overlaps; measuring text properly would
 * mean a layout pass per label per pan.
 */
function labelWidth(text: string, fontPx: number): number {
  return text.length * fontPx * 0.62 + 6;
}

interface PlacedLabel {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function overlaps(a: PlacedLabel, b: PlacedLabel): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

/**
 * Palette, resolved from CSS custom properties.
 *
 * Leaflet's canvas renderer paints with the values in the path options and never
 * consults the stylesheet — `className` only does anything under the SVG
 * renderer. Canvas is the right choice here (roughly 600 rings would make a heavy
 * SVG tree on a phone), so the tokens are read once and re-read when the theme
 * changes, which keeps map.css the single source of truth for colour.
 */
export interface AtlasPalette {
  land: string;
  border: string;
  lake: string;
}

function readPalette(container: HTMLElement): AtlasPalette {
  const styles = getComputedStyle(container);
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    land: token('--atlas-land', '#f2ece1'),
    border: token('--atlas-border', '#a9a294'),
    lake: token('--atlas-lake', '#cfe0ea'),
  };
}

/**
 * Adds the basemap to a map and returns a handle for updating and removing it.
 *
 * Geometry is added once. Labels are recomputed on every `moveend`/`zoomend`,
 * because which names fit depends on where the viewport is.
 */
export function createAtlas(
  map: L.Map,
  data: AtlasData,
  options: { compact: boolean },
): {
  layer: L.LayerGroup;
  refreshLabels: () => void;
  restyle: () => void;
  destroy: () => void;
} {
  const renderer = L.canvas({ padding: 0.5 });
  const geometry = L.layerGroup();
  const labels = L.layerGroup();
  const group = L.layerGroup([geometry, labels]);
  const countries: L.Polygon[] = [];
  const lakes: L.Polygon[] = [];

  const base: L.PathOptions = {
    renderer,
    stroke: true,
    weight: 1,
    fill: true,
    fillOpacity: 1,
    interactive: false,
  };

  for (const country of data.countries) {
    for (const ring of country.shapes) {
      countries.push(
        L.polygon(
          ring.map(([lon, lat]) => [lat, lon] as L.LatLngTuple),
          base,
        ).addTo(geometry),
      );
    }
  }

  for (const ring of data.lakes) {
    lakes.push(
      L.polygon(
        ring.map(([lon, lat]) => [lat, lon] as L.LatLngTuple),
        base,
      ).addTo(geometry),
    );
  }

  function restyle(): void {
    const palette = readPalette(map.getContainer());
    for (const polygon of countries) {
      polygon.setStyle({ fillColor: palette.land, color: palette.border });
    }
    for (const polygon of lakes) {
      polygon.setStyle({ fillColor: palette.lake, color: palette.border, opacity: 0.5 });
    }
  }

  const countryFont = options.compact ? COUNTRY_FONT_PX.compact : COUNTRY_FONT_PX.wide;
  const capitalFont = options.compact ? CAPITAL_FONT_PX.compact : CAPITAL_FONT_PX.wide;

  /*
   * Published to CSS rather than duplicated there.
   *
   * The stylesheet used to pick the size with its own media query while this code
   * used the `compact` prop, and the two disagreed in landscape — labels rendered
   * at 15px while collisions were computed for 13px, so names overlapped. One
   * source, no drift.
   */
  const container = map.getContainer();
  container.style.setProperty('--atlas-label-size', `${countryFont}px`);
  container.style.setProperty('--atlas-capital-size', `${capitalFont}px`);

  function refreshLabels(): void {
    labels.clearLayers();
    const zoom = map.getZoom();
    const bounds = map.getBounds().pad(0.1);
    const placed: PlacedLabel[] = [];

    /*
     * Natural Earth's own MIN_LABEL/MAX_LABEL decide *whether* a country is worth
     * naming at a given zoom; the collision pass below decides whether it fits.
     * Sorting by rank first means that when Belgium and France compete for the
     * same pixels, France wins.
     */
    const candidates = data.countries
      .filter((country) => zoom >= country.minZoom - 1 && zoom <= country.maxZoom + 2)
      .filter((country) => bounds.contains(L.latLng(country.label[1], country.label[0])))
      .sort((a, b) => a.rank - b.rank);

    for (const country of candidates) {
      const point = map.latLngToContainerPoint([country.label[1], country.label[0]]);
      const halfWidth = labelWidth(country.name, countryFont) / 2;
      const box: PlacedLabel = {
        left: point.x - halfWidth,
        right: point.x + halfWidth,
        top: point.y - countryFont * 0.7,
        bottom: point.y + countryFont * 0.7,
      };
      if (placed.some((other) => overlaps(box, other))) continue;
      placed.push(box);

      L.marker([country.label[1], country.label[0]], {
        icon: L.divIcon({
          className: 'atlas-label-icon',
          html: `<span class="atlas-country-label">${escapeHtml(country.name)}</span>`,
          iconSize: [0, 0],
        }),
        interactive: false,
        keyboard: false,
        // Below the guess and origin markers, which sit at 400+.
        zIndexOffset: -1000,
      }).addTo(labels);
    }

    for (const capital of data.capitals) {
      if (zoom < capital.minZoom) continue;
      if (!bounds.contains(L.latLng(capital.at[1], capital.at[0]))) continue;

      const point = map.latLngToContainerPoint([capital.at[1], capital.at[0]]);
      const box: PlacedLabel = {
        left: point.x - 4,
        right: point.x + labelWidth(capital.name, capitalFont) + 10,
        top: point.y - capitalFont,
        bottom: point.y + capitalFont,
      };
      if (placed.some((other) => overlaps(box, other))) continue;
      placed.push(box);

      L.marker([capital.at[1], capital.at[0]], {
        icon: L.divIcon({
          className: 'atlas-label-icon',
          html:
            `<span class="atlas-capital"><i aria-hidden="true"></i>` +
            `${escapeHtml(capital.name)}</span>`,
          iconSize: [0, 0],
        }),
        interactive: false,
        keyboard: false,
        zIndexOffset: -1000,
      }).addTo(labels);
    }
  }

  /*
   * Coalesced to the next frame.
   *
   * Which labels fit depends on the container's size, and the container is
   * resized by React one frame *after* the round changes — the artifact card
   * expanding gives ~200px back to the map. Recomputing synchronously therefore
   * measured the old layout and left the world view showing a single label.
   * Scheduling means the last word always belongs to the settled layout.
   */
  let pending = 0;
  function scheduleRefresh(): void {
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      pending = 0;
      refreshLabels();
    });
  }

  const onViewChange = () => scheduleRefresh();
  map.on('moveend zoomend resize', onViewChange);

  group.addTo(map);
  restyle();
  refreshLabels();

  return {
    layer: group,
    refreshLabels: scheduleRefresh,
    restyle,
    destroy() {
      if (pending) cancelAnimationFrame(pending);
      map.off('moveend zoomend resize', onViewChange);
      group.remove();
    },
  };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

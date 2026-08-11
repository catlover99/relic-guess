import { useEffect, useId, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// Must come after Leaflet's own stylesheet — see map.css.
import './map.css';
import type { GeoPoint, OriginPlace } from '@/data/schema';
import { distanceKm, formatDistance, greatCircleSegments, midpoint } from '@/game/geo';
import { cn } from '@/lib/cn';
import {
  createGuessIcon,
  createOriginIcon,
  MIN_UNCERTAINTY_RING_KM,
  uncertaintyCircleOptions,
} from './markers';
import {
  DARK_NEEDS_FILTER,
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_ATTRIBUTION,
  TILE_SUBDOMAINS,
  tileUrl,
} from './tiles';

export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface GameMapProps {
  /** Current guess, or null if the player has not placed one. */
  guess: GeoPoint | null;
  onGuessChange: (point: GeoPoint) => void;
  /** Set once the round is revealed; enables the origin marker and the line. */
  origin: OriginPlace | null;
  /** Locks placement — the guess can no longer be moved. */
  locked: boolean;
  theme: 'light' | 'dark';
  /**
   * Insets (px) occupied by overlaying UI. `fitBounds` respects them so a
   * revealed marker never lands underneath a panel.
   */
  padding?: MapPadding;
  /** Bumping this resets the view to the world — used when a new round starts. */
  resetKey: number;
  className?: string;
}

const WORLD_CENTER: L.LatLngExpression = [26, 14];
const WORLD_ZOOM = 2;

/** Movement (px) above which a pointer interaction is a pan, not a tap. */
const TAP_SLOP = 12;
/** Duration (ms) above which a stationary press is a long-press, not a tap. */
const TAP_TIMEOUT = 700;

export function GameMap({
  guess,
  onGuessChange,
  origin,
  locked,
  theme,
  padding,
  resetKey,
  className,
}: GameMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const guessMarkerRef = useRef<L.Marker | null>(null);
  const originLayerRef = useRef<L.LayerGroup | null>(null);
  const lineLayerRef = useRef<L.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const hintId = useId();

  // Kept in refs so the Leaflet handlers, which are bound once, always read
  // current values without being torn down and rebound on every render.
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const onGuessChangeRef = useRef(onGuessChange);
  onGuessChangeRef.current = onGuessChange;

  /* ---- Initialisation ------------------------------------------- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      center: WORLD_CENTER,
      zoom: WORLD_ZOOM,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      zoomControl: false,
      attributionControl: true,
      // A single, contained world. Wrapping copies would let the player click a
      // duplicate of Egypt at longitude 390 and make the guess ambiguous.
      worldCopyJump: false,
      maxBounds: L.latLngBounds([-85, -180], [85, 180]),
      maxBoundsViscosity: 1,
      // Trackpad/ctrl+wheel zoom feels better with a smaller step.
      wheelPxPerZoomLevel: 120,
      keyboard: true,
      keyboardPanDelta: 90,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    tileRef.current = L.tileLayer(tileUrl(theme), {
      attribution: TILE_ATTRIBUTION,
      subdomains: TILE_SUBDOMAINS,
      maxZoom: MAX_ZOOM,
      detectRetina: true,
      // Keeps zoom transitions from flashing the background through.
      keepBuffer: 3,
      crossOrigin: true,
    }).addTo(map);

    originLayerRef.current = L.layerGroup().addTo(map);
    lineLayerRef.current = L.layerGroup().addTo(map);

    mapRef.current = map;
    setReady(true);

    return () => {
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      guessMarkerRef.current = null;
      originLayerRef.current = null;
      lineLayerRef.current = null;
    };
    // Theme is applied by a dedicated effect; this must run exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Tap-to-place --------------------------------------------- */
  /**
   * Placement is driven by raw pointer events rather than Leaflet's `click`.
   *
   * On touch devices a pan of a few pixels still produces a synthetic click,
   * which in the previous implementation dropped a guess marker in the middle of
   * the ocean every time the player tried to scroll the map. Requiring the
   * pointer to stay within `TAP_SLOP` for under `TAP_TIMEOUT` makes an
   * accidental guess essentially impossible while keeping a genuine tap instant.
   */
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container || !ready) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let candidate = false;

    const onPointerDown = (event: PointerEvent) => {
      // Ignore right/middle clicks and interactions that begin on a control.
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('.leaflet-control, .marker-root')) {
        candidate = false;
        return;
      }
      startX = event.clientX;
      startY = event.clientY;
      startTime = event.timeStamp;
      candidate = true;
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!candidate) return;
      candidate = false;
      if (lockedRef.current) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > TAP_SLOP) return;
      if (event.timeStamp - startTime > TAP_TIMEOUT) return;

      const rect = container.getBoundingClientRect();
      const point = map.containerPointToLatLng(
        L.point(event.clientX - rect.left, event.clientY - rect.top),
      );
      onGuessChangeRef.current({ lat: point.lat, lon: normalizeLon(point.lng) });
    };

    const onPointerCancel = () => {
      candidate = false;
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerCancel);
    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [ready]);

  /* ---- Keyboard placement --------------------------------------- */
  /**
   * Leaflet gives arrow-key panning and +/- zoom for free once the container is
   * focused. What it has no concept of is *placing* something, so Enter/Space
   * drops the guess at the centre of the viewport — which, combined with panning,
   * makes the map fully operable without a pointer.
   */
  useEffect(() => {
    const container = containerRef.current;
    const map = mapRef.current;
    if (!container || !map || !ready) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target !== container) return;
      if (lockedRef.current) return;
      event.preventDefault();
      const center = map.getCenter();
      onGuessChangeRef.current({ lat: center.lat, lon: normalizeLon(center.lng) });
    };

    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }, [ready]);

  /* ---- Theme ---------------------------------------------------- */
  useEffect(() => {
    tileRef.current?.setUrl(tileUrl(theme));
  }, [theme]);

  /* ---- Guess marker --------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (!guess) {
      guessMarkerRef.current?.remove();
      guessMarkerRef.current = null;
      return;
    }

    const latLng = L.latLng(guess.lat, guess.lon);
    let marker = guessMarkerRef.current;

    if (!marker) {
      marker = L.marker(latLng, {
        icon: createGuessIcon(!locked),
        draggable: !locked,
        keyboard: false,
        autoPan: true,
        zIndexOffset: 500,
        alt: 'Your guess',
      }).addTo(map);
      marker.on('dragend', () => {
        const position = marker!.getLatLng();
        onGuessChangeRef.current({ lat: position.lat, lon: normalizeLon(position.lng) });
      });
      guessMarkerRef.current = marker;
    } else {
      marker.setLatLng(latLng);
    }

    marker.setIcon(createGuessIcon(!locked));
    if (locked) marker.dragging?.disable();
    else marker.dragging?.enable();
  }, [guess, locked, ready]);

  /* ---- Reveal: origin marker, uncertainty ring, distance line --- */
  useEffect(() => {
    const map = mapRef.current;
    const originLayer = originLayerRef.current;
    const lineLayer = lineLayerRef.current;
    if (!map || !originLayer || !lineLayer || !ready) return;

    originLayer.clearLayers();
    lineLayer.clearLayers();
    if (!origin) return;

    L.marker([origin.lat, origin.lon], {
      icon: createOriginIcon(),
      interactive: false,
      keyboard: false,
      zIndexOffset: 400,
      alt: `True origin: ${origin.label}`,
    }).addTo(originLayer);

    if (origin.uncertaintyKm >= MIN_UNCERTAINTY_RING_KM) {
      L.circle([origin.lat, origin.lon], {
        radius: origin.uncertaintyKm * 1000,
        ...uncertaintyCircleOptions(),
      }).addTo(originLayer);
    }

    if (guess) {
      // Two strokes: a light halo underneath so the line stays legible over both
      // land and sea, and the dashed line itself on top.
      for (const segment of greatCircleSegments(guess, origin)) {
        const path = segment.map((p) => [p.lat, p.lon] as L.LatLngTuple);
        L.polyline(path, {
          className: 'reveal-line-shadow',
          color: 'var(--surface)',
          weight: 6,
          opacity: 0.7,
          interactive: false,
        }).addTo(lineLayer);
        L.polyline(path, {
          className: 'reveal-line',
          color: 'var(--ink-2)',
          weight: 2.5,
          interactive: false,
        }).addTo(lineLayer);
      }

      const mid = midpoint(guess, origin);
      L.tooltip({
        permanent: true,
        direction: 'center',
        className: 'distance-tooltip',
        interactive: false,
      })
        .setLatLng([mid.lat, mid.lon])
        .setContent(
          `<span class="distance-badge">${formatDistance(distanceKm(guess, origin))}</span>`,
        )
        .addTo(lineLayer);

      const bounds = L.latLngBounds([
        [guess.lat, guess.lon],
        [origin.lat, origin.lon],
      ]);
      map.fitBounds(bounds, {
        paddingTopLeft: L.point((padding?.left ?? 0) + 48, (padding?.top ?? 0) + 48),
        paddingBottomRight: L.point((padding?.right ?? 0) + 48, (padding?.bottom ?? 0) + 64),
        maxZoom: 7,
        animate: true,
      });
    } else {
      map.flyTo([origin.lat, origin.lon], 5, { duration: 0.8 });
    }
  }, [origin, guess, padding, ready]);

  /* ---- Reset between rounds ------------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setView(WORLD_CENTER, WORLD_ZOOM, { animate: false });
  }, [resetKey, ready]);

  /* ---- Keep Leaflet in step with container resizes -------------- */
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container || !ready) return;

    // The container changes height whenever the artifact card collapses or the
    // browser toolbar hides; without this the map renders grey bands.
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(container);
    return () => observer.disconnect();
  }, [ready]);

  const label = locked
    ? 'Map showing your guess and the true origin of the artifact'
    : 'World map. Tap or click to place your guess.';

  return (
    /*
     * Every state-dependent class lives on this wrapper, never on the element
     * Leaflet owns.
     *
     * Leaflet mutates its container's class list imperatively — `leaflet-container`,
     * `leaflet-touch`, `leaflet-grab`, `leaflet-fade-anim` — and React knows nothing
     * about them. Putting a conditional class on that same element means React
     * rewrites `node.className` the moment the condition changes, wiping Leaflet's
     * classes with it. Every rule that positions the panes and clips the viewport is
     * scoped to `.leaflet-container`, so the map silently stops rendering while its
     * handlers keep working: visible one moment, an invisible but clickable rectangle
     * the next. See map.css for the matching selectors.
     */
    <div
      className={cn(
        'relative isolate h-full w-full',
        !locked && 'is-guessing',
        theme === 'dark' && DARK_NEEDS_FILTER && 'tiles-inverted',
        className,
      )}
    >
      <div
        ref={containerRef}
        // Focusable so keyboard users can pan with arrows and place with Enter.
        tabIndex={0}
        role="application"
        aria-label={label}
        aria-describedby={locked ? undefined : hintId}
        // Constant by design — see the comment above.
        className="h-full w-full"
      />
      <p id={hintId} className="sr-only">
        Use the arrow keys to pan the map, plus and minus to zoom, and press Enter to place your
        guess at the centre of the map.
      </p>
    </div>
  );
}

/** Safety net: clamps a longitude into [-180, 180]. */
function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

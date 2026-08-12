import { useEffect, useId, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// Must come after Leaflet's own stylesheet — see map.css.
import './map.css';
import type { GeoPoint } from '@/data/schema';
import { distanceKm, formatDistance, greatCircleSegments, midpoint } from '@/game/geo';
import { cn } from '@/lib/cn';
import {
  createDiscoveryIcon,
  createGuessIcon,
  createOriginIcon,
  uncertaintyCircleOptions,
} from './markers';
import { ATLAS_ATTRIBUTION, MAX_ZOOM, MIN_ZOOM } from './tiles';
import { clampPadding, regionSpan, shouldFrameRegion } from './framing';
import { createAtlas, loadAtlas } from './atlas';

export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The scored centre plus the radius that was forgiven around it. */
export interface RevealRegion extends GeoPoint {
  label: string;
  radiusKm: number;
}

export interface RevealPin extends GeoPoint {
  label: string;
}

export interface GameMapProps {
  /** Current guess, or null if the player has not placed one. */
  guess: GeoPoint | null;
  onGuessChange: (point: GeoPoint) => void;
  /**
   * Set once the round is revealed; enables the region, its circle and the line.
   *
   * This is the point the guess was *scored against*, which in Heartland and Daily
   * is the culture's homeland rather than the object's own findspot.
   */
  origin: RevealRegion | null;
  /**
   * Where the object itself was found or made, when that is a different place.
   * Informational only — it is never what the score was measured to.
   */
  discovery: RevealPin | null;
  /** Locks placement — the guess can no longer be moved. */
  locked: boolean;
  /**
   * True on phone-sized layouts. Only affects label type size: a narrow screen
   * gets *larger* country names, not smaller ones.
   */
  compact?: boolean;
  /** Only used to re-read the basemap palette; the map itself is theme-agnostic. */
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
  discovery,
  locked,
  compact = false,
  theme,
  padding,
  resetKey,
  className,
}: GameMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const atlasRef = useRef<ReturnType<typeof createAtlas> | null>(null);
  const guessMarkerRef = useRef<L.Marker | null>(null);
  const originLayerRef = useRef<L.LayerGroup | null>(null);
  const lineLayerRef = useRef<L.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const hintId = useId();

  // Kept in refs so the Leaflet handlers, which are bound once, always read
  // current values without being torn down and rebound on every render.
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const onGuessChangeRef = useRef(onGuessChange);
  onGuessChangeRef.current = onGuessChange;
  const compactRef = useRef(compact);
  compactRef.current = compact;
  /*
   * The last reveal framing, replayed when the container changes size.
   *
   * Opening the reveal panel takes ~200px from the map a frame *after* the fit is
   * computed, which left the scored region clipped off the top edge on a phone.
   * `invalidateSize` alone does not re-frame anything — it only tells Leaflet the
   * viewport changed.
   */
  const refitRef = useRef<(() => void) | null>(null);

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
    map.attributionControl.addAttribution(ATLAS_ATTRIBUTION);

    /*
     * The basemap is one static file, so it is added asynchronously and the map is
     * usable (pannable, clickable) before it arrives. `cancelled` guards the case
     * where the round ends during the fetch.
     */
    let cancelled = false;
    void loadAtlas()
      .then((data) => {
        if (cancelled || !mapRef.current) return;
        atlasRef.current = createAtlas(map, data, { compact: compactRef.current });
      })
      .catch((error: unknown) => {
        // A missing basemap leaves an empty grid the player cannot orient on, but
        // guessing still works, so this must not take the round down with it.
        if (import.meta.env.DEV) console.error('[atlas] failed to load', error);
      });

    originLayerRef.current = L.layerGroup().addTo(map);
    lineLayerRef.current = L.layerGroup().addTo(map);

    // Mirrored onto the wrapper below: the only externally observable proof that
    // a zoom interaction actually reached Leaflet.
    const syncZoom = () => setZoom(map.getZoom());
    map.on('zoomend', syncZoom);
    syncZoom();

    mapRef.current = map;
    setReady(true);

    return () => {
      cancelled = true;
      atlasRef.current?.destroy();
      atlasRef.current = null;
      map.remove();
      mapRef.current = null;
      guessMarkerRef.current = null;
      originLayerRef.current = null;
      lineLayerRef.current = null;
    };
    // Deliberately empty: the map instance is created exactly once and every
    // later change is applied imperatively by the effects below. See the wrapper
    // comment at the bottom of this file for why re-creating it is not an option.
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
  /*
   * The labels are DOM and re-colour themselves from CSS. The geometry is canvas,
   * which Leaflet paints from the values in the path options, so those have to be
   * re-read from the tokens when the theme flips. The old raster layer needed a
   * URL swap and a whole-pane invert filter instead.
   */
  useEffect(() => {
    atlasRef.current?.restyle();
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
    refitRef.current = null;
    if (!origin) return;

    /*
     * The circle first, so both markers sit on top of it.
     *
     * Drawn unconditionally now. It used to appear only for coarse coordinates,
     * which meant the mode that forgives the most showed the least about why —
     * a player who guessed 200 km away and scored full marks had nothing on
     * screen explaining that. The radius is the scoring rule made visible.
     */
    L.circle([origin.lat, origin.lon], {
      radius: origin.radiusKm * 1000,
      ...uncertaintyCircleOptions(),
    }).addTo(originLayer);

    L.marker([origin.lat, origin.lon], {
      icon: createOriginIcon(),
      interactive: false,
      keyboard: false,
      zIndexOffset: 400,
      alt: `Scored against: ${origin.label}`,
    }).addTo(originLayer);

    /*
     * The object's own findspot, when it is somewhere else. Deliberately not
     * connected to the guess by a line: nothing about the score was measured to
     * this point, and drawing one would say otherwise.
     */
    if (discovery) {
      L.marker([discovery.lat, discovery.lon], {
        icon: createDiscoveryIcon(),
        interactive: false,
        keyboard: false,
        zIndexOffset: 350,
        alt: `The object itself was located at ${discovery.label}`,
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

      /*
       * A marker rather than an `L.tooltip`.
       *
       * Leaflet removes a tooltip through a 200 ms fade, so `clearLayers()` on a
       * round change left the previous round's badge on screen — "3,708 km"
       * floating over the next artifact's map until the timer caught up. Markers
       * are removed synchronously, so the badge cannot outlive its round.
       */
      const mid = midpoint(guess, origin);
      L.marker([mid.lat, mid.lon], {
        icon: L.divIcon({
          className: 'distance-badge-icon',
          html: `<span class="distance-badge">${formatDistance(distanceKm(guess, origin))}</span>`,
          iconSize: [0, 0],
        }),
        interactive: false,
        keyboard: false,
        zIndexOffset: 300,
      }).addTo(lineLayer);

      /*
       * Frame everything the reveal is talking about: the guess, the scored
       * region *including its radius*, and the findspot when there is one.
       *
       * The radius is included as a bounding box rather than a point, so a
       * 380 km homeland is not half off-screen. It is also capped: a large
       * region plus a guess on another continent would otherwise pull the map
       * out to the whole world, where nothing is legible. Past the cap the two
       * markers are what matter, and the circle simply extends beyond the view.
       */
      /*
       * Two candidate framings, and readability wins when they conflict.
       *
       * `pointBounds` holds the things the player has to be able to see: their
       * guess, the scored centre, and the findspot. `wideBounds` also contains the
       * whole scored region, which is preferable — but a 380 km radius on a phone
       * can force the view out to zoom 1, where the map is an unreadable smudge.
       * Past that point the circle simply extends beyond the viewport, which still
       * reads as "this region is bigger than the screen".
       */
      const pointBounds = L.latLngBounds([
        [guess.lat, guess.lon],
        [origin.lat, origin.lon],
      ]);
      if (discovery) pointBounds.extend([discovery.lat, discovery.lon]);

      const wideBounds = L.latLngBounds([
        [guess.lat, guess.lon],
        [origin.lat, origin.lon],
      ]);
      const span = regionSpan(origin.lat, origin.radiusKm);
      wideBounds.extend([
        Math.max(-85, origin.lat - span.latDelta),
        Math.max(-180, origin.lon - span.lonDelta),
      ]);
      wideBounds.extend([
        Math.min(85, origin.lat + span.latDelta),
        Math.min(180, origin.lon + span.lonDelta),
      ]);
      if (discovery) wideBounds.extend([discovery.lat, discovery.lon]);

      /*
       * Padding is clamped to what the container can actually spare.
       *
       * On a 360px phone the map is ~250px tall and the reveal panel already
       * claims 76px of it; adding a fixed 48/64px margin left under 50px to fit
       * two markers and a 380 km circle into, and Leaflet responded by placing
       * the scored region off-screen entirely. Scaling the request down keeps a
       * fit possible on every screen instead of only on roomy ones.
       */
      const applyFit = () => {
        const size = map.getSize();
        const fit = clampPadding(
          {
            left: (padding?.left ?? 0) + 48,
            top: (padding?.top ?? 0) + 48,
            right: (padding?.right ?? 0) + 48,
            bottom: (padding?.bottom ?? 0) + 64,
          },
          size.x,
          size.y,
        );

        const paddingTotal = L.point(fit.left + fit.right, fit.top + fit.bottom);
        const bounds = shouldFrameRegion(
          map.getBoundsZoom(wideBounds, false, paddingTotal),
          map.getBoundsZoom(pointBounds, false, paddingTotal),
        )
          ? wideBounds
          : pointBounds;

        map.fitBounds(bounds, {
          paddingTopLeft: L.point(fit.left, fit.top),
          paddingBottomRight: L.point(fit.right, fit.bottom),
          maxZoom: 7,
          animate: true,
        });
      };

      applyFit();
      refitRef.current = applyFit;
    } else {
      map.flyTo([origin.lat, origin.lon], 5, { duration: 0.8 });
    }
  }, [origin, discovery, guess, padding, ready]);

  /* ---- Reset between rounds ------------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    /*
     * Cancel the reveal's `fitBounds` first. Advancing to the next round while
     * that animation is still running left the map to finish flying to the *old*
     * round's origin after the reset had already been applied — landing zoomed
     * in on the previous answer instead of at the world view.
     */
    map.stop();
    map.setView(WORLD_CENTER, WORLD_ZOOM, { animate: false });
    /*
     * Labels are normally recomputed from Leaflet's own move/zoom events, but
     * `setView` to a position the map is already at fires nothing — which left
     * the world view showing the handful of labels that happened to be visible
     * during the previous round's zoomed-in reveal.
     */
    atlasRef.current?.refreshLabels();
  }, [resetKey, ready]);

  /* ---- Keep Leaflet in step with container resizes -------------- */
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container || !ready) return;

    // The container changes height whenever the artifact card collapses or the
    // browser toolbar hides; without this the map renders grey bands.
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
      // The visible area changed, so which country names fit has changed too.
      atlasRef.current?.refreshLabels();
      // …and so has what fits in frame. Without this the reveal stays framed for
      // the size the map had before the answer panel opened.
      refitRef.current?.();
    });
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
      className={cn('relative isolate h-full w-full', !locked && 'is-guessing', className)}
      data-map-zoom={zoom ?? undefined}
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

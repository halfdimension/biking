/**
 * Center map region (Req 15.3) — MapLibre basemap, markers, and coordinate
 * selection (Task 13.1, 13.2).
 *
 * Task 13.1 (Req 20.4, 20.5): initialize a MapLibre map on mount with a
 * configurable no-key OSM basemap (see `resolveMapStyle`) centered on the Delhi
 * NCR region at a sensible default zoom when no coords/routes exist.
 *
 * Task 13.2 (Req 1): render distinct start/destination markers at the store's
 * coordinates; support "Set Start/Destination on Map" arming + click-to-set;
 * and a right-click context menu offering "Set as Start" / "Set as Destination".
 *
 * Route rendering (Task 16): one combined GeoJSON source (`routes`) with
 * `promoteId: "routeId"` feeds three line layers (`routes-hit`, `routes-base`,
 * `routes-selected`, none filtered). Visibility and selection are driven purely
 * by MapLibre `feature-state`, which is REAPPLIED after every `setData` because
 * feature-state does not survive a source-data replacement.
 *
 * Fitting (Task 18.1, Req 20.1–20.3): a single shared `fitTo(coords)` routine
 * frames the map via `map.fitBounds` (or `easeTo` for a single point). It runs
 * automatically after a successful Compare (over all route coords) and on demand
 * from the toolbar "Fit Routes" control (via the store's `fitRequestId` counter),
 * falling back to start/dest markers when no routes exist.
 *
 * MapLibre GL does not run under jsdom, so the map-init effect is written so it
 * can be safely mocked in unit tests (`vi.mock("maplibre-gl")`); the pure
 * `resolveMapStyle` helper carries the logic that is unit-tested directly.
 */
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useStore } from "../store";
import EdgeDebugInspector from "./EdgeDebugInspector";
import {
  attachDashboardMapLifecycle,
  dashboardMapOptions,
} from "../map/initialize";
import { buildRoutesFeatureCollection } from "../map/routes";
import {
  buildDebugSegmentsFeatureCollection,
  DEBUG_SEGMENTS_SOURCE_ID,
} from "../map/debugSegments";
import {
  ROUTES_SOURCE_ID,
  HIT_LAYER_ID,
  DEBUG_HIT_LAYER_ID,
  hitLayerSpec,
  baseLayerSpec,
  selectedLayerSpec,
  debugHighlightLayerSpec,
  debugHitLayerSpec,
} from "../map/layers";
import { resolveSelectedRouteId, type RouteCandidate } from "../map/hitTest";
import {
  resolveDebugSegmentIds,
  type RenderedDebugFeature,
} from "../map/debugHitTest";
import {
  collectRouteCoords,
  computeBounds,
  markerCoords,
} from "../map/fit";
import type { Coordinate, NormalizedRoute } from "../types";

/** Distinct marker colors (Req 1.7): green start, red destination. */
const START_COLOR = "#16a34a";
const DEST_COLOR = "#dc2626";

/** Shared fit routine parameters (Task 18.1). */
const FIT_PADDING = 60;
const FIT_MAX_ZOOM = 15;
const FIT_DURATION_MS = 300;
/** Zoom used when framing a single point (no meaningful bounds). */
const SINGLE_POINT_ZOOM = 14;

/**
 * The single shared fit routine (Task 18.1, Req 20.1–20.3).
 *
 * Frames the map to the given `[lon, lat]` coordinates. With multiple distinct
 * points it uses `map.fitBounds(bounds, { padding, maxZoom, duration })`; with a
 * single point (degenerate bounds where sw === ne) it prefers a center+zoom via
 * `map.easeTo`. Empty input is a no-op.
 *
 * NOTE: this deliberately does NOT gate on `map.isStyleLoaded()`. `fitBounds` /
 * `easeTo` are pure camera operations that are safe to call before the style has
 * finished loading, and `isStyleLoaded()` transiently returns false right after a
 * source `setData` — gating on it silently dropped the post-Compare auto-fit.
 *
 * Compare-triggered and manual fits both call this one function, differing only
 * in the coordinate set passed in (route coords vs marker coords).
 */
function fitTo(map: maplibregl.Map | null, coords: [number, number][]): void {
  if (!map) return;
  const bounds = computeBounds(coords);
  if (!bounds) return;
  const [[minLon, minLat], [maxLon, maxLat]] = bounds;
  const isSinglePoint = minLon === maxLon && minLat === maxLat;
  if (isSinglePoint) {
    // A degenerate bounds has no extent; center on the point at a sensible zoom.
    if (map.easeTo) {
      map.easeTo({
        center: [minLon, minLat],
        zoom: SINGLE_POINT_ZOOM,
        duration: FIT_DURATION_MS,
      });
    } else if (map.jumpTo) {
      map.jumpTo({ center: [minLon, minLat], zoom: SINGLE_POINT_ZOOM });
    }
    return;
  }
  if (map.fitBounds) {
    map.fitBounds(bounds, {
      padding: FIT_PADDING,
      maxZoom: FIT_MAX_ZOOM,
      duration: FIT_DURATION_MS,
    });
  }
}

/**
 * Reapply MapLibre `feature-state` for every current route (Task 16.2).
 *
 * Sets `{ visible, selected, hasSelection }` per route keyed by `routeId`
 * (promoted to the feature id via `promoteId`). `visible` defaults to true when
 * the route has no explicit visibility entry (newly returned routes render
 * visible). `selected` is true only for the currently selected route.
 * `hasSelection` remains available on every route for feature-state compatibility,
 * but route paint deliberately does not use it: selection is additive and must
 * never change another visible route's base appearance.
 *
 * MUST be called after every `setData` because feature-state does NOT survive a
 * source-data replacement.
 */
function applyFeatureState(
  map: maplibregl.Map,
  routes: NormalizedRoute[],
  visibility: Record<string, boolean>,
  selectedRouteId: string | null,
): void {
  if (!map.setFeatureState) return;
  const hasSelection = selectedRouteId !== null;
  for (const r of routes) {
    const visible = visibility[r.id] ?? true;
    map.setFeatureState(
      { source: ROUTES_SOURCE_ID, id: r.id },
      { visible, selected: r.id === selectedRouteId, hasSelection },
    );
  }
}

/**
 * Resolve and apply a route selection from a map click (Task 21.1, Req 6.1).
 *
 * Queries the transparent `routes-hit` layer at the click point for candidate
 * routes. The hit layer already collapses to 0 width for hidden routes, so they
 * are not returned; we DEFENSIVELY also drop any candidate whose `visible`
 * feature-state is explicitly false so hidden routes can never be selected
 * (Req 6.1 + 5). Each surviving feature is mapped to a {@link RouteCandidate}
 * (routeId preferred from the promoted feature `id`, falling back to
 * `properties.routeId`), then {@link resolveSelectedRouteId} picks one
 * deterministically and the choice funnels through the store's `selectRoute`.
 *
 * A click with no candidates leaves the selection unchanged (returns null →
 * no `selectRoute` call), so an empty-basemap click does not clear selection.
 */
function selectRouteFromClick(
  map: maplibregl.Map,
  point: maplibregl.PointLike,
): void {
  if (!map.queryRenderedFeatures) return;
  let feats: maplibregl.MapGeoJSONFeature[] = [];
  try {
    feats = map.queryRenderedFeatures(point, { layers: [HIT_LAYER_ID] });
  } catch {
    // No hit layer yet (routes not loaded) — nothing to select.
    return;
  }

  const candidates: RouteCandidate[] = [];
  for (const f of feats) {
    // Prefer the promoted feature id; fall back to properties.routeId.
    const routeId =
      f.id != null ? String(f.id) : (f.properties?.routeId as string | undefined);
    if (!routeId) continue;
    // Defensive: skip routes explicitly hidden via feature-state.
    const state = map.getFeatureState
      ? map.getFeatureState({ source: ROUTES_SOURCE_ID, id: routeId })
      : undefined;
    if (state && state.visible === false) continue;
    const props = f.properties ?? {};
    candidates.push({
      routeId,
      engine: String(props.engine ?? ""),
      index: Number(props.index ?? 0),
    });
  }

  const currentSelectedId = useStore.getState().selectedRouteId;
  const chosen = resolveSelectedRouteId(candidates, currentSelectedId);
  if (chosen !== null) {
    useStore.getState().selectRoute(chosen);
  }
}

/** Local state for the right-click context menu overlay (Req 1.4). */
interface ContextMenuState {
  /** Screen point (relative to the map container) to position the menu. */
  x: number;
  y: number;
  /** Clicked geographic location. */
  lngLat: { lng: number; lat: number };
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const startMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const previousActiveDebugIdsRef = useRef<string[]>([]);

  const start = useStore((s) => s.start);
  const dest = useStore((s) => s.dest);
  const setStart = useStore((s) => s.setStart);
  const setDest = useStore((s) => s.setDest);

  // Route rendering inputs (Task 16). The map subscribes only to these three
  // slices (Req 12.4).
  const routes = useStore((s) => s.routes);
  const visibility = useStore((s) => s.visibility);
  const selectedRouteId = useStore((s) => s.selectedRouteId);
  // Edge-debug is a separate source/layer path; normal routes remain untouched.
  const edgeDebugEnabled = useStore((s) => s.edgeDebugEnabled);
  const debugResults = useStore((s) => s.debugResults);
  const hoveredDebugSegmentIds = useStore((s) => s.hoveredDebugSegmentIds);
  const pinnedDebugSegmentIds = useStore((s) => s.pinnedDebugSegmentIds);

  // Map fitting inputs (Task 18.1). `compareStatus` drives the auto-fit after a
  // successful Compare; `fitRequestId` is a monotonic counter bumped by the
  // manual "Fit Routes" control.
  const compareStatus = useStore((s) => s.compareStatus);
  const fitRequestId = useStore((s) => s.fitRequestId);

  // Layout collapse booleans (UI-only). MapView subscribes to them purely to
  // trigger a `map.resize()` after the sibling panels change size — the map
  // instance itself is NEVER recreated, so center/zoom/routes/feature-state/
  // selection/markers/fit all survive a collapse/expand.
  const leftCollapsed = useStore((s) => s.leftCollapsed);
  const rightCollapsed = useStore((s) => s.rightCollapsed);
  const bottomCollapsed = useStore((s) => s.bottomCollapsed);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [tilted, setTilted] = useState(false);

  // --- Map initialization (Task 13.1) --------------------------------------
  useEffect(() => {
    // Capture the container once. The map lives in a flex layout
    // (`.map-view` flex:1 / `.map-view__canvas` position:absolute inset:0), so
    // at construction time the container may not have its final, non-zero size
    // yet. MapLibre would then initialize with a 0×0 / stale canvas and render
    // nothing (a flat gray area). We fix that below by resizing the map once
    // layout settles and by observing the container for later size changes.
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map(dashboardMapOptions(container));
    mapRef.current = map;

    // Dev/diagnostic hook: expose the live map instance so a headless browser
    // (or preview-time tooling) can inspect the real MapLibre render. Guarded
    // so it never ships in a production build unless explicitly opted in via
    // VITE_EXPOSE_MAP=1 (vite preview serves a production build where DEV=false).
    if (import.meta.env.DEV || import.meta.env.VITE_EXPOSE_MAP === "1") {
      (window as unknown as { __map?: unknown }).__map = map;
    }

    // Trivial, keyless navigation controls.
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    const detachMapLifecycle = attachDashboardMapLifecycle(
      map,
      container,
      "MapView",
    );

    let debugMoveFrame: number | null = null;

    // Throttled 6px-box hit test. All rendered candidates are retained; the
    // pure resolver removes only tile duplicates and explicitly hidden routes.
    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      const state = useStore.getState();
      if (!state.edgeDebugEnabled) return;
      if (debugMoveFrame !== null) cancelAnimationFrame(debugMoveFrame);
      const { x, y } = e.point;
      const hoverPoint: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      debugMoveFrame = requestAnimationFrame(() => {
        debugMoveFrame = null;
        let features: maplibregl.MapGeoJSONFeature[] = [];
        try {
          features = map.queryRenderedFeatures(
            [
              [x - 6, y - 6],
              [x + 6, y + 6],
            ],
            { layers: [DEBUG_HIT_LAYER_ID] },
          );
        } catch {
          // The debug source/layer has not been created yet.
        }
        const current = useStore.getState();
        current.setHoveredDebugSegmentIds(
          resolveDebugSegmentIds(
            features as unknown as RenderedDebugFeature[],
            current.visibility,
          ),
          hoverPoint,
        );
      });
    };

    const handleMouseLeave = () => {
      if (debugMoveFrame !== null) {
        cancelAnimationFrame(debugMoveFrame);
        debugMoveFrame = null;
      }
      const state = useStore.getState();
      if (state.edgeDebugEnabled) {
        state.setHoveredDebugSegmentIds([], null);
      }
    };

    // Route selection remains the primary click behavior. Debug pinning runs
    // afterwards and does not stop propagation or replace routes-hit.
    const handleClick = (e: maplibregl.MapMouseEvent) => {
      setContextMenu(null);
      const target = useStore.getState().mapClickTarget;
      if (target) {
        const coord: Coordinate = { lat: e.lngLat.lat, lon: e.lngLat.lng };
        if (target === "start") {
          setStart(coord);
        } else {
          setDest(coord);
        }
        useStore.getState().setMapClickTarget(null);
        return;
      }
      selectRouteFromClick(map, e.point);
      const state = useStore.getState();
      if (state.edgeDebugEnabled && state.hoveredDebugSegmentIds.length > 0) {
        state.pinHoveredDebugSegments();
      }
    };

    // Right click: open a context menu at the cursor (Req 1.4).
    const handleContextMenu = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      setContextMenu({
        x: e.point.x,
        y: e.point.y,
        lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat },
      });
    };

    map.on("mousemove", handleMouseMove);
    map.on("mouseleave", handleMouseLeave);
    map.on("click", handleClick);
    map.on("contextmenu", handleContextMenu);

    return () => {
      detachMapLifecycle();
      if (debugMoveFrame !== null) cancelAnimationFrame(debugMoveFrame);
      map.off("mousemove", handleMouseMove);
      map.off("mouseleave", handleMouseLeave);
      map.off("click", handleClick);
      map.off("contextmenu", handleContextMenu);
      map.remove();
      mapRef.current = null;
      startMarkerRef.current = null;
      destMarkerRef.current = null;
      if (import.meta.env.DEV || import.meta.env.VITE_EXPOSE_MAP === "1") {
        try {
          delete (window as unknown as { __map?: unknown }).__map;
        } catch {
          /* ignore */
        }
      }
    };
    // Init once on mount; store actions are stable references.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Start marker sync (Task 13.2, Req 1.7) ------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (start) {
      if (!startMarkerRef.current) {
        startMarkerRef.current = new maplibregl.Marker({ color: START_COLOR });
      }
      startMarkerRef.current.setLngLat([start.lon, start.lat]).addTo(map);
    } else if (startMarkerRef.current) {
      startMarkerRef.current.remove();
      startMarkerRef.current = null;
    }
  }, [start]);

  // --- Destination marker sync (Task 13.2, Req 1.7) ------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (dest) {
      if (!destMarkerRef.current) {
        destMarkerRef.current = new maplibregl.Marker({ color: DEST_COLOR });
      }
      destMarkerRef.current.setLngLat([dest.lon, dest.lat]).addTo(map);
    } else if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }
  }, [dest]);

  // --- Route source + layers (Task 16.1) -----------------------------------
  // Push the current routes into a single combined GeoJSON source, creating the
  // source and the three line layers lazily the first time routes arrive after
  // the map is ready. All map operations are guarded for style/source
  // readiness so nothing throws if routes update before the map loads.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      // Guard: the style must be loaded before adding sources/layers.
      if (!map.isStyleLoaded || !map.isStyleLoaded()) return;

      const data = buildRoutesFeatureCollection(routes);
      const existing = map.getSource(ROUTES_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;

      if (existing) {
        existing.setData(data as unknown as GeoJSON.FeatureCollection);
      } else {
        // Lazily create the source with promoteId so feature identity comes
        // from properties.routeId (design: Source & layer model).
        map.addSource(ROUTES_SOURCE_ID, {
          type: "geojson",
          promoteId: "routeId",
          data: data as unknown as GeoJSON.FeatureCollection,
        });
        // Bottom → top: hit, base, selected (selected added LAST) (Req 6.4).
        if (!map.getLayer(hitLayerSpec().id)) {
          map.addLayer(hitLayerSpec() as maplibregl.LayerSpecification);
        }
        if (!map.getLayer(baseLayerSpec().id)) {
          map.addLayer(baseLayerSpec() as maplibregl.LayerSpecification);
        }
        if (!map.getLayer(selectedLayerSpec().id)) {
          map.addLayer(selectedLayerSpec() as maplibregl.LayerSpecification);
        }
      }

      // CRITICAL: feature-state does NOT survive a source-data replacement, so
      // reapply it for every current route AFTER setData (Task 16.2).
      applyFeatureState(map, routes, useStore.getState().visibility, useStore.getState().selectedRouteId);
    };

    if (map.isStyleLoaded && map.isStyleLoaded()) {
      apply();
    } else if (map.once) {
      // Defer until the map next settles. "idle" is used instead of "load"
      // because `load` fires exactly once during initialization: a routes update
      // arriving while `isStyleLoaded()` is transiently false AFTER that initial
      // load would queue a `load` handler that never runs, silently dropping the
      // source creation / setData. "idle" fires after every render settle.
      map.once("idle", apply);
      return () => {
        map.off("idle", apply);
      };
    }
    // Re-run whenever the routes change (new Compare results replace the source
    // data). visibility/selectedRouteId are read fresh via getState() so they
    // are not stale here; a separate effect below handles their live updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes]);

  // --- Feature-state visibility/selection (Task 16.2) ----------------------
  // Reapply feature-state whenever visibility or selection changes, WITHOUT a
  // setData (feature-state persists across these updates; only a source-data
  // replacement clears it).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded || !map.isStyleLoaded()) return;
    if (!map.getSource(ROUTES_SOURCE_ID)) return;
    applyFeatureState(map, routes, visibility, selectedRouteId);
  }, [routes, visibility, selectedRouteId]);

  // --- Independent edge-debug source + layers -------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const existing = map.getSource(DEBUG_SEGMENTS_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;

      // An existing GeoJSON source can accept setData while the style is
      // settling. Only source/layer creation needs a fully loaded style.
      if (!existing && (!map.isStyleLoaded || !map.isStyleLoaded())) return;

      // OFF before first use means no debug source/layers are created at all.
      if (!edgeDebugEnabled && !existing) return;

      const data = buildDebugSegmentsFeatureCollection(
        edgeDebugEnabled ? debugResults : null,
        visibility,
      );
      if (existing) {
        existing.setData(data as unknown as GeoJSON.FeatureCollection);
      } else {
        map.addSource(DEBUG_SEGMENTS_SOURCE_ID, {
          type: "geojson",
          promoteId: "debugSegmentId",
          data: data as unknown as GeoJSON.FeatureCollection,
        });
        if (!map.getLayer(debugHighlightLayerSpec(DEBUG_SEGMENTS_SOURCE_ID).id)) {
          map.addLayer(
            debugHighlightLayerSpec(
              DEBUG_SEGMENTS_SOURCE_ID,
            ) as maplibregl.LayerSpecification,
          );
        }
        if (!map.getLayer(debugHitLayerSpec(DEBUG_SEGMENTS_SOURCE_ID).id)) {
          map.addLayer(
            debugHitLayerSpec(
              DEBUG_SEGMENTS_SOURCE_ID,
            ) as maplibregl.LayerSpecification,
          );
        }
      }

      // setData clears feature-state; restore the current exact highlight set.
      const state = useStore.getState();
      const active = Array.from(
        new Set([
          ...state.hoveredDebugSegmentIds,
          ...state.pinnedDebugSegmentIds,
        ]),
      );
      for (const id of active) {
        map.setFeatureState(
          { source: DEBUG_SEGMENTS_SOURCE_ID, id },
          {
            hovered:
              state.edgeDebugEnabled && state.hoveredDebugSegmentIds.includes(id),
            pinned:
              state.edgeDebugEnabled && state.pinnedDebugSegmentIds.includes(id),
          },
        );
      }
      previousActiveDebugIdsRef.current = state.edgeDebugEnabled ? active : [];
    };

    const canApplyNow =
      Boolean(map.getSource(DEBUG_SEGMENTS_SOURCE_ID)) ||
      Boolean(map.isStyleLoaded && map.isStyleLoaded());
    if (canApplyNow) {
      apply();
    } else if (map.once) {
      map.once("idle", apply);
      return () => {
        map.off("idle", apply);
      };
    }
  }, [debugResults, edgeDebugEnabled, visibility]);

  // Update only feature-state on hover/pin changes; never rebuild GeoJSON on
  // mousemove.
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.setFeatureState || !map.getSource(DEBUG_SEGMENTS_SOURCE_ID)) return;

    for (const id of previousActiveDebugIdsRef.current) {
      map.setFeatureState(
        { source: DEBUG_SEGMENTS_SOURCE_ID, id },
        { hovered: false, pinned: false },
      );
    }
    const next = edgeDebugEnabled
      ? Array.from(new Set([...hoveredDebugSegmentIds, ...pinnedDebugSegmentIds]))
      : [];
    for (const id of next) {
      map.setFeatureState(
        { source: DEBUG_SEGMENTS_SOURCE_ID, id },
        {
          hovered: hoveredDebugSegmentIds.includes(id),
          pinned: pinnedDebugSegmentIds.includes(id),
        },
      );
    }
    previousActiveDebugIdsRef.current = next;
  }, [hoveredDebugSegmentIds, pinnedDebugSegmentIds, edgeDebugEnabled]);

  // --- Auto-fit after a successful Compare (Task 18.1, Req 20.1) -----------
  // When a Compare completes ("done") and produced routes, frame the combined
  // bounds of all valid returned routes. Keyed on `compareStatus` + `routes`
  // identity so it fires on a genuine new result — NOT on visibility toggles or
  // selection changes (which do not change `compareStatus` or the routes array
  // identity).
  //
  // The fit is applied DIRECTLY: camera operations are safe before the style is
  // fully loaded. The previous `isStyleLoaded()` check plus a `once("load")`
  // fallback dropped the fit forever, because `isStyleLoaded()` transiently
  // returns false right after the routes `setData` while `load` had already
  // fired during map initialization and never fires again.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (compareStatus !== "done") return;
    if (routes.length === 0) return;
    fitTo(map, collectRouteCoords(routes));
  }, [compareStatus, routes]);

  // --- Manual "Fit Routes" (Task 18.1, Req 20.2, 20.3) ---------------------
  // Runs whenever `fitRequestId` increments. Fits to the routes when present,
  // else falls back to the start/dest markers (Req 20.3), else does nothing.
  // The initial value (0) is skipped so the map keeps its Delhi default view on
  // mount rather than snapping on first render.
  const prevFitRequestId = useRef(fitRequestId);
  useEffect(() => {
    if (fitRequestId === prevFitRequestId.current) return;
    prevFitRequestId.current = fitRequestId;
    const map = mapRef.current;
    if (!map) return;
    const coords =
      routes.length > 0
        ? collectRouteCoords(routes)
        : markerCoords(start, dest);
    fitTo(map, coords);
  }, [fitRequestId, routes, start, dest]);

  // --- Resize on layout collapse/expand (belt-and-suspenders) --------------
  // The ResizeObserver installed in the init effect already fires when the map
  // container's box changes (sidebar width / bottom-panel height). But CSS
  // transitions mean the box changes over ~150ms, and in environments without a
  // real ResizeObserver (jsdom) it never fires. So when any of the three
  // collapse booleans change, explicitly resize the map on the next animation
  // frame (after the DOM layout updates) AND once more after the transition
  // settles (~200ms), so the FINAL size is always captured. This only calls
  // `map.resize()` — it never recreates the map or touches route/selection/fit
  // logic, so all map state is preserved.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const doResize = () => {
      if (mapRef.current === map && map.resize) map.resize();
    };
    const rafId = requestAnimationFrame(doResize);
    const timeoutId = setTimeout(doResize, 200);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };
  }, [leftCollapsed, rightCollapsed, bottomCollapsed]);

  const toggleTilt = () => {
    const next = !tilted;
    mapRef.current?.easeTo?.({
      pitch: next ? 48 : 0,
      bearing: next ? -18 : 0,
      duration: 500,
    });
    setTilted(next);
  };

  const setFromContextMenu = (which: "start" | "dest") => {
    if (!contextMenu) return;
    const coord: Coordinate = {
      lat: contextMenu.lngLat.lat,
      lon: contextMenu.lngLat.lng,
    };
    if (which === "start") {
      setStart(coord);
    } else {
      setDest(coord);
    }
    setContextMenu(null);
  };

  return (
    <div className="map-view" data-testid="map-view" aria-label="Map">
      <div ref={containerRef} className="map-view__canvas" data-testid="map-canvas" />
      <button
        type="button"
        className={"map-tilt" + (tilted ? " map-tilt--active" : "")}
        aria-pressed={tilted}
        title="Tilt the map camera. True 3D buildings require a vector building source."
        onClick={toggleTilt}
      >
        {tilted ? "2D view" : "Tilt map"}
      </button>
      <EdgeDebugInspector />
      {contextMenu && (
        <div
          className="map-context-menu"
          role="menu"
          data-testid="map-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="map-context-menu__item"
            onClick={() => setFromContextMenu("start")}
          >
            Set as Start
          </button>
          <button
            type="button"
            role="menuitem"
            className="map-context-menu__item"
            onClick={() => setFromContextMenu("dest")}
          >
            Set as Destination
          </button>
        </div>
      )}
    </div>
  );
}

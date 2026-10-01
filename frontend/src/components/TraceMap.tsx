import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useStore } from "../store";
import type { CompareDebug, NormalizedRoute } from "../types";
import {
  attachDashboardMapLifecycle,
  dashboardMapOptions,
} from "../map/initialize";
import { computeBounds } from "../map/fit";
import {
  buildDebugSegmentsFeatureCollection,
} from "../map/debugSegments";
import {
  debugHighlightLayerSpec,
  debugHitLayerSpec,
  DEBUG_HIT_LAYER_ID,
} from "../map/layers";
import {
  resolveDebugSegmentIds,
  type RenderedDebugFeature,
} from "../map/debugHitTest";
import EdgeDebugInspector from "./EdgeDebugInspector";

const TRACE_ROUTES_SOURCE = "trace-inspector-routes";
const TRACE_DEBUG_SOURCE = "trace-inspector-debug";

export function buildTraceRoutesFeatureCollection(
  source: NormalizedRoute | undefined,
  traced: [number, number][] | undefined,
) {
  const features = [];
  if (source) {
    features.push({
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates: source.coordinates },
      properties: { kind: "original" },
    });
  }
  if (traced?.length) {
    features.push({
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates: traced },
      properties: { kind: "trace" },
    });
  }
  return { type: "FeatureCollection" as const, features };
}

export function fitTraceMap(
  map: maplibregl.Map,
  source: NormalizedRoute | undefined,
  traced: [number, number][] | undefined,
) {
  const coordinates = [
    ...(source?.coordinates ?? []),
    ...(traced ?? []),
  ];
  const bounds = computeBounds(coordinates);
  if (!bounds) return;
  const [[minLon, minLat], [maxLon, maxLat]] = bounds;
  if (minLon === maxLon && minLat === maxLat) {
    map.easeTo?.({ center: [minLon, minLat], zoom: 14, duration: 300 });
  } else {
    map.fitBounds?.(bounds, { padding: 56, maxZoom: 16, duration: 300 });
  }
}

export default function TraceMap({
  sourceRoute,
  compactDetails = false,
  layoutRevision = 0,
}: {
  sourceRoute?: NormalizedRoute;
  compactDetails?: boolean;
  layoutRevision?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const previousActiveIds = useRef<string[]>([]);
  const [tilted, setTilted] = useState(false);

  const result = useStore((state) => state.traceResult);
  const hoveredIds = useStore((state) => state.traceHoveredSegmentIds);
  const pinnedIds = useStore((state) => state.tracePinnedSegmentIds);
  const fitRequestId = useStore((state) => state.traceFitRequestId);
  const setHovered = useStore((state) => state.setTraceHoveredSegmentIds);
  const pinHovered = useStore((state) => state.pinTraceHoveredSegments);

  const traceRouteId = sourceRoute ? `trace:${sourceRoute.id}` : "trace:none";
  const usableResult =
    result && result.sourceRouteId === sourceRoute?.id ? result : null;
  const visibility = useMemo(() => ({ [traceRouteId]: true }), [traceRouteId]);
  const routeLabels = useMemo(
    () => ({
      [traceRouteId]: sourceRoute
        ? `Valhalla map-match of ${sourceRoute.label}`
        : "Valhalla map-match",
    }),
    [sourceRoute, traceRouteId],
  );
  const debug = useMemo<CompareDebug | null>(
    () =>
      usableResult
        ? {
            osrm: { engine: "osrm", status: "ok", segments: [], errors: [] },
            valhalla: {
              engine: "valhalla",
              status: usableResult.status === "error" ? "error" : usableResult.status,
              segments: usableResult.segments,
              errors: usableResult.errors,
            },
          }
        : null,
    [usableResult],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new maplibregl.Map(dashboardMapOptions(container));
    mapRef.current = map;
    if (import.meta.env.DEV || import.meta.env.VITE_EXPOSE_MAP === "1") {
      (window as unknown as { __traceMap?: unknown }).__traceMap = map;
    }
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    const detachMapLifecycle = attachDashboardMapLifecycle(
      map,
      container,
      "TraceMap",
    );

    let hoverFrame: number | null = null;
    const onMove = (event: maplibregl.MapMouseEvent) => {
      if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
      const { x, y } = event.point;
      const point: [number, number] = [event.lngLat.lng, event.lngLat.lat];
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = null;
        let features: maplibregl.MapGeoJSONFeature[] = [];
        try {
          features = map.queryRenderedFeatures(
            [[x - 6, y - 6], [x + 6, y + 6]],
            { layers: [DEBUG_HIT_LAYER_ID] },
          );
        } catch {
          // Trace edge layers are created lazily after a successful trace.
        }
        setHovered(
          resolveDebugSegmentIds(
            features as unknown as RenderedDebugFeature[],
            { [useStore.getState().traceResult?.sourceRouteId
                ? `trace:${useStore.getState().traceResult?.sourceRouteId}`
                : "trace:none"]: true },
          ),
          point,
        );
      });
    };
    const onLeave = () => setHovered([], null);
    const onClick = () => {
      if (useStore.getState().traceHoveredSegmentIds.length) pinHovered();
    };

    map.on("mousemove", onMove);
    map.on("mouseleave", onLeave);
    map.on("click", onClick);
    return () => {
      detachMapLifecycle();
      if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
      map.off("mousemove", onMove);
      map.off("mouseleave", onLeave);
      map.off("click", onClick);
      map.remove();
      mapRef.current = null;
      if (import.meta.env.DEV || import.meta.env.VITE_EXPOSE_MAP === "1") {
        delete (window as unknown as { __traceMap?: unknown }).__traceMap;
      }
    };
  }, [pinHovered, setHovered]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const data = buildTraceRoutesFeatureCollection(
      sourceRoute,
      usableResult?.traceGeometry,
    );
    if (import.meta.env.DEV) {
      console.debug("[TraceMap] route GeoJSON", {
        featureCount: data.features.length,
        originalPointCount: sourceRoute?.coordinates.length ?? 0,
        tracePointCount: usableResult?.traceGeometry.length ?? 0,
        firstOriginalCoordinate: sourceRoute?.coordinates[0] ?? null,
        firstTraceCoordinate: usableResult?.traceGeometry[0] ?? null,
      });
    }

    const apply = () => {
      // Snapshot readiness before mutating the style. MapLibre can report
      // isStyleLoaded() === false immediately after addSource()/setData(), even
      // though addLayer() is valid in the same ready-style transaction.
      const styleWasReady = Boolean(map.isStyleLoaded?.());
      const existing = map.getSource(TRACE_ROUTES_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined;

      // Match the proven main-map lifecycle: existing sources accept setData
      // even while isStyleLoaded() is transiently false. Only source/layer
      // creation must wait for the style.
      if (existing) {
        existing.setData(data as unknown as GeoJSON.FeatureCollection);
      } else {
        if (!styleWasReady) {
          map.once?.("idle", apply);
          return;
        }
        map.addSource(TRACE_ROUTES_SOURCE, {
          type: "geojson",
          data: data as unknown as GeoJSON.FeatureCollection,
        });
      }

      if (!styleWasReady) {
        map.once?.("idle", apply);
        return;
      }
      if (!map.getLayer("trace-original-route")) {
        map.addLayer({
          id: "trace-original-route",
          type: "line",
          source: TRACE_ROUTES_SOURCE,
          filter: ["==", ["get", "kind"], "original"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#2563eb",
            "line-width": 7,
            "line-opacity": 0.72,
            "line-dasharray": [2, 1.5],
          },
        } as maplibregl.LayerSpecification);
      }
      if (!map.getLayer("trace-snapped-route")) {
        map.addLayer({
          id: "trace-snapped-route",
          type: "line",
          source: TRACE_ROUTES_SOURCE,
          filter: ["==", ["get", "kind"], "trace"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#f97316",
            "line-width": 4,
            "line-opacity": 0.96,
          },
        } as maplibregl.LayerSpecification);
      }
      fitTraceMap(map, sourceRoute, usableResult?.traceGeometry);
    };

    map.on("style.load", apply);
    const canApplyNow =
      Boolean(map.getSource(TRACE_ROUTES_SOURCE)) ||
      Boolean(map.isStyleLoaded?.());
    if (canApplyNow) apply();
    else map.once?.("idle", apply);

    return () => {
      map.off("style.load", apply);
      map.off?.("idle", apply);
    };
  }, [sourceRoute, usableResult]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const data = buildDebugSegmentsFeatureCollection(debug, visibility);

    const apply = () => {
      const styleWasReady = Boolean(map.isStyleLoaded?.());
      const existing = map.getSource(TRACE_DEBUG_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) {
        existing.setData(data as unknown as GeoJSON.FeatureCollection);
      } else {
        if (!styleWasReady) {
          map.once?.("idle", apply);
          return;
        }
        map.addSource(TRACE_DEBUG_SOURCE, {
          type: "geojson",
          promoteId: "debugSegmentId",
          data: data as unknown as GeoJSON.FeatureCollection,
        });
      }

      if (!styleWasReady) {
        map.once?.("idle", apply);
        return;
      }
      if (!map.getLayer(debugHighlightLayerSpec(TRACE_DEBUG_SOURCE).id)) {
        map.addLayer(
          debugHighlightLayerSpec(
            TRACE_DEBUG_SOURCE,
          ) as maplibregl.LayerSpecification,
        );
      }
      if (!map.getLayer(debugHitLayerSpec(TRACE_DEBUG_SOURCE).id)) {
        map.addLayer(
          debugHitLayerSpec(TRACE_DEBUG_SOURCE) as maplibregl.LayerSpecification,
        );
      }

      const state = useStore.getState();
      const active = Array.from(
        new Set([
          ...state.traceHoveredSegmentIds,
          ...state.tracePinnedSegmentIds,
        ]),
      );
      for (const id of active) {
        map.setFeatureState(
          { source: TRACE_DEBUG_SOURCE, id },
          {
            hovered: state.traceHoveredSegmentIds.includes(id),
            pinned: state.tracePinnedSegmentIds.includes(id),
          },
        );
      }
      previousActiveIds.current = active;
    };

    map.on("style.load", apply);
    const canApplyNow =
      Boolean(map.getSource(TRACE_DEBUG_SOURCE)) ||
      Boolean(map.isStyleLoaded?.());
    if (canApplyNow) apply();
    else map.once?.("idle", apply);

    return () => {
      map.off("style.load", apply);
      map.off?.("idle", apply);
    };
  }, [debug, visibility]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(TRACE_DEBUG_SOURCE)) return;
    for (const id of previousActiveIds.current) {
      map.setFeatureState(
        { source: TRACE_DEBUG_SOURCE, id },
        { hovered: false, pinned: false },
      );
    }
    const active = Array.from(new Set([...hoveredIds, ...pinnedIds]));
    for (const id of active) {
      map.setFeatureState(
        { source: TRACE_DEBUG_SOURCE, id },
        { hovered: hoveredIds.includes(id), pinned: pinnedIds.includes(id) },
      );
    }
    previousActiveIds.current = active;
  }, [hoveredIds, pinnedIds]);

  const previousFitRequestId = useRef(fitRequestId);
  useEffect(() => {
    if (previousFitRequestId.current === fitRequestId) return;
    previousFitRequestId.current = fitRequestId;
    const map = mapRef.current;
    if (!map) return;
    map.resize();
    const apply = () =>
      fitTraceMap(map, sourceRoute, usableResult?.traceGeometry);
    if (map.isStyleLoaded?.()) {
      apply();
      return;
    }
    map.once?.("style.load", apply);
    return () => {
      map.off?.("style.load", apply);
    };
  }, [fitRequestId, sourceRoute, usableResult]);

  // The drawer changes the map row over a short CSS transition. Resize once
  // immediately, once after React commits layout, and once when that transition
  // has settled. ResizeObserver remains the primary path for other size changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const resize = () => {
      if (mapRef.current === map) map.resize();
    };
    resize();
    const frame = requestAnimationFrame(resize);
    const settled = setTimeout(resize, 200);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settled);
    };
  }, [compactDetails, layoutRevision]);

  const toggleTilt = () => {
    const next = !tilted;
    mapRef.current?.easeTo?.({
      pitch: next ? 48 : 0,
      bearing: next ? -18 : 0,
      duration: 500,
    });
    setTilted(next);
  };

  return (
    <div className="trace-map" aria-label="Trace Inspector map" data-testid="trace-map">
      <div ref={containerRef} className="trace-map__canvas" />
      <div className="trace-map__legend" aria-label="Trace map legend">
        <span><i className="trace-map__swatch trace-map__swatch--original" />Original OSRM</span>
        <span><i className="trace-map__swatch trace-map__swatch--snapped" />Valhalla map-match</span>
      </div>
      <button
        type="button"
        className={"map-tilt" + (tilted ? " map-tilt--active" : "")}
        aria-pressed={tilted}
        onClick={toggleTilt}
      >
        {tilted ? "2D view" : "Tilt map"}
      </button>
      <EdgeDebugInspector
        enabled={Boolean(debug)}
        debug={debug}
        routeLabels={routeLabels}
        visibility={visibility}
        hoveredIds={hoveredIds}
        valhallaHeading="VALHALLA TRACE OF OSRM"
      />
    </div>
  );
}

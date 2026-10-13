import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useStore } from "../store";
import type { CompareDebug, NormalizedRoute, TraceMatchedPoint } from "../types";
import {
  attachDashboardMapLifecycle,
  dashboardMapOptions,
} from "../map/initialize";
import { computeBounds } from "../map/fit";
import { readMapCamera, restoreMapCamera } from "../map/camera";
import {
  buildDebugSegmentsFeatureCollection,
} from "../map/debugSegments";
import { buildAnalysisMatchesFeatureCollection } from "../map/analysisMatches";
import { buildAnalysisFocusFeatureCollection } from "../map/analysisFocus";
import {
  debugHighlightLayerSpec,
  debugHitLayerSpec,
  DEBUG_HIT_LAYER_ID,
  analysisMatchGlowLayerSpec,
  analysisMatchLayerSpec,
  analysisFocusGlowLayerSpec,
  analysisFocusLayerSpec,
} from "../map/layers";
import {
  buildTraceContinuityFeatureCollection,
  buildTraceMatchedPointsFeatureCollection,
} from "../map/traceDiagnostics";
import {
  resolveDebugSegmentIds,
  type RenderedDebugFeature,
} from "../map/debugHitTest";
import EdgeDebugInspector from "./EdgeDebugInspector";

const TRACE_ROUTES_SOURCE = "trace-inspector-routes";
const TRACE_DEBUG_SOURCE = "trace-inspector-debug";
export const TRACE_MATCHED_POINTS_SOURCE = "trace-matched-points";
export const TRACE_MATCHED_POINTS_LAYER = "trace-matched-points-circle";
export const TRACE_MATCHED_POINTS_RING_LAYER = "trace-matched-points-ring";
export const TRACE_CONTINUITY_SOURCE = "trace-continuity";
export const TRACE_CONTINUITY_COMPONENT_LAYER = "trace-continuity-components";
export const TRACE_CONTINUITY_CONNECTOR_LAYER = "trace-continuity-connectors";
export const TRACE_CONTINUITY_ENDPOINT_LAYER = "trace-continuity-endpoints";
const TRACE_COMPONENT_COLORS = ["#0f766e", "#7c3aed", "#db2777", "#0891b2"];
export const TRACE_ANALYSIS_MATCHES_SOURCE = "trace-analysis-matches";
export const TRACE_ANALYSIS_FOCUS_SOURCE = "trace-analysis-focus";
export const TRACE_ANALYSIS_MATCHES_GLOW_LAYER = "trace-analysis-matches-glow";
export const TRACE_ANALYSIS_MATCHES_LAYER = "trace-analysis-matches-line";
export const TRACE_ANALYSIS_FOCUS_GLOW_LAYER = "trace-analysis-focus-glow";
export const TRACE_ANALYSIS_FOCUS_LAYER = "trace-analysis-focus-line";

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
  const pendingResultFitRef = useRef(false);
  const handledTraceRevisionRef = useRef<number | null>(null);

  const result = useStore((state) => state.traceResult);
  const hoveredIds = useStore((state) => state.traceHoveredSegmentIds);
  const pinnedIds = useStore((state) => state.tracePinnedSegmentIds);
  const fitRequestId = useStore((state) => state.traceFitRequestId);
  const setHovered = useStore((state) => state.setTraceHoveredSegmentIds);
  const pinHovered = useStore((state) => state.pinTraceHoveredSegments);
  const hoveredMatchedPointIndex = useStore(
    (state) => state.traceHoveredMatchedPointIndex,
  );
  const pinnedMatchedPointIndex = useStore(
    (state) => state.tracePinnedMatchedPointIndex,
  );
  const continuityOverlay = useStore(
    (state) => state.traceContinuityOverlayEnabled,
  );
  const setHoveredMatchedPoint = useStore(
    (state) => state.setTraceHoveredMatchedPoint,
  );
  const pinMatchedPoint = useStore((state) => state.pinTraceMatchedPoint);
  const clearMatchedPoint = useStore((state) => state.clearTraceMatchedPoint);

  const traceResultRevision = useStore((state) => state.traceResultRevision);
  const traceAnalysisExecutedSearch = useStore(
    (state) => state.traceAnalysisExecutedSearch,
  );
  const traceAnalysisFocusedSegmentId = useStore(
    (state) => state.traceAnalysisFocusedSegmentId,
  );

  const [tilted, setTilted] = useState(() => {
    const state = useStore.getState();
    return (
      state.traceInspectorCameraResultRevision === state.traceResultRevision &&
      Boolean(
        state.traceInspectorCamera?.pitch ||
          state.traceInspectorCamera?.bearing,
      )
    );
  });

  const traceRouteId = sourceRoute ? `trace:${sourceRoute.id}` : "trace:none";
  const usableResult =
    result && result.sourceRouteId === sourceRoute?.id ? result : null;
  const activeMatchedPoint = useMemo<TraceMatchedPoint | null>(() => {
    const index = pinnedMatchedPointIndex ?? hoveredMatchedPointIndex;
    if (index == null) return null;
    return (
      usableResult?.matchedPoints.find((point) => point.index === index) ?? null
    );
  }, [
    hoveredMatchedPointIndex,
    pinnedMatchedPointIndex,
    usableResult,
  ]);

  const visibility = useMemo(() => ({ [traceRouteId]: true }), [traceRouteId]);
  const routeLabels = useMemo(
    () => ({
      [traceRouteId]: sourceRoute
        ? `Valhalla map-match of ${sourceRoute.label}`
        : "Valhalla map-match",
    }),
    [sourceRoute, traceRouteId],
  );
  const debugSegmentLookup = useMemo(
    () =>
      new Map(
        (usableResult?.segments ?? []).map((segment) => [segment.id, segment]),
      ),
    [usableResult],
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

    const saveCamera = (updateTiltButton: boolean) => {
      const camera = readMapCamera(map);
      if (!camera) return;
      pendingResultFitRef.current = false;
      useStore.getState().setTraceInspectorCamera(camera);
      if (updateTiltButton) {
        setTilted(camera.pitch !== 0 || camera.bearing !== 0);
      }
    };
    const handleMoveEnd = () => saveCamera(true);
    map.on("moveend", handleMoveEnd);

    const cameraState = useStore.getState();
    if (
      cameraState.traceInspectorCamera &&
      cameraState.traceInspectorCameraResultRevision ===
        cameraState.traceResultRevision
    ) {
      restoreMapCamera(map, cameraState.traceInspectorCamera);
    }

    let hoverFrame: number | null = null;
    const onMove = (event: maplibregl.MapMouseEvent) => {
      if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
      const { x, y } = event.point;
      const point: [number, number] = [event.lngLat.lng, event.lngLat.lat];
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = null;
        let pointFeatures: maplibregl.MapGeoJSONFeature[] = [];
        try {
          pointFeatures = map.queryRenderedFeatures(
            [[x - 6, y - 6], [x + 6, y + 6]],
            { layers: [TRACE_MATCHED_POINTS_LAYER] },
          );
        } catch {
          // Matched-point layers are created lazily with trace diagnostics.
        }
        const matchedIndex = Number(pointFeatures[0]?.properties?.index);
        const matchedPoint = Number.isInteger(matchedIndex)
          ? useStore
              .getState()
              .traceResult?.matchedPoints.find(
                (candidate) => candidate.index === matchedIndex,
              ) ?? null
          : null;
        setHoveredMatchedPoint(matchedPoint);
        if (matchedPoint) {
          setHovered([], null);
          return;
        }

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
    const onLeave = () => {
      setHoveredMatchedPoint(null);
      setHovered([], null);
    };
    const onClick = () => {
      const state = useStore.getState();
      const matchedIndex = state.traceHoveredMatchedPointIndex;
      if (matchedIndex != null) {
        const matchedPoint =
          state.traceResult?.matchedPoints.find(
            (candidate) => candidate.index === matchedIndex,
          ) ?? null;
        pinMatchedPoint(matchedPoint);
        return;
      }
      if (state.traceHoveredSegmentIds.length) pinHovered();
    };

    map.on("mousemove", onMove);
    map.on("mouseleave", onLeave);
    map.on("click", onClick);
    return () => {
      detachMapLifecycle();
      if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
      map.off("mousemove", onMove);
      map.off("mouseleave", onLeave);
      if (!pendingResultFitRef.current) {
        saveCamera(false);
      }
      map.off("moveend", handleMoveEnd);
      map.off("click", onClick);
      map.remove();
      mapRef.current = null;
      if (import.meta.env.DEV || import.meta.env.VITE_EXPOSE_MAP === "1") {
        delete (window as unknown as { __traceMap?: unknown }).__traceMap;
      }
    };
  }, [
    pinHovered,
    pinMatchedPoint,
    setHovered,
    setHoveredMatchedPoint,
  ]);

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

  // A new source/result revision fits once. A navigation remount with the same
  // revision restores its saved camera in the initialization effect instead.
  useEffect(() => {
    if (handledTraceRevisionRef.current === traceResultRevision) return;
    handledTraceRevisionRef.current = traceResultRevision;

    const map = mapRef.current;
    if (!map) return;
    const state = useStore.getState();
    if (
      state.traceInspectorCamera &&
      state.traceInspectorCameraResultRevision === traceResultRevision
    ) {
      return;
    }
    const coordinates = [
      ...(sourceRoute?.coordinates ?? []),
      ...(usableResult?.traceGeometry ?? []),
    ];
    if (coordinates.length === 0) return;
    pendingResultFitRef.current = true;
    fitTraceMap(map, sourceRoute, usableResult?.traceGeometry);
  }, [sourceRoute, traceResultRevision, usableResult]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let waitingForIdle = false;
    const handleIdle = () => {
      waitingForIdle = false;
      apply();
    };
    const scheduleWhenStyleSettles = () => {
      if (waitingForIdle || !map.once) return;
      waitingForIdle = true;
      map.once("idle", handleIdle);
    };

    const apply = () => {
      const search =
        traceAnalysisExecutedSearch?.traceResultRevision === traceResultRevision &&
        traceAnalysisExecutedSearch.routeId === traceRouteId
          ? traceAnalysisExecutedSearch
          : null;
      const existing = map.getSource(TRACE_ANALYSIS_MATCHES_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (!search && !existing) return;

      const styleWasReady = Boolean(map.isStyleLoaded?.());
      const data = buildAnalysisMatchesFeatureCollection(
        search?.routeId ?? null,
        search?.result ?? null,
        Boolean(search),
      );
      if (existing) {
        existing.setData(data as unknown as GeoJSON.FeatureCollection);
      } else {
        if (!styleWasReady) {
          scheduleWhenStyleSettles();
          return;
        }
        map.addSource(TRACE_ANALYSIS_MATCHES_SOURCE, {
          type: "geojson",
          promoteId: "debugSegmentId",
          data: data as unknown as GeoJSON.FeatureCollection,
        });
      }
      if (!styleWasReady) {
        scheduleWhenStyleSettles();
        return;
      }

      const beforeFocusOrDebug = map.getLayer(TRACE_ANALYSIS_FOCUS_GLOW_LAYER)
        ? TRACE_ANALYSIS_FOCUS_GLOW_LAYER
        : map.getLayer(debugHighlightLayerSpec(TRACE_DEBUG_SOURCE).id)
          ? debugHighlightLayerSpec(TRACE_DEBUG_SOURCE).id
          : undefined;
      if (!map.getLayer(TRACE_ANALYSIS_MATCHES_GLOW_LAYER)) {
        const layer = analysisMatchGlowLayerSpec(
          TRACE_ANALYSIS_MATCHES_SOURCE,
          TRACE_ANALYSIS_MATCHES_GLOW_LAYER,
        ) as maplibregl.LayerSpecification;
        if (beforeFocusOrDebug) map.addLayer(layer, beforeFocusOrDebug);
        else map.addLayer(layer);
      }
      if (!map.getLayer(TRACE_ANALYSIS_MATCHES_LAYER)) {
        const layer = analysisMatchLayerSpec(
          TRACE_ANALYSIS_MATCHES_SOURCE,
          TRACE_ANALYSIS_MATCHES_LAYER,
        ) as maplibregl.LayerSpecification;
        if (beforeFocusOrDebug) map.addLayer(layer, beforeFocusOrDebug);
        else map.addLayer(layer);
      }
    };

    map.on("style.load", apply);
    if (
      map.getSource(TRACE_ANALYSIS_MATCHES_SOURCE) ||
      map.isStyleLoaded?.()
    ) {
      apply();
    } else {
      scheduleWhenStyleSettles();
    }
    return () => {
      map.off("style.load", apply);
      if (waitingForIdle) map.off("idle", handleIdle);
    };
  }, [
    traceAnalysisExecutedSearch,
    traceResultRevision,
    traceRouteId,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let waitingForIdle = false;
    const handleIdle = () => {
      waitingForIdle = false;
      apply();
    };
    const scheduleWhenStyleSettles = () => {
      if (waitingForIdle || !map.once) return;
      waitingForIdle = true;
      map.once("idle", handleIdle);
    };

    const apply = () => {
      const existing = map.getSource(TRACE_ANALYSIS_FOCUS_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (!traceAnalysisFocusedSegmentId && !existing) return;

      const styleWasReady = Boolean(map.isStyleLoaded?.());
      const data = buildAnalysisFocusFeatureCollection(
        traceAnalysisFocusedSegmentId,
        traceRouteId,
        debugSegmentLookup,
        true,
      );
      if (existing) {
        existing.setData(data as unknown as GeoJSON.FeatureCollection);
      } else {
        if (!styleWasReady) {
          scheduleWhenStyleSettles();
          return;
        }
        map.addSource(TRACE_ANALYSIS_FOCUS_SOURCE, {
          type: "geojson",
          promoteId: "debugSegmentId",
          data: data as unknown as GeoJSON.FeatureCollection,
        });
      }
      if (!styleWasReady) {
        scheduleWhenStyleSettles();
        return;
      }

      const beforeDebug = map.getLayer(
        debugHighlightLayerSpec(TRACE_DEBUG_SOURCE).id,
      )
        ? debugHighlightLayerSpec(TRACE_DEBUG_SOURCE).id
        : undefined;
      if (!map.getLayer(TRACE_ANALYSIS_FOCUS_GLOW_LAYER)) {
        const layer = analysisFocusGlowLayerSpec(
          TRACE_ANALYSIS_FOCUS_SOURCE,
          TRACE_ANALYSIS_FOCUS_GLOW_LAYER,
        ) as maplibregl.LayerSpecification;
        if (beforeDebug) map.addLayer(layer, beforeDebug);
        else map.addLayer(layer);
      }
      if (!map.getLayer(TRACE_ANALYSIS_FOCUS_LAYER)) {
        const layer = analysisFocusLayerSpec(
          TRACE_ANALYSIS_FOCUS_SOURCE,
          TRACE_ANALYSIS_FOCUS_LAYER,
        ) as maplibregl.LayerSpecification;
        if (beforeDebug) map.addLayer(layer, beforeDebug);
        else map.addLayer(layer);
      }
    };

    map.on("style.load", apply);
    if (
      map.getSource(TRACE_ANALYSIS_FOCUS_SOURCE) ||
      map.isStyleLoaded?.()
    ) {
      apply();
    } else {
      scheduleWhenStyleSettles();
    }
    return () => {
      map.off("style.load", apply);
      if (waitingForIdle) map.off("idle", handleIdle);
    };
  }, [
    debugSegmentLookup,
    traceAnalysisFocusedSegmentId,
    traceRouteId,
  ]);

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
    if (!map) return;
    const data = buildTraceMatchedPointsFeatureCollection(
      usableResult?.matchedPoints ?? [],
    );

    const apply = () => {
      const styleWasReady = Boolean(map.isStyleLoaded?.());
      const existing = map.getSource(TRACE_MATCHED_POINTS_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) {
        existing.setData(data as unknown as GeoJSON.FeatureCollection);
      } else {
        if (!styleWasReady) {
          map.once?.("idle", apply);
          return;
        }
        map.addSource(TRACE_MATCHED_POINTS_SOURCE, {
          type: "geojson",
          data: data as unknown as GeoJSON.FeatureCollection,
        });
      }
      if (!styleWasReady) {
        map.once?.("idle", apply);
        return;
      }
      if (!map.getLayer(TRACE_MATCHED_POINTS_RING_LAYER)) {
        map.addLayer({
          id: TRACE_MATCHED_POINTS_RING_LAYER,
          type: "circle",
          source: TRACE_MATCHED_POINTS_SOURCE,
          filter: ["==", ["get", "hasPointDiscontinuity"], true],
          paint: {
            "circle-color": "#f59e0b",
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 6, 16, 11],
            "circle-opacity": 0.95,
          },
        } as maplibregl.LayerSpecification);
      }
      if (!map.getLayer(TRACE_MATCHED_POINTS_LAYER)) {
        map.addLayer({
          id: TRACE_MATCHED_POINTS_LAYER,
          type: "circle",
          source: TRACE_MATCHED_POINTS_SOURCE,
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3, 16, 7],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1,
            "circle-opacity": 0.96,
          },
        } as maplibregl.LayerSpecification);
      }
    };

    map.on("style.load", apply);
    if (map.getSource(TRACE_MATCHED_POINTS_SOURCE) || map.isStyleLoaded?.()) {
      apply();
    } else {
      map.once?.("idle", apply);
    }
    return () => {
      map.off("style.load", apply);
      map.off?.("idle", apply);
    };
  }, [usableResult?.matchedPoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const data = buildTraceContinuityFeatureCollection(
      continuityOverlay ? (usableResult?.traceRouteComponents ?? []) : [],
      continuityOverlay ? (usableResult?.continuity.breaks ?? []) : [],
    );

    const apply = () => {
      const styleWasReady = Boolean(map.isStyleLoaded?.());
      const existing = map.getSource(TRACE_CONTINUITY_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) {
        existing.setData(data as unknown as GeoJSON.FeatureCollection);
      } else {
        if (!styleWasReady) {
          map.once?.("idle", apply);
          return;
        }
        map.addSource(TRACE_CONTINUITY_SOURCE, {
          type: "geojson",
          data: data as unknown as GeoJSON.FeatureCollection,
        });
      }
      if (!styleWasReady) {
        map.once?.("idle", apply);
        return;
      }
      const beforeMatched = map.getLayer(TRACE_MATCHED_POINTS_RING_LAYER)
        ? TRACE_MATCHED_POINTS_RING_LAYER
        : undefined;
      if (!map.getLayer(TRACE_CONTINUITY_COMPONENT_LAYER)) {
        map.addLayer({
          id: TRACE_CONTINUITY_COMPONENT_LAYER,
          type: "line",
          source: TRACE_CONTINUITY_SOURCE,
          filter: ["==", ["get", "kind"], "component"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": [
              "match",
              ["%", ["get", "componentIndex"], TRACE_COMPONENT_COLORS.length],
              0, TRACE_COMPONENT_COLORS[0],
              1, TRACE_COMPONENT_COLORS[1],
              2, TRACE_COMPONENT_COLORS[2],
              TRACE_COMPONENT_COLORS[3],
            ],
            "line-width": 6,
            "line-opacity": 0.88,
          },
        } as maplibregl.LayerSpecification, beforeMatched);
      }
      if (!map.getLayer(TRACE_CONTINUITY_CONNECTOR_LAYER)) {
        map.addLayer({
          id: TRACE_CONTINUITY_CONNECTOR_LAYER,
          type: "line",
          source: TRACE_CONTINUITY_SOURCE,
          filter: ["==", ["get", "kind"], "break-connector"],
          layout: { "line-cap": "round" },
          paint: {
            "line-color": "#b45309",
            "line-width": 3,
            "line-dasharray": [1.5, 1.5],
            "line-opacity": 0.9,
          },
        } as maplibregl.LayerSpecification, beforeMatched);
      }
      if (!map.getLayer(TRACE_CONTINUITY_ENDPOINT_LAYER)) {
        map.addLayer({
          id: TRACE_CONTINUITY_ENDPOINT_LAYER,
          type: "circle",
          source: TRACE_CONTINUITY_SOURCE,
          filter: ["==", ["get", "kind"], "break-end"],
          paint: {
            "circle-color": "#f59e0b",
            "circle-radius": 7,
            "circle-stroke-color": "#7c2d12",
            "circle-stroke-width": 2,
          },
        } as maplibregl.LayerSpecification, beforeMatched);
      }
    };

    map.on("style.load", apply);
    if (map.getSource(TRACE_CONTINUITY_SOURCE) || map.isStyleLoaded?.()) {
      apply();
    } else {
      map.once?.("idle", apply);
    }
    return () => {
      map.off("style.load", apply);
      map.off?.("idle", apply);
    };
  }, [
    continuityOverlay,
    usableResult?.continuity.breaks,
    usableResult?.traceRouteComponents,
  ]);

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
    pendingResultFitRef.current = true;
    fitTraceMap(map, sourceRoute, usableResult?.traceGeometry);
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
        <span><i className="trace-map__dot trace-map__dot--matched" />Matched</span>
        <span><i className="trace-map__dot trace-map__dot--interpolated" />Interpolated</span>
        <span><i className="trace-map__dot trace-map__dot--unmatched" />Unmatched</span>
        <span><i className="trace-map__ring" />Point discontinuity</span>
        {continuityOverlay ? (
          <>
            <span><i className="trace-map__swatch trace-map__swatch--component" />Trace-route components</span>
            <span><i className="trace-map__dot trace-map__dot--break" />Break endpoints</span>
            <span><i className="trace-map__swatch trace-map__swatch--gap" />Break gap — diagnostic, not routed</span>
          </>
        ) : null}
      </div>
      {activeMatchedPoint ? (
        <aside className="trace-point-card" aria-label="Matched point details">
          <header>
            <strong>MATCHED POINT</strong>
            {pinnedMatchedPointIndex != null ? (
              <button
                type="button"
                aria-label="Close matched point details"
                onClick={clearMatchedPoint}
              >
                ×
              </button>
            ) : null}
          </header>
          <dl>
            <div><dt>Type</dt><dd>{activeMatchedPoint.type}</dd></div>
            <div><dt>Point index</dt><dd>{activeMatchedPoint.index}</dd></div>
            <div><dt>Edge index</dt><dd>{activeMatchedPoint.edgeIndex ?? "Unavailable"}</dd></div>
            <div><dt>Distance along edge</dt><dd>{activeMatchedPoint.distanceAlongEdge ?? "Unavailable"}</dd></div>
            <div><dt>Distance from trace point</dt><dd>{activeMatchedPoint.distanceFromTracePoint ?? "Unavailable"}</dd></div>
            <div><dt>Begin route discontinuity</dt><dd>{activeMatchedPoint.beginRouteDiscontinuity ? "Yes" : "No"}</dd></div>
            <div><dt>End route discontinuity</dt><dd>{activeMatchedPoint.endRouteDiscontinuity ? "Yes" : "No"}</dd></div>
          </dl>
        </aside>
      ) : null}
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

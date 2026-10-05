import type { DebugSegment } from "../types";

export const ANALYSIS_FOCUS_SOURCE_ID = "route-analysis-focus";

export interface AnalysisFocusFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: {
    debugSegmentId: string;
    routeId: string;
    engine: DebugSegment["engine"];
    segmentIndex: number;
  };
}

export interface AnalysisFocusFeatureCollection {
  type: "FeatureCollection";
  features: AnalysisFocusFeature[];
}

/** Build zero-or-one exact edge geometry with no copied edge-property payload. */
export function buildAnalysisFocusFeatureCollection(
  focusedSegmentId: string | null,
  activeRouteId: string | null,
  segmentLookup: ReadonlyMap<string, DebugSegment>,
  routeVisible: boolean,
): AnalysisFocusFeatureCollection {
  if (!focusedSegmentId || !activeRouteId || !routeVisible) {
    return { type: "FeatureCollection", features: [] };
  }
  const segment = segmentLookup.get(focusedSegmentId);
  if (!segment || segment.routeId !== activeRouteId) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "LineString", coordinates: segment.coordinates },
      properties: {
        debugSegmentId: segment.id,
        routeId: segment.routeId,
        engine: segment.engine,
        segmentIndex: segment.segmentIndex,
      },
    }],
  };
}

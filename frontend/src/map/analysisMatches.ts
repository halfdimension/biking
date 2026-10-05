import type { RouteQueryResult } from "../analysis/routeQuery";
import type { Engine } from "../types";

export const ANALYSIS_MATCHES_SOURCE_ID = "route-analysis-matches";

export interface AnalysisMatchFeatureProperties {
  debugSegmentId: string;
  routeId: string;
  engine: Engine;
  segmentIndex: number;
}

export interface AnalysisMatchFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: AnalysisMatchFeatureProperties;
}

export interface AnalysisMatchesFeatureCollection {
  type: "FeatureCollection";
  features: AnalysisMatchFeature[];
}

/** Build match-only geometry without copying any debug property payload. */
export function buildAnalysisMatchesFeatureCollection(
  routeId: string | null,
  result: RouteQueryResult | null,
  routeVisible: boolean,
): AnalysisMatchesFeatureCollection {
  if (!routeId || !result || !routeVisible) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "FeatureCollection",
    features: result.matchingSegments
      .filter((item) => item.routeId === routeId)
      .map((item) => ({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: item.segment.coordinates,
        },
        properties: {
          debugSegmentId: item.debugSegmentId,
          routeId: item.routeId,
          engine: item.engine,
          segmentIndex: item.segmentIndex,
        },
      })),
  };
}

import type { CompareDebug, DebugSegment } from "../types";

export const DEBUG_SEGMENTS_SOURCE_ID = "route-debug-segments";

export interface DebugSegmentFeatureProperties {
  debugSegmentId: string;
  engine: DebugSegment["engine"];
  routeId: string;
  routeIndex: number;
  legIndex: number;
  segmentIndex: number;
}

export interface DebugSegmentFeature {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
  properties: DebugSegmentFeatureProperties;
}

export interface DebugSegmentsFeatureCollection {
  type: "FeatureCollection";
  features: DebugSegmentFeature[];
}

/** Flatten the two independently generated engine payloads in stable order. */
export function flattenDebugSegments(
  debug: CompareDebug | null | undefined,
): DebugSegment[] {
  return debug
    ? [...debug.osrm.segments, ...debug.valhalla.segments]
    : [];
}

/** Build the id lookup once per compare payload; MapLibre carries only ids. */
export function buildDebugSegmentLookup(
  debug: CompareDebug | null | undefined,
): Map<string, DebugSegment> {
  return new Map(flattenDebugSegments(debug).map((segment) => [segment.id, segment]));
}

/**
 * Convert visible debug segments to lightweight GeoJSON features.
 *
 * Route visibility is the source of truth. Filtering here also means a hidden
 * route cannot be returned by MapLibre hit testing.
 */
export function buildDebugSegmentsFeatureCollection(
  debug: CompareDebug | null | undefined,
  visibility: Record<string, boolean>,
): DebugSegmentsFeatureCollection {
  return {
    type: "FeatureCollection",
    features: flattenDebugSegments(debug)
      .filter((segment) => visibility[segment.routeId] ?? true)
      .map((segment) => ({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: segment.coordinates,
        },
        properties: {
          debugSegmentId: segment.id,
          engine: segment.engine,
          routeId: segment.routeId,
          routeIndex: segment.routeIndex,
          legIndex: segment.legIndex,
          segmentIndex: segment.segmentIndex,
        },
      })),
  };
}

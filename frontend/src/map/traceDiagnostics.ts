import type {
  TraceMatchedPoint,
  TraceRouteBreak,
  TraceRouteComponent,
  TraceMatchedPointType,
} from "../types";

export const TRACE_POINT_COLORS: Record<TraceMatchedPointType, string> = {
  matched: "#22c55e",
  interpolated: "#a855f7",
  unmatched: "#ef4444",
};

export function buildTraceMatchedPointsFeatureCollection(
  matchedPoints: TraceMatchedPoint[],
) {
  return {
    type: "FeatureCollection" as const,
    features: matchedPoints.map((point) => ({
      type: "Feature" as const,
      id: point.index,
      geometry: {
        type: "Point" as const,
        coordinates: [point.lon, point.lat] as [number, number],
      },
      properties: {
        index: point.index,
        type: point.type,
        color: TRACE_POINT_COLORS[point.type],
        edgeIndex: point.edgeIndex,
        distanceAlongEdge: point.distanceAlongEdge,
        distanceFromTracePoint: point.distanceFromTracePoint,
        beginRouteDiscontinuity: point.beginRouteDiscontinuity,
        endRouteDiscontinuity: point.endRouteDiscontinuity,
        hasPointDiscontinuity:
          point.beginRouteDiscontinuity || point.endRouteDiscontinuity,
      },
    })),
  };
}

export function buildTraceContinuityFeatureCollection(
  components: TraceRouteComponent[],
  breaks: TraceRouteBreak[],
) {
  const features: Array<{
    type: "Feature";
    geometry:
      | { type: "LineString"; coordinates: [number, number][] }
      | { type: "Point"; coordinates: [number, number] };
    properties: Record<string, string | number | boolean>;
  }> = [];

  for (const component of components) {
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: component.geometry,
      },
      properties: {
        kind: "component",
        componentIndex: component.index,
        label: component.label,
      },
    });
  }

  for (const traceBreak of breaks) {
    features.push(
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: traceBreak.previousEndCoordinate,
        },
        properties: {
          kind: "break-end",
          side: "previous",
          breakIndex: traceBreak.index,
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: traceBreak.nextStartCoordinate,
        },
        properties: {
          kind: "break-end",
          side: "next",
          breakIndex: traceBreak.index,
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            traceBreak.previousEndCoordinate,
            traceBreak.nextStartCoordinate,
          ],
        },
        properties: {
          kind: "break-connector",
          breakIndex: traceBreak.index,
          diagnostic: true,
        },
      },
    );
  }

  return { type: "FeatureCollection" as const, features };
}

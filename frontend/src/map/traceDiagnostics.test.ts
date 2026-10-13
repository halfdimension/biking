import { describe, expect, it } from "vitest";
import {
  TRACE_POINT_COLORS,
  buildTraceContinuityFeatureCollection,
  buildTraceMatchedPointsFeatureCollection,
} from "./traceDiagnostics";
import type {
  TraceMatchedPoint,
  TraceRouteBreak,
  TraceRouteComponent,
} from "../types";

describe("trace diagnostic GeoJSON", () => {
  it("classifies matched points in [lon, lat] order with discontinuity metadata", () => {
    const points: TraceMatchedPoint[] = [
      {
        index: 0,
        lon: 77,
        lat: 28,
        type: "matched",
        edgeIndex: 4,
        distanceAlongEdge: 0.25,
        distanceFromTracePoint: 3,
        beginRouteDiscontinuity: false,
        endRouteDiscontinuity: false,
      },
      {
        index: 1,
        lon: 77.1,
        lat: 28.1,
        type: "interpolated",
        edgeIndex: null,
        distanceAlongEdge: null,
        distanceFromTracePoint: null,
        beginRouteDiscontinuity: true,
        endRouteDiscontinuity: true,
      },
      {
        index: 2,
        lon: 77.2,
        lat: 28.2,
        type: "unmatched",
        edgeIndex: null,
        distanceAlongEdge: null,
        distanceFromTracePoint: 8,
        beginRouteDiscontinuity: false,
        endRouteDiscontinuity: false,
      },
    ];

    const collection = buildTraceMatchedPointsFeatureCollection(points);

    expect(collection.features.map((feature) => feature.geometry.coordinates)).toEqual([
      [77, 28],
      [77.1, 28.1],
      [77.2, 28.2],
    ]);
    expect(collection.features.map((feature) => feature.properties.color)).toEqual([
      TRACE_POINT_COLORS.matched,
      TRACE_POINT_COLORS.interpolated,
      TRACE_POINT_COLORS.unmatched,
    ]);
    expect(collection.features[1].properties).toMatchObject({
      index: 1,
      type: "interpolated",
      edgeIndex: null,
      beginRouteDiscontinuity: true,
      endRouteDiscontinuity: true,
      hasPointDiscontinuity: true,
    });
    expect(collection.features[0].properties.hasPointDiscontinuity).toBe(false);
  });

  it("keeps component lines, break endpoints, and diagnostic connector separate", () => {
    const components: TraceRouteComponent[] = [
      {
        index: 0,
        label: "Trace Route Component 1",
        geometry: [[77, 28], [77.1, 28.1]],
        legs: [{ legIndex: 0, geometry: [[77, 28], [77.1, 28.1]] }],
      },
      {
        index: 1,
        label: "Trace Route Component 2",
        geometry: [[77.2, 28.2], [77.3, 28.3]],
        legs: [{ legIndex: 0, geometry: [[77.2, 28.2], [77.3, 28.3]] }],
      },
    ];
    const breaks: TraceRouteBreak[] = [{
      index: 0,
      previousComponentIndex: 0,
      nextComponentIndex: 1,
      previousEndCoordinate: [77.1, 28.1],
      nextStartCoordinate: [77.2, 28.2],
      gapMeters: 100,
    }];

    const collection = buildTraceContinuityFeatureCollection(components, breaks);
    const kinds = collection.features.map((feature) => feature.properties.kind);

    expect(kinds).toEqual([
      "component",
      "component",
      "break-end",
      "break-end",
      "break-connector",
    ]);
    expect(collection.features[0].properties.label).toBe("Trace Route Component 1");
    expect(collection.features[1].properties.label).toBe("Trace Route Component 2");
    expect(
      collection.features.filter(
        (feature) => feature.properties.kind === "component",
      ).map((feature) => feature.geometry.coordinates),
    ).toEqual(components.map((component) => component.geometry));
    expect(collection.features[4]).toMatchObject({
      geometry: {
        type: "LineString",
        coordinates: [[77.1, 28.1], [77.2, 28.2]],
      },
      properties: {
        kind: "break-connector",
        diagnostic: true,
      },
    });
  });
});

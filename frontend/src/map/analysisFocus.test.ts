import { describe, expect, it } from "vitest";
import type { DebugSegment } from "../types";
import { buildAnalysisFocusFeatureCollection } from "./analysisFocus";

const coordinates: [number, number][] = [
  [77.1, 28.5],
  [77.2, 28.6],
];
const segment = {
  id: "osrm:0:0:4",
  engine: "osrm",
  routeId: "osrm:0",
  routeIndex: 0,
  legIndex: 0,
  segmentIndex: 4,
  coordinates,
  properties: { speed: 5.9, distance: 100 },
} as DebugSegment;
const lookup = new Map([[segment.id, segment]]);

describe("Route Analysis focus GeoJSON", () => {
  it("uses exact coordinates and only lightweight identifying properties", () => {
    const result = buildAnalysisFocusFeatureCollection(
      segment.id,
      segment.routeId,
      lookup,
      true,
    );
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.coordinates).toBe(coordinates);
    expect(result.features[0].properties).toEqual({
      debugSegmentId: segment.id,
      routeId: segment.routeId,
      engine: "osrm",
      segmentIndex: 4,
    });
    expect(Object.keys(result.features[0].properties)).toHaveLength(4);
  });

  it.each([
    [null, "osrm:0", true],
    [segment.id, "osrm:0", false],
    ["missing", "osrm:0", true],
    [segment.id, "valhalla:0", true],
  ] as const)("returns no geometry for null, hidden, missing, or cross-route focus", (
    focusedId,
    routeId,
    visible,
  ) => {
    expect(
      buildAnalysisFocusFeatureCollection(focusedId, routeId, lookup, visible)
        .features,
    ).toEqual([]);
  });
});


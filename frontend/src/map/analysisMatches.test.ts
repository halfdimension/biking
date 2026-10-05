import { describe, expect, it } from "vitest";
import { deriveRouteProfile } from "../analysis/routeProfile";
import { evaluateRouteQuery } from "../analysis/routeQuery";
import type { ValhallaDebugSegment } from "../types";
import { buildAnalysisMatchesFeatureCollection } from "./analysisMatches";

function segment(id: string, routeId = "valhalla:0", speed = 40): ValhallaDebugSegment {
  return {
    id,
    engine: "valhalla",
    routeId,
    routeIndex: Number(routeId.split(":")[1]),
    legIndex: 0,
    segmentIndex: Number(id.split(":").slice(-1)[0]),
    coordinates: [[77.123456, 28.654321], [77.234567, 28.765432]],
    properties: {
      id: `edge-${id}`,
      wayId: "90071992547409931234",
      name: ["Road"], lengthKm: 0.1, speed, roadClass: "kTrunk",
      beginShapeIndex: 0, endShapeIndex: 1, traversability: "kBoth",
      use: "kRoadUse", toll: false, unpaved: false, tunnel: false,
      bridge: false, roundabout: false, surface: "kPavedSmooth", density: 1,
      speedLimit: 40, defaultSpeed: 35, sourceAlongEdge: 0, targetAlongEdge: 1,
      spdLmt: 40, spdLmtHgv: 30, spdLmtBike: 20, frc: 2, tollRoad: 0,
      bikeSpeed: 20,
      nodeCost: { elapsedCost: { seconds: 0, cost: 0 }, transitionCost: { seconds: 0, cost: 0 } },
      sourceNodeCost: { elapsedCost: { seconds: 0, cost: 0 }, transitionCost: { seconds: 0, cost: 0 } },
      targetNodeCost: null,
    },
  };
}

function result() {
  const segments = [
    segment("valhalla:0:0:0"),
    segment("valhalla:0:0:1", "valhalla:0", 25),
    segment("valhalla:1:0:0", "valhalla:1"),
  ];
  return evaluateRouteQuery(
    deriveRouteProfile(segments, "valhalla:0"),
    { field: "speed", operator: "=", value: "40" },
  );
}

describe("analysis match GeoJSON", () => {
  it("includes only matching IDs from the selected route", () => {
    const data = buildAnalysisMatchesFeatureCollection("valhalla:0", result(), true);
    expect(data.features.map((feature) => feature.properties.debugSegmentId))
      .toEqual(["valhalla:0:0:0"]);
    expect(data.features.every((feature) => feature.properties.routeId === "valhalla:0")).toBe(true);
  });

  it("preserves exact debug segment coordinates", () => {
    const data = buildAnalysisMatchesFeatureCollection("valhalla:0", result(), true);
    expect(data.features[0].geometry.coordinates).toEqual([
      [77.123456, 28.654321], [77.234567, 28.765432],
    ]);
  });

  it("copies lightweight properties only", () => {
    const properties = buildAnalysisMatchesFeatureCollection("valhalla:0", result(), true).features[0].properties;
    expect(properties).toEqual({
      debugSegmentId: "valhalla:0:0:0",
      routeId: "valhalla:0",
      engine: "valhalla",
      segmentIndex: 0,
    });
    expect(properties).not.toHaveProperty("speed");
    expect(properties).not.toHaveProperty("wayId");
  });

  it("emits no visible features while the route is hidden", () => {
    expect(buildAnalysisMatchesFeatureCollection("valhalla:0", result(), false).features).toEqual([]);
  });

  it("returns features again when visibility is restored", () => {
    expect(buildAnalysisMatchesFeatureCollection("valhalla:0", result(), true).features).toHaveLength(1);
  });

  it("clearing the query produces an empty FeatureCollection", () => {
    expect(buildAnalysisMatchesFeatureCollection("valhalla:0", null, true))
      .toEqual({ type: "FeatureCollection", features: [] });
  });
});

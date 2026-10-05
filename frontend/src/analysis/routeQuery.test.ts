import { describe, expect, it } from "vitest";
import { deriveRouteProfile } from "./routeProfile";
import {
  deriveRouteQueryValueOptions,
  evaluateRouteQuery,
  routeQueryField,
  routeQueryFieldsForEngine,
  type RouteAttributeQuery,
} from "./routeQuery";
import type { DebugSegment, OsrmDebugSegment, ValhallaDebugSegment } from "../types";

const cost = {
  elapsedCost: { seconds: 0, cost: 0 },
  transitionCost: { seconds: 0, cost: 0 },
};

function valhalla(
  index: number,
  overrides: Partial<ValhallaDebugSegment["properties"]> = {},
  routeId = "valhalla:0",
): ValhallaDebugSegment {
  return {
    id: `${routeId}:0:${index}`,
    engine: "valhalla",
    routeId,
    routeIndex: Number(routeId.split(":")[1]),
    legIndex: 0,
    segmentIndex: index,
    coordinates: [[77 + index * 0.001, 28], [77 + (index + 1) * 0.001, 28]],
    properties: {
      id: `edge-${index}`,
      wayId: `way-${index}`,
      name: [index ? "Second Avenue" : "Main Road"],
      lengthKm: index === 0 ? 0.1 : 0.2,
      speed: index === 0 ? 40 : 25,
      roadClass: index === 0 ? "kTrunk" : "kPrimary",
      beginShapeIndex: index,
      endShapeIndex: index + 1,
      traversability: "kBoth",
      use: "kRoadUse",
      toll: index === 0,
      unpaved: false,
      tunnel: false,
      bridge: false,
      roundabout: false,
      surface: index === 0 ? "kPavedSmooth" : "kGravel",
      density: index === 0 ? 15 : 7,
      speedLimit: 40,
      defaultSpeed: 35,
      sourceAlongEdge: 0,
      targetAlongEdge: 1,
      spdLmt: 40,
      spdLmtHgv: 30,
      spdLmtBike: 20,
      frc: index === 0 ? 2 : 3,
      tollRoad: 0,
      bikeSpeed: 20,
      nodeCost: cost,
      sourceNodeCost: cost,
      targetNodeCost: null,
      ...overrides,
    },
  };
}

function osrm(
  index: number,
  overrides: Partial<OsrmDebugSegment["properties"]> = {},
  routeId = "osrm:0",
): OsrmDebugSegment {
  return {
    id: `${routeId}:0:${index}`,
    engine: "osrm",
    routeId,
    routeIndex: Number(routeId.split(":")[1]),
    legIndex: 0,
    segmentIndex: index,
    coordinates: [[77 + index * 0.001, 28], [77 + (index + 1) * 0.001, 28]],
    properties: {
      distance: index === 0 ? 100 : 200,
      duration: index === 0 ? 10 : 20,
      weight: index === 0 ? 12 : 24,
      speed: index === 0 ? 11.111111 : 5,
      datasources: 0,
      datasource: index,
      datasourceName: index === 0 ? "un_mmi_api_edge_BIKE" : "bike_predictive",
      fromNodeId: index === 0 ? "90071992547409931234" : "2",
      toNodeId: index === 0 ? "90071992547409931235" : "3",
      ...overrides,
    },
  };
}

function run(
  segments: DebugSegment[],
  routeId: string,
  query: RouteAttributeQuery,
) {
  return evaluateRouteQuery(deriveRouteProfile(segments, routeId), query);
}

describe("route attribute query evaluator", () => {
  it("matches Valhalla speed equality", () => {
    expect(run([valhalla(0), valhalla(1)], "valhalla:0", { field: "speed", operator: "=", value: "40" }).matchingSegmentIds)
      .toEqual(["valhalla:0:0:0"]);
  });

  it("treats 34.999996 as speed 35 without mutating the raw value", () => {
    const segment = valhalla(0, { speed: 34.999996185302734 });
    expect(run([segment], "valhalla:0", { field: "speed", operator: "=", value: "35" }).matchingSegmentCount).toBe(1);
    expect(segment.properties.speed).toBe(34.999996185302734);
  });

  it.each([
    [">", "30", 1],
    [">=", "40", 1],
    ["<", "30", 1],
    ["<=", "25", 1],
    ["!=", "40", 1],
  ] as const)("supports numeric %s", (operator, value, count) => {
    expect(run([valhalla(0), valhalla(1)], "valhalla:0", { field: "speed", operator, value }).matchingSegmentCount).toBe(count);
  });

  it("uses exact equality for discrete density", () => {
    const result = run(
      [valhalla(0), valhalla(1, { density: 15.000001 })],
      "valhalla:0",
      { field: "density", operator: "=", value: "15" },
    );
    expect(result.matchingSegmentIds).toEqual(["valhalla:0:0:0"]);
  });

  it("matches road class and surface categories", () => {
    const segments = [valhalla(0), valhalla(1)];
    expect(run(segments, "valhalla:0", { field: "roadClass", operator: "=", value: "kTrunk" }).matchingSegmentCount).toBe(1);
    expect(run(segments, "valhalla:0", { field: "surface", operator: "=", value: "kPavedSmooth" }).matchingSegmentCount).toBe(1);
  });

  it("supports case-insensitive name contains", () => {
    expect(run([valhalla(0), valhalla(1)], "valhalla:0", { field: "name", operator: "contains", value: "main" }).matchingSegmentIds)
      .toEqual(["valhalla:0:0:0"]);
  });

  it("matches boolean true and false", () => {
    const segments = [valhalla(0), valhalla(1)];
    expect(run(segments, "valhalla:0", { field: "toll", operator: "=", value: "true" }).matchingSegmentCount).toBe(1);
    expect(run(segments, "valhalla:0", { field: "toll", operator: "=", value: "false" }).matchingSegmentCount).toBe(1);
  });

  it("matches way and edge IDs as strings", () => {
    const segments = [valhalla(0), valhalla(1)];
    expect(run(segments, "valhalla:0", { field: "wayId", operator: "=", value: "way-1" }).matchingSegmentIds).toEqual(["valhalla:0:0:1"]);
    expect(run(segments, "valhalla:0", { field: "edgeId", operator: "=", value: "edge-0" }).matchingSegmentIds).toEqual(["valhalla:0:0:0"]);
  });

  it("converts OSRM m/s to km/h for speed queries", () => {
    expect(run([osrm(0), osrm(1)], "osrm:0", { field: "speed", operator: "=", value: "40" }).matchingSegmentIds)
      .toEqual(["osrm:0:0:0"]);
  });

  it("matches OSRM datasource name", () => {
    expect(run([osrm(0), osrm(1)], "osrm:0", { field: "datasourceName", operator: "=", value: "un_mmi_api_edge_BIKE" }).matchingSegmentCount).toBe(1);
  });

  it("scopes matches to the selected routeId", () => {
    const segments = [valhalla(0), valhalla(0, { speed: 40 }, "valhalla:1")];
    expect(run(segments, "valhalla:0", { field: "speed", operator: "=", value: "40" }).matchingSegmentIds)
      .toEqual(["valhalla:0:0:0"]);
  });

  it("returns an honest empty result for an empty route", () => {
    expect(run([], "valhalla:0", { field: "speed", operator: "=", value: "40" }))
      .toMatchObject({ matchingSegmentCount: 0, totalSegmentCount: 0, matchedDistanceMeters: 0, matchedPercentage: 0 });
  });

  it("does not match a missing property", () => {
    const segment = valhalla(0);
    (segment.properties as { defaultSpeed?: number }).defaultSpeed = undefined;
    expect(run([segment], "valhalla:0", { field: "defaultSpeed", operator: "!=", value: "35" }).matchingSegmentCount).toBe(0);
  });

  it("keeps zero as a valid numeric value", () => {
    expect(run([valhalla(0, { density: 0 })], "valhalla:0", { field: "density", operator: "=", value: "0" }).matchingSegmentCount).toBe(1);
  });

  it("uses Phase 1 lengths for matched distance and percentage", () => {
    const result = run([valhalla(0), valhalla(1)], "valhalla:0", { field: "speed", operator: "=", value: "40" });
    expect(result.matchedDistanceMeters).toBe(100);
    expect(result.matchedPercentage).toBeCloseTo(100 / 3, 6);
  });

  it("reports incomplete matched-distance coverage", () => {
    const missing = valhalla(0, { lengthKm: Number.NaN, speed: 40 });
    missing.coordinates = [];
    const result = run([missing, valhalla(1, { speed: 40 })], "valhalla:0", { field: "speed", operator: "=", value: "40" });
    expect(result.matchingSegmentCount).toBe(2);
    expect(result.matchedDistanceMeters).toBe(200);
    expect(result.missingLengthSegmentCount).toBe(1);
    expect(result.hasIncompleteDistanceCoverage).toBe(true);
  });

  it("preserves 64-bit node IDs exactly", () => {
    const id = "90071992547409931234";
    const result = run([osrm(0)], "osrm:0", { field: "fromNodeId", operator: "=", value: id });
    expect(result.matchingSegmentCount).toBe(1);
    expect(routeQueryField("fromNodeId").extractor(osrm(0))).toBe(id);
  });

  it("derives unique sorted categorical values from the current route", () => {
    const profile = deriveRouteProfile([valhalla(0), valhalla(1), valhalla(2, { roadClass: "kTrunk" })], "valhalla:0");
    expect(deriveRouteQueryValueOptions(profile, routeQueryField("roadClass")))
      .toEqual(["kPrimary", "kTrunk"]);
  });

  it("exposes only fields supported by the active engine", () => {
    const valhallaIds = routeQueryFieldsForEngine("valhalla").map((field) => field.id);
    const osrmIds = routeQueryFieldsForEngine("osrm").map((field) => field.id);
    expect(valhallaIds).toContain("roadClass");
    expect(valhallaIds).not.toContain("datasourceName");
    expect(osrmIds).toContain("datasourceName");
    expect(osrmIds).not.toContain("roadClass");
  });
});

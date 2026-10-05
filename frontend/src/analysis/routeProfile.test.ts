import { describe, expect, it } from "vitest";
import type { OsrmDebugSegment, ValhallaDebugSegment } from "../types";
import {
  coordinateLengthMeters,
  deriveRouteProfile,
  formatAnalysisNumber,
  metricDomain,
  routeMetric,
  summarizeMetric,
} from "./routeProfile";

const cost = {
  elapsedCost: { seconds: 0, cost: 0 },
  transitionCost: { seconds: 0, cost: 0 },
};

function osrm(
  segmentIndex: number,
  distance: number,
  speed = 10,
  routeId = "osrm:0",
  legIndex = 0,
): OsrmDebugSegment {
  return {
    id: `${routeId}:${legIndex}:${segmentIndex}`,
    engine: "osrm",
    routeId,
    routeIndex: Number(routeId.split(":")[1]),
    legIndex,
    segmentIndex,
    coordinates: [[77, 28], [77.001, 28.001]],
    properties: {
      distance,
      duration: 1,
      weight: 1,
      speed,
      datasources: 0,
      datasource: 0,
      datasourceName: "bike-profile",
      fromNodeId: "1",
      toNodeId: "2",
    },
  };
}

function valhalla(
  segmentIndex: number,
  lengthKm: number,
  speed = 35,
  density: number | undefined = 3,
  defaultSpeed: number | undefined = 30,
  routeId = "valhalla:0",
  legIndex = 0,
): ValhallaDebugSegment {
  return {
    id: `${routeId}:${legIndex}:${segmentIndex}`,
    engine: "valhalla",
    routeId,
    routeIndex: Number(routeId.split(":")[1]),
    legIndex,
    segmentIndex,
    coordinates: [[77, 28], [77.001, 28.001]],
    properties: {
      id: `edge-${segmentIndex}`,
      wayId: `way-${segmentIndex}`,
      name: [],
      lengthKm,
      speed,
      defaultSpeed: defaultSpeed as number,
      density: density as number,
      roadClass: "kPrimary",
      beginShapeIndex: 0,
      endShapeIndex: 1,
      traversability: "kBoth",
      use: "kRoadUse",
      toll: false,
      unpaved: false,
      tunnel: false,
      bridge: false,
      roundabout: false,
      surface: "kPavedSmooth",
      speedLimit: 40,
      sourceAlongEdge: 0,
      targetAlongEdge: 1,
      spdLmt: 40,
      spdLmtHgv: 30,
      spdLmtBike: 20,
      frc: 2,
      tollRoad: 0,
      bikeSpeed: 20,
      nodeCost: cost,
      sourceNodeCost: cost,
      targetNodeCost: null,
    },
  };
}

describe("deriveRouteProfile", () => {
  it("orders segments by leg then segment index while retaining the source object", () => {
    const laterLeg = osrm(0, 30, 10, "osrm:0", 1);
    const laterSegment = osrm(2, 20);
    const first = osrm(1, 10);
    const result = deriveRouteProfile([laterLeg, laterSegment, first], "osrm:0");
    expect(result.segments.map((item) => [item.legIndex, item.segmentIndex])).toEqual([
      [0, 1], [0, 2], [1, 0],
    ]);
    expect(result.segments[0].segment).toBe(first);
  });

  it("uses OSRM metres to build cumulative start/end intervals", () => {
    const result = deriveRouteProfile([osrm(0, 12.5), osrm(1, 7.5)], "osrm:0");
    expect(result.segments.map((item) => [item.startDistanceMeters, item.endDistanceMeters])).toEqual([
      [0, 12.5], [12.5, 20],
    ]);
    expect(result.totalDistanceMeters).toBe(20);
  });

  it("converts Valhalla lengthKm to metres", () => {
    const result = deriveRouteProfile([valhalla(0, 0.125), valhalla(1, 1.5)], "valhalla:0");
    expect(result.segments.map((item) => item.lengthMeters)).toEqual([125, 1500]);
    expect(result.totalDistanceMeters).toBe(1625);
  });

  it("falls back to haversine shape length and reports that fallback", () => {
    const segment = osrm(0, Number.NaN);
    segment.coordinates = [[0, 0], [0, 0.001]];
    const result = deriveRouteProfile([segment], "osrm:0");
    expect(result.segments[0].lengthSource).toBe("coordinates");
    expect(result.totalDistanceMeters).toBeCloseTo(111.2, 0);
    expect(result.warnings[0]).toContain("coordinate-derived");
    expect(coordinateLengthMeters(segment.coordinates)).toBeCloseTo(111.2, 0);
  });

  it("keeps a valid zero-length engine segment explicit", () => {
    const result = deriveRouteProfile([osrm(0, 0), osrm(1, 5)], "osrm:0");
    expect(result.segments[0]).toMatchObject({
      startDistanceMeters: 0,
      endDistanceMeters: 0,
      lengthMeters: 0,
      lengthSource: "engine",
    });
    expect(result.warnings).toEqual([]);
  });

  it("marks missing engine and coordinate length rather than inventing zero", () => {
    const segment = osrm(0, Number.NaN);
    segment.coordinates = [];
    const result = deriveRouteProfile([segment], "osrm:0");
    expect(result.segments[0].lengthMeters).toBeNull();
    expect(result.segments[0].lengthSource).toBe("missing");
    expect(result.warnings[0]).toContain("no valid engine or coordinate length");
  });

  it("returns an empty profile for empty input", () => {
    expect(deriveRouteProfile([], "osrm:0")).toEqual({
      routeId: "osrm:0", segments: [], totalDistanceMeters: 0, warnings: [],
    });
  });

  it("analyzes only segments matching the requested route id", () => {
    const result = deriveRouteProfile(
      [osrm(0, 10, 10, "osrm:0"), osrm(0, 99, 10, "osrm:1")],
      "osrm:1",
    );
    expect(result.segments).toHaveLength(1);
    expect(result.totalDistanceMeters).toBe(99);
  });
});

describe("route metrics", () => {
  it("converts OSRM m/s to km/h and leaves Valhalla speed in km/h", () => {
    const speed = routeMetric("speed");
    expect(speed.value(osrm(0, 10, 5.9))).toBeCloseTo(21.24);
    expect(speed.value(valhalla(0, 0.1, 35))).toBe(35);
  });

  it("extracts Valhalla density and default speed without fabricating OSRM values", () => {
    const segment = valhalla(0, 0.1, 35, 0, 0);
    expect(routeMetric("density").value(segment)).toBe(0);
    expect(routeMetric("defaultSpeed").value(segment)).toBe(0);
    expect(routeMetric("density").value(osrm(0, 10))).toBeNull();
  });

  it("does not turn missing numeric fields into zero", () => {
    const segment = valhalla(0, 0.1, 35);
    segment.properties.density = undefined as unknown as number;
    segment.properties.defaultSpeed = undefined as unknown as number;
    expect(routeMetric("density").value(segment)).toBeNull();
    expect(routeMetric("defaultSpeed").value(segment)).toBeNull();
  });

  it("computes a distance-weighted speed average", () => {
    const profile = deriveRouteProfile(
      [valhalla(0, 0.1, 10), valhalla(1, 0.3, 30)],
      "valhalla:0",
    );
    expect(summarizeMetric(profile, routeMetric("speed"))).toMatchObject({
      availableCount: 2,
      totalCount: 2,
      minimum: 10,
      maximum: 30,
      weightedAverage: 25,
    });
  });

  it("creates a non-zero domain for constant values", () => {
    expect(metricDomain([35, 35])).toEqual([31.5, 38.5]);
    expect(metricDomain([])).toBeNull();
  });

  it("normalizes float noise only for display", () => {
    const value = 34.999996185302734;
    expect(formatAnalysisNumber(value)).toBe("35");
    expect(value).toBe(34.999996185302734);
  });
});

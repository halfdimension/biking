/**
 * Unit tests for the vs-primary comparison helper (Task 22.2, Req 8.2,
 * design Property 14).
 */
import { describe, it, expect } from "vitest";
import { computeVsPrimary, findEnginePrimary } from "./compare";
import type { Engine, NormalizedRoute } from "./types";

function route(
  engine: Engine,
  index: number,
  distanceMeters: number | null,
  durationSeconds: number | null,
): NormalizedRoute {
  return {
    id: `${engine}:${index}`,
    engine,
    index,
    isPrimary: index === 0,
    label: `${engine} ${index}`,
    coordinates: [
      [77.6, 12.9],
      [77.65, 12.95],
    ],
    distanceMeters,
    durationSeconds,
    cost: null,
    raw: {},
  };
}

/** 2 OSRM + 3 Valhalla routes with distinct distance/duration values. */
const ROUTES: NormalizedRoute[] = [
  route("osrm", 0, 1000, 100),
  route("osrm", 1, 1100, 90),
  route("valhalla", 0, 2000, 200),
  route("valhalla", 1, 2200, 260),
  route("valhalla", 2, 1800, 200),
];

describe("findEnginePrimary", () => {
  it("returns the own-engine primary route", () => {
    expect(findEnginePrimary("osrm", ROUTES)?.id).toBe("osrm:0");
    expect(findEnginePrimary("valhalla", ROUTES)?.id).toBe("valhalla:0");
  });

  it("returns null when the engine has no routes", () => {
    const onlyValhalla = ROUTES.filter((r) => r.engine === "valhalla");
    expect(findEnginePrimary("osrm", onlyValhalla)).toBeNull();
  });
});

describe("computeVsPrimary", () => {
  it("gives 0 for a primary route's own diff", () => {
    const osrmPrimary = ROUTES[0];
    expect(computeVsPrimary(osrmPrimary, ROUTES)).toEqual({
      distancePct: 0,
      durationPct: 0,
    });
  });

  it("computes correct raw fractional diff for an alternate vs its own primary", () => {
    const osrmAlt = ROUTES[1]; // 1100m / 90s vs primary 1000m / 100s
    const result = computeVsPrimary(osrmAlt, ROUTES);
    expect(result.distancePct).toBeCloseTo((1100 - 1000) / 1000, 10); // +0.1
    expect(result.durationPct).toBeCloseTo((90 - 100) / 100, 10); // -0.1
  });

  it("isolates engines: Valhalla alt compares to Valhalla primary, not OSRM", () => {
    const valhallaAlt = ROUTES[3]; // 2200m / 260s vs Valhalla primary 2000m / 200s
    const result = computeVsPrimary(valhallaAlt, ROUTES);
    expect(result.distancePct).toBeCloseTo((2200 - 2000) / 2000, 10); // +0.1
    expect(result.durationPct).toBeCloseTo((260 - 200) / 200, 10); // +0.3
  });

  it("returns null diffs when the engine has no primary", () => {
    // Only alternates for OSRM (no index-0 / primary present).
    const noPrimary = [route("osrm", 1, 1100, 90)];
    expect(computeVsPrimary(noPrimary[0], noPrimary)).toEqual({
      distancePct: null,
      durationPct: null,
    });
  });

  it("returns null when the primary value is zero (no NaN/Infinity)", () => {
    const routes = [route("osrm", 0, 0, 0), route("osrm", 1, 500, 60)];
    const alt = computeVsPrimary(routes[1], routes);
    expect(alt.distancePct).toBeNull();
    expect(alt.durationPct).toBeNull();
  });

  it("returns null for a missing own value", () => {
    const routes = [route("osrm", 0, 1000, 100), route("osrm", 1, null, null)];
    const alt = computeVsPrimary(routes[1], routes);
    expect(alt.distancePct).toBeNull();
    expect(alt.durationPct).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { NormalizedRoute } from "../types";
import {
  analyzeRouteDifference,
  DEFAULT_ROUTE_DIFFERENCE_METHOD,
  type RouteCoordinate,
} from "./routeDifference";

const ORIGIN: RouteCoordinate = [77, 28.6];

function point(xMeters: number, yMeters: number): RouteCoordinate {
  const lat = ORIGIN[1] + yMeters / 111_132;
  const lon =
    ORIGIN[0] +
    xMeters / (111_320 * Math.cos((ORIGIN[1] * Math.PI) / 180));
  return [lon, lat];
}

function route(
  engine: "osrm" | "valhalla",
  coordinates: RouteCoordinate[],
): NormalizedRoute {
  return {
    id: `${engine}:0`,
    engine,
    index: 0,
    isPrimary: true,
    label: engine === "osrm" ? "OSRM Primary" : "Valhalla Primary",
    coordinates,
    distanceMeters: 1000,
    durationSeconds: 100,
    cost: null,
    raw: null,
  };
}

function analyze(osrm: RouteCoordinate[], valhalla: RouteCoordinate[]) {
  return analyzeRouteDifference(route("osrm", osrm), route("valhalla", valhalla));
}

describe("analyzeRouteDifference", () => {
  it("reports identical geometry as fully shared with no divergence", () => {
    const geometry = [point(0, 0), point(500, 0), point(1000, 0)];
    const result = analyze(geometry, geometry);
    expect(result.geometricSimilarityPercent).toBeCloseTo(100, 5);
    expect(result.divergences).toHaveLength(0);
  });

  it("is insensitive to different source vertex sampling", () => {
    const result = analyze(
      [point(0, 0), point(1000, 0)],
      [point(0, 0), point(123, 0), point(507, 0), point(760, 0), point(1000, 0)],
    );
    expect(result.geometricSimilarityPercent).toBeGreaterThan(99.5);
    expect(result.divergences).toHaveLength(0);
  });

  it("treats a five metre parallel offset as the same corridor", () => {
    const result = analyze(
      [point(0, 0), point(1000, 0)],
      [point(0, 5), point(1000, 5)],
    );
    expect(result.geometricSimilarityPercent).toBeGreaterThan(99);
    expect(result.divergences).toHaveLength(0);
  });

  it("rejects a parallel route outside the corridor tolerance", () => {
    const result = analyze(
      [point(0, 0), point(500, 0)],
      [point(0, 30), point(500, 30)],
    );
    expect(result.geometricSimilarityPercent).toBe(0);
    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0].split).toBeNull();
    expect(result.divergences[0].rejoin).toBeNull();
  });

  it("does not mark a perpendicular crossing shared", () => {
    const result = analyze(
      [point(-250, 0), point(250, 0)],
      [point(0, -250), point(0, 250)],
    );
    expect(result.geometricSimilarityPercent).toBe(0);
    expect(result.divergences).toHaveLength(1);
  });

  it("does not treat reversed geometry as a fully shared route", () => {
    const result = analyze(
      [point(0, 0), point(500, 0)],
      [point(500, 0), point(0, 0)],
    );
    expect(result.geometricSimilarityPercent).toBeLessThan(5);
    expect(result.divergences).toHaveLength(1);
  });

  it("constructs one detour with approximate split and rejoin", () => {
    const result = analyze(
      [point(0, 0), point(600, 0)],
      [
        point(0, 0),
        point(180, 0),
        point(220, 80),
        point(320, 80),
        point(360, 0),
        point(600, 0),
      ],
    );
    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0].split).not.toBeNull();
    expect(result.divergences[0].rejoin).not.toBeNull();
    expect(result.divergences[0].osrmStartProgressMeters).toBeGreaterThan(140);
    expect(result.divergences[0].osrmEndProgressMeters).toBeLessThan(400);
    expect(result.divergences[0].lengthDeltaMeters).toBeGreaterThan(50);
    expect(
      result.osrmSharedMeters + result.osrmNonSharedMeters,
    ).toBeCloseTo(result.osrmGeometryLengthMeters, 5);
    expect(
      result.valhallaSharedMeters + result.valhallaNonSharedMeters,
    ).toBeCloseTo(result.valhallaGeometryLengthMeters, 5);
  });

  it("keeps two independent detours separate", () => {
    const result = analyze(
      [point(0, 0), point(1000, 0)],
      [
        point(0, 0), point(150, 0), point(180, 70), point(260, 70),
        point(290, 0), point(600, 0), point(630, -70), point(720, -70),
        point(750, 0), point(1000, 0),
      ],
    );
    expect(result.divergences).toHaveLength(2);
  });

  it("represents a divergence from route start without inventing a split", () => {
    const result = analyze(
      [point(0, 0), point(500, 0)],
      [point(0, 70), point(160, 70), point(220, 0), point(500, 0)],
    );
    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0].split).toBeNull();
    expect(result.divergences[0].rejoin).not.toBeNull();
  });

  it("represents a divergence through destination without inventing a rejoin", () => {
    const result = analyze(
      [point(0, 0), point(500, 0)],
      [point(0, 0), point(280, 0), point(340, -70), point(500, -70)],
    );
    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0].split).not.toBeNull();
    expect(result.divergences[0].rejoin).toBeNull();
  });

  it("heals a short unmatched sampling gap", () => {
    const result = analyze(
      [point(0, 0), point(400, 0)],
      [point(0, 0), point(180, 0), point(190, 10), point(200, 0), point(400, 0)],
    );
    expect(result.divergences).toHaveLength(0);
  });

  it("does not split a large detour around a tiny shared island", () => {
    const result = analyze(
      [point(0, 0), point(800, 0)],
      [
        point(0, 0), point(150, 0), point(190, 70), point(340, 70),
        point(370, 0), point(390, 0), point(420, 70), point(610, 70),
        point(650, 0), point(800, 0),
      ],
    );
    expect(result.divergences).toHaveLength(1);
  });

  it("uses monotonic progress to reject a later loop near an earlier section", () => {
    const result = analyze(
      [point(0, 0), point(320, 0), point(100, 5), point(520, 5)],
      [point(0, 0), point(520, 0)],
    );
    expect(result.geometricSimilarityPercent).toBeLessThan(90);
    expect(result.divergences.length).toBeGreaterThan(0);
  });

  it("never mutates either original coordinate array", () => {
    const osrm = [point(0, 0), point(300, 0)];
    const valhalla = [point(0, 0), point(150, 40), point(300, 0)];
    const beforeOsrm = structuredClone(osrm);
    const beforeValhalla = structuredClone(valhalla);
    analyze(osrm, valhalla);
    expect(osrm).toEqual(beforeOsrm);
    expect(valhalla).toEqual(beforeValhalla);
  });

  it("returns finite percentages and warnings for degenerate geometry", () => {
    const result = analyze([], [point(0, 0)]);
    expect(result.warnings).toHaveLength(2);
    expect(Number.isFinite(result.osrmSharedPercent)).toBe(true);
    expect(Number.isFinite(result.valhallaSharedPercent)).toBe(true);
    expect(Number.isFinite(result.geometricSimilarityPercent)).toBe(true);
  });

  it("processes thousands of samples through the declared uniform grid", () => {
    const geometry = Array.from({ length: 3_001 }, (_, index) =>
      point(index * 10, Math.sin(index / 80) * 2),
    );
    const result = analyze(geometry, geometry);
    expect(result.method.spatialIndex).toBe("uniform-grid");
    expect(result.method).toEqual(DEFAULT_ROUTE_DIFFERENCE_METHOD);
    expect(result.geometricSimilarityPercent).toBeGreaterThan(99.5);
  });
});

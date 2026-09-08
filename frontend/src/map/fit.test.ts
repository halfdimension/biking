/**
 * Unit tests for the pure map-fitting helpers (Task 18.1, Req 20.1–20.3).
 */
import { describe, it, expect } from "vitest";
import { computeBounds, collectRouteCoords, markerCoords } from "./fit";
import type { NormalizedRoute } from "../types";

function route(
  id: string,
  coordinates: [number, number][],
  overrides: Partial<NormalizedRoute> = {},
): NormalizedRoute {
  return {
    id,
    engine: "osrm",
    index: 0,
    isPrimary: true,
    label: id,
    coordinates,
    distanceMeters: null,
    durationSeconds: null,
    cost: null,
    raw: {},
    ...overrides,
  };
}

describe("computeBounds", () => {
  it("returns null for an empty coordinate list", () => {
    expect(computeBounds([])).toBeNull();
  });

  it("computes [[minLon,minLat],[maxLon,maxLat]] over several points", () => {
    const coords: [number, number][] = [
      [77.6, 12.9],
      [77.2, 28.6],
      [76.87, 28.78],
      [77.45, 28.2],
    ];
    expect(computeBounds(coords)).toEqual([
      [76.87, 12.9],
      [77.6, 28.78],
    ]);
  });

  it("handles negative and mixed-sign coordinates", () => {
    const coords: [number, number][] = [
      [-10, -20],
      [30, 40],
      [5, -5],
    ];
    expect(computeBounds(coords)).toEqual([
      [-10, -20],
      [30, 40],
    ]);
  });

  it("returns a degenerate box (sw === ne) for a single point", () => {
    const bounds = computeBounds([[77.2, 28.6]]);
    expect(bounds).toEqual([
      [77.2, 28.6],
      [77.2, 28.6],
    ]);
    // sw equals ne for a single point.
    expect(bounds![0]).toEqual(bounds![1]);
  });
});

describe("collectRouteCoords", () => {
  it("returns an empty list for no routes", () => {
    expect(collectRouteCoords([])).toEqual([]);
  });

  it("flattens all route coordinates in order", () => {
    const routes = [
      route("osrm:0", [
        [77.6, 12.9],
        [77.65, 12.95],
      ]),
      route("valhalla:0", [[77.2, 28.6]], { engine: "valhalla" }),
    ];
    expect(collectRouteCoords(routes)).toEqual([
      [77.6, 12.9],
      [77.65, 12.95],
      [77.2, 28.6],
    ]);
  });
});

describe("markerCoords", () => {
  it("returns empty when neither start nor dest is set", () => {
    expect(markerCoords(null, null)).toEqual([]);
  });

  it("maps {lat,lon} to [lon,lat] and includes only set points", () => {
    expect(markerCoords({ lat: 28.6, lon: 77.2 }, null)).toEqual([
      [77.2, 28.6],
    ]);
    expect(markerCoords(null, { lat: 28.2, lon: 77.45 })).toEqual([
      [77.45, 28.2],
    ]);
  });

  it("includes both points as [lon,lat] when both are set (start first)", () => {
    expect(
      markerCoords({ lat: 28.78, lon: 76.87 }, { lat: 28.2, lon: 77.45 }),
    ).toEqual([
      [76.87, 28.78],
      [77.45, 28.2],
    ]);
  });
});

/**
 * Unit tests for `buildRoutesFeatureCollection` (Task 16.1).
 *
 * Pure — no MapLibre / jsdom needed. Feature-state driven visibility/selection
 * is exercised at the Task 19 real-map checkpoint, not here.
 */
import { describe, it, expect } from "vitest";
import { buildRoutesFeatureCollection, defaultRouteColor } from "./routes";
import { routeColor } from "./color";
import type { NormalizedRoute } from "../types";

function route(overrides: Partial<NormalizedRoute> = {}): NormalizedRoute {
  return {
    id: "osrm:0",
    engine: "osrm",
    index: 0,
    isPrimary: true,
    label: "OSRM Primary",
    coordinates: [
      [77.6, 12.9],
      [77.65, 12.95],
    ],
    distanceMeters: 100,
    durationSeconds: 60,
    cost: 10,
    raw: {},
    ...overrides,
  };
}

describe("buildRoutesFeatureCollection", () => {
  it("maps N routes to N LineString features with the expected properties", () => {
    const routes: NormalizedRoute[] = [
      route({ id: "osrm:0", engine: "osrm", index: 0, isPrimary: true }),
      route({
        id: "osrm:1",
        engine: "osrm",
        index: 1,
        isPrimary: false,
        coordinates: [
          [77.61, 12.91],
          [77.66, 12.96],
        ],
      }),
      route({
        id: "valhalla:0",
        engine: "valhalla",
        index: 0,
        isPrimary: true,
        coordinates: [
          [77.62, 12.92],
          [77.67, 12.97],
        ],
      }),
    ];

    const fc = buildRoutesFeatureCollection(routes);

    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(3);

    fc.features.forEach((f, i) => {
      const r = routes[i];
      expect(f.type).toBe("Feature");
      expect(f.geometry.type).toBe("LineString");
      // Coordinates are the route's [lon,lat] pairs, unmodified.
      expect(f.geometry.coordinates).toEqual(r.coordinates);
      // Properties mirror the route; feature identity is via promoteId(routeId).
      expect(f.properties.routeId).toBe(r.id);
      expect(f.properties.engine).toBe(r.engine);
      expect(f.properties.index).toBe(r.index);
      expect(f.properties.isPrimary).toBe(r.isPrimary);
      expect(f.properties.color).toBe(defaultRouteColor(r));
      // No top-level feature id — identity comes from promoteId.
      expect((f as unknown as Record<string, unknown>).id).toBeUndefined();
    });
  });

  it("uses the routeColor family generator by default (osrm blue band, valhalla warm band)", () => {
    const fc = buildRoutesFeatureCollection([
      route({ id: "osrm:0", engine: "osrm", index: 0 }),
      route({ id: "valhalla:0", engine: "valhalla", index: 0 }),
    ]);
    // Primary (index 0) anchors: OSRM hue 210 (blue), Valhalla hue 15 (warm).
    expect(fc.features[0].properties.color).toBe(routeColor("osrm", 0));
    expect(fc.features[1].properties.color).toBe(routeColor("valhalla", 0));
    // Same anchors, now at the vivid saturation/lightness (Task 19 refinement).
    expect(fc.features[0].properties.color).toBe("hsl(210, 88%, 42%)");
    expect(fc.features[1].properties.color).toBe("hsl(15, 88%, 42%)");
  });

  it("honors an injected colorFor generator (Task 17 hook)", () => {
    const fc = buildRoutesFeatureCollection(
      [route({ id: "osrm:0", engine: "osrm", index: 0 })],
      (r) => `custom-${r.engine}-${r.index}`,
    );
    expect(fc.features[0].properties.color).toBe("custom-osrm-0");
  });

  it("returns an empty FeatureCollection for empty routes", () => {
    const fc = buildRoutesFeatureCollection([]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toEqual([]);
  });
});

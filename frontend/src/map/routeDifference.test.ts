import { describe, expect, it } from "vitest";
import { analyzeRouteDifference } from "../analysis/routeDifference";
import type { NormalizedRoute } from "../types";
import {
  buildRouteDifferenceFeatureCollection,
  routeDifferenceLayerSpecs,
  ROUTE_DIFFERENCE_OSRM_LAYER_ID,
  ROUTE_DIFFERENCE_REJOIN_LAYER_ID,
  ROUTE_DIFFERENCE_SHARED_LAYER_ID,
  ROUTE_DIFFERENCE_SPLIT_LAYER_ID,
  ROUTE_DIFFERENCE_VALHALLA_LAYER_ID,
} from "./routeDifference";

function route(
  engine: "osrm" | "valhalla",
  coordinates: [number, number][],
): NormalizedRoute {
  return {
    id: `${engine}:0`,
    engine,
    index: 0,
    isPrimary: true,
    label: engine,
    coordinates,
    distanceMeters: null,
    durationSeconds: null,
    cost: null,
    raw: null,
  };
}

const result = analyzeRouteDifference(
  route("osrm", [[77, 28.6], [77.01, 28.6]]),
  route("valhalla", [
    [77, 28.6],
    [77.003, 28.6],
    [77.004, 28.601],
    [77.006, 28.601],
    [77.007, 28.6],
    [77.01, 28.6],
  ]),
);

describe("route difference GeoJSON", () => {
  it("emits shared, engine divergence, split, and rejoin true geometry", () => {
    const collection = buildRouteDifferenceFeatureCollection(result, true, null);
    const kinds = collection.features.map((feature) => feature.properties.kind);
    expect(kinds).toContain("shared");
    expect(kinds).toContain("divergence-osrm");
    expect(kinds).toContain("divergence-valhalla");
    expect(kinds).toContain("split");
    expect(kinds).toContain("rejoin");

    const osrm = collection.features.find(
      (feature) => feature.properties.kind === "divergence-osrm",
    );
    expect(osrm?.geometry.type).toBe("LineString");
    expect(
      (osrm?.geometry as { coordinates: [number, number][] }).coordinates,
    ).toEqual(result.divergences[0].osrmGeometry);
    expect(osrm?.properties).not.toHaveProperty("displayOffsetPx");
  });

  it("returns an empty collection when the independent overlay is off", () => {
    expect(
      buildRouteDifferenceFeatureCollection(result, false, null).features,
    ).toEqual([]);
  });

  it("adds focus without removing or dimming other divergence features", () => {
    const collection = buildRouteDifferenceFeatureCollection(result, true, 0);
    const divergenceFeatures = collection.features.filter((feature) =>
      feature.properties.kind.startsWith("divergence-"),
    );
    expect(divergenceFeatures).toHaveLength(2);
    expect(divergenceFeatures.every((feature) => feature.properties.focused)).toBe(
      true,
    );
  });

  it("provides stable diagnostic layer ids and never applies line-offset", () => {
    const layers = routeDifferenceLayerSpecs();
    expect(layers.map((layer) => layer.id)).toEqual(
      expect.arrayContaining([
        ROUTE_DIFFERENCE_SHARED_LAYER_ID,
        ROUTE_DIFFERENCE_OSRM_LAYER_ID,
        ROUTE_DIFFERENCE_VALHALLA_LAYER_ID,
        ROUTE_DIFFERENCE_SPLIT_LAYER_ID,
        ROUTE_DIFFERENCE_REJOIN_LAYER_ID,
      ]),
    );
    for (const layer of layers) {
      expect(layer.paint).not.toHaveProperty("line-offset");
    }
  });
});

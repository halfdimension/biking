import { describe, expect, it } from "vitest";
import type { CompareDebug, OsrmDebugSegment, ValhallaDebugSegment } from "../types";
import {
  buildDebugSegmentLookup,
  buildDebugSegmentsFeatureCollection,
} from "./debugSegments";

const osrm: OsrmDebugSegment = {
  id: "osrm:0:0:0",
  engine: "osrm",
  routeId: "osrm:0",
  routeIndex: 0,
  legIndex: 0,
  segmentIndex: 0,
  coordinates: [[77, 28], [77.1, 28.1]],
  properties: {
    distance: 10,
    duration: 2,
    weight: 3,
    speed: 5,
    datasources: 0,
    datasource: 0,
    datasourceName: "live",
    fromNodeId: "9007199254740993",
    toNodeId: "9007199254740995",
  },
};

const valhalla: ValhallaDebugSegment = {
  id: "valhalla:1:0:4",
  engine: "valhalla",
  routeId: "valhalla:1",
  routeIndex: 1,
  legIndex: 0,
  segmentIndex: 4,
  coordinates: [[77, 28], [77.05, 28.05], [77.1, 28.1]],
  properties: {
    id: "6411379561360",
    wayId: "9007199254740997",
    name: ["Road"],
    lengthKm: 0.2,
    speed: 30,
    roadClass: "kPrimary",
    beginShapeIndex: 1,
    endShapeIndex: 3,
    traversability: "kBoth",
    use: "kRoadUse",
    toll: false,
    unpaved: false,
    tunnel: false,
    bridge: false,
    roundabout: false,
    surface: "kPaved",
    density: 2,
    speedLimit: 40,
    defaultSpeed: 35,
    sourceAlongEdge: 0,
    targetAlongEdge: 1,
    spdLmt: 40,
    spdLmtHgv: 30,
    spdLmtBike: 20,
    frc: 1,
    tollRoad: 0,
    bikeSpeed: 20,
    nodeCost: { elapsedCost: { seconds: 1, cost: 2 }, transitionCost: { seconds: 3, cost: 4 } },
    sourceNodeCost: { elapsedCost: { seconds: 1, cost: 2 }, transitionCost: { seconds: 3, cost: 4 } },
    targetNodeCost: null,
  },
};

const debug: CompareDebug = {
  osrm: { engine: "osrm", status: "ok", segments: [osrm], errors: [] },
  valhalla: { engine: "valhalla", status: "ok", segments: [valhalla], errors: [] },
};

describe("debug segment GeoJSON", () => {
  it("converts OSRM and multi-point Valhalla segments with lightweight ids", () => {
    const result = buildDebugSegmentsFeatureCollection(debug, {
      "osrm:0": true,
      "valhalla:1": true,
    });

    expect(result.features).toHaveLength(2);
    expect(result.features[0]).toEqual({
      type: "Feature",
      geometry: { type: "LineString", coordinates: osrm.coordinates },
      properties: {
        debugSegmentId: osrm.id,
        engine: "osrm",
        routeId: "osrm:0",
        routeIndex: 0,
        legIndex: 0,
        segmentIndex: 0,
      },
    });
    expect(result.features[1].geometry.coordinates).toHaveLength(3);
    expect(result.features[1].properties.debugSegmentId).toBe(valhalla.id);
    expect(result.features[1].properties).not.toHaveProperty("id");
  });

  it("excludes segments belonging to hidden routes", () => {
    const result = buildDebugSegmentsFeatureCollection(debug, {
      "osrm:0": false,
      "valhalla:1": true,
    });
    expect(result.features.map((feature) => feature.properties.debugSegmentId))
      .toEqual([valhalla.id]);
  });

  it("retains full segments and large string ids in the lookup", () => {
    const lookup = buildDebugSegmentLookup(debug);
    expect(lookup.get(osrm.id)?.properties).toEqual(osrm.properties);
    const lookedUpValhalla = lookup.get(valhalla.id);
    expect(lookedUpValhalla?.engine).toBe("valhalla");
    if (lookedUpValhalla?.engine !== "valhalla") throw new Error("missing Valhalla segment");
    expect(lookedUpValhalla.properties.id).toBe("6411379561360");
  });
});

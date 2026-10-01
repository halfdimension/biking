import { describe, expect, it } from "vitest";
import { resolveDebugSegmentIds, type RenderedDebugFeature } from "./debugHitTest";

function feature(id: string, routeId: string): RenderedDebugFeature {
  return { id, properties: { debugSegmentId: id, routeId } };
}

describe("debug hit-test resolution", () => {
  it("returns a single OSRM candidate", () => {
    expect(resolveDebugSegmentIds([feature("osrm:0:0:1", "osrm:0")], {}))
      .toEqual(["osrm:0:0:1"]);
  });

  it("returns a single Valhalla candidate", () => {
    expect(resolveDebugSegmentIds([feature("valhalla:0:0:2", "valhalla:0")], {}))
      .toEqual(["valhalla:0:0:2"]);
  });

  it("retains overlapping OSRM and Valhalla segments", () => {
    expect(resolveDebugSegmentIds([
      feature("osrm:0:0:1", "osrm:0"),
      feature("valhalla:0:0:2", "valhalla:0"),
    ], {})).toEqual(["osrm:0:0:1", "valhalla:0:0:2"]);
  });

  it("deduplicates rendered tile copies by segment id", () => {
    expect(resolveDebugSegmentIds([
      feature("osrm:0:0:1", "osrm:0"),
      feature("osrm:0:0:1", "osrm:0"),
    ], {})).toEqual(["osrm:0:0:1"]);
  });

  it("retains same-engine overlapping routes", () => {
    expect(resolveDebugSegmentIds([
      feature("osrm:0:0:1", "osrm:0"),
      feature("osrm:1:0:1", "osrm:1"),
    ], {})).toEqual(["osrm:0:0:1", "osrm:1:0:1"]);
  });

  it("excludes hidden-route candidates", () => {
    expect(resolveDebugSegmentIds([
      feature("osrm:0:0:1", "osrm:0"),
      feature("valhalla:0:0:2", "valhalla:0"),
    ], { "osrm:0": false, "valhalla:0": true }))
      .toEqual(["valhalla:0:0:2"]);
  });
});

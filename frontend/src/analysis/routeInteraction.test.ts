import { describe, expect, it } from "vitest";
import type { RouteProfile, RouteProfileSegment } from "./routeProfile";
import {
  buildRouteProfileSegmentLookup,
  findHoveredProfileSegment,
} from "./routeInteraction";

function item(
  id: string,
  routeId: string,
  start: number,
  end: number,
  length: number | null = end - start,
): RouteProfileSegment {
  return {
    debugSegmentId: id,
    engine: "osrm",
    routeId,
    routeIndex: 0,
    legIndex: 0,
    segmentIndex: 0,
    startDistanceMeters: start,
    endDistanceMeters: end,
    lengthMeters: length,
    lengthSource: length === null ? "missing" : "engine",
    segment: { id, routeId, engine: "osrm" } as RouteProfileSegment["segment"],
  };
}

describe("Route Analysis interaction lookup", () => {
  const active0 = item("active-0", "osrm:0", 0, 100);
  const active1 = item("active-1", "osrm:0", 100, 300);
  const other = item("other-0", "valhalla:0", 0, 80);
  const missing = item("missing", "osrm:0", 300, 300, null);
  const profile: RouteProfile = {
    routeId: "osrm:0",
    segments: [active0, active1, other, missing],
    totalDistanceMeters: 300,
    warnings: [],
  };
  const lookup = buildRouteProfileSegmentLookup(profile);

  it("builds an exact stable-ID profile lookup", () => {
    expect(lookup.get("active-1")).toBe(active1);
    expect(lookup.get("absent")).toBeUndefined();
  });

  it("chooses the first hovered candidate on the active analysis route", () => {
    expect(
      findHoveredProfileSegment(
        ["other-0", "active-1", "active-0"],
        "osrm:0",
        lookup,
      ),
    ).toBe(active1);
  });

  it("never crosses routes or guesses a missing distance span", () => {
    expect(findHoveredProfileSegment(["other-0"], "osrm:0", lookup)).toBeNull();
    expect(findHoveredProfileSegment(["missing"], "osrm:0", lookup)).toBeNull();
    expect(findHoveredProfileSegment(["absent"], "osrm:0", lookup)).toBeNull();
  });
});


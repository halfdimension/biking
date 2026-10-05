import type { RouteProfile, RouteProfileSegment } from "./routeProfile";

/** Build once per profile so hover updates never scan the full edge sequence. */
export function buildRouteProfileSegmentLookup(
  profile: RouteProfile,
): Map<string, RouteProfileSegment> {
  return new Map(
    profile.segments.map((segment) => [segment.debugSegmentId, segment]),
  );
}

/**
 * Resolve the first stable map-hover candidate that belongs to the route being
 * analysed. The order from the existing MapLibre hit test remains authoritative.
 */
export function findHoveredProfileSegment(
  hoveredIds: readonly string[],
  routeId: string,
  lookup: ReadonlyMap<string, RouteProfileSegment>,
): RouteProfileSegment | null {
  for (const id of hoveredIds) {
    const segment = lookup.get(id);
    if (
      segment?.routeId === routeId &&
      segment.lengthMeters !== null &&
      segment.endDistanceMeters > segment.startDistanceMeters
    ) {
      return segment;
    }
  }
  return null;
}


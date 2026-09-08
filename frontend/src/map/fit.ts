/**
 * Pure map-fitting helpers (Task 18.1, Req 20.1–20.3).
 *
 * These functions compute the coordinate sets and bounding boxes used to frame
 * the map after a Compare or a manual "Fit Routes" action. They are intentionally
 * pure (NO MapLibre imports) so they can be unit tested directly; MapView applies
 * the resulting bounds via `map.fitBounds` / `map.easeTo` (design: Map
 * Presentation & Fitting — "The fit routine is a single shared function
 * parameterized by the set of coordinates to frame").
 *
 * Coordinate convention: all points are `[lon, lat]` (MapLibre/GeoJSON order),
 * matching `NormalizedRoute.coordinates`. Bounds are returned as a MapLibre
 * `LngLatBoundsLike` in `[[minLon, minLat], [maxLon, maxLat]]` (sw, ne) order.
 */
import type { Coordinate, NormalizedRoute } from "../types";

/** MapLibre `LngLatBoundsLike` as `[[minLon, minLat], [maxLon, maxLat]]`. */
export type Bounds = [[number, number], [number, number]];

/**
 * Compute the bounding box over the given `[lon, lat]` points.
 *
 * Returns `[[minLon, minLat], [maxLon, maxLat]]` (sw, ne). Returns `null` when
 * there are no points. A single point yields a degenerate box where `sw === ne`
 * (callers should prefer center+zoom for that case — see MapView.fitTo).
 */
export function computeBounds(coords: [number, number][]): Bounds | null {
  if (coords.length === 0) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

/**
 * Flatten every route's `coordinates` into a single `[lon, lat]` list, used to
 * frame all valid returned routes after a Compare (Req 20.1).
 */
export function collectRouteCoords(
  routes: NormalizedRoute[],
): [number, number][] {
  const out: [number, number][] = [];
  for (const r of routes) {
    for (const c of r.coordinates) {
      out.push(c);
    }
  }
  return out;
}

/**
 * Return the `[lon, lat]` of whichever of start/dest are set (Req 20.3).
 *
 * Inputs are `{ lat, lon }` (frontend input convention) and are mapped to
 * `[lon, lat]` for the map. Unset endpoints are omitted; the result may be
 * empty, a single point, or both points.
 */
export function markerCoords(
  start: Coordinate | null,
  dest: Coordinate | null,
): [number, number][] {
  const out: [number, number][] = [];
  if (start) out.push([start.lon, start.lat]);
  if (dest) out.push([dest.lon, dest.lat]);
  return out;
}

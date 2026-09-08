/**
 * Combined route GeoJSON source builder (Task 16.1, Req 3.1–3.5, 6.4).
 *
 * Produces ONE GeoJSON `FeatureCollection` containing every OSRM and Valhalla
 * route as a `LineString` feature. The combined source is added to MapLibre with
 * `promoteId: "routeId"`, so each feature's identity comes from its
 * `properties.routeId` (e.g. "osrm:0", "valhalla:2") — never a top-level feature
 * `id`. Visibility and selection are tracked entirely via MapLibre
 * `feature-state`, so only render-critical `color` lives in feature properties
 * (design: Map Rendering & Layer / Hit-testing Strategy — Source & layer model).
 *
 * This module is intentionally pure (no MapLibre imports) so it can be unit
 * tested directly. Per-route color families (Task 17.1) come from
 * {@link routeColor}, which is the default `colorFor`; `colorFor` stays
 * injectable so callers/tests can override it.
 */
import type { NormalizedRoute } from "../types";
import { routeColor } from "./color";

/**
 * Minimal GeoJSON typing for the combined routes source. Kept local (rather than
 * pulling in `@types/geojson`) so the builder stays dependency-light; the shape
 * is directly consumable by `map.getSource("routes").setData(...)`.
 */
export interface RouteFeatureProperties {
  routeId: string;
  engine: NormalizedRoute["engine"];
  index: number;
  isPrimary: boolean;
  color: string;
}

export interface RouteFeature {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
  properties: RouteFeatureProperties;
}

export interface RoutesFeatureCollection {
  type: "FeatureCollection";
  features: RouteFeature[];
}

/**
 * Default per-route color generator (Task 17.1). Delegates to {@link routeColor},
 * which assigns OSRM routes a blue-family HSL color and Valhalla routes a
 * warm-family one, rotating hue and modulating lightness by route index so
 * routes stay distinguishable (Req 4.1–4.4).
 */
export function defaultRouteColor(route: NormalizedRoute): string {
  return routeColor(route.engine, route.index);
}

/**
 * Build the single combined `FeatureCollection` from the current routes.
 *
 * Each route becomes one `LineString` feature carrying
 * `{ routeId, engine, index, isPrimary, color }`. No top-level feature `id` is
 * set — the source's `promoteId: "routeId"` promotes `properties.routeId` to the
 * feature id used by `map.setFeatureState`.
 *
 * @param routes  The flattened NormalizedRoute list (both engines).
 * @param colorFor Optional color generator; defaults to {@link defaultRouteColor}.
 */
export function buildRoutesFeatureCollection(
  routes: NormalizedRoute[],
  colorFor: (r: NormalizedRoute) => string = defaultRouteColor,
): RoutesFeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes.map((r) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: r.coordinates,
      },
      properties: {
        routeId: r.id,
        engine: r.engine,
        index: r.index,
        isPrimary: r.isPrimary,
        color: colorFor(r),
      },
    })),
  };
}

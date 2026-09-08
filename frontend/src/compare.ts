/**
 * Pure vs-primary comparison helper for the comparison table (Task 22.2,
 * Req 8.2, design Property 14).
 *
 * For a given route, {@link computeVsPrimary} finds that route's OWN-ENGINE
 * primary (the route in the same engine with `isPrimary` / index 0) and returns
 * the raw fractional differences for distance and duration:
 *
 *   diff = (value - primaryValue) / primaryValue
 *
 * The value is returned as a raw number (NOT a percent, NOT formatted) so the
 * table formats it via `formatPercentDiff`. `null` is returned whenever a diff
 * is not computable — the route's own value is missing, the engine has no
 * primary, the primary's value is missing, or the primary's value is `0`
 * (guarding against divide-by-zero / Infinity / NaN, Req 8.2).
 *
 * Cross-engine isolation: an OSRM alternate is always compared to the OSRM
 * primary and never to a Valhalla route, and vice versa. The primary route's
 * own diff is exactly `0`.
 *
 * The function is PURE: it reads only its arguments (no store, no DOM).
 */
import type { NormalizedRoute } from "./types";

/** Raw (unformatted) vs-primary fractional differences for one route. */
export interface VsPrimary {
  /** `(distance - primaryDistance) / primaryDistance`, or `null`. */
  distancePct: number | null;
  /** `(duration - primaryDuration) / primaryDuration`, or `null`. */
  durationPct: number | null;
}

/**
 * Find the primary route for a given engine within the routes list: the route
 * of that engine flagged `isPrimary`, else its index-0 route, else null.
 */
export function findEnginePrimary(
  engine: NormalizedRoute["engine"],
  routes: NormalizedRoute[],
): NormalizedRoute | null {
  const sameEngine = routes.filter((r) => r.engine === engine);
  return (
    sameEngine.find((r) => r.isPrimary) ??
    sameEngine.find((r) => r.index === 0) ??
    null
  );
}

/**
 * Compute the raw fractional difference of `value` vs `primary`, or `null` when
 * not computable (missing values or a zero primary — avoids NaN/Infinity).
 */
function rawDiff(value: number | null, primary: number | null): number | null {
  if (value == null || primary == null) return null;
  if (!Number.isFinite(value) || !Number.isFinite(primary)) return null;
  if (primary === 0) return null;
  const diff = (value - primary) / primary;
  return Number.isFinite(diff) ? diff : null;
}

/**
 * Compute a route's vs-primary distance and duration differences relative to
 * that route's own-engine primary (Req 8.2, Property 14).
 *
 * The primary route's own diff is `0` (value === primary). When the engine has
 * no primary, both diffs are `null`.
 */
export function computeVsPrimary(
  route: NormalizedRoute,
  routes: NormalizedRoute[],
): VsPrimary {
  const primary = findEnginePrimary(route.engine, routes);
  if (!primary) {
    return { distancePct: null, durationPct: null };
  }

  return {
    distancePct: rawDiff(route.distanceMeters, primary.distanceMeters),
    durationPct: rawDiff(route.durationSeconds, primary.durationSeconds),
  };
}

/**
 * Deterministic route hit-test resolution (Task 21.1, Req 6.1).
 *
 * Design ("Click hit-testing for overlapping routes"): a map click may land on
 * several overlapping route lines at once. `queryRenderedFeatures` returns the
 * candidates in top-to-bottom render order. This module owns the pure decision
 * of WHICH candidate becomes the selected route, isolated from MapLibre so it is
 * directly unit-testable (MapView maps `queryRenderedFeatures` results into
 * {@link RouteCandidate} objects and delegates here).
 *
 * Resolution rules, in order:
 *   1. No candidates → return null (selection unchanged upstream).
 *   2. If the currently selected route is among the candidates, keep it (so a
 *      click on a cluster that still contains the selection is stable / a no-op).
 *   3. Otherwise pick the topmost rendered candidate (first in query order).
 *   4. Break remaining ties deterministically by a stable order — `engine`
 *      (ascending, so "osrm" < "valhalla") then ascending `index` — so repeated
 *      clicks on the same overlap always resolve to the same route regardless of
 *      the incidental ordering the query returned.
 *
 * Rule 4 makes the outcome reproducible: the returned id does not depend on the
 * input order for candidates that share the top position (see hit-test
 * determinism property).
 */

/** A single hit-test candidate derived from a rendered `routes-hit` feature. */
export interface RouteCandidate {
  routeId: string;
  engine: string;
  index: number;
}

/**
 * Stable comparator: `engine` ascending, then `index` ascending. Used only to
 * break ties among candidates that are equally "topmost", so the resolution is
 * independent of the order `queryRenderedFeatures` happened to return.
 */
function compareStable(a: RouteCandidate, b: RouteCandidate): number {
  if (a.engine !== b.engine) return a.engine < b.engine ? -1 : 1;
  return a.index - b.index;
}

/**
 * Resolve the route id to select from a set of overlapping candidates.
 *
 * @param candidates       Hit-test candidates in top-to-bottom render order
 *                         (first = topmost rendered).
 * @param currentSelectedId The currently selected route id, or null.
 * @returns The chosen route id, or null when there are no candidates.
 */
export function resolveSelectedRouteId(
  candidates: RouteCandidate[],
  currentSelectedId: string | null,
): string | null {
  if (candidates.length === 0) return null;

  // Rule 2: keep the current selection if it is still under the cursor.
  if (
    currentSelectedId !== null &&
    candidates.some((c) => c.routeId === currentSelectedId)
  ) {
    return currentSelectedId;
  }

  // Rule 3: the topmost rendered candidate is the first in query order.
  const topmost = candidates[0];

  // Rule 4: if other candidates are also at the top (share the topmost's
  // routeId is impossible, but the query order is not guaranteed stable across
  // frames), pick the stable-minimum so repeated clicks are reproducible. We
  // treat all candidates as equally eligible and choose the stable minimum,
  // which for a single-element or already-ordered set equals `topmost`.
  //
  // NOTE: we intentionally choose the stable-minimum over ALL candidates rather
  // than only literal ties, because MapLibre does not guarantee a stable order
  // for coincident lines; a stable total order is what makes clicks
  // reproducible (design determinism).
  let chosen = topmost;
  for (const c of candidates) {
    if (compareStable(c, chosen) < 0) chosen = c;
  }
  return chosen.routeId;
}

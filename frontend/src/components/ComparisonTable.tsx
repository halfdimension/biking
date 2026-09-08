/**
 * Cross-engine comparison table (Task 22.2, Req 8).
 *
 * Renders one row per route in the store's `routes` list (OSRM rows first, then
 * Valhalla — the store's order). Columns (Req 8.1):
 *   Engine | Route | Type | Distance | Duration | Cost/Weight
 *   | Distance vs Primary | Duration vs Primary
 *
 * The vs-primary columns are computed against each route's OWN-ENGINE primary
 * (Req 8.2) and formatted with a signed percent; a zero / missing primary
 * renders as an em dash rather than NaN/Infinity. When engines return different
 * route counts, every returned route is still shown (Req 8.3).
 *
 * Selection funnels through the store's single `selectRoute` action (Req 8.4):
 * a row click selects that route, and the row matching `selectedRouteId` gets
 * the `--selected` class + `aria-selected`, so a map-side selection is
 * reflected here automatically. Rows are keyboard-accessible (Enter / Space).
 *
 * When there are no routes yet, a muted hint is shown instead of an empty table.
 */
import { useStore } from "../store";
import { routeColor } from "../map/color";
import { findEnginePrimary } from "../compare";
import {
  formatDistanceKm,
  formatDuration,
  formatCost,
  formatPercentDiff,
} from "../format";
import type { NormalizedRoute } from "../types";

function engineName(engine: NormalizedRoute["engine"]): string {
  return engine === "osrm" ? "OSRM" : "Valhalla";
}

export default function ComparisonTable() {
  const routes = useStore((s) => s.routes);
  const selectedRouteId = useStore((s) => s.selectedRouteId);
  const selectRoute = useStore((s) => s.selectRoute);

  if (routes.length === 0) {
    return (
      <p className="comparison-table__empty">
        No routes yet — press Compare Routes.
      </p>
    );
  }

  return (
    <div className="comparison-table__wrap">
      <table className="comparison-table" role="table">
        <thead>
          <tr>
            <th scope="col">Engine</th>
            <th scope="col">Route</th>
            <th scope="col">Type</th>
            <th scope="col" className="comparison-table__num">Distance</th>
            <th scope="col" className="comparison-table__num">Duration</th>
            <th scope="col" className="comparison-table__num">Cost/Weight</th>
            <th scope="col" className="comparison-table__num">Distance vs Primary</th>
            <th scope="col" className="comparison-table__num">Duration vs Primary</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((route) => {
            const primary = findEnginePrimary(route.engine, routes);
            const selected = route.id === selectedRouteId;
            return (
              <tr
                key={route.id}
                role="button"
                tabIndex={0}
                aria-selected={selected}
                data-testid={`comparison-row-${route.id}`}
                className={
                  "comparison-table__row" +
                  (selected ? " comparison-table__row--selected" : "")
                }
                onClick={() => selectRoute(route.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectRoute(route.id);
                  }
                }}
              >
                <td>{engineName(route.engine)}</td>
                <td>
                  <span className="comparison-table__label">
                    <span
                      className="comparison-table__swatch"
                      aria-hidden="true"
                      style={{ background: routeColor(route.engine, route.index) }}
                    />
                    {route.label}
                  </span>
                </td>
                <td>{route.isPrimary ? "Primary" : "Alternate"}</td>
                <td className="comparison-table__num">
                  {formatDistanceKm(route.distanceMeters)}
                </td>
                <td className="comparison-table__num">
                  {formatDuration(route.durationSeconds)}
                </td>
                <td className="comparison-table__num">{formatCost(route.cost)}</td>
                <td className="comparison-table__num">
                  {formatPercentDiff(
                    route.distanceMeters,
                    primary ? primary.distanceMeters : null,
                  )}
                </td>
                <td className="comparison-table__num">
                  {formatPercentDiff(
                    route.durationSeconds,
                    primary ? primary.durationSeconds : null,
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

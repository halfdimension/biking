/**
 * Selected-route details panel (Task 21.1 / 22.1, Req 6.6, 7.1, 7.4).
 *
 * Reads `selectedRouteId` + `routes` from the store and shows the matching
 * route's attributes. Selection flows through the store ONLY, so this panel
 * stays in sync with the map, the route list, and the comparison table
 * automatically.
 *
 * When nothing is selected, a muted hint is shown. When a route is selected it
 * shows the engine, label, primary/alternate, a color swatch, the distance (km)
 * and duration (h/min), the cost/weight, the per-engine request execution time
 * (from `results[engine].durationMs`, Req 7.1), and the route id, plus a
 * "Clear selection" control (calls `clearSelection`).
 *
 * Values are rendered with the shared pure formatters so the summary matches
 * the comparison table; missing values render as "—" (Req 7.4).
 */
import { useStore } from "../store";
import { routeColor } from "../map/color";
import {
  formatDistanceKm,
  formatDuration,
  formatCost,
  formatDurationMs,
} from "../format";

export default function SelectedRouteInfo() {
  const selectedRouteId = useStore((s) => s.selectedRouteId);
  const routes = useStore((s) => s.routes);
  const results = useStore((s) => s.results);
  const clearSelection = useStore((s) => s.clearSelection);

  const route = routes.find((r) => r.id === selectedRouteId) ?? null;

  if (!route) {
    return (
      <p className="selected-route__empty">
        No route selected — click a route on the map or in the list.
      </p>
    );
  }

  const engineName = route.engine === "osrm" ? "OSRM" : "Valhalla";
  const kind = route.isPrimary ? "Primary" : "Alternate";
  // Per-engine round-trip time measured by the backend (Req 7.1). Null when no
  // compare result is present for this engine.
  const engineResult = results ? results[route.engine] : null;
  const execMs = engineResult ? engineResult.durationMs : null;

  return (
    <div className="selected-route" data-testid="selected-route">
      <div className="selected-route__header">
        <span
          className="selected-route__swatch"
          aria-hidden="true"
          style={{ background: routeColor(route.engine, route.index) }}
        />
        <span className="selected-route__title">{route.label}</span>
      </div>

      <dl className="selected-route__fields">
        <dt>Engine</dt>
        <dd>{engineName}</dd>
        <dt>Type</dt>
        <dd>{kind}</dd>
        <dt>Distance</dt>
        <dd>{formatDistanceKm(route.distanceMeters)}</dd>
        <dt>Duration</dt>
        <dd>{formatDuration(route.durationSeconds)}</dd>
        <dt>Cost/Weight</dt>
        <dd>{formatCost(route.cost)}</dd>
        <dt>Request time</dt>
        <dd>{formatDurationMs(execMs)}</dd>
        <dt>ID</dt>
        <dd className="selected-route__id">{route.id}</dd>
      </dl>

      <button
        type="button"
        className="selected-route__clear"
        onClick={() => clearSelection()}
      >
        Clear selection
      </button>
    </div>
  );
}

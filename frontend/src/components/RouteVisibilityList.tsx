/**
 * Per-route visibility checkboxes for a single engine (Task 20.1, Req 5.1, 5.2).
 *
 * Renders one row per returned route of the given engine, grouped under that
 * engine's sidebar section (Req 5.1). Each row carries:
 *   - a checkbox bound to `visibility[route.id] ?? true` that writes back
 *     through the store's `setVisibility` (Req 5.2),
 *   - a color swatch from {@link routeColor} so the list doubles as a legend
 *     matching the map's per-route colors (Req 4.1–4.3),
 *   - the route label ("OSRM Primary", "Valhalla Alt 2", ...).
 *
 * Visibility flows through the STORE ONLY. This component never touches
 * MapLibre: `MapView` subscribes to `visibility` and pushes it into MapLibre
 * `feature-state` (design: "Visibility & selection via feature-state"), which
 * also collapses the hit layer's width to 0 for hidden routes.
 *
 * With no routes for the engine, a muted hint is shown instead of an empty
 * checkbox list (features exist only for returned routes, Req 3.5).
 */
import { useStore } from "../store";
import { routeColor } from "../map/color";
import type { Engine } from "../types";

interface RouteVisibilityListProps {
  engine: Engine;
}

export default function RouteVisibilityList({
  engine,
}: RouteVisibilityListProps) {
  // Cheap selectors: pull the raw slices and filter in the component body so we
  // never create a new array inside the selector (which would re-render always).
  const routes = useStore((s) => s.routes);
  const visibility = useStore((s) => s.visibility);
  const setVisibility = useStore((s) => s.setVisibility);
  const selectedRouteId = useStore((s) => s.selectedRouteId);
  const selectRoute = useStore((s) => s.selectRoute);

  const engineRoutes = routes.filter((r) => r.engine === engine);

  if (engineRoutes.length === 0) {
    return (
      <p className="route-list__empty">No routes yet — press Compare Routes.</p>
    );
  }

  return (
    <ul className="route-list">
      {engineRoutes.map((route) => {
        const id = `vis-${route.id}`;
        // Default to visible when the route has no entry yet (Req 5.1).
        const checked = visibility[route.id] ?? true;
        const selected = route.id === selectedRouteId;
        return (
          <li
            className={
              selected ? "route-row route-row--selected" : "route-row"
            }
            key={route.id}
          >
            {/* Visibility checkbox stays INDEPENDENT of selection (Req 5.2):
                it lives outside the selectable button, so toggling it never
                selects the route. */}
            <input
              className="route-row__checkbox"
              id={id}
              type="checkbox"
              checked={checked}
              aria-label={route.label}
              onChange={(e) => setVisibility(route.id, e.target.checked)}
            />
            {/* Clicking the row (label area) selects the route (Req 6.2). A
                <button> makes it keyboard-accessible (Enter/Space) for free.
                aria-pressed reflects the current selection so map↔list stay in
                sync. */}
            <button
              type="button"
              className="route-row__select"
              aria-pressed={selected}
              onClick={() => selectRoute(route.id)}
            >
              <span
                className="route-row__swatch"
                aria-hidden="true"
                style={{ background: routeColor(route.engine, route.index) }}
              />
              <span className="route-row__label">{route.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

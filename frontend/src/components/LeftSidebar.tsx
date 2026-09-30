/**
 * Left sidebar (Req 15.2).
 *
 * The Coordinates section hosts manual lat/lon inputs with validation
 * (CoordinateInputs, Task 14.1, Req 1.1, 17.4) and a live read-only OSRM/Valhalla
 * request preview (RequestPreview, Task 14.1, Req 1.8). Saved test cases are
 * managed via the TestCases panel (Task 26.1, Req 13).
 * The Map Selection section (Task 13.2, Req 1.2, 1.3) arms map click-to-set via
 * "Set Start on Map" / "Set Destination on Map" buttons wired to
 * `setMapClickTarget`, indicating which target is currently armed. The Request
 * Options section wires the Normal/Advanced mode toggle to the store (Req 9.1).
 */
import { useStore } from "../store";
import Section from "./Section";
import CoordinateInputs from "./CoordinateInputs";
import RequestPreview from "./RequestPreview";
import CurlImport from "./CurlImport";
import TestCases from "./TestCases";

function MapSelection() {
  const mapClickTarget = useStore((s) => s.mapClickTarget);
  const setMapClickTarget = useStore((s) => s.setMapClickTarget);

  // Toggle arming: clicking an already-armed control disarms it.
  const arm = (target: "start" | "dest") =>
    setMapClickTarget(mapClickTarget === target ? null : target);

  return (
    <div className="map-selection">
      <button
        type="button"
        className={
          "map-selection__btn" +
          (mapClickTarget === "start" ? " map-selection__btn--armed" : "")
        }
        aria-pressed={mapClickTarget === "start"}
        onClick={() => arm("start")}
      >
        Set Start on Map
      </button>
      <button
        type="button"
        className={
          "map-selection__btn" +
          (mapClickTarget === "dest" ? " map-selection__btn--armed" : "")
        }
        aria-pressed={mapClickTarget === "dest"}
        onClick={() => arm("dest")}
      >
        Set Destination on Map
      </button>
      <p className="map-selection__hint">
        {mapClickTarget === "start"
          ? "Click the map to set the start."
          : mapClickTarget === "dest"
            ? "Click the map to set the destination."
            : "Arm a control, then click the map. Or right-click the map for options."}
      </p>
    </div>
  );
}

function ModeToggle() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);

  return (
    <div className="mode-toggle" role="group" aria-label="Request mode">
      <button
        type="button"
        className={
          "mode-toggle__btn" + (mode === "normal" ? " mode-toggle__btn--active" : "")
        }
        aria-pressed={mode === "normal"}
        onClick={() => setMode("normal")}
      >
        Normal
      </button>
      <button
        type="button"
        className={
          "mode-toggle__btn" +
          (mode === "advanced" ? " mode-toggle__btn--active" : "")
        }
        aria-pressed={mode === "advanced"}
        onClick={() => setMode("advanced")}
      >
        Advanced
      </button>
    </div>
  );
}

export default function LeftSidebar() {
  const collapsed = useStore((s) => s.leftCollapsed);
  const toggle = useStore((s) => s.toggleLeftCollapsed);

  return (
    <aside
      className={"left-sidebar" + (collapsed ? " left-sidebar--collapsed" : "")}
      aria-label="Controls"
    >
      {/* Collapse/expand chevron near the sidebar's inner (right) edge. When
          collapsed only this control is rendered, so the sidebar shows a narrow
          rail with a reachable expand affordance. Contents read from the store,
          so simply not rendering them while collapsed loses no application
          state. */}
      <button
        type="button"
        className="panel-collapse panel-collapse--left"
        data-testid="collapse-left"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand left panel" : "Collapse left panel"}
        title={collapsed ? "Expand left panel" : "Collapse left panel"}
        onClick={toggle}
      >
        {collapsed ? "›" : "‹"}
      </button>

      {!collapsed && (
        <div className="left-sidebar__content">
          <Section title="Coordinates">
            <CoordinateInputs />
          </Section>
          <Section title="Map Selection">
            <MapSelection />
          </Section>
          <Section title="Request Options">
            <ModeToggle />
          </Section>
          <Section title="Request Preview">
            <RequestPreview />
          </Section>
          <Section title="Saved Test Cases">
            <TestCases />
          </Section>
          <Section title="Curl Import">
            <CurlImport />
          </Section>
        </div>
      )}
    </aside>
  );
}

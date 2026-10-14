/**
 * Top toolbar (Req 15.1).
 *
 * Contains the application title, a prominent "Compare Routes" button wired to
 * the store's `runCompare` action (disabled while a comparison is loading), and
 * per-engine health indicators reading `health` from the store (Req 2.6, 16.5).
 * A compact error banner surfaces `lastError` when a comparison fails (Req 17.1,
 * 17.2).
 */
import { useStore } from "../store";
import type { EngineHealth } from "../types";

const HEALTH_LABEL: Record<EngineHealth, string> = {
  reachable: "reachable",
  unreachable: "unreachable",
  unknown: "unknown",
};

function HealthIndicator({
  name,
  status,
}: {
  name: string;
  status: EngineHealth;
}) {
  const shortName = name.replace(/^Local /, "");
  return (
    <span className="health-indicator" title={`${name}: ${HEALTH_LABEL[status]}`}>
      <span
        className={`health-dot health-dot--${status}`}
        aria-hidden="true"
        data-testid={`health-dot-${name.toLowerCase().replace(/^local /, "")}`}
      />
      <span className="health-indicator__label">{shortName}</span>
      <span className="sr-only">: {HEALTH_LABEL[status]}</span>
    </span>
  );
}

export default function Toolbar() {
  const runCompare = useStore((s) => s.runCompare);
  const requestFit = useStore((s) => s.requestFit);
  const focusMap = useStore((s) => s.focusMap);
  const compareStatus = useStore((s) => s.compareStatus);
  const lastError = useStore((s) => s.lastError);
  const health = useStore((s) => s.health);
  const routingTarget = useStore((s) => s.routingTarget);
  const setRoutingTarget = useStore((s) => s.setRoutingTarget);
  const edgeDebugEnabled = useStore((s) => s.edgeDebugEnabled);
  const setEdgeDebugEnabled = useStore((s) => s.setEdgeDebugEnabled);

  const isLoading = compareStatus === "loading";

  return (
    <header className="toolbar">
      <h1 className="toolbar__title">
        Bike Routing Comparison &amp; Debugging Dashboard
      </h1>

      <div className="toolbar__actions">
        <div className="toolbar__target" aria-label="Routing target">
          <span>Routing</span>
          <div className="toolbar__segmented">
            <button type="button" aria-pressed={routingTarget === "local"} className={routingTarget === "local" ? "toolbar__target-active" : ""} onClick={() => setRoutingTarget("local")}>Local</button>
            <button type="button" aria-pressed={routingTarget === "prod"} className={routingTarget === "prod" ? "toolbar__target-active" : ""} onClick={() => setRoutingTarget("prod")}>Prod</button>
          </div>
        </div>

        <div className="toolbar__control-group">
          <button type="button" className="toolbar__compare-btn" onClick={() => void runCompare()} disabled={isLoading}>
            {isLoading ? <span className="button-spinner" aria-hidden="true" /> : null}
            {isLoading ? "Comparing…" : "Compare Routes"}
          </button>
          <button type="button" className={`toolbar__debug-btn${edgeDebugEnabled ? " toolbar__debug-btn--active" : ""}`} aria-pressed={edgeDebugEnabled} disabled={routingTarget === "prod"} title={routingTarget === "prod" ? "Edge Debug is available for Local Valhalla only." : undefined} onClick={() => setEdgeDebugEnabled(!edgeDebugEnabled)}>
            <span className="toolbar__debug-dot" aria-hidden="true" />
            Edge Debug: {edgeDebugEnabled ? "ON" : "OFF"}
          </button>
        </div>

        <div className="toolbar__control-group toolbar__control-group--map">
          <button type="button" className="toolbar__fit-btn" onClick={() => requestFit()}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" /></svg>
            Fit Routes
          </button>
          <button type="button" className="toolbar__focus-btn" data-testid="focus-map" title="Focus Map" onClick={() => focusMap()}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" /><path d="M5 5h6v6H5z" /></svg>
            Focus Map
          </button>
        </div>
      </div>

      {compareStatus === "error" && lastError ? (
        <span className="compare-error" role="alert">
          {lastError}
        </span>
      ) : null}

      <div className="toolbar__spacer" />

      <div className="health-indicators" aria-label="Engine health status">
        <HealthIndicator name="Local OSRM" status={health.osrm} />
        <HealthIndicator name="Local Valhalla" status={health.valhalla} />
      </div>
    </header>
  );
}

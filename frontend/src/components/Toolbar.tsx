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
  return (
    <span className="health-indicator" title={`${name}: ${HEALTH_LABEL[status]}`}>
      <span
        className={`health-dot health-dot--${status}`}
        aria-hidden="true"
        data-testid={`health-dot-${name.toLowerCase()}`}
      />
      <span>
        {name}: {HEALTH_LABEL[status]}
      </span>
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

  const isLoading = compareStatus === "loading";

  return (
    <header className="toolbar">
      <h1 className="toolbar__title">
        Bike Routing Comparison &amp; Debugging Dashboard
      </h1>

      <button
        type="button"
        className="toolbar__compare-btn"
        onClick={() => void runCompare()}
        disabled={isLoading}
      >
        {isLoading ? "Comparing…" : "Compare Routes"}
      </button>

      {/* Manual re-frame control (Req 20.2). Uses the same fit routine as the
          post-Compare auto-fit; falls back to start/dest markers when no routes
          exist (Req 20.3). */}
      <button
        type="button"
        className="toolbar__fit-btn"
        onClick={() => requestFit()}
      >
        Fit Routes
      </button>

      {/* Focus Map: a two-state toggle. First click collapses all three panels
          (remembering their prior states); a second click restores them. UI
          layout only — never touches routing/results/selection. */}
      <button
        type="button"
        className="toolbar__focus-btn"
        data-testid="focus-map"
        title="Focus Map"
        onClick={() => focusMap()}
      >
        Focus Map
      </button>

      {compareStatus === "error" && lastError ? (
        <span className="compare-error" role="alert">
          {lastError}
        </span>
      ) : null}

      <div className="toolbar__spacer" />

      <div className="health-indicators" aria-label="Engine health status">
        <HealthIndicator name="OSRM" status={health.osrm} />
        <HealthIndicator name="Valhalla" status={health.valhalla} />
      </div>
    </header>
  );
}

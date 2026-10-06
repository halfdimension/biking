import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import {
  STRUCTURAL_MAP_MIN_HEIGHT,
  useVerticalPanelResize,
} from "../layout/useVerticalPanelResize";
import { useStore } from "../store";
import type { CompareDebug } from "../types";
import EdgeDetailsPanel from "./EdgeDetailsPanel";
import TraceMap from "./TraceMap";
import TraceRouteAnalysis from "./TraceRouteAnalysis";

export const TRACE_DETAILS_DEFAULT_HEIGHT = 180;
export const TRACE_DETAILS_MIN_HEIGHT = 140;

export default function TraceInspector() {
  const results = useStore((state) => state.results);
  const sourceRouteId = useStore((state) => state.traceSourceRouteId);
  const status = useStore((state) => state.traceStatus);
  const result = useStore((state) => state.traceResult);
  const error = useStore((state) => state.traceError);
  const pinnedIds = useStore((state) => state.tracePinnedSegmentIds);
  const pinnedPoint = useStore((state) => state.tracePinnedPoint);
  const pinned = useStore((state) => state.traceInspectorPinned);
  const detailsCollapsed = useStore((state) => state.traceDetailsCollapsed);
  const preferredDetailsHeight = useStore(
    (state) => state.traceDetailsExpandedHeight,
  );
  const setSource = useStore((state) => state.setTraceSourceRouteId);
  const runTrace = useStore((state) => state.runValhallaTrace);
  const clearPin = useStore((state) => state.clearTracePin);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const detailsRef = useRef<HTMLElement | null>(null);
  const toggleDetails = useStore((state) => state.toggleTraceDetailsCollapsed);
  const setPreferredDetailsHeight = useStore(
    (state) => state.setTraceDetailsExpandedHeight,
  );
  const requestFit = useStore((state) => state.requestTraceFit);
  const lowerTab = useStore((state) => state.traceLowerTab);
  const setLowerTab = useStore((state) => state.setTraceLowerTab);
  const detailsCompact =
    detailsCollapsed || (lowerTab === "edge-details" && !pinned);
  const {
    liveHeight: liveDetailsHeight,
    minimumHeight: minimumDetailsHeight,
    maximumHeight: maximumDetailsHeight,
    resizing: resizingDetails,
    layoutRevision,
    resizeHandleProps,
  } = useVerticalPanelResize({
    workspaceRef,
    panelRef: detailsRef,
    preferredHeight: preferredDetailsHeight,
    panelMinimum: TRACE_DETAILS_MIN_HEIGHT,
    onPreferredHeightChange: setPreferredDetailsHeight,
    disabled: detailsCompact,
    bodyClassName: "is-resizing-trace-details",
  });

  const comparisonIsLocal = (results?.routingTarget ?? "local") === "local";
  const osrmRoutes = comparisonIsLocal
    ? (results?.osrm.normalizedRoutes ?? [])
    : [];
  const sourceRoute =
    osrmRoutes.find((route) => route.id === sourceRouteId) ?? osrmRoutes[0];
  const usableResult =
    result && result.sourceRouteId === sourceRoute?.id ? result : null;
  const traceRouteId = sourceRoute ? `trace:${sourceRoute.id}` : "trace:none";
  const visibility = useMemo(() => ({ [traceRouteId]: true }), [traceRouteId]);
  const routeLabels = useMemo(
    () => ({
      [traceRouteId]: sourceRoute
        ? `Valhalla Trace — ${sourceRoute.label}`
        : "Valhalla Trace",
    }),
    [sourceRoute, traceRouteId],
  );
  const debug = useMemo<CompareDebug | null>(
    () =>
      usableResult
        ? {
            osrm: { engine: "osrm", status: "ok", segments: [], errors: [] },
            valhalla: {
              engine: "valhalla",
              status: usableResult.status === "error" ? "error" : usableResult.status,
              segments: usableResult.segments,
              errors: usableResult.errors,
            },
          }
        : null,
    [usableResult],
  );

  useEffect(() => {
    if (!sourceRouteId && osrmRoutes[0]) {
      setSource(osrmRoutes[0].id);
    }
  }, [osrmRoutes, setSource, sourceRouteId]);

  const workspaceStyle: CSSProperties | undefined = detailsCompact
    ? undefined
    : {
        gridTemplateRows:
          `minmax(${STRUCTURAL_MAP_MIN_HEIGHT}px, 1fr) ${liveDetailsHeight}px`,
      };

  return (
    <main className="trace-inspector" aria-label="Trace Inspector">
      <header className="trace-toolbar">
        <div>
          <p className="trace-toolbar__eyebrow">MAP-MATCH DEBUGGING</p>
          <h1>Trace Inspector — Local Valhalla</h1>
          <p>Inspect Local Valhalla’s map-snapped interpretation of a preserved OSRM route.</p>
        </div>
        <button type="button" className="toolbar__fit-btn" onClick={requestFit}>
          Fit Routes
        </button>
      </header>

      <section className="trace-controls" aria-label="Trace controls">
        <label>
          <span>Source engine</span>
          <input value="OSRM" readOnly aria-readonly="true" />
        </label>
        <label>
          <span>Route</span>
          <select
            aria-label="Route"
            value={sourceRoute?.id ?? ""}
            disabled={osrmRoutes.length === 0 || status === "loading"}
            onChange={(event) => setSource(event.target.value)}
          >
            {osrmRoutes.map((route) => (
              <option key={route.id} value={route.id}>{route.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Valhalla costing</span>
          <input value="motorcycle" readOnly aria-readonly="true" />
        </label>
        <label>
          <span>Shape match</span>
          <input value="map_snap" readOnly aria-readonly="true" />
        </label>
        <button
          type="button"
          className="trace-controls__run"
          disabled={!sourceRoute || status === "loading"}
          onClick={() => void runTrace()}
        >
          {status === "loading" ? "Running Valhalla Trace…" : "Run Valhalla Trace"}
        </button>
      </section>

      {osrmRoutes.length === 0 ? (
        <div className="trace-empty" role="status">
          {comparisonIsLocal
            ? "Run a route comparison first."
            : "Trace Inspector is Local-only. Run a Local comparison first."}
        </div>
      ) : null}

      {error ? <div className="trace-error" role="alert">{error}</div> : null}

      {usableResult ? (
        <section className="trace-summary" aria-label="Trace summary">
          <div><span>Source route</span><strong>{sourceRoute?.label}</strong></div>
          <div><span>Original OSRM points</span><strong>{usableResult.originalPointCount}</strong></div>
          <div><span>Valhalla trace points</span><strong>{usableResult.tracePointCount}</strong></div>
          <div>
            <span>Exact geometry match</span>
            <strong className={usableResult.exactGeometryMatch ? "trace-summary__yes" : "trace-summary__changed"}>
              {usableResult.exactGeometryMatch ? "Yes" : "No"}
            </strong>
          </div>
          {usableResult.warnings.map((warning, index) => (
            <p className="trace-summary__warning" role="status" key={`${warning.kind}:${index}`}>
              {warning.message}
            </p>
          ))}
          {usableResult.errors.map((traceError, index) => (
            <p className="trace-summary__error" role="status" key={`${traceError.kind}:${index}`}>
              {traceError.message}
            </p>
          ))}
        </section>
      ) : null}

      <div
        ref={workspaceRef}
        className={
          "trace-workspace" +
          (detailsCompact ? " trace-workspace--details-compact" : "") +
          (resizingDetails ? " trace-workspace--resizing" : "")
        }
        style={workspaceStyle}
      >
        <TraceMap
          sourceRoute={sourceRoute}
          compactDetails={detailsCompact}
          layoutRevision={layoutRevision}
        />
        <section
          ref={detailsRef}
          className={"trace-details" + (detailsCompact ? " trace-details--compact" : "")}
          aria-label="Trace edge details"
        >
          {!detailsCompact ? (
            <div
              className="trace-details__resize-handle"
              data-testid="trace-details-resize-handle"
              role="separator"
              aria-label="Resize pinned trace edge details"
              aria-orientation="horizontal"
              aria-valuemin={Math.round(minimumDetailsHeight)}
              aria-valuemax={Math.round(maximumDetailsHeight)}
              aria-valuenow={Math.round(liveDetailsHeight)}
              aria-valuetext={`${Math.round(liveDetailsHeight)} pixels`}
              tabIndex={0}
              title="Drag to resize pinned trace edge details"
              {...resizeHandleProps}
            >
              <span />
            </div>
          ) : null}
          <div
            className="trace-details__tabs"
            role="tablist"
            aria-label="Trace analysis workspace"
          >
            <button
              type="button"
              role="tab"
              aria-selected={lowerTab === "edge-details"}
              onClick={() => setLowerTab("edge-details")}
            >
              Edge Details
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={lowerTab === "route-analysis"}
              onClick={() => setLowerTab("route-analysis")}
            >
              Route Analysis
            </button>
            {detailsCompact && lowerTab === "edge-details" && !pinned ? (
              <span className="trace-details__compact-status">
                No pinned edge
              </span>
            ) : null}
            {lowerTab === "route-analysis" || (detailsCompact && !pinned) ? (
              <button
              type="button"
              className="trace-details__collapse"
              aria-expanded={!detailsCompact}
              aria-label={
                lowerTab === "edge-details"
                  ? `${detailsCompact ? "Expand" : "Collapse"} pinned trace edge details`
                  : `${detailsCompact ? "Expand" : "Collapse"} trace route analysis`
              }
              disabled={lowerTab === "edge-details" && !pinned}
              onClick={toggleDetails}
            >
              {detailsCompact ? "Expand" : "Collapse"}
              </button>
            ) : null}
          </div>
          {!detailsCompact || (lowerTab === "edge-details" && pinned) ? (
            <div
              className="trace-details__body"
              hidden={detailsCompact && !pinned}
            >
              {lowerTab === "edge-details" ? (
                <EdgeDetailsPanel
                  debug={debug}
                  routeLabels={routeLabels}
                  visibility={visibility}
                  pinnedIds={pinnedIds}
                  pinned={pinned}
                  point={pinnedPoint}
                  onClear={clearPin}
                  collapsible
                  collapsed={detailsCollapsed}
                  onToggleCollapsed={toggleDetails}
                  title="PINNED TRACE EDGE DETAILS"
                />
              ) : (
                <TraceRouteAnalysis
                  sourceRoute={sourceRoute}
                  result={usableResult}
                />
              )}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

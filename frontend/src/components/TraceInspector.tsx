import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useStore } from "../store";
import type { CompareDebug } from "../types";
import EdgeDetailsPanel from "./EdgeDetailsPanel";
import TraceMap from "./TraceMap";

export const TRACE_DETAILS_DEFAULT_HEIGHT = 180;
export const TRACE_DETAILS_MIN_HEIGHT = 140;
export const TRACE_MAP_MIN_HEIGHT = 240;
export const TRACE_DETAILS_MAX_FRACTION = 0.65;
export const TRACE_DETAILS_KEYBOARD_STEP = 20;

export function maximumTraceDetailsHeight(workspaceHeight: number): number {
  const fractionalMaximum = Math.floor(
    workspaceHeight * TRACE_DETAILS_MAX_FRACTION,
  );
  const mapPreservingMaximum = Math.floor(
    workspaceHeight - TRACE_MAP_MIN_HEIGHT,
  );
  return Math.max(
    TRACE_DETAILS_MIN_HEIGHT,
    Math.min(fractionalMaximum, mapPreservingMaximum),
  );
}

export function clampTraceDetailsHeight(
  height: number,
  workspaceHeight: number,
): number {
  return Math.max(
    TRACE_DETAILS_MIN_HEIGHT,
    Math.min(maximumTraceDetailsHeight(workspaceHeight), height),
  );
}

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
  const dragStartRef = useRef<{
    pointerId: number;
    clientY: number;
    height: number;
  } | null>(null);
  const preferredHeightRef = useRef(preferredDetailsHeight);
  const liveHeightRef = useRef(preferredDetailsHeight);
  const [liveDetailsHeight, setLiveDetailsHeight] = useState(
    preferredDetailsHeight,
  );
  const [maxDetailsHeight, setMaxDetailsHeight] = useState(
    preferredDetailsHeight,
  );
  const [resizingDetails, setResizingDetails] = useState(false);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const toggleDetails = useStore((state) => state.toggleTraceDetailsCollapsed);
  const setPreferredDetailsHeight = useStore(
    (state) => state.setTraceDetailsExpandedHeight,
  );
  const requestFit = useStore((state) => state.requestTraceFit);
  const detailsCompact = !pinned || detailsCollapsed;

  const osrmRoutes = results?.osrm.normalizedRoutes ?? [];
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

  useEffect(() => {
    preferredHeightRef.current = preferredDetailsHeight;
    if (!dragStartRef.current) {
      liveHeightRef.current = preferredDetailsHeight;
      setLiveDetailsHeight(preferredDetailsHeight);
    }
  }, [preferredDetailsHeight]);

  const updateLiveDetailsHeight = useCallback((requestedHeight: number) => {
    const workspaceHeight =
      workspaceRef.current?.getBoundingClientRect().height ?? 0;
    const nextHeight = workspaceHeight > 0
      ? clampTraceDetailsHeight(requestedHeight, workspaceHeight)
      : Math.max(TRACE_DETAILS_MIN_HEIGHT, requestedHeight);
    if (workspaceHeight > 0) {
      setMaxDetailsHeight(maximumTraceDetailsHeight(workspaceHeight));
    }
    liveHeightRef.current = nextHeight;
    setLiveDetailsHeight(nextHeight);
    return nextHeight;
  }, []);

  const commitDetailsHeight = useCallback((requestedHeight: number) => {
    const nextHeight = updateLiveDetailsHeight(requestedHeight);
    preferredHeightRef.current = nextHeight;
    setPreferredDetailsHeight(nextHeight);
    setLayoutRevision((revision) => revision + 1);
  }, [setPreferredDetailsHeight, updateLiveDetailsHeight]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const clampRememberedHeight = () => {
      if (dragStartRef.current) return;
      const workspaceHeight = workspace.getBoundingClientRect().height;
      if (workspaceHeight <= 0) return;
      const nextMaximum = maximumTraceDetailsHeight(workspaceHeight);
      setMaxDetailsHeight(nextMaximum);
      const currentHeight = preferredHeightRef.current;
      const nextHeight = clampTraceDetailsHeight(currentHeight, workspaceHeight);
      if (nextHeight !== currentHeight) {
        preferredHeightRef.current = nextHeight;
        liveHeightRef.current = nextHeight;
        setLiveDetailsHeight(nextHeight);
        setPreferredDetailsHeight(nextHeight);
        setLayoutRevision((revision) => revision + 1);
      }
    };

    const observer = new ResizeObserver(clampRememberedHeight);
    observer.observe(workspace);
    window.addEventListener("resize", clampRememberedHeight);
    clampRememberedHeight();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", clampRememberedHeight);
      document.body.classList.remove("is-resizing-trace-details");
    };
  }, [setPreferredDetailsHeight]);

  const startDetailsResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (detailsCompact) return;
    const workspaceHeight =
      workspaceRef.current?.getBoundingClientRect().height ?? 0;
    if (workspaceHeight > 0) {
      setMaxDetailsHeight(maximumTraceDetailsHeight(workspaceHeight));
    }
    const renderedHeight =
      detailsRef.current?.getBoundingClientRect().height || liveHeightRef.current;
    dragStartRef.current = {
      pointerId: event.pointerId,
      clientY: event.clientY,
      height: renderedHeight,
    };
    liveHeightRef.current = renderedHeight;
    setLiveDetailsHeight(renderedHeight);
    setResizingDetails(true);
    document.body.classList.add("is-resizing-trace-details");
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const moveDetailsResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    updateLiveDetailsHeight(start.height + start.clientY - event.clientY);
    event.preventDefault();
  };

  const finishDetailsResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    dragStartRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizingDetails(false);
    document.body.classList.remove("is-resizing-trace-details");
    commitDetailsHeight(liveHeightRef.current);
  };

  const handleResizeKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = event.key === "ArrowUp"
      ? TRACE_DETAILS_KEYBOARD_STEP
      : -TRACE_DETAILS_KEYBOARD_STEP;
    commitDetailsHeight(liveHeightRef.current + delta);
  };

  const workspaceStyle: CSSProperties | undefined = detailsCompact
    ? undefined
    : {
        gridTemplateRows:
          `minmax(${TRACE_MAP_MIN_HEIGHT}px, 1fr) ${liveDetailsHeight}px`,
      };

  return (
    <main className="trace-inspector" aria-label="Trace Inspector">
      <header className="trace-toolbar">
        <div>
          <p className="trace-toolbar__eyebrow">MAP-MATCH DEBUGGING</p>
          <h1>Trace Inspector</h1>
          <p>Inspect Valhalla’s map-snapped interpretation of a preserved OSRM route.</p>
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
        <div className="trace-empty" role="status">Run a route comparison first.</div>
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
              aria-valuemin={TRACE_DETAILS_MIN_HEIGHT}
              aria-valuemax={Math.round(maxDetailsHeight)}
              aria-valuenow={Math.round(liveDetailsHeight)}
              aria-valuetext={`${Math.round(liveDetailsHeight)} pixels`}
              tabIndex={0}
              title="Drag to resize pinned trace edge details"
              onPointerDown={startDetailsResize}
              onPointerMove={moveDetailsResize}
              onPointerUp={finishDetailsResize}
              onPointerCancel={finishDetailsResize}
              onKeyDown={handleResizeKeyDown}
            >
              <span />
            </div>
          ) : null}
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
        </section>
      </div>
    </main>
  );
}


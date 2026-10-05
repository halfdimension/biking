import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ROUTE_METRICS,
  deriveRouteProfile,
  findProfileSegment,
  formatAnalysisNumber,
  formatRouteDistance,
  metricDomain,
  routeMetric,
  summarizeMetric,
  type MetricDefinition,
  type RouteMetricId,
  type RouteProfile,
  type RouteProfileSegment,
} from "../analysis/routeProfile";
import {
  buildRouteProfileSegmentLookup,
  findHoveredProfileSegment,
} from "../analysis/routeInteraction";
import {
  defaultRouteQuery,
  deriveRouteQueryValueOptions,
  evaluateRouteQuery,
  routeQueryField,
  routeQueryFieldsForEngine,
  type RouteQueryFieldId,
  type RouteQueryOperator,
} from "../analysis/routeQuery";
import { flattenDebugSegments } from "../map/debugSegments";
import { useStore } from "../store";
import type { NormalizedRoute } from "../types";
import "./RouteAnalysis.css";

const MARGIN = { top: 16, right: 22, bottom: 38, left: 58 };

interface ChartSize {
  width: number;
  height: number;
}

function useChartSize(): [React.RefObject<HTMLDivElement>, ChartSize] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ChartSize>({ width: 760, height: 220 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = (width: number, height: number) => {
      if (width > 0 && height > 0) {
        setSize({ width: Math.max(320, width), height: Math.max(170, height) });
      }
    };
    update(element.clientWidth, element.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) update(box.width, box.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

function preferredRouteId(
  routes: NormalizedRoute[],
  selectedRouteId: string | null,
): string | null {
  if (selectedRouteId && routes.some((route) => route.id === selectedRouteId)) {
    return selectedRouteId;
  }
  return (
    routes.find((route) => route.engine === "valhalla" && route.isPrimary)?.id ??
    routes[0]?.id ??
    null
  );
}

function ticks(minimum: number, maximum: number, count = 4): number[] {
  return Array.from(
    { length: count + 1 },
    (_, index) => minimum + ((maximum - minimum) * index) / count,
  );
}

function buildStepPath(
  profile: RouteProfile,
  metric: MetricDefinition,
  x: (distance: number) => number,
  y: (value: number) => number,
): string {
  let path = "";
  let previousEnd: number | null = null;
  for (const item of profile.segments) {
    const value = metric.value(item.segment);
    if (value === null || item.lengthMeters === null) {
      previousEnd = null;
      continue;
    }
    const start = x(item.startDistanceMeters);
    const end = x(item.endDistanceMeters);
    const vertical = y(value);
    if (previousEnd !== null && item.startDistanceMeters === previousEnd) {
      path += ` V ${vertical} H ${end}`;
    } else {
      path += `${path ? " " : ""}M ${start} ${vertical} H ${end}`;
    }
    previousEnd = item.endDistanceMeters;
  }
  return path;
}

function DetailRow({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Tooltip({
  item,
  route,
  metric,
}: {
  item: RouteProfileSegment;
  route: NormalizedRoute;
  metric: MetricDefinition;
}) {
  const segment = item.segment;
  const value = metric.value(segment);
  return (
    <div className="route-analysis__tooltip" role="status" data-testid="route-analysis-tooltip">
      <strong>{route.label}</strong>
      <span>Segment {segment.segmentIndex}</span>
      <dl>
        <DetailRow label="Route position">
          {`${formatRouteDistance(item.startDistanceMeters)} → ${formatRouteDistance(item.endDistanceMeters)}`}
        </DetailRow>
        <DetailRow label={metric.label}>
          {value === null ? "—" : `${formatAnalysisNumber(value)} ${metric.unit}`}
        </DetailRow>
        {segment.engine === "osrm" ? (
          <>
            {metric.id === "speed" ? (
              <DetailRow label="Original speed">
                {`${formatAnalysisNumber(segment.properties.speed)} m/s · ${formatAnalysisNumber(segment.properties.speed * 3.6)} km/h`}
              </DetailRow>
            ) : null}
            <DetailRow label="Distance">
              {`${formatAnalysisNumber(segment.properties.distance, 2)} m`}
            </DetailRow>
            <DetailRow label="Datasource">
              {segment.properties.datasourceName ?? String(segment.properties.datasource)}
            </DetailRow>
          </>
        ) : (
          <>
            {metric.id !== "speed" ? (
              <DetailRow label="Actual speed">
                {`${formatAnalysisNumber(segment.properties.speed)} km/h`}
              </DetailRow>
            ) : (
              <DetailRow label="Density">{formatAnalysisNumber(segment.properties.density)}</DetailRow>
            )}
            <DetailRow label="Road class">{segment.properties.roadClass || "—"}</DetailRow>
            <DetailRow label="Surface">{segment.properties.surface || "—"}</DetailRow>
            <DetailRow label="Length">
              {`${formatAnalysisNumber(segment.properties.lengthKm, 3)} km`}
            </DetailRow>
            <DetailRow label="Edge ID">{segment.properties.id || "—"}</DetailRow>
          </>
        )}
      </dl>
    </div>
  );
}

function RouteProfileChart({
  profile,
  route,
  metric,
  mapHoveredSegment,
  onFocusSegment,
  onPinSegment,
}: {
  profile: RouteProfile;
  route: NormalizedRoute;
  metric: MetricDefinition;
  mapHoveredSegment: RouteProfileSegment | null;
  onFocusSegment: (id: string | null) => void;
  onPinSegment: (id: string) => void;
}) {
  const [containerRef, size] = useChartSize();
  const [hovered, setHovered] = useState<RouteProfileSegment | null>(null);
  const [graphPointerActive, setGraphPointerActive] = useState(false);
  const focusedIdRef = useRef<string | null>(null);
  const values = useMemo(
    () =>
      profile.segments
        .map((item) => metric.value(item.segment))
        .filter((value): value is number => value !== null),
    [metric, profile],
  );
  const domain = metricDomain(values);
  const plotWidth = Math.max(1, size.width - MARGIN.left - MARGIN.right);
  const plotHeight = Math.max(1, size.height - MARGIN.top - MARGIN.bottom);
  const total = Math.max(profile.totalDistanceMeters, 1);
  const x = (distance: number) => MARGIN.left + (distance / total) * plotWidth;
  const y = (value: number) => {
    if (!domain) return MARGIN.top + plotHeight / 2;
    return MARGIN.top + ((domain[1] - value) / (domain[1] - domain[0])) * plotHeight;
  };
  const path = domain ? buildStepPath(profile, metric, x, y) : "";
  const xTicks = profile.totalDistanceMeters > 0
    ? ticks(0, profile.totalDistanceMeters)
    : [0];
  const yTicks = domain ? ticks(domain[0], domain[1]) : [];

  const segmentAtPointer = (
    event:
      | ReactPointerEvent<SVGSVGElement>
      | ReactMouseEvent<SVGSVGElement>,
  ): RouteProfileSegment | null => {
    const box = event.currentTarget.getBoundingClientRect();
    const renderedWidth = box.width || size.width;
    const clientX = Number.isFinite(event.clientX)
      ? event.clientX
      : box.left + MARGIN.left;
    const localX = ((clientX - box.left) / renderedWidth) * size.width;
    if (localX < MARGIN.left || localX > MARGIN.left + plotWidth) return null;
    const distance =
      ((localX - MARGIN.left) / plotWidth) * profile.totalDistanceMeters;
    return findProfileSegment(profile, distance);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const next = segmentAtPointer(event);
    if (!graphPointerActive) setGraphPointerActive(true);
    if (next?.debugSegmentId !== hovered?.debugSegmentId) setHovered(next);
    const nextId = next?.debugSegmentId ?? null;
    if (focusedIdRef.current !== nextId) {
      focusedIdRef.current = nextId;
      onFocusSegment(nextId);
    }
  };

  const onPointerLeave = () => {
    setGraphPointerActive(false);
    setHovered(null);
    if (focusedIdRef.current !== null) {
      focusedIdRef.current = null;
      onFocusSegment(null);
    }
  };

  const activeSegment = graphPointerActive ? hovered : mapHoveredSegment;

  return (
    <div className="route-analysis__chart" ref={containerRef} data-testid="route-profile-chart">
      <svg
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="img"
        aria-label={`${route.label} ${metric.label} step profile`}
        aria-description="Hover to inspect a routed edge. Click chart to pin edge details."
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onClick={(event) => {
          const segment = segmentAtPointer(event);
          if (segment) onPinSegment(segment.debugSegmentId);
        }}
      >
        <g className="route-analysis__grid">
          {xTicks.map((tick) => (
            <line key={`x-${tick}`} x1={x(tick)} x2={x(tick)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} />
          ))}
          {yTicks.map((tick) => (
            <line key={`y-${tick}`} x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(tick)} y2={y(tick)} />
          ))}
        </g>
        <g className="route-analysis__axis-labels">
          {xTicks.map((tick) => (
            <text key={`xl-${tick}`} x={x(tick)} y={size.height - 12} textAnchor="middle">
              {formatRouteDistance(tick)}
            </text>
          ))}
          {yTicks.map((tick) => (
            <text key={`yl-${tick}`} x={MARGIN.left - 9} y={y(tick) + 4} textAnchor="end">
              {formatAnalysisNumber(tick, metric.id === "density" ? 0 : 1)}
            </text>
          ))}
          <text className="route-analysis__unit" x={MARGIN.left} y={11}>{metric.unit}</text>
        </g>
        {activeSegment ? (
          <rect
            className="route-analysis__active-band"
            data-testid="route-analysis-active-band"
            x={x(activeSegment.startDistanceMeters)}
            y={MARGIN.top}
            width={Math.max(
              1,
              x(activeSegment.endDistanceMeters) -
                x(activeSegment.startDistanceMeters),
            )}
            height={plotHeight}
          />
        ) : null}
        <path className="route-analysis__profile" d={path} />
        {activeSegment ? (
          <line
            className="route-analysis__cursor"
            x1={x(activeSegment.startDistanceMeters)}
            x2={x(activeSegment.startDistanceMeters)}
            y1={MARGIN.top}
            y2={MARGIN.top + plotHeight}
          />
        ) : null}
      </svg>
      {activeSegment ? (
        <Tooltip item={activeSegment} route={route} metric={metric} />
      ) : null}
    </div>
  );
}

export default function RouteAnalysis() {
  const debug = useStore((state) => state.debugResults);
  const routes = useStore((state) => state.routes);
  const selectedRouteId = useStore((state) => state.selectedRouteId);
  const visibility = useStore((state) => state.visibility);
  const comparisonResultRevision = useStore(
    (state) => state.comparisonResultRevision,
  );
  const analysisRouteId = useStore((state) => state.routeAnalysisRouteId);
  const metricId = useStore((state) => state.routeAnalysisMetricId);
  const query = useStore((state) => state.routeAnalysisQuery);
  const executedSearch = useStore(
    (state) => state.routeAnalysisExecutedSearch,
  );
  const setAnalysisRouteId = useStore(
    (state) => state.setRouteAnalysisRouteId,
  );
  const setMetricId = useStore((state) => state.setRouteAnalysisMetricId);
  const setQuery = useStore((state) => state.setRouteAnalysisQuery);
  const setExecutedSearch = useStore(
    (state) => state.setRouteAnalysisExecutedSearch,
  );
  const clearSearch = useStore((state) => state.clearRouteAnalysisSearch);
  const hoveredDebugSegmentIds = useStore(
    (state) => state.hoveredDebugSegmentIds,
  );
  const setFocusedSegmentId = useStore(
    (state) => state.setRouteAnalysisFocusedSegmentId,
  );
  const pinDebugSegments = useStore((state) => state.pinDebugSegments);

  const segments = useMemo(() => flattenDebugSegments(debug), [debug]);
  const segmentRouteIds = useMemo(
    () => new Set(segments.map((segment) => segment.routeId)),
    [segments],
  );
  const analysisRoutes = useMemo(
    () => routes.filter((route) => segmentRouteIds.has(route.id)),
    [routes, segmentRouteIds],
  );
  const fallbackRouteId = preferredRouteId(analysisRoutes, selectedRouteId);
  const effectiveRouteId =
    analysisRouteId && segmentRouteIds.has(analysisRouteId)
      ? analysisRouteId
      : fallbackRouteId;

  useEffect(() => {
    const next =
      analysisRouteId &&
      analysisRoutes.some((route) => route.id === analysisRouteId)
        ? analysisRouteId
        : preferredRouteId(analysisRoutes, selectedRouteId);
    if (next !== analysisRouteId) setAnalysisRouteId(next);
  }, [
    analysisRouteId,
    analysisRoutes,
    selectedRouteId,
    setAnalysisRouteId,
  ]);

  useEffect(() => {
    if (!debug) setFocusedSegmentId(null);
    return () => setFocusedSegmentId(null);
  }, [debug, setFocusedSegmentId]);

  const route =
    analysisRoutes.find((item) => item.id === effectiveRouteId) ?? null;
  const profile = useMemo(
    () =>
      effectiveRouteId
        ? deriveRouteProfile(segments, effectiveRouteId)
        : null,
    [effectiveRouteId, segments],
  );
  const metric = routeMetric(metricId);
  const profileLookup = useMemo(
    () =>
      profile
        ? buildRouteProfileSegmentLookup(profile)
        : new Map<string, RouteProfileSegment>(),
    [profile],
  );
  const mapHoveredSegment = effectiveRouteId
    ? findHoveredProfileSegment(
        hoveredDebugSegmentIds,
        effectiveRouteId,
        profileLookup,
      )
    : null;
  const summary = useMemo(
    () => (profile ? summarizeMetric(profile, metric) : null),
    [metric, profile],
  );
  const queryFields = useMemo(
    () => (route ? routeQueryFieldsForEngine(route.engine) : []),
    [route],
  );
  const field =
    queryFields.find((item) => item.id === query.field) ?? queryFields[0] ?? null;

  useEffect(() => {
    if (!route || !field) return;
    if (field.id !== query.field || !field.operators.includes(query.operator)) {
      setQuery(defaultRouteQuery(route.engine));
    }
  }, [field, query.field, query.operator, route, setQuery]);

  const valueOptions = useMemo(
    () =>
      profile && field
        ? deriveRouteQueryValueOptions(profile, field)
        : [],
    [field, profile],
  );
  const activeSearch =
    executedSearch &&
    executedSearch.comparisonResultRevision === comparisonResultRevision &&
    executedSearch.routeId === effectiveRouteId
      ? executedSearch
      : null;
  const routeVisible = effectiveRouteId
    ? (visibility[effectiveRouteId] ?? true)
    : true;
  const hasQueryValue = query.value.trim() !== "";

  if (!debug) {
    return (
      <div className="route-analysis__empty">
        <strong>Route Analysis requires edge-debug data.</strong>
        <span>Enable Edge Debug and run Compare Routes.</span>
      </div>
    );
  }
  if (!route || !profile || !summary || !field) {
    return (
      <div className="route-analysis__empty">
        <strong>No routed debug segments are available.</strong>
        <span>Run Compare Routes with Edge Debug enabled.</span>
      </div>
    );
  }

  const updateField = (fieldId: RouteQueryFieldId) => {
    const nextField =
      queryFields.find((item) => item.id === fieldId) ?? queryFields[0];
    if (!nextField) return;
    setQuery({
      field: nextField.id,
      operator: nextField.operators[0],
      value: "",
    });
  };

  const runSearch = () => {
    if (!hasQueryValue) return;
    const result = evaluateRouteQuery(profile, query);
    setExecutedSearch({
      comparisonResultRevision,
      routeId: route.id,
      query: { ...query },
      result,
    });
  };

  return (
    <section className="route-analysis" aria-label="Route Analysis">
      <div className="route-analysis__toolbar">
        <label>
          <span>Route</span>
          <select
            aria-label="Route"
            value={effectiveRouteId ?? ""}
            onChange={(event) => {
              const routeId = event.target.value;
              setAnalysisRouteId(routeId);
              const nextRoute = analysisRoutes.find(
                (item) => item.id === routeId,
              );
              if (
                nextRoute &&
                !routeQueryField(query.field).engines.includes(nextRoute.engine)
              ) {
                setQuery(defaultRouteQuery(nextRoute.engine));
              }
            }}
          >
            {analysisRoutes.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Metric</span>
          <select
            aria-label="Metric"
            value={metricId}
            onChange={(event) =>
              setMetricId(event.target.value as RouteMetricId)
            }
          >
            {ROUTE_METRICS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <div className="route-analysis__summary" aria-label="Profile summary">
          <span><b>{route.label}</b> · {route.engine.toUpperCase()}</span>
          <span>{profile.segments.length} segments · {formatRouteDistance(profile.totalDistanceMeters)}</span>
          <span>{metric.label} · {summary.availableCount} / {summary.totalCount} segments</span>
          {summary.minimum !== null && summary.maximum !== null ? (
            <span>
              Min {formatAnalysisNumber(summary.minimum)} · Max {formatAnalysisNumber(summary.maximum)} {metric.unit}
              {metric.id === "speed" && summary.weightedAverage !== null
                ? ` · Weighted avg ${formatAnalysisNumber(summary.weightedAverage)} ${metric.unit}`
                : ""}
            </span>
          ) : null}
        </div>
      </div>

      <form
        className="route-analysis__search"
        aria-label="Search and highlight"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
        <strong>SEARCH / HIGHLIGHT</strong>
        <label>
          <span>Field</span>
          <select
            aria-label="Search field"
            value={field.id}
            onChange={(event) =>
              updateField(event.target.value as RouteQueryFieldId)
            }
          >
            {queryFields.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Operator</span>
          <select
            aria-label="Search operator"
            value={query.operator}
            onChange={(event) =>
              setQuery({
                ...query,
                operator: event.target.value as RouteQueryOperator,
              })
            }
          >
            {field.operators.map((operator) => (
              <option key={operator} value={operator}>{operator}</option>
            ))}
          </select>
        </label>
        <label className="route-analysis__search-value">
          <span>Value{field.unit ? ` (${field.unit})` : ""}</span>
          {field.valueType === "boolean" ? (
            <select
              aria-label="Search value"
              value={query.value}
              onChange={(event) =>
                setQuery({ ...query, value: event.target.value })
              }
            >
              <option value="">Choose…</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : valueOptions.length ? (
            <select
              aria-label="Search value"
              value={query.value}
              onChange={(event) =>
                setQuery({ ...query, value: event.target.value })
              }
            >
              <option value="">Choose…</option>
              {valueOptions.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          ) : (
            <input
              aria-label="Search value"
              type={field.valueType === "number" ? "number" : "text"}
              step={field.valueType === "number" ? "any" : undefined}
              value={query.value}
              onChange={(event) =>
                setQuery({ ...query, value: event.target.value })
              }
            />
          )}
        </label>
        <button type="submit" disabled={!hasQueryValue}>Highlight</button>
        <button
          type="button"
          onClick={clearSearch}
          disabled={!activeSearch}
        >
          Clear
        </button>
        {activeSearch ? (
          <div
            className="route-analysis__match-summary"
            aria-label="Match statistics"
          >
            <b>{activeSearch.result.matchingSegmentCount}</b>
            {" matching segments · "}
            <b>{formatRouteDistance(activeSearch.result.matchedDistanceMeters)}</b>
            {" matched · "}
            <b>{formatAnalysisNumber(activeSearch.result.matchedPercentage)}%</b>
            {" of route"}
            {activeSearch.result.hasIncompleteDistanceCoverage
              ? ` · distance incomplete for ${activeSearch.result.missingLengthSegmentCount} matching segment${activeSearch.result.missingLengthSegmentCount === 1 ? "" : "s"}`
              : ""}
          </div>
        ) : null}
        {activeSearch && !routeVisible ? (
          <span className="route-analysis__hidden-note">
            Selected analysis route is hidden on the map.
          </span>
        ) : null}
      </form>

      {summary.availableCount === 0 ? (
        <div className="route-analysis__unavailable">
          {metric.label} is not available for this route/engine.
        </div>
      ) : (
        <RouteProfileChart
          profile={profile}
          route={route}
          metric={metric}
          mapHoveredSegment={mapHoveredSegment}
          onFocusSegment={setFocusedSegmentId}
          onPinSegment={(id) => pinDebugSegments([id], null)}
        />
      )}
      {profile.warnings.length ? (
        <details className="route-analysis__warnings">
          <summary>{profile.warnings.length} length warning{profile.warnings.length === 1 ? "" : "s"}</summary>
          <ul>{profile.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}

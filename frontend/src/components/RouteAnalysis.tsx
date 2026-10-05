import {
  useEffect,
  useMemo,
  useRef,
  useState,
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
}: {
  profile: RouteProfile;
  route: NormalizedRoute;
  metric: MetricDefinition;
}) {
  const [containerRef, size] = useChartSize();
  const [hovered, setHovered] = useState<RouteProfileSegment | null>(null);
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

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const renderedWidth = box.width || size.width;
    const clientX = Number.isFinite(event.clientX)
      ? event.clientX
      : box.left + MARGIN.left;
    const localX = ((clientX - box.left) / renderedWidth) * size.width;
    const clampedX = Math.max(MARGIN.left, Math.min(MARGIN.left + plotWidth, localX));
    const distance = ((clampedX - MARGIN.left) / plotWidth) * profile.totalDistanceMeters;
    setHovered(findProfileSegment(profile, distance));
  };

  return (
    <div className="route-analysis__chart" ref={containerRef} data-testid="route-profile-chart">
      <svg
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="img"
        aria-label={`${route.label} ${metric.label} step profile`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHovered(null)}
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
        <path className="route-analysis__profile" d={path} />
        {hovered ? (
          <line
            className="route-analysis__cursor"
            x1={x(hovered.startDistanceMeters)}
            x2={x(hovered.startDistanceMeters)}
            y1={MARGIN.top}
            y2={MARGIN.top + plotHeight}
          />
        ) : null}
      </svg>
      {hovered ? <Tooltip item={hovered} route={route} metric={metric} /> : null}
    </div>
  );
}

export default function RouteAnalysis() {
  const debug = useStore((state) => state.debugResults);
  const routes = useStore((state) => state.routes);
  const selectedRouteId = useStore((state) => state.selectedRouteId);
  const [analysisRouteId, setAnalysisRouteId] = useState<string | null>(null);
  const [metricId, setMetricId] = useState<RouteMetricId>("speed");

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
    setAnalysisRouteId((current) =>
      current && analysisRoutes.some((route) => route.id === current)
        ? current
        : preferredRouteId(analysisRoutes, selectedRouteId),
    );
  }, [analysisRoutes, selectedRouteId]);

  const route = analysisRoutes.find((item) => item.id === effectiveRouteId) ?? null;
  const profile = useMemo(
    () => (effectiveRouteId ? deriveRouteProfile(segments, effectiveRouteId) : null),
    [effectiveRouteId, segments],
  );
  const metric = routeMetric(metricId);
  const summary = useMemo(
    () => (profile ? summarizeMetric(profile, metric) : null),
    [metric, profile],
  );

  if (!debug) {
    return (
      <div className="route-analysis__empty">
        <strong>Route Analysis requires edge-debug data.</strong>
        <span>Enable Edge Debug and run Compare Routes.</span>
      </div>
    );
  }
  if (!route || !profile || !summary) {
    return (
      <div className="route-analysis__empty">
        <strong>No routed debug segments are available.</strong>
        <span>Run Compare Routes with Edge Debug enabled.</span>
      </div>
    );
  }

  return (
    <section className="route-analysis" aria-label="Route Analysis">
      <div className="route-analysis__toolbar">
        <label>
          <span>Route</span>
          <select
            aria-label="Route"
            value={effectiveRouteId ?? ""}
            onChange={(event) => setAnalysisRouteId(event.target.value)}
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
            onChange={(event) => setMetricId(event.target.value as RouteMetricId)}
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
      {summary.availableCount === 0 ? (
        <div className="route-analysis__unavailable">
          {metric.label} is not available for this route/engine.
        </div>
      ) : (
        <RouteProfileChart profile={profile} route={route} metric={metric} />
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

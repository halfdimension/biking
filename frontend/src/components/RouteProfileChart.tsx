import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  findProfileSegment,
  formatAnalysisNumber,
  formatRouteDistance,
  metricDomain,
  type MetricDefinition,
  type RouteProfile,
  type RouteProfileSegment,
} from "../analysis/routeProfile";
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
  route: { label: string };
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
            <DetailRow label="Way ID">{segment.properties.wayId || "—"}</DetailRow>
          </>
        )}
      </dl>
    </div>
  );
}

export default function RouteProfileChart({
  profile,
  route,
  metric,
  mapHoveredSegment,
  onFocusSegment,
  onPinSegment,
}: {
  profile: RouteProfile;
  route: { label: string };
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


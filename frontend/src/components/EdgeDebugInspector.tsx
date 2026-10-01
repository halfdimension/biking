import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { buildDebugSegmentLookup } from "../map/debugSegments";
import type {
  DebugSegment,
  OsrmDebugSegment,
  ValhallaDebugSegment,
} from "../types";

export const EDGE_HOVER_DISMISS_DELAY_MS = 3000;

function value(input: unknown, unit = ""): string {
  if (input === null || input === undefined || input === "") return "—";
  if (Array.isArray(input)) return input.length ? input.join(", ") : "—";
  return `${input}${unit}`;
}

function routeLabel(
  segment: DebugSegment,
  labels: Map<string, string>,
): string {
  return (
    labels.get(segment.routeId) ??
    `${segment.engine.toUpperCase()} ${segment.routeIndex === 0 ? "Primary" : `Alt ${segment.routeIndex}`}`
  );
}

function SummaryRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="edge-hover__fields">
      {rows.map(([label, rendered]) => (
        <div className="edge-hover__field" key={label}>
          <dt>{label}</dt>
          <dd>{rendered}</dd>
        </div>
      ))}
    </dl>
  );
}

function OsrmSummary({
  segment,
  label,
}: {
  segment: OsrmDebugSegment;
  label: string;
}) {
  const p = segment.properties;
  const speed =
    typeof p.speed === "number"
      ? `${p.speed} m/s · ${(p.speed * 3.6).toFixed(1)} km/h`
      : "—";

  return (
    <section className="edge-hover__section" data-testid="edge-hover-osrm">
      <div className="edge-hover__heading">
        <strong>OSRM</strong>
        <span>{label}</span>
        <b>#{segment.segmentIndex}</b>
      </div>
      <SummaryRows
        rows={[
          ["Speed", speed],
          ["Distance", value(p.distance, " m")],
          ["Duration", value(p.duration, " s")],
          ["Datasource", value(p.datasourceName ?? p.datasource)],
        ]}
      />
    </section>
  );
}

function ValhallaSummary({
  segment,
  label,
}: {
  segment: ValhallaDebugSegment;
  label: string;
}) {
  const p = segment.properties;
  return (
    <section className="edge-hover__section" data-testid="edge-hover-valhalla">
      <div className="edge-hover__heading">
        <strong>VALHALLA</strong>
        <span>{label}</span>
        <b>#{segment.segmentIndex}</b>
      </div>
      <SummaryRows
        rows={[
          ["Name", value(p.name)],
          ["Speed", value(p.speed, " km/h")],
          ["Density", value(p.density)],
          ["Road class", value(p.roadClass)],
          ["Surface", value(p.surface)],
          ["Length", value(p.lengthKm, " km")],
          ["Edge ID", value(p.id || p.wayId)],
        ]}
      />
    </section>
  );
}

/** Compact, hover-only map card. Long-form data lives in the Edge Details tab. */
export default function EdgeDebugInspector() {
  const enabled = useStore((state) => state.edgeDebugEnabled);
  const debug = useStore((state) => state.debugResults);
  const routes = useStore((state) => state.routes);
  const visibility = useStore((state) => state.visibility);
  const hoveredIds = useStore((state) => state.hoveredDebugSegmentIds);
  const [visible, setVisible] = useState(false);
  const [displayedIds, setDisplayedIds] = useState<string[]>([]);
  const pointerOverCardRef = useRef(false);
  const hasDisplayedContentRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current === null) return;
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    if (pointerOverCardRef.current) return;
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      if (pointerOverCardRef.current) return;
      hasDisplayedContentRef.current = false;
      setVisible(false);
      setDisplayedIds([]);
    }, EDGE_HOVER_DISMISS_DELAY_MS);
  }, [cancelHide]);

  useEffect(() => {
    if (!enabled || !debug) {
      pointerOverCardRef.current = false;
      hasDisplayedContentRef.current = false;
      cancelHide();
      setVisible(false);
      setDisplayedIds([]);
      return;
    }

    if (hoveredIds.length > 0) {
      cancelHide();
      hasDisplayedContentRef.current = true;
      setDisplayedIds((current) =>
        current.length === hoveredIds.length &&
        current.every((id, index) => id === hoveredIds[index])
          ? current
          : [...hoveredIds],
      );
      setVisible(true);
      return;
    }

    if (hasDisplayedContentRef.current) scheduleHide();
  }, [cancelHide, debug, enabled, hoveredIds, scheduleHide]);

  useEffect(() => cancelHide, [cancelHide]);

  const lookup = useMemo(() => buildDebugSegmentLookup(debug), [debug]);
  const labels = useMemo(
    () => new Map(routes.map((route) => [route.id, route.label])),
    [routes],
  );
  const segments = displayedIds
    .map((id) => lookup.get(id))
    .filter(
      (segment): segment is DebugSegment =>
        segment !== undefined && (visibility[segment.routeId] ?? true),
    );
  // A 6px hit box can contain adjacent edges from the same engine. Keep the
  // entire set for click/pin, but show one representative per engine here.
  const summarySegments = (["osrm", "valhalla"] as const)
    .map((engine) => segments.find((segment) => segment.engine === engine))
    .filter((segment): segment is DebugSegment => segment !== undefined);

  const handleCardMouseEnter = () => {
    pointerOverCardRef.current = true;
    cancelHide();
  };

  const handleCardMouseLeave = () => {
    pointerOverCardRef.current = false;
    scheduleHide();
  };

  if (!enabled || !debug || !visible || segments.length === 0) return null;

  return (
    <aside
      className="edge-hover"
      aria-label="Hovered edge summary"
      aria-live="polite"
      onMouseEnter={handleCardMouseEnter}
      onMouseLeave={handleCardMouseLeave}
    >
      {summarySegments.map((segment) =>
        segment.engine === "osrm" ? (
          <OsrmSummary
            key={segment.id}
            segment={segment}
            label={routeLabel(segment, labels)}
          />
        ) : (
          <ValhallaSummary
            key={segment.id}
            segment={segment}
            label={routeLabel(segment, labels)}
          />
        ),
      )}
      <p className="edge-hover__hint">Click for full details</p>
    </aside>
  );
}

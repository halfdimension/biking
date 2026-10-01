import { useEffect, useMemo } from "react";
import { useStore } from "../store";
import { buildDebugSegmentLookup } from "../map/debugSegments";
import type {
  DebugSegment,
  OsrmDebugSegment,
  ValhallaDebugSegment,
  ValhallaPathCost,
} from "../types";

function value(input: unknown, unit = ""): string {
  if (input === null || input === undefined || input === "") return "—";
  if (Array.isArray(input)) return input.length ? input.join(", ") : "—";
  if (typeof input === "boolean") return input ? "Yes" : "No";
  return `${input}${unit}`;
}

function Fields({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="edge-details__fields">
      {rows.map(([label, rendered]) => (
        <div className="edge-details__field" key={label}>
          <dt>{label}</dt>
          <dd>{rendered}</dd>
        </div>
      ))}
    </dl>
  );
}

function Flag({
  label,
  enabled,
}: {
  label: string;
  enabled: boolean | null | undefined;
}) {
  return (
    <span
      className={
        "edge-details__flag" +
        (enabled ? " edge-details__flag--on" : "")
      }
    >
      {label}
      <b>{enabled ? "Yes" : "No"}</b>
    </span>
  );
}

function PathCost({
  label,
  pathCost,
}: {
  label: string;
  pathCost: ValhallaPathCost | null | undefined;
}) {
  return (
    <div className="edge-details__cost">
      <h5>{label}</h5>
      <Fields
        rows={[
          ["Elapsed seconds", value(pathCost?.elapsedCost.seconds)],
          ["Elapsed cost", value(pathCost?.elapsedCost.cost)],
          ["Transition seconds", value(pathCost?.transitionCost.seconds)],
          ["Transition cost", value(pathCost?.transitionCost.cost)],
        ]}
      />
    </div>
  );
}

function formattedPoint(point: [number, number] | null): string {
  if (!point) return "—";
  return `${point[1].toFixed(6)}, ${point[0].toFixed(6)}`;
}

function segmentSpan(segment: DebugSegment): string {
  const first = segment.coordinates[0];
  const last = segment.coordinates[segment.coordinates.length - 1];
  if (!first || !last) return "—";
  return `${first[1].toFixed(6)}, ${first[0].toFixed(6)} → ${last[1].toFixed(6)}, ${last[0].toFixed(6)}`;
}

function SegmentSummary({
  segment,
  label,
  point,
}: {
  segment: DebugSegment;
  label: string;
  point: [number, number] | null;
}) {
  return (
    <section className="edge-details__group" aria-label="Summary">
      <h4>Summary</h4>
      <Fields
        rows={[
          ["Engine", segment.engine.toUpperCase()],
          ["Route", label],
          ["Segment index", value(segment.segmentIndex)],
          ["Hovered point (lat, lon)", formattedPoint(point)],
          ["Segment coordinates", segmentSpan(segment)],
        ]}
      />
    </section>
  );
}

function OsrmDetails({
  segment,
  label,
  point,
}: {
  segment: OsrmDebugSegment;
  label: string;
  point: [number, number] | null;
}) {
  const p = segment.properties;
  return (
    <article className="edge-details__engine" data-testid="edge-details-osrm">
      <header>
        <span className="edge-details__engine-tag">OSRM</span>
        <strong>{label}</strong>
        <span>Segment {segment.segmentIndex}</span>
      </header>
      <div className="edge-details__columns">
        <SegmentSummary segment={segment} label={label} point={point} />
        <section className="edge-details__group" aria-label="Core fields">
          <h4>Core fields</h4>
          <Fields
            rows={[
              ["Distance", value(p.distance, " m")],
              ["Duration", value(p.duration, " s")],
              ["Weight", value(p.weight)],
              [
                "Speed",
                typeof p.speed === "number"
                  ? `${p.speed} m/s · ${(p.speed * 3.6).toFixed(1)} km/h`
                  : "—",
              ],
              ["Datasource", value(p.datasourceName ?? p.datasource)],
              ["From node ID", value(p.fromNodeId)],
              ["To node ID", value(p.toNodeId)],
            ]}
          />
        </section>
      </div>
      <details className="edge-details__advanced">
        <summary>Advanced</summary>
        <Fields
          rows={[
            ["Route index", value(segment.routeIndex)],
            ["Leg index", value(segment.legIndex)],
            ["Datasource index", value(p.datasource)],
            ["Datasources", value(p.datasources)],
            ["Shape points", value(segment.coordinates.length)],
          ]}
        />
      </details>
    </article>
  );
}

function ValhallaDetails({
  segment,
  label,
  point,
}: {
  segment: ValhallaDebugSegment;
  label: string;
  point: [number, number] | null;
}) {
  const p = segment.properties;
  return (
    <article
      className="edge-details__engine"
      data-testid="edge-details-valhalla"
    >
      <header>
        <span className="edge-details__engine-tag">VALHALLA</span>
        <strong>{label}</strong>
        <span>Segment {segment.segmentIndex}</span>
      </header>
      <div className="edge-details__columns">
        <SegmentSummary segment={segment} label={label} point={point} />
        <section className="edge-details__group" aria-label="Core fields">
          <h4>Core fields</h4>
          <Fields
            rows={[
              ["Edge ID", value(p.id)],
              ["Way ID", value(p.wayId)],
              ["Name", value(p.name)],
              ["Length", value(p.lengthKm, " km")],
              ["Speed", value(p.speed, " km/h")],
              ["Default speed", value(p.defaultSpeed, " km/h")],
              ["Density", value(p.density)],
              ["Road class", value(p.roadClass)],
              ["Use", value(p.use)],
              ["Surface", value(p.surface)],
              ["Traversability", value(p.traversability)],
            ]}
          />
        </section>
        <section className="edge-details__group" aria-label="Flags">
          <h4>Flags</h4>
          <div className="edge-details__flags">
            <Flag label="Toll" enabled={p.toll} />
            <Flag label="Unpaved" enabled={p.unpaved} />
            <Flag label="Tunnel" enabled={p.tunnel} />
            <Flag label="Bridge" enabled={p.bridge} />
            <Flag label="Roundabout" enabled={p.roundabout} />
          </div>
        </section>
      </div>
      <details className="edge-details__advanced">
        <summary>Advanced</summary>
        <div className="edge-details__advanced-grid">
          <Fields
            rows={[
              ["Route index", value(segment.routeIndex)],
              ["Leg index", value(segment.legIndex)],
              ["Begin shape index", value(p.beginShapeIndex)],
              ["End shape index", value(p.endShapeIndex)],
              ["Source along edge", value(p.sourceAlongEdge)],
              ["Target along edge", value(p.targetAlongEdge)],
              ["Speed limit", value(p.speedLimit, " km/h")],
              ["spdLmt", value(p.spdLmt)],
              ["spdLmtHgv", value(p.spdLmtHgv)],
              ["spdLmtBike", value(p.spdLmtBike)],
              ["Bike speed", value(p.bikeSpeed)],
              ["FRC", value(p.frc)],
              ["Toll road", value(p.tollRoad)],
              ["Shape points", value(segment.coordinates.length)],
            ]}
          />
          <div>
            <PathCost label="Node path cost" pathCost={p.nodeCost} />
            <PathCost label="Source node path cost" pathCost={p.sourceNodeCost} />
            <PathCost label="Target node path cost" pathCost={p.targetNodeCost} />
          </div>
        </div>
      </details>
    </article>
  );
}

export default function EdgeDetailsPanel() {
  const debug = useStore((state) => state.debugResults);
  const routes = useStore((state) => state.routes);
  const visibility = useStore((state) => state.visibility);
  const pinnedIds = useStore((state) => state.pinnedDebugSegmentIds);
  const pinned = useStore((state) => state.debugInspectorPinned);
  const point = useStore((state) => state.pinnedDebugPoint);
  const clear = useStore((state) => state.unpinDebugInspector);

  const lookup = useMemo(() => buildDebugSegmentLookup(debug), [debug]);
  const labels = useMemo(
    () => new Map(routes.map((route) => [route.id, route.label])),
    [routes],
  );
  const segments = pinnedIds
    .map((id) => lookup.get(id))
    .filter(
      (segment): segment is DebugSegment =>
        segment !== undefined && (visibility[segment.routeId] ?? true),
    );

  useEffect(() => {
    if (!pinned) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clear, pinned]);

  if (!pinned || segments.length === 0) {
    return (
      <div className="edge-details edge-details--empty">
        <strong>No pinned edge</strong>
        <span>Hover a visible route segment, then click it to inspect full details.</span>
      </div>
    );
  }

  return (
    <div className="edge-details">
      <div className="edge-details__toolbar">
        <div>
          <strong>PINNED EDGE DETAILS</strong>
          <span>{segments.length} segment{segments.length === 1 ? "" : "s"}</span>
        </div>
        <button type="button" onClick={clear}>
          Unpin / Clear Details
        </button>
      </div>

      {debug
        ? (["osrm", "valhalla"] as const).map((engine) => {
            const result = debug[engine];
            if (result.status === "ok" && result.errors.length === 0) return null;
            return (
              <div className="edge-details__error" role="status" key={engine}>
                <strong>{engine.toUpperCase()} debug data {result.status}</strong>
                {result.errors.map((error, index) => (
                  <span key={`${error.kind}:${index}`}>{error.message}</span>
                ))}
              </div>
            );
          })
        : null}

      <div className="edge-details__engines">
        {segments.map((segment) => {
          const label =
            labels.get(segment.routeId) ??
            `${segment.engine.toUpperCase()} ${segment.routeIndex === 0 ? "Primary" : `Alt ${segment.routeIndex}`}`;
          return segment.engine === "osrm" ? (
            <OsrmDetails
              key={segment.id}
              segment={segment}
              label={label}
              point={point}
            />
          ) : (
            <ValhallaDetails
              key={segment.id}
              segment={segment}
              label={label}
              point={point}
            />
          );
        })}
      </div>
    </div>
  );
}

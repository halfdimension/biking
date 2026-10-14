import { useMemo } from "react";
import { formatDistanceKm } from "../format";
import { useStore } from "../store";
import type { RouteDifferenceAnchor } from "../analysis/routeDifference";
import "./RouteDifference.css";

function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
}

function formatSignedDistance(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized > 0 ? "+" : normalized < 0 ? "-" : ""}${(
    Math.abs(normalized) / 1000
  ).toFixed(2)} km`;
}

function formatSignedDuration(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const seconds = absolute % 60;
  const parts = [
    hours ? `${hours}h` : "",
    minutes ? `${minutes}m` : "",
    seconds || (!hours && !minutes) ? `${seconds}s` : "",
  ].filter(Boolean);
  return `${sign}${parts.join(" ")}`;
}

function formatAnchor(anchor: RouteDifferenceAnchor | null): string {
  return anchor
    ? `${anchor.coordinate[0].toFixed(6)}, ${anchor.coordinate[1].toFixed(6)}`
    : "";
}

export default function RouteDifference() {
  const routes = useStore((state) => state.routes);
  const revision = useStore((state) => state.comparisonResultRevision);
  const osrmRouteId = useStore((state) => state.routeDifferenceOsrmRouteId);
  const valhallaRouteId = useStore(
    (state) => state.routeDifferenceValhallaRouteId,
  );
  const status = useStore((state) => state.routeDifferenceStatus);
  const storedResult = useStore((state) => state.routeDifferenceResult);
  const resultRevision = useStore(
    (state) => state.routeDifferenceResultRevision,
  );
  const error = useStore((state) => state.routeDifferenceError);
  const overlayEnabled = useStore(
    (state) => state.routeDifferenceOverlayEnabled,
  );
  const focusedIndex = useStore(
    (state) => state.routeDifferenceFocusedIndex,
  );
  const setOsrmRouteId = useStore(
    (state) => state.setRouteDifferenceOsrmRouteId,
  );
  const setValhallaRouteId = useStore(
    (state) => state.setRouteDifferenceValhallaRouteId,
  );
  const analyze = useStore((state) => state.runRouteDifferenceAnalysis);
  const setOverlayEnabled = useStore(
    (state) => state.setRouteDifferenceOverlayEnabled,
  );
  const setFocusedIndex = useStore(
    (state) => state.setRouteDifferenceFocusedIndex,
  );
  const fitDifference = useStore((state) => state.fitRouteDifference);

  const osrmRoutes = useMemo(
    () => routes.filter((route) => route.engine === "osrm"),
    [routes],
  );
  const valhallaRoutes = useMemo(
    () => routes.filter((route) => route.engine === "valhalla"),
    [routes],
  );
  const osrmRoute = osrmRoutes.find((route) => route.id === osrmRouteId);
  const valhallaRoute = valhallaRoutes.find(
    (route) => route.id === valhallaRouteId,
  );
  const available = Boolean(osrmRoute && valhallaRoute);
  const result = resultRevision === revision ? storedResult : null;
  const distanceDelta =
    osrmRoute?.distanceMeters != null && valhallaRoute?.distanceMeters != null
      ? valhallaRoute.distanceMeters - osrmRoute.distanceMeters
      : null;
  const durationDelta =
    osrmRoute?.durationSeconds != null && valhallaRoute?.durationSeconds != null
      ? valhallaRoute.durationSeconds - osrmRoute.durationSeconds
      : null;

  return (
    <section className="route-difference" aria-label="Route Difference analyzer">
      <div className="route-difference__controls">
        <label>
          <span>OSRM route</span>
          <select
            aria-label="OSRM route"
            value={osrmRouteId ?? ""}
            disabled={osrmRoutes.length === 0}
            onChange={(event) => setOsrmRouteId(event.target.value)}
          >
            {osrmRoutes.length === 0 ? <option value="">Unavailable</option> : null}
            {osrmRoutes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Valhalla route</span>
          <select
            aria-label="Valhalla route"
            value={valhallaRouteId ?? ""}
            disabled={valhallaRoutes.length === 0}
            onChange={(event) => setValhallaRouteId(event.target.value)}
          >
            {valhallaRoutes.length === 0 ? (
              <option value="">Unavailable</option>
            ) : null}
            {valhallaRoutes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="route-difference__analyze"
          disabled={!available}
          onClick={analyze}
        >
          Analyze Difference
        </button>
        <label className="route-difference__overlay-toggle">
          <input
            type="checkbox"
            checked={overlayEnabled}
            disabled={!result}
            onChange={(event) => setOverlayEnabled(event.target.checked)}
          />
          Difference overlay
        </label>
      </div>

      {!available ? (
        <p className="route-difference__unavailable" role="status">
          Route Difference requires at least one OSRM route and one Valhalla route.
        </p>
      ) : null}
      {status === "error" && error ? (
        <p className="route-difference__error" role="alert">{error}</p>
      ) : null}

      {result ? (
        <>
          <div className="route-difference__summary" aria-label="Difference summary">
            <article className="route-difference__metric route-difference__metric--lead">
              <span>Corridor similarity</span>
              <strong>{formatPercent(result.geometricSimilarityPercent)}</strong>
            </article>
            <article className="route-difference__metric">
              <span>OSRM shared</span>
              <strong>
                {formatDistanceKm(result.osrmSharedMeters)} · {formatPercent(result.osrmSharedPercent)}
              </strong>
              <small>{formatDistanceKm(result.osrmNonSharedMeters)} non-shared</small>
            </article>
            <article className="route-difference__metric">
              <span>Valhalla shared</span>
              <strong>
                {formatDistanceKm(result.valhallaSharedMeters)} · {formatPercent(result.valhallaSharedPercent)}
              </strong>
              <small>{formatDistanceKm(result.valhallaNonSharedMeters)} non-shared</small>
            </article>
            <article className="route-difference__metric">
              <span>Divergences</span>
              <strong>{result.divergences.length}</strong>
            </article>
            <article className="route-difference__metric">
              <span>Engine distance Δ</span>
              <strong>{formatSignedDistance(distanceDelta)}</strong>
            </article>
            <article className="route-difference__metric">
              <span>Engine duration Δ</span>
              <strong>{formatSignedDuration(durationDelta)}</strong>
            </article>
          </div>

          <p className="route-difference__method-note">
            Geometry-based comparison. Shared corridor means routes are spatially
            close, directionally aligned, and progress consistently; it does not
            imply identical routing graph edges.
          </p>
          <details className="route-difference__method">
            <summary>How comparison works</summary>
            <div>
              <dl>
                <dt>Sample spacing</dt>
                <dd>{result.method.sampleSpacingMeters} m</dd>
                <dt>Corridor tolerance</dt>
                <dd>{result.method.corridorToleranceMeters} m</dd>
                <dt>Heading tolerance</dt>
                <dd>{result.method.headingToleranceDegrees}°</dd>
              </dl>
              <p>
                This is geometry-based corridor comparison. A shared corridor does
                not prove that OSRM and Valhalla traversed the same internal graph
                edge.
                {" "}
                The neutral shared overlay uses the OSRM shared-section geometry
                as a representative of the detected corridor.
              </p>
            </div>
          </details>

          <div className="route-difference__divergences">
            {result.divergences.length === 0 ? (
              <p className="route-difference__empty">No meaningful divergences detected.</p>
            ) : null}
            {result.divergences.map((divergence) => (
              <article
                key={divergence.index}
                className={
                  "route-difference__card" +
                  (focusedIndex === divergence.index
                    ? " route-difference__card--focused"
                    : "")
                }
              >
                <h3>Divergence {divergence.index + 1}</h3>
                <dl>
                  <dt>Split</dt>
                  <dd>
                    {divergence.split
                      ? formatAnchor(divergence.split)
                      : "From route start"}
                  </dd>
                  <dt>Rejoin</dt>
                  <dd>
                    {divergence.rejoin
                      ? formatAnchor(divergence.rejoin)
                      : "Continues to destination"}
                  </dd>
                  <dt>OSRM section</dt>
                  <dd>{formatDistanceKm(divergence.osrmDistanceMeters)}</dd>
                  <dt>Valhalla section</dt>
                  <dd>{formatDistanceKm(divergence.valhallaDistanceMeters)}</dd>
                  <dt>Difference</dt>
                  <dd>{formatSignedDistance(divergence.lengthDeltaMeters)}</dd>
                </dl>
                <div className="route-difference__card-actions">
                  <button
                    type="button"
                    aria-pressed={focusedIndex === divergence.index}
                    onClick={() => setFocusedIndex(divergence.index)}
                  >
                    Highlight
                  </button>
                  <button
                    type="button"
                    onClick={() => fitDifference(divergence.index)}
                  >
                    Fit on map
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : available && status === "idle" ? (
        <p className="route-difference__empty">
          Choose a route pair, then analyze their geometric corridor.
        </p>
      ) : null}
    </section>
  );
}

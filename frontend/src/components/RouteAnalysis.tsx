import { useEffect, useMemo } from "react";
import {
  ROUTE_METRICS,
  deriveRouteProfile,
  formatAnalysisNumber,
  formatRouteDistance,
  routeMetric,
  summarizeMetric,
  type RouteMetricId,
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
import RouteProfileChart from "./RouteProfileChart";
import "./RouteAnalysis.css";

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

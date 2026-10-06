import { useEffect, useMemo } from "react";
import {
  ROUTE_METRICS,
  deriveRouteProfile,
  formatAnalysisNumber,
  formatRouteDistance,
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
  ROUTE_QUERY_FIELDS,
  deriveRouteQueryValueOptions,
  evaluateRouteQuery,
  type RouteAttributeQuery,
  type RouteQueryFieldDefinition,
  type RouteQueryFieldId,
  type RouteQueryOperator,
} from "../analysis/routeQuery";
import { useStore } from "../store";
import type { NormalizedRoute, ValhallaTraceResult } from "../types";
import RouteProfileChart from "./RouteProfileChart";
import "./RouteAnalysis.css";

export function traceMetricsForProfile(
  profile: RouteProfile,
): MetricDefinition[] {
  return ROUTE_METRICS.filter((metric) =>
    profile.segments.some((item) => metric.value(item.segment) !== null),
  );
}

export function traceQueryFieldsForProfile(
  profile: RouteProfile,
): RouteQueryFieldDefinition[] {
  return ROUTE_QUERY_FIELDS.filter(
    (field) =>
      field.engines.includes("valhalla") &&
      profile.segments.some((item) => {
        const value = field.extractor(item.segment);
        return value !== null && value !== "";
      }),
  );
}

function queryForField(
  field: RouteQueryFieldDefinition,
): RouteAttributeQuery {
  return {
    field: field.id,
    operator: field.operators[0],
    value: "",
  };
}

export default function TraceRouteAnalysis({
  sourceRoute,
  result,
}: {
  sourceRoute: NormalizedRoute | undefined;
  result: ValhallaTraceResult | null;
}) {
  const status = useStore((state) => state.traceStatus);
  const revision = useStore((state) => state.traceResultRevision);
  const metricId = useStore((state) => state.traceAnalysisMetricId);
  const query = useStore((state) => state.traceAnalysisQuery);
  const executedSearch = useStore(
    (state) => state.traceAnalysisExecutedSearch,
  );
  const hoveredIds = useStore((state) => state.traceHoveredSegmentIds);
  const setMetricId = useStore((state) => state.setTraceAnalysisMetricId);
  const setQuery = useStore((state) => state.setTraceAnalysisQuery);
  const setExecutedSearch = useStore(
    (state) => state.setTraceAnalysisExecutedSearch,
  );
  const clearSearch = useStore((state) => state.clearTraceAnalysisSearch);
  const setFocusedSegmentId = useStore(
    (state) => state.setTraceAnalysisFocusedSegmentId,
  );
  const pinSegments = useStore((state) => state.pinTraceSegments);

  const routeId = sourceRoute ? `trace:${sourceRoute.id}` : null;
  const profile = useMemo(
    () =>
      routeId && result
        ? deriveRouteProfile(result.segments, routeId)
        : null,
    [result, routeId],
  );
  const metrics = useMemo(
    () => (profile ? traceMetricsForProfile(profile) : []),
    [profile],
  );
  const effectiveMetricId = metrics.some((item) => item.id === metricId)
    ? metricId
    : metrics[0]?.id ?? metricId;
  const metric = routeMetric(effectiveMetricId);
  const summary = useMemo(
    () => (profile ? summarizeMetric(profile, metric) : null),
    [metric, profile],
  );
  const queryFields = useMemo(
    () => (profile ? traceQueryFieldsForProfile(profile) : []),
    [profile],
  );
  const field =
    queryFields.find((item) => item.id === query.field) ??
    queryFields[0] ??
    null;
  const profileLookup = useMemo(
    () =>
      profile
        ? buildRouteProfileSegmentLookup(profile)
        : new Map<string, RouteProfileSegment>(),
    [profile],
  );
  const mapHoveredSegment = routeId
    ? findHoveredProfileSegment(hoveredIds, routeId, profileLookup)
    : null;
  const activeSearch =
    executedSearch &&
    executedSearch.traceResultRevision === revision &&
    executedSearch.routeId === routeId
      ? executedSearch
      : null;
  const valueOptions = useMemo(
    () =>
      profile && field
        ? deriveRouteQueryValueOptions(profile, field)
        : [],
    [field, profile],
  );
  const hasQueryValue = query.value.trim() !== "";

  useEffect(() => {
    if (effectiveMetricId !== metricId && metrics.length) {
      setMetricId(effectiveMetricId);
    }
  }, [effectiveMetricId, metricId, metrics.length, setMetricId]);

  useEffect(() => {
    if (!field) return;
    if (
      field.id !== query.field ||
      !field.operators.includes(query.operator)
    ) {
      setQuery(queryForField(field));
    }
  }, [field, query.field, query.operator, setQuery]);

  useEffect(
    () => () => setFocusedSegmentId(null),
    [setFocusedSegmentId],
  );

  if (!result) {
    return (
      <div className="route-analysis__empty">
        <strong>
          {status === "error"
            ? "Trace Route Analysis is unavailable."
            : "Run Valhalla Trace to analyze map-matched edges."}
        </strong>
        {status === "error" ? (
          <span>The trace did not return usable map-matched edges.</span>
        ) : null}
      </div>
    );
  }

  if (!sourceRoute || !routeId || !profile || profile.segments.length === 0) {
    return (
      <div className="route-analysis__empty">
        <strong>No usable map-matched trace edges are available.</strong>
        <span>
          {result.status === "partial"
            ? "The partial trace did not include valid edge geometry."
            : "Run Valhalla Trace again after checking the trace errors."}
        </span>
      </div>
    );
  }

  if (!summary || !field || metrics.length === 0) {
    return (
      <div className="route-analysis__unavailable">
        The trace has no supported profile or searchable attributes.
      </div>
    );
  }

  const updateField = (fieldId: RouteQueryFieldId) => {
    const nextField =
      queryFields.find((item) => item.id === fieldId) ?? queryFields[0];
    if (nextField) setQuery(queryForField(nextField));
  };

  const runSearch = () => {
    if (!hasQueryValue) return;
    setExecutedSearch({
      traceResultRevision: revision,
      routeId,
      query: { ...query },
      result: evaluateRouteQuery(profile, query),
    });
  };

  const routeLabel = `Valhalla Trace — ${sourceRoute.label}`;

  return (
    <section
      className="route-analysis trace-route-analysis"
      aria-label="Trace Route Analysis"
    >
      <div className="route-analysis__toolbar">
        <label>
          <span>Route</span>
          <select aria-label="Trace route" value={routeId} disabled>
            <option value={routeId}>{routeLabel}</option>
          </select>
        </label>
        <label>
          <span>Metric</span>
          <select
            aria-label="Trace metric"
            value={effectiveMetricId}
            onChange={(event) =>
              setMetricId(event.target.value as RouteMetricId)
            }
          >
            {metrics.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <div className="route-analysis__summary" aria-label="Trace profile summary">
          <span><b>{routeLabel}</b> · VALHALLA</span>
          <span>
            {profile.segments.length} segments ·{" "}
            {formatRouteDistance(profile.totalDistanceMeters)}
          </span>
          <span>
            {metric.label} · {summary.availableCount} / {summary.totalCount} segments
          </span>
          {summary.minimum !== null && summary.maximum !== null ? (
            <span>
              Min {formatAnalysisNumber(summary.minimum)} · Max{" "}
              {formatAnalysisNumber(summary.maximum)} {metric.unit}
              {metric.id === "speed" && summary.weightedAverage !== null
                ? ` · Weighted avg ${formatAnalysisNumber(summary.weightedAverage)} ${metric.unit}`
                : ""}
            </span>
          ) : null}
        </div>
      </div>

      <form
        className="route-analysis__search"
        aria-label="Trace search and highlight"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
        <strong>SEARCH / HIGHLIGHT</strong>
        <label>
          <span>Field</span>
          <select
            aria-label="Trace search field"
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
            aria-label="Trace search operator"
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
              aria-label="Trace search value"
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
              aria-label="Trace search value"
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
              aria-label="Trace search value"
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
            aria-label="Trace match statistics"
          >
            <b>{activeSearch.result.matchingSegmentCount}</b>
            {" matching segments · "}
            <b>{formatRouteDistance(activeSearch.result.matchedDistanceMeters)}</b>
            {" matched · "}
            <b>{formatAnalysisNumber(activeSearch.result.matchedPercentage)}%</b>
            {" of trace"}
            {activeSearch.result.hasIncompleteDistanceCoverage
              ? ` · distance incomplete for ${activeSearch.result.missingLengthSegmentCount} matching segment${activeSearch.result.missingLengthSegmentCount === 1 ? "" : "s"}`
              : ""}
          </div>
        ) : null}
      </form>

      <RouteProfileChart
        profile={profile}
        route={{ label: routeLabel }}
        metric={metric}
        mapHoveredSegment={mapHoveredSegment}
        onFocusSegment={setFocusedSegmentId}
        onPinSegment={(id) => pinSegments([id], null)}
      />

      {profile.warnings.length ? (
        <details className="route-analysis__warnings">
          <summary>
            {profile.warnings.length} length warning
            {profile.warnings.length === 1 ? "" : "s"}
          </summary>
          <ul>
            {profile.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

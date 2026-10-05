import type { DebugSegment, Engine } from "../types";

export type RouteMetricId = "speed" | "density" | "defaultSpeed";
export type LengthSource = "engine" | "coordinates" | "missing";

export interface RouteProfileSegment {
  debugSegmentId: string;
  engine: Engine;
  routeId: string;
  routeIndex: number;
  legIndex: number;
  segmentIndex: number;
  startDistanceMeters: number;
  endDistanceMeters: number;
  lengthMeters: number | null;
  lengthSource: LengthSource;
  /** Reference to the immutable compare payload; the debug object is not copied. */
  segment: DebugSegment;
}

export interface RouteProfile {
  routeId: string;
  segments: RouteProfileSegment[];
  totalDistanceMeters: number;
  warnings: string[];
}

export interface MetricDefinition {
  id: RouteMetricId;
  label: string;
  unit: string;
  engines: readonly Engine[];
  step: true;
  value: (segment: DebugSegment) => number | null;
}

export interface MetricSummary {
  availableCount: number;
  totalCount: number;
  minimum: number | null;
  maximum: number | null;
  weightedAverage: number | null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

/** Sum great-circle distances between consecutive [lon, lat] shape points. */
export function coordinateLengthMeters(
  coordinates: [number, number][],
): number | null {
  if (coordinates.length < 2) return null;
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1];
    const current = coordinates[index];
    if (
      !previous ||
      !current ||
      !previous.every(finiteNumber) ||
      !current.every(finiteNumber)
    ) {
      return null;
    }
    const latitudeDelta = toRadians(current[1] - previous[1]);
    const longitudeDelta = toRadians(current[0] - previous[0]);
    const latitude1 = toRadians(previous[1]);
    const latitude2 = toRadians(current[1]);
    const a =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(latitude1) *
        Math.cos(latitude2) *
        Math.sin(longitudeDelta / 2) ** 2;
    total += 6_371_008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return total;
}

function engineLengthMeters(segment: DebugSegment): number | null {
  const raw =
    segment.engine === "osrm"
      ? segment.properties.distance
      : segment.properties.lengthKm * 1000;
  return finiteNumber(raw) && raw >= 0 ? raw : null;
}

function isInRouteOrder(segments: DebugSegment[]): boolean {
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    if (
      current.legIndex < previous.legIndex ||
      (current.legIndex === previous.legIndex &&
        current.segmentIndex < previous.segmentIndex)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Build source-to-destination intervals. Normal backend payloads take one O(n)
 * pass; an out-of-order defensive/test payload is stably sorted first.
 */
export function deriveRouteProfile(
  segments: DebugSegment[],
  routeId: string,
): RouteProfile {
  const matching = segments.filter((segment) => segment.routeId === routeId);
  const ordered = isInRouteOrder(matching)
    ? matching
    : matching
        .map((segment, originalIndex) => ({ segment, originalIndex }))
        .sort(
          (left, right) =>
            left.segment.legIndex - right.segment.legIndex ||
            left.segment.segmentIndex - right.segment.segmentIndex ||
            left.originalIndex - right.originalIndex,
        )
        .map(({ segment }) => segment);

  const warnings: string[] = [];
  const profile: RouteProfileSegment[] = [];
  let cumulativeDistance = 0;

  for (const segment of ordered) {
    let lengthMeters = engineLengthMeters(segment);
    let lengthSource: LengthSource = "engine";
    if (lengthMeters === null) {
      lengthMeters = coordinateLengthMeters(segment.coordinates);
      lengthSource = lengthMeters === null ? "missing" : "coordinates";
      if (lengthMeters === null) {
        warnings.push(
          `Segment ${segment.id} has no valid engine or coordinate length.`,
        );
      } else {
        warnings.push(
          `Segment ${segment.id} uses coordinate-derived length.`,
        );
      }
    }
    const startDistanceMeters = cumulativeDistance;
    if (lengthMeters !== null) cumulativeDistance += lengthMeters;
    profile.push({
      debugSegmentId: segment.id,
      engine: segment.engine,
      routeId: segment.routeId,
      routeIndex: segment.routeIndex,
      legIndex: segment.legIndex,
      segmentIndex: segment.segmentIndex,
      startDistanceMeters,
      endDistanceMeters: cumulativeDistance,
      lengthMeters,
      lengthSource,
      segment,
    });
  }

  return {
    routeId,
    segments: profile,
    totalDistanceMeters: cumulativeDistance,
    warnings,
  };
}

function metricNumber(value: unknown): number | null {
  return finiteNumber(value) ? value : null;
}

export const ROUTE_METRICS: readonly MetricDefinition[] = [
  {
    id: "speed",
    label: "Speed",
    unit: "km/h",
    engines: ["osrm", "valhalla"],
    step: true,
    value: (segment) => {
      const speed = metricNumber(segment.properties.speed);
      if (speed === null) return null;
      return segment.engine === "osrm" ? speed * 3.6 : speed;
    },
  },
  {
    id: "density",
    label: "Density",
    unit: "density",
    engines: ["valhalla"],
    step: true,
    value: (segment) =>
      segment.engine === "valhalla"
        ? metricNumber(segment.properties.density)
        : null,
  },
  {
    id: "defaultSpeed",
    label: "Default Speed",
    unit: "km/h",
    engines: ["valhalla"],
    step: true,
    value: (segment) =>
      segment.engine === "valhalla"
        ? metricNumber(segment.properties.defaultSpeed)
        : null,
  },
] as const;

export function routeMetric(id: RouteMetricId): MetricDefinition {
  return ROUTE_METRICS.find((metric) => metric.id === id) ?? ROUTE_METRICS[0];
}

export function summarizeMetric(
  profile: RouteProfile,
  metric: MetricDefinition,
): MetricSummary {
  let availableCount = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let weightedValue = 0;
  let weightedLength = 0;

  for (const item of profile.segments) {
    const value = metric.value(item.segment);
    if (value === null) continue;
    availableCount += 1;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    if (item.lengthMeters !== null && item.lengthMeters > 0) {
      weightedValue += value * item.lengthMeters;
      weightedLength += item.lengthMeters;
    }
  }

  return {
    availableCount,
    totalCount: profile.segments.length,
    minimum: availableCount ? minimum : null,
    maximum: availableCount ? maximum : null,
    weightedAverage: weightedLength > 0 ? weightedValue / weightedLength : null,
  };
}

export function metricDomain(values: number[]): [number, number] | null {
  const finiteValues = values.filter(finiteNumber);
  if (!finiteValues.length) return null;
  const minimum = Math.min(...finiteValues);
  const maximum = Math.max(...finiteValues);
  if (minimum === maximum) {
    const padding = Math.max(Math.abs(minimum) * 0.1, 1);
    return [minimum - padding, maximum + padding];
  }
  const padding = (maximum - minimum) * 0.1;
  return [minimum - padding, maximum + padding];
}

export function findProfileSegment(
  profile: RouteProfile,
  distanceMeters: number,
): RouteProfileSegment | null {
  if (!profile.segments.length || !finiteNumber(distanceMeters)) return null;
  const distance = Math.max(0, Math.min(profile.totalDistanceMeters, distanceMeters));
  let low = 0;
  let high = profile.segments.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const segment = profile.segments[middle];
    if (distance < segment.startDistanceMeters) high = middle - 1;
    else if (distance > segment.endDistanceMeters) low = middle + 1;
    else if (
      distance === segment.endDistanceMeters &&
      middle < profile.segments.length - 1
    ) {
      low = middle + 1;
    } else return segment;
  }
  return profile.segments[Math.min(low, profile.segments.length - 1)] ?? null;
}

/** Display-only normalization; raw debug values remain untouched. */
export function formatAnalysisNumber(value: unknown, decimals = 1): string {
  if (!finiteNumber(value)) return "—";
  const nearestInteger = Math.round(value);
  if (Math.abs(value - nearestInteger) < 0.0001) return String(nearestInteger);
  return value.toFixed(decimals).replace(/\.0+$/, "");
}

export function formatRouteDistance(meters: number): string {
  if (Math.abs(meters) < 0.0001) return "0 m";
  if (Math.abs(meters) < 1000) return `${formatAnalysisNumber(meters, 0)} m`;
  return `${formatAnalysisNumber(meters / 1000, meters >= 10_000 ? 1 : 2)} km`;
}

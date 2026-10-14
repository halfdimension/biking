import type { NormalizedRoute } from "../types";

export type RouteCoordinate = [number, number];

export interface RouteDifferenceMethod {
  sampleSpacingMeters: number;
  corridorToleranceMeters: number;
  headingToleranceDegrees: number;
  unmatchedGapHealingMeters: number;
  minimumMeaningfulDivergenceMeters: number;
  monotonicBacktrackMeters: number;
  spatialIndex: "uniform-grid";
  similarityFormula: "mean-of-directional-shared-percentages";
}

export const DEFAULT_ROUTE_DIFFERENCE_METHOD: RouteDifferenceMethod = {
  sampleSpacingMeters: 10,
  corridorToleranceMeters: 15,
  headingToleranceDegrees: 35,
  unmatchedGapHealingMeters: 30,
  minimumMeaningfulDivergenceMeters: 40,
  monotonicBacktrackMeters: 20,
  spatialIndex: "uniform-grid",
  similarityFormula: "mean-of-directional-shared-percentages",
};

export interface RouteDifferenceAnchor {
  coordinate: RouteCoordinate;
  osrmProgressMeters: number;
  valhallaProgressMeters: number;
}

export interface RouteDifferenceSection {
  startProgressMeters: number;
  endProgressMeters: number;
  distanceMeters: number;
  geometry: RouteCoordinate[];
}

export interface RouteDifferenceDivergence {
  index: number;
  split: RouteDifferenceAnchor | null;
  rejoin: RouteDifferenceAnchor | null;
  osrmGeometry: RouteCoordinate[];
  valhallaGeometry: RouteCoordinate[];
  osrmDistanceMeters: number;
  valhallaDistanceMeters: number;
  lengthDeltaMeters: number;
  osrmStartProgressMeters: number;
  osrmEndProgressMeters: number;
  valhallaStartProgressMeters: number;
  valhallaEndProgressMeters: number;
}

export interface RouteDifferenceResult {
  osrmRouteId: string;
  valhallaRouteId: string;
  method: RouteDifferenceMethod;
  osrmGeometryLengthMeters: number;
  valhallaGeometryLengthMeters: number;
  osrmSharedMeters: number;
  osrmNonSharedMeters: number;
  osrmSharedPercent: number;
  valhallaSharedMeters: number;
  valhallaNonSharedMeters: number;
  valhallaSharedPercent: number;
  geometricSimilarityPercent: number;
  osrmSharedSections: RouteDifferenceSection[];
  valhallaSharedSections: RouteDifferenceSection[];
  divergences: RouteDifferenceDivergence[];
  warnings: string[];
}

interface RouteSample {
  coordinate: RouteCoordinate;
  headingDegrees: number;
  cumulativeProgressMeters: number;
  x: number;
  y: number;
}

interface RouteMetrics {
  coordinates: RouteCoordinate[];
  cumulative: number[];
  lengthMeters: number;
}

interface DirectionalMatch {
  targetIndex: number;
  targetProgressMeters: number;
  distanceMeters: number;
}

interface AlignmentAnchor extends RouteDifferenceAnchor {
  osrmCoordinate: RouteCoordinate;
  valhallaCoordinate: RouteCoordinate;
}

const EARTH_RADIUS_METERS = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;

function finiteCoordinate(value: RouteCoordinate): boolean {
  return Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

/** Geographic point-to-point distance. Coordinates are always [lon, lat]. */
export function haversineMeters(a: RouteCoordinate, b: RouteCoordinate): number {
  const lat1 = a[1] * DEG_TO_RAD;
  const lat2 = b[1] * DEG_TO_RAD;
  const dLat = lat2 - lat1;
  const dLon = (b[0] - a[0]) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function routeMetrics(input: RouteCoordinate[]): RouteMetrics {
  const coordinates = input.filter(finiteCoordinate).map((coordinate) => [
    coordinate[0],
    coordinate[1],
  ] as RouteCoordinate);
  const cumulative = coordinates.map(() => 0);
  let lengthMeters = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    lengthMeters += haversineMeters(coordinates[i - 1], coordinates[i]);
    cumulative[i] = lengthMeters;
  }
  return { coordinates, cumulative, lengthMeters };
}

function interpolateCoordinate(
  a: RouteCoordinate,
  b: RouteCoordinate,
  ratio: number,
): RouteCoordinate {
  return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
}

function coordinateAtProgress(metrics: RouteMetrics, progress: number): RouteCoordinate {
  if (metrics.coordinates.length === 0) return [0, 0];
  if (progress <= 0 || metrics.coordinates.length === 1) {
    return [...metrics.coordinates[0]] as RouteCoordinate;
  }
  if (progress >= metrics.lengthMeters) {
    return [...metrics.coordinates[metrics.coordinates.length - 1]] as RouteCoordinate;
  }
  let low = 1;
  let high = metrics.cumulative.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (metrics.cumulative[middle] < progress) low = middle + 1;
    else high = middle;
  }
  const segmentStart = metrics.cumulative[low - 1];
  const segmentLength = metrics.cumulative[low] - segmentStart;
  const ratio = segmentLength > 0 ? (progress - segmentStart) / segmentLength : 0;
  return interpolateCoordinate(
    metrics.coordinates[low - 1],
    metrics.coordinates[low],
    ratio,
  );
}

function initialBearingDegrees(a: RouteCoordinate, b: RouteCoordinate): number {
  const lat1 = a[1] * DEG_TO_RAD;
  const lat2 = b[1] * DEG_TO_RAD;
  const dLon = (b[0] - a[0]) * DEG_TO_RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG_TO_RAD + 360) % 360;
}

function headingDifferenceDegrees(a: number, b: number): number {
  const difference = Math.abs(a - b) % 360;
  return Math.min(difference, 360 - difference);
}

function projectCoordinate(
  coordinate: RouteCoordinate,
  reference: RouteCoordinate,
): [number, number] {
  const x =
    (coordinate[0] - reference[0]) *
    DEG_TO_RAD *
    EARTH_RADIUS_METERS *
    Math.cos(reference[1] * DEG_TO_RAD);
  const y =
    (coordinate[1] - reference[1]) * DEG_TO_RAD * EARTH_RADIUS_METERS;
  return [x, y];
}

function resample(
  metrics: RouteMetrics,
  spacingMeters: number,
  reference: RouteCoordinate,
): RouteSample[] {
  if (metrics.coordinates.length < 2 || metrics.lengthMeters <= 0) return [];
  const progresses: number[] = [];
  for (let progress = 0; progress < metrics.lengthMeters; progress += spacingMeters) {
    progresses.push(progress);
  }
  if (
    progresses.length === 0 ||
    metrics.lengthMeters - progresses[progresses.length - 1] > 0.01
  ) {
    progresses.push(metrics.lengthMeters);
  }
  const coordinates = progresses.map((progress) =>
    coordinateAtProgress(metrics, progress),
  );
  return coordinates.map((coordinate, index) => {
    const before = coordinates[Math.max(0, index - 1)];
    const after = coordinates[Math.min(coordinates.length - 1, index + 1)];
    const [x, y] = projectCoordinate(coordinate, reference);
    return {
      coordinate,
      headingDegrees: initialBearingDegrees(before, after),
      cumulativeProgressMeters: progresses[index],
      x,
      y,
    };
  });
}

function gridKey(x: number, y: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
}

/**
 * Matches through a uniform metric grid. Candidate progress may move backwards
 * only by the configured sampling-noise allowance; this prevents crossings and
 * self-near loops from repeatedly snapping to a substantially earlier route.
 */
function matchSamples(
  source: RouteSample[],
  target: RouteSample[],
  method: RouteDifferenceMethod,
): Array<DirectionalMatch | null> {
  const cellSize = method.corridorToleranceMeters;
  const grid = new Map<string, number[]>();
  for (let index = 0; index < target.length; index += 1) {
    const sample = target[index];
    const key = gridKey(sample.x, sample.y, cellSize);
    const entries = grid.get(key);
    if (entries) entries.push(index);
    else grid.set(key, [index]);
  }

  const sourceLength = source[source.length - 1]?.cumulativeProgressMeters ?? 0;
  const targetLength = target[target.length - 1]?.cumulativeProgressMeters ?? 0;
  let previousTargetProgress = -Infinity;
  const matches: Array<DirectionalMatch | null> = [];
  for (const sample of source) {
    const cellX = Math.floor(sample.x / cellSize);
    const cellY = Math.floor(sample.y / cellSize);
    const candidates: DirectionalMatch[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const targetIndex of grid.get(`${cellX + dx},${cellY + dy}`) ?? []) {
          const candidate = target[targetIndex];
          const distanceMeters = Math.hypot(
            sample.x - candidate.x,
            sample.y - candidate.y,
          );
          if (distanceMeters > method.corridorToleranceMeters) continue;
          if (
            headingDifferenceDegrees(
              sample.headingDegrees,
              candidate.headingDegrees,
            ) > method.headingToleranceDegrees
          ) {
            continue;
          }
          if (
            candidate.cumulativeProgressMeters <
            previousTargetProgress - method.monotonicBacktrackMeters
          ) {
            continue;
          }
          candidates.push({
            targetIndex,
            targetProgressMeters: candidate.cumulativeProgressMeters,
            distanceMeters,
          });
        }
      }
    }
    if (candidates.length === 0) {
      matches.push(null);
      continue;
    }

    const expectedTargetProgress =
      sourceLength > 0
        ? (sample.cumulativeProgressMeters / sourceLength) * targetLength
        : 0;
    const closestDistance = Math.min(...candidates.map((match) => match.distanceMeters));
    const nearClosest = candidates.filter(
      (match) => match.distanceMeters <= closestDistance + 1,
    );
    nearClosest.sort((a, b) => {
      const progressDifference =
        Math.abs(a.targetProgressMeters - expectedTargetProgress) -
        Math.abs(b.targetProgressMeters - expectedTargetProgress);
      return progressDifference || a.distanceMeters - b.distanceMeters;
    });
    const selected = nearClosest[0];
    previousTargetProgress = Math.max(
      previousTargetProgress,
      selected.targetProgressMeters,
    );
    matches.push(selected);
  }
  return matches;
}

interface BooleanRun {
  start: number;
  end: number;
  value: boolean;
}

function booleanRuns(values: boolean[]): BooleanRun[] {
  if (values.length === 0) return [];
  const runs: BooleanRun[] = [];
  let start = 0;
  for (let index = 1; index <= values.length; index += 1) {
    if (index === values.length || values[index] !== values[start]) {
      runs.push({ start, end: index - 1, value: values[start] });
      start = index;
    }
  }
  return runs;
}

function runLengthMeters(run: BooleanRun, samples: RouteSample[]): number {
  if (samples.length === 0) return 0;
  const before = samples[Math.max(0, run.start - 1)].cumulativeProgressMeters;
  const after = samples[Math.min(samples.length - 1, run.end + 1)].cumulativeProgressMeters;
  return Math.max(0, after - before);
}

function cleanSharedFlags(
  raw: boolean[],
  samples: RouteSample[],
  method: RouteDifferenceMethod,
): boolean[] {
  const healed = [...raw];
  for (const run of booleanRuns(raw)) {
    if (
      !run.value &&
      runLengthMeters(run, samples) <= method.unmatchedGapHealingMeters &&
      (run.start > 0 || run.end < raw.length - 1)
    ) {
      for (let index = run.start; index <= run.end; index += 1) healed[index] = true;
    }
  }
  const cleaned = [...healed];
  for (const run of booleanRuns(healed)) {
    if (
      run.value &&
      run.start > 0 &&
      run.end < healed.length - 1 &&
      runLengthMeters(run, samples) < method.minimumMeaningfulDivergenceMeters
    ) {
      for (let index = run.start; index <= run.end; index += 1) cleaned[index] = false;
    }
  }
  return cleaned;
}

/** Slice original vertices and insert only interpolated diagnostic boundaries. */
export function sliceOriginalGeometry(
  coordinates: RouteCoordinate[],
  startProgressMeters: number,
  endProgressMeters: number,
): RouteCoordinate[] {
  const metrics = routeMetrics(coordinates);
  if (metrics.coordinates.length < 2 || metrics.lengthMeters <= 0) return [];
  const start = Math.max(0, Math.min(metrics.lengthMeters, startProgressMeters));
  const end = Math.max(start, Math.min(metrics.lengthMeters, endProgressMeters));
  const geometry: RouteCoordinate[] = [coordinateAtProgress(metrics, start)];
  for (let index = 1; index < metrics.coordinates.length - 1; index += 1) {
    if (metrics.cumulative[index] > start && metrics.cumulative[index] < end) {
      geometry.push([...metrics.coordinates[index]] as RouteCoordinate);
    }
  }
  const endCoordinate = coordinateAtProgress(metrics, end);
  const last = geometry[geometry.length - 1];
  if (last[0] !== endCoordinate[0] || last[1] !== endCoordinate[1]) {
    geometry.push(endCoordinate);
  }
  return geometry;
}

function sharedCoverageMeters(flags: boolean[], samples: RouteSample[]): number {
  let total = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (flags[index - 1] && flags[index]) {
      total +=
        samples[index].cumulativeProgressMeters -
        samples[index - 1].cumulativeProgressMeters;
    }
  }
  return total;
}

function buildSharedSections(
  flags: boolean[],
  samples: RouteSample[],
  coordinates: RouteCoordinate[],
): RouteDifferenceSection[] {
  const sections: RouteDifferenceSection[] = [];
  for (const run of booleanRuns(flags)) {
    if (!run.value || samples.length === 0) continue;
    const startProgressMeters = samples[run.start].cumulativeProgressMeters;
    const endProgressMeters = samples[run.end].cumulativeProgressMeters;
    if (endProgressMeters <= startProgressMeters) continue;
    sections.push({
      startProgressMeters,
      endProgressMeters,
      distanceMeters: endProgressMeters - startProgressMeters,
      geometry: sliceOriginalGeometry(
        coordinates,
        startProgressMeters,
        endProgressMeters,
      ),
    });
  }
  return sections;
}

function percent(part: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(part)) return 0;
  return Math.max(0, Math.min(100, (part / total) * 100));
}

function midpoint(a: RouteCoordinate, b: RouteCoordinate): RouteCoordinate {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function makeAnchor(
  osrmSample: RouteSample,
  valhallaSample: RouteSample,
): AlignmentAnchor {
  return {
    coordinate: midpoint(osrmSample.coordinate, valhallaSample.coordinate),
    osrmCoordinate: osrmSample.coordinate,
    valhallaCoordinate: valhallaSample.coordinate,
    osrmProgressMeters: osrmSample.cumulativeProgressMeters,
    valhallaProgressMeters: valhallaSample.cumulativeProgressMeters,
  };
}

interface DivergenceBounds {
  start: AlignmentAnchor | null;
  end: AlignmentAnchor | null;
  osrmStart: number;
  osrmEnd: number;
  valhallaStart: number;
  valhallaEnd: number;
}

function buildDivergences(
  osrmRoute: NormalizedRoute,
  valhallaRoute: NormalizedRoute,
  osrmMetrics: RouteMetrics,
  valhallaMetrics: RouteMetrics,
  osrmSamples: RouteSample[],
  valhallaSamples: RouteSample[],
  osrmMatches: Array<DirectionalMatch | null>,
  osrmSharedFlags: boolean[],
  method: RouteDifferenceMethod,
): RouteDifferenceDivergence[] {
  const anchors: AlignmentAnchor[] = [];
  for (let index = 0; index < osrmSamples.length; index += 1) {
    const match = osrmMatches[index];
    if (!match || !osrmSharedFlags[index]) continue;
    const anchor = makeAnchor(osrmSamples[index], valhallaSamples[match.targetIndex]);
    const previous = anchors[anchors.length - 1];
    if (
      previous &&
      anchor.valhallaProgressMeters <
        previous.valhallaProgressMeters - method.monotonicBacktrackMeters
    ) {
      continue;
    }
    anchors.push(anchor);
  }

  const bounds: DivergenceBounds[] = [];
  if (anchors.length === 0) {
    if (
      Math.max(osrmMetrics.lengthMeters, valhallaMetrics.lengthMeters) >=
      method.minimumMeaningfulDivergenceMeters
    ) {
      bounds.push({
        start: null,
        end: null,
        osrmStart: 0,
        osrmEnd: osrmMetrics.lengthMeters,
        valhallaStart: 0,
        valhallaEnd: valhallaMetrics.lengthMeters,
      });
    }
  } else {
    const first = anchors[0];
    if (
      Math.max(first.osrmProgressMeters, first.valhallaProgressMeters) >=
      method.minimumMeaningfulDivergenceMeters
    ) {
      bounds.push({
        start: null,
        end: first,
        osrmStart: 0,
        osrmEnd: first.osrmProgressMeters,
        valhallaStart: 0,
        valhallaEnd: first.valhallaProgressMeters,
      });
    }
    for (let index = 1; index < anchors.length; index += 1) {
      const start = anchors[index - 1];
      const end = anchors[index];
      const osrmGap = end.osrmProgressMeters - start.osrmProgressMeters;
      const valhallaGap = end.valhallaProgressMeters - start.valhallaProgressMeters;
      if (
        Math.max(osrmGap, valhallaGap) >=
        method.minimumMeaningfulDivergenceMeters
      ) {
        bounds.push({
          start,
          end,
          osrmStart: start.osrmProgressMeters,
          osrmEnd: end.osrmProgressMeters,
          valhallaStart: start.valhallaProgressMeters,
          valhallaEnd: end.valhallaProgressMeters,
        });
      }
    }
    const last = anchors[anchors.length - 1];
    if (
      Math.max(
        osrmMetrics.lengthMeters - last.osrmProgressMeters,
        valhallaMetrics.lengthMeters - last.valhallaProgressMeters,
      ) >= method.minimumMeaningfulDivergenceMeters
    ) {
      bounds.push({
        start: last,
        end: null,
        osrmStart: last.osrmProgressMeters,
        osrmEnd: osrmMetrics.lengthMeters,
        valhallaStart: last.valhallaProgressMeters,
        valhallaEnd: valhallaMetrics.lengthMeters,
      });
    }
  }

  const merged: DivergenceBounds[] = [];
  for (const candidate of bounds) {
    const previous = merged[merged.length - 1];
    const osrmSharedGap = previous
      ? candidate.osrmStart - previous.osrmEnd
      : Infinity;
    const valhallaSharedGap = previous
      ? candidate.valhallaStart - previous.valhallaEnd
      : Infinity;
    if (
      previous &&
      osrmSharedGap < method.minimumMeaningfulDivergenceMeters &&
      valhallaSharedGap < method.minimumMeaningfulDivergenceMeters
    ) {
      previous.end = candidate.end;
      previous.osrmEnd = candidate.osrmEnd;
      previous.valhallaEnd = candidate.valhallaEnd;
    } else {
      merged.push({ ...candidate });
    }
  }

  return merged.map((item, index) => {
    const osrmDistanceMeters = Math.max(0, item.osrmEnd - item.osrmStart);
    const valhallaDistanceMeters = Math.max(
      0,
      item.valhallaEnd - item.valhallaStart,
    );
    return {
      index,
      split: item.start
        ? {
            coordinate: item.start.coordinate,
            osrmProgressMeters: item.start.osrmProgressMeters,
            valhallaProgressMeters: item.start.valhallaProgressMeters,
          }
        : null,
      rejoin: item.end
        ? {
            coordinate: item.end.coordinate,
            osrmProgressMeters: item.end.osrmProgressMeters,
            valhallaProgressMeters: item.end.valhallaProgressMeters,
          }
        : null,
      osrmGeometry: sliceOriginalGeometry(
        osrmRoute.coordinates,
        item.osrmStart,
        item.osrmEnd,
      ),
      valhallaGeometry: sliceOriginalGeometry(
        valhallaRoute.coordinates,
        item.valhallaStart,
        item.valhallaEnd,
      ),
      osrmDistanceMeters,
      valhallaDistanceMeters,
      lengthDeltaMeters: valhallaDistanceMeters - osrmDistanceMeters,
      osrmStartProgressMeters: item.osrmStart,
      osrmEndProgressMeters: item.osrmEnd,
      valhallaStartProgressMeters: item.valhallaStart,
      valhallaEndProgressMeters: item.valhallaEnd,
    };
  });
}

export function analyzeRouteDifference(
  osrmRoute: NormalizedRoute,
  valhallaRoute: NormalizedRoute,
  method: RouteDifferenceMethod = DEFAULT_ROUTE_DIFFERENCE_METHOD,
): RouteDifferenceResult {
  const warnings: string[] = [];
  const osrmMetrics = routeMetrics(osrmRoute.coordinates);
  const valhallaMetrics = routeMetrics(valhallaRoute.coordinates);
  if (osrmMetrics.coordinates.length < 2 || osrmMetrics.lengthMeters <= 0) {
    warnings.push("OSRM route geometry is empty or degenerate.");
  }
  if (
    valhallaMetrics.coordinates.length < 2 ||
    valhallaMetrics.lengthMeters <= 0
  ) {
    warnings.push("Valhalla route geometry is empty or degenerate.");
  }

  const fallbackReference =
    osrmMetrics.coordinates[0] ?? valhallaMetrics.coordinates[0] ?? [0, 0];
  const reference: RouteCoordinate = [
    ((osrmMetrics.coordinates[0]?.[0] ?? fallbackReference[0]) +
      (valhallaMetrics.coordinates[0]?.[0] ?? fallbackReference[0])) /
      2,
    ((osrmMetrics.coordinates[0]?.[1] ?? fallbackReference[1]) +
      (valhallaMetrics.coordinates[0]?.[1] ?? fallbackReference[1])) /
      2,
  ];
  const osrmSamples = resample(
    osrmMetrics,
    method.sampleSpacingMeters,
    reference,
  );
  const valhallaSamples = resample(
    valhallaMetrics,
    method.sampleSpacingMeters,
    reference,
  );
  const osrmMatches = matchSamples(osrmSamples, valhallaSamples, method);
  const valhallaMatches = matchSamples(valhallaSamples, osrmSamples, method);
  const osrmSharedFlags = cleanSharedFlags(
    osrmMatches.map(Boolean),
    osrmSamples,
    method,
  );
  const valhallaSharedFlags = cleanSharedFlags(
    valhallaMatches.map(Boolean),
    valhallaSamples,
    method,
  );
  const osrmSharedMeters = sharedCoverageMeters(osrmSharedFlags, osrmSamples);
  const valhallaSharedMeters = sharedCoverageMeters(
    valhallaSharedFlags,
    valhallaSamples,
  );
  const osrmSharedPercent = percent(osrmSharedMeters, osrmMetrics.lengthMeters);
  const valhallaSharedPercent = percent(
    valhallaSharedMeters,
    valhallaMetrics.lengthMeters,
  );

  return {
    osrmRouteId: osrmRoute.id,
    valhallaRouteId: valhallaRoute.id,
    method: { ...method },
    osrmGeometryLengthMeters: osrmMetrics.lengthMeters,
    valhallaGeometryLengthMeters: valhallaMetrics.lengthMeters,
    osrmSharedMeters,
    osrmNonSharedMeters: Math.max(0, osrmMetrics.lengthMeters - osrmSharedMeters),
    osrmSharedPercent,
    valhallaSharedMeters,
    valhallaNonSharedMeters: Math.max(0, valhallaMetrics.lengthMeters - valhallaSharedMeters),
    valhallaSharedPercent,
    geometricSimilarityPercent:
      (osrmSharedPercent + valhallaSharedPercent) / 2,
    osrmSharedSections: buildSharedSections(
      osrmSharedFlags,
      osrmSamples,
      osrmRoute.coordinates,
    ),
    valhallaSharedSections: buildSharedSections(
      valhallaSharedFlags,
      valhallaSamples,
      valhallaRoute.coordinates,
    ),
    divergences: buildDivergences(
      osrmRoute,
      valhallaRoute,
      osrmMetrics,
      valhallaMetrics,
      osrmSamples,
      valhallaSamples,
      osrmMatches,
      osrmSharedFlags,
      method,
    ),
    warnings,
  };
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./store";
import type { CompareResponse, ValhallaTraceResult } from "./types";

vi.mock("./api", () => ({
  compare: vi.fn(),
  osrmRaw: vi.fn(),
  valhallaRaw: vi.fn(),
  curlImport: vi.fn(),
  health: vi.fn(),
  valhallaTrace: vi.fn(),
}));

import * as api from "./api";

function response(geometry: string): CompareResponse {
  return {
    osrm: {
      engine: "osrm",
      status: "ok",
      httpStatus: 200,
      durationMs: 1,
      normalizedRoutes: [{
        id: "osrm:0",
        engine: "osrm",
        index: 0,
        isPrimary: true,
        label: "OSRM Primary",
        coordinates: [[77, 28], [77.1, 28.1]],
        distanceMeters: 1,
        durationSeconds: 1,
        cost: 1,
        raw: { geometry },
      }],
      raw: {},
      warnings: [],
      error: null,
    },
    valhalla: {
      engine: "valhalla",
      status: "ok",
      httpStatus: 200,
      durationMs: 1,
      normalizedRoutes: [],
      raw: {},
      warnings: [],
      error: null,
    },
  };
}

const oldTrace = {
  status: "ok",
  sourceRouteId: "osrm:0",
  originalGeometry: [[77, 28], [77.1, 28.1]],
  traceGeometry: [[77, 28], [77.1, 28.1]],
  exactGeometryMatch: true,
  originalPointCount: 2,
  tracePointCount: 2,
  geometryDeviation: null,
  segments: [],
  warnings: [],
  errors: [],
  httpStatus: 200,
  durationMs: 1,
} as ValhallaTraceResult;

describe("Trace Inspector store isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      start: { lat: 28, lon: 77 },
      dest: { lat: 28.1, lon: 77.1 },
      edgeDebugEnabled: false,
      selectedRouteId: "osrm:0",
      traceSourceRouteId: "osrm:0",
      traceSourceEncodedPolyline: "old-geometry",
      traceStatus: "done",
      traceResult: oldTrace,
      traceError: null,
      tracePinnedSegmentIds: ["trace:osrm:0:0"],
      traceInspectorPinned: true,
      comparisonResultRevision: 0,
      routeComparisonCamera: null,
      routeComparisonCameraResultRevision: null,
      traceResultRevision: 0,
      traceInspectorCamera: null,
      traceInspectorCameraResultRevision: null,
      traceAnalysisQuery: { field: "speed", operator: "=", value: "35" },
      traceAnalysisExecutedSearch: {
        traceResultRevision: 0,
        routeId: "trace:osrm:0",
        query: { field: "speed", operator: "=", value: "35" },
        result: {
          matchingSegmentIds: [],
          matchingSegments: [],
          matchedDistanceMeters: 0,
          matchedPercentage: 0,
          totalSegmentCount: 0,
          matchingSegmentCount: 0,
          missingLengthSegmentCount: 0,
          hasIncompleteDistanceCoverage: false,
        },
      },
      traceAnalysisFocusedSegmentId: "trace:osrm:0:0",
    });
  });

  it("invalidates a trace when a new comparison reuses the id with new geometry", async () => {
    vi.mocked(api.compare).mockResolvedValue(response("new-geometry"));

    await useStore.getState().runCompare();

    expect(useStore.getState().traceSourceRouteId).toBe("osrm:0");
    expect(useStore.getState().traceResult).toBeNull();
    expect(useStore.getState().traceStatus).toBe("idle");
    expect(useStore.getState().tracePinnedSegmentIds).toEqual([]);
    expect(useStore.getState().selectedRouteId).toBe("osrm:0");
    expect(useStore.getState().traceAnalysisExecutedSearch).toBeNull();
    expect(useStore.getState().traceAnalysisFocusedSegmentId).toBeNull();
  });

  it("preserves a compatible trace across navigation-independent comparison state", async () => {
    vi.mocked(api.compare).mockResolvedValue(response("old-geometry"));

    await useStore.getState().runCompare();

    expect(useStore.getState().traceResult).toBe(oldTrace);
    expect(useStore.getState().traceStatus).toBe("done");
    expect(useStore.getState().traceAnalysisExecutedSearch).not.toBeNull();
    expect(useStore.getState().traceAnalysisFocusedSegmentId).toBeNull();
  });

  it("advances trace identity only when an explicit trace returns", async () => {
    vi.mocked(api.compare).mockResolvedValue(response("old-geometry"));
    vi.mocked(api.valhallaTrace).mockResolvedValue(oldTrace);
    await useStore.getState().runCompare();
    expect(useStore.getState().traceResultRevision).toBe(0);

    await useStore.getState().runValhallaTrace();

    expect(api.valhallaTrace).toHaveBeenCalledOnce();
    expect(useStore.getState().traceResultRevision).toBe(1);
    expect(useStore.getState().traceResult).toBe(oldTrace);
  });
});

describe("Trace analysis result lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      results: response("old-geometry"),
      traceSourceRouteId: "osrm:0",
      traceSourceEncodedPolyline: "old-geometry",
      traceStatus: "done",
      traceResult: oldTrace,
      traceResultRevision: 4,
      traceAnalysisExecutedSearch: {
        traceResultRevision: 4,
        routeId: "trace:osrm:0",
        query: { field: "speed", operator: "=", value: "35" },
        result: {
          matchingSegmentIds: [],
          matchingSegments: [],
          matchedDistanceMeters: 0,
          matchedPercentage: 0,
          totalSegmentCount: 0,
          matchingSegmentCount: 0,
          missingLengthSegmentCount: 0,
          hasIncompleteDistanceCoverage: false,
        },
      },
      traceAnalysisFocusedSegmentId: "trace:osrm:0:0",
    });
  });

  it("clears stale search geometry and transient focus as soon as a new trace starts", async () => {
    let resolveTrace!: (value: ValhallaTraceResult) => void;
    vi.mocked(api.valhallaTrace).mockImplementation(
      () => new Promise((resolve) => {
        resolveTrace = resolve;
      }),
    );

    const pending = useStore.getState().runValhallaTrace();

    expect(useStore.getState().traceStatus).toBe("loading");
    expect(useStore.getState().traceResult).toBeNull();
    expect(useStore.getState().traceAnalysisExecutedSearch).toBeNull();
    expect(useStore.getState().traceAnalysisFocusedSegmentId).toBeNull();

    resolveTrace(oldTrace);
    await pending;
    expect(useStore.getState().traceResultRevision).toBe(5);
  });
});

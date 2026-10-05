import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompareResponse } from "./types";

vi.mock("./api", () => ({
  compare: vi.fn(),
  health: vi.fn(),
  osrmRaw: vi.fn(),
  valhallaRaw: vi.fn(),
  curlImport: vi.fn(),
}));

import * as api from "./api";
import { useStore } from "./store";

const response: CompareResponse = {
  osrm: {
    engine: "osrm", status: "ok", httpStatus: 200, durationMs: 1,
    normalizedRoutes: [], raw: {}, warnings: [], error: null,
  },
  valhalla: {
    engine: "valhalla", status: "ok", httpStatus: 200, durationMs: 1,
    normalizedRoutes: [], raw: {}, warnings: [], error: null,
  },
  debug: {
    osrm: { engine: "osrm", status: "ok", segments: [], errors: [] },
    valhalla: { engine: "valhalla", status: "ok", segments: [], errors: [] },
  },
};

describe("Edge Debug store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      start: { lat: 28.6, lon: 77.2 },
      dest: { lat: 28.5, lon: 77.3 },
      edgeDebugEnabled: false,
      debugResults: null,
      hoveredDebugSegmentIds: [],
      hoveredDebugPoint: null,
      pinnedDebugSegmentIds: [],
      pinnedDebugPoint: null,
      debugInspectorPinned: false,
      edgeDetailsOpenRequestId: 0,
      routeAnalysisFocusedSegmentId: null,
      compareStatus: "idle",
      lastError: null,
    });
    vi.mocked(api.compare).mockResolvedValue(response);
  });

  it("omits the debug argument while off and requests it while on", async () => {
    await useStore.getState().runCompare();
    expect(api.compare).toHaveBeenLastCalledWith(
      { lat: 28.6, lon: 77.2 },
      { lat: 28.5, lon: 77.3 },
    );
    expect(useStore.getState().debugResults).toBeNull();

    useStore.getState().setEdgeDebugEnabled(true);
    await useStore.getState().runCompare();
    expect(api.compare).toHaveBeenLastCalledWith(
      { lat: 28.6, lon: 77.2 },
      { lat: 28.5, lon: 77.3 },
      true,
    );
    expect(useStore.getState().debugResults).toEqual(response.debug);
  });

  it("new comparisons clear stale hover and pin state", async () => {
    useStore.setState({
      edgeDebugEnabled: true,
      hoveredDebugSegmentIds: ["old-hover"],
      hoveredDebugPoint: [77.2, 28.6],
      pinnedDebugSegmentIds: ["old-pin"],
      pinnedDebugPoint: [77.2, 28.6],
      debugInspectorPinned: true,
      routeAnalysisFocusedSegmentId: "old-focus",
    });
    await useStore.getState().runCompare();
    expect(useStore.getState().hoveredDebugSegmentIds).toEqual([]);
    expect(useStore.getState().pinnedDebugSegmentIds).toEqual([]);
    expect(useStore.getState().hoveredDebugPoint).toBeNull();
    expect(useStore.getState().pinnedDebugPoint).toBeNull();
    expect(useStore.getState().debugInspectorPinned).toBe(false);
    expect(useStore.getState().routeAnalysisFocusedSegmentId).toBeNull();
  });

  it("explicit exact-ID pins replace safely and request Edge Details every time", () => {
    useStore.getState().pinDebugSegments(["edge-a"], null);
    const first = useStore.getState();
    expect(first.pinnedDebugSegmentIds).toEqual(["edge-a"]);
    expect(first.pinnedDebugPoint).toBeNull();
    expect(first.edgeDetailsOpenRequestId).toBe(1);

    useStore.getState().pinDebugSegments(["edge-b"], null);
    const second = useStore.getState();
    expect(second.pinnedDebugSegmentIds).toEqual(["edge-b"]);
    expect(second.edgeDetailsOpenRequestId).toBe(2);
  });

  it("keeps pinned details stable while hover continues independently", () => {
    useStore.getState().setHoveredDebugSegmentIds(
      ["osrm:0:0:1"],
      [77.2, 28.6],
    );
    useStore.getState().pinHoveredDebugSegments();
    useStore.getState().setHoveredDebugSegmentIds(
      ["valhalla:0:0:2"],
      [77.3, 28.5],
    );

    expect(useStore.getState().pinnedDebugSegmentIds).toEqual(["osrm:0:0:1"]);
    expect(useStore.getState().pinnedDebugPoint).toEqual([77.2, 28.6]);
    expect(useStore.getState().hoveredDebugSegmentIds).toEqual([
      "valhalla:0:0:2",
    ]);
    expect(useStore.getState().hoveredDebugPoint).toEqual([77.3, 28.5]);
    expect(useStore.getState().debugInspectorPinned).toBe(true);

    useStore.getState().unpinDebugInspector();
    expect(useStore.getState().pinnedDebugSegmentIds).toEqual([]);
    expect(useStore.getState().pinnedDebugPoint).toBeNull();
    expect(useStore.getState().hoveredDebugSegmentIds).toEqual([
      "valhalla:0:0:2",
    ]);
  });
});

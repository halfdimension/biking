import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompareResponse, NormalizedRoute } from "./types";

// Mock the api module so the store never touches the network.
vi.mock("./api", () => ({
  compare: vi.fn(),
  health: vi.fn(),
  osrmRaw: vi.fn(),
  valhallaRaw: vi.fn(),
  curlImport: vi.fn(),
}));

import * as api from "./api";
import { useStore } from "./store";
import {
  loadAssessments,
  loadTestCases,
  saveTestCases as saveTestCasesToStorage,
} from "./persistence";

function route(
  engine: "osrm" | "valhalla",
  index: number,
): NormalizedRoute {
  return {
    id: `${engine}:${index}`,
    engine,
    index,
    isPrimary: index === 0,
    label: `${engine} ${index}`,
    coordinates: [
      [77.6, 12.9],
      [77.65, 12.95],
    ],
    distanceMeters: 1000 + index,
    durationSeconds: 100 + index,
    cost: 50 + index,
    raw: {},
  };
}

/** 2 OSRM routes + 3 Valhalla routes. */
function makeCompareResponse(): CompareResponse {
  return {
    osrm: {
      engine: "osrm",
      status: "ok",
      httpStatus: 200,
      durationMs: 10,
      normalizedRoutes: [route("osrm", 0), route("osrm", 1)],
      raw: {},
      warnings: [],
      error: null,
    },
    valhalla: {
      engine: "valhalla",
      status: "ok",
      httpStatus: 200,
      durationMs: 12,
      normalizedRoutes: [
        route("valhalla", 0),
        route("valhalla", 1),
        route("valhalla", 2),
      ],
      raw: {},
      warnings: [],
      error: null,
    },
  };
}

/** A single-engine EngineResult envelope (for raw-request tests). */
function makeEngineResult(
  engine: "osrm" | "valhalla",
  routes: NormalizedRoute[],
): import("./types").EngineResult {
  return {
    engine,
    status: "ok",
    httpStatus: 200,
    durationMs: 7,
    normalizedRoutes: routes,
    raw: { some: "raw" },
    warnings: [],
    error: null,
  };
}

/** Reset the store to a clean baseline before each test. */
function resetStore() {
  useStore.setState({
    start: null,
    dest: null,
    mapClickTarget: null,
    mode: "normal",
    osrmUrlDraft: "",
    valhallaUrlDraft: "",
    valhallaBodyDraft: "",
    results: null,
    routes: [],
    osrmRawState: { status: "idle", result: null, error: null },
    valhallaRawState: { status: "idle", result: null, error: null },
    latestResponseSource: { osrm: null, valhalla: null },
    curlImportState: { status: "idle", engine: null, result: null, error: null },
    visibility: {},
    selectedRouteId: null,
    routeAnalysisRouteId: null,
    routeAnalysisMetricId: "speed",
    routeAnalysisQuery: { field: "speed", operator: "=", value: "" },
    routeAnalysisExecutedSearch: null,
    testCases: [],
    quality: {},
    assessments: {},
    sessionAssessments: {},
    currentTestCaseId: null,
    health: { osrm: "unknown", valhalla: "unknown" },
    compareStatus: "idle",
    lastError: null,
    comparisonResultRevision: 0,
    routeComparisonCamera: null,
    routeComparisonCameraResultRevision: null,
    traceResultRevision: 0,
    traceInspectorCamera: null,
    traceInspectorCameraResultRevision: null,
  });
}

const ALL_IDS = [
  "osrm:0",
  "osrm:1",
  "valhalla:0",
  "valhalla:1",
  "valhalla:2",
];

describe("store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetStore();
  });

  describe("runCompare", () => {
    it("flattens envelopes into 5 routes in order and sets all-visible", async () => {
      vi.mocked(api.compare).mockResolvedValue(makeCompareResponse());
      useStore.getState().setStart({ lat: 12.9, lon: 77.6 });
      useStore.getState().setDest({ lat: 12.95, lon: 77.65 });

      await useStore.getState().runCompare();

      const state = useStore.getState();
      expect(api.compare).toHaveBeenCalledWith(
        { lat: 12.9, lon: 77.6 },
        { lat: 12.95, lon: 77.65 },
      );
      expect(state.routes.map((r) => r.id)).toEqual(ALL_IDS);
      expect(state.compareStatus).toBe("done");
      expect(state.comparisonResultRevision).toBe(1);
      expect(state.lastError).toBeNull();
      expect(state.latestResponseSource).toEqual({
        osrm: "compare",
        valhalla: "compare",
      });
      // Visibility all true for exactly the returned ids.
      expect(Object.keys(state.visibility).sort()).toEqual([...ALL_IDS].sort());
      expect(Object.values(state.visibility).every((v) => v === true)).toBe(true);
    });

    it("errors without calling api when coordinates are missing", async () => {
      await useStore.getState().runCompare();
      expect(api.compare).not.toHaveBeenCalled();
      expect(useStore.getState().compareStatus).toBe("error");
      expect(useStore.getState().lastError).toMatch(/required/i);
    });

    it("keeps selection if still present, clears otherwise", async () => {
      vi.mocked(api.compare).mockResolvedValue(makeCompareResponse());
      useStore.getState().setStart({ lat: 1, lon: 1 });
      useStore.getState().setDest({ lat: 2, lon: 2 });

      useStore.getState().selectRoute("osrm:0");
      await useStore.getState().runCompare();
      expect(useStore.getState().selectedRouteId).toBe("osrm:0");

      // Select a route id that won't exist in the next response.
      useStore.getState().selectRoute("valhalla:99");
      await useStore.getState().runCompare();
      expect(useStore.getState().selectedRouteId).toBeNull();
    });

    it("invalidates an executed Route Analysis search as soon as a new comparison starts", async () => {
      vi.mocked(api.compare).mockResolvedValue(makeCompareResponse());
      useStore.setState({
        start: { lat: 1, lon: 1 },
        dest: { lat: 2, lon: 2 },
        routeAnalysisExecutedSearch: {
          comparisonResultRevision: 0,
          routeId: "valhalla:0",
          query: { field: "speed", operator: "=", value: "40" },
          result: {
            matchingSegmentIds: ["old-segment"],
            matchingSegments: [],
            matchedDistanceMeters: 100,
            matchedPercentage: 10,
            totalSegmentCount: 10,
            matchingSegmentCount: 1,
            missingLengthSegmentCount: 0,
            hasIncompleteDistanceCoverage: false,
          },
        },
      });

      const pending = useStore.getState().runCompare();
      expect(useStore.getState().routeAnalysisExecutedSearch).toBeNull();
      await pending;
      expect(useStore.getState().routeAnalysisExecutedSearch).toBeNull();
      expect(useStore.getState().comparisonResultRevision).toBe(1);
    });

    it("sets error status and message when api.compare rejects", async () => {
      vi.mocked(api.compare).mockRejectedValue(new Error("boom"));
      useStore.getState().setStart({ lat: 1, lon: 1 });
      useStore.getState().setDest({ lat: 2, lon: 2 });

      await useStore.getState().runCompare();
      expect(useStore.getState().compareStatus).toBe("error");
      expect(useStore.getState().lastError).toBe("boom");
    });
  });

  describe("selection and visibility", () => {
    it("selectRoute sets and clears the selected id", () => {
      useStore.getState().selectRoute("osrm:1");
      expect(useStore.getState().selectedRouteId).toBe("osrm:1");
      useStore.getState().selectRoute(null);
      expect(useStore.getState().selectedRouteId).toBeNull();
    });

    it("setVisibility toggles a single route", () => {
      useStore.getState().setVisibility("osrm:0", false);
      expect(useStore.getState().visibility["osrm:0"]).toBe(false);
      useStore.getState().setVisibility("osrm:0", true);
      expect(useStore.getState().visibility["osrm:0"]).toBe(true);
    });
  });

  describe("bulk visibility helpers", () => {
    beforeEach(async () => {
      vi.mocked(api.compare).mockResolvedValue(makeCompareResponse());
      useStore.getState().setStart({ lat: 1, lon: 1 });
      useStore.getState().setDest({ lat: 2, lon: 2 });
      await useStore.getState().runCompare();
    });

    const visibleIds = () =>
      Object.entries(useStore.getState().visibility)
        .filter(([, v]) => v)
        .map(([id]) => id)
        .sort();

    it("showAll makes every route visible", () => {
      useStore.getState().hideAll();
      useStore.getState().showAll();
      expect(visibleIds()).toEqual([...ALL_IDS].sort());
    });

    it("hideAll makes every route hidden", () => {
      useStore.getState().hideAll();
      expect(visibleIds()).toEqual([]);
    });

    it("osrmOnly shows only OSRM routes", () => {
      useStore.getState().osrmOnly();
      expect(visibleIds()).toEqual(["osrm:0", "osrm:1"].sort());
    });

    it("valhallaOnly shows only Valhalla routes", () => {
      useStore.getState().valhallaOnly();
      expect(visibleIds()).toEqual(
        ["valhalla:0", "valhalla:1", "valhalla:2"].sort(),
      );
    });

    it("primaryOnly shows only primary routes", () => {
      useStore.getState().primaryOnly();
      expect(visibleIds()).toEqual(["osrm:0", "valhalla:0"].sort());
    });

    it("alternativesOnly shows only alternate routes", () => {
      useStore.getState().alternativesOnly();
      expect(visibleIds()).toEqual(
        ["osrm:1", "valhalla:1", "valhalla:2"].sort(),
      );
    });
  });

  describe("sendOsrmRaw (isolated from compare)", () => {
    it("success sets osrmRawState done + result and surfaces routes, leaving compare untouched", async () => {
      const routes = [route("osrm", 0), route("osrm", 1)];
      vi.mocked(api.osrmRaw).mockResolvedValue(makeEngineResult("osrm", routes));

      // Seed a prior Normal-mode compare state that must NOT be disturbed.
      useStore.setState({
        results: makeCompareResponse(),
        compareStatus: "done",
        lastError: null,
      });

      const url = "http://localhost:5000/route/v1/biking/1,1;2,2?steps=true";
      await useStore.getState().sendOsrmRaw(url);

      const state = useStore.getState();
      expect(api.osrmRaw).toHaveBeenCalledWith(url);
      expect(state.osrmRawState.status).toBe("done");
      expect(state.osrmRawState.result?.normalizedRoutes).toHaveLength(2);
      expect(state.osrmRawState.error).toBeNull();
      expect(state.latestResponseSource.osrm).toBe("raw");
      // Routes surfaced on the render slice, all visible.
      expect(state.routes.map((r) => r.id)).toEqual(["osrm:0", "osrm:1"]);
      expect(Object.values(state.visibility).every((v) => v === true)).toBe(true);
      // Compare slices untouched.
      expect(state.compareStatus).toBe("done");
      expect(state.lastError).toBeNull();
      expect(state.results).not.toBeNull();
    });

    it("failure sets osrmRawState error and does NOT touch compare slices", async () => {
      vi.mocked(api.osrmRaw).mockRejectedValue(new Error("osrm boom"));
      useStore.setState({ compareStatus: "idle", lastError: null });

      await useStore.getState().sendOsrmRaw("http://localhost:5000/x");

      const state = useStore.getState();
      expect(state.osrmRawState.status).toBe("error");
      expect(state.osrmRawState.error).toBe("osrm boom");
      expect(state.osrmRawState.result).toBeNull();
      // Compare slices unchanged (isolation).
      expect(state.compareStatus).toBe("idle");
      expect(state.lastError).toBeNull();
    });
  });

  describe("sendValhallaRaw (isolated from compare)", () => {
    it("success sets valhallaRawState done + result and surfaces routes, leaving compare untouched", async () => {
      const routes = [route("valhalla", 0), route("valhalla", 1)];
      vi.mocked(api.valhallaRaw).mockResolvedValue(
        makeEngineResult("valhalla", routes),
      );
      useStore.setState({
        results: makeCompareResponse(),
        compareStatus: "done",
        lastError: null,
      });

      const body = { costing: "motorcycle", alternates: 3 };
      await useStore
        .getState()
        .sendValhallaRaw("http://localhost:8002/route", body);

      const state = useStore.getState();
      expect(api.valhallaRaw).toHaveBeenCalledWith(
        "http://localhost:8002/route",
        body,
      );
      expect(state.valhallaRawState.status).toBe("done");
      expect(state.valhallaRawState.result?.normalizedRoutes).toHaveLength(2);
      expect(state.latestResponseSource.valhalla).toBe("raw");
      expect(state.routes.map((r) => r.id)).toEqual([
        "valhalla:0",
        "valhalla:1",
      ]);
      expect(Object.values(state.visibility).every((v) => v === true)).toBe(true);
      expect(state.compareStatus).toBe("done");
      expect(state.lastError).toBeNull();
    });

    it("failure sets valhallaRawState error and does NOT touch compare slices", async () => {
      vi.mocked(api.valhallaRaw).mockRejectedValue(new Error("valhalla boom"));
      useStore.setState({ compareStatus: "idle", lastError: null });

      await useStore
        .getState()
        .sendValhallaRaw("http://localhost:8002/route", {});

      const state = useStore.getState();
      expect(state.valhallaRawState.status).toBe("error");
      expect(state.valhallaRawState.error).toBe("valhalla boom");
      expect(state.compareStatus).toBe("idle");
      expect(state.lastError).toBeNull();
    });
  });

  describe("sendCurlImport (isolated from compare and raw)", () => {
    it("success sets curlImportState done + engine + result, surfaces routes, leaves other slices untouched", async () => {
      const routes = [route("osrm", 0), route("osrm", 1)];
      vi.mocked(api.curlImport).mockResolvedValue({
        engine: "osrm",
        result: makeEngineResult("osrm", routes),
      });

      // Seed prior compare + raw state that MUST NOT be disturbed.
      useStore.setState({
        results: makeCompareResponse(),
        compareStatus: "done",
        lastError: null,
        osrmRawState: { status: "idle", result: null, error: null },
        valhallaRawState: { status: "idle", result: null, error: null },
      });

      const curl =
        "curl 'http://localhost:5000/route/v1/biking/1,1;2,2?steps=true'";
      await useStore.getState().sendCurlImport(curl);

      const state = useStore.getState();
      expect(api.curlImport).toHaveBeenCalledWith(curl);
      expect(state.curlImportState.status).toBe("done");
      expect(state.curlImportState.engine).toBe("osrm");
      expect(state.curlImportState.result?.normalizedRoutes).toHaveLength(2);
      expect(state.curlImportState.error).toBeNull();
      // Routes surfaced on the render slice, all visible.
      expect(state.routes.map((r) => r.id)).toEqual(["osrm:0", "osrm:1"]);
      expect(Object.values(state.visibility).every((v) => v === true)).toBe(true);
      // Compare + raw slices untouched (isolation).
      expect(state.compareStatus).toBe("done");
      expect(state.lastError).toBeNull();
      expect(state.results).not.toBeNull();
      expect(state.osrmRawState.status).toBe("idle");
      expect(state.valhallaRawState.status).toBe("idle");
    });

    it("failure sets curlImportState error and touches no other slice", async () => {
      vi.mocked(api.curlImport).mockRejectedValue(
        new Error("The curl command targets a host that is not allowed."),
      );
      useStore.setState({
        compareStatus: "idle",
        lastError: null,
        osrmRawState: { status: "idle", result: null, error: null },
        valhallaRawState: { status: "idle", result: null, error: null },
      });

      await useStore.getState().sendCurlImport("curl http://evil.example/x");

      const state = useStore.getState();
      expect(state.curlImportState.status).toBe("error");
      expect(state.curlImportState.error).toBe(
        "The curl command targets a host that is not allowed.",
      );
      expect(state.curlImportState.engine).toBeNull();
      expect(state.curlImportState.result).toBeNull();
      // Every other slice unchanged (isolation).
      expect(state.compareStatus).toBe("idle");
      expect(state.lastError).toBeNull();
      expect(state.osrmRawState.status).toBe("idle");
      expect(state.valhallaRawState.status).toBe("idle");
    });
  });

  describe("saved test cases (Req 13)", () => {
    const START = { lat: 28.78, lon: 76.87 };
    const DEST = { lat: 28.2, lon: 77.45 };

    it("saveTestCase appends a testcase, sets currentTestCaseId, and persists", () => {
      useStore.getState().setStart(START);
      useStore.getState().setDest(DEST);

      const saved = useStore.getState().saveTestCase("My Case");
      expect(saved).toBe(true);

      const state = useStore.getState();
      expect(state.testCases).toHaveLength(1);
      const tc = state.testCases[0];
      expect(tc.name).toBe("My Case");
      expect(tc.start).toEqual(START);
      expect(tc.dest).toEqual(DEST);
      expect(typeof tc.id).toBe("string");
      expect(state.currentTestCaseId).toBe(tc.id);

      // Persisted to localStorage.
      const persisted = loadTestCases();
      expect(persisted).toEqual([tc]);
    });

    it("saveTestCase generates a default name when none is provided", () => {
      useStore.getState().setStart(START);
      useStore.getState().setDest(DEST);
      useStore.getState().saveTestCase();
      expect(useStore.getState().testCases[0].name).toBe("Test 1");
    });

    it("saveTestCase is a no-op (returns false) when coordinates are missing", () => {
      // Only a start set, no dest.
      useStore.getState().setStart(START);
      const saved = useStore.getState().saveTestCase("Nope");
      expect(saved).toBe(false);
      expect(useStore.getState().testCases).toHaveLength(0);
      expect(loadTestCases()).toEqual([]);
    });

    it("loadTestCase restores coords + currentTestCaseId and does NOT call api.compare (LOAD != RUN)", () => {
      useStore.getState().setStart(START);
      useStore.getState().setDest(DEST);
      useStore.getState().saveTestCase("Case");
      const id = useStore.getState().testCases[0].id;

      // Clear coords, then load.
      useStore.getState().setStart(null);
      useStore.getState().setDest(null);
      const fitBefore = useStore.getState().fitRequestId;

      useStore.getState().loadTestCase(id);

      const state = useStore.getState();
      expect(state.start).toEqual(START);
      expect(state.dest).toEqual(DEST);
      expect(state.currentTestCaseId).toBe(id);
      // Critical: loading never sends an engine request (Req 13.5).
      expect(api.compare).not.toHaveBeenCalled();
      // A map fit was requested (Req 13.4).
      expect(state.fitRequestId).toBe(fitBefore + 1);
    });

    it("renameTestCase changes only the name and persists", () => {
      useStore.getState().setStart(START);
      useStore.getState().setDest(DEST);
      useStore.getState().saveTestCase("Old");
      const tc = useStore.getState().testCases[0];

      useStore.getState().renameTestCase(tc.id, "New");

      const next = useStore.getState().testCases[0];
      expect(next.id).toBe(tc.id);
      expect(next.name).toBe("New");
      expect(next.start).toEqual(START);
      expect(next.dest).toEqual(DEST);
      expect(loadTestCases()[0].name).toBe("New");
    });

    it("deleteTestCase removes it, clears currentTestCaseId, and persists", () => {
      useStore.getState().setStart(START);
      useStore.getState().setDest(DEST);
      useStore.getState().saveTestCase("Case");
      const id = useStore.getState().testCases[0].id;
      // Seed an assessment namespace for this testcase (Task 27 shape).
      useStore.setState({
        assessments: { [id]: { "osrm:0": { rating: "good" } } },
      });

      useStore.getState().deleteTestCase(id);

      const state = useStore.getState();
      expect(state.testCases).toHaveLength(0);
      expect(state.currentTestCaseId).toBeNull();
      // Assessment namespace for the deleted testcase is gone.
      expect(state.assessments[id]).toBeUndefined();
      // Persisted removal.
      expect(loadTestCases().some((t) => t.id === id)).toBe(false);
    });

    it("hydrates from localStorage via loadTestCases + setState round-trip", () => {
      const seeded = [
        { id: "seed-1", name: "Seeded", start: START, dest: DEST },
      ];
      saveTestCasesToStorage(seeded);

      // Simulate hydration (the store hydrates at module init via loadTestCases).
      const hydrated = loadTestCases();
      useStore.setState({ testCases: hydrated });

      expect(useStore.getState().testCases).toEqual(seeded);
    });
  });

  describe("assessments (Req 14, namespaced by testcase / session)", () => {
    it("setRating with a currentTestCaseId writes and persists; null clears to Unrated", () => {
      useStore.setState({ currentTestCaseId: "tc-A" });

      useStore.getState().setRating("osrm:0", "good");
      expect(useStore.getState().assessments["tc-A"]["osrm:0"]).toEqual({
        rating: "good",
      });
      // Persisted to localStorage.
      expect(loadAssessments()["tc-A"]["osrm:0"]).toEqual({ rating: "good" });
      // getAssessment reads the active namespace.
      expect(useStore.getState().getAssessment("osrm:0")).toEqual({
        rating: "good",
      });

      // Clearing to Unrated removes the entry (and prunes the empty namespace).
      useStore.getState().setRating("osrm:0", null);
      expect(useStore.getState().getAssessment("osrm:0")).toBeUndefined();
      expect(loadAssessments()["tc-A"]).toBeUndefined();
    });

    it("engine separation: OSRM and Valhalla ratings coexist without overwrite", () => {
      useStore.setState({ currentTestCaseId: "tc-A" });
      useStore.getState().setRating("osrm:0", "good");
      useStore.getState().setRating("valhalla:0", "bad");

      const ns = useStore.getState().assessments["tc-A"];
      expect(ns["osrm:0"]).toEqual({ rating: "good" });
      expect(ns["valhalla:0"]).toEqual({ rating: "bad" });
    });

    it("testcase namespace separation: rating under A does not leak into B", () => {
      useStore.setState({ currentTestCaseId: "tc-A" });
      useStore.getState().setRating("osrm:0", "good");

      // Switch to testcase B — same route id must read as Unrated there.
      useStore.setState({ currentTestCaseId: "tc-B" });
      expect(useStore.getState().getAssessment("osrm:0")).toBeUndefined();

      // Switching back to A restores A's rating.
      useStore.setState({ currentTestCaseId: "tc-A" });
      expect(useStore.getState().getAssessment("osrm:0")).toEqual({
        rating: "good",
      });
    });

    it("session mode (no testcase): writes sessionAssessments and does NOT persist", () => {
      useStore.setState({ currentTestCaseId: null });

      useStore.getState().setRating("osrm:0", "neutral");
      expect(useStore.getState().sessionAssessments["osrm:0"]).toEqual({
        rating: "neutral",
      });
      expect(useStore.getState().getAssessment("osrm:0")).toEqual({
        rating: "neutral",
      });
      // Nothing persisted while in session mode.
      expect(loadAssessments()).toEqual({});
      expect(useStore.getState().assessments).toEqual({});
    });

    it("notes persist under the testcase namespace and combine with a rating", () => {
      useStore.setState({ currentTestCaseId: "tc-A" });

      useStore.getState().setAssessmentNotes("osrm:0", "windy detour");
      expect(useStore.getState().getAssessment("osrm:0")).toEqual({
        notes: "windy detour",
      });
      expect(loadAssessments()["tc-A"]["osrm:0"]).toEqual({
        notes: "windy detour",
      });

      // Adding a rating keeps the notes.
      useStore.getState().setRating("osrm:0", "bad");
      expect(useStore.getState().getAssessment("osrm:0")).toEqual({
        rating: "bad",
        notes: "windy detour",
      });

      // Clearing notes to empty keeps the rating-only entry.
      useStore.getState().setAssessmentNotes("osrm:0", "");
      expect(useStore.getState().getAssessment("osrm:0")).toEqual({
        rating: "bad",
      });
    });

    it("clearing both rating and notes removes the entry entirely", () => {
      useStore.setState({ currentTestCaseId: "tc-A" });
      useStore.getState().setAssessmentNotes("osrm:0", "note");
      useStore.getState().setAssessmentNotes("osrm:0", "");
      expect(useStore.getState().getAssessment("osrm:0")).toBeUndefined();
      expect(loadAssessments()["tc-A"]).toBeUndefined();
    });
  });

  describe("refreshHealth", () => {
    it("sets health from api.health", async () => {
      vi.mocked(api.health).mockResolvedValue({
        osrm: "reachable",
        valhalla: "unreachable",
      });
      await useStore.getState().refreshHealth();
      expect(useStore.getState().health).toEqual({
        osrm: "reachable",
        valhalla: "unreachable",
      });
    });
  });
});

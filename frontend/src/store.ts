/**
 * Single Zustand store for the dashboard (design: Frontend App State).
 *
 * The store isolates engine-specific parsing (done in the backend) from
 * rendering: it consumes only `NormalizedRoute` values and never re-parses
 * engine responses (Req 12.4). The map subscribes to `routes`, `visibility`,
 * and `selectedRouteId`.
 */

import { create } from "zustand";
import * as api from "./api";
import {
  type AssessmentsMap,
  type LayoutState,
  deleteAssessmentsFor,
  loadAssessments,
  loadLayout,
  loadTestCases,
  saveAssessments,
  saveLayout,
  saveTestCases,
} from "./persistence";
import type {
  CompareDebug,
  CompareResponse,
  Coordinate,
  Engine,
  EngineHealth,
  EngineResult,
  NormalizedRoute,
  RouteQuality,
  TestCase,
  ValhallaTraceResult,
  RoutingTarget,
} from "./types";
import type { MapCameraState } from "./map/camera";
import type { RouteMetricId } from "./analysis/routeProfile";
import type {
  RouteAttributeQuery,
  RouteQueryResult,
} from "./analysis/routeQuery";

export type AppMode = "normal" | "advanced";
export type MapClickTarget = "start" | "dest" | null;
export type CompareStatus = "idle" | "loading" | "done" | "error";
export type RawStatus = "idle" | "loading" | "done" | "error";

export type TraceStatus = "idle" | "loading" | "done" | "error";

export interface ExecutedRouteAnalysisSearch {
  comparisonResultRevision: number;
  routeId: string;
  query: RouteAttributeQuery;
  result: RouteQueryResult;
}

export interface ExecutedTraceAnalysisSearch {
  traceResultRevision: number;
  routeId: string;
  query: RouteAttributeQuery;
  result: RouteQueryResult;
}

export type TraceLowerTab = "edge-details" | "route-analysis";

/**
 * The lifecycle of a single Advanced/raw request send (Req 9.4–9.7). Kept in a
 * dedicated slice per engine so a raw-request failure never mislabels a
 * Normal-mode Compare — its errors are fully isolated from `compareStatus` /
 * `lastError` (Req 17.13 error isolation).
 */
export interface RawRequestState {
  status: RawStatus;
  result: EngineResult | null;
  error: string | null;
}

const IDLE_RAW: RawRequestState = { status: "idle", result: null, error: null };

/**
 * The lifecycle of a single curl-import send (Req 10.2, 17.7). Kept in a
 * dedicated slice, fully isolated from Normal-mode Compare (`compareStatus` /
 * `lastError`) and from the raw-request slices (`osrmRawState` /
 * `valhallaRawState`) so a curl-import failure never mislabels any of them
 * (Req error isolation). The backend determines the engine from the URL, so
 * the resolved engine is echoed back here for display.
 */
export interface CurlImportState {
  status: "idle" | "loading" | "done" | "error";
  engine: Engine | null;
  result: EngineResult | null;
  error: string | null;
}

const IDLE_CURL_IMPORT: CurlImportState = {
  status: "idle",
  engine: null,
  result: null,
  error: null,
};

export interface AppState {
  // Coordinates (Req 1)
  start: Coordinate | null;
  dest: Coordinate | null;
  mapClickTarget: MapClickTarget;

  // Request construction (Req 9)
  mode: AppMode;
  routingTarget: RoutingTarget;
  osrmUrlDraft: string;
  valhallaUrlDraft: string;
  valhallaBodyDraft: string;

  // Results (Req 2, 12)
  results: CompareResponse | null;
  routes: NormalizedRoute[];
  /** Debug payload matching the currently rendered route result, if requested. */
  debugResults: CompareDebug | null;

  // Edge-debug interaction state. Segment objects stay in debugResults; these
  // arrays contain only stable ids so pointer movement remains lightweight.
  edgeDebugEnabled: boolean;
  hoveredDebugSegmentIds: string[];
  /** Geographic point under the live debug hover, in MapLibre [lon, lat] order. */
  hoveredDebugPoint: [number, number] | null;
  pinnedDebugSegmentIds: string[];
  /** Geographic point captured when the current segment set was pinned. */
  pinnedDebugPoint: [number, number] | null;
  debugInspectorPinned: boolean;
  /** Monotonic signal used to open Edge Details even when already pinned. */
  edgeDetailsOpenRequestId: number;

  // Trace Inspector state is independent from the comparison map interaction.
  traceSourceRouteId: string | null;
  traceSourceEncodedPolyline: string | null;
  traceStatus: TraceStatus;
  traceResult: ValhallaTraceResult | null;
  traceError: string | null;
  traceHoveredSegmentIds: string[];
  traceHoveredPoint: [number, number] | null;
  tracePinnedSegmentIds: string[];
  tracePinnedPoint: [number, number] | null;
  traceInspectorPinned: boolean;
  traceDetailsCollapsed: boolean;
  traceDetailsExpandedHeight: number;
  traceFitRequestId: number;
  traceLowerTab: TraceLowerTab;
  traceEdgeDetailsOpenRequestId: number;
  traceAnalysisMetricId: RouteMetricId;
  traceAnalysisQuery: RouteAttributeQuery;
  traceAnalysisExecutedSearch: ExecutedTraceAnalysisSearch | null;
  traceAnalysisFocusedSegmentId: string | null;

  // Each screen owns a complete camera snapshot. The companion revision binds
  // it to the result that produced it, preventing an old viewport from being
  // restored over a genuinely new comparison/trace result.
  routeComparisonCamera: MapCameraState | null;
  routeComparisonCameraResultRevision: number | null;
  comparisonResultRevision: number;
  traceInspectorCamera: MapCameraState | null;
  traceInspectorCameraResultRevision: number | null;
  traceResultRevision: number;

  // Advanced/raw request results (Req 9.4–9.7). Isolated from Normal-mode
  // `results` / `compareStatus` so a raw send never affects a Normal Compare
  // (Req 17.13). Named `*State` to avoid colliding with the api functions.
  osrmRawState: RawRequestState;
  valhallaRawState: RawRequestState;
  /** Most recently initiated response-producing action for each engine. */
  latestResponseSource: Record<Engine, "compare" | "raw" | null>;

  // Curl-import results (Req 10). Isolated from Normal-mode Compare and from the
  // raw-request slices so an import failure never affects them (error
  // isolation). Only ONE import result is tracked at a time (the last executed);
  // the component routes it to the correct paste area locally.
  curlImportState: CurlImportState;

  // View state (Req 5, 6)
  visibility: Record<string, boolean>;
  selectedRouteId: string | null;

  // Session-only Route Analysis state. It survives component/navigation
  // remounts, but is deliberately not persisted to localStorage.
  routeAnalysisRouteId: string | null;
  routeAnalysisMetricId: RouteMetricId;
  routeAnalysisQuery: RouteAttributeQuery;
  routeAnalysisExecutedSearch: ExecutedRouteAnalysisSearch | null;
  /** Transient chart-origin focus; full segments remain in debugResults. */
  routeAnalysisFocusedSegmentId: string | null;

  // Persistence-backed (Req 13, 14)
  testCases: TestCase[];
  /** Legacy quality slice (unused; superseded by `assessments`). */
  quality: Record<string, RouteQuality>;
  /**
   * Route-quality assessments namespaced by testcase id, hydrated from
   * localStorage (Req 14.3). Outer key = testcase id, inner key = the
   * DETERMINISTIC geometry key (`routeAssessmentKey`, e.g. "valhalla:1a2b3c4d"),
   * NOT the index-based route id. Keying on geometry (not index) keeps a saved
   * rating attached to the correct route across reruns even when an engine
   * reorders its alternates.
   */
  assessments: AssessmentsMap;
  /**
   * In-memory-only assessments used when NO testcase is current
   * (`currentTestCaseId === null`). Keyed by the same deterministic geometry
   * key (`routeAssessmentKey`) as `assessments` for consistency. These are
   * intentionally NOT persisted to localStorage: they let a user rate routes
   * for an unsaved scenario, but the Assessment tab surfaces a banner telling
   * them to save the test case to persist. Saving/loading a testcase does not
   * merge these in — they are ephemeral session scratch (Req 14).
   */
  sessionAssessments: Record<string, RouteQuality>;
  /**
   * Which saved testcase (if any) the current coords/results correspond to
   * (Req 13). Set when saving or loading a testcase; cleared when the loaded
   * testcase is deleted. Task 27 uses this as the assessment namespace.
   */
  currentTestCaseId: string | null;

  // Health (Req 16)
  health: { osrm: EngineHealth; valhalla: EngineHealth };

  // Compare lifecycle for the UI
  compareStatus: CompareStatus;
  lastError: string | null;

  // Manual map-fit trigger (Task 18.1, Req 20.2). Incremented by `requestFit`;
  // MapView runs its fit routine in an effect keyed on this counter. A monotonic
  // counter (rather than a boolean) lets repeated Fit Routes clicks each fire.
  fitRequestId: number;

  // --- Layout UI state (collapsible panels + Focus Map) --------------------
  // A small, isolated UI-only slice: the three panel-collapse booleans plus the
  // Focus Map bookkeeping. Kept deliberately separate from routing/results/
  // assessment state and persisted to its OWN localStorage key
  // (`biking.layout.v1`), never the testcase/assessment keys. Changing these
  // only resizes sibling panels via CSS; MapView reacts by calling
  // `map.resize()` (the map instance is never recreated).
  /** Left sidebar collapsed to a narrow rail when true. */
  leftCollapsed: boolean;
  /** Right sidebar collapsed to a narrow rail when true. */
  rightCollapsed: boolean;
  /** Bottom panel body hidden (only the tab strip remains) when true. */
  bottomCollapsed: boolean;
  /** Preferred expanded comparison-panel height for this browser session. */
  routeComparisonPanelHeight: number;
  /**
   * True while "Focus Map" is active — i.e. after the first Focus Map click and
   * before the restoring second click. Drives the two-state toolbar toggle.
   */
  mapFocused: boolean;
  /**
   * The pre-focus collapse states captured on the Focus Map click that entered
   * focused mode, restored on the click that exits it. Null when not focused.
   */
  layoutSnapshot: LayoutState["snapshot"];

  // --- Actions ---
  setStart: (c: Coordinate | null) => void;
  setDest: (c: Coordinate | null) => void;
  setMapClickTarget: (t: MapClickTarget) => void;
  setMode: (m: AppMode) => void;
  setRoutingTarget: (target: RoutingTarget) => void;
  setOsrmUrlDraft: (url: string) => void;
  setValhallaUrlDraft: (url: string) => void;
  setValhallaBodyDraft: (body: string) => void;

  runCompare: () => Promise<void>;
  setEdgeDebugEnabled: (enabled: boolean) => void;
  setHoveredDebugSegmentIds: (
    ids: string[],
    point?: [number, number] | null,
  ) => void;
  pinDebugSegments: (
    ids: string[],
    point?: [number, number] | null,
  ) => void;
  pinHoveredDebugSegments: () => void;
  unpinDebugInspector: () => void;
  clearDebugInteraction: () => void;

  setTraceSourceRouteId: (routeId: string) => void;
  runValhallaTrace: () => Promise<void>;
  setTraceHoveredSegmentIds: (
    ids: string[],
    point?: [number, number] | null,
  ) => void;
  pinTraceHoveredSegments: () => void;
  pinTraceSegments: (
    ids: string[],
    point?: [number, number] | null,
  ) => void;
  clearTracePin: () => void;
  toggleTraceDetailsCollapsed: () => void;
  setTraceDetailsExpandedHeight: (height: number) => void;
  setTraceLowerTab: (tab: TraceLowerTab) => void;
  setTraceAnalysisMetricId: (metricId: RouteMetricId) => void;
  setTraceAnalysisQuery: (query: RouteAttributeQuery) => void;
  setTraceAnalysisExecutedSearch: (
    search: ExecutedTraceAnalysisSearch | null,
  ) => void;
  clearTraceAnalysisSearch: () => void;
  setTraceAnalysisFocusedSegmentId: (id: string | null) => void;
  requestTraceFit: () => void;
  setRouteComparisonCamera: (camera: MapCameraState) => void;
  clearRouteComparisonCamera: () => void;
  setTraceInspectorCamera: (camera: MapCameraState) => void;
  clearTraceInspectorCamera: () => void;

  /** Send an exact OSRM URL verbatim through the raw path (Req 9.4, 9.5). */
  sendOsrmRaw: (url: string) => Promise<void>;
  /** Send an exact Valhalla URL + parsed JSON body verbatim (Req 9.6, 9.7). */
  sendValhallaRaw: (url: string, body: unknown) => Promise<void>;

  /**
   * Import and execute a pasted curl command through the backend (Req 10.2).
   * The frontend NEVER executes the pasted text locally — it only POSTs the
   * string; the backend parses it with shlex and enforces the host allowlist.
   */
  sendCurlImport: (curl: string) => Promise<void>;

  selectRoute: (routeId: string | null) => void;
  /** Explicit "Clear selection" control — sets `selectedRouteId` to null. */
  clearSelection: () => void;
  setVisibility: (routeId: string, visible: boolean) => void;
  setRouteAnalysisRouteId: (routeId: string | null) => void;
  setRouteAnalysisMetricId: (metricId: RouteMetricId) => void;
  setRouteAnalysisQuery: (query: RouteAttributeQuery) => void;
  setRouteAnalysisExecutedSearch: (
    search: ExecutedRouteAnalysisSearch | null,
  ) => void;
  clearRouteAnalysisSearch: () => void;

  setRouteAnalysisFocusedSegmentId: (id: string | null) => void;
  /** Request a manual map fit (Req 20.2); MapView reacts to `fitRequestId`. */
  requestFit: () => void;

  // --- Layout UI actions (collapsible panels + Focus Map) ------------------
  /** Toggle the left sidebar between expanded and the narrow rail. */
  toggleLeftCollapsed: () => void;
  /** Toggle the right sidebar between expanded and the narrow rail. */
  toggleRightCollapsed: () => void;
  /** Toggle the bottom panel body between shown and hidden (strip stays). */
  toggleBottomCollapsed: () => void;
  /** Set the session-only preferred expanded comparison-panel height. */
  setRouteComparisonPanelHeight: (height: number) => void;
  /**
   * Focus Map two-state toggle. When NOT focused, snapshot the current three
   * collapse booleans and collapse all three. When already focused, restore the
   * snapshot exactly and clear the focused flag. Never touches panel contents or
   * application state — only the layout slice.
   */
  focusMap: () => void;

  // --- Saved test cases (Req 13). Isolated from compare/raw/curl slices. ---
  /**
   * Save the current start+dest as a new test case (Req 13.2, 13.3). No-op
   * (returns false) when either coordinate is missing. Generates an id and a
   * default name when none is given, appends to `testCases`, sets
   * `currentTestCaseId`, and persists. Returns true when a testcase was saved.
   */
  saveTestCase: (name?: string) => boolean;
  /**
   * Load a saved test case (Req 13.4): restore its start/dest, set
   * `currentTestCaseId`, and fit the map to the markers. Does NOT send any
   * engine request — the user must click Compare (Req 13.5). Previews
   * regenerate automatically from the restored coordinates.
   */
  loadTestCase: (id: string) => void;
  /** Rename a saved test case, keeping its id/coords/notes/assessments (Req 13.2). */
  renameTestCase: (id: string, name: string) => void;
  /**
   * Delete a saved test case and its associated assessment namespace (Req 13),
   * clearing `currentTestCaseId` when it referred to the deleted testcase.
   */
  deleteTestCase: (id: string) => void;
  /** Edit the optional free-text notes on a saved test case. */
  setTestCaseNotes: (id: string, notes: string) => void;

  // --- Route quality assessments (Req 14). Namespaced by `currentTestCaseId`;
  // when it is null the ephemeral `sessionAssessments` slice is used instead. ---
  /**
   * Set (or clear) a route's Good/Bad/Neutral rating (Req 14.1). `key` is the
   * DETERMINISTIC geometry key (`routeAssessmentKey(route)`), NOT the index id;
   * callers compute it from the route so a rating follows the geometry across
   * reruns. Passing `null` clears the rating back to Unrated; if the entry then
   * has neither a rating nor notes it is removed entirely (Unrated == absence).
   *
   * Writes into `assessments[currentTestCaseId][key]` and persists when a
   * testcase is current (Req 14.3); otherwise writes to the in-memory-only
   * `sessionAssessments` and does NOT persist (Req 14 "temporary allowed but
   * indicate saving is required").
   */
  setRating: (key: string, rating: RouteQuality["rating"] | null) => void;
  /**
   * Set (or clear) a route's free-text notes (Req 14.2). `key` is the
   * deterministic geometry key (`routeAssessmentKey(route)`).
   * Empty/whitespace-only notes remove the notes field; if the entry then has
   * no rating and no notes it is removed. Same namespacing/persistence rules as
   * {@link setRating}.
   */
  setAssessmentNotes: (key: string, notes: string) => void;
  /**
   * Read the assessment for a route's geometry key from the active namespace:
   * the current testcase's namespace when one is set, else the session slice.
   * `key` is the deterministic geometry key (`routeAssessmentKey(route)`).
   * Returns `undefined` when the route is Unrated (no entry).
   */
  getAssessment: (key: string) => RouteQuality | undefined;

  // Bulk visibility helpers (pure state transforms over current routes) (Req 5)
  showAll: () => void;
  hideAll: () => void;
  osrmOnly: () => void;
  valhallaOnly: () => void;
  primaryOnly: () => void;
  alternativesOnly: () => void;

  refreshHealth: () => Promise<void>;
}

/**
 * Flatten both engine envelopes into a single ordered route list: all OSRM
 * routes first (in `normalizedRoutes` order), then all Valhalla routes.
 */
export function flattenRoutes(results: CompareResponse): NormalizedRoute[] {
  return [
    ...results.osrm.normalizedRoutes,
    ...results.valhalla.normalizedRoutes,
  ];
}

/** Return the original preserved OSRM polyline6 for a normalized route. */
export function encodedPolylineForRoute(route: NormalizedRoute | undefined): string | null {
  if (!route || route.engine !== "osrm" || !route.raw || typeof route.raw !== "object") {
    return null;
  }
  const geometry = (route.raw as { geometry?: unknown }).geometry;
  return typeof geometry === "string" && geometry.length > 0 ? geometry : null;
}

/**
 * Surface a successful raw request's normalized routes on the shared render
 * slice so the returned routes are renderable using the existing pipeline
 * (Req 9: "inspected/rendered using the existing dashboard architecture").
 *
 * This intentionally replaces the currently displayed `routes`/`visibility`
 * (both Advanced editors and Compare feed the same render slice — expected).
 * It touches ONLY the render slice; `results`/`compareStatus`/`lastError`
 * (Normal-mode) are never modified here, preserving error isolation.
 * The current `selectedRouteId` is cleared when it is no longer present.
 */
function applyRawRoutes(
  state: AppState,
  result: EngineResult,
): Pick<
  AppState,
  | "routes"
  | "visibility"
  | "selectedRouteId"
  | "debugResults"
  | "hoveredDebugSegmentIds"
  | "hoveredDebugPoint"
  | "pinnedDebugSegmentIds"
  | "pinnedDebugPoint"
  | "debugInspectorPinned"
  | "routeAnalysisExecutedSearch"
  | "routeAnalysisFocusedSegmentId"
> {
  const routes = result.normalizedRoutes;
  const visibility = buildVisibility(routes, () => true);
  const prevSelected = state.selectedRouteId;
  const selectedRouteId =
    prevSelected && routes.some((r) => r.id === prevSelected)
      ? prevSelected
      : null;
  return {
    routes,
    visibility,
    selectedRouteId,
    debugResults: null,
    hoveredDebugSegmentIds: [],
    hoveredDebugPoint: null,
    pinnedDebugSegmentIds: [],
    pinnedDebugPoint: null,
    debugInspectorPinned: false,
    routeAnalysisExecutedSearch: null,
    routeAnalysisFocusedSegmentId: null,
  };
}

/**
 * Generate a stable, unique id for a new test case. Prefers `crypto.randomUUID`
 * (available in modern browsers and jsdom) and falls back to a time+random id
 * so id generation never throws in constrained environments.
 */
function newTestCaseId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `tc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A useful default name when the user saves without naming (Req 13.1). */
function defaultTestCaseName(n: number): string {
  return `Test ${n}`;
}

/**
 * A store-internal assessment entry. Structurally identical to the persisted
 * `RouteQuality` except `rating` is OPTIONAL: a route may carry notes while
 * being Unrated (no rating). "Unrated" is represented by either the absence of
 * an entry, or an entry that has notes but no `rating` — never by a literal.
 */
type StoredAssessment = { rating?: RouteQuality["rating"]; notes?: string };

/**
 * Apply a pure updater to the assessment entry for the geometry `key` in the
 * ACTIVE namespace and persist when appropriate.
 *
 * `key` is the DETERMINISTIC geometry key (`routeAssessmentKey`), not the
 * index-based route id, so ratings follow geometry across reruns (Req 14).
 *
 * Namespacing (Req 14.3):
 *   - `currentTestCaseId` set → read/write `assessments[currentTestCaseId]`
 *     and persist the whole `assessments` map to localStorage.
 *   - `currentTestCaseId` null → read/write the in-memory `sessionAssessments`
 *     and do NOT persist (session-only; the UI shows a "save to persist" banner).
 *
 * The updater receives the previous entry (or `undefined`) and returns the next
 * entry, or `undefined` to REMOVE it. When a testcase namespace becomes empty
 * it is pruned so no empty `{}` lingers in storage.
 */
function updateAssessment(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  key: string,
  updater: (prev: StoredAssessment | undefined) => StoredAssessment | undefined,
): void {
  const state = get();
  const tcId = state.currentTestCaseId;

  if (tcId == null) {
    // Session mode: mutate the ephemeral slice only, never persist.
    const current = state.sessionAssessments;
    const prev = current[key] as StoredAssessment | undefined;
    const nextEntry = updater(prev);
    const next: Record<string, RouteQuality> = { ...current };
    if (nextEntry === undefined) {
      delete next[key];
    } else {
      next[key] = nextEntry as RouteQuality;
    }
    set({ sessionAssessments: next });
    return;
  }

  // Testcase mode: namespaced under the testcase id, persisted on every change.
  const ns = { ...(state.assessments[tcId] ?? {}) };
  const prev = ns[key] as StoredAssessment | undefined;
  const nextEntry = updater(prev);
  if (nextEntry === undefined) {
    delete ns[key];
  } else {
    ns[key] = nextEntry as RouteQuality;
  }

  const nextAssessments: AssessmentsMap = { ...state.assessments };
  if (Object.keys(ns).length === 0) {
    // Prune an empty namespace so storage stays tidy.
    delete nextAssessments[tcId];
  } else {
    nextAssessments[tcId] = ns;
  }
  set({ assessments: nextAssessments });
  saveAssessments(nextAssessments);
}

/**
 * Persist only the layout slice to its own localStorage key. Reads the five
 * layout fields off the given state so callers can pass a merged next-state.
 * Delegates to the safe `saveLayout` helper, which never throws.
 */
function persistLayout(state: {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomCollapsed: boolean;
  mapFocused: boolean;
  layoutSnapshot: LayoutState["snapshot"];
}): void {
  saveLayout({
    leftCollapsed: state.leftCollapsed,
    rightCollapsed: state.rightCollapsed,
    bottomCollapsed: state.bottomCollapsed,
    mapFocused: state.mapFocused,
    snapshot: state.layoutSnapshot,
  });
}

/** Build a visibility map with every provided route set to `visible`. */
function buildVisibility(
  routes: NormalizedRoute[],
  predicate: (r: NormalizedRoute) => boolean,
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const r of routes) {
    next[r.id] = predicate(r);
  }
  return next;
}

export const useStore = create<AppState>((set, get) => ({
  start: null,
  dest: null,
  mapClickTarget: null,

  mode: "normal",
  routingTarget: "local",
  osrmUrlDraft: "",
  valhallaUrlDraft: "",
  valhallaBodyDraft: "",

  results: null,
  routes: [],
  debugResults: null,
  edgeDebugEnabled: false,
  hoveredDebugSegmentIds: [],
  hoveredDebugPoint: null,
  pinnedDebugSegmentIds: [],
  pinnedDebugPoint: null,
  debugInspectorPinned: false,

  edgeDetailsOpenRequestId: 0,
  traceSourceRouteId: null,
  traceSourceEncodedPolyline: null,
  traceStatus: "idle",
  traceResult: null,
  traceError: null,
  traceHoveredSegmentIds: [],
  traceHoveredPoint: null,
  tracePinnedSegmentIds: [],
  tracePinnedPoint: null,
  traceInspectorPinned: false,
  traceDetailsCollapsed: false,
  traceDetailsExpandedHeight: 180,
  traceFitRequestId: 0,
  traceLowerTab: "edge-details",
  traceEdgeDetailsOpenRequestId: 0,
  traceAnalysisMetricId: "speed",
  traceAnalysisQuery: { field: "speed", operator: "=", value: "" },
  traceAnalysisExecutedSearch: null,
  traceAnalysisFocusedSegmentId: null,
  routeComparisonCamera: null,
  routeComparisonCameraResultRevision: null,
  comparisonResultRevision: 0,
  traceInspectorCamera: null,
  traceInspectorCameraResultRevision: null,
  traceResultRevision: 0,

  osrmRawState: IDLE_RAW,
  valhallaRawState: IDLE_RAW,
  latestResponseSource: { osrm: null, valhalla: null },

  curlImportState: IDLE_CURL_IMPORT,

  visibility: {},
  selectedRouteId: null,
  routeAnalysisRouteId: null,
  routeAnalysisMetricId: "speed",
  routeAnalysisQuery: { field: "speed", operator: "=", value: "" },
  routeAnalysisExecutedSearch: null,

  routeAnalysisFocusedSegmentId: null,
  // Hydrate persisted test cases + assessments at store creation so a page
  // refresh restores saved scenarios (Req 13.3). Both loaders are safe and
  // never throw on corrupt storage (they degrade to []/{}).
  testCases: loadTestCases(),
  quality: {},
  assessments: loadAssessments(),
  sessionAssessments: {},
  currentTestCaseId: null,

  health: { osrm: "unknown", valhalla: "unknown" },

  compareStatus: "idle",
  lastError: null,

  fitRequestId: 0,

  // Hydrate the layout slice from its own localStorage key at store creation,
  // mirroring the testCases/assessments hydration above. `loadLayout` is safe
  // and degrades to all-expanded defaults on missing/corrupt data.
  ...(() => {
    const l = loadLayout();
    return {
      leftCollapsed: l.leftCollapsed,
      rightCollapsed: l.rightCollapsed,
      bottomCollapsed: l.bottomCollapsed,
      routeComparisonPanelHeight: 280,
      mapFocused: l.mapFocused,
      layoutSnapshot: l.snapshot,
    };
  })(),

  setStart: (c) => set({ start: c }),
  setDest: (c) => set({ dest: c }),
  setMapClickTarget: (t) => set({ mapClickTarget: t }),
  setMode: (m) => set({ mode: m }),
  setRoutingTarget: (target) =>
    set((state) => ({
      routingTarget: target,
      edgeDebugEnabled: target === "prod" ? false : state.edgeDebugEnabled,
      hoveredDebugSegmentIds: target === "prod" ? [] : state.hoveredDebugSegmentIds,
      hoveredDebugPoint: target === "prod" ? null : state.hoveredDebugPoint,
      pinnedDebugSegmentIds: target === "prod" ? [] : state.pinnedDebugSegmentIds,
      pinnedDebugPoint: target === "prod" ? null : state.pinnedDebugPoint,
      debugInspectorPinned: target === "prod" ? false : state.debugInspectorPinned,
    })),
  setOsrmUrlDraft: (url) => set({ osrmUrlDraft: url }),
  setValhallaUrlDraft: (url) => set({ valhallaUrlDraft: url }),
  setValhallaBodyDraft: (body) => set({ valhallaBodyDraft: body }),

  runCompare: async () => {
    const { start, dest, edgeDebugEnabled, routingTarget } = get();
    const includeDebug = edgeDebugEnabled && routingTarget === "local";
    // A result-bound segment id must never survive into a new comparison.
    set({
      debugResults: null,
      hoveredDebugSegmentIds: [],
      hoveredDebugPoint: null,
      pinnedDebugSegmentIds: [],
      pinnedDebugPoint: null,
      debugInspectorPinned: false,
      routeAnalysisExecutedSearch: null,
      routeAnalysisFocusedSegmentId: null,
    });
    if (!start || !dest) {
      set({
        compareStatus: "error",
        lastError: "Both start and destination coordinates are required.",
      });
      return;
    }
    set({
      compareStatus: "loading",
      lastError: null,
      latestResponseSource: { osrm: "compare", valhalla: "compare" },
    });
    try {
      const results = await api.compare(
        start,
        dest,
        includeDebug,
        routingTarget,
      );
      const routes = flattenRoutes(results);
      // Initialize visibility to all-visible for the returned routes only.
      const visibility = buildVisibility(routes, () => true);
      // Keep normal-map selection and trace selection independently.
      const previous = get();
      const prevSelected = previous.selectedRouteId;
      const selectedRouteId =
        prevSelected && routes.some((r) => r.id === prevSelected)
          ? prevSelected
          : null;
      const osrmRoutes = results.osrm.normalizedRoutes;
      const selectedTraceRoute =
        osrmRoutes.find((route) => route.id === previous.traceSourceRouteId) ??
        osrmRoutes[0];
      const nextTraceSourceId = selectedTraceRoute?.id ?? null;
      const nextTraceEncoded = encodedPolylineForRoute(selectedTraceRoute);
      const keepTrace =
        previous.traceResult !== null &&
        previous.traceResult.sourceRouteId === nextTraceSourceId &&
        previous.traceSourceEncodedPolyline === nextTraceEncoded;
      set({
        results,
        routes,
        visibility,
        selectedRouteId,
        debugResults: includeDebug ? (results.debug ?? null) : null,
        routeAnalysisFocusedSegmentId: null,
        traceAnalysisFocusedSegmentId: null,
        compareStatus: "done",
        comparisonResultRevision: previous.comparisonResultRevision + 1,
        lastError: null,
        traceSourceRouteId: nextTraceSourceId,
        ...(keepTrace
          ? {}
          : {
              traceSourceEncodedPolyline: null,
              traceStatus: "idle" as const,
              traceResult: null,
              traceError: null,
              traceHoveredSegmentIds: [],
              traceHoveredPoint: null,
              tracePinnedSegmentIds: [],
              tracePinnedPoint: null,
              traceInspectorPinned: false,
              traceAnalysisExecutedSearch: null,
              traceAnalysisFocusedSegmentId: null,
              traceResultRevision: previous.traceResultRevision + 1,
            }),
      });
    } catch (err) {
      set({
        compareStatus: "error",
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setEdgeDebugEnabled: (enabled) => {
    if (enabled && get().routingTarget === "prod") return;
    set({
      edgeDebugEnabled: enabled,
      hoveredDebugSegmentIds: [],
      hoveredDebugPoint: null,
      pinnedDebugSegmentIds: [],
      pinnedDebugPoint: null,
      debugInspectorPinned: false,
      routeAnalysisFocusedSegmentId: null,
    });
  },

  setHoveredDebugSegmentIds: (ids, point = null) => {
    const state = get();
    const previous = state.hoveredDebugSegmentIds;
    if (
      previous.length === ids.length &&
      previous.every((id, index) => id === ids[index]) &&
      state.hoveredDebugPoint?.[0] === point?.[0] &&
      state.hoveredDebugPoint?.[1] === point?.[1]
    ) {
      return;
    }
    set({
      hoveredDebugSegmentIds: ids,
      hoveredDebugPoint: ids.length ? point : null,
    });
  },

  pinDebugSegments: (ids, point = null) => {
    if (ids.length === 0) return;
    set((state) => ({
      pinnedDebugSegmentIds: [...ids],
      pinnedDebugPoint: point,
      debugInspectorPinned: true,
      bottomCollapsed: false,
      edgeDetailsOpenRequestId: state.edgeDetailsOpenRequestId + 1,
    }));
  },

  pinHoveredDebugSegments: () => {
    const state = get();
    state.pinDebugSegments(state.hoveredDebugSegmentIds, state.hoveredDebugPoint);
  },

  unpinDebugInspector: () =>
    set({
      pinnedDebugSegmentIds: [],
      pinnedDebugPoint: null,
      debugInspectorPinned: false,
    }),

  clearDebugInteraction: () =>
    set({
      hoveredDebugSegmentIds: [],
      hoveredDebugPoint: null,
      pinnedDebugSegmentIds: [],
      pinnedDebugPoint: null,
      debugInspectorPinned: false,
      routeAnalysisFocusedSegmentId: null,
    }),

  setTraceSourceRouteId: (routeId) => {
    const previous = get();
    if (previous.traceSourceRouteId === routeId) return;
    set({
      traceSourceRouteId: routeId,
      traceSourceEncodedPolyline: null,
      traceStatus: "idle",
      traceResult: null,
      traceError: null,
      traceHoveredSegmentIds: [],
      traceHoveredPoint: null,
      tracePinnedSegmentIds: [],
      tracePinnedPoint: null,
      traceInspectorPinned: false,
      traceAnalysisExecutedSearch: null,
      traceAnalysisFocusedSegmentId: null,
      traceResultRevision: previous.traceResultRevision + 1,
    });
  },

  runValhallaTrace: async () => {
    const state = get();
    const route = state.results?.osrm.normalizedRoutes.find(
      (candidate) => candidate.id === state.traceSourceRouteId,
    );
    const encodedPolyline = encodedPolylineForRoute(route);
    if (!route || !encodedPolyline) {
      set({
        traceStatus: "error",
        traceError: route
          ? "The selected OSRM route has no preserved polyline6 geometry."
          : "Run a route comparison first.",
        traceResult: null,
      });
      return;
    }
    set({
      traceStatus: "loading",
      traceError: null,
      traceResult: null,
      traceSourceEncodedPolyline: encodedPolyline,
      traceHoveredSegmentIds: [],
      traceHoveredPoint: null,
      tracePinnedSegmentIds: [],
      tracePinnedPoint: null,
      traceInspectorPinned: false,
      traceAnalysisExecutedSearch: null,
      traceAnalysisFocusedSegmentId: null,
    });
    try {
      const result = await api.valhallaTrace(route.id, encodedPolyline);
      // A source change while the request was in flight invalidates the response.
      if (
        get().traceSourceRouteId !== route.id ||
        get().traceSourceEncodedPolyline !== encodedPolyline
      ) {
        return;
      }
      const failed = result.status === "error";
      set({
        traceStatus: failed ? "error" : "done",
        traceResult: result,
        traceResultRevision: get().traceResultRevision + 1,
        traceError: failed
          ? (result.errors[0]?.message ?? "Valhalla trace failed.")
          : null,
      });
    } catch (err) {
      if (get().traceSourceRouteId !== route.id) return;
      set({
        traceStatus: "error",
        traceResult: null,
        traceError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setTraceHoveredSegmentIds: (ids, point = null) => {
    const state = get();
    const previous = state.traceHoveredSegmentIds;
    if (
      previous.length === ids.length &&
      previous.every((id, index) => id === ids[index]) &&
      state.traceHoveredPoint?.[0] === point?.[0] &&
      state.traceHoveredPoint?.[1] === point?.[1]
    ) {
      return;
    }
    set({
      traceHoveredSegmentIds: ids,
      traceHoveredPoint: ids.length ? point : null,
    });
  },

  pinTraceSegments: (ids, point = null) => {
    if (ids.length === 0) return;
    set((state) => ({
      tracePinnedSegmentIds: [...ids],
      tracePinnedPoint: point,
      traceInspectorPinned: true,
      traceDetailsCollapsed: false,
      traceLowerTab: "edge-details",
      traceEdgeDetailsOpenRequestId: state.traceEdgeDetailsOpenRequestId + 1,
    }));
  },

  pinTraceHoveredSegments: () => {
    const state = get();
    state.pinTraceSegments(
      state.traceHoveredSegmentIds,
      state.traceHoveredPoint,
    );
  },

  clearTracePin: () =>
    set({
      tracePinnedSegmentIds: [],
      tracePinnedPoint: null,
      traceInspectorPinned: false,
    }),

  toggleTraceDetailsCollapsed: () =>
    set((state) => ({
      traceDetailsCollapsed: !state.traceDetailsCollapsed,
    })),

  setTraceDetailsExpandedHeight: (height) =>
    set({ traceDetailsExpandedHeight: height }),

  setTraceLowerTab: (tab) =>
    set({ traceLowerTab: tab, traceDetailsCollapsed: false }),

  setTraceAnalysisMetricId: (metricId) =>
    set({ traceAnalysisMetricId: metricId }),

  setTraceAnalysisQuery: (query) =>
    set((state) => {
      const current = state.traceAnalysisQuery;
      const changed =
        current.field !== query.field ||
        current.operator !== query.operator ||
        current.value !== query.value;
      return {
        traceAnalysisQuery: query,
        traceAnalysisExecutedSearch: changed
          ? null
          : state.traceAnalysisExecutedSearch,
      };
    }),

  setTraceAnalysisExecutedSearch: (search) =>
    set({ traceAnalysisExecutedSearch: search }),

  clearTraceAnalysisSearch: () =>
    set({ traceAnalysisExecutedSearch: null }),

  setTraceAnalysisFocusedSegmentId: (id) => {
    if (get().traceAnalysisFocusedSegmentId === id) return;
    set({ traceAnalysisFocusedSegmentId: id });
  },

  requestTraceFit: () =>
    set((state) => ({ traceFitRequestId: state.traceFitRequestId + 1 })),

  setRouteComparisonCamera: (camera) =>
    set((state) => ({
      routeComparisonCamera: camera,
      routeComparisonCameraResultRevision: state.comparisonResultRevision,
    })),

  clearRouteComparisonCamera: () =>
    set({
      routeComparisonCamera: null,
      routeComparisonCameraResultRevision: null,
    }),

  setTraceInspectorCamera: (camera) =>
    set((state) => ({
      traceInspectorCamera: camera,
      traceInspectorCameraResultRevision: state.traceResultRevision,
    })),

  clearTraceInspectorCamera: () =>
    set({
      traceInspectorCamera: null,
      traceInspectorCameraResultRevision: null,
    }),

  sendOsrmRaw: async (url) => {
    set((state) => ({
      osrmRawState: { status: "loading", result: null, error: null },
      latestResponseSource: {
        ...state.latestResponseSource,
        osrm: "raw",
      },
    }));
    try {
      const result = await api.osrmRaw(url);
      set((state) => ({
        osrmRawState: { status: "done", result, error: null },
        ...applyRawRoutes(state, result),
      }));
    } catch (err) {
      set({
        osrmRawState: {
          status: "error",
          result: null,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  },

  sendValhallaRaw: async (url, body) => {
    set((state) => ({
      valhallaRawState: { status: "loading", result: null, error: null },
      latestResponseSource: {
        ...state.latestResponseSource,
        valhalla: "raw",
      },
    }));
    try {
      const result = await api.valhallaRaw(url, body);
      set((state) => ({
        valhallaRawState: { status: "done", result, error: null },
        ...applyRawRoutes(state, result),
      }));
    } catch (err) {
      set({
        valhallaRawState: {
          status: "error",
          result: null,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  },

  sendCurlImport: async (curl) => {
    set({
      curlImportState: {
        status: "loading",
        engine: null,
        result: null,
        error: null,
      },
    });
    try {
      // The frontend only POSTs the raw string; the backend parses (shlex,
      // never a shell) and enforces the host allowlist.
      const { engine, result } = await api.curlImport(curl);
      set((state) => ({
        curlImportState: { status: "done", engine, result, error: null },
        // Surface the imported routes via the SAME render pipeline as raw sends.
        ...applyRawRoutes(state, result),
      }));
    } catch (err) {
      // Isolation: only the curl-import slice is touched on failure.
      set({
        curlImportState: {
          status: "error",
          engine: null,
          result: null,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  },

  // Single selection funnel (design: all selection paths funnel through
  // `selectRoute`). Idempotent: re-selecting the same id keeps it selected;
  // clearing is only via `clearSelection()` (or passing null explicitly).
  selectRoute: (routeId) => set({ selectedRouteId: routeId }),

  clearSelection: () => set({ selectedRouteId: null }),

  setRouteAnalysisRouteId: (routeId) =>
    set((state) => ({
      routeAnalysisRouteId: routeId,
      routeAnalysisFocusedSegmentId: null,
      routeAnalysisExecutedSearch:
        state.routeAnalysisRouteId === routeId
          ? state.routeAnalysisExecutedSearch
          : null,
    })),

  setRouteAnalysisMetricId: (metricId) =>
    set({ routeAnalysisMetricId: metricId }),

  setRouteAnalysisQuery: (query) =>
    set((state) => {
      const current = state.routeAnalysisQuery;
      const changed =
        current.field !== query.field ||
        current.operator !== query.operator ||
        current.value !== query.value;
      return {
        routeAnalysisQuery: query,
        routeAnalysisExecutedSearch: changed
          ? null
          : state.routeAnalysisExecutedSearch,
      };
    }),

  setRouteAnalysisExecutedSearch: (search) =>
    set({ routeAnalysisExecutedSearch: search }),

  clearRouteAnalysisSearch: () =>
    set({ routeAnalysisExecutedSearch: null }),

  setRouteAnalysisFocusedSegmentId: (id) => {
    if (get().routeAnalysisFocusedSegmentId === id) return;
    set({ routeAnalysisFocusedSegmentId: id });
  },

  requestFit: () => set((state) => ({ fitRequestId: state.fitRequestId + 1 })),

  toggleLeftCollapsed: () =>
    set((state) => {
      const next = { ...state, leftCollapsed: !state.leftCollapsed };
      persistLayout(next);
      return { leftCollapsed: next.leftCollapsed };
    }),

  toggleRightCollapsed: () =>
    set((state) => {
      const next = { ...state, rightCollapsed: !state.rightCollapsed };
      persistLayout(next);
      return { rightCollapsed: next.rightCollapsed };
    }),

  toggleBottomCollapsed: () =>
    set((state) => {
      const next = { ...state, bottomCollapsed: !state.bottomCollapsed };
      persistLayout(next);
      return { bottomCollapsed: next.bottomCollapsed };
    }),

  setRouteComparisonPanelHeight: (height) =>
    set({ routeComparisonPanelHeight: height }),

  focusMap: () =>
    set((state) => {
      if (!state.mapFocused) {
        // Enter focused mode: snapshot the current states, collapse all three.
        const snapshot = {
          leftCollapsed: state.leftCollapsed,
          rightCollapsed: state.rightCollapsed,
          bottomCollapsed: state.bottomCollapsed,
        };
        const next = {
          leftCollapsed: true,
          rightCollapsed: true,
          bottomCollapsed: true,
          mapFocused: true,
          layoutSnapshot: snapshot,
        };
        persistLayout({ ...state, ...next });
        return next;
      }
      // Exit focused mode: restore the exact prior states from the snapshot.
      const snap = state.layoutSnapshot ?? {
        leftCollapsed: false,
        rightCollapsed: false,
        bottomCollapsed: false,
      };
      const next = {
        leftCollapsed: snap.leftCollapsed,
        rightCollapsed: snap.rightCollapsed,
        bottomCollapsed: snap.bottomCollapsed,
        mapFocused: false,
        layoutSnapshot: null,
      };
      persistLayout({ ...state, ...next });
      return next;
    }),

  saveTestCase: (name) => {
    const { start, dest, testCases } = get();
    // Require both valid coordinates (a component-level guard also disables the
    // button, but guard here too so the action is safe to call directly).
    if (!start || !dest) return false;
    const id = newTestCaseId();
    const trimmed = name?.trim();
    const finalName =
      trimmed && trimmed !== ""
        ? trimmed
        : defaultTestCaseName(testCases.length + 1);
    const testCase: TestCase = { id, name: finalName, start, dest };
    const next = [...testCases, testCase];
    set({ testCases: next, currentTestCaseId: id });
    saveTestCases(next);
    return true;
  },

  loadTestCase: (id) => {
    const tc = get().testCases.find((t) => t.id === id);
    if (!tc) return;
    // Restore coordinates and mark this testcase as current. LOAD != RUN
    // (Req 13.5): we deliberately DO NOT call runCompare / api.compare here.
    // Request previews regenerate from start/dest automatically.
    set({ start: tc.start, dest: tc.dest, currentTestCaseId: id });
    // Fit the map to the restored markers (Req 13.4 "may fit").
    get().requestFit();
  },

  renameTestCase: (id, name) => {
    const next = get().testCases.map((t) =>
      t.id === id ? { ...t, name } : t,
    );
    set({ testCases: next });
    saveTestCases(next);
  },

  deleteTestCase: (id) => {
    const state = get();
    const next = state.testCases.filter((t) => t.id !== id);
    // Also drop the deleted testcase's assessment namespace (Req 13).
    const nextAssessments = deleteAssessmentsFor(id, state.assessments);
    set({
      testCases: next,
      assessments: nextAssessments,
      currentTestCaseId:
        state.currentTestCaseId === id ? null : state.currentTestCaseId,
    });
    saveTestCases(next);
    saveAssessments(nextAssessments);
  },

  setTestCaseNotes: (id, notes) => {
    const next = get().testCases.map((t) =>
      t.id === id ? { ...t, notes } : t,
    );
    set({ testCases: next });
    saveTestCases(next);
  },

  setRating: (key, rating) => {
    updateAssessment(set, get, key, (prev) => {
      const notes = prev?.notes;
      if (rating === null) {
        // Clear rating → Unrated. Keep any notes as a notes-only entry;
        // otherwise remove the entry (Unrated == absence of an entry).
        return notes && notes.trim() !== ""
          ? ({ notes } as StoredAssessment)
          : undefined;
      }
      return notes && notes.trim() !== ""
        ? ({ rating, notes } as StoredAssessment)
        : ({ rating } as StoredAssessment);
    });
  },

  setAssessmentNotes: (key, notes) => {
    updateAssessment(set, get, key, (prev) => {
      const hasNotes = notes != null && notes.trim() !== "";
      const rating = prev?.rating;
      if (!hasNotes) {
        // Removing notes: keep a rating-only entry, else drop it entirely.
        return rating ? ({ rating } as StoredAssessment) : undefined;
      }
      return rating
        ? ({ rating, notes } as StoredAssessment)
        : ({ notes } as StoredAssessment);
    });
  },

  getAssessment: (key) => {
    const state = get();
    const map = state.currentTestCaseId
      ? state.assessments[state.currentTestCaseId]
      : state.sessionAssessments;
    return map ? map[key] : undefined;
  },

  setVisibility: (routeId, visible) =>
    set((state) => ({
      visibility: { ...state.visibility, [routeId]: visible },
    })),

  showAll: () =>
    set((state) => ({ visibility: buildVisibility(state.routes, () => true) })),

  hideAll: () =>
    set((state) => ({ visibility: buildVisibility(state.routes, () => false) })),

  osrmOnly: () =>
    set((state) => ({
      visibility: buildVisibility(state.routes, (r) => r.engine === "osrm"),
    })),

  valhallaOnly: () =>
    set((state) => ({
      visibility: buildVisibility(state.routes, (r) => r.engine === "valhalla"),
    })),

  primaryOnly: () =>
    set((state) => ({
      visibility: buildVisibility(state.routes, (r) => r.isPrimary),
    })),

  alternativesOnly: () =>
    set((state) => ({
      visibility: buildVisibility(state.routes, (r) => !r.isPrimary),
    })),

  refreshHealth: async () => {
    const health = await api.health();
    set({ health });
  },
}));

// Dev/diagnostic hook: expose the store on `window.__store` so a headless
// browser (or preview-time tooling) can inspect and drive live app state.
// Guarded on `typeof window` so unit tests / SSR don't crash, and on DEV /
// VITE_EXPOSE_MAP so it never ships in a production build unless opted in.
if (
  typeof window !== "undefined" &&
  (import.meta.env.DEV || import.meta.env.VITE_EXPOSE_MAP === "1")
) {
  (window as unknown as { __store?: unknown }).__store = useStore;
}

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
  deleteAssessmentsFor,
  loadAssessments,
  loadTestCases,
  saveAssessments,
  saveTestCases,
} from "./persistence";
import type {
  CompareResponse,
  Coordinate,
  Engine,
  EngineHealth,
  EngineResult,
  NormalizedRoute,
  RouteQuality,
  TestCase,
} from "./types";

export type AppMode = "normal" | "advanced";
export type MapClickTarget = "start" | "dest" | null;
export type CompareStatus = "idle" | "loading" | "done" | "error";
export type RawStatus = "idle" | "loading" | "done" | "error";

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
  osrmUrlDraft: string;
  valhallaUrlDraft: string;
  valhallaBodyDraft: string;

  // Results (Req 2, 12)
  results: CompareResponse | null;
  routes: NormalizedRoute[];

  // Advanced/raw request results (Req 9.4–9.7). Isolated from Normal-mode
  // `results` / `compareStatus` so a raw send never affects a Normal Compare
  // (Req 17.13). Named `*State` to avoid colliding with the api functions.
  osrmRawState: RawRequestState;
  valhallaRawState: RawRequestState;

  // Curl-import results (Req 10). Isolated from Normal-mode Compare and from the
  // raw-request slices so an import failure never affects them (error
  // isolation). Only ONE import result is tracked at a time (the last executed);
  // the component routes it to the correct paste area locally.
  curlImportState: CurlImportState;

  // View state (Req 5, 6)
  visibility: Record<string, boolean>;
  selectedRouteId: string | null;

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

  // --- Actions ---
  setStart: (c: Coordinate | null) => void;
  setDest: (c: Coordinate | null) => void;
  setMapClickTarget: (t: MapClickTarget) => void;
  setMode: (m: AppMode) => void;
  setOsrmUrlDraft: (url: string) => void;
  setValhallaUrlDraft: (url: string) => void;
  setValhallaBodyDraft: (body: string) => void;

  runCompare: () => Promise<void>;

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

  /** Request a manual map fit (Req 20.2); MapView reacts to `fitRequestId`. */
  requestFit: () => void;

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
): Pick<AppState, "routes" | "visibility" | "selectedRouteId"> {
  const routes = result.normalizedRoutes;
  const visibility = buildVisibility(routes, () => true);
  const prevSelected = state.selectedRouteId;
  const selectedRouteId =
    prevSelected && routes.some((r) => r.id === prevSelected)
      ? prevSelected
      : null;
  return { routes, visibility, selectedRouteId };
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
  osrmUrlDraft: "",
  valhallaUrlDraft: "",
  valhallaBodyDraft: "",

  results: null,
  routes: [],

  osrmRawState: IDLE_RAW,
  valhallaRawState: IDLE_RAW,

  curlImportState: IDLE_CURL_IMPORT,

  visibility: {},
  selectedRouteId: null,

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

  setStart: (c) => set({ start: c }),
  setDest: (c) => set({ dest: c }),
  setMapClickTarget: (t) => set({ mapClickTarget: t }),
  setMode: (m) => set({ mode: m }),
  setOsrmUrlDraft: (url) => set({ osrmUrlDraft: url }),
  setValhallaUrlDraft: (url) => set({ valhallaUrlDraft: url }),
  setValhallaBodyDraft: (body) => set({ valhallaBodyDraft: body }),

  runCompare: async () => {
    const { start, dest } = get();
    if (!start || !dest) {
      set({
        compareStatus: "error",
        lastError: "Both start and destination coordinates are required.",
      });
      return;
    }
    set({ compareStatus: "loading", lastError: null });
    try {
      const results = await api.compare(start, dest);
      const routes = flattenRoutes(results);
      // Initialize visibility to all-visible for the returned routes only.
      const visibility = buildVisibility(routes, () => true);
      // Keep the current selection only if it is still present.
      const prevSelected = get().selectedRouteId;
      const selectedRouteId =
        prevSelected && routes.some((r) => r.id === prevSelected)
          ? prevSelected
          : null;
      set({
        results,
        routes,
        visibility,
        selectedRouteId,
        compareStatus: "done",
        lastError: null,
      });
    } catch (err) {
      set({
        compareStatus: "error",
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  sendOsrmRaw: async (url) => {
    set({ osrmRawState: { status: "loading", result: null, error: null } });
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
    set({ valhallaRawState: { status: "loading", result: null, error: null } });
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

  requestFit: () => set((state) => ({ fitRequestId: state.fitRequestId + 1 })),

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

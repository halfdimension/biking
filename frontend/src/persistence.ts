/**
 * localStorage persistence for saved test cases and their route-quality
 * assessments (Req 13, 14).
 *
 * This module is the ONLY place that touches localStorage for these features,
 * so the storage schema lives in one spot. It is deliberately minimal: only the
 * `TestCase` shape (id, name, start, dest, notes?) is persisted — never raw
 * engine responses, decoded geometry, health, or transient loading state.
 *
 * Two independent namespaces are kept:
 *   - TESTCASES_KEY: `TestCase[]`
 *   - ASSESSMENTS_KEY: `Record<testCaseId, Record<stableRouteAssessmentKey, RouteQuality>>`
 *
 * The assessments inner key is a DETERMINISTIC geometry-based key
 * (`routeAssessmentKey`, see `assessmentKey.ts`) — NOT the index-based
 * `route.id`. Index-based keys are unsafe because alternate ordering can change
 * between engine reruns, which would re-attach a saved rating to the wrong
 * geometry. The key was bumped to v2 for this fix; the old v1 (index-keyed)
 * payload is deliberately NOT read or migrated (migrating index keys could
 * misattach ratings) — it is simply left untouched and ignored (Req 14).
 *
 * Task 26 implemented the testcase read/write plus the assessment namespace
 * SCHEMA + safe read/write helpers and a `deleteAssessmentsFor` helper so
 * deleting a testcase can also drop its associated assessments (Req 13). Task
 * 27 populated the assessments namespace with actual ratings/notes keyed by the
 * stable geometry key.
 *
 * All reads are defensive: corrupt / malformed / mis-shaped storage never
 * throws — it degrades to an empty value. All writes swallow quota/serialization
 * errors (logging a warning) so a failed persist never crashes the app.
 */

import type { Coordinate, RouteQuality, TestCase } from "./types";

/** localStorage key for the saved test cases (`TestCase[]`). */
export const TESTCASES_KEY = "biking.testCases.v1";

/**
 * localStorage key for route-quality assessments, namespaced by testcase id:
 * `Record<testCaseId, Record<stableRouteAssessmentKey, RouteQuality>>` where the
 * inner key is a deterministic GEOMETRY key (`routeAssessmentKey`, e.g.
 * "valhalla:1a2b3c4d"), NOT the index-based `route.id`.
 *
 * Bumped to v2 for the geometry-key correctness fix. The old v1 index-keyed
 * payload is intentionally NOT read or migrated (that could misattach ratings
 * to the wrong route after an alternate reorder) — it is left untouched.
 */
export const ASSESSMENTS_KEY = "biking.assessments.v2";

/**
 * Shape of the assessments map persisted under ASSESSMENTS_KEY.
 * Outer key = testcase id; inner key = deterministic geometry key
 * (`routeAssessmentKey`), NOT the index-based route id.
 */
export type AssessmentsMap = Record<string, Record<string, RouteQuality>>;

/**
 * Return the available Storage (jsdom provides one in tests), or null when it
 * is unavailable (SSR, disabled storage). Reading `globalThis.localStorage`
 * behind a try/catch avoids throwing in restricted environments.
 */
function getStorage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/** True when `v` is a finite number. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Validate a value as a `Coordinate` with finite numeric lat/lon. */
function isCoordinate(v: unknown): v is Coordinate {
  if (typeof v !== "object" || v === null) return false;
  const c = v as { lat?: unknown; lon?: unknown };
  return isFiniteNumber(c.lat) && isFiniteNumber(c.lon);
}

/**
 * Validate a value as a `TestCase`: string id, string name, valid start/dest
 * coordinates, and (if present) a string `notes`.
 */
function isTestCase(v: unknown): v is TestCase {
  if (typeof v !== "object" || v === null) return false;
  const t = v as {
    id?: unknown;
    name?: unknown;
    start?: unknown;
    dest?: unknown;
    notes?: unknown;
  };
  if (typeof t.id !== "string" || t.id === "") return false;
  if (typeof t.name !== "string") return false;
  if (!isCoordinate(t.start) || !isCoordinate(t.dest)) return false;
  if (t.notes !== undefined && typeof t.notes !== "string") return false;
  return true;
}

/**
 * Read and validate the saved test cases from localStorage (Req 13.3).
 *
 * Never throws: on missing storage, a JSON parse error, a non-array payload, or
 * any other problem, returns `[]`. Invalid entries within a valid array are
 * dropped, keeping only well-shaped `TestCase` values so corrupt storage can
 * never crash the app or inject malformed coordinates into an engine request.
 */
export function loadTestCases(): TestCase[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(TESTCASES_KEY);
    if (raw == null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTestCase);
  } catch {
    return [];
  }
}

/**
 * Persist the saved test cases to localStorage (Req 13.3). Only the minimal
 * `TestCase` shape is written. Quota/serialization errors are swallowed (logged
 * as a warning) so a failed write never throws.
 */
export function saveTestCases(list: TestCase[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(TESTCASES_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn("Failed to persist test cases to localStorage.", err);
  }
}

/**
 * Read the route-quality assessments map from localStorage (Req 14.3).
 * Namespaced by testcase id. Never throws: returns `{}` on missing storage, a
 * parse error, or a non-object payload. (Schema only for Task 26 — Task 27
 * populates and reads per-route ratings.)
 */
export function loadAssessments(): AssessmentsMap {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(ASSESSMENTS_KEY);
    if (raw == null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as AssessmentsMap;
  } catch {
    return {};
  }
}

/**
 * Persist the assessments map to localStorage (Req 14.3). Quota/serialization
 * errors are swallowed (logged as a warning) so a failed write never throws.
 */
export function saveAssessments(map: AssessmentsMap): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(ASSESSMENTS_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn("Failed to persist assessments to localStorage.", err);
  }
}

/**
 * Return a COPY of `map` without the given testcase's assessment namespace
 * (pure — the caller persists the result). Used by the testcase delete flow so
 * removing a testcase also removes all assessment data associated specifically
 * with that testcase (Req 13). Returns the input unchanged when the id is
 * absent.
 */
export function deleteAssessmentsFor(
  testCaseId: string,
  map: AssessmentsMap,
): AssessmentsMap {
  if (!(testCaseId in map)) return map;
  const next: AssessmentsMap = { ...map };
  delete next[testCaseId];
  return next;
}

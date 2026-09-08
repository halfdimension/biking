/**
 * Unit tests for the deterministic geometry-based assessment key (Req 14).
 *
 * These verify the CORRECTNESS FIX to persisted route-quality assessments:
 * persistence must be keyed by a route's geometry, NOT its index-based
 * `route.id`, so a saved rating follows the geometry across engine reruns even
 * when alternate ordering changes.
 *
 * The tests split into two groups:
 *   1. `routeAssessmentKey` / `geometryFingerprint` pure-function properties.
 *   2. End-to-end store scenarios (A–F) proving ratings track geometry, engines
 *      and testcases stay isolated, and no full geometry/raw is persisted.
 *
 * All routes are MOCKED; no engine calls are made.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { geometryFingerprint, routeAssessmentKey } from "./assessmentKey";
import { useStore } from "./store";
import { ASSESSMENTS_KEY, loadAssessments } from "./persistence";
import type { Engine, NormalizedRoute } from "./types";

// Distinct mock geometries. A/B/C are materially different; A2 is A with
// sub-micro floating noise (must fingerprint identically to A).
const GEOM_A: [number, number][] = [
  [77.6, 12.9],
  [77.61, 12.91],
  [77.62, 12.92],
];
const GEOM_B: [number, number][] = [
  [77.7, 13.0],
  [77.71, 13.01],
];
const GEOM_C: [number, number][] = [
  [78.5, 11.5],
  [78.51, 11.51],
  [78.52, 11.52],
  [78.53, 11.53],
];
const GEOM_A_NOISE: [number, number][] = [
  [77.6000001, 12.8999999],
  [77.6099998, 12.9100002],
  [77.62, 12.92],
];

function route(
  engine: Engine,
  index: number,
  coordinates: [number, number][],
): NormalizedRoute {
  return {
    id: `${engine}:${index}`,
    engine,
    index,
    isPrimary: index === 0,
    label: `${engine} ${index}`,
    coordinates,
    distanceMeters: 1000,
    durationSeconds: 300,
    cost: 50,
    raw: { some: "engine payload", coordinates: "encodedpolyline" },
  };
}

describe("geometryFingerprint / routeAssessmentKey (pure)", () => {
  it("is deterministic: same geometry → same key", () => {
    const a1 = routeAssessmentKey(route("osrm", 0, GEOM_A));
    const a2 = routeAssessmentKey(route("osrm", 3, GEOM_A));
    expect(a1).toBe(a2);
  });

  it("is engine-prefixed: identical geometry, different engine → different key", () => {
    const osrm = routeAssessmentKey(route("osrm", 0, GEOM_A));
    const valhalla = routeAssessmentKey(route("valhalla", 0, GEOM_A));
    expect(osrm.startsWith("osrm:")).toBe(true);
    expect(valhalla.startsWith("valhalla:")).toBe(true);
    expect(osrm).not.toBe(valhalla);
    // Same engine, same geometry, both keys equal; only engine prefix differs.
    expect(osrm.split(":")[1]).toBe(valhalla.split(":")[1]);
  });

  it("different geometries → different keys", () => {
    expect(geometryFingerprint(GEOM_A)).not.toBe(geometryFingerprint(GEOM_B));
    expect(geometryFingerprint(GEOM_A)).not.toBe(geometryFingerprint(GEOM_C));
    expect(geometryFingerprint(GEOM_B)).not.toBe(geometryFingerprint(GEOM_C));
  });

  it("is order-sensitive: a reversed route is a different route", () => {
    const forward = geometryFingerprint(GEOM_A);
    const reversed = geometryFingerprint([...GEOM_A].reverse());
    expect(forward).not.toBe(reversed);
  });

  it("is robust to sub-precision floating noise (rounded to 6 decimals)", () => {
    expect(geometryFingerprint(GEOM_A)).toBe(geometryFingerprint(GEOM_A_NOISE));
  });

  it("handles empty coordinates deterministically without throwing", () => {
    expect(() => geometryFingerprint([])).not.toThrow();
    expect(geometryFingerprint([])).toBe(geometryFingerprint([]));
    // Format is 8 hex chars.
    expect(geometryFingerprint([])).toMatch(/^[0-9a-f]{8}$/);
    // A key is engine + 8-char hex.
    expect(routeAssessmentKey(route("osrm", 0, []))).toMatch(
      /^osrm:[0-9a-f]{8}$/,
    );
  });

  it("tolerates malformed coordinate pairs without throwing", () => {
    const bad: [number, number][] = [
      [77.6, 12.9],
      // deliberately malformed at runtime
      undefined as unknown as [number, number],
      [Number.NaN, Number.POSITIVE_INFINITY],
    ];
    expect(() => geometryFingerprint(bad)).not.toThrow();
    expect(geometryFingerprint(bad)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("store persistence keyed by geometry (Req 14 correctness fix)", () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      assessments: {},
      sessionAssessments: {},
      currentTestCaseId: null,
    });
  });

  // Rate a route by computing its geometry key exactly like the component does.
  const rate = (
    r: NormalizedRoute,
    rating: "good" | "bad" | "neutral" | null,
  ) => useStore.getState().setRating(routeAssessmentKey(r), rating);
  const read = (r: NormalizedRoute) =>
    useStore.getState().getAssessment(routeAssessmentKey(r));

  it("A. Alternate reorder: rating tracks geometry, not index", () => {
    useStore.setState({ currentTestCaseId: "tc-A" });

    // Run 1: valhalla index1 = GEOM_A, index2 = GEOM_B. Rate GEOM_A Bad.
    const run1Idx1 = route("valhalla", 1, GEOM_A);
    const run1Idx2 = route("valhalla", 2, GEOM_B);
    rate(run1Idx1, "bad");

    // Run 2: the alternates swap index — index1 = GEOM_B, index2 = GEOM_A.
    const run2Idx1 = route("valhalla", 1, GEOM_B);
    const run2Idx2 = route("valhalla", 2, GEOM_A);

    // GEOM_A (now at index2) is still Bad; GEOM_B (now at index1) did NOT
    // inherit the rating.
    expect(read(run2Idx2)).toEqual({ rating: "bad" });
    expect(read(run2Idx1)).toBeUndefined();
    // Sanity: the run-1 GEOM_B route is also still Unrated.
    expect(read(run1Idx2)).toBeUndefined();
  });

  it("B. Replacement: a different geometry at the same index reads Unrated", () => {
    useStore.setState({ currentTestCaseId: "tc-A" });

    // Run 1: osrm index1 = GEOM_A rated Good.
    rate(route("osrm", 1, GEOM_A), "good");

    // Run 2: osrm index1 = an entirely different GEOM_C.
    expect(read(route("osrm", 1, GEOM_C))).toBeUndefined();
    // The original geometry, if it reappears, still restores.
    expect(read(route("osrm", 5, GEOM_A))).toEqual({ rating: "good" });
  });

  it("C. Same geometry under a different alternate index → assessment restored", () => {
    useStore.setState({ currentTestCaseId: "tc-A" });
    rate(route("osrm", 2, GEOM_A), "neutral");
    // Same geometry appears at a different index later.
    expect(read(route("osrm", 0, GEOM_A))).toEqual({ rating: "neutral" });
  });

  it("D. Engine isolation: identical geometry from OSRM and Valhalla is independent", () => {
    useStore.setState({ currentTestCaseId: "tc-A" });
    rate(route("osrm", 0, GEOM_A), "good");
    rate(route("valhalla", 0, GEOM_A), "bad");

    expect(read(route("osrm", 0, GEOM_A))).toEqual({ rating: "good" });
    expect(read(route("valhalla", 0, GEOM_A))).toEqual({ rating: "bad" });
  });

  it("E. Testcase isolation: same geometry in testcase A vs B is independent", () => {
    const r = route("osrm", 0, GEOM_A);

    useStore.setState({ currentTestCaseId: "tc-A" });
    rate(r, "good");

    // Testcase B: same geometry reads as Unrated.
    useStore.setState({ currentTestCaseId: "tc-B" });
    expect(read(r)).toBeUndefined();
    rate(r, "bad");
    expect(read(r)).toEqual({ rating: "bad" });

    // Back to A: original rating intact, never leaked into B and vice-versa.
    useStore.setState({ currentTestCaseId: "tc-A" });
    expect(read(r)).toEqual({ rating: "good" });
  });

  it("F. persisted payload holds only fingerprint keys + rating/notes — no geometry/raw", () => {
    useStore.setState({ currentTestCaseId: "tc-A" });
    const r = route("valhalla", 1, GEOM_A);
    rate(r, "bad");
    useStore.getState().setAssessmentNotes(routeAssessmentKey(r), "steep hill");

    const serialized = localStorage.getItem(ASSESSMENTS_KEY) ?? "";
    expect(serialized).not.toBe("");
    // No coordinate arrays / raw response leaked into storage.
    expect(serialized).not.toContain("coordinates");
    expect(serialized).not.toContain("raw");
    expect(serialized).not.toContain("77.6");
    expect(serialized).not.toContain("engine payload");

    // The stored inner key is the compact geometry key; the value is just the
    // rating/notes.
    const stored = loadAssessments();
    const key = routeAssessmentKey(r);
    expect(stored["tc-A"][key]).toEqual({ rating: "bad", notes: "steep hill" });
    expect(key).toMatch(/^valhalla:[0-9a-f]{8}$/);
  });
});

// Uses the new v2 storage key and never reads/migrates any legacy v1 payload.
describe("storage versioning (v2, no v1 migration)", () => {
  beforeEach(() => localStorage.clear());

  it("ASSESSMENTS_KEY is the v2 key", () => {
    expect(ASSESSMENTS_KEY).toBe("biking.assessments.v2");
  });

  it("ignores a legacy v1 index-keyed payload (never migrated)", () => {
    localStorage.setItem(
      "biking.assessments.v1",
      JSON.stringify({ "tc-A": { "osrm:0": { rating: "good" } } }),
    );
    // loadAssessments reads only v2, so the v1 data is invisible.
    expect(loadAssessments()).toEqual({});
  });
});

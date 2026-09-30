/**
 * Unit tests for the localStorage persistence layer (Task 26.1, Req 13).
 *
 * jsdom provides a real `localStorage`, so these tests exercise the actual
 * read/write path. They assert that:
 *   - loadTestCases returns [] on missing/corrupt/mis-shaped data,
 *   - a valid+invalid mix keeps ONLY the valid entries,
 *   - save then load round-trips,
 *   - loadAssessments returns {} on corrupt data,
 *   - deleteAssessmentsFor returns a map without the given id (purely).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  ASSESSMENTS_KEY,
  TESTCASES_KEY,
  deleteAssessmentsFor,
  loadAssessments,
  loadTestCases,
  saveTestCases,
  type AssessmentsMap,
} from "./persistence";
import type { TestCase } from "./types";

const validTestCase = (id: string, name: string): TestCase => ({
  id,
  name,
  start: { lat: 28.78, lon: 76.87 },
  dest: { lat: 28.2, lon: 77.45 },
});

beforeEach(() => {
  localStorage.clear();
});

describe("loadTestCases", () => {
  it("returns [] when nothing is stored", () => {
    expect(loadTestCases()).toEqual([]);
  });

  it("returns [] on corrupt (non-JSON) storage", () => {
    localStorage.setItem(TESTCASES_KEY, "{not json");
    expect(loadTestCases()).toEqual([]);
  });

  it("returns [] when the stored payload is not an array", () => {
    localStorage.setItem(TESTCASES_KEY, JSON.stringify({ foo: "bar" }));
    expect(loadTestCases()).toEqual([]);
  });

  it("keeps only valid entries in a valid+invalid mix", () => {
    const good = validTestCase("a", "Good");
    const mix = [
      good,
      { id: 1, name: "numeric id", start: {}, dest: {} }, // bad id type
      { id: "b", name: "missing coords" }, // no start/dest
      {
        id: "c",
        name: "bad coord",
        start: { lat: "x", lon: 1 },
        dest: { lat: 2, lon: 3 },
      }, // non-numeric lat
      {
        id: "d",
        name: "nan coord",
        start: { lat: NaN, lon: 1 },
        dest: { lat: 2, lon: 3 },
      }, // NaN not finite -> serialized as null anyway
    ];
    localStorage.setItem(TESTCASES_KEY, JSON.stringify(mix));
    expect(loadTestCases()).toEqual([good]);
  });

  it("round-trips a save then load", () => {
    const list = [validTestCase("a", "One"), validTestCase("b", "Two")];
    saveTestCases(list);
    expect(loadTestCases()).toEqual(list);
  });

  it("persists optional notes", () => {
    const tc: TestCase = { ...validTestCase("a", "One"), notes: "hello" };
    saveTestCases([tc]);
    expect(loadTestCases()).toEqual([tc]);
  });
});

describe("loadAssessments", () => {
  it("returns {} when nothing is stored", () => {
    expect(loadAssessments()).toEqual({});
  });

  it("returns {} on corrupt storage", () => {
    localStorage.setItem(ASSESSMENTS_KEY, "@@@not json");
    expect(loadAssessments()).toEqual({});
  });

  it("returns {} when the stored payload is an array (wrong shape)", () => {
    localStorage.setItem(ASSESSMENTS_KEY, JSON.stringify([1, 2, 3]));
    expect(loadAssessments()).toEqual({});
  });
});

describe("deleteAssessmentsFor", () => {
  it("returns a copy without the given testcase id", () => {
    const map: AssessmentsMap = {
      a: { "osrm:0": { rating: "good" } },
      b: { "valhalla:0": { rating: "bad" } },
    };
    const next = deleteAssessmentsFor("a", map);
    expect(next).toEqual({ b: { "valhalla:0": { rating: "bad" } } });
    // Pure: original map is untouched.
    expect(map).toHaveProperty("a");
    expect(next).not.toBe(map);
  });

  it("returns the input unchanged when the id is absent", () => {
    const map: AssessmentsMap = { a: {} };
    expect(deleteAssessmentsFor("missing", map)).toBe(map);
  });
});

/* --------------------------------------------------------------------------
 * Layout UI state persistence (collapsible panels + Focus Map).
 * ------------------------------------------------------------------------ */
describe("layout persistence (loadLayout/saveLayout)", () => {
  it("returns all-expanded defaults when nothing is stored", async () => {
    const { loadLayout, DEFAULT_LAYOUT } = await import("./persistence");
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
    expect(loadLayout()).toEqual({
      leftCollapsed: false,
      rightCollapsed: false,
      bottomCollapsed: false,
      mapFocused: false,
      snapshot: null,
    });
  });

  it("uses its own key, never the testcase/assessment keys", async () => {
    const { LAYOUT_KEY, saveLayout, DEFAULT_LAYOUT } = await import(
      "./persistence"
    );
    expect(LAYOUT_KEY).toBe("biking.layout.v1");
    expect(LAYOUT_KEY).not.toBe(TESTCASES_KEY);
    expect(LAYOUT_KEY).not.toBe(ASSESSMENTS_KEY);

    saveLayout({ ...DEFAULT_LAYOUT, leftCollapsed: true });
    // The layout write must not leak into the testcase/assessment namespaces.
    expect(localStorage.getItem(TESTCASES_KEY)).toBeNull();
    expect(localStorage.getItem(ASSESSMENTS_KEY)).toBeNull();
    expect(localStorage.getItem(LAYOUT_KEY)).not.toBeNull();
  });

  it("round-trips a saved layout including the Focus-Map snapshot", async () => {
    const { saveLayout, loadLayout } = await import("./persistence");
    const state = {
      leftCollapsed: true,
      rightCollapsed: false,
      bottomCollapsed: true,
      mapFocused: true,
      snapshot: {
        leftCollapsed: false,
        rightCollapsed: true,
        bottomCollapsed: false,
      },
    };
    saveLayout(state);
    expect(loadLayout()).toEqual(state);
  });

  it("falls back to all-expanded on corrupt (non-JSON) storage without throwing", async () => {
    const { LAYOUT_KEY, loadLayout, DEFAULT_LAYOUT } = await import(
      "./persistence"
    );
    localStorage.setItem(LAYOUT_KEY, "{not json");
    expect(() => loadLayout()).not.toThrow();
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it("falls back to all-expanded when the payload is not an object", async () => {
    const { LAYOUT_KEY, loadLayout, DEFAULT_LAYOUT } = await import(
      "./persistence"
    );
    localStorage.setItem(LAYOUT_KEY, JSON.stringify([1, 2, 3]));
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it("defaults each malformed field independently (partial payload)", async () => {
    const { LAYOUT_KEY, loadLayout } = await import("./persistence");
    // Only leftCollapsed is a valid boolean; the rest are wrong types/missing.
    localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({ leftCollapsed: true, rightCollapsed: "yes", snapshot: 5 }),
    );
    expect(loadLayout()).toEqual({
      leftCollapsed: true,
      rightCollapsed: false,
      bottomCollapsed: false,
      mapFocused: false,
      snapshot: null,
    });
  });
});

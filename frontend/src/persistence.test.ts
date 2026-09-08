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

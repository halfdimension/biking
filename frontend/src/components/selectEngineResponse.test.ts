import { describe, expect, it } from "vitest";
import type { CompareResponse, EngineResult } from "../types";
import type { RawRequestState } from "../store";
import { selectEngineResponse } from "./selectEngineResponse";

function result(engine: "osrm" | "valhalla", marker: string): EngineResult {
  return {
    engine,
    status: "ok",
    httpStatus: 200,
    durationMs: 1,
    normalizedRoutes: [],
    raw: { marker },
    warnings: [],
    error: null,
  };
}

const compareResults: CompareResponse = {
  osrm: result("osrm", "compare"),
  valhalla: result("valhalla", "compare"),
};
const completedRaw: RawRequestState = {
  status: "done",
  result: result("osrm", "raw"),
  error: null,
};
const idleRaw: RawRequestState = { status: "idle", result: null, error: null };

function state(
  source: "compare" | "raw",
  osrmRawState: RawRequestState = completedRaw,
  compareStatus: "idle" | "loading" | "done" | "error" = "done",
  results: CompareResponse | null = compareResults,
) {
  return {
    results,
    osrmRawState,
    valhallaRawState: idleRaw,
    compareStatus,
    latestResponseSource: { osrm: source, valhalla: null },
  } as const;
}

describe("selectEngineResponse latest-response provenance", () => {
  it("shows Raw after Compare → Raw", () => {
    const selected = selectEngineResponse(state("raw"), "osrm");
    expect(selected.source).toBe("raw");
    expect(selected.raw).toEqual({ marker: "raw" });
  });

  it("shows Compare after Raw → Compare", () => {
    const selected = selectEngineResponse(state("compare"), "osrm");
    expect(selected.source).toBe("compare");
    expect(selected.raw).toEqual({ marker: "compare" });
  });

  it("shows Compare loading over an old Raw result", () => {
    const selected = selectEngineResponse(state("compare", completedRaw, "loading"), "osrm");
    expect(selected).toMatchObject({ source: "compare", status: "loading" });
  });

  it("shows Raw loading over an old Compare result", () => {
    const loadingRaw: RawRequestState = {
      status: "loading",
      result: null,
      error: null,
    };
    const selected = selectEngineResponse(state("raw", loadingRaw), "osrm");
    expect(selected).toMatchObject({ source: "raw", status: "loading" });
  });

  it("shows the newest Raw transport failure after Compare", () => {
    const failedRaw: RawRequestState = {
      status: "error",
      result: null,
      error: "connection refused",
    };
    const selected = selectEngineResponse(state("raw", failedRaw), "osrm");
    expect(selected).toMatchObject({
      source: "raw",
      status: "error",
      rawStateError: "connection refused",
    });
  });

  it("switches back to a later successful Compare", () => {
    const selected = selectEngineResponse(state("compare", {
      status: "error",
      result: null,
      error: "old raw failure",
    }), "osrm");
    expect(selected.source).toBe("compare");
    expect(selected.raw).toEqual({ marker: "compare" });
  });
});

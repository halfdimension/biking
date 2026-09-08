/**
 * Unit tests for the pure engine-error message mapping (Task 28.1,
 * Req 17.1, 17.2, 17.3, 17.12).
 *
 * These assert the exact actionable text per `EngineError.kind`, that the
 * engine label is present, that http_error includes the status code + a
 * concise backend message (and degrades gracefully when httpStatus is null),
 * and that no stack trace / "Failed to fetch" ever leaks through.
 */
import { describe, it, expect } from "vitest";
import {
  engineErrorMessage,
  engineResultMessage,
  engineDisplayName,
} from "./engineError";
import type { Engine, EngineError, EngineResult } from "./types";

function err(kind: EngineError["kind"], message = ""): EngineError {
  return { kind, message };
}

function errorResult(
  engine: Engine,
  error: EngineError,
  httpStatus: number | null = null,
): EngineResult {
  return {
    engine,
    status: "error",
    httpStatus,
    durationMs: 3,
    normalizedRoutes: [],
    raw: null,
    warnings: [],
    error,
  };
}

describe("engineDisplayName", () => {
  it("names each engine", () => {
    expect(engineDisplayName("osrm")).toBe("OSRM");
    expect(engineDisplayName("valhalla")).toBe("Valhalla");
  });
});

describe("engineErrorMessage — per kind", () => {
  it("unreachable includes the engine-specific host", () => {
    expect(engineErrorMessage("osrm", err("unreachable"))).toBe(
      "OSRM is unreachable at localhost:5000.",
    );
    expect(engineErrorMessage("valhalla", err("unreachable"))).toBe(
      "Valhalla is unreachable at localhost:8002.",
    );
  });

  it("timeout is engine-specific (Req 17.12)", () => {
    expect(engineErrorMessage("osrm", err("timeout"))).toBe(
      "OSRM request timed out.",
    );
    expect(engineErrorMessage("valhalla", err("timeout"))).toBe(
      "Valhalla request timed out.",
    );
  });

  it("no_route is a per-engine no-route message", () => {
    expect(engineErrorMessage("osrm", err("no_route"))).toBe(
      "OSRM returned no route for these coordinates.",
    );
  });

  it("invalid_request reads as a rejected request", () => {
    expect(engineErrorMessage("valhalla", err("invalid_request"))).toBe(
      "Valhalla rejected the request.",
    );
  });

  it("invalid_response is actionable", () => {
    expect(engineErrorMessage("osrm", err("invalid_response"))).toBe(
      "OSRM returned an invalid response.",
    );
  });

  it("http_error includes the status code and a concise backend message", () => {
    const msg = engineErrorMessage(
      "osrm",
      err("http_error", "Internal Server Error"),
      500,
    );
    expect(msg).toBe("OSRM returned HTTP 500: Internal Server Error");
    expect(msg).toContain("500");
    expect(msg).toContain("OSRM");
    expect(msg).not.toMatch(/\bat .+:\d+/); // no stack-trace frames
  });

  it("http_error with null httpStatus never renders 'HTTP null'", () => {
    const msg = engineErrorMessage("valhalla", err("http_error", ""), null);
    expect(msg).not.toMatch(/HTTP null/);
    expect(msg).toBe("Valhalla returned an HTTP error.");
  });

  it("http_error drops a non-concise / 'Failed to fetch' backend message", () => {
    const failed = engineErrorMessage(
      "osrm",
      err("http_error", "TypeError: Failed to fetch"),
      502,
    );
    expect(failed).toBe("OSRM returned HTTP 502.");
    expect(failed).not.toMatch(/Failed to fetch/i);

    const stacky = engineErrorMessage(
      "osrm",
      err("http_error", "Error\n  at foo\n  at bar"),
      500,
    );
    expect(stacky).toBe("OSRM returned HTTP 500.");
    expect(stacky).not.toMatch(/\n/);
  });
});

describe("engineResultMessage — envelope bridge", () => {
  it("returns null for an ok envelope", () => {
    const ok: EngineResult = errorResult("osrm", err("no_route"));
    ok.status = "ok";
    ok.error = null;
    expect(engineResultMessage(ok)).toBeNull();
  });

  it("reads httpStatus from the envelope for http_error", () => {
    const result = errorResult("osrm", err("http_error", "Bad Gateway"), 502);
    expect(engineResultMessage(result)).toBe(
      "OSRM returned HTTP 502: Bad Gateway",
    );
  });

  it("maps unreachable from the envelope", () => {
    const result = errorResult("valhalla", err("unreachable"));
    expect(engineResultMessage(result)).toBe(
      "Valhalla is unreachable at localhost:8002.",
    );
  });
});

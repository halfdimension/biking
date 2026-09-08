/**
 * Pure engine-error message mapping (Task 28.1, Req 17.1, 17.2, 17.3, 17.12).
 *
 * Maps a per-engine {@link EngineResult} envelope (or its {@link EngineError})
 * to a single actionable, human-readable sentence for the UI. The mapping is
 * TOTAL — every `EngineError.kind` produces a sensible message — and it never
 * leaks stack traces, raw `error.detail`, or the generic "Failed to fetch"
 * browser string into the Normal-mode UI.
 *
 * Message policy per kind (engine-specific host is included where useful; the
 * hosts mirror the backend allowlist, OSRM = localhost:5000, Valhalla =
 * localhost:8002 — Req 17.12):
 *   - unreachable  → "<Engine> is unreachable at <host>."
 *   - timeout      → "<Engine> request timed out."
 *   - no_route     → "<Engine> returned no route for these coordinates."
 *   - invalid_request → "<Engine> rejected the request."
 *   - http_error   → "<Engine> returned HTTP <code>[: <message>]." (code omitted
 *                     gracefully when httpStatus is null — never "HTTP null")
 *   - invalid_response → "<Engine> returned an invalid response."
 *
 * The backend-provided `error.message` is appended ONLY for `http_error`, and
 * only when it is concise and useful (non-empty, not the browser's
 * "Failed to fetch", and short enough to be a one-liner). All other kinds use a
 * fixed actionable sentence so the UI stays stable and never dumps internals.
 *
 * This module is intentionally pure (no React, no store) so it is trivially
 * unit-testable and reusable by any presentation layer (Req 12.4 spirit).
 */
import type { Engine, EngineError, EngineResult } from "./types";

/** The allowlisted host for each engine (mirrors backend `ALLOWED_HOSTS`). */
const ENGINE_HOST: Record<Engine, string> = {
  osrm: "localhost:5000",
  valhalla: "localhost:8002",
};

/** Human display name for an engine. */
export function engineDisplayName(engine: Engine): string {
  return engine === "osrm" ? "OSRM" : "Valhalla";
}

/** The generic browser fetch failure we must never surface verbatim. */
const FAILED_TO_FETCH = /failed to fetch/i;

/**
 * Decide whether a backend-provided message is concise/useful enough to append
 * to an `http_error` line. Rejects empty strings, the "Failed to fetch" collapse,
 * and anything that looks multi-line or excessively long (likely a stack trace).
 */
function isConciseBackendMessage(message: string | undefined | null): boolean {
  if (message == null) return false;
  const trimmed = message.trim();
  if (trimmed === "") return false;
  if (FAILED_TO_FETCH.test(trimmed)) return false;
  if (trimmed.includes("\n")) return false;
  // A concise one-liner; guard against dumped stack traces / huge payloads.
  if (trimmed.length > 200) return false;
  return true;
}

/**
 * Map an {@link EngineError} for a given engine to an actionable message.
 * Total over every `kind`; falls through to a generic-but-actionable message
 * for any unrecognized/future kind so the helper never returns an empty string.
 *
 * `httpStatus` is the envelope-level HTTP status (an `EngineError` itself has no
 * status field); it is used only for the `http_error` line and may be `null`,
 * in which case the code is omitted gracefully (never "HTTP null").
 */
export function engineErrorMessage(
  engine: Engine,
  error: EngineError,
  httpStatus: number | null = null,
): string {
  const name = engineDisplayName(engine);
  switch (error.kind) {
    case "unreachable":
      return `${name} is unreachable at ${ENGINE_HOST[engine]}.`;
    case "timeout":
      return `${name} request timed out.`;
    case "no_route":
      return `${name} returned no route for these coordinates.`;
    case "invalid_request":
      return `${name} rejected the request.`;
    case "invalid_response":
      return `${name} returned an invalid response.`;
    case "http_error": {
      // Include the status code only when present (never "HTTP null").
      const codePart =
        httpStatus != null ? ` HTTP ${httpStatus}` : " an HTTP error";
      const base = `${name} returned${codePart}`;
      return isConciseBackendMessage(error.message)
        ? `${base}: ${error.message.trim()}`
        : `${base}.`;
    }
    default:
      // Unknown/future kind: stay actionable, never dump internals.
      return isConciseBackendMessage(error.message)
        ? `${name} error: ${error.message.trim()}`
        : `${name} returned an error.`;
  }
}

/**
 * Map a whole {@link EngineResult} envelope to an actionable message, or `null`
 * when the envelope is not in an error state (`status !== "error"` or no error).
 * This is the primary entry point for the UI: it reads `httpStatus` from the
 * envelope so `http_error` lines include the code.
 */
export function engineResultMessage(result: EngineResult): string | null {
  if (result.status !== "error" || result.error == null) return null;
  return engineErrorMessage(result.engine, result.error, result.httpStatus);
}

/**
 * Selector for the Raw_Response_Inspector (Task 24.1, Req 11.1–11.4).
 *
 * For a given engine's Response tab we must show the MOST RECENT relevant raw
 * response. There are two independent sources in the store:
 *
 *   - Advanced raw: `osrmRawState` / `valhallaRawState` — an isolated slice per
 *     engine that holds the result of a user-sent Advanced/raw request.
 *   - Normal Compare: `results.osrm` / `results.valhalla` — the per-engine
 *     envelope from the last `POST /api/compare`.
 *
 * Rule (simple + deterministic): prefer the Advanced raw result when the user
 * has actually sent a raw request for that engine (its status is "done" or
 * "error"); otherwise fall back to the Normal Compare envelope. This means a
 * fresh raw send takes over that engine's tab, while an untouched raw slice
 * (idle) leaves the Compare result visible.
 */
import type { AppState, RawStatus } from "../store";
import type { Engine, EngineError, EngineResult } from "../types";

/** Where the currently-displayed response for a tab came from. */
export type ResponseSource = "raw" | "compare" | null;

/** What the inspector renders, decoupled from which store slice it came from. */
export interface SelectedEngineResponse {
  source: ResponseSource;
  /** Lifecycle status for loading/error UI. */
  status: RawStatus;
  httpStatus: number | null;
  /** Engine-level error, if any (from EngineResult.error or a raw-state error). */
  error: EngineError | null;
  /** A raw-state transport error message (e.g. network failure before a body). */
  rawStateError: string | null;
  /** The complete, unmodified engine response body (Req 11.1, 11.5, 11.6). */
  raw: unknown;
  /** Per-route normalization warnings (Req 17.11). */
  warnings: EngineResult["warnings"];
  /** The underlying envelope, when one exists. */
  result: EngineResult | null;
}

const EMPTY: SelectedEngineResponse = {
  source: null,
  status: "idle",
  httpStatus: null,
  error: null,
  rawStateError: null,
  raw: undefined,
  warnings: [],
  result: null,
};

function fromResult(
  source: ResponseSource,
  status: RawStatus,
  result: EngineResult,
  rawStateError: string | null,
): SelectedEngineResponse {
  return {
    source,
    status,
    httpStatus: result.httpStatus,
    error: result.error,
    rawStateError,
    raw: result.raw,
    warnings: result.warnings,
    result,
  };
}

/**
 * Resolve the response the given engine's Response tab should render.
 *
 * @param state  The full app state (only the response slices are read).
 * @param engine "osrm" | "valhalla".
 */
export function selectEngineResponse(
  state: Pick<
    AppState,
    "results" | "osrmRawState" | "valhallaRawState" | "compareStatus"
  >,
  engine: Engine,
): SelectedEngineResponse {
  const rawState =
    engine === "osrm" ? state.osrmRawState : state.valhallaRawState;

  // 1) A raw send is in flight: show a loading state for this engine's tab.
  if (rawState.status === "loading") {
    return { ...EMPTY, source: "raw", status: "loading" };
  }

  // 2) The user has sent a raw request that produced an error before a body
  //    (transport failure). Prefer it over any stale Compare result.
  if (rawState.status === "error" && !rawState.result) {
    return {
      ...EMPTY,
      source: "raw",
      status: "error",
      rawStateError: rawState.error,
    };
  }

  // 3) A completed raw send (done, or an error that still carried a body):
  //    prefer it over the Compare result.
  if (rawState.result) {
    const status: RawStatus =
      rawState.result.status === "error" ? "error" : "done";
    return fromResult("raw", status, rawState.result, rawState.error);
  }

  // 4) Fall back to the Normal Compare envelope for this engine.
  const compare = state.results ? state.results[engine] : null;
  if (compare) {
    const status: RawStatus = compare.status === "error" ? "error" : "done";
    return fromResult("compare", status, compare, null);
  }

  // 5) A Compare is in flight and there is no prior result: loading.
  if (state.compareStatus === "loading") {
    return { ...EMPTY, source: "compare", status: "loading" };
  }

  // 6) Nothing sent yet.
  return EMPTY;
}

/**
 * API client for the backend proxy.
 *
 * The frontend never talks to the routing engines directly (Req 12.4); it calls
 * the backend, which enforces the host allowlist, forwards to the engines,
 * times the round trip, normalizes, and returns a uniform envelope.
 *
 * The base URL defaults to "http://localhost:8000" and can be overridden with
 * the `VITE_API_BASE_URL` env variable.
 */

import type {
  CompareResponse,
  Coordinate,
  Engine,
  EngineHealth,
  EngineResult,
  ValhallaTraceResult,
  RoutingTarget,
} from "./types";

const DEFAULT_BASE_URL = "http://localhost:8000";

/** Resolve the configured API base URL, trimming any trailing slash. */
function resolveBaseUrl(): string {
  const configured =
    typeof import.meta !== "undefined" && import.meta.env
      ? import.meta.env.VITE_API_BASE_URL
      : undefined;
  const base = configured && configured.trim() !== "" ? configured : DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "");
}

/** The resolved API base URL for the current session. */
export const API_BASE_URL = resolveBaseUrl();

/**
 * Extract the most useful error text from a non-2xx response.
 *
 * Prefers a JSON `detail` field (FastAPI convention), then a JSON `message`,
 * then the raw body text, then the HTTP status.
 */
async function extractErrorMessage(res: Response): Promise<string> {
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch {
    bodyText = "";
  }
  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed && typeof parsed === "object") {
        const detail = (parsed as { detail?: unknown }).detail;
        const message = (parsed as { message?: unknown }).message;
        if (typeof detail === "string" && detail.trim() !== "") return detail;
        if (typeof message === "string" && message.trim() !== "") return message;
      }
    } catch {
      // Not JSON — fall through to raw body text.
    }
    return bodyText;
  }
  return `Request failed with status ${res.status}`;
}

/** POST JSON to `path` and return the parsed response, throwing on non-2xx. */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res));
  }
  return (await res.json()) as T;
}

/** Map-match a preserved OSRM polyline through Valhalla trace_attributes. */
export function valhallaTrace(
  routeId: string,
  encodedPolyline: string,
): Promise<ValhallaTraceResult> {
  return postJson<ValhallaTraceResult>("/api/trace/valhalla", {
    routeId,
    encodedPolyline,
    costing: "motorcycle",
  });
}

/**
 * Run the canonical Compare against both engines (Req 2).
 * Body contains only the start and destination coordinates; the backend builds
 * the canonical default requests itself.
 */
export function compare(
  start: Coordinate,
  dest: Coordinate,
  includeDebug = false,
  target: RoutingTarget = "local",
): Promise<CompareResponse> {
  return postJson<CompareResponse>(
    "/api/compare",
    includeDebug
      ? { start, dest, target, includeDebug: true }
      : { start, dest, target },
  );
}

/** Send an exact OSRM URL verbatim through the backend (Req 9.4–9.5). */
export function osrmRaw(url: string): Promise<EngineResult> {
  return postJson<EngineResult>("/api/osrm/raw", { url });
}

/** Send an exact Valhalla URL + JSON body verbatim through the backend (Req 9.6–9.7). */
export function valhallaRaw(url: string, body: unknown): Promise<EngineResult> {
  return postJson<EngineResult>("/api/valhalla/raw", { url, body });
}

/** Import and execute a pasted curl command through the backend (Req 10). */
export function curlImport(
  curl: string,
): Promise<{ engine: Engine; result: EngineResult }> {
  return postJson<{ engine: Engine; result: EngineResult }>("/api/curl/import", {
    curl,
  });
}

/**
 * Query engine reachability (Req 16).
 *
 * Resilient by design: on network failure this resolves to
 * `{ osrm: "unknown", valhalla: "unknown" }` rather than throwing, so the
 * dashboard stays usable (Req 16.5).
 */
export async function health(): Promise<{
  osrm: EngineHealth;
  valhalla: EngineHealth;
}> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/health`, { method: "GET" });
    if (!res.ok) {
      return { osrm: "unknown", valhalla: "unknown" };
    }
    return (await res.json()) as { osrm: EngineHealth; valhalla: EngineHealth };
  } catch {
    return { osrm: "unknown", valhalla: "unknown" };
  }
}

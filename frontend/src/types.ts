/**
 * Shared TypeScript types for the Bike Routing Comparison and Debugging Dashboard.
 *
 * These mirror the backend envelope shapes exactly (camelCase JSON), so the
 * frontend consumes a uniform, engine-agnostic model. Engine-specific parsing
 * lives entirely in the backend; the frontend never re-parses engine responses
 * (Req 12.1, 12.4).
 */

/** The two routing engines under comparison. */
export type Engine = "osrm" | "valhalla";

/**
 * A simple lat/lon coordinate as used for start/dest inputs.
 * Note: this is a frontend-owned input type. Rendered route geometry uses
 * `[lon, lat]` tuples in `NormalizedRoute.coordinates` (MapLibre convention).
 */
export interface Coordinate {
  lat: number;
  lon: number;
}

/**
 * The engine-agnostic route model produced by the backend and consumed by the
 * frontend map (Req 12.1). `coordinates` are `[lon, lat]` pairs, ready for
 * MapLibre/GeoJSON without re-ordering.
 */
export interface NormalizedRoute {
  /** Stable id: `${engine}:${index}` (e.g. "osrm:0"). */
  id: string;
  engine: Engine;
  /** 0 = primary, 1..n = alternates. */
  index: number;
  isPrimary: boolean;
  /** e.g. "OSRM Primary", "Valhalla Alt 2". */
  label: string;
  /** `[lon, lat]` pairs (MapLibre-ready). */
  coordinates: [number, number][];
  distanceMeters: number | null;
  durationSeconds: number | null;
  /** OSRM weight / Valhalla summary.cost. */
  cost: number | null;
  /** The route's original engine object, unmodified. */
  raw: unknown;
}

/** Classification of an engine-level failure (Req 17). */
export interface EngineError {
  kind:
    | "unreachable"
    | "timeout"
    | "http_error"
    | "no_route"
    | "invalid_response"
    | "invalid_request";
  /** Actionable message. */
  message: string;
  detail?: unknown;
}

/**
 * A per-route normalization warning (e.g. a dropped malformed geometry) that
 * does NOT fail the engine result (Req 17.10, 17.11).
 */
export interface RouteWarning {
  engine: Engine;
  routeIndex: number;
  /** Includes at least "geometry_error". */
  kind: string;
  /** Actionable, identifies the affected route. */
  message: string;
}

/**
 * An independent per-engine result envelope so one engine's failure never
 * affects the other (Req 2.2–2.3, 17.13).
 */
export interface EngineResult {
  engine: Engine;
  status: "ok" | "error";
  /** Engine HTTP status (Req 2.7). */
  httpStatus: number | null;
  /** Measured round-trip time (Req 2.7, 7.1). */
  durationMs: number;
  normalizedRoutes: NormalizedRoute[];
  /** Full engine response, unmodified (Req 11.1). */
  raw: unknown | null;
  warnings: RouteWarning[];
  error: EngineError | null;
}

/** Response of `POST /api/compare` — one envelope per engine. */
export interface CompareResponse {
  osrm: EngineResult;
  valhalla: EngineResult;
}

// --- Frontend-owned types (not backend envelope shapes) ---------------------

/** A saved test case, persisted to localStorage (Req 13). */
export interface TestCase {
  id: string;
  name: string;
  start: Coordinate;
  dest: Coordinate;
  notes?: string;
}

/** A route quality assessment, persisted to localStorage (Req 14). */
export interface RouteQuality {
  rating: "good" | "bad" | "neutral";
  notes?: string;
}

/** Engine reachability as reported by `GET /api/health` (Req 16). */
export type EngineHealth = "reachable" | "unreachable" | "unknown";

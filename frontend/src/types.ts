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
  /** Whether `raw` is literal engine JSON or reconstructed from protobuf. */
  rawSource?: "engine-json" | "protobuf-derived";
  warnings: RouteWarning[];
  error: EngineError | null;
}

/** OSRM annotation values for one geometry segment. */
export interface OsrmDebugProperties {
  distance: number;
  duration: number;
  weight: number;
  speed: number;
  datasources: number;
  datasource: number;
  datasourceName: string | null;
  /** Kept as strings because OSM node ids may exceed JS integer precision. */
  fromNodeId: string;
  toNodeId: string;
}

export interface ValhallaCost {
  seconds: number;
  cost: number;
}

export interface ValhallaPathCost {
  elapsedCost: ValhallaCost;
  transitionCost: ValhallaCost;
}

/** Decoded TripLeg.Edge and Node fields emitted by the PBF backend. */
export interface ValhallaDebugProperties {
  /** Valhalla graph edge id; deliberately not converted to a JS number. */
  id: string;
  /** OSM way id; deliberately not converted to a JS number. */
  wayId: string;
  name: string[];
  lengthKm: number;
  speed: number;
  roadClass: string;
  beginShapeIndex: number;
  endShapeIndex: number;
  traversability: string;
  use: string;
  toll: boolean;
  unpaved: boolean;
  tunnel: boolean;
  bridge: boolean;
  roundabout: boolean;
  surface: string;
  density: number;
  speedLimit: number;
  defaultSpeed: number;
  sourceAlongEdge: number;
  targetAlongEdge: number;
  spdLmt: number;
  spdLmtHgv: number;
  spdLmtBike: number;
  frc: number;
  tollRoad: number;
  bikeSpeed: number;
  nodeCost: ValhallaPathCost;
  sourceNodeCost: ValhallaPathCost;
  targetNodeCost: ValhallaPathCost | null;
}

interface DebugSegmentBase {
  id: string;
  routeId: string;
  routeIndex: number;
  legIndex: number;
  segmentIndex: number;
  /** One edge may contain several shape points (notably Valhalla edges). */
  coordinates: [number, number][];
}

export interface OsrmDebugSegment extends DebugSegmentBase {
  engine: "osrm";
  properties: OsrmDebugProperties;
}

export interface ValhallaDebugSegment extends DebugSegmentBase {
  engine: "valhalla";
  properties: ValhallaDebugProperties;
}

export type DebugSegment = OsrmDebugSegment | ValhallaDebugSegment;

export interface DebugError {
  kind: string;
  message: string;
  routeIndex?: number | null;
  legIndex?: number | null;
  detail?: unknown;
}

export interface EngineDebugResult<
  TSegment extends DebugSegment = DebugSegment,
> {
  engine: Engine;
  status: "ok" | "partial" | "error";
  segments: TSegment[];
  errors: DebugError[];
}

export interface CompareDebug {
  osrm: EngineDebugResult;
  valhalla: EngineDebugResult;
}

/** Response of `POST /api/compare` — one envelope per engine. */
export interface CompareResponse {
  osrm: EngineResult;
  valhalla: EngineResult;
  /** Present only when the request opted into edge-debug extraction. */
  debug?: CompareDebug | null;
}

export interface TraceWarning {
  kind: string;
  message: string;
  detail?: unknown;
}

/** Independent result of map-matching one preserved OSRM route in Valhalla. */
export interface ValhallaTraceResult {
  status: "ok" | "partial" | "error";
  sourceRouteId: string;
  originalGeometry: [number, number][];
  traceGeometry: [number, number][];
  exactGeometryMatch: boolean;
  originalPointCount: number;
  tracePointCount: number;
  geometryDeviation: unknown | null;
  segments: ValhallaDebugSegment[];
  warnings: TraceWarning[];
  errors: DebugError[];
  httpStatus: number | null;
  durationMs: number;
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

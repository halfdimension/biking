"""Pydantic request/response models for the Bike Routing Dashboard backend.

These models mirror the design's Data Models and Backend API Design sections
exactly. The engine-agnostic ``NormalizedRoute`` and the per-engine
``EngineResult`` envelope are produced by the backend normalizers and consumed
by the frontend map (Req 2, 11, 12.1, 17).

JSON serialization uses the design's camelCase field names (``isPrimary``,
``distanceMeters``, ``durationSeconds``, ``httpStatus``, ``normalizedRoutes``,
``routeIndex``) via per-field aliases. ``populate_by_name = True`` lets callers
construct models by the Python attribute name, and responses serialize by alias
so the frontend receives the design's field names.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# The two routing engines the dashboard compares (design Data Models).
Engine = Literal["osrm", "valhalla"]


class _CamelModel(BaseModel):
    """Base model that populates by attribute name and serializes by alias.

    Field-level aliases carry the camelCase JSON names required by the design.
    ``populate_by_name`` allows constructing instances with the Python names,
    and ``model_dump(by_alias=True)`` / FastAPI response serialization emit the
    camelCase names the frontend expects.
    """

    model_config = ConfigDict(populate_by_name=True)


class Coordinate(_CamelModel):
    """A geographic coordinate expressed as latitude/longitude (Req 1)."""

    lat: float
    lon: float


class NormalizedRoute(_CamelModel):
    """Engine-agnostic route model produced by the backend (Req 12.1).

    ``coordinates`` are ``[lon, lat]`` pairs (MapLibre/GeoJSON-ready).
    ``distanceMeters``/``durationSeconds``/``cost`` are nullable: a missing
    engine field maps to ``null`` rather than an error (Req 7.4). ``raw`` carries
    the route's original engine object, unmodified (Req 11.5, 11.6).
    """

    id: str
    engine: Engine
    index: int
    is_primary: bool = Field(alias="isPrimary")
    label: str
    coordinates: list[tuple[float, float]]
    distance_meters: float | None = Field(default=None, alias="distanceMeters")
    duration_seconds: float | None = Field(default=None, alias="durationSeconds")
    cost: float | None = None
    raw: Any = None


class EngineError(_CamelModel):
    """A per-engine failure classification with an actionable message (Req 17)."""

    kind: Literal[
        "unreachable",
        "timeout",
        "http_error",
        "no_route",
        "invalid_response",
        "invalid_request",
    ]
    message: str
    detail: Any | None = None


class RouteWarning(_CamelModel):
    """A per-route normalization warning that does not fail the engine result.

    Emitted, for example, when a single route's geometry is malformed and that
    route is dropped while the engine result stays ``ok`` (Req 17.10, 17.11).
    """

    engine: Engine
    route_index: int = Field(alias="routeIndex")
    kind: str
    message: str


class EngineResult(_CamelModel):
    """Independent per-engine result envelope (Req 2, 11, 17).

    Each engine call returns its own envelope so one engine's failure never
    affects the other (Req 2.2, 2.3, 17.13).
    """

    engine: Engine
    status: Literal["ok", "error"]
    http_status: int | None = Field(default=None, alias="httpStatus")
    duration_ms: float = Field(alias="durationMs")
    normalized_routes: list[NormalizedRoute] = Field(alias="normalizedRoutes")
    raw: Any | None = None
    warnings: list[RouteWarning] = Field(default_factory=list)
    error: EngineError | None = None


class DebugError(_CamelModel):
    """A debug-extraction error that never changes the route result."""

    kind: str
    message: str
    route_index: int | None = Field(default=None, alias="routeIndex")
    leg_index: int | None = Field(default=None, alias="legIndex")
    detail: Any | None = None


class DebugSegment(_CamelModel):
    """One engine edge/annotation segment tied to its exact route geometry."""

    id: str
    engine: Engine
    route_id: str = Field(alias="routeId")
    route_index: int = Field(alias="routeIndex")
    leg_index: int = Field(alias="legIndex")
    segment_index: int = Field(alias="segmentIndex")
    coordinates: list[tuple[float, float]]
    properties: dict[str, Any]


class EngineDebugResult(_CamelModel):
    """Independently successful, partial, or failed debug extraction."""

    engine: Engine
    status: Literal["ok", "partial", "error"]
    segments: list[DebugSegment] = Field(default_factory=list)
    errors: list[DebugError] = Field(default_factory=list)


class CompareDebug(_CamelModel):
    """Per-engine debug payload returned only when explicitly requested."""

    osrm: EngineDebugResult
    valhalla: EngineDebugResult


class CompareResponse(_CamelModel):
    """The paired per-engine result of a Compare fan-out (Req 2, 12)."""

    osrm: EngineResult
    valhalla: EngineResult
    debug: CompareDebug | None = None


class CompareRequest(_CamelModel):
    """Compare request body plus an opt-in edge-debug flag.

    The backend always builds the canonical ``Default_OSRM_Request`` and
    ``Default_Valhalla_Request`` from these coordinates. No ``osrmOptions`` /
    ``valhallaOptions`` or raw request material is accepted here — those go
    through the raw endpoints (design: POST /api/compare).
    """

    start: Coordinate
    dest: Coordinate
    include_debug: bool = Field(default=False, alias="includeDebug")


class ValhallaTraceRequest(_CamelModel):
    """An OSRM route geometry to map-match with Valhalla."""

    route_id: str = Field(alias="routeId", min_length=1)
    encoded_polyline: str = Field(alias="encodedPolyline", min_length=1)
    costing: Literal["motorcycle"] = "motorcycle"


class TraceWarning(_CamelModel):
    """A non-fatal condition in an otherwise usable trace result."""

    kind: str
    message: str
    detail: Any | None = None


class ValhallaTraceResponse(_CamelModel):
    """Independent result envelope for trace inspection."""

    status: Literal["ok", "partial", "error"]
    source_route_id: str = Field(alias="sourceRouteId")
    original_geometry: list[tuple[float, float]] = Field(alias="originalGeometry")
    trace_geometry: list[tuple[float, float]] = Field(alias="traceGeometry")
    exact_geometry_match: bool = Field(alias="exactGeometryMatch")
    original_point_count: int = Field(alias="originalPointCount")
    trace_point_count: int = Field(alias="tracePointCount")
    geometry_deviation: Any | None = Field(default=None, alias="geometryDeviation")
    segments: list[DebugSegment] = Field(default_factory=list)
    warnings: list[TraceWarning] = Field(default_factory=list)
    errors: list[DebugError] = Field(default_factory=list)
    http_status: int | None = Field(default=None, alias="httpStatus")
    duration_ms: float = Field(default=0.0, alias="durationMs")


class OsrmRawRequest(_CamelModel):
    """Advanced-mode OSRM raw request: the exact URL to GET verbatim (Req 9.4)."""

    url: str


class ValhallaRawRequest(_CamelModel):
    """Advanced-mode Valhalla raw request: exact URL + JSON body verbatim (Req 9.6)."""

    url: str
    body: Any


class CurlImportRequest(_CamelModel):
    """A pasted curl command to parse (with shlex, never a shell) (Req 10)."""

    curl: str


class CurlImportResponse(_CamelModel):
    """Result of a curl import: the resolved engine and its result (Req 10)."""

    engine: Engine
    result: EngineResult


class HealthResponse(_CamelModel):
    """Per-engine HTTP reachability, not a 2xx status (Req 16)."""

    osrm: Literal["reachable", "unreachable"]
    valhalla: Literal["reachable", "unreachable"]

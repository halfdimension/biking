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


class CompareResponse(_CamelModel):
    """The paired per-engine result of a Compare fan-out (Req 2, 12)."""

    osrm: EngineResult
    valhalla: EngineResult


class CompareRequest(_CamelModel):
    """Compare request body: start and destination coordinates ONLY (Req 2).

    The backend always builds the canonical ``Default_OSRM_Request`` and
    ``Default_Valhalla_Request`` from these coordinates. No ``osrmOptions`` /
    ``valhallaOptions`` or raw request material is accepted here — those go
    through the raw endpoints (design: POST /api/compare).
    """

    start: Coordinate
    dest: Coordinate


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

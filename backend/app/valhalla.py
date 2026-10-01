"""Valhalla request construction and response normalization (Task 6).

This module owns the Valhalla-specific pieces of the pipeline, mirroring the
structure of :mod:`app.osrm`:

- :func:`build_default_valhalla_body` builds the canonical
  ``Default_Valhalla_Request`` POST JSON body from a start/destination
  coordinate pair, emitting ``locations`` as ``lat``/``lon`` ``type: "break"``
  entries and the fixed default options the backend always applies
  (``costing="motorcycle"``, ``alternates=10``, ``shape_format="polyline6"``,
  ``directions_options.units="kilometers"``) (Req 2.2, 7.3).
- :func:`normalize_valhalla_response` turns a raw Valhalla JSON response into an
  engine-agnostic :class:`~app.models.EngineResult` envelope. It resolves the
  distance units defensively (``trip.units`` → request-unit context →
  kilometers), converts every route's summary length to meters, decodes each
  leg's polyline6 geometry independently and concatenates the legs (skipping a
  duplicate boundary coordinate within tolerance), isolates a single
  malformed-geometry route behind a :class:`~app.models.RouteWarning`, and
  preserves the entire original response as ``raw``
  (Req 3.2, 7.3, 7.4, 11.5, 11.6, 12.3, 17.8-17.11).

The engine call layer (``app/engines.py``) is intentionally not touched here;
the wiring into ``POST /api/compare`` is Task 7.
"""

from __future__ import annotations

from typing import Any

from app import config
from app.models import (
    Coordinate,
    EngineError,
    EngineResult,
    NormalizedRoute,
    RouteWarning,
)
from app.polyline import PolylineDecodeError, decode_polyline6

# The Valhalla engine identifier used across normalized models.
_ENGINE = "valhalla"

# Shared by JSON and PBF request builders so Edge Debug cannot drift from the
# dashboard's configured alternate-route behavior.
DEFAULT_ALTERNATES = 10

# Conversion factors from the reported summary length unit to meters. Distance
# units are unit-aware and must never be permanently assumed to be kilometers
# (design: normalizeValhallaResponse). Both the long and short spellings are
# accepted defensively (Req 7.3).
_KM_TO_METERS = 1000.0
_MILES_TO_METERS = 1609.344

# The default unit assumed only when nothing in the response or the request
# context indicates otherwise (design: default to kilometers).
_DEFAULT_UNITS = "kilometers"

# Tolerance for treating the last coordinate of one leg and the first
# coordinate of the next leg as the same shared boundary point, so the
# duplicate is dropped when concatenating multi-leg geometry (design: 1e-6).
_BOUNDARY_TOLERANCE = 1e-6


def build_default_valhalla_body(start: Coordinate, dest: Coordinate) -> dict[str, Any]:
    """Build the canonical ``Default_Valhalla_Request`` POST body (Req 2.2, 7.3).

    Unlike the OSRM URL (which encodes coordinates ``lon,lat`` in the path),
    Valhalla takes ``locations`` as objects with separate ``lat``/``lon`` fields
    and a ``type`` of ``"break"`` (design: coordinate-ordering table). The fixed
    default options are always applied by the backend and are never
    client-supplied: ``costing="motorcycle"``, ``alternates=10``,
    ``shape_format="polyline6"``, and ``directions_options.units="kilometers"``.

    Args:
        start: The start coordinate (lat/lon).
        dest: The destination coordinate (lat/lon).

    Returns:
        The canonical Valhalla request body as a ``dict``, e.g.::

            {
              "locations": [
                {"lat": 12.9, "lon": 77.6, "type": "break"},
                {"lat": 12.95, "lon": 77.65, "type": "break"}
              ],
              "costing": "motorcycle",
              "alternates": 10,
              "shape_format": "polyline6",
              "directions_options": {"units": "kilometers"}
            }
    """
    return {
        "locations": [
            {"lat": start.lat, "lon": start.lon, "type": "break"},
            {"lat": dest.lat, "lon": dest.lon, "type": "break"},
        ],
        "costing": "motorcycle",
        "alternates": DEFAULT_ALTERNATES,
        "shape_format": "polyline6",
        "directions_options": {"units": "kilometers"},
        "costing_options": {"motorcycle": {"speed_types": ["current"]}},
        "date_time": {"type": 0}
        # "prioritize_bidirectional":true
    }


def _resolve_units(trip: dict[str, Any], request_units: str | None) -> str:
    """Resolve the distance unit for a trip, defensively (Req 7.3).

    Resolution order (design: normalizeValhallaResponse):

    1. ``trip["units"]`` when present.
    2. Otherwise the request's ``directions_options.units`` context, passed in
       as ``request_units``.
    3. Otherwise :data:`_DEFAULT_UNITS` (kilometers).

    The returned value is the raw (unnormalized) unit string; unit spelling is
    interpreted by :func:`_length_to_meters`.
    """
    trip_units = trip.get("units") if isinstance(trip, dict) else None
    if trip_units:
        return trip_units
    if request_units:
        return request_units
    return _DEFAULT_UNITS


def _length_to_meters(length: float | None, units: str) -> float | None:
    """Convert a summary length in ``units`` to meters (Req 7.3).

    ``distanceMeters`` is always meters. Kilometers convert by ``* 1000`` and
    miles by ``* 1609.344``. Both the long (``"kilometers"``/``"miles"``) and
    short (``"km"``/``"mi"``) spellings are accepted defensively; an unknown
    unit falls back to the kilometers factor (matching the default assumption).
    A missing length maps to ``None`` rather than an error (Req 7.4).
    """
    if length is None:
        return None
    normalized = units.strip().lower() if isinstance(units, str) else ""
    if normalized in ("miles", "mi"):
        return length * _MILES_TO_METERS
    # kilometers / km, and any unexpected value, use the kilometer factor.
    return length * _KM_TO_METERS


def _is_error_response(raw: Any) -> bool:
    """Return True when the response is a Valhalla error body (Req 17.8).

    Valhalla signals a failure with an ``{"error": ..., "error_code": ...}``
    object rather than a ``trip``.
    """
    return isinstance(raw, dict) and ("error" in raw or "error_code" in raw)


def _decode_trip_geometry(trip: dict[str, Any]) -> list[list[float]]:
    """Decode and concatenate a trip's multi-leg polyline6 geometry.

    Each ``trip["legs"][*]["shape"]`` is decoded **independently** and the
    decoded legs are concatenated in order. When joining, if the last
    coordinate accumulated so far equals the first coordinate of the next leg
    within :data:`_BOUNDARY_TOLERANCE` (comparing both lon and lat), that
    duplicate boundary coordinate is skipped. A single-leg route is the simple
    case (one decode, no join). Coordinates are ``[lon, lat]``.

    Raises:
        PolylineDecodeError: If any leg's shape is malformed. The caller catches
            this to isolate the whole route (Req 17.10, 17.11).
    """
    legs = trip.get("legs") if isinstance(trip, dict) else None
    coordinates: list[list[float]] = []
    if not legs:
        return coordinates

    for leg in legs:
        shape = leg.get("shape") if isinstance(leg, dict) else None
        leg_coords = decode_polyline6(shape or "")
        if not leg_coords:
            continue
        if coordinates:
            last = coordinates[-1]
            first = leg_coords[0]
            if (
                abs(last[0] - first[0]) <= _BOUNDARY_TOLERANCE
                and abs(last[1] - first[1]) <= _BOUNDARY_TOLERANCE
            ):
                # Shared boundary point already present; skip the duplicate.
                coordinates.extend(leg_coords[1:])
                continue
        coordinates.extend(leg_coords)

    return coordinates


def _error_result(
    raw: Any,
    duration_ms: float,
    http_status: int | None,
) -> EngineResult:
    """Build a zero-route ``EngineResult`` for a Valhalla error response.

    Valhalla returns ``{"error": ..., "error_code": ...}`` on failure. The
    transport call itself may have succeeded, so this is conveyed via an empty
    route list plus an ``EngineError`` (``no_route``) while the full ``raw``
    response is preserved so the frontend can render a message and inspect the
    original body (Req 17.8, 11.5, 11.6).
    """
    message = None
    if isinstance(raw, dict):
        message = raw.get("error")
    return EngineResult(
        engine=_ENGINE,
        status="ok",
        http_status=http_status,
        duration_ms=duration_ms,
        normalized_routes=[],
        raw=raw,
        warnings=[],
        error=EngineError(
            kind="no_route",
            message=(
                f"Valhalla reported an error: {message}"
                if message
                else "Valhalla returned an error response."
            ),
            detail=None,
        ),
    )


def _normalize_trip(
    trip: dict[str, Any],
    index: int,
    request_units: str | None,
    normalized_routes: list[NormalizedRoute],
    warnings: list[RouteWarning],
) -> None:
    """Normalize a single Valhalla ``trip`` into a route (or a warning).

    Appends a :class:`~app.models.NormalizedRoute` to ``normalized_routes`` on
    success, or a ``geometry_error`` :class:`~app.models.RouteWarning` to
    ``warnings`` if any leg's geometry is malformed — dropping only this route
    while others continue (Req 17.10, 17.11).
    """
    try:
        coordinates = _decode_trip_geometry(trip)
    except PolylineDecodeError as exc:
        warnings.append(
            RouteWarning(
                engine=_ENGINE,
                route_index=index,
                kind="geometry_error",
                message=f"Could not decode Valhalla route {index} geometry: {exc}",
            )
        )
        return

    summary = trip.get("summary") if isinstance(trip, dict) else None
    summary = summary if isinstance(summary, dict) else {}

    units = _resolve_units(trip, request_units)
    distance_meters = _length_to_meters(summary.get("length"), units)

    is_primary = index == 0
    label = "Valhalla Primary" if is_primary else f"Valhalla Alt {index}"
    normalized_routes.append(
        NormalizedRoute(
            id=f"{_ENGINE}:{index}",
            engine=_ENGINE,
            index=index,
            is_primary=is_primary,
            label=label,
            coordinates=coordinates,
            distance_meters=distance_meters,
            duration_seconds=summary.get("time"),
            cost=summary.get("cost"),
            raw=trip,
        )
    )


def normalize_valhalla_response(
    raw: dict[str, Any],
    duration_ms: float,
    http_status: int | None = None,
    request_units: str | None = None,
) -> EngineResult:
    """Normalize a raw Valhalla JSON response into an ``EngineResult`` (Req 12.3).

    Signature is shaped to fit how Task 7 will call it: pass the decoded JSON
    body (``raw``), the measured round-trip ``duration_ms``, the HTTP status
    code, and the optional ``request_units`` context (the request's
    ``directions_options.units`` used as the unit fallback when ``trip.units``
    is absent). The returned envelope always has ``engine="valhalla"``.

    Behavior (design: normalizeValhallaResponse):

    - An error response (``{"error": ..., "error_code": ...}``) → zero
      ``normalizedRoutes`` and ``error.kind = "no_route"``, with ``raw``
      preserved (Req 17.8).
    - ``response["trip"]`` → primary (``index 0``, ``isPrimary True``, label
      ``"Valhalla Primary"``); ``response["alternates"][i]["trip"]`` → alternates
      (``index i + 1``, label ``"Valhalla Alt {i+1}"``). Missing/absent
      ``alternates`` → only the primary (Req 17.9). ``id = f"valhalla:{index}"``.
    - Distance is **unit-aware**: units resolve as ``trip.units`` →
      ``request_units`` → kilometers, then ``summary["length"]`` converts to
      meters (km ``* 1000``, miles ``* 1609.344``). ``distanceMeters`` is always
      meters. ``durationSeconds = summary["time"]``; ``cost = summary["cost"]``.
      Missing fields map to ``None`` (Req 7.3, 7.4).
    - Geometry is multi-leg: each ``trip["legs"][*]["shape"]`` is decoded
      independently and concatenated, skipping a duplicate boundary coordinate
      within ``1e-6``; a single leg is the simple case (Req 3.2).
    - A single route with malformed geometry
      (:class:`~app.polyline.PolylineDecodeError`) is dropped alone, the result
      stays ``ok``, ``raw`` is preserved, and a ``geometry_error``
      :class:`~app.models.RouteWarning` (with ``engine`` + ``routeIndex``) is
      appended (Req 17.10, 17.11).
    - The entire original response is preserved verbatim as ``raw``; each
      route's ``raw`` is its ``trip`` object, unmodified — custom fields are
      never stripped (Req 11.5, 11.6).

    Args:
        raw: The decoded Valhalla JSON response body.
        duration_ms: The measured round-trip duration in milliseconds.
        http_status: The HTTP status code of the Valhalla response, if any.
        request_units: The request's ``directions_options.units``, used as the
            unit fallback when ``trip.units`` is absent.

    Returns:
        An :class:`~app.models.EngineResult` with ``engine="valhalla"``.
    """
    # Valhalla error body -> no route, preserve raw (Req 17.8).
    if _is_error_response(raw):
        return _error_result(raw, duration_ms, http_status)

    trip = raw.get("trip") if isinstance(raw, dict) else None
    if not isinstance(trip, dict):
        # No trip and not an explicit error body: treat as no route while still
        # preserving the raw response (Req 17.8).
        return EngineResult(
            engine=_ENGINE,
            status="ok",
            http_status=http_status,
            duration_ms=duration_ms,
            normalized_routes=[],
            raw=raw,
            warnings=[],
            error=EngineError(
                kind="no_route",
                message="Valhalla response is missing a trip.",
                detail=None,
            ),
        )

    normalized_routes: list[NormalizedRoute] = []
    warnings: list[RouteWarning] = []

    # Primary trip -> index 0.
    _normalize_trip(trip, 0, request_units, normalized_routes, warnings)

    # Alternates -> index i + 1. Missing/absent alternates => only primary.
    alternates = raw.get("alternates")
    if isinstance(alternates, list):
        for i, alternate in enumerate(alternates):
            alt_trip = (
                alternate.get("trip") if isinstance(alternate, dict) else None
            )
            if isinstance(alt_trip, dict):
                _normalize_trip(
                    alt_trip, i + 1, request_units, normalized_routes, warnings
                )

    return EngineResult(
        engine=_ENGINE,
        status="ok",
        http_status=http_status,
        duration_ms=duration_ms,
        normalized_routes=normalized_routes,
        raw=raw,
        warnings=warnings,
        error=None,
    )

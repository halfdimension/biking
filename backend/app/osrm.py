"""OSRM request construction and response normalization (Task 5).

This module owns the OSRM-specific pieces of the pipeline:

- :func:`build_default_osrm_url` builds the canonical ``Default_OSRM_Request``
  URL from a start/destination coordinate pair, emitting the coordinates in
  ``lon,lat`` order and the fixed default query parameters the backend always
  applies (Req 9.2, 9.3, 2.2).
- :func:`normalize_osrm_response` turns a raw OSRM JSON response into an
  engine-agnostic :class:`~app.models.EngineResult` envelope: it decodes each
  route's polyline6 geometry to ``[lon, lat]`` pairs, extracts the
  render-critical summary fields, isolates a single malformed-geometry route
  behind a :class:`~app.models.RouteWarning`, and preserves the entire original
  response as ``raw`` (Req 3.1, 3.3, 7.2, 7.4, 11.5, 11.6, 12.2, 17.8-17.11).

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

# The fixed default query string the backend always applies to a Compare-mode
# OSRM request (design: Canonical defaults). Kept as a single literal in a
# stable order so the emitted URL is deterministic and matches the design's
# Default_OSRM_Request exactly (Req 9.2, 9.3, 2.2).
DEFAULT_OSRM_QUERY = (
    "overview=full"
    "&geometries=polyline6"
    "&alternatives=true"
    "&annotations=nodes,distance,duration,weight,speed,datasources"
    "&steps=true"
)

# The OSRM engine identifier used across normalized models.
_ENGINE = "osrm"


def build_default_osrm_url(
    start: Coordinate,
    dest: Coordinate,
    *,
    base_url: str | None = None,
) -> str:
    """Build the canonical ``Default_OSRM_Request`` URL (Req 9.2, 9.3, 2.2).

    OSRM's routing service takes coordinates in ``lon,lat`` order in the URL
    path, so the latitude/longitude of each :class:`~app.models.Coordinate` is
    emitted as ``{lon},{lat}`` (Req 9.3 — coordinate ordering is critical). The
    fixed default parameters (:data:`DEFAULT_OSRM_QUERY`) are always applied by
    the backend and are never client-supplied (Req 2.2).

    Args:
        start: The start coordinate (lat/lon).
        dest: The destination coordinate (lat/lon).
        base_url: Base URL of the OSRM service; defaults to
            :data:`app.config.OSRM_BASE_URL`.

    Returns:
        The full canonical OSRM route URL, e.g.::

            http://localhost:5000/route/v1/biking/77.6,12.9;77.65,12.95?overview=full&geometries=polyline6&alternatives=true&annotations=nodes,distance,duration,weight,speed,datasources&steps=true
    """
    base = config.OSRM_BASE_URL if base_url is None else base_url
    coords = f"{start.lon},{start.lat};{dest.lon},{dest.lat}"
    return f"{base}/route/v1/biking/{coords}?{DEFAULT_OSRM_QUERY}"


def _no_route_result(
    raw: Any,
    duration_ms: float,
    http_status: int | None,
    message: str,
) -> EngineResult:
    """Build a zero-route ``EngineResult`` carrying a ``no_route`` error.

    Used when OSRM reports ``code != "Ok"`` (e.g. ``"NoRoute"``) or returns no
    routes at all. The transport call itself succeeded, so this represents "no
    route found" via an empty route list plus an ``EngineError`` of kind
    ``no_route`` while still preserving the full ``raw`` response so the
    frontend can render a no-route message and inspect the original body (Req
    17.8, 11.5, 11.6).
    """
    return EngineResult(
        engine=_ENGINE,
        status="ok",
        http_status=http_status,
        duration_ms=duration_ms,
        normalized_routes=[],
        raw=raw,
        warnings=[],
        error=EngineError(kind="no_route", message=message, detail=None),
    )


def normalize_osrm_response(
    raw: dict[str, Any],
    duration_ms: float,
    http_status: int | None = None,
) -> EngineResult:
    """Normalize a raw OSRM JSON response into an ``EngineResult`` (Req 12.2).

    Signature is shaped to fit how Task 7 will call it after a successful engine
    call: pass the decoded JSON body (``raw``), the measured round-trip
    ``duration_ms``, and the HTTP status code. The returned envelope always has
    ``engine="osrm"``.

    Behavior (design: normalizeOsrmResponse):

    - ``code != "Ok"`` (e.g. ``"NoRoute"``) or a missing/empty ``routes`` list →
      zero ``normalizedRoutes`` and ``error.kind = "no_route"``, with ``raw``
      preserved (Req 17.8). ``status`` stays ``"ok"`` because the transport call
      succeeded; the absence of routes is conveyed via the error + empty list.
    - ``routes[0]`` → primary (``index 0``, ``isPrimary True``); ``routes[1..]``
      → alternates (``index i``). Zero alternates is valid — only the primary is
      produced (Req 17.9).
    - Per route: ``distanceMeters = route["distance"]`` (already meters),
      ``durationSeconds = route["duration"]`` (seconds), ``cost =
      route.get("weight")``. A missing individual field maps to ``None`` rather
      than an error (Req 7.4).
    - ``route["geometry"]`` is a polyline6 string decoded to ``[lon, lat]``
      pairs (Req 3.1, 3.3).
    - If a single route's geometry is malformed
      (:class:`~app.polyline.PolylineDecodeError`), that route alone is dropped,
      the engine result stays ``ok``, ``raw`` is fully preserved, and a
      ``geometry_error`` :class:`~app.models.RouteWarning` (carrying the
      ``engine`` and the offending ``routeIndex``) is appended. Other routes are
      still produced (Req 17.10, 17.11).
    - The entire original response is preserved verbatim as ``raw`` — custom
      fields (``turn_id``, ``from_linkId_idx``, annotations, etc.) are never
      stripped (Req 11.5, 11.6).

    Args:
        raw: The decoded OSRM JSON response body.
        duration_ms: The measured round-trip duration in milliseconds.
        http_status: The HTTP status code of the OSRM response, if any.

    Returns:
        An :class:`~app.models.EngineResult` with ``engine="osrm"``.
    """
    code = raw.get("code") if isinstance(raw, dict) else None
    routes = raw.get("routes") if isinstance(raw, dict) else None

    # code != "Ok" (e.g. "NoRoute") -> no route, preserve raw (Req 17.8).
    if code != "Ok":
        return _no_route_result(
            raw,
            duration_ms,
            http_status,
            message=(
                f"OSRM reported no route (code={code!r})."
                if code is not None
                else "OSRM response is missing a status code."
            ),
        )

    # Missing or empty routes -> also treated as no route (Req 17.8).
    if not routes:
        return _no_route_result(
            raw,
            duration_ms,
            http_status,
            message="OSRM returned no routes.",
        )

    normalized_routes: list[NormalizedRoute] = []
    warnings: list[RouteWarning] = []

    for index, route in enumerate(routes):
        geometry = route.get("geometry") if isinstance(route, dict) else None
        try:
            coordinates = decode_polyline6(geometry or "")
        except PolylineDecodeError as exc:
            # Isolate this single malformed route: drop it, keep going, and
            # record a per-route warning while the result stays ok (Req 17.10,
            # 17.11).
            warnings.append(
                RouteWarning(
                    engine=_ENGINE,
                    route_index=index,
                    kind="geometry_error",
                    message=(
                        f"Could not decode OSRM route {index} geometry: {exc}"
                    ),
                )
            )
            continue

        is_primary = index == 0
        label = "OSRM Primary" if is_primary else f"OSRM Alt {index}"
        normalized_routes.append(
            NormalizedRoute(
                id=f"{_ENGINE}:{index}",
                engine=_ENGINE,
                index=index,
                is_primary=is_primary,
                label=label,
                coordinates=coordinates,
                # route.distance is already meters; missing -> None (Req 7.4).
                distance_meters=route.get("distance"),
                duration_seconds=route.get("duration"),
                cost=route.get("weight"),
                raw=route,
            )
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

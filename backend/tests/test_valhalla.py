"""Unit tests for Valhalla request construction and normalization (Task 6).

Covers the design's normalizeValhallaResponse behavior with representative
examples: the ``Default_Valhalla_Request`` body (costing "motorcycle",
lat/lon locations, alternates 10, shape_format polyline6, units kilometers),
unit-aware conversion (km / miles / trip.units-vs-request_units / default),
primary + alternates indexing/labels, missing alternates, the Valhalla error
response, multi-leg concatenation with a skipped boundary duplicate,
single-route malformed-geometry isolation, and custom-field preservation.

All tests are offline and deterministic. Geometries are built with a tiny local
polyline6 encoder (mirroring test_osrm.py) so they round-trip through the real
``decode_polyline6``.
"""

from __future__ import annotations

from app.models import Coordinate, EngineResult
from app.polyline import decode_polyline6
from app.valhalla import (
    build_default_valhalla_body,
    normalize_valhalla_response,
)


# --- Test helper: a minimal polyline6 encoder ----------------------------


def _encode_polyline6(coords_lonlat: list[list[float]]) -> str:
    """Encode ``[lon, lat]`` pairs into a polyline6 string.

    Standard Google-polyline zig-zag/varint encoding at factor ``1e6``. The
    conventional algorithm encodes ``(lat, lon)``; our input is ``[lon, lat]``
    (MapLibre order) so we swap back to lat-first for encoding, ensuring the
    string round-trips through :func:`app.polyline.decode_polyline6`.
    """

    def _encode_value(delta: int) -> str:
        value = delta << 1
        if delta < 0:
            value = ~value
        chunks = []
        while value >= 0x20:
            chunks.append((0x20 | (value & 0x1F)) + 63)
            value >>= 5
        chunks.append(value + 63)
        return "".join(chr(c) for c in chunks)

    factor = 1e6
    result = []
    prev_lat = 0
    prev_lon = 0
    for lon, lat in coords_lonlat:
        ilat = round(lat * factor)
        ilon = round(lon * factor)
        result.append(_encode_value(ilat - prev_lat))
        result.append(_encode_value(ilon - prev_lon))
        prev_lat, prev_lon = ilat, ilon
    return "".join(result)


_PRIMARY_COORDS = [[77.6, 12.9], [77.61, 12.91], [77.62, 12.92]]
_ALT_COORDS = [[77.6, 12.9], [77.605, 12.915], [77.62, 12.92]]


def _trip(
    coords: list[list[float]],
    *,
    length: float | None = 2.0,
    time: float | None = 300.0,
    cost: float | None = 42.0,
    units: str | None = None,
) -> dict:
    """Build a minimal single-leg Valhalla trip object for tests."""
    summary: dict = {}
    if length is not None:
        summary["length"] = length
    if time is not None:
        summary["time"] = time
    if cost is not None:
        summary["cost"] = cost
    trip: dict = {
        "summary": summary,
        "legs": [{"shape": _encode_polyline6(coords)}],
    }
    if units is not None:
        trip["units"] = units
    return trip


# --- Task 6.1: Default_Valhalla_Request builder --------------------------


def test_build_default_valhalla_body_canonical_shape() -> None:
    start = Coordinate(lat=12.9, lon=77.6)
    dest = Coordinate(lat=12.95, lon=77.65)

    body = build_default_valhalla_body(start, dest)

    assert body["costing"] == "motorcycle"
    assert body["alternates"] == 10
    assert body["shape_format"] == "polyline6"
    assert body["directions_options"] == {"units": "kilometers"}
    assert body["costing_options"] == {
        "motorcycle": {"speed_types": ["current"]}
    }
    assert body["date_time"] == {"type": 0}
    # locations use separate lat/lon fields (NOT lon,lat URL order) + break type.
    assert body["locations"] == [
        {"lat": 12.9, "lon": 77.6, "type": "break"},
        {"lat": 12.95, "lon": 77.65, "type": "break"},
    ]


# --- Task 6.2: unit-aware distance conversion ----------------------------


def test_normalize_km_conversion() -> None:
    raw = {"trip": _trip(_PRIMARY_COORDS, length=2.0, units="kilometers")}

    result = normalize_valhalla_response(raw, duration_ms=5.0, http_status=200)

    assert result.normalized_routes[0].distance_meters == 2000.0


def test_normalize_miles_conversion() -> None:
    raw = {"trip": _trip(_PRIMARY_COORDS, length=1.0, units="miles")}

    result = normalize_valhalla_response(raw, duration_ms=5.0, http_status=200)

    assert result.normalized_routes[0].distance_meters == 1609.344


def test_normalize_short_unit_spellings_accepted() -> None:
    raw_km = {"trip": _trip(_PRIMARY_COORDS, length=2.0, units="km")}
    raw_mi = {"trip": _trip(_PRIMARY_COORDS, length=1.0, units="mi")}

    result_km = normalize_valhalla_response(raw_km, duration_ms=1.0, http_status=200)
    result_mi = normalize_valhalla_response(raw_mi, duration_ms=1.0, http_status=200)

    assert result_km.normalized_routes[0].distance_meters == 2000.0
    assert result_mi.normalized_routes[0].distance_meters == 1609.344


def test_normalize_trip_units_preferred_over_request_units() -> None:
    # trip says miles, request context says kilometers -> trip wins.
    raw = {"trip": _trip(_PRIMARY_COORDS, length=1.0, units="miles")}

    result = normalize_valhalla_response(
        raw, duration_ms=1.0, http_status=200, request_units="kilometers"
    )

    assert result.normalized_routes[0].distance_meters == 1609.344


def test_normalize_request_units_fallback_when_trip_units_absent() -> None:
    # trip has no units -> fall back to request context (miles).
    raw = {"trip": _trip(_PRIMARY_COORDS, length=1.0, units=None)}

    result = normalize_valhalla_response(
        raw, duration_ms=1.0, http_status=200, request_units="miles"
    )

    assert result.normalized_routes[0].distance_meters == 1609.344


def test_normalize_default_km_when_no_units_anywhere() -> None:
    raw = {"trip": _trip(_PRIMARY_COORDS, length=2.0, units=None)}

    result = normalize_valhalla_response(raw, duration_ms=1.0, http_status=200)

    assert result.normalized_routes[0].distance_meters == 2000.0


def test_normalize_duration_and_cost_passthrough_and_missing_none() -> None:
    raw = {"trip": _trip(_PRIMARY_COORDS, length=None, time=None, cost=None)}

    result = normalize_valhalla_response(raw, duration_ms=1.0, http_status=200)

    route = result.normalized_routes[0]
    assert route.distance_meters is None
    assert route.duration_seconds is None
    assert route.cost is None
    assert route.coordinates  # geometry still decoded


# --- Task 6.2: primary + alternates --------------------------------------


def test_normalize_primary_and_alternates_indices_and_labels() -> None:
    raw = {
        "trip": _trip(_PRIMARY_COORDS),
        "alternates": [
            {"trip": _trip(_ALT_COORDS)},
            {"trip": _trip(_ALT_COORDS)},
        ],
    }

    result = normalize_valhalla_response(raw, duration_ms=7.0, http_status=200)

    assert [r.id for r in result.normalized_routes] == [
        "valhalla:0",
        "valhalla:1",
        "valhalla:2",
    ]
    assert [r.index for r in result.normalized_routes] == [0, 1, 2]
    assert [r.label for r in result.normalized_routes] == [
        "Valhalla Primary",
        "Valhalla Alt 1",
        "Valhalla Alt 2",
    ]
    assert [r.is_primary for r in result.normalized_routes] == [True, False, False]


def test_normalize_missing_alternates_produces_only_primary() -> None:
    raw = {"trip": _trip(_PRIMARY_COORDS)}

    result = normalize_valhalla_response(raw, duration_ms=5.0, http_status=200)

    assert result.status == "ok"
    assert result.error is None
    assert len(result.normalized_routes) == 1
    assert result.normalized_routes[0].id == "valhalla:0"
    assert result.normalized_routes[0].is_primary is True


# --- Task 6.2: error response --------------------------------------------


def test_normalize_error_response_no_route_and_raw_preserved() -> None:
    raw = {"error": "No path could be found", "error_code": 442, "status": "Not Found"}

    result = normalize_valhalla_response(raw, duration_ms=8.0, http_status=400)

    assert isinstance(result, EngineResult)
    assert result.engine == "valhalla"
    assert result.normalized_routes == []
    assert result.error is not None
    assert result.error.kind == "no_route"
    # raw preserved verbatim (Req 17.8).
    assert result.raw == raw
    assert result.raw["error_code"] == 442


# --- Task 6.2: multi-leg concatenation + boundary dedup ------------------


def test_normalize_multi_leg_concat_skips_boundary_duplicate() -> None:
    # leg1 ends at the same coordinate leg2 begins with (within 1e-6).
    leg1_coords = [[77.60, 12.90], [77.61, 12.91], [77.62, 12.92]]
    leg2_coords = [[77.62, 12.92], [77.63, 12.93], [77.64, 12.94]]
    boundary = leg2_coords[0]

    raw = {
        "trip": {
            "summary": {"length": 2.0, "time": 300.0, "cost": 42.0},
            "legs": [
                {"shape": _encode_polyline6(leg1_coords)},
                {"shape": _encode_polyline6(leg2_coords)},
            ],
        }
    }

    result = normalize_valhalla_response(raw, duration_ms=6.0, http_status=200)

    coords = [list(pair) for pair in result.normalized_routes[0].coordinates]
    # Expected concatenation: leg1 fully, then leg2 WITHOUT its duplicate first
    # coordinate.
    expected = leg1_coords + leg2_coords[1:]
    assert coords == expected
    # The shared boundary point appears exactly once.
    occurrences = sum(
        1
        for pair in coords
        if abs(pair[0] - boundary[0]) <= 1e-6 and abs(pair[1] - boundary[1]) <= 1e-6
    )
    assert occurrences == 1


def test_normalize_single_leg_is_simple_case() -> None:
    raw = {"trip": _trip(_PRIMARY_COORDS)}

    result = normalize_valhalla_response(raw, duration_ms=1.0, http_status=200)

    expected = [tuple(pair) for pair in decode_polyline6(_encode_polyline6(_PRIMARY_COORDS))]
    assert list(result.normalized_routes[0].coordinates) == expected


# --- Task 6.2: per-route malformed-geometry isolation --------------------


def test_normalize_drops_only_malformed_route_with_geometry_warning() -> None:
    good_primary = _trip(_PRIMARY_COORDS)
    # A trip whose leg shape is a truncated polyline6 that decode rejects.
    bad_alt = {
        "summary": {"length": 3.0, "time": 400.0, "cost": 50.0},
        "legs": [{"shape": "_p~iF~ps|U_"}],  # truncated mid-value
    }
    good_alt = _trip(_ALT_COORDS)
    raw = {
        "trip": good_primary,
        "alternates": [{"trip": bad_alt}, {"trip": good_alt}],
    }

    result = normalize_valhalla_response(raw, duration_ms=9.0, http_status=200)

    # Result stays ok; only the malformed route (index 1) is dropped.
    assert result.status == "ok"
    assert result.error is None
    assert [r.index for r in result.normalized_routes] == [0, 2]
    assert [r.id for r in result.normalized_routes] == ["valhalla:0", "valhalla:2"]
    # Exactly one geometry_error warning pointing at the dropped route.
    assert len(result.warnings) == 1
    warning = result.warnings[0]
    assert warning.engine == "valhalla"
    assert warning.route_index == 1
    assert warning.kind == "geometry_error"
    # Full raw preserved, including the dropped route's object.
    assert result.raw == raw


# --- Task 6.2: custom-field preservation ---------------------------------


def test_normalize_preserves_custom_fields_in_raw() -> None:
    trip = _trip(_PRIMARY_COORDS)
    trip["custom_trip_field"] = {"experiment": True}
    trip["legs"][0]["turn_id"] = 42
    trip["legs"][0]["from_node_idx"] = 7
    raw = {
        "trip": trip,
        "custom_top_level": {"debug": "on"},
        "alternates": [{"trip": _trip(_ALT_COORDS)}],
    }

    result = normalize_valhalla_response(raw, duration_ms=3.0, http_status=200)

    # Full envelope raw preserved, including unknown top-level fields.
    assert result.raw == raw
    assert result.raw["custom_top_level"] == {"debug": "on"}
    # Per-route raw is the unmodified trip object, preserving custom fields.
    route_raw = result.normalized_routes[0].raw
    assert route_raw is trip
    assert route_raw["custom_trip_field"] == {"experiment": True}
    assert route_raw["legs"][0]["turn_id"] == 42
    assert route_raw["legs"][0]["from_node_idx"] == 7

"""Unit tests for OSRM request construction and normalization (Task 5.4).

Covers the design's normalizeOsrmResponse behavior with representative
examples: the ``Default_OSRM_Request`` URL (lon,lat order + all default
params), NoRoute (``code != "Ok"``), zero alternates (only the primary),
missing summary fields mapping to ``None``, custom-field preservation in
``raw``, and single-route malformed-geometry isolation via a ``geometry_error``
warning while other routes remain and the result stays ``ok``.

All tests are offline and deterministic. Geometries are built with a tiny local
polyline6 encoder so they round-trip through the real ``decode_polyline6``.
"""

from __future__ import annotations

from app import config
from app.models import Coordinate, EngineResult
from app.osrm import (
    DEFAULT_OSRM_QUERY,
    build_default_osrm_url,
    normalize_osrm_response,
)
from app.polyline import decode_polyline6


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


# --- Task 5.1: Default_OSRM_Request builder ------------------------------


def test_build_default_osrm_url_uses_lon_lat_order_and_default_params() -> None:
    start = Coordinate(lat=12.9, lon=77.6)
    dest = Coordinate(lat=12.95, lon=77.65)

    url = build_default_osrm_url(start, dest)

    assert url == (
        f"{config.OSRM_BASE_URL}/route/v1/biking/"
        f"77.6,12.9;77.65,12.95?{DEFAULT_OSRM_QUERY}"
    )
    # Coordinates emitted lon,lat (not lat,lon).
    assert "/biking/77.6,12.9;77.65,12.95?" in url
    # All canonical default params present.
    for param in (
        "overview=full",
        "geometries=polyline6",
        "alternatives=true",
        "annotations=nodes,distance,duration,weight,speed,datasources",
        "steps=true",
    ):
        assert param in url


def test_build_default_osrm_url_respects_base_url_override() -> None:
    start = Coordinate(lat=1.0, lon=2.0)
    dest = Coordinate(lat=3.0, lon=4.0)

    url = build_default_osrm_url(start, dest, base_url="http://localhost:5000")

    assert url.startswith("http://localhost:5000/route/v1/biking/2.0,1.0;4.0,3.0?")


# --- Task 5.3 / 5.4: normalize_osrm_response -----------------------------


def test_normalize_no_route_when_code_not_ok() -> None:
    raw = {"code": "NoRoute", "message": "No route found", "waypoints": []}

    result = normalize_osrm_response(raw, duration_ms=12.5, http_status=200)

    assert isinstance(result, EngineResult)
    assert result.engine == "osrm"
    assert result.status == "ok"
    assert result.normalized_routes == []
    assert result.error is not None
    assert result.error.kind == "no_route"
    # raw preserved verbatim.
    assert result.raw == raw
    assert result.raw["message"] == "No route found"


def test_normalize_no_route_when_routes_missing_or_empty() -> None:
    for raw in ({"code": "Ok"}, {"code": "Ok", "routes": []}):
        result = normalize_osrm_response(raw, duration_ms=1.0, http_status=200)
        assert result.normalized_routes == []
        assert result.error is not None
        assert result.error.kind == "no_route"
        assert result.raw == raw


def test_normalize_zero_alternates_produces_only_primary() -> None:
    raw = {
        "code": "Ok",
        "routes": [
            {
                "distance": 1234.5,
                "duration": 300.0,
                "weight": 310.0,
                "geometry": _encode_polyline6(_PRIMARY_COORDS),
            }
        ],
    }

    result = normalize_osrm_response(raw, duration_ms=5.0, http_status=200)

    assert result.status == "ok"
    assert result.error is None
    assert len(result.normalized_routes) == 1
    primary = result.normalized_routes[0]
    assert primary.id == "osrm:0"
    assert primary.index == 0
    assert primary.is_primary is True
    assert primary.label == "OSRM Primary"
    assert primary.distance_meters == 1234.5
    assert primary.duration_seconds == 300.0
    assert primary.cost == 310.0
    # Geometry decoded to [lon, lat] (the model coerces pairs to tuples).
    expected = [tuple(pair) for pair in decode_polyline6(raw["routes"][0]["geometry"])]
    assert list(primary.coordinates) == expected


def test_normalize_primary_and_alternates_labels_and_indices() -> None:
    raw = {
        "code": "Ok",
        "routes": [
            {
                "distance": 1000.0,
                "duration": 200.0,
                "weight": 210.0,
                "geometry": _encode_polyline6(_PRIMARY_COORDS),
            },
            {
                "distance": 1100.0,
                "duration": 220.0,
                "weight": 230.0,
                "geometry": _encode_polyline6(_ALT_COORDS),
            },
        ],
    }

    result = normalize_osrm_response(raw, duration_ms=7.0, http_status=200)

    assert [r.id for r in result.normalized_routes] == ["osrm:0", "osrm:1"]
    assert [r.label for r in result.normalized_routes] == [
        "OSRM Primary",
        "OSRM Alt 1",
    ]
    assert [r.is_primary for r in result.normalized_routes] == [True, False]


def test_normalize_missing_summary_fields_map_to_none() -> None:
    raw = {
        "code": "Ok",
        "routes": [
            {
                # distance, duration, weight all absent.
                "geometry": _encode_polyline6(_PRIMARY_COORDS),
            }
        ],
    }

    result = normalize_osrm_response(raw, duration_ms=2.0, http_status=200)

    assert result.error is None
    route = result.normalized_routes[0]
    assert route.distance_meters is None
    assert route.duration_seconds is None
    assert route.cost is None
    assert route.coordinates  # geometry still decoded


def test_normalize_preserves_custom_fields_in_raw() -> None:
    raw = {
        "code": "Ok",
        "custom_top_level": {"experiment": True},
        "routes": [
            {
                "distance": 1000.0,
                "duration": 200.0,
                "weight": 210.0,
                "geometry": _encode_polyline6(_PRIMARY_COORDS),
                "turn_id": 42,
                "from_linkId_idx": 7,
                "annotation": {
                    "nodes": [1, 2, 3],
                    "datasources": [0, 0, 1],
                },
            }
        ],
    }

    result = normalize_osrm_response(raw, duration_ms=3.0, http_status=200)

    # Full envelope raw preserved, including unknown top-level fields.
    assert result.raw == raw
    assert result.raw["custom_top_level"] == {"experiment": True}
    # Per-route raw preserves custom OSRM fields.
    route_raw = result.normalized_routes[0].raw
    assert route_raw["turn_id"] == 42
    assert route_raw["from_linkId_idx"] == 7
    assert route_raw["annotation"]["nodes"] == [1, 2, 3]
    assert route_raw["annotation"]["datasources"] == [0, 0, 1]


def test_normalize_drops_only_malformed_route_with_geometry_warning() -> None:
    good_primary = {
        "distance": 1000.0,
        "duration": 200.0,
        "weight": 210.0,
        "geometry": _encode_polyline6(_PRIMARY_COORDS),
    }
    # A truncated polyline6 that decode_polyline6 will reject.
    bad_alt = {
        "distance": 1100.0,
        "duration": 220.0,
        "weight": 230.0,
        "geometry": "_p~iF~ps|U_",  # truncated mid-value
    }
    good_alt = {
        "distance": 1200.0,
        "duration": 240.0,
        "weight": 250.0,
        "geometry": _encode_polyline6(_ALT_COORDS),
    }
    raw = {"code": "Ok", "routes": [good_primary, bad_alt, good_alt]}

    result = normalize_osrm_response(raw, duration_ms=9.0, http_status=200)

    # Result stays ok; only the malformed route (index 1) is dropped.
    assert result.status == "ok"
    assert result.error is None
    assert [r.index for r in result.normalized_routes] == [0, 2]
    assert [r.id for r in result.normalized_routes] == ["osrm:0", "osrm:2"]
    # Exactly one geometry_error warning pointing at the dropped route.
    assert len(result.warnings) == 1
    warning = result.warnings[0]
    assert warning.engine == "osrm"
    assert warning.route_index == 1
    assert warning.kind == "geometry_error"
    # Full raw preserved, including the dropped route's object.
    assert result.raw == raw
    assert len(result.raw["routes"]) == 3

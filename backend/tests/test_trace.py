from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app import routes
from app.engines import EngineCallResult
from app.main import app
from app.models import EngineError
from app.trace import (
    TRACE_ATTRIBUTES,
    build_trace_attributes_body,
    build_trace_route_body,
    normalize_trace_attributes_response,
    normalize_trace_route_response,
)

client = TestClient(app)


def encode_polyline6(coords: list[tuple[float, float]]) -> str:
    def value(delta: int) -> str:
        shifted = ~(delta << 1) if delta < 0 else delta << 1
        chars: list[str] = []
        while shifted >= 0x20:
            chars.append(chr((0x20 | (shifted & 0x1F)) + 63))
            shifted >>= 5
        chars.append(chr(shifted + 63))
        return "".join(chars)

    previous_lat = previous_lon = 0
    encoded: list[str] = []
    for lon, lat in coords:
        current_lat = round(lat * 1e6)
        current_lon = round(lon * 1e6)
        encoded.append(value(current_lat - previous_lat))
        encoded.append(value(current_lon - previous_lon))
        previous_lat, previous_lon = current_lat, current_lon
    return "".join(encoded)


SOURCE = [(77.0, 28.0), (77.1, 28.1), (77.2, 28.2)]
CHANGED = [(77.0, 28.0), (77.11, 28.11), (77.2, 28.2)]


def edge(begin: int = 0, end: int = 1) -> dict[str, object]:
    return {
        "id": 9007199254740993,
        "way_id": 9007199254740995,
        "names": ["Ring Road"],
        "length": 0.5,
        "speed": 35,
        "road_class": "primary",
        "use": "road",
        "surface": "paved",
        "density": 7,
        "traversability": "both",
        "toll": False,
        "unpaved": False,
        "tunnel": False,
        "bridge": True,
        "roundabout": False,
        "begin_shape_index": begin,
        "end_shape_index": end,
    }


def normalize(shape: list[tuple[float, float]], edges: list[object]):
    return normalize_trace_attributes_response(
        {"shape": encode_polyline6(shape), "edges": edges},
        route_id="osrm:0",
        encoded_polyline=encode_polyline6(SOURCE),
        duration_ms=5.0,
        http_status=200,
    )


def test_trace_request_is_fixed_map_snap_with_all_attributes() -> None:
    body = build_trace_attributes_body("encoded", "bicycle")

    assert body["encoded_polyline"] == "encoded"
    assert body["costing"] == "bicycle"
    assert body["costing_options"]["bicycle"]["speed_types"] == ["current"]
    assert body["date_time"]["type"] == 0
    assert body["shape_match"] == "map_snap"
    assert body["shape_format"] == "polyline6"
    assert body["filters"] == {
        "action": "include",
        "attributes": TRACE_ATTRIBUTES,
    }
    assert {
        "edge.id",
        "edge.way_id",
        "edge.begin_shape_index",
        "edge.toll",
        "edge.unpaved",
        "edge.tunnel",
        "edge.bridge",
        "edge.roundabout",
        "edge.end_shape_index",
        "shape",
    }.issubset(TRACE_ATTRIBUTES)
    assert {
        "matched.point",
        "matched.type",
        "matched.edge_index",
        "matched.begin_route_discontinuity",
        "matched.end_route_discontinuity",
        "matched.distance_along_edge",
        "matched.distance_from_trace_point",
    }.issubset(TRACE_ATTRIBUTES)


def test_exact_geometry_match_and_source_metadata_are_preserved() -> None:
    result = normalize(SOURCE, [edge()])

    assert result.status == "ok"
    assert result.source_route_id == "osrm:0"
    assert result.exact_geometry_match is True
    assert result.original_point_count == 3
    assert result.trace_point_count == 3
    assert result.warnings == []
    assert result.segments[0].properties["id"] == "9007199254740993"


def test_changed_geometry_is_usable_warning_and_slices_returned_shape() -> None:
    result = normalize(CHANGED, [edge()])

    assert result.status == "ok"
    assert result.exact_geometry_match is False
    assert result.warnings[0].kind == "geometry_changed"
    assert result.segments[0].coordinates == CHANGED[:2]
    assert result.segments[0].coordinates != SOURCE[:2]


def test_invalid_edge_shape_indexes_are_rejected_without_guessed_geometry() -> None:
    result = normalize(CHANGED, [edge(0, 99)])

    assert result.status == "partial"
    assert result.segments == []
    assert result.errors[0].kind == "invalid_shape_indexes"
    assert result.errors[0].detail["tracePointCount"] == 3


def test_zero_edges_is_a_nonfatal_warning() -> None:
    result = normalize(SOURCE, [])

    assert result.status == "ok"
    assert result.segments == []
    assert result.warnings[0].kind == "zero_edges"


def test_missing_returned_shape_is_structured_error() -> None:
    result = normalize_trace_attributes_response(
        {"edges": [edge()]},
        route_id="osrm:2",
        encoded_polyline=encode_polyline6(SOURCE),
        duration_ms=2.0,
        http_status=200,
    )

    assert result.status == "error"
    assert result.source_route_id == "osrm:2"
    assert result.errors[0].kind == "missing_shape"


def test_trace_endpoint_posts_expected_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, object]] = []

    async def fake_call(method: str, url: str, **kwargs: object) -> EngineCallResult:
        calls.append((method, url, kwargs["json"]))
        if url.endswith("/trace_attributes"):
            body = {
                "shape": encode_polyline6(SOURCE),
                "edges": [edge()],
                "matched_points": [],
            }
        else:
            body = {"trip": {"legs": [{"shape": encode_polyline6(SOURCE)}]}}
        response = httpx.Response(200, json=body)
        return EngineCallResult(True, response, 200, 4.0, None)

    monkeypatch.setattr(routes, "call_engine", fake_call)
    response = client.post(
        "/api/trace/valhalla",
        json={
            "routeId": "osrm:1",
            "encodedPolyline": encode_polyline6(SOURCE),
            "costing": "motorcycle",
        },
    )

    assert response.status_code == 200
    assert len(calls) == 2
    assert calls[0][0:2] == ("POST", "http://localhost:8002/trace_attributes")
    assert calls[1][0:2] == ("POST", "http://localhost:8002/trace_route")
    assert calls[0][2]["encoded_polyline"] == encode_polyline6(SOURCE)
    assert calls[1][2]["encoded_polyline"] == encode_polyline6(SOURCE)
    assert calls[0][2]["encoded_polyline"] == calls[1][2]["encoded_polyline"]
    assert calls[1][2]["shape_match"] == "map_snap"
    assert calls[0][2]["shape_format"] == "polyline6"
    assert calls[1][2]["shape_format"] == "polyline6"
    assert "filters" not in calls[1][2]
    assert calls[0][0:2] == ("POST", "http://localhost:8002/trace_attributes")
    assert calls[0][2]["shape_match"] == "map_snap"
    assert calls[0][2]["costing_options"]["motorcycle"]["speed_types"] == [
        "current"
    ]
    assert calls[0][2]["date_time"]["type"] == 0
    assert response.json()["sourceRouteId"] == "osrm:1"


def test_valhalla_transport_failure_is_structured(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_call(method: str, url: str, **kwargs: object) -> EngineCallResult:
        return EngineCallResult(
            False,
            None,
            None,
            3.0,
            EngineError(
                kind="unreachable",
                message="Valhalla is unavailable.",
                detail="connection refused",
            ),
        )

    monkeypatch.setattr(routes, "call_engine", fake_call)
    response = client.post(
        "/api/trace/valhalla",
        json={
            "routeId": "osrm:0",
            "encodedPolyline": encode_polyline6(SOURCE),
            "costing": "motorcycle",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "error"
    assert body["errors"][0]["kind"] == "trace_attributes_unreachable"
    assert body["sourceRouteId"] == "osrm:0"


def test_trace_route_builder_preserves_exact_polyline_and_common_options() -> None:
    encoded = "raw_polyline6_\\?value"
    body = build_trace_route_body(encoded, "motorcycle")

    assert body["encoded_polyline"] is encoded
    assert body == {
        "encoded_polyline": encoded,
        "costing": "motorcycle",
        "costing_options": {"motorcycle": {"speed_types": ["current"]}},
        "date_time": {"type": 0},
        "shape_match": "map_snap",
        "shape_format": "polyline6",
    }


def test_matched_points_preserve_types_order_flags_and_nullables() -> None:
    raw = {
        "shape": encode_polyline6(SOURCE),
        "edges": [edge()],
        "matched_points": [
            {
                "lon": 77.0,
                "lat": 28.0,
                "type": "matched",
                "edge_index": 4,
                "distance_along_edge": 0.25,
                "distance_from_trace_point": 3.5,
                "begin_route_discontinuity": True,
            },
            {
                "point": {"lon": 77.1, "lat": 28.1},
                "type": "interpolated",
                "end_route_discontinuity": True,
            },
            {"point": [77.2, 28.2], "type": "unmatched"},
        ],
    }
    result = normalize_trace_attributes_response(
        raw,
        route_id="osrm:0",
        encoded_polyline=encode_polyline6(SOURCE),
        duration_ms=1,
        http_status=200,
    )

    assert [point.type for point in result.matched_points] == [
        "matched",
        "interpolated",
        "unmatched",
    ]
    assert result.matched_points[0].begin_route_discontinuity is True
    assert result.matched_points[0].end_route_discontinuity is False
    assert result.matched_points[1].begin_route_discontinuity is False
    assert result.matched_points[1].end_route_discontinuity is True
    assert result.matched_points[1].edge_index is None
    assert result.matched_points[1].distance_along_edge is None
    assert result.matched_points[1].distance_from_trace_point is None


def test_malformed_matched_point_is_isolated() -> None:
    raw = {
        "shape": encode_polyline6(SOURCE),
        "edges": [edge()],
        "matched_points": [
            {"point": [77.0, 28.0], "type": "matched"},
            {"point": [77.1, 28.1], "type": "invented"},
            {"point": [77.2, 28.2], "type": "unmatched"},
        ],
    }
    result = normalize_trace_attributes_response(
        raw,
        route_id="osrm:0",
        encoded_polyline=encode_polyline6(SOURCE),
        duration_ms=1,
        http_status=200,
    )

    assert result.status == "partial"
    assert [point.index for point in result.matched_points] == [0, 2]
    assert any(error.kind == "invalid_matched_point" for error in result.errors)


def test_one_trace_route_component_is_continuous_and_preserves_legs() -> None:
    first = [(77.0, 28.0), (77.1, 28.1)]
    second = [(77.1, 28.1), (77.2, 28.2)]
    components, continuity, errors = normalize_trace_route_response(
        {
            "trip": {
                "legs": [
                    {"shape": encode_polyline6(first)},
                    {"shape": encode_polyline6(second)},
                ]
            }
        }
    )

    assert errors == []
    assert continuity.is_continuous is True
    assert continuity.component_count == 1
    assert continuity.break_count == 0
    assert len(components[0].legs) == 2
    assert components[0].legs[0].geometry == first
    assert components[0].legs[1].geometry == second
    assert components[0].geometry == first + second[1:]


def test_trip_plus_alternate_becomes_named_broken_components_with_haversine_gap() -> None:
    first = [(0.0, 0.0), (0.0, 1.0)]
    second = [(0.0, 2.0), (0.0, 3.0)]
    components, continuity, errors = normalize_trace_route_response(
        {
            "trip": {"legs": [{"shape": encode_polyline6(first)}]},
            "alternates": [
                {"trip": {"legs": [{"shape": encode_polyline6(second)}]}}
            ],
        }
    )

    assert errors == []
    assert [component.index for component in components] == [0, 1]
    assert [component.label for component in components] == [
        "Trace Route Component 1",
        "Trace Route Component 2",
    ]
    assert all("Primary" not in component.label for component in components)
    assert all("Alt" not in component.label for component in components)
    assert continuity.is_continuous is False
    assert continuity.component_count == 2
    assert continuity.break_count == 1
    trace_break = continuity.breaks[0]
    assert trace_break.previous_end_coordinate == (0.0, 1.0)
    assert trace_break.next_start_coordinate == (0.0, 2.0)
    assert trace_break.gap_meters == pytest.approx(111_195, abs=100)


@pytest.mark.parametrize(
    ("attributes_ok", "route_ok", "expected_status"),
    [(True, False, "partial"), (False, True, "partial")],
)
def test_trace_endpoint_isolates_partial_failures(
    monkeypatch: pytest.MonkeyPatch,
    attributes_ok: bool,
    route_ok: bool,
    expected_status: str,
) -> None:
    async def fake_call(method: str, url: str, **kwargs: object) -> EngineCallResult:
        is_attributes = url.endswith("/trace_attributes")
        if (is_attributes and attributes_ok) or (not is_attributes and route_ok):
            body = (
                {
                    "shape": encode_polyline6(SOURCE),
                    "edges": [edge()],
                    "matched_points": [
                        {"point": [77.0, 28.0], "type": "matched"}
                    ],
                }
                if is_attributes
                else {
                    "trip": {
                        "legs": [{"shape": encode_polyline6(SOURCE)}]
                    }
                }
            )
            return EngineCallResult(True, httpx.Response(200, json=body), 200, 2, None)
        return EngineCallResult(
            False,
            None,
            None,
            2,
            EngineError(
                kind="unreachable",
                message="endpoint unavailable",
                detail=None,
            ),
        )

    monkeypatch.setattr(routes, "call_engine", fake_call)
    response = client.post(
        "/api/trace/valhalla",
        json={
            "routeId": "osrm:0",
            "encodedPolyline": encode_polyline6(SOURCE),
        },
    )
    body = response.json()

    assert body["status"] == expected_status
    if attributes_ok:
        assert body["traceGeometry"]
        assert body["segments"]
        assert body["matchedPoints"]
        assert body["continuity"]["isContinuous"] is None
        assert any(
            error["kind"] == "trace_route_unreachable"
            for error in body["errors"]
        )
    else:
        assert body["traceGeometry"] == []
        assert body["segments"] == []
        assert body["traceRouteComponents"]
        assert body["continuity"]["isContinuous"] is True
        assert any(
            error["kind"] == "trace_attributes_unreachable"
            for error in body["errors"]
        )

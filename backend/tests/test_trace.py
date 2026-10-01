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
    normalize_trace_attributes_response,
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
    body = build_trace_attributes_body("encoded", "motorcycle")

    assert body["encoded_polyline"] == "encoded"
    assert body["costing"] == "motorcycle"
    assert body["shape_match"] == "map_snap"
    assert body["filters"] == {
        "action": "include",
        "attributes": TRACE_ATTRIBUTES,
    }
    assert {
        "edge.id",
        "edge.way_id",
        "edge.begin_shape_index",
        "edge.end_shape_index",
        "shape",
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
        response = httpx.Response(
            200,
            json={"shape": encode_polyline6(SOURCE), "edges": [edge()]},
        )
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
    assert calls[0][0:2] == ("POST", "http://localhost:8002/trace_attributes")
    assert calls[0][2]["shape_match"] == "map_snap"
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
    assert body["errors"][0]["kind"] == "unreachable"
    assert body["sourceRouteId"] == "osrm:0"

"""Focused tests for normal-route edge debugging in both engines."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app import routes
from app.engines import EngineCallResult
from app.main import app
from app.models import Coordinate
from app.osrm import build_osrm_debug, normalize_osrm_response
from app.valhalla_pbf import (
    build_valhalla_debug,
    build_valhalla_pbf_request,
    normalize_valhalla_pbf_response,
    parse_valhalla_pbf,
)
from app.valhalla_proto import api_pb2, common_pb2, options_pb2, trip_pb2

client = TestClient(app)


def _encode_polyline6(coords: list[tuple[float, float]]) -> str:
    def encode_value(delta: int) -> str:
        value = ~(delta << 1) if delta < 0 else delta << 1
        chars: list[str] = []
        while value >= 0x20:
            chars.append(chr((0x20 | (value & 0x1F)) + 63))
            value >>= 5
        chars.append(chr(value + 63))
        return "".join(chars)

    previous_lat = previous_lon = 0
    result: list[str] = []
    for lon, lat in coords:
        current_lat = round(lat * 1e6)
        current_lon = round(lon * 1e6)
        result.append(encode_value(current_lat - previous_lat))
        result.append(encode_value(current_lon - previous_lon))
        previous_lat, previous_lon = current_lat, current_lon
    return "".join(result)


def _osrm_response(*, bad_nodes: bool = False) -> dict[str, object]:
    coordinates = [(77.0, 12.0), (77.1, 12.1), (77.2, 12.2)]
    return {
        "code": "Ok",
        "routes": [
            {
                "geometry": _encode_polyline6(coordinates),
                "distance": 30.0,
                "duration": 12.0,
                "weight": 15.0,
                "legs": [
                    {
                        "annotation": {
                            "distance": [10.0],
                            "duration": [4.0],
                            "weight": [5.0],
                            "speed": [2.5],
                            "datasources": [0],
                            "nodes": [101] if bad_nodes else [101, 102],
                            "metadata": {"datasource_names": ["live"]},
                        }
                    },
                    {
                        "annotation": {
                            "distance": [20.0],
                            "duration": [8.0],
                            "weight": [10.0],
                            "speed": [2.5],
                            "datasources": [0],
                            "nodes": [102, 103],
                            "metadata": {"datasource_names": ["historical"]},
                        }
                    },
                ],
            }
        ],
    }


def _valhalla_response(*, invalid_index: bool = False) -> api_pb2.Api:
    coordinates = [(77.0, 12.0), (77.1, 12.1), (77.2, 12.2)]
    api = api_pb2.Api()
    directions_route = api.directions.routes.add()
    directions_leg = directions_route.legs.add()
    directions_leg.shape = _encode_polyline6(coordinates)
    directions_leg.summary.length = 1.25
    directions_leg.summary.time = 90.0

    trip_route = api.trip.routes.add()
    trip_leg = trip_route.legs.add()
    trip_leg.shape = _encode_polyline6(coordinates)
    first = trip_leg.node.add()
    first.edge.id = 9007199254740993
    first.edge.way_id = 9007199254740995
    first.edge.length_km = 0.5
    first.edge.speed = 35.0
    first.edge.road_class = common_pb2.kPrimary
    first.edge.begin_shape_index = 0
    first.edge.end_shape_index = 99 if invalid_index else 1
    first.edge.traversability = trip_pb2.TripLeg.kBoth
    first.edge.use = trip_pb2.TripLeg.kRoadUse
    first.edge.spd_lmt = 40
    first.edge.spd_lmt_bike = 20
    first.edge.source_along_edge = 0.25
    first.edge.target_along_edge = 1.0
    first.cost.elapsed_cost.seconds = 10.0
    first.cost.elapsed_cost.cost = 11.0
    first.cost.transition_cost.seconds = 1.0
    first.cost.transition_cost.cost = 2.0

    second = trip_leg.node.add()
    second.edge.id = 42
    second.edge.way_id = 43
    second.edge.begin_shape_index = 1
    second.edge.end_shape_index = 2
    second.cost.elapsed_cost.seconds = 80.0
    second.cost.elapsed_cost.cost = 30.0

    terminal = trip_leg.node.add()
    terminal.cost.elapsed_cost.seconds = 90.0
    terminal.cost.elapsed_cost.cost = 50.0
    return api


def test_osrm_annotations_map_across_leg_offsets() -> None:
    debug = build_osrm_debug(_osrm_response())

    assert debug.status == "ok"
    assert len(debug.segments) == 2
    assert debug.segments[0].coordinates == [(77.0, 12.0), (77.1, 12.1)]
    assert debug.segments[1].coordinates == [(77.1, 12.1), (77.2, 12.2)]
    assert debug.segments[0].properties["fromNodeId"] == "101"
    assert debug.segments[1].properties["datasourceName"] == "historical"


def test_osrm_mismatched_annotation_array_is_rejected() -> None:
    raw = _osrm_response()
    raw["routes"][0]["legs"][1]["annotation"]["speed"].append(3.0)  # type: ignore[index,union-attr]

    debug = build_osrm_debug(raw)

    assert debug.status == "error"
    assert debug.segments == []
    assert debug.errors[0].kind == "debug_alignment_error"


def test_osrm_geometry_annotation_count_mismatch_is_rejected() -> None:
    raw = _osrm_response()
    raw["routes"][0]["geometry"] = _encode_polyline6(  # type: ignore[index]
        [(77.0, 12.0), (77.1, 12.1), (77.2, 12.2), (77.3, 12.3)]
    )

    debug = build_osrm_debug(raw)

    assert debug.status == "error"
    assert debug.segments == []
    assert debug.errors[0].detail == {
        "geometryPointCount": 4,
        "annotationSegmentCount": 2,
    }


def test_osrm_large_node_ids_are_strings() -> None:
    raw = _osrm_response()
    large = 9007199254740993
    raw["routes"][0]["legs"][0]["annotation"]["nodes"] = [large, large + 1]  # type: ignore[index]
    raw["routes"][0]["legs"][1]["annotation"]["nodes"] = [large + 1, large + 2]  # type: ignore[index]

    debug = build_osrm_debug(raw)

    assert debug.segments[0].properties["fromNodeId"] == "9007199254740993"
    assert debug.segments[1].properties["toNodeId"] == "9007199254740995"


def test_osrm_alignment_failure_does_not_change_normal_route() -> None:
    raw = _osrm_response(bad_nodes=True)
    normal = normalize_osrm_response(raw, duration_ms=1.0, http_status=200)
    debug = build_osrm_debug(raw)

    assert len(normal.normalized_routes) == 1
    assert debug.status == "error"
    assert debug.segments == []
    assert debug.errors[0].kind == "debug_alignment_error"


def test_valhalla_pbf_request_contains_verified_route_options() -> None:
    payload = build_valhalla_pbf_request(
        Coordinate(lat=12.0, lon=77.0), Coordinate(lat=12.2, lon=77.2)
    )
    api = parse_valhalla_pbf(payload)

    assert api.options.action == options_pb2.Options.route
    assert api.options.format == options_pb2.Options.pbf
    assert api.options.costing_type == options_pb2.Costing.motorcycle
    assert api.options.units == options_pb2.Options.kilometers
    assert api.options.shape_format == options_pb2.polyline6
    assert api.options.alternates == 10
    assert api.options.date_time_type == options_pb2.Options.current
    assert api.options.date_time == "current"
    assert api.options.costings[options_pb2.Costing.motorcycle].options.flow_mask == 8
    assert api.options.pbf_field_selector.options is True
    assert api.options.pbf_field_selector.trip is True
    assert api.options.pbf_field_selector.directions is True


def test_valhalla_directions_normalize_and_trip_edges_slice_inclusively() -> None:
    api = _valhalla_response()
    result = normalize_valhalla_pbf_response(api, 4.0, 200)
    debug = build_valhalla_debug(api)

    route = result.normalized_routes[0]
    assert result.raw_source == "protobuf-derived"
    assert route.coordinates == [(77.0, 12.0), (77.1, 12.1), (77.2, 12.2)]
    assert route.distance_meters == pytest.approx(1250.0)
    assert route.duration_seconds == 90.0
    assert route.cost == 50.0
    assert debug.status == "ok"
    assert len(debug.segments) == 2
    assert debug.segments[0].coordinates == [(77.0, 12.0), (77.1, 12.1)]
    assert debug.segments[1].coordinates == [(77.1, 12.1), (77.2, 12.2)]
    assert debug.segments[0].properties["id"] == "9007199254740993"
    assert debug.segments[0].properties["wayId"] == "9007199254740995"
    assert debug.segments[0].properties["spdLmt"] == 40
    assert debug.segments[0].properties["nodeCost"]["transitionCost"]["cost"] == 2.0
    # Proto3 scalar defaults are data, not treated as missing.
    assert debug.segments[1].properties["speedLimit"] == 0


def test_valhalla_pbf_summary_matches_json_truncation() -> None:
    api = _valhalla_response()
    api.directions.routes[0].legs[0].summary.length = 1.2349
    api.directions.routes[0].legs[0].summary.time = 90.9876
    api.trip.routes[0].legs[0].node[-1].cost.elapsed_cost.cost = 50.4567

    route = normalize_valhalla_pbf_response(api, 4.0, 200).normalized_routes[0]

    assert route.distance_meters == 1234.0
    assert route.duration_seconds == 90.987
    assert route.cost == 50.456


def test_valhalla_invalid_edge_index_is_debug_only() -> None:
    api = _valhalla_response(invalid_index=True)
    result = normalize_valhalla_pbf_response(api, 4.0, 200)
    debug = build_valhalla_debug(api)

    assert len(result.normalized_routes) == 1
    assert debug.status == "error"
    assert debug.segments == []
    assert debug.errors[0].kind == "debug_alignment_error"


def test_valhalla_zero_length_shape_slice_is_rejected() -> None:
    api = _valhalla_response()
    api.trip.routes[0].legs[0].node[0].edge.end_shape_index = 0

    debug = build_valhalla_debug(api)

    assert debug.status == "error"
    assert debug.segments == []
    assert debug.errors[0].kind == "debug_alignment_error"


def test_valhalla_trip_and_directions_routes_pair_by_order() -> None:
    api = _valhalla_response()
    alternate_coordinates = [(78.0, 13.0), (78.1, 13.1)]
    alternate_directions = api.directions.routes.add()
    alternate_directions.CopyFrom(api.directions.routes[0])
    alternate_directions.legs[0].shape = _encode_polyline6(alternate_coordinates)
    alternate_trip = api.trip.routes.add()
    alternate_trip.CopyFrom(api.trip.routes[0])
    alternate_trip.legs[0].shape = _encode_polyline6(alternate_coordinates)
    del alternate_trip.legs[0].node[1:]
    alternate_trip.legs[0].node[0].edge.begin_shape_index = 0
    alternate_trip.legs[0].node[0].edge.end_shape_index = 1
    alternate_trip.legs[0].node[0].edge.id = 777

    result = normalize_valhalla_pbf_response(api, 4.0, 200)
    debug = build_valhalla_debug(api)

    assert [route.id for route in result.normalized_routes] == [
        "valhalla:0",
        "valhalla:1",
    ]
    assert result.normalized_routes[1].coordinates == alternate_coordinates
    alternate_segments = [segment for segment in debug.segments if segment.route_index == 1]
    assert alternate_segments[0].route_id == "valhalla:1"
    assert alternate_segments[0].properties["id"] == "777"


def test_compare_debug_uses_one_valhalla_pbf_route_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, dict[str, object]]] = []

    async def fake_call_engine(
        method: str, url: str, **kwargs: object
    ) -> EngineCallResult:
        calls.append((method, kwargs))
        if method == "GET":
            response = httpx.Response(200, json=_osrm_response())
        else:
            request_api = parse_valhalla_pbf(kwargs["content"])  # type: ignore[arg-type]
            assert request_api.options.pbf_field_selector.trip
            response = httpx.Response(
                200,
                content=_valhalla_response().SerializeToString(),
                headers={"content-type": "application/x-protobuf"},
            )
        return EngineCallResult(True, response, 200, 3.0, None)

    monkeypatch.setattr(routes, "call_engine", fake_call_engine)
    response = client.post(
        "/api/compare",
        json={
            "start": {"lat": 12.0, "lon": 77.0},
            "dest": {"lat": 12.2, "lon": 77.2},
            "includeDebug": True,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert [method for method, _ in calls] == ["GET", "POST"]
    assert "json" not in calls[1][1]
    assert isinstance(calls[1][1]["content"], bytes)
    assert data["valhalla"]["normalizedRoutes"]
    assert data["valhalla"]["rawSource"] == "protobuf-derived"
    assert data["debug"]["osrm"]["status"] == "ok"
    assert data["debug"]["valhalla"]["status"] == "ok"
    assert len(data["debug"]["valhalla"]["segments"]) == 2


def test_compare_without_debug_preserves_json_path_and_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    valhalla_kwargs: dict[str, object] = {}

    async def fake_call_engine(
        method: str, url: str, **kwargs: object
    ) -> EngineCallResult:
        if method == "GET":
            response = httpx.Response(200, json=_osrm_response())
        else:
            valhalla_kwargs.update(kwargs)
            response = httpx.Response(
                200,
                json={
                    "trip": {
                        "legs": [
                            {
                                "shape": _encode_polyline6(
                                    [(77.0, 12.0), (77.2, 12.2)]
                                )
                            }
                        ],
                        "summary": {"length": 1.0, "time": 10.0, "cost": 2.0},
                    }
                },
            )
        return EngineCallResult(True, response, 200, 3.0, None)

    monkeypatch.setattr(routes, "call_engine", fake_call_engine)
    response = client.post(
        "/api/compare",
        json={
            "start": {"lat": 12.0, "lon": 77.0},
            "dest": {"lat": 12.2, "lon": 77.2},
        },
    )

    assert response.status_code == 200
    assert "debug" not in response.json()
    assert "json" in valhalla_kwargs
    assert "content" not in valhalla_kwargs


def test_compare_debug_failure_does_not_remove_either_route_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_call_engine(
        method: str, url: str, **kwargs: object
    ) -> EngineCallResult:
        if method == "GET":
            response = httpx.Response(200, json=_osrm_response(bad_nodes=True))
        else:
            response = httpx.Response(
                200,
                content=_valhalla_response().SerializeToString(),
                headers={"content-type": "application/x-protobuf"},
            )
        return EngineCallResult(True, response, 200, 3.0, None)

    monkeypatch.setattr(routes, "call_engine", fake_call_engine)
    response = client.post(
        "/api/compare",
        json={
            "start": {"lat": 12.0, "lon": 77.0},
            "dest": {"lat": 12.2, "lon": 77.2},
            "includeDebug": True,
        },
    )

    data = response.json()
    assert data["osrm"]["normalizedRoutes"]
    assert data["valhalla"]["normalizedRoutes"]
    assert data["debug"]["osrm"]["status"] == "error"
    assert data["debug"]["valhalla"]["status"] == "ok"

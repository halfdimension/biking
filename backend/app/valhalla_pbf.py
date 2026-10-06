"""Normal Valhalla ``/route`` protobuf request/response support.

The generated modules in :mod:`app.valhalla_proto` come from the checked-out
custom Valhalla 3.3.0 tree.  A single PBF route response contains both Odin
``Directions`` (for the normal route result) and Thor ``Trip`` edges (for edge
debugging); no trace or map-matching request is involved.
"""

from __future__ import annotations

import math
from typing import Any

from google.protobuf.json_format import MessageToDict
from google.protobuf.message import DecodeError

from app.models import (
    Coordinate,
    DebugError,
    DebugSegment,
    EngineDebugResult,
    EngineError,
    EngineResult,
    NormalizedRoute,
    RouteWarning,
)
from app.polyline import PolylineDecodeError, decode_polyline6
from app.valhalla import DEFAULT_ALTERNATES
from app.valhalla_proto import api_pb2, common_pb2, options_pb2, trip_pb2

_ENGINE = "valhalla"
_CURRENT_FLOW_MASK = 8
_KM_TO_METERS = 1000.0
_BOUNDARY_TOLERANCE = 1e-6


def build_valhalla_pbf_request(start: Coordinate, dest: Coordinate) -> bytes:
    """Serialize the canonical motorcycle route request as this build's PBF."""
    api = api_pb2.Api()
    options = api.options
    options.action = options_pb2.Options.route
    options.format = options_pb2.Options.pbf
    options.costing_type = options_pb2.Costing.motorcycle
    options.units = options_pb2.Options.kilometers
    options.shape_format = options_pb2.polyline6
    options.alternates = DEFAULT_ALTERNATES
    options.date_time_type = options_pb2.Options.current
    options.date_time = "current"

    costing = options.costings[options_pb2.Costing.motorcycle]
    costing.type = options_pb2.Costing.motorcycle
    costing.options.flow_mask = _CURRENT_FLOW_MASK

    for coordinate in (start, dest):
        location = options.locations.add()
        location.ll.lat = coordinate.lat
        location.ll.lng = coordinate.lon
        location.type = common_pb2.Location.kBreak

    # options=true is material in this 3.3.0 build: without it the service can
    # clear the request options before serializing and mislabel the response.
    selector = options.pbf_field_selector
    selector.options = True
    selector.trip = True
    selector.directions = True
    return api.SerializeToString()


def parse_valhalla_pbf(payload: bytes) -> api_pb2.Api:
    """Parse an ``Api`` response, raising a stable ``ValueError`` on failure."""
    api = api_pb2.Api()
    try:
        api.ParseFromString(payload)
    except DecodeError as exc:
        raise ValueError(f"Valhalla returned invalid protobuf: {exc}") from exc
    return api


def _same_coordinate(a: tuple[float, float], b: tuple[float, float]) -> bool:
    return abs(a[0] - b[0]) <= _BOUNDARY_TOLERANCE and abs(
        a[1] - b[1]
    ) <= _BOUNDARY_TOLERANCE


def _decode_directions_route(route: Any) -> list[tuple[float, float]]:
    coordinates: list[tuple[float, float]] = []
    for leg in route.legs:
        leg_coordinates = decode_polyline6(leg.shape)
        if coordinates and leg_coordinates and _same_coordinate(
            coordinates[-1], leg_coordinates[0]
        ):
            coordinates.extend(leg_coordinates[1:])
        else:
            coordinates.extend(leg_coordinates)
    return coordinates


def _api_as_dict(api: api_pb2.Api) -> dict[str, Any]:
    return MessageToDict(api, preserving_proto_field_name=True)


def _json_summary_precision(value: float) -> float:
    """Match this Valhalla build's JSON summary truncation to 3 decimals."""
    return math.trunc(value * 1000.0) / 1000.0


def normalize_valhalla_pbf_response(
    api: api_pb2.Api,
    duration_ms: float,
    http_status: int | None = None,
) -> EngineResult:
    """Normalize PBF ``Directions`` in the same route order as JSON output."""
    raw = _api_as_dict(api)
    if not api.directions.routes:
        return EngineResult(
            engine=_ENGINE,
            status="ok",
            http_status=http_status,
            duration_ms=duration_ms,
            normalized_routes=[],
            raw=raw,
            raw_source="protobuf-derived",
            warnings=[],
            error=EngineError(
                kind="no_route",
                message="Valhalla PBF response is missing directions routes.",
                detail=raw.get("info"),
            ),
        )

    normalized_routes: list[NormalizedRoute] = []
    warnings: list[RouteWarning] = []
    for route_index, directions_route in enumerate(api.directions.routes):
        try:
            coordinates = _decode_directions_route(directions_route)
        except PolylineDecodeError as exc:
            warnings.append(
                RouteWarning(
                    engine=_ENGINE,
                    route_index=route_index,
                    kind="geometry_error",
                    message=(
                        f"Could not decode Valhalla route {route_index} "
                        f"geometry: {exc}"
                    ),
                )
            )
            continue

        distance_meters = _json_summary_precision(
            sum(leg.summary.length for leg in directions_route.legs)
        ) * _KM_TO_METERS
        duration_seconds = _json_summary_precision(
            sum(leg.summary.time for leg in directions_route.legs)
        )
        cost: float | None = None
        if route_index < len(api.trip.routes):
            terminal_costs = [
                leg.node[-1].cost.elapsed_cost.cost
                for leg in api.trip.routes[route_index].legs
                if leg.node
            ]
            if terminal_costs:
                cost = _json_summary_precision(sum(terminal_costs))

        is_primary = route_index == 0
        route_raw: dict[str, Any] = {
            "directions": MessageToDict(
                directions_route, preserving_proto_field_name=True
            )
        }
        if route_index < len(api.trip.routes):
            route_raw["trip"] = MessageToDict(
                api.trip.routes[route_index], preserving_proto_field_name=True
            )
        normalized_routes.append(
            NormalizedRoute(
                id=f"valhalla:{route_index}",
                engine=_ENGINE,
                index=route_index,
                is_primary=is_primary,
                label=(
                    "Valhalla Primary"
                    if is_primary
                    else f"Valhalla Alt {route_index}"
                ),
                coordinates=coordinates,
                distance_meters=distance_meters,
                duration_seconds=duration_seconds,
                cost=cost,
                raw=route_raw,
            )
        )

    if len(api.trip.routes) != len(api.directions.routes):
        warnings.append(
            RouteWarning(
                engine=_ENGINE,
                route_index=0,
                kind="pbf_route_count_mismatch",
                message=(
                    "Valhalla PBF trip/directions route counts differ: "
                    f"{len(api.trip.routes)} trip vs "
                    f"{len(api.directions.routes)} directions."
                ),
            )
        )

    return EngineResult(
        engine=_ENGINE,
        status="ok",
        http_status=http_status,
        duration_ms=duration_ms,
        normalized_routes=normalized_routes,
        raw=raw,
        raw_source="protobuf-derived",
        warnings=warnings,
        error=None,
    )


def _enum_name(enum: Any, value: int) -> str:
    try:
        return enum.Name(value)
    except ValueError:
        return str(value)


def _cost_properties(cost: Any) -> dict[str, dict[str, float]]:
    return {
        "elapsedCost": {
            "seconds": cost.elapsed_cost.seconds,
            "cost": cost.elapsed_cost.cost,
        },
        "transitionCost": {
            "seconds": cost.transition_cost.seconds,
            "cost": cost.transition_cost.cost,
        },
    }


def build_valhalla_debug(api: api_pb2.Api) -> EngineDebugResult:
    """Slice every final-route Trip edge using its inclusive shape indexes."""
    segments: list[DebugSegment] = []
    errors: list[DebugError] = []

    if not api.trip.routes:
        return EngineDebugResult(
            engine=_ENGINE,
            status="error",
            errors=[
                DebugError(
                    kind="debug_missing_trip",
                    message="Valhalla PBF response contains no Trip routes.",
                )
            ],
        )

    for route_index, trip_route in enumerate(api.trip.routes):
        for leg_index, leg in enumerate(trip_route.legs):
            try:
                shape = decode_polyline6(leg.shape)
            except PolylineDecodeError as exc:
                errors.append(
                    DebugError(
                        kind="debug_geometry_error",
                        route_index=route_index,
                        leg_index=leg_index,
                        message=(
                            f"Could not decode Valhalla trip route {route_index} "
                            f"leg {leg_index} shape."
                        ),
                        detail=str(exc),
                    )
                )
                continue

            leg_segments: list[DebugSegment] = []
            leg_error: DebugError | None = None
            for segment_index, node in enumerate(leg.node):
                if not node.HasField("edge"):
                    continue
                edge = node.edge
                begin = edge.begin_shape_index
                end = edge.end_shape_index
                if begin >= end or end >= len(shape):
                    leg_error = DebugError(
                        kind="debug_alignment_error",
                        route_index=route_index,
                        leg_index=leg_index,
                        message=(
                            f"Valhalla route {route_index} leg {leg_index} edge "
                            f"{segment_index} has invalid inclusive shape indexes "
                            f"[{begin}, {end}] for {len(shape)} points."
                        ),
                        detail={
                            "segmentIndex": segment_index,
                            "beginShapeIndex": begin,
                            "endShapeIndex": end,
                            "shapePointCount": len(shape),
                        },
                    )
                    break

                properties: dict[str, Any] = {
                    "id": str(edge.id),
                    "wayId": str(edge.way_id),
                    "name": [name.value for name in edge.name],
                    "lengthKm": edge.length_km,
                    "speed": edge.speed,
                    "roadClass": _enum_name(common_pb2.RoadClass, edge.road_class),
                    "beginShapeIndex": begin,
                    "endShapeIndex": end,
                    "traversability": _enum_name(
                        trip_pb2.TripLeg.Traversability, edge.traversability
                    ),
                    "use": _enum_name(trip_pb2.TripLeg.Use, edge.use),
                    "toll": edge.toll,
                    "unpaved": edge.unpaved,
                    "tunnel": edge.tunnel,
                    "bridge": edge.bridge,
                    "roundabout": edge.roundabout,
                    "surface": _enum_name(trip_pb2.TripLeg.Surface, edge.surface),
                    "density": edge.density,
                    "speedLimit": edge.speed_limit,
                    "defaultSpeed": edge.default_speed,
                    "sourceAlongEdge": edge.source_along_edge,
                    "targetAlongEdge": edge.target_along_edge,
                    # Custom fields in this checked-out fork.  The standard
                    # speed_limit setter is disabled in its TripLegBuilder.
                    "spdLmt": edge.spd_lmt,
                    "spdLmtHgv": edge.spd_lmt_hgv,
                    "spdLmtBike": edge.spd_lmt_bike,
                    "frc": edge.frc,
                    "tollRoad": edge.toll_road,
                    "bikeSpeed": edge.bike_speed,
                    "nodeCost": _cost_properties(node.cost),
                    "sourceNodeCost": _cost_properties(node.cost),
                    "targetNodeCost": (
                        _cost_properties(leg.node[segment_index + 1].cost)
                        if segment_index + 1 < len(leg.node)
                        else None
                    ),
                }
                leg_segments.append(
                    DebugSegment(
                        id=f"valhalla:{route_index}:{leg_index}:{segment_index}",
                        engine=_ENGINE,
                        route_id=f"valhalla:{route_index}",
                        route_index=route_index,
                        leg_index=leg_index,
                        segment_index=segment_index,
                        coordinates=shape[begin : end + 1],
                        properties=properties,
                    )
                )

            if leg_error is not None:
                errors.append(leg_error)
            else:
                segments.extend(leg_segments)

    status = "ok" if not errors else ("partial" if segments else "error")
    return EngineDebugResult(
        engine=_ENGINE,
        status=status,
        segments=segments,
        errors=errors,
    )

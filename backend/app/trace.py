"""Valhalla trace diagnostic request construction and safe normalization."""

from __future__ import annotations

from math import asin, cos, radians, sin, sqrt
from typing import Any

from app.models import (
    DebugError,
    DebugSegment,
    TraceContinuitySummary,
    TraceMatchedPoint,
    TraceRouteBreak,
    TraceRouteComponent,
    TraceRouteLeg,
    TraceWarning,
    ValhallaTraceResponse,
)
from app.polyline import PolylineDecodeError, decode_polyline6


TRACE_ATTRIBUTES = [
    "edge.id",
    "edge.way_id",
    "edge.names",
    "edge.length",
    "edge.speed",
    "edge.road_class",
    "edge.use",
    "edge.surface",
    "edge.density",
    "edge.traversability",
    "edge.toll",
    "edge.unpaved",
    "edge.tunnel",
    "edge.bridge",
    "edge.roundabout",
    "edge.begin_shape_index",
    "edge.end_shape_index",
    "matched.point",
    "matched.type",
    "matched.edge_index",
    "matched.begin_route_discontinuity",
    "matched.end_route_discontinuity",
    "matched.distance_along_edge",
    "matched.distance_from_trace_point",
    "shape",
]


def build_trace_attributes_body(encoded_polyline: str, costing: str) -> dict[str, Any]:
    """Build the fixed, non-arbitrary Valhalla map-snap request."""
    return {
        "encoded_polyline": encoded_polyline,
        "costing": costing,
        "costing_options": {costing: {"speed_types": ["current"]}},
        "date_time": {"type": 0},
        "shape_match": "map_snap",
        "shape_format": "polyline6",
        "filters": {"action": "include", "attributes": TRACE_ATTRIBUTES},
    }


def build_trace_route_body(encoded_polyline: str, costing: str) -> dict[str, Any]:
    """Build the companion path-continuity trace_route request."""
    body = build_trace_attributes_body(encoded_polyline, costing)
    body.pop("filters")
    return body


def _optional_number(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return None


def _normalize_matched_points(
    raw: Any,
) -> tuple[list[TraceMatchedPoint], list[DebugError]]:
    """Normalize usable matched points while isolating malformed records."""
    if raw is None:
        return [], []
    if not isinstance(raw, list):
        return [], [
            DebugError(
                kind="invalid_matched_points",
                message="Valhalla trace matched_points is not an array.",
            )
        ]

    points: list[TraceMatchedPoint] = []
    errors: list[DebugError] = []
    valid_types = {"matched", "interpolated", "unmatched"}
    for index, item in enumerate(raw):
        try:
            if not isinstance(item, dict):
                raise ValueError("record is not an object")
            point = item.get("point")
            # Valhalla 3.3.0 serializes matched coordinates as top-level
            # ``lon``/``lat`` fields. Keep accepting the nested forms used by
            # older responses and fixtures as a compatibility fallback.
            if "lon" in item or "lat" in item:
                lon, lat = item.get("lon"), item.get("lat")
            elif isinstance(point, (list, tuple)) and len(point) >= 2:
                lon, lat = point[0], point[1]
            elif isinstance(point, dict):
                lon, lat = point.get("lon"), point.get("lat")
            else:
                raise ValueError("point is missing")
            if not all(
                isinstance(value, (int, float)) and not isinstance(value, bool)
                for value in (lon, lat)
            ):
                raise ValueError("point coordinates are not numeric")
            point_type = item.get("type")
            if point_type not in valid_types:
                raise ValueError(f"unsupported matched point type: {point_type!r}")
            edge_index = item.get("edge_index")
            if not (isinstance(edge_index, int) and not isinstance(edge_index, bool)):
                edge_index = None
            points.append(
                TraceMatchedPoint(
                    index=index,
                    lon=float(lon),
                    lat=float(lat),
                    type=point_type,
                    edge_index=edge_index,
                    distance_along_edge=_optional_number(
                        item.get("distance_along_edge")
                    ),
                    distance_from_trace_point=_optional_number(
                        item.get("distance_from_trace_point")
                    ),
                    begin_route_discontinuity=(
                        item.get("begin_route_discontinuity") is True
                    ),
                    end_route_discontinuity=(
                        item.get("end_route_discontinuity") is True
                    ),
                )
            )
        except (TypeError, ValueError) as exc:
            errors.append(
                DebugError(
                    kind="invalid_matched_point",
                    message=f"Valhalla matched point {index} could not be normalized.",
                    detail=str(exc),
                )
            )
    return points, errors


def _haversine_meters(
    first: tuple[float, float], second: tuple[float, float]
) -> float:
    """Return great-circle distance for two [lon, lat] coordinates."""
    lon1, lat1 = map(radians, first)
    lon2, lat2 = map(radians, second)
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    hav = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * 6_371_008.8 * asin(sqrt(hav))


def normalize_trace_route_response(
    raw: Any,
) -> tuple[list[TraceRouteComponent], TraceContinuitySummary, list[DebugError]]:
    """Normalize Valhalla 3.3 trip + alternates as path components."""
    errors: list[DebugError] = []
    if not isinstance(raw, dict):
        return [], TraceContinuitySummary(), [
            DebugError(
                kind="trace_route_invalid_response",
                message="Valhalla trace_route returned an invalid JSON object.",
            )
        ]

    component_trips: list[Any] = [raw.get("trip")]
    alternates = raw.get("alternates")
    if isinstance(alternates, list):
        for alternate in alternates:
            component_trips.append(
                alternate.get("trip") if isinstance(alternate, dict) else None
            )

    components: list[TraceRouteComponent] = []
    for source_index, trip in enumerate(component_trips):
        if not isinstance(trip, dict) or not isinstance(trip.get("legs"), list):
            errors.append(
                DebugError(
                    kind="invalid_trace_route_component",
                    message=(
                        f"Valhalla trace_route component {source_index} has no legs array."
                    ),
                    route_index=source_index,
                )
            )
            continue
        legs: list[TraceRouteLeg] = []
        display_geometry: list[tuple[float, float]] = []
        for leg_index, leg in enumerate(trip["legs"]):
            encoded = leg.get("shape") if isinstance(leg, dict) else None
            if not isinstance(encoded, str) or not encoded:
                errors.append(
                    DebugError(
                        kind="invalid_trace_route_leg",
                        message=(
                            f"Valhalla trace_route component {source_index} leg "
                            f"{leg_index} is missing its shape."
                        ),
                        route_index=source_index,
                        leg_index=leg_index,
                    )
                )
                continue
            try:
                geometry = decode_polyline6(encoded)
            except PolylineDecodeError as exc:
                errors.append(
                    DebugError(
                        kind="invalid_trace_route_leg",
                        message=(
                            f"Valhalla trace_route component {source_index} leg "
                            f"{leg_index} has invalid polyline6 geometry."
                        ),
                        route_index=source_index,
                        leg_index=leg_index,
                        detail=str(exc),
                    )
                )
                continue
            if not geometry:
                continue
            legs.append(TraceRouteLeg(leg_index=leg_index, geometry=geometry))
            if display_geometry and display_geometry[-1] == geometry[0]:
                display_geometry.extend(geometry[1:])
            else:
                display_geometry.extend(geometry)
        if legs and display_geometry:
            index = len(components)
            components.append(
                TraceRouteComponent(
                    index=index,
                    label=f"Trace Route Component {index + 1}",
                    geometry=display_geometry,
                    legs=legs,
                )
            )

    if not components:
        errors.append(
            DebugError(
                kind="trace_route_unusable",
                message="Valhalla trace_route produced no usable route components.",
            )
        )
        return [], TraceContinuitySummary(), errors

    breaks: list[TraceRouteBreak] = []
    for break_index, (previous, following) in enumerate(
        zip(components, components[1:])
    ):
        previous_end = previous.geometry[-1]
        next_start = following.geometry[0]
        breaks.append(
            TraceRouteBreak(
                index=break_index,
                previous_component_index=previous.index,
                next_component_index=following.index,
                previous_end_coordinate=previous_end,
                next_start_coordinate=next_start,
                gap_meters=_haversine_meters(previous_end, next_start),
            )
        )
    return components, TraceContinuitySummary(
        is_continuous=len(components) == 1,
        component_count=len(components),
        break_count=len(breaks),
        breaks=breaks,
    ), errors


def _edge_properties(edge: dict[str, Any]) -> dict[str, Any]:
    """Map trace JSON names onto the existing Valhalla debug property shape."""
    names = edge.get("names")
    if isinstance(names, str):
        names = [names]
    elif not isinstance(names, list):
        names = []
    return {
        "id": str(edge.get("id", "")),
        "wayId": str(edge.get("way_id", "")),
        "name": [str(name) for name in names],
        "lengthKm": edge.get("length"),
        "speed": edge.get("speed"),
        "roadClass": edge.get("road_class"),
        "beginShapeIndex": edge.get("begin_shape_index"),
        "endShapeIndex": edge.get("end_shape_index"),
        "traversability": edge.get("traversability"),
        "use": edge.get("use"),
        "toll": edge.get("toll"),
        "unpaved": edge.get("unpaved"),
        "tunnel": edge.get("tunnel"),
        "bridge": edge.get("bridge"),
        "roundabout": edge.get("roundabout"),
        "surface": edge.get("surface"),
        "density": edge.get("density"),
    }


def trace_error_response(
    *,
    route_id: str,
    encoded_polyline: str,
    kind: str,
    message: str,
    detail: Any = None,
    http_status: int | None = None,
    duration_ms: float = 0.0,
) -> ValhallaTraceResponse:
    """Create a structured trace-only failure without touching comparison state."""
    try:
        original = decode_polyline6(encoded_polyline)
    except PolylineDecodeError:
        original = []
    return ValhallaTraceResponse(
        status="error",
        source_route_id=route_id,
        original_geometry=original,
        trace_geometry=[],
        exact_geometry_match=False,
        original_point_count=len(original),
        trace_point_count=0,
        errors=[DebugError(kind=kind, message=message, detail=detail)],
        http_status=http_status,
        duration_ms=duration_ms,
    )


def normalize_trace_attributes_response(
    raw: Any,
    *,
    route_id: str,
    encoded_polyline: str,
    duration_ms: float,
    http_status: int | None,
) -> ValhallaTraceResponse:
    """Decode Valhalla's returned shape and slice edges against that shape only."""
    try:
        original = decode_polyline6(encoded_polyline)
    except PolylineDecodeError as exc:
        return trace_error_response(
            route_id=route_id,
            encoded_polyline=encoded_polyline,
            kind="invalid_source_geometry",
            message="The OSRM source geometry is not valid polyline6.",
            detail=str(exc),
            http_status=http_status,
            duration_ms=duration_ms,
        )

    if not isinstance(raw, dict):
        return trace_error_response(
            route_id=route_id,
            encoded_polyline=encoded_polyline,
            kind="invalid_response",
            message="Valhalla returned an invalid trace response.",
            detail="Expected a JSON object.",
            http_status=http_status,
            duration_ms=duration_ms,
        )

    encoded_trace = raw.get("shape")
    if not isinstance(encoded_trace, str) or not encoded_trace:
        return trace_error_response(
            route_id=route_id,
            encoded_polyline=encoded_polyline,
            kind="missing_shape",
            message="Valhalla trace response is missing its authoritative shape.",
            http_status=http_status,
            duration_ms=duration_ms,
        )
    try:
        trace_geometry = decode_polyline6(encoded_trace)
    except PolylineDecodeError as exc:
        return trace_error_response(
            route_id=route_id,
            encoded_polyline=encoded_polyline,
            kind="invalid_trace_geometry",
            message="Valhalla returned an invalid trace shape.",
            detail=str(exc),
            http_status=http_status,
            duration_ms=duration_ms,
        )

    exact = original == trace_geometry
    warnings: list[TraceWarning] = []
    errors: list[DebugError] = []
    matched_points, matched_errors = _normalize_matched_points(raw.get("matched_points"))
    errors.extend(matched_errors)
    if not exact:
        warnings.append(
            TraceWarning(
                kind="geometry_changed",
                message="Valhalla map_snap changed the source geometry.",
                detail={
                    "originalPointCount": len(original),
                    "tracePointCount": len(trace_geometry),
                },
            )
        )

    raw_edges = raw.get("edges")
    if not isinstance(raw_edges, list):
        return ValhallaTraceResponse(
            status="error",
            source_route_id=route_id,
            original_geometry=original,
            trace_geometry=trace_geometry,
            exact_geometry_match=exact,
            original_point_count=len(original),
            trace_point_count=len(trace_geometry),
            matched_points=matched_points,
            raw_trace_attributes=raw,
            warnings=warnings,
            errors=errors + [
                DebugError(
                    kind="invalid_response",
                    message="Valhalla trace response is missing its edges array.",
                )
            ],
            http_status=http_status,
            duration_ms=duration_ms,
        )

    segments: list[DebugSegment] = []
    for edge_index, edge in enumerate(raw_edges):
        if not isinstance(edge, dict):
            errors.append(
                DebugError(
                    kind="invalid_edge",
                    message=f"Valhalla trace edge {edge_index} is not an object.",
                    route_index=0,
                )
            )
            continue
        begin = edge.get("begin_shape_index")
        end = edge.get("end_shape_index")
        valid = (
            isinstance(begin, int)
            and not isinstance(begin, bool)
            and isinstance(end, int)
            and not isinstance(end, bool)
            and 0 <= begin < end < len(trace_geometry)
        )
        if not valid:
            errors.append(
                DebugError(
                    kind="invalid_shape_indexes",
                    message=(
                        f"Valhalla trace edge {edge_index} has invalid shape indexes; "
                        "no edge geometry was guessed."
                    ),
                    route_index=0,
                    detail={
                        "beginShapeIndex": begin,
                        "endShapeIndex": end,
                        "tracePointCount": len(trace_geometry),
                    },
                )
            )
            continue
        segments.append(
            DebugSegment(
                id=f"trace:{route_id}:{edge_index}",
                engine="valhalla",
                route_id=f"trace:{route_id}",
                route_index=0,
                leg_index=0,
                segment_index=edge_index,
                coordinates=trace_geometry[begin : end + 1],
                properties=_edge_properties(edge),
            )
        )

    if not raw_edges:
        warnings.append(
            TraceWarning(
                kind="zero_edges",
                message="Valhalla returned a trace shape with zero edges.",
            )
        )
    status = "partial" if errors else "ok"
    return ValhallaTraceResponse(
        status=status,
        source_route_id=route_id,
        original_geometry=original,
        trace_geometry=trace_geometry,
        exact_geometry_match=exact,
        original_point_count=len(original),
        trace_point_count=len(trace_geometry),
        segments=segments,
        matched_points=matched_points,
        raw_trace_attributes=raw,
        warnings=warnings,
        errors=errors,
        http_status=http_status,
        duration_ms=duration_ms,
    )

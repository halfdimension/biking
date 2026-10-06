"""Valhalla trace_attributes request construction and safe normalization."""

from __future__ import annotations

from typing import Any

from app.models import DebugError, DebugSegment, TraceWarning, ValhallaTraceResponse
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
        "filters": {"action": "include", "attributes": TRACE_ATTRIBUTES},
    }


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
            warnings=warnings,
            errors=[
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
        warnings=warnings,
        errors=errors,
        http_status=http_status,
        duration_ms=duration_ms,
    )

"""Canonical Mappls production request builders and response extractors."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

from app import config
from app.models import Coordinate


PROD_OSRM_ANNOTATIONS = "nodes,distance,duration,weight,speed,datasources"


def build_prod_osrm_url(start: Coordinate, dest: Coordinate, token: str) -> str:
    coords = f"{start.lon},{start.lat};{dest.lon},{dest.lat}"
    query = urlencode(
        [
            ("steps", "false"),
            ("geometries", "polyline6"),
            ("overview", "full"),
            ("alternatives", "true"),
            ("annotations", PROD_OSRM_ANNOTATIONS),
        ]
    )
    return (
        f"{config.MAPPLS_PROD_OSRM_BASE_URL}/{token}/route_adv/biking/"
        f"{coords}?{query}"
    )


def build_prod_valhalla_url(start: Coordinate, dest: Coordinate, token: str) -> str:
    locations = f"{start.lon},{start.lat};{dest.lon},{dest.lat}"
    query = urlencode(
        [
            ("profile", "biking"),
            ("access_token", token),
            ("locations", locations),
            ("date_time", '0,""'),
            ("speedTypes", "traffic"),
        ]
    )
    return f"{config.MAPPLS_PROD_VALHALLA_URL}?{query}"


def _extract_payload(raw: Any, required_key: str) -> Any:
    """Accept a direct engine body or a small common Mappls envelope."""
    if isinstance(raw, dict) and required_key in raw:
        return raw
    if isinstance(raw, dict):
        for key in ("response", "data", "result"):
            candidate = raw.get(key)
            if isinstance(candidate, dict) and required_key in candidate:
                return candidate
    return raw


def extract_prod_osrm_response(raw: Any) -> Any:
    return _extract_payload(raw, "routes")


def extract_prod_valhalla_response(raw: Any) -> Any:
    return _extract_payload(raw, "trip")

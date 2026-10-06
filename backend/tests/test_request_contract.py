"""Cross-language contract tests for the dashboard's canonical request previews."""

from __future__ import annotations

import json
from pathlib import Path

from app.models import Coordinate
from app.osrm import DEFAULT_OSRM_QUERY, build_default_osrm_url
from app.valhalla import build_default_valhalla_body

_CONTRACT_PATH = (
    Path(__file__).resolve().parents[2]
    / "shared"
    / "canonical_request_defaults.json"
)


def _contract() -> dict:
    return json.loads(_CONTRACT_PATH.read_text(encoding="utf-8"))


def test_backend_osrm_builder_matches_shared_frontend_contract() -> None:
    contract = _contract()
    start = Coordinate(lat=28.78447495380769, lon=76.87892122549387)
    dest = Coordinate(lat=28.207132203283837, lon=77.45894473456683)

    assert DEFAULT_OSRM_QUERY == contract["osrmQuery"]
    assert build_default_osrm_url(start, dest) == (
        "http://localhost:5000/route/v1/biking/"
        f"{start.lon},{start.lat};{dest.lon},{dest.lat}?{contract['osrmQuery']}"
    )


def test_backend_valhalla_builder_matches_shared_frontend_contract() -> None:
    contract = _contract()
    start = Coordinate(lat=28.78447495380769, lon=76.87892122549387)
    dest = Coordinate(lat=28.207132203283837, lon=77.45894473456683)

    assert build_default_valhalla_body(start, dest) == {
        "locations": [
            {"lat": start.lat, "lon": start.lon, "type": "break"},
            {"lat": dest.lat, "lon": dest.lon, "type": "break"},
        ],
        **contract["valhallaOptions"],
    }

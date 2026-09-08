"""Offline example test for the POST /api/compare fan-out (Task 7.1).

De-risks the real-engine checkpoint (Task 8) by exercising the handler's
error-isolation contract without touching the real engines. ``call_engine`` is
monkeypatched so each engine's outcome is deterministic and offline: one engine
returns a mocked 200 with minimal valid JSON, the other returns a mocked
transport-error ``EngineCallResult``. The test asserts that a failure on one
engine never removes or alters the other engine's routes (Req 2.2, 2.3, 17.13).

Both isolation directions are covered:
- OSRM ok + Valhalla unreachable  -> OSRM routes retained, Valhalla error.
- OSRM unreachable + Valhalla ok   -> Valhalla routes retained, OSRM error.

No real HTTP is issued here — real-engine verification is Task 8.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app import routes
from app.engines import EngineCallResult
from app.main import app
from app.models import EngineError

client = TestClient(app)


# --- Test helper: a minimal polyline6 encoder ----------------------------


def _encode_polyline6(coords_lonlat: list[list[float]]) -> str:
    """Encode ``[lon, lat]`` pairs into a polyline6 string.

    Standard Google-polyline zig-zag/varint encoding at factor ``1e6``. The
    conventional algorithm encodes ``(lat, lon)``; our input is ``[lon, lat]``
    (MapLibre order) so we swap back to lat-first for encoding, ensuring the
    string round-trips through the real ``decode_polyline6`` used by the
    normalizers.
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


_OSRM_COORDS = [[77.6, 12.9], [77.61, 12.91], [77.62, 12.92]]
_VALHALLA_COORDS = [[76.87, 28.78], [77.0, 28.5], [77.45, 28.2]]

_COMPARE_BODY = {
    "start": {"lat": 12.9, "lon": 77.6},
    "dest": {"lat": 12.95, "lon": 77.65},
}


def _ok_osrm_call() -> EngineCallResult:
    """A mocked ok 200 OSRM call with one valid polyline6 route."""
    raw = {
        "code": "Ok",
        "routes": [
            {
                "geometry": _encode_polyline6(_OSRM_COORDS),
                "distance": 1234.5,
                "duration": 120.0,
                "weight": 130.0,
            }
        ],
    }
    response = httpx.Response(200, json=raw)
    return EngineCallResult(
        ok=True,
        response=response,
        http_status=200,
        duration_ms=12.0,
        error=None,
    )


def _ok_valhalla_call() -> EngineCallResult:
    """A mocked ok 200 Valhalla call with one valid single-leg trip."""
    raw = {
        "trip": {
            "legs": [{"shape": _encode_polyline6(_VALHALLA_COORDS)}],
            "summary": {"length": 60.0, "time": 3600.0, "cost": 42.0},
        }
    }
    response = httpx.Response(200, json=raw)
    return EngineCallResult(
        ok=True,
        response=response,
        http_status=200,
        duration_ms=15.0,
        error=None,
    )


def _unreachable_call() -> EngineCallResult:
    """A mocked ConnectError-style (unreachable) call result.

    Mirrors what ``call_engine`` produces when httpx raises a
    :class:`httpx.ConnectError`: no response, ``unreachable`` error, ``ok`` False.
    """
    return EngineCallResult(
        ok=False,
        response=None,
        http_status=None,
        duration_ms=0.0,
        error=EngineError(
            kind="unreachable",
            message="Could not reach the engine.",
            detail="ConnectError: connection refused",
        ),
    )


def _patch_call_engine(
    monkeypatch: pytest.MonkeyPatch,
    *,
    osrm: EngineCallResult,
    valhalla: EngineCallResult,
) -> None:
    """Patch ``app.routes.call_engine`` to route by method to a fixed result.

    The compare handler calls OSRM via ``GET`` and Valhalla via ``POST``, so the
    HTTP method uniquely identifies which engine is being called. No real
    network request is issued.
    """

    async def fake_call_engine(method: str, url: str, **kwargs: object) -> EngineCallResult:
        return osrm if method.upper() == "GET" else valhalla

    monkeypatch.setattr(routes, "call_engine", fake_call_engine)


def test_compare_isolates_valhalla_failure_from_osrm_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """OSRM ok, Valhalla unreachable: OSRM routes are retained (Req 17.13)."""
    _patch_call_engine(
        monkeypatch, osrm=_ok_osrm_call(), valhalla=_unreachable_call()
    )

    response = client.post("/api/compare", json=_COMPARE_BODY)

    assert response.status_code == 200
    data = response.json()

    # OSRM succeeded and its routes survived the sibling's failure.
    assert data["osrm"]["status"] == "ok"
    assert len(data["osrm"]["normalizedRoutes"]) >= 1
    assert data["osrm"]["normalizedRoutes"][0]["engine"] == "osrm"

    # Valhalla failed independently with the classified unreachable error.
    assert data["valhalla"]["status"] == "error"
    assert data["valhalla"]["error"]["kind"] == "unreachable"
    assert data["valhalla"]["normalizedRoutes"] == []


def test_compare_isolates_osrm_failure_from_valhalla_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Reverse isolation: OSRM unreachable, Valhalla ok (Req 17.13)."""
    _patch_call_engine(
        monkeypatch, osrm=_unreachable_call(), valhalla=_ok_valhalla_call()
    )

    response = client.post("/api/compare", json=_COMPARE_BODY)

    assert response.status_code == 200
    data = response.json()

    # Valhalla succeeded and its routes survived the sibling's failure.
    assert data["valhalla"]["status"] == "ok"
    assert len(data["valhalla"]["normalizedRoutes"]) >= 1
    assert data["valhalla"]["normalizedRoutes"][0]["engine"] == "valhalla"

    # OSRM failed independently with the classified unreachable error.
    assert data["osrm"]["status"] == "error"
    assert data["osrm"]["error"]["kind"] == "unreachable"
    assert data["osrm"]["normalizedRoutes"] == []

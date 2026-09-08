"""Offline example tests for the raw forwarding endpoints (Task 9.1).

De-risk the optional verbatim-forwarding property test (Task 9.2) by exercising
``POST /api/osrm/raw`` and ``POST /api/valhalla/raw`` without touching the real
engines. ``app.routes.call_engine`` is monkeypatched with a capturing fake so
each outcome is deterministic and offline, and the fake records exactly what the
handler forwarded — the OSRM URL (verbatim) and the Valhalla ``json=`` body
(verbatim) — so we can assert no reconstruction or default substitution occurs
(Req 9.4, 9.5, 9.6, 9.7).

One test uses the REAL ``call_engine`` (no monkeypatch) with a clearly
non-allowlisted host: the allowlist is enforced pre-flight, so the host is
refused before any request is issued — this is offline-safe and proves the
endpoint surfaces ``invalid_request`` without executing anything (Req 10.4,
19.1).
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


class _Capture:
    """Records the arguments the handler forwarded to ``call_engine``."""

    def __init__(self, result: EngineCallResult) -> None:
        self.result = result
        self.method: str | None = None
        self.url: str | None = None
        self.json: object | None = None
        self.called = False

    async def __call__(
        self, method: str, url: str, **kwargs: object
    ) -> EngineCallResult:
        self.called = True
        self.method = method
        self.url = url
        self.json = kwargs.get("json")
        return self.result


def _ok_osrm_result() -> EngineCallResult:
    """A mocked ok 200 OSRM call with one valid polyline6 route (code Ok)."""
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
    return EngineCallResult(
        ok=True,
        response=httpx.Response(200, json=raw),
        http_status=200,
        duration_ms=11.0,
        error=None,
    )


def _ok_valhalla_result() -> EngineCallResult:
    """A mocked ok 200 Valhalla trip with one valid single leg (miles units)."""
    raw = {
        "trip": {
            "legs": [{"shape": _encode_polyline6(_VALHALLA_COORDS)}],
            # No trip.units here: the request_units context ("miles") must be
            # used so length converts via the miles factor.
            "summary": {"length": 10.0, "time": 3600.0, "cost": 42.0},
        }
    }
    return EngineCallResult(
        ok=True,
        response=httpx.Response(200, json=raw),
        http_status=200,
        duration_ms=17.0,
        error=None,
    )


def _invalid_request_result() -> EngineCallResult:
    """A mocked ``invalid_request`` result, as the real call layer produces for
    a non-allowlisted host (no request issued)."""
    return EngineCallResult(
        ok=False,
        response=None,
        http_status=None,
        duration_ms=0.0,
        error=EngineError(
            kind="invalid_request",
            message="Target host is not allowed.",
            detail="host 'example.com:9999' is not in the allowlist",
        ),
    )


# --- OSRM raw ------------------------------------------------------------


def test_osrm_raw_forwards_exact_url_and_normalizes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Allowlisted URL + ok 200 -> ok envelope; URL forwarded verbatim (Req 9.5)."""
    capture = _Capture(_ok_osrm_result())
    monkeypatch.setattr(routes, "call_engine", capture)

    # A deliberately custom URL with non-default params: it must be forwarded
    # exactly, with no reconstruction of query parameters.
    url = (
        "http://localhost:5000/route/v1/biking/"
        "77.6,12.9;77.65,12.95?overview=simplified&alternatives=false&steps=false"
    )
    response = client.post("/api/osrm/raw", json={"url": url})

    assert response.status_code == 200
    data = response.json()
    assert data["engine"] == "osrm"
    assert data["status"] == "ok"
    assert len(data["normalizedRoutes"]) >= 1
    assert data["normalizedRoutes"][0]["engine"] == "osrm"

    # Verbatim: GET, and the exact input URL with no modification.
    assert capture.called is True
    assert capture.method == "GET"
    assert capture.url == url


def test_osrm_raw_invalid_request_is_surfaced_not_executed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A simulated ``invalid_request`` call yields an error envelope, no routes."""
    capture = _Capture(_invalid_request_result())
    monkeypatch.setattr(routes, "call_engine", capture)

    response = client.post(
        "/api/osrm/raw", json={"url": "http://example.com:9999/route/v1/biking/x"}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["engine"] == "osrm"
    assert data["status"] == "error"
    assert data["error"]["kind"] == "invalid_request"
    assert data["normalizedRoutes"] == []


def test_osrm_raw_real_call_rejects_non_allowlisted_host_offline() -> None:
    """REAL call_engine (no monkeypatch): a non-allowlisted host is refused
    pre-flight, so no network is attempted — offline-safe (Req 10.4, 19.1)."""
    response = client.post(
        "/api/osrm/raw", json={"url": "http://example.com:9999/x"}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["engine"] == "osrm"
    assert data["status"] == "error"
    assert data["error"]["kind"] == "invalid_request"
    assert data["normalizedRoutes"] == []
    # No request was issued: duration is zero and no HTTP status was recorded.
    assert data["httpStatus"] is None
    assert data["durationMs"] == 0.0


# --- Valhalla raw --------------------------------------------------------


def test_valhalla_raw_forwards_exact_body_and_units_flow_through(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Allowlisted URL + ok 200 -> ok envelope; body forwarded verbatim with a
    custom ``costing`` preserved and ``units="miles"`` flowing through as the
    request-unit context so distance converts via the miles factor (Req 9.7, 7.3)."""
    capture = _Capture(_ok_valhalla_result())
    monkeypatch.setattr(routes, "call_engine", capture)

    body = {
        "locations": [
            {"lat": 12.9, "lon": 77.6, "type": "break"},
            {"lat": 12.95, "lon": 77.65, "type": "break"},
        ],
        "costing": "motorcycle",
        "alternates": 3,
        "shape_format": "polyline6",
        "directions_options": {"units": "miles"},
    }
    response = client.post(
        "/api/valhalla/raw",
        json={"url": "http://localhost:8002/route", "body": body},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["engine"] == "valhalla"
    assert data["status"] == "ok"
    assert len(data["normalizedRoutes"]) >= 1
    assert data["normalizedRoutes"][0]["engine"] == "valhalla"

    # units="miles" flowed through as request_units: 10 miles -> 16093.44 m.
    assert data["normalizedRoutes"][0]["distanceMeters"] == pytest.approx(16093.44)

    # Verbatim: POST, exact URL, and the exact body object passed as json=.
    assert capture.called is True
    assert capture.method == "POST"
    assert capture.url == "http://localhost:8002/route"
    assert capture.json == body


def test_valhalla_raw_preserves_custom_costing_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A user body with ``costing="motorcycle"`` (and other options) is forwarded
    with no default substitution (Req 9.7)."""
    capture = _Capture(_ok_valhalla_result())
    monkeypatch.setattr(routes, "call_engine", capture)

    body = {
        "locations": [
            {"lat": 1.0, "lon": 2.0, "type": "break"},
            {"lat": 3.0, "lon": 4.0, "type": "break"},
        ],
        "costing": "motorcycle",
        "costing_options": {"motorcycle": {"use_highways": 0.1}},
    }
    response = client.post(
        "/api/valhalla/raw",
        json={"url": "http://localhost:8002/route", "body": body},
    )

    assert response.status_code == 200

    # The fake received the body unchanged — no costing/options substitution.
    assert capture.json == body
    assert capture.json["costing"] == "motorcycle"
    assert capture.json["costing_options"] == {"motorcycle": {"use_highways": 0.1}}

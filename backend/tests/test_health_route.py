"""Tests for the GET /api/health handler (Task 4.3, Req 16).

Uses FastAPI's TestClient and patches the underlying probe so the check is
deterministic and offline (the real engines are not assumed running here).
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app import engines
from app.main import app

client = TestClient(app)


def test_health_endpoint_reports_mixed_via_mock_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """OSRM returns 404 (reachable), Valhalla refuses (unreachable)."""

    def osrm_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    def valhalla_handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    async def patched_probe_engines() -> dict[str, str]:
        return await engines.probe_engines(
            osrm_transport=httpx.MockTransport(osrm_handler),
            valhalla_transport=httpx.MockTransport(valhalla_handler),
        )

    # The route module imported probe_engines by name; patch it there.
    monkeypatch.setattr("app.routes.probe_engines", patched_probe_engines)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"osrm": "reachable", "valhalla": "unreachable"}


def test_health_endpoint_both_reachable_on_any_http_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def any_response(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400)

    async def patched_probe_engines() -> dict[str, str]:
        return await engines.probe_engines(
            osrm_transport=httpx.MockTransport(any_response),
            valhalla_transport=httpx.MockTransport(any_response),
        )

    monkeypatch.setattr("app.routes.probe_engines", patched_probe_engines)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"osrm": "reachable", "valhalla": "reachable"}

"""Tests for CORS behavior on the backend (local-only dev dashboard).

Regression coverage for a real CORS bug: the app previously allowed only the
single origin ``http://localhost:5173``, so a browser served from any other
common local origin (``http://127.0.0.1:5173``, the ``vite preview`` port
``:4173``, etc.) had its ``/api/health`` and ``/api/compare`` requests blocked
with "No 'Access-Control-Allow-Origin' header".

The middleware now accepts any ``localhost``/``127.0.0.1`` origin on any port
via a regex. These tests assert the ``access-control-allow-origin`` header is
present and echoes the request Origin for the common local origins, including
a preflight OPTIONS to ``/api/compare``.

Note: Starlette's CORSMiddleware only adds the ACAO header when an ``Origin``
header is present and matches the configured policy, so every request below
sends an explicit ``Origin`` header.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:4173",
    ],
)
def test_health_echoes_allow_origin_for_local_origins(origin: str) -> None:
    """GET /api/health returns ACAO echoing common local origins."""
    response = client.get("/api/health", headers={"Origin": origin})

    # The route may report engines as reachable/unreachable depending on the
    # environment; the request itself must not be a CORS/server error and the
    # allow-origin header must be present and echo the request origin.
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin


def test_compare_preflight_allows_local_preview_origin() -> None:
    """Preflight OPTIONS /api/compare is allowed for the preview origin."""
    response = client.options(
        "/api/compare",
        headers={
            "Origin": "http://127.0.0.1:4173",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert (
        response.headers.get("access-control-allow-origin")
        == "http://127.0.0.1:4173"
    )


def test_non_local_origin_is_not_allowed() -> None:
    """A non-local origin must not receive an allow-origin echo."""
    response = client.get(
        "/api/health", headers={"Origin": "http://evil.example.com"}
    )

    assert response.headers.get("access-control-allow-origin") != (
        "http://evil.example.com"
    )

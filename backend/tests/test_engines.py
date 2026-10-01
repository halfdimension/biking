"""Unit tests for the engine call wrapper, error classification, and health
probe (Task 4.1, 4.2, 4.3).

All tests are offline and deterministic: outbound HTTP is simulated with
:class:`httpx.MockTransport` (respx is not a dependency). The real engines are
not assumed to be running — that is covered by the Task 8 checkpoint.
"""

from __future__ import annotations

import httpx
import pytest

from app import config
from app.engines import (
    EngineCallResult,
    HostNotAllowedError,
    call_engine,
    is_host_allowed,
    probe_engines,
    probe_reachable,
)

ALLOWED_URL = f"{config.OSRM_BASE_URL}/route/v1/biking/0,0;1,1"


# --- Task 4.1: host allowlist + wrapper ----------------------------------


def test_is_host_allowed_accepts_allowlisted_hosts() -> None:
    assert is_host_allowed("http://localhost:5000/route") is True
    assert is_host_allowed("http://localhost:8002/route") is True


def test_is_host_allowed_rejects_other_hosts_and_ports() -> None:
    assert is_host_allowed("http://localhost:9999/route") is False
    assert is_host_allowed("http://evil.example.com/route") is False
    # Port matters: bare host without the allowlisted port is not allowed.
    assert is_host_allowed("http://localhost/route") is False


async def test_call_engine_allowlisted_200_is_ok() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == ALLOWED_URL
        return httpx.Response(200, json={"code": "Ok"})

    result = await call_engine(
        "GET", ALLOWED_URL, transport=httpx.MockTransport(handler)
    )

    assert isinstance(result, EngineCallResult)
    assert result.ok is True
    assert result.http_status == 200
    assert result.error is None
    assert result.duration_ms >= 0.0


async def test_call_engine_posts_json_body() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["content"] = request.content
        return httpx.Response(200, json={"trip": {}})

    url = f"{config.VALHALLA_BASE_URL}/route"
    result = await call_engine(
        "POST",
        url,
        json={"costing": "motorcycle"},
        transport=httpx.MockTransport(handler),
    )

    assert result.ok is True
    assert captured["method"] == "POST"
    assert b"motorcycle" in captured["content"]  # type: ignore[operator]


async def test_call_engine_posts_protobuf_bytes_and_headers() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["content"] = request.content
        captured["content_type"] = request.headers.get("content-type")
        return httpx.Response(200, content=b"response")

    result = await call_engine(
        "POST",
        f"{config.VALHALLA_BASE_URL}/route",
        content=b"protobuf-request",
        headers={"Content-Type": "application/x-protobuf"},
        transport=httpx.MockTransport(handler),
    )

    assert result.ok is True
    assert captured == {
        "content": b"protobuf-request",
        "content_type": "application/x-protobuf",
    }


# --- Task 4.2: error classification --------------------------------------


async def test_non_2xx_classified_as_http_error_with_status() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    result = await call_engine(
        "GET", ALLOWED_URL, transport=httpx.MockTransport(handler)
    )

    assert result.ok is False
    assert result.error is not None
    assert result.error.kind == "http_error"
    assert result.http_status == 500
    # The response is retained so callers can preserve its raw body.
    assert result.response is not None


async def test_connect_error_classified_as_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    result = await call_engine(
        "GET", ALLOWED_URL, transport=httpx.MockTransport(handler)
    )

    assert result.ok is False
    assert result.error is not None
    assert result.error.kind == "unreachable"
    assert result.http_status is None


async def test_timeout_exception_classified_as_timeout() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    result = await call_engine(
        "GET", ALLOWED_URL, transport=httpx.MockTransport(handler)
    )

    assert result.ok is False
    assert result.error is not None
    assert result.error.kind == "timeout"
    assert result.http_status is None


async def test_non_allowlisted_host_is_invalid_request_and_issues_no_request() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        nonlocal called
        called = True
        return httpx.Response(200)

    bad_url = "http://localhost:9999/route/v1/biking/0,0;1,1"
    result = await call_engine(
        "GET", bad_url, transport=httpx.MockTransport(handler)
    )

    assert called is False  # no request was ever issued
    assert result.ok is False
    assert result.error is not None
    assert result.error.kind == "invalid_request"
    assert result.duration_ms == 0.0


async def test_request_engine_raises_before_issuing_for_bad_host() -> None:
    from app.engines import request_engine

    called = False

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        nonlocal called
        called = True
        return httpx.Response(200)

    with pytest.raises(HostNotAllowedError):
        await request_engine(
            "GET",
            "http://localhost:1234/x",
            transport=httpx.MockTransport(handler),
        )
    assert called is False


# --- Task 4.3: health probe (Req 16) -------------------------------------


async def test_probe_reachable_treats_404_as_reachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="not found")

    ok = await probe_reachable(
        config.OSRM_BASE_URL, transport=httpx.MockTransport(handler)
    )
    assert ok is True


async def test_probe_reachable_treats_400_as_reachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400)

    ok = await probe_reachable(
        config.OSRM_BASE_URL, transport=httpx.MockTransport(handler)
    )
    assert ok is True


async def test_probe_reachable_connect_error_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    ok = await probe_reachable(
        config.OSRM_BASE_URL, transport=httpx.MockTransport(handler)
    )
    assert ok is False


async def test_probe_reachable_timeout_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    ok = await probe_reachable(
        config.OSRM_BASE_URL, transport=httpx.MockTransport(handler)
    )
    assert ok is False


async def test_probe_engines_mixed_reachability() -> None:
    def osrm_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)  # any HTTP response => reachable

    def valhalla_handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    statuses = await probe_engines(
        osrm_transport=httpx.MockTransport(osrm_handler),
        valhalla_transport=httpx.MockTransport(valhalla_handler),
    )

    assert statuses == {"osrm": "reachable", "valhalla": "unreachable"}

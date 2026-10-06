from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

import asyncio
import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import config, routes
from app.engines import EngineCallResult, call_engine, is_host_allowed, redact_sensitive, redact_url
from app.main import app
from app.models import CompareRequest, Coordinate, EngineError
from app.prod import (
    PROD_OSRM_ANNOTATIONS,
    build_prod_osrm_url,
    build_prod_valhalla_url,
    extract_prod_osrm_response,
    extract_prod_valhalla_response,
)
from tests.test_compare import _ok_osrm_call, _ok_valhalla_call

client = TestClient(app)
START = Coordinate(lat=28.651770012429765, lon=77.36783435642826)
DEST = Coordinate(lat=28.631769137973578, lon=77.11696030930938)
BODY = {"start": START.model_dump(), "dest": DEST.model_dump()}
TOKEN = "TEST_TOKEN_DO_NOT_USE"


def test_compare_request_target_defaults_and_validation() -> None:
    assert CompareRequest(**BODY).target == "local"
    assert CompareRequest(**BODY, target="local").target == "local"
    assert CompareRequest(**BODY, target="prod").target == "prod"
    with pytest.raises(ValidationError):
        CompareRequest(**BODY, target="staging")


def test_compare_endpoint_rejects_invalid_target() -> None:
    response = client.post("/api/compare", json={**BODY, "target": "staging"})
    assert response.status_code == 422


def test_prod_osrm_builder_semantics() -> None:
    parsed = urlsplit(build_prod_osrm_url(START, DEST, TOKEN))
    query = parse_qs(parsed.query)
    assert parsed.hostname == config.CANONICAL_PROD_HOST
    assert f"/v1/{TOKEN}/route_adv/biking/" in parsed.path
    assert parsed.path.endswith(
        "77.36783435642826,28.651770012429765;"
        "77.11696030930938,28.631769137973578"
    )
    assert query == {
        "steps": ["false"],
        "geometries": ["polyline6"],
        "overview": ["full"],
        "alternatives": ["true"],
        "annotations": [PROD_OSRM_ANNOTATIONS],
    }


def test_prod_valhalla_builder_semantics() -> None:
    parsed = urlsplit(build_prod_valhalla_url(START, DEST, TOKEN))
    query = parse_qs(parsed.query)
    assert parsed.hostname == config.CANONICAL_PROD_HOST
    assert parsed.path == "/advancedmaps/v2/route"
    assert query == {
        "profile": ["biking"],
        "access_token": [TOKEN],
        "locations": [
            "77.36783435642826,28.651770012429765;"
            "77.11696030930938,28.631769137973578"
        ],
        "date_time": ['0,""'],
        "speedTypes": ["traffic"],
    }


def test_prod_extractors_accept_direct_and_small_envelopes() -> None:
    osrm = {"code": "Ok", "routes": []}
    valhalla = {"trip": {}}
    assert extract_prod_osrm_response(osrm) is osrm
    assert extract_prod_osrm_response({"data": osrm}) is osrm
    assert extract_prod_valhalla_response(valhalla) is valhalla
    assert extract_prod_valhalla_response({"response": valhalla}) is valhalla


def test_explicit_local_target_preserves_exact_canonical_requests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[tuple[str, str, object]] = []

    async def fake(method: str, url: str, **kwargs: object) -> EngineCallResult:
        seen.append((method, url, kwargs.get("json")))
        return _ok_osrm_call() if method == "GET" else _ok_valhalla_call()

    monkeypatch.setattr(routes, "call_engine", fake)
    data = client.post("/api/compare", json={**BODY, "target": "local"}).json()
    assert data["routingTarget"] == "local"
    assert seen[0] == (
        "GET",
        "http://localhost:5000/route/v1/biking/"
        "77.36783435642826,28.651770012429765;"
        "77.11696030930938,28.631769137973578?"
        "overview=full&geometries=polyline6&alternatives=true&"
        "annotations=nodes,distance,duration,weight,speed,datasources&steps=true",
        None,
    )
    assert seen[1] == (
        "POST",
        "http://localhost:8002/route",
        {
            "locations": [
                {"lat": START.lat, "lon": START.lon, "type": "break"},
                {"lat": DEST.lat, "lon": DEST.lon, "type": "break"},
            ],
            "costing": "motorcycle",
            "alternates": 10,
            "shape_format": "polyline6",
            "directions_options": {"units": "kilometers"},
            "costing_options": {"motorcycle": {"speed_types": ["current"]}},
            "date_time": {"type": 0},
        },
    )


def test_prod_compare_missing_token_is_clean_and_per_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "MAPPLS_PROD_ACCESS_TOKEN", None)

    async def should_not_call(*args: object, **kwargs: object) -> EngineCallResult:
        raise AssertionError("no production request should be issued")

    monkeypatch.setattr(routes, "call_engine", should_not_call)
    response = client.post("/api/compare", json={**BODY, "target": "prod", "includeDebug": True})
    assert response.status_code == 200
    data = response.json()
    assert data["routingTarget"] == "prod"
    assert "debug" not in data
    for engine in ("osrm", "valhalla"):
        assert data[engine]["status"] == "error"
        assert data[engine]["error"]["kind"] == "invalid_request"
        assert data[engine]["error"]["message"] == (
            "Production Mappls access token is not configured on the backend."
        )


def test_prod_compare_uses_get_and_reuses_normalizers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "MAPPLS_PROD_ACCESS_TOKEN", TOKEN)
    calls: list[tuple[str, str, object]] = []

    async def fake(method: str, url: str, **kwargs: object) -> EngineCallResult:
        calls.append((method, url, kwargs.get("allowed_hosts")))
        return _ok_osrm_call() if "/route_adv/" in url else _ok_valhalla_call()

    monkeypatch.setattr(routes, "call_engine", fake)
    response = client.post("/api/compare", json={**BODY, "target": "prod"})
    assert response.status_code == 200
    data = response.json()
    assert data["routingTarget"] == "prod"
    assert [route["id"] for route in data["osrm"]["normalizedRoutes"]] == ["osrm:0"]
    assert [route["id"] for route in data["valhalla"]["normalizedRoutes"]] == ["valhalla:0"]
    assert len(calls) == 2
    assert all(method == "GET" for method, _, _ in calls)
    assert all(allowed == config.CANONICAL_PROD_ALLOWED_HOSTS for _, _, allowed in calls)
    assert any("steps=false" in url for _, url, _ in calls)
    assert not any("steps=true" in url for _, url, _ in calls)


@pytest.mark.parametrize("status", [401, 403, 500, 503])
def test_prod_http_errors_are_isolated_and_redacted(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    monkeypatch.setattr(config, "MAPPLS_PROD_ACCESS_TOKEN", TOKEN)

    async def fake(method: str, url: str, **kwargs: object) -> EngineCallResult:
        if "/route_adv/" in url:
            return _ok_osrm_call()
        response = httpx.Response(status, json={"error": f"upstream rejected {TOKEN}"})
        return EngineCallResult(
            ok=False,
            response=response,
            http_status=status,
            duration_ms=3.0,
            error=EngineError(
                kind="http_error",
                message=f"{redact_url(url)} returned HTTP {status}.",
            ),
        )

    monkeypatch.setattr(routes, "call_engine", fake)
    data = client.post("/api/compare", json={**BODY, "target": "prod"}).json()
    assert data["osrm"]["status"] == "ok"
    assert data["valhalla"]["status"] == "error"
    assert data["valhalla"]["httpStatus"] == status
    assert TOKEN not in str(data)
    assert "<REDACTED>" in str(data["valhalla"]["raw"])


def test_prod_invalid_json_and_no_routes_are_structured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "MAPPLS_PROD_ACCESS_TOKEN", TOKEN)

    async def fake(method: str, url: str, **kwargs: object) -> EngineCallResult:
        response = (
            httpx.Response(200, content=b"not-json")
            if "/route_adv/" in url
            else httpx.Response(200, json={"error": "No path"})
        )
        return EngineCallResult(True, response, 200, 2.0, None)

    monkeypatch.setattr(routes, "call_engine", fake)
    data = client.post("/api/compare", json={**BODY, "target": "prod"}).json()
    assert data["osrm"]["status"] == "error"
    assert data["osrm"]["error"]["kind"] == "invalid_response"
    assert data["valhalla"]["status"] == "ok"
    assert data["valhalla"]["error"]["kind"] == "no_route"


def test_prod_timeout_message_redacts_both_token_positions() -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("secret transport detail", request=request)

    transport = httpx.MockTransport(timeout)
    osrm = asyncio.run(call_engine(
        "GET", build_prod_osrm_url(START, DEST, TOKEN), transport=transport,
        allowed_hosts=config.CANONICAL_PROD_ALLOWED_HOSTS,
    ))
    valhalla = asyncio.run(call_engine(
        "GET", build_prod_valhalla_url(START, DEST, TOKEN), transport=transport,
        allowed_hosts=config.CANONICAL_PROD_ALLOWED_HOSTS,
    ))
    assert TOKEN not in osrm.error.message
    assert TOKEN not in valhalla.error.message
    assert "/v1/<REDACTED>/route_adv/" in osrm.error.message
    assert "access_token=<REDACTED>" in valhalla.error.message
    assert osrm.error.detail is None and valhalla.error.detail is None


def test_prod_host_is_not_available_to_raw_forwarding() -> None:
    assert is_host_allowed(build_prod_osrm_url(START, DEST, TOKEN)) is False


def test_recursive_redaction_removes_echoed_token() -> None:
    raw = {"url": f"x/{TOKEN}", "nested": [TOKEN, {"value": TOKEN}]}
    assert TOKEN not in str(redact_sensitive(raw, [TOKEN]))

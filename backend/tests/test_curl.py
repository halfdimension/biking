"""Tests for curl parsing and the POST /api/curl/import handler (Task 10.1).

Two layers are covered, all offline and deterministic:

- :func:`app.curlparse.parse_curl` is tested directly with no network — the
  exact OSRM and Valhalla curl examples from the requirements/design, plus the
  critical SAFETY guarantee that shell metacharacters (``$(...)``, backticks,
  ``; rm -rf`` …) are only tokenized by ``shlex`` and NEVER executed.
- The endpoint is tested with ``app.routes.call_engine`` monkeypatched so the
  execute path issues no real HTTP: happy paths for OSRM and Valhalla, plus the
  reject-without-executing paths (non-allowlisted host, malformed/URL-less curl,
  invalid Valhalla JSON body) which must return HTTP 400 and never call
  ``call_engine`` (Req 10.2-10.5, 17.7).
"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import routes
from app.curlparse import CurlParseError, parse_curl
from app.engines import EngineCallResult
from app.main import app

client = TestClient(app)


# --- Exact examples from the requirements / design -----------------------

OSRM_CURL = (
    "curl 'http://localhost:5000/route/v1/biking/"
    "76.87892122549387,28.78447495380769;"
    "77.45894473456683,28.207132203283837?overview=full&geometries=polyline6"
    "&alternatives=true&annotations=nodes,distance,duration,weight,speed,"
    "datasources&steps=true'"
)
OSRM_URL = (
    "http://localhost:5000/route/v1/biking/"
    "76.87892122549387,28.78447495380769;"
    "77.45894473456683,28.207132203283837?overview=full&geometries=polyline6"
    "&alternatives=true&annotations=nodes,distance,duration,weight,speed,"
    "datasources&steps=true"
)

_VALHALLA_BODY = {
    "locations": [
        {"lat": 28.784, "lon": 76.878, "type": "break"},
        {"lat": 28.207, "lon": 77.458, "type": "break"},
    ],
    "costing": "motorcycle",
    "alternates": 10,
    "shape_format": "polyline6",
    "directions_options": {"units": "kilometers"},
}
VALHALLA_CURL = (
    "curl -X POST 'http://localhost:8002/route' "
    "-H 'Content-Type: application/json' "
    f"-d '{json.dumps(_VALHALLA_BODY)}'"
)


# --- Test helper: a minimal polyline6 encoder ----------------------------


def _encode_polyline6(coords_lonlat: list[list[float]]) -> str:
    """Encode ``[lon, lat]`` pairs into a polyline6 string (mirrors siblings)."""

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


_OSRM_COORDS = [[76.878, 28.784], [77.0, 28.5], [77.458, 28.207]]
_VALHALLA_COORDS = [[76.878, 28.784], [77.1, 28.4], [77.458, 28.207]]


# --- parse_curl: exact OSRM example --------------------------------------


def test_parse_osrm_example_get_url_no_body() -> None:
    parsed = parse_curl(OSRM_CURL)

    assert parsed.method == "GET"
    assert parsed.url == OSRM_URL
    assert parsed.body is None


# --- parse_curl: exact Valhalla example ----------------------------------


def test_parse_valhalla_example_post_header_and_json_body() -> None:
    parsed = parse_curl(VALHALLA_CURL)

    assert parsed.method == "POST"
    assert parsed.url == "http://localhost:8002/route"
    assert parsed.headers.get("Content-Type") == "application/json"
    assert parsed.body is not None
    # Body is carried as the raw JSON string; it parses back to the payload.
    assert json.loads(parsed.body)["costing"] == "motorcycle"


# --- parse_curl: SAFETY — shell metacharacters are inert -----------------


def test_parse_curl_never_executes_shell_metacharacters() -> None:
    """$(...) / backticks / ; rm -rf are tokenized, never executed.

    parse_curl only tokenizes via shlex and inspects tokens — there is no
    subprocess/shell involved by design. A command-substitution string embedded
    in the URL survives verbatim as plain text; a trailing ``; rm -rf`` suffix
    is lexed into inert tokens and dropped as an unknown positional, and NO
    shell runs (asserted structurally: only parsing happens).
    """
    dangerous = (
        "curl 'http://localhost:5000/route/v1/biking/$(rm -rf /)"
        "`whoami`' ; rm -rf /tmp/should_not_run"
    )

    # No exception, no side effects: the substitution text stays literal.
    parsed = parse_curl(dangerous)
    assert parsed.url == (
        "http://localhost:5000/route/v1/biking/$(rm -rf /)`whoami`"
    )
    # The metacharacters remained plain text — never expanded/executed.
    assert "$(rm -rf /)" in parsed.url
    assert "`whoami`" in parsed.url


def test_parse_curl_rejects_non_curl_and_missing_url() -> None:
    with pytest.raises(CurlParseError):
        parse_curl("not a curl command")
    with pytest.raises(CurlParseError):
        parse_curl("curl -X GET -H 'Accept: application/json'")
    with pytest.raises(CurlParseError):
        parse_curl("")


# --- Endpoint helpers -----------------------------------------------------


def _ok_osrm_call() -> EngineCallResult:
    raw = {
        "code": "Ok",
        "routes": [
            {
                "geometry": _encode_polyline6(_OSRM_COORDS),
                "distance": 4321.0,
                "duration": 300.0,
                "weight": 310.0,
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


def _ok_valhalla_call() -> EngineCallResult:
    raw = {
        "trip": {
            "legs": [{"shape": _encode_polyline6(_VALHALLA_COORDS)}],
            "summary": {"length": 42.0, "time": 1800.0, "cost": 21.0},
            "units": "kilometers",
        }
    }
    return EngineCallResult(
        ok=True,
        response=httpx.Response(200, json=raw),
        http_status=200,
        duration_ms=14.0,
        error=None,
    )


class _CallEngineSpy:
    """Records call_engine invocations so tests can assert forwarded args.

    Also lets a test assert that call_engine was NOT invoked at all (the
    reject-without-executing contract, Req 17.7).
    """

    def __init__(self, result: EngineCallResult | None = None) -> None:
        self.result = result
        self.calls: list[dict[str, object]] = []

    async def __call__(
        self, method: str, url: str, **kwargs: object
    ) -> EngineCallResult:
        self.calls.append({"method": method, "url": url, "kwargs": kwargs})
        assert self.result is not None, "call_engine invoked unexpectedly"
        return self.result


# --- Endpoint: OSRM happy path -------------------------------------------


def test_curl_import_osrm_executes_and_normalizes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    spy = _CallEngineSpy(_ok_osrm_call())
    monkeypatch.setattr(routes, "call_engine", spy)

    response = client.post("/api/curl/import", json={"curl": OSRM_CURL})

    assert response.status_code == 200
    data = response.json()
    assert data["engine"] == "osrm"
    assert data["result"]["status"] == "ok"
    assert len(data["result"]["normalizedRoutes"]) >= 1

    # Exactly one call, GET, forwarding the URL verbatim.
    assert len(spy.calls) == 1
    assert spy.calls[0]["method"] == "GET"
    assert spy.calls[0]["url"] == OSRM_URL


# --- Endpoint: non-allowlisted host is rejected, nothing executed --------


def test_curl_import_rejects_non_allowlisted_host_without_executing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    spy = _CallEngineSpy()  # no result: any invocation would assert-fail
    monkeypatch.setattr(routes, "call_engine", spy)

    response = client.post(
        "/api/curl/import",
        json={"curl": "curl 'http://evil.com/route'"},
    )

    assert response.status_code == 400
    assert spy.calls == []  # nothing executed (Req 10.4, 10.5, 17.7)


# --- Endpoint: Valhalla happy path ---------------------------------------


def test_curl_import_valhalla_forwards_json_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    spy = _CallEngineSpy(_ok_valhalla_call())
    monkeypatch.setattr(routes, "call_engine", spy)

    response = client.post("/api/curl/import", json={"curl": VALHALLA_CURL})

    assert response.status_code == 200
    data = response.json()
    assert data["engine"] == "valhalla"
    assert data["result"]["status"] == "ok"

    # One POST to the Valhalla URL, forwarding the parsed JSON body verbatim.
    assert len(spy.calls) == 1
    assert spy.calls[0]["method"] == "POST"
    assert spy.calls[0]["url"] == "http://localhost:8002/route"
    forwarded = spy.calls[0]["kwargs"]["json"]
    assert forwarded == _VALHALLA_BODY
    assert forwarded["costing"] == "motorcycle"


# --- Endpoint: malformed input is rejected, nothing executed -------------


@pytest.mark.parametrize(
    "curl_text",
    [
        "not a curl command",  # not a curl invocation
        "curl -X GET",  # no URL
        # allowlisted Valhalla host but invalid JSON body
        "curl -X POST 'http://localhost:8002/route' -d 'not-json'",
    ],
)
def test_curl_import_rejects_malformed_without_executing(
    monkeypatch: pytest.MonkeyPatch, curl_text: str
) -> None:
    spy = _CallEngineSpy()  # any invocation would assert-fail
    monkeypatch.setattr(routes, "call_engine", spy)

    response = client.post("/api/curl/import", json={"curl": curl_text})

    assert response.status_code == 400
    assert spy.calls == []  # nothing executed (Req 17.7)

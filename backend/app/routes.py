"""API router for the Bike Routing Dashboard backend.

Defines the endpoint surface described in the design's Backend API Design
section. These handlers are currently stubs returning typed placeholder
responses so the app boots and routes resolve (Task 2.2). Real logic — engine
fan-out, normalization, raw forwarding, curl import, and health probing — is
added in later tasks (Req 2, 9, 10, 16).
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException

from app import config
from app.curlparse import CurlParseError, ParsedCurl, parse_curl
from app.engines import EngineCallResult, call_engine, is_host_allowed, probe_engines
from app.models import (
    CompareRequest,
    CompareResponse,
    CompareDebug,
    Coordinate,
    CurlImportRequest,
    CurlImportResponse,
    EngineError,
    EngineDebugResult,
    EngineResult,
    HealthResponse,
    OsrmRawRequest,
    ValhallaRawRequest,
    ValhallaTraceRequest,
    ValhallaTraceResponse,
)
from app.osrm import build_default_osrm_url, build_osrm_debug, normalize_osrm_response
from app.valhalla import build_default_valhalla_body, normalize_valhalla_response
from app.valhalla_pbf import (
    build_valhalla_debug,
    build_valhalla_pbf_request,
    normalize_valhalla_pbf_response,
    parse_valhalla_pbf,
)
from app.trace import (
    build_trace_attributes_body,
    normalize_trace_attributes_response,
    trace_error_response,
)

router = APIRouter(prefix="/api")


@dataclass
class _CompareOutcome:
    result: EngineResult
    debug: EngineDebugResult | None = None


def _debug_failure(engine: str, message: str, detail: Any = None) -> EngineDebugResult:
    """Build a debug-only failure without altering the engine route envelope."""
    from app.models import DebugError

    return EngineDebugResult(
        engine=engine,
        status="error",
        segments=[],
        errors=[
            DebugError(
                kind="debug_unavailable",
                message=message,
                detail=detail,
            )
        ],
    )


def _decode_json(result: EngineCallResult) -> tuple[Any, bool]:
    """Best-effort decode of a call result's response body as JSON.

    Returns ``(body, ok)`` where ``ok`` is ``False`` when the response is absent
    or the body is not JSON-decodable. Never raises: a decode failure is a
    normal, expected outcome (a non-JSON body) rather than an exception path.
    """
    response = result.response
    if response is None:
        return None, False
    try:
        return response.json(), True
    except (ValueError, TypeError):
        return None, False


@router.post("/trace/valhalla", response_model=ValhallaTraceResponse)
async def trace_valhalla(request: ValhallaTraceRequest) -> ValhallaTraceResponse:
    """Map-match one preserved OSRM polyline through Valhalla trace_attributes."""
    url = f"{config.VALHALLA_BASE_URL}/trace_attributes"
    payload = build_trace_attributes_body(request.encoded_polyline, request.costing)
    result = await call_engine("POST", url, json=payload)
    if not result.ok:
        error = result.error
        return trace_error_response(
            route_id=request.route_id,
            encoded_polyline=request.encoded_polyline,
            kind=error.kind if error else "trace_failed",
            message=error.message if error else "Valhalla trace request failed.",
            detail=error.detail if error else None,
            http_status=result.http_status,
            duration_ms=result.duration_ms,
        )
    body, decoded = _decode_json(result)
    if not decoded:
        return trace_error_response(
            route_id=request.route_id,
            encoded_polyline=request.encoded_polyline,
            kind="invalid_response",
            message="Valhalla returned a non-JSON trace response.",
            http_status=result.http_status,
            duration_ms=result.duration_ms,
        )
    return normalize_trace_attributes_response(
        body,
        route_id=request.route_id,
        encoded_polyline=request.encoded_polyline,
        duration_ms=result.duration_ms,
        http_status=result.http_status,
    )


def _error_envelope(engine: str, result: EngineCallResult) -> EngineResult:
    """Build an ``error`` ``EngineResult`` from a not-ok engine call.

    The classified :class:`~app.models.EngineError` from the call layer is
    carried through unchanged. When a non-2xx HTTP response exists and its body
    is JSON-decodable, that body is preserved in ``raw`` (e.g. an ``http_error``
    whose response carries a diagnostic body); otherwise ``raw`` is ``None``.
    """
    raw, decoded = _decode_json(result)
    return EngineResult(
        engine=engine,
        status="error",
        http_status=result.http_status,
        duration_ms=result.duration_ms,
        normalized_routes=[],
        raw=raw if decoded else None,
        warnings=[],
        error=result.error,
    )


def _invalid_response_envelope(engine: str, result: EngineCallResult) -> EngineResult:
    """Build an ``error`` envelope for a 2xx response whose body is not JSON.

    A successful transport call whose body cannot be parsed as JSON is not a
    route result; it is surfaced as ``invalid_response`` while still carrying the
    measured timing and HTTP status.
    """
    return EngineResult(
        engine=engine,
        status="error",
        http_status=result.http_status,
        duration_ms=result.duration_ms,
        normalized_routes=[],
        raw=None,
        warnings=[],
        error=EngineError(
            kind="invalid_response",
            message=f"{engine} returned a non-JSON response body.",
            detail=None,
        ),
    )


def _handle_engine_call(
    engine: str,
    result: EngineCallResult,
    normalize: Callable[[Any], EngineResult],
) -> EngineResult:
    """Turn a completed engine call into a single ``EngineResult`` envelope.

    Shared post-call handling used by both the canonical Compare paths and the
    verbatim raw-forwarding endpoints. The call layer never raises, so exactly
    one of three outcomes is produced:

    - not-ok call (host not allowlisted -> ``invalid_request``, connect failure,
      timeout, or non-2xx) -> :func:`_error_envelope`, preserving any JSON error
      body in ``raw`` (Req 17.1-17.3, 17.8);
    - a 2xx response whose body is not JSON -> :func:`_invalid_response_envelope`;
    - a 2xx response with a JSON body -> ``normalize(body)``.

    ``normalize`` receives only the decoded JSON body; the caller closes over the
    measured ``duration_ms``/``http_status`` (and, for Valhalla, the request-unit
    context) so this helper stays engine-agnostic.
    """
    if not result.ok:
        return _error_envelope(engine, result)

    body, decoded = _decode_json(result)
    if not decoded:
        return _invalid_response_envelope(engine, result)

    return normalize(body)


async def _run_osrm(
    start: Coordinate, dest: Coordinate, include_debug: bool = False
) -> _CompareOutcome:
    """Call OSRM with the canonical request and normalize into an envelope.

    Builds the canonical ``Default_OSRM_Request`` URL, issues a GET through the
    allowlisted, non-raising call layer, and:

    - on a 2xx response, parses the JSON (``invalid_response`` if that fails)
      and runs :func:`~app.osrm.normalize_osrm_response`;
    - on a not-ok call, converts the classified error into an error envelope,
      preserving any JSON error body in ``raw``.

    Never raises: any unexpected exception is converted by the fan-out guard
    into this engine's error envelope so the sibling is unaffected (Req 2.2,
    2.3, 17.13).
    """
    url = build_default_osrm_url(start, dest)
    result = await call_engine("GET", url)

    envelope = _handle_engine_call(
        "osrm",
        result,
        lambda body: normalize_osrm_response(
            body,
            duration_ms=result.duration_ms,
            http_status=result.http_status,
        ),
    )
    debug = None
    if include_debug:
        body, decoded = _decode_json(result)
        if result.ok and decoded:
            try:
                debug = build_osrm_debug(body)
            except Exception as exc:  # debug must never affect normal routes
                debug = _debug_failure(
                    "osrm", "Unexpected OSRM debug extraction failure.", str(exc)
                )
        else:
            debug = _debug_failure(
                "osrm",
                "OSRM debug data is unavailable because the route call failed.",
                result.error.model_dump(by_alias=True) if result.error else None,
            )
    return _CompareOutcome(result=envelope, debug=debug)


async def _run_valhalla(
    start: Coordinate, dest: Coordinate, include_debug: bool = False
) -> _CompareOutcome:
    """Call Valhalla with the canonical request and normalize into an envelope.

    Builds the canonical ``Default_Valhalla_Request`` body, POSTs it to
    ``VALHALLA_BASE_URL + "/route"`` through the allowlisted, non-raising call
    layer, and normalizes as with OSRM. The request-unit context passed to
    :func:`~app.valhalla.normalize_valhalla_response` is derived from the
    canonical body's ``directions_options.units`` (``"kilometers"``), used as the
    fallback when ``trip.units`` is absent (Req 7.3).

    Never raises: guarded by the fan-out for defense-in-depth (Req 2.2, 2.3,
    17.13).
    """
    url = f"{config.VALHALLA_BASE_URL}/route"
    if not include_debug:
        body = build_default_valhalla_body(start, dest)
        request_units = body.get("directions_options", {}).get("units")
        result = await call_engine("POST", url, json=body)
        envelope = _handle_engine_call(
            "valhalla",
            result,
            lambda parsed: normalize_valhalla_response(
                parsed,
                duration_ms=result.duration_ms,
                http_status=result.http_status,
                request_units=request_units,
            ),
        )
        return _CompareOutcome(result=envelope)

    payload = build_valhalla_pbf_request(start, dest)
    result = await call_engine(
        "POST",
        url,
        content=payload,
        headers={
            "Content-Type": "application/x-protobuf",
            "Accept": "application/x-protobuf",
        },
    )
    if not result.ok:
        return _CompareOutcome(
            result=_error_envelope("valhalla", result),
            debug=_debug_failure(
                "valhalla",
                "Valhalla debug data is unavailable because the PBF route call failed.",
                result.error.model_dump(by_alias=True) if result.error else None,
            ),
        )

    try:
        api = parse_valhalla_pbf(result.response.content if result.response else b"")
    except ValueError as exc:
        envelope = EngineResult(
            engine="valhalla",
            status="error",
            http_status=result.http_status,
            duration_ms=result.duration_ms,
            normalized_routes=[],
            raw=None,
            warnings=[],
            error=EngineError(
                kind="invalid_response",
                message="Valhalla returned an invalid protobuf route response.",
                detail=str(exc),
            ),
        )
        return _CompareOutcome(
            result=envelope,
            debug=_debug_failure("valhalla", envelope.error.message, str(exc)),
        )

    envelope = normalize_valhalla_pbf_response(
        api,
        duration_ms=result.duration_ms,
        http_status=result.http_status,
    )
    try:
        debug = build_valhalla_debug(api)
    except Exception as exc:  # debug must never affect the Directions result
        debug = _debug_failure(
            "valhalla", "Unexpected Valhalla debug extraction failure.", str(exc)
        )
    return _CompareOutcome(result=envelope, debug=debug)


def _exception_envelope(engine: str, exc: BaseException) -> EngineResult:
    """Convert an unexpected per-task exception into an error envelope.

    Defense-in-depth for the ``asyncio.gather(..., return_exceptions=True)``
    fan-out: the call layer already avoids raising, but should a normalizer or
    anything else raise, that engine still yields an independent error envelope
    rather than aborting the sibling (Req 2.2, 2.3, 17.13).
    """
    return EngineResult(
        engine=engine,
        status="error",
        http_status=None,
        duration_ms=0.0,
        normalized_routes=[],
        raw=None,
        warnings=[],
        error=EngineError(
            kind="invalid_response",
            message=f"Unexpected error while processing the {engine} response.",
            detail=str(exc),
        ),
    )


@router.post(
    "/compare",
    response_model=CompareResponse,
    response_model_exclude_unset=True,
)
async def compare(request: CompareRequest) -> CompareResponse:
    """Fan out to both engines concurrently and return per-engine envelopes.

    Normal mode only: the body carries start + dest coordinates ONLY, and the
    backend always builds the canonical ``Default_OSRM_Request`` and
    ``Default_Valhalla_Request`` itself (Req 2.1, 2.2).

    The two engine paths run concurrently via
    ``asyncio.gather(..., return_exceptions=True)``. Each path is
    self-contained and non-raising, but the gather is still run with
    ``return_exceptions=True`` and any escaped exception is converted into that
    engine's independent error envelope — so one engine failing NEVER aborts or
    alters the other (Req 2.4, 2.5, 2.7, 17.13).
    """
    osrm_outcome, valhalla_outcome = await asyncio.gather(
        _run_osrm(request.start, request.dest, request.include_debug),
        _run_valhalla(request.start, request.dest, request.include_debug),
        return_exceptions=True,
    )

    if isinstance(osrm_outcome, _CompareOutcome):
        osrm = osrm_outcome
    else:
        osrm = _CompareOutcome(
            result=_exception_envelope("osrm", osrm_outcome),
            debug=(
                _debug_failure("osrm", "Unexpected OSRM processing failure.", str(osrm_outcome))
                if request.include_debug
                else None
            ),
        )
    if isinstance(valhalla_outcome, _CompareOutcome):
        valhalla = valhalla_outcome
    else:
        valhalla = _CompareOutcome(
            result=_exception_envelope("valhalla", valhalla_outcome),
            debug=(
                _debug_failure(
                    "valhalla",
                    "Unexpected Valhalla processing failure.",
                    str(valhalla_outcome),
                )
                if request.include_debug
                else None
            ),
        )

    if request.include_debug:
        return CompareResponse(
            osrm=osrm.result,
            valhalla=valhalla.result,
            debug=CompareDebug(
                osrm=osrm.debug
                or _debug_failure("osrm", "OSRM debug data is unavailable."),
                valhalla=valhalla.debug
                or _debug_failure("valhalla", "Valhalla debug data is unavailable."),
            ),
        )
    return CompareResponse(osrm=osrm.result, valhalla=valhalla.result)


@router.post("/osrm/raw", response_model=EngineResult)
async def osrm_raw(request: OsrmRawRequest) -> EngineResult:
    """Forward an exact OSRM URL verbatim and normalize the result (Req 9.4, 9.5).

    Advanced_Mode: the user's URL is sent EXACTLY as entered via a GET through
    the allowlisted, non-raising call layer — no parameter is regenerated or
    overwritten (Req 9.5). The host allowlist is enforced inside
    :func:`~app.engines.call_engine`, so a non-allowlisted host yields an
    ``invalid_request`` :class:`~app.models.EngineError` and issues no request;
    that is surfaced as an error envelope rather than being executed (Req 10.4,
    19.1). On a 2xx JSON response the body is run through
    :func:`~app.osrm.normalize_osrm_response`; a non-2xx call preserves any JSON
    error body in ``raw``.
    """
    result = await call_engine("GET", request.url)

    return _handle_engine_call(
        "osrm",
        result,
        lambda body: normalize_osrm_response(
            body,
            duration_ms=result.duration_ms,
            http_status=result.http_status,
        ),
    )


@router.post("/valhalla/raw", response_model=EngineResult)
async def valhalla_raw(request: ValhallaRawRequest) -> EngineResult:
    """Forward an exact Valhalla URL + JSON body verbatim (Req 9.6, 9.7, 7.3).

    Advanced_Mode: the user's URL and JSON body are POSTed EXACTLY as entered —
    the user-edited ``costing`` and other options are never replaced with
    defaults (Req 9.7). The host allowlist is enforced inside
    :func:`~app.engines.call_engine`. The request-unit context for
    :func:`~app.valhalla.normalize_valhalla_response` is derived from the
    user-provided body's ``directions_options.units`` (or ``None`` when absent),
    used as the fallback unit when ``trip.units`` is missing so distances still
    convert to meters correctly (Req 7.3).
    """
    body = request.body
    request_units = None
    if isinstance(body, dict):
        directions_options = body.get("directions_options")
        if isinstance(directions_options, dict):
            request_units = directions_options.get("units")

    result = await call_engine("POST", request.url, json=body)

    return _handle_engine_call(
        "valhalla",
        result,
        lambda parsed: normalize_valhalla_response(
            parsed,
            duration_ms=result.duration_ms,
            http_status=result.http_status,
            request_units=request_units,
        ),
    )


def _map_curl_url_to_engine(url: str) -> str:
    """Map a parsed curl URL to ``"osrm"`` or ``"valhalla"`` (design mapping).

    Mapping rule (design: "Curl Import Safety"):

    - host ``localhost:5000`` with a path under ``/route/v1/`` -> OSRM;
    - host ``localhost:8002`` with path ``/route`` -> Valhalla.

    The caller has already confirmed the host is allowlisted; this only decides
    which engine endpoint the URL refers to.

    Raises:
        CurlParseError: When the URL does not match a known engine endpoint.
    """
    parts = urlsplit(url)
    host = parts.hostname or ""
    port = parts.port
    host_port = f"{host}:{port}" if port is not None else host
    path = parts.path or ""

    if host_port == "localhost:5000" and "/route/v1/" in path:
        return "osrm"
    if host_port == "localhost:8002" and path.rstrip("/") == "/route":
        return "valhalla"

    raise CurlParseError(
        "The curl URL does not target a known engine endpoint. Use an OSRM "
        "'/route/v1/' URL on localhost:5000 or a Valhalla '/route' URL on "
        "localhost:8002."
    )


async def _curl_import_osrm(parsed: ParsedCurl) -> EngineResult:
    """Execute an OSRM curl import verbatim and normalize the result.

    Uses the parsed method (defaulting to ``GET`` — the typical OSRM verb) so
    the request is forwarded as captured, through the allowlisted, non-raising
    call layer.
    """
    method = parsed.method or "GET"
    result = await call_engine(method, parsed.url)

    return _handle_engine_call(
        "osrm",
        result,
        lambda body: normalize_osrm_response(
            body,
            duration_ms=result.duration_ms,
            http_status=result.http_status,
        ),
    )


async def _curl_import_valhalla(parsed: ParsedCurl) -> EngineResult:
    """Execute a Valhalla curl import and normalize the result.

    The parsed body string must be valid JSON (Valhalla POSTs a JSON body). A
    missing or invalid JSON body is rejected as an HTTP 400 with an actionable
    message, executing nothing (Req 17.7). The request-unit fallback is derived
    from the parsed body's ``directions_options.units`` (Req 7.3).
    """
    if parsed.body is None or not parsed.body.strip():
        raise HTTPException(
            status_code=400,
            detail=(
                "The Valhalla curl command has no request body. Include a JSON "
                "body via -d/--data."
            ),
        )
    try:
        parsed_body = json.loads(parsed.body)
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"The Valhalla curl body is not valid JSON: {exc}",
        ) from exc

    request_units = None
    if isinstance(parsed_body, dict):
        directions_options = parsed_body.get("directions_options")
        if isinstance(directions_options, dict):
            request_units = directions_options.get("units")

    result = await call_engine("POST", parsed.url, json=parsed_body)

    return _handle_engine_call(
        "valhalla",
        result,
        lambda body: normalize_valhalla_response(
            body,
            duration_ms=result.duration_ms,
            http_status=result.http_status,
            request_units=request_units,
        ),
    )


@router.post("/curl/import", response_model=CurlImportResponse)
async def curl_import(request: CurlImportRequest) -> CurlImportResponse:
    """Parse a curl command and execute the allowlisted request (Req 10).

    The pasted curl text is parsed with :func:`~app.curlparse.parse_curl`, which
    tokenizes via ``shlex`` and NEVER invokes a shell (Req 10.3). The parsed URL
    is then validated and mapped before anything is executed:

    - a parse failure (not a curl invocation / no URL / malformed) -> HTTP 400
      with an actionable message, executing nothing (Req 17.7);
    - a host not on the allowlist -> HTTP 400, executing nothing (Req 10.4,
      10.5, 17.7);
    - a URL that maps to no known engine endpoint -> HTTP 400, executing
      nothing.

    On success the request is forwarded through the same allowlisted,
    non-raising httpx path as the raw endpoints (:func:`~app.engines.call_engine`)
    — there is no generic arbitrary-URL executor and no shell anywhere (Req 10.3,
    19.1). OSRM imports are issued with the parsed method (default GET) and
    normalized via :func:`~app.osrm.normalize_osrm_response`; Valhalla imports
    POST the parsed JSON body and normalize via
    :func:`~app.valhalla.normalize_valhalla_response`, deriving the unit fallback
    from the body's ``directions_options.units`` (Req 7.3).
    """
    try:
        parsed = parse_curl(request.curl)
    except CurlParseError as exc:
        # Not a usable curl command — reject, execute nothing (Req 17.7).
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Validate the host BEFORE any execution or engine mapping (Req 10.4, 10.5,
    # 17.7). A non-allowlisted host is refused and nothing is executed.
    if not is_host_allowed(parsed.url):
        raise HTTPException(
            status_code=400,
            detail=(
                "The curl command targets a host that is not allowed. The "
                "backend only calls the local OSRM (localhost:5000) and "
                "Valhalla (localhost:8002) engines."
            ),
        )

    try:
        engine = _map_curl_url_to_engine(parsed.url)
    except CurlParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if engine == "osrm":
        result = await _curl_import_osrm(parsed)
    else:
        result = await _curl_import_valhalla(parsed)

    return CurlImportResponse(engine=engine, result=result)


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Report per-engine HTTP reachability (Req 16).

    Probes both engine roots concurrently with a short timeout independent of
    the per-request timeout. Any HTTP response (including 4xx/404/400) means
    ``reachable``; a refused connection, transport failure, or timeout means
    ``unreachable``. A probe never surfaces a backend error, so the dashboard
    stays usable while an engine is down (Req 16.1-16.5).
    """

    statuses = await probe_engines()
    return HealthResponse(osrm=statuses["osrm"], valhalla=statuses["valhalla"])

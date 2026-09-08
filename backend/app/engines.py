"""httpx call wrapper, host allowlist enforcement, error classification, and
the engine reachability probe for the Bike Routing Dashboard backend.

This module is the single outbound-HTTP chokepoint (design: `app/engines.py`).
Every engine call flows through here so the host allowlist (Req 10.4, 19.1) and
the shared request timeout (Req 17.12) are enforced in one place, and every
failure is classified into a structured :class:`EngineError` kind (Req 17.1,
17.2, 17.3) without the call layer ever raising.

It is deliberately engine-agnostic: it returns a small :class:`EngineCallResult`
capturing the raw httpx response (or an error) plus timing, which the OSRM and
Valhalla normalizers in Tasks 5-7 turn into a full ``EngineResult`` envelope.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from app import config
from app.models import EngineError


class HostNotAllowedError(Exception):
    """Raised (internally) when a target URL's host:port is not allowlisted.

    The wrapper raises this *before* issuing any network request so that a
    non-allowlisted host results in exactly zero outbound traffic (Req 10.4,
    19.1). The call layer catches it and converts it to an ``invalid_request``
    :class:`EngineError`; it is never allowed to propagate out of
    :func:`call_engine`.
    """

    def __init__(self, host_port: str) -> None:
        self.host_port = host_port
        super().__init__(
            f"host {host_port!r} is not in the allowlist "
            f"{sorted(config.ALLOWED_HOSTS)}"
        )


def _host_port(url: str) -> str:
    """Extract the ``host:port`` netloc used for allowlist comparison.

    Uses :func:`urllib.parse.urlsplit` so the comparison is robust to paths,
    query strings, and credentials. The allowlist stores explicit ``host:port``
    entries (e.g. ``"localhost:5000"``), so this returns the netloc without any
    ``user:pass@`` prefix and including the explicit port when present.

    Args:
        url: The full target URL.

    Returns:
        The ``host:port`` string (or bare host if the URL carries no port).
    """
    parts = urlsplit(url)
    host = parts.hostname or ""
    port = parts.port
    if port is not None:
        return f"{host}:{port}"
    return host


def is_host_allowed(url: str) -> bool:
    """Return ``True`` iff the URL's ``host:port`` is in ``config.ALLOWED_HOSTS``.

    Pure decision function (Req 10.4, 19.1) with no side effects — safe to call
    before deciding whether to issue a request.
    """
    return _host_port(url) in config.ALLOWED_HOSTS


@dataclass
class EngineCallResult:
    """Engine-agnostic outcome of a single wrapped outbound call.

    Feeds the normalizers in Tasks 5-7. Exactly one of ``response``/``error`` is
    meaningful: on success ``ok`` is ``True`` and ``response`` holds the httpx
    response; on failure ``ok`` is ``False`` and ``error`` holds the classified
    :class:`EngineError`.

    Attributes:
        ok: ``True`` when a 2xx response was received.
        response: The httpx response, or ``None`` when the call did not return
            a usable HTTP response (unreachable/timeout/invalid_request). Note a
            non-2xx response is still captured here so callers can preserve its
            body while ``ok`` is ``False``.
        http_status: The HTTP status code when an HTTP response was received,
            else ``None``.
        duration_ms: Round-trip duration in milliseconds. Zero when no request
            was issued (e.g. a non-allowlisted host).
        error: The classified :class:`EngineError`, or ``None`` on success.
    """

    ok: bool
    response: httpx.Response | None
    http_status: int | None
    duration_ms: float
    error: EngineError | None


async def _timed_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    json: object | None,
) -> tuple[httpx.Response, float]:
    """Issue a single request and return ``(response, durationMs)``.

    Times the round trip with a monotonic clock so the reported ``durationMs``
    is unaffected by wall-clock adjustments.
    """
    start = time.perf_counter()
    if method.upper() == "POST":
        response = await client.post(url, json=json)
    else:
        response = await client.get(url)
    duration_ms = (time.perf_counter() - start) * 1000.0
    return response, duration_ms


async def request_engine(
    method: str,
    url: str,
    *,
    json: object | None = None,
    timeout: float | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[httpx.Response, float]:
    """Validate the host allowlist, then issue a timed request.

    This is the low-level wrapper for Task 4.1: it enforces the allowlist before
    any network activity, applies the shared timeout, and measures the
    round-trip duration in milliseconds. It supports ``GET`` and ``POST`` (with
    a JSON body) requests.

    Args:
        method: ``"GET"`` or ``"POST"``.
        url: The full target URL. Its ``host:port`` must be allowlisted.
        json: JSON body for ``POST`` requests (ignored for ``GET``).
        timeout: Request timeout in seconds; defaults to
            ``config.REQUEST_TIMEOUT_SECONDS``.
        transport: Optional httpx transport, used by tests to inject a
            :class:`httpx.MockTransport` for deterministic offline runs.

    Returns:
        A tuple of the httpx response and the round-trip ``durationMs``.

    Raises:
        HostNotAllowedError: If the URL's host is not allowlisted. No request is
            issued in this case.
        httpx.HTTPError: Propagated transport/timeout errors (classified by the
            :func:`call_engine` layer).
    """
    if not is_host_allowed(url):
        # Refuse without issuing any request (Req 10.4, 19.1).
        raise HostNotAllowedError(_host_port(url))

    effective_timeout = (
        config.REQUEST_TIMEOUT_SECONDS if timeout is None else timeout
    )
    async with httpx.AsyncClient(
        timeout=effective_timeout, transport=transport
    ) as client:
        return await _timed_request(client, method, url, json=json)


async def call_engine(
    method: str,
    url: str,
    *,
    json: object | None = None,
    timeout: float | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> EngineCallResult:
    """Run a wrapped engine call and classify the outcome — never raises.

    This is the Task 4.2 classification layer. It runs :func:`request_engine`
    and maps every possible outcome onto an :class:`EngineCallResult`, converting
    failures into an :class:`EngineError` kind instead of raising (Req 17.1,
    17.2, 17.3, 17.12):

    - host not allowlisted -> ``invalid_request`` (no request issued)
    - :class:`httpx.ConnectError` / connection refused / DNS failure ->
      ``unreachable``
    - :class:`httpx.TimeoutException` -> ``timeout``
    - a non-2xx HTTP response -> ``http_error`` with ``httpStatus`` set
    - a 2xx response -> ``ok``

    Args mirror :func:`request_engine`.

    Returns:
        An :class:`EngineCallResult`. ``ok`` is ``True`` only for a 2xx
        response.
    """
    try:
        response, duration_ms = await request_engine(
            method, url, json=json, timeout=timeout, transport=transport
        )
    except HostNotAllowedError as exc:
        # Refused before any request — surface as an invalid_request error.
        return EngineCallResult(
            ok=False,
            response=None,
            http_status=None,
            duration_ms=0.0,
            error=EngineError(
                kind="invalid_request",
                message=(
                    "Target host is not allowed. The backend only calls the "
                    "local OSRM and Valhalla engines."
                ),
                detail=str(exc),
            ),
        )
    except httpx.TimeoutException as exc:
        return EngineCallResult(
            ok=False,
            response=None,
            http_status=None,
            duration_ms=0.0,
            error=EngineError(
                kind="timeout",
                message=(
                    f"Request to {url} timed out after "
                    f"{config.REQUEST_TIMEOUT_SECONDS if timeout is None else timeout}s."
                ),
                detail=str(exc),
            ),
        )
    except httpx.HTTPError as exc:
        # ConnectError (connection refused), DNS failures, and other transport
        # errors all mean the engine could not be reached.
        return EngineCallResult(
            ok=False,
            response=None,
            http_status=None,
            duration_ms=0.0,
            error=EngineError(
                kind="unreachable",
                message=f"Could not reach {url}.",
                detail=str(exc),
            ),
        )

    if response.is_success:
        return EngineCallResult(
            ok=True,
            response=response,
            http_status=response.status_code,
            duration_ms=duration_ms,
            error=None,
        )

    # A well-formed but non-2xx HTTP response (Req 17.3). Keep the response so
    # callers can preserve its body/raw while marking the result not-ok.
    return EngineCallResult(
        ok=False,
        response=response,
        http_status=response.status_code,
        duration_ms=duration_ms,
        error=EngineError(
            kind="http_error",
            message=f"{url} returned HTTP {response.status_code}.",
            detail=None,
        ),
    )


# --- Task 4.3: engine reachability probe (Req 16) -------------------------

# A short, dedicated timeout for the health probe, independent of the 30s
# per-engine request timeout (Req 16). A slow engine should still register as
# reachable quickly rather than blocking the health endpoint.
HEALTH_PROBE_TIMEOUT_SECONDS = 3.0


async def probe_reachable(
    url: str,
    *,
    timeout: float = HEALTH_PROBE_TIMEOUT_SECONDS,
    transport: httpx.AsyncBaseTransport | None = None,
) -> bool:
    """Probe a root URL and report reachability, never raising (Req 16).

    Health means HTTP service reachability, not a 2xx status: ANY HTTP response
    — including 4xx/404/400 — counts as ``reachable`` (Req 16.2, 16.4). Only a
    refused connection, a transport failure, or a timeout is ``unreachable``
    (Req 16.3). A backend error is never surfaced (Req 16.5).

    Args:
        url: The engine root URL to probe.
        timeout: Short probe timeout in seconds.
        transport: Optional httpx transport for deterministic tests.

    Returns:
        ``True`` if any HTTP response was received, ``False`` otherwise.
    """
    try:
        async with httpx.AsyncClient(
            timeout=timeout, transport=transport
        ) as client:
            await client.get(url)
    except httpx.HTTPError:
        # Connection refused, DNS failure, timeout, etc. -> unreachable.
        return False
    # Any HTTP response at all (including 4xx/404/400) -> reachable.
    return True


async def probe_engines(
    *,
    osrm_url: str | None = None,
    valhalla_url: str | None = None,
    timeout: float = HEALTH_PROBE_TIMEOUT_SECONDS,
    osrm_transport: httpx.AsyncBaseTransport | None = None,
    valhalla_transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, str]:
    """Probe both engines concurrently and return their reachability (Req 16).

    Runs the two probes with :func:`asyncio.gather` so a slow or unreachable
    engine does not delay the other, using a short timeout independent of the
    30s request timeout.

    Args:
        osrm_url: OSRM root URL; defaults to ``config.OSRM_BASE_URL``.
        valhalla_url: Valhalla root URL; defaults to ``config.VALHALLA_BASE_URL``.
        timeout: Short probe timeout in seconds.
        osrm_transport: Optional transport for the OSRM probe (tests).
        valhalla_transport: Optional transport for the Valhalla probe (tests).

    Returns:
        ``{"osrm": "reachable"|"unreachable", "valhalla": "reachable"|"unreachable"}``.
    """
    osrm_target = config.OSRM_BASE_URL if osrm_url is None else osrm_url
    valhalla_target = (
        config.VALHALLA_BASE_URL if valhalla_url is None else valhalla_url
    )

    osrm_ok, valhalla_ok = await asyncio.gather(
        probe_reachable(osrm_target, timeout=timeout, transport=osrm_transport),
        probe_reachable(
            valhalla_target, timeout=timeout, transport=valhalla_transport
        ),
    )

    return {
        "osrm": "reachable" if osrm_ok else "unreachable",
        "valhalla": "reachable" if valhalla_ok else "unreachable",
    }

"""Safe curl-command parsing for the Bike Routing Dashboard backend (Task 10).

Curl import must reproduce a captured request WITHOUT ever invoking a shell
(Req 10.3, 10.4). This module tokenizes the pasted curl text with
:func:`shlex.split` — which lexes shell quoting/escaping the way a shell *would*,
but performs **no execution** — and extracts the HTTP method, URL, headers, and
body from the resulting tokens (Req 10.2).

Design (design: "Curl Import Safety"): parsing is deliberately kept separate
from host validation and HTTP execution. :func:`parse_curl` ONLY parses; it does
not validate the host or issue any request. The ``/api/curl/import`` handler in
``app/routes.py`` performs host allowlist validation, engine mapping, and runs
the parsed request through the same allowlisted httpx path as the raw endpoints.

There is no shell invocation, no ``subprocess``, no ``os.system``, and no
``eval`` anywhere here — only ``shlex`` tokenization and pure token inspection.
Shell metacharacters (``$(...)``, backticks, ``;``, ``&&``, ``| rm -rf`` …) are
treated as plain, inert tokens; they are never expanded or run.
"""

from __future__ import annotations

import shlex
from dataclasses import dataclass, field

# curl flags that carry a request body. A single one is sufficient for our use
# (Valhalla POST bodies); if multiple appear, curl semantics concatenate them,
# which we approximate by concatenation below.
_DATA_FLAGS = {"-d", "--data", "--data-raw", "--data-binary", "--data-ascii"}

# curl flags that carry the HTTP method.
_METHOD_FLAGS = {"-X", "--request"}

# curl flags that carry a header ("Key: Value").
_HEADER_FLAGS = {"-H", "--header"}

# curl flag that carries the URL explicitly (as opposed to a bare positional).
_URL_FLAG = "--url"


class CurlParseError(Exception):
    """Raised when the input is not a usable curl invocation.

    Raised (and surfaced by the handler as an HTTP 400 with an actionable
    message, executing nothing — Req 17.7) when the input:

    - is empty / not a ``curl`` invocation,
    - cannot be tokenized by :func:`shlex.split` (unbalanced quotes, etc.),
    - or contains no URL.
    """


@dataclass
class ParsedCurl:
    """The structured result of parsing a curl command — parse only.

    Carries just what the handler needs to reconstruct and forward the request.
    It performs no host validation and no HTTP itself.

    Attributes:
        method: The HTTP method, upper-cased. Defaults to ``"GET"``; becomes
            ``"POST"`` when a data flag is present and no explicit ``-X`` was
            given.
        url: The extracted target URL (a bare non-flag token or ``--url`` value).
        headers: Header name -> value, parsed from repeated ``-H``/``--header``.
        body: The request body string from ``-d``/``--data`` variants, or
            ``None`` when no data flag was present.
    """

    method: str
    url: str
    headers: dict[str, str] = field(default_factory=dict)
    body: str | None = None


def _split_header(token: str) -> tuple[str, str] | None:
    """Split a ``"Key: Value"`` header token into ``(name, value)``.

    Returns ``None`` for a token without a ``":"`` separator so malformed
    header tokens are simply ignored rather than crashing the parse.
    """
    if ":" not in token:
        return None
    name, _, value = token.partition(":")
    return name.strip(), value.strip()


def parse_curl(curl_text: str) -> ParsedCurl:
    """Parse a pasted curl command into a :class:`ParsedCurl` — never a shell.

    Tokenizes ``curl_text`` with :func:`shlex.split` (no execution, no shell)
    and extracts the method/URL/headers/body from the tokens (Req 10.2, 10.3).
    This function ONLY parses: it does not validate the host against the
    allowlist and does not issue any HTTP request — the handler does that
    (design: "Curl Import Safety").

    Extraction rules (design: "Curl Import Safety"):

    - A leading ``curl`` token is ignored.
    - Method: ``-X``/``--request`` value; otherwise ``GET``, or ``POST`` when a
      data flag is present and no explicit method was given.
    - URL: the ``--url`` value, else the first bare (non-flag) token.
    - Headers: each ``-H``/``--header`` ``"Key: Value"`` (repeatable).
    - Body: ``-d``/``--data``/``--data-raw``/``--data-binary`` value (multiple
      are concatenated per curl semantics; a single one is the normal case).

    Args:
        curl_text: The raw curl command text pasted by the user.

    Returns:
        A :class:`ParsedCurl` with the extracted method, url, headers, and body.

    Raises:
        CurlParseError: If the input is empty, not a ``curl`` invocation, cannot
            be tokenized (e.g. unbalanced quotes), or contains no URL.
    """
    if curl_text is None or not curl_text.strip():
        raise CurlParseError("Empty input: paste a curl command to import.")

    try:
        tokens = shlex.split(curl_text)
    except ValueError as exc:
        # Unbalanced quotes or otherwise un-lexable input. shlex NEVER executes;
        # this is purely a tokenization failure.
        raise CurlParseError(
            f"Could not parse the curl command (malformed quoting): {exc}"
        ) from exc

    if not tokens:
        raise CurlParseError("Empty input: paste a curl command to import.")

    # Ignore a leading "curl" token (case-insensitively); require it to look
    # like a curl invocation.
    if tokens[0].lower() == "curl":
        tokens = tokens[1:]
    else:
        raise CurlParseError(
            "Input does not look like a curl command (must start with 'curl')."
        )

    explicit_method: str | None = None
    url: str | None = None
    headers: dict[str, str] = {}
    body_parts: list[str] = []
    has_data_flag = False

    i = 0
    n = len(tokens)
    while i < n:
        token = tokens[i]

        if token in _METHOD_FLAGS:
            if i + 1 < n:
                explicit_method = tokens[i + 1].upper()
                i += 2
                continue
            i += 1
            continue

        if token in _HEADER_FLAGS:
            if i + 1 < n:
                parsed = _split_header(tokens[i + 1])
                if parsed is not None:
                    headers[parsed[0]] = parsed[1]
                i += 2
                continue
            i += 1
            continue

        if token in _DATA_FLAGS:
            has_data_flag = True
            if i + 1 < n:
                body_parts.append(tokens[i + 1])
                i += 2
                continue
            i += 1
            continue

        if token == _URL_FLAG:
            if i + 1 < n:
                url = tokens[i + 1]
                i += 2
                continue
            i += 1
            continue

        # A flag we don't model (e.g. -s, --compressed, -L): skip the flag
        # itself. We do NOT consume a following token as its value, since we
        # can't know its arity; a bare URL still surfaces as a non-flag token.
        if token.startswith("-"):
            i += 1
            continue

        # A bare, non-flag token: treat the first one as the URL.
        if url is None:
            url = token
        i += 1

    if url is None:
        raise CurlParseError(
            "No URL found in the curl command. Include the target URL to import."
        )

    if explicit_method is not None:
        method = explicit_method
    elif has_data_flag:
        # curl defaults to POST when a data flag is present and no -X was given.
        method = "POST"
    else:
        method = "GET"

    body = "".join(body_parts) if has_data_flag else None

    return ParsedCurl(method=method, url=url, headers=headers, body=body)

"""Backend configuration constants and production-secret resolution.

Canonical production Compare calls are deliberately separate from the
localhost-only Advanced raw/curl forwarding allowlist.
"""

from __future__ import annotations

import importlib
import os
from collections.abc import Callable, Mapping


def _clean_token(value: object) -> str | None:
    """Return a stripped non-empty token, otherwise ``None``."""
    if not isinstance(value, str):
        return None
    return value.strip() or None


def _load_local_mappls_token() -> str | None:
    """Load the optional gitignored ``app.local_secrets`` token."""
    try:
        local_secrets = importlib.import_module("app.local_secrets")
    except ImportError:
        return None
    return _clean_token(
        getattr(local_secrets, "MAPPLS_PROD_ACCESS_TOKEN", None)
    )


def _resolve_mappls_prod_access_token(
    environ: Mapping[str, str] | None = None,
    local_token_loader: Callable[[], object] | None = None,
) -> str | None:
    """Resolve environment first, then the optional local secrets module."""
    source = os.environ if environ is None else environ
    environment_token = _clean_token(source.get("MAPPLS_PROD_ACCESS_TOKEN"))
    if environment_token is not None:
        return environment_token

    loader = _load_local_mappls_token if local_token_loader is None else local_token_loader
    return _clean_token(loader())


# Hosts allowed for user-supplied Advanced raw/curl requests. Canonical Prod
# Compare uses its own fixed-host set below; health remains Local-only.
LOCAL_RAW_ALLOWED_HOSTS = {"localhost:5000", "localhost:8002"}
# Backwards-compatible name used by existing local callers/tests.
ALLOWED_HOSTS = LOCAL_RAW_ALLOWED_HOSTS

CANONICAL_PROD_HOST = "apis.mapmyindia.com"
CANONICAL_PROD_ALLOWED_HOSTS = {CANONICAL_PROD_HOST}
MAPPLS_PROD_ACCESS_TOKEN = _resolve_mappls_prod_access_token()
MAPPLS_PROD_OSRM_BASE_URL = f"https://{CANONICAL_PROD_HOST}/advancedmaps/v1"
MAPPLS_PROD_VALHALLA_URL = f"https://{CANONICAL_PROD_HOST}/advancedmaps/v2/route"

# Base URL of the running OSRM 5.25 fork (profile "biking").
OSRM_BASE_URL = "http://localhost:5000"

# Base URL of the running Valhalla 3.3.0 fork (POST /route).
VALHALLA_BASE_URL = "http://localhost:8002"

# Shared per-engine request timeout in seconds.
REQUEST_TIMEOUT_SECONDS = 30

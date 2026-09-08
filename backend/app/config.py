"""Backend configuration constants.

Defines the outbound host allowlist, engine base URLs, and the shared request
timeout used by every outbound engine call (Req 10.4, 16.1, 17.12, 19.1).

The Backend only ever calls the two running local routing engines; any other
host is rejected without a request being issued.
"""

# Hosts the Backend is permitted to call. Every outbound request (compare,
# raw forwarding, curl import, health) is validated against this set; anything
# else is refused (Req 10.4, 19.1).
ALLOWED_HOSTS = {"localhost:5000", "localhost:8002"}

# Base URL of the running OSRM 5.25 fork (profile "biking") (Req 16.1).
OSRM_BASE_URL = "http://localhost:5000"

# Base URL of the running Valhalla 3.3.0 fork (POST /route) (Req 16.1).
VALHALLA_BASE_URL = "http://localhost:8002"

# Shared per-engine request timeout in seconds (Req 17.12).
REQUEST_TIMEOUT_SECONDS = 30

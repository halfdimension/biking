"""FastAPI application entrypoint for the Bike Routing Dashboard backend.

Creates the FastAPI app instance and configures CORS so the local Vite dev
server (http://localhost:5173) can call the backend proxy (Req 15, 19.4).

Routers are registered here as they are implemented (Task 2.2 onward). This
module is intentionally minimal for now so the app boots and is ready for
router registration.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import router

# Origin of the local Vite dev server. The frontend runs here during
# development and calls this backend as a proxy to the routing engines.
FRONTEND_DEV_ORIGIN = "http://localhost:5173"

app = FastAPI(
    title="Bike Routing Comparison and Debugging Dashboard - Backend",
    description=(
        "Local proxy to the running OSRM and Valhalla routing engines. "
        "Fans out the Compare action, times each request, normalizes "
        "responses, and forwards Advanced/curl requests within a host allowlist."
    ),
    version="0.1.0",
)

# This is a local-only development dashboard: the frontend is served from a
# local Vite server (dev on :5173, `vite preview` on :4173) reachable via
# either `localhost` or `127.0.0.1`, and browsers treat each of those as a
# distinct origin. Rather than hardcode one origin (which silently breaks
# health and Compare when the page is opened from a different local host/port),
# we accept any localhost/127.0.0.1 origin on any port. Allowing any local
# origin is intentional and safe here because the app is not exposed publicly.
# The regex form is used deliberately so it remains compatible with
# allow_credentials=True (a wildcard "*" would not be).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register the API router (POST /api/compare, /api/osrm/raw,
# /api/valhalla/raw, /api/curl/import, GET /api/health).
app.include_router(router)

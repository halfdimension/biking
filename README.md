# Bike Routing Comparison and Debugging Dashboard

A local dashboard for comparing and debugging bike-routing responses from two
routing engines (OSRM and Valhalla). It runs as two processes under `biking/`:
a FastAPI backend proxy and a React/Vite/MapLibre frontend.

## Architecture

Data flow:

```
Browser
  → React + Vite + MapLibre GL JS frontend
    → FastAPI backend proxy
      → OSRM     (http://localhost:5000)
      → Valhalla (http://localhost:8002)
```

The frontend never calls the routing engines directly. All engine traffic goes
through the backend proxy, which:

- enforces a host allowlist (`localhost:5000`, `localhost:8002`),
- forwards the request to the target engine,
- times the round trip,
- normalizes each engine's response into a uniform per-engine envelope
  (`EngineResult` / `EngineError`), and
- returns that envelope to the frontend.

Engines used:

- **OSRM** — a 5.25 fork, profile `biking`, `GET /route/v1/...`.
- **Valhalla** — a 3.3.0 fork, `POST /route`, costing `motorcycle`.

## Prerequisites

- **Python** 3.10+ (for the backend virtualenv).
- **Node.js** 18+ and npm (for the frontend).
- **OSRM** already running on `http://localhost:5000` (profile `biking`).
- **Valhalla** already running on `http://localhost:8002`.
- Network access for the default OpenStreetMap raster basemap tiles.

The dashboard does **not** provide or manage the engines — see
[Engine Preservation](#engine-preservation).

## Install

Backend (Python virtualenv):

```
cd /home/cn004231/harsh/biking/backend
python -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Frontend (npm):

```
cd /home/cn004231/harsh/biking/frontend
npm install
```

## Running

Start the backend (FastAPI via uvicorn):

```
cd /home/cn004231/harsh/biking/backend
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Start the frontend dev server:

```
cd /home/cn004231/harsh/biking/frontend
npm run dev
```

- Dashboard URL: **http://localhost:5173** (Vite dev server port from
  `vite.config.ts`).
- Backend API base URL: **http://localhost:8000** (frontend default). Override
  with the `VITE_API_BASE_URL` environment variable if the backend runs on a
  different host/port.

Production build (optional preview of the built bundle):

```
cd /home/cn004231/harsh/biking/frontend
npm run build
npx vite preview
```

## Engine Preservation

**THE DASHBOARD DOES NOT BUILD OR START THE ROUTING ENGINES.**

OSRM and Valhalla must already be running separately on `localhost:5000` and
`localhost:8002`. The dashboard only issues HTTP requests to the
already-running services. It never builds, starts, stops, restarts, or executes
the engines. This constraint holds for every feature, including the Advanced
raw-request and curl-import paths (curl commands are parsed and executed as
plain HTTP requests, never through a shell).

## Canonical Requests

### Normal OSRM request

- profile: `biking`
- coordinate order: `lon,lat` (longitude first)
- URL shape:

```
http://localhost:5000/route/v1/biking/{start_lon},{start_lat};{end_lon},{end_lat}?<query>
```

- query params (exact):

```
overview=full
geometries=polyline6
alternatives=true
annotations=nodes,distance,duration,weight,speed,datasources
steps=true
```

### Normal Valhalla request

- `POST http://localhost:8002/route`
- costing: `motorcycle`
- alternates: `10`
- shape_format: `polyline6`
- `directions_options.units`: `kilometers`
- `locations`: start and destination as `{lat, lon, type: "break"}` entries

> **Note on costing:** this custom Valhalla fork **intentionally** uses
> `"motorcycle"` costing for this biking-comparison work. It is not
> `"bicycle"`. Do not change it to `bicycle`.

Example request body:

```json
{
  "locations": [
    { "lat": 12.9716, "lon": 77.5946, "type": "break" },
    { "lat": 13.0827, "lon": 77.5877, "type": "break" }
  ],
  "costing": "motorcycle",
  "alternates": 10,
  "shape_format": "polyline6",
  "directions_options": { "units": "kilometers" }
}
```

## Usage

### Setting coordinates manually

Enter start and destination as latitude/longitude values in the coordinate
inputs. Values are validated: latitude must be in `[-90, 90]` and longitude in
`[-180, 180]`.

### Setting coordinates from the map

Use **Set Start on Map** / **Set Destination on Map** to arm a mode, then click
the map to place that point. Alternatively, right-click the map for a context
menu with **Set as Start** / **Set as Destination**.

### Compare Routes

The **Compare Routes** button runs both engines concurrently through the
backend and renders all returned routes.

### Route colors

OSRM routes use a blue color family; Valhalla routes use a warm color family.
Each engine's primary route is visually distinguished from its alternates.

### Visibility controls

Per-route checkboxes are grouped by engine. Bulk actions: **Show All**,
**Hide All**, **OSRM Only**, **Valhalla Only**, **Primary Only**,
**Alternatives Only**.

### Route selection

Click a route on the map, in the route list, or a comparison-table row to
select it. Selection is single (one route at a time), with a control to clear
the selection. Hidden routes cannot be selected.

### Comparison table

Columns: Engine, Route, Type, Distance, Duration, Cost/Weight, Distance vs
Primary, Duration vs Primary. The "vs Primary" deltas are computed against each
engine's own primary route.

### Fit Routes

The map auto-fits to all visible routes after a Compare. A manual **Fit Routes**
button re-fits on demand. With no routes present, it falls back to fitting the
start/destination markers.

### Advanced OSRM request

Edit the raw OSRM URL and send it verbatim through the backend. The host must
be `localhost:5000`.

### Advanced Valhalla request

Edit the raw Valhalla URL and JSON body and send them verbatim through the
backend. The host must be `localhost:8002`. Invalid JSON is blocked before any
request is made.

### Raw response inspector

View the full raw engine response as pretty-printed, collapsible JSON with a
**Copy JSON** control. Custom / non-standard fields in the engine response are
preserved.

### Curl import

Paste a `curl` command for OSRM or Valhalla. The backend parses it with `shlex`
(never a shell), enforces the host allowlist, and executes it as an HTTP
request. OSRM and Valhalla have separate paste areas.

### Saved test cases

**Save Current Test**, **Load**, **Rename**, **Delete**, with optional notes.
Loading restores the coordinates and regenerates the request previews but does
**not** auto-Compare — press **Compare Routes** to run the engines. Test cases
persist to `localStorage`.

### Route-quality assessment

Each returned route can be rated **Good / Bad / Neutral / Unrated**, with
optional free-text notes. The assessment view shows engine, label,
primary/alternate flag, distance, duration, cost, and a color swatch per route.
**Unrated** means no stored rating exists for that route.

### Assessment notes

Optional per-route free-text notes attached alongside a route's rating.

### Per-engine error display

Each engine has its own error state; one engine failing does not disable the
other. Errors carry actionable messages for `unreachable`, `timeout`,
`http_error`, `no_route`, and `invalid_request`. An engine returning zero
alternates yields "No alternatives returned", which is **not** an error.

## Persisted Data (localStorage)

- **`biking.testCases.v1`** — array of saved test cases:
  `{ id, name, start: {lat, lon}, dest: {lat, lon}, notes? }`. Only reproducible
  *input* is stored: not raw engine responses, not decoded route geometry, not
  health/loading state. A saved test case is a reproducible input, not a
  response snapshot.

- **`biking.assessments.v2`** — route-quality assessments namespaced by
  test-case id and keyed internally by a **deterministic geometry fingerprint**
  (engine + a hash of the decoded coordinate sequence), **not** by alternate
  index. This means a rating follows the route geometry even if the alternate
  ordering changes between reruns. Only the compact fingerprint plus
  rating/notes are stored; the full geometry is never persisted. Legacy
  index-based `biking.assessments.v1` data, if present, is ignored and never
  migrated.

## Host Restrictions

For all raw / Advanced / curl-import paths, only two hosts are allowed:

- `localhost:5000` (OSRM)
- `localhost:8002` (Valhalla)

Any other host is rejected by the backend without a request being made.

## Troubleshooting

- **OSRM shows unknown/unreachable** — confirm OSRM is running on
  `localhost:5000` and the backend health probe can reach it. The health dot
  turns reachable on any HTTP response, including 4xx. On a cold start, the
  first health probe may briefly race the engine still warming up.

- **Valhalla shows unknown/unreachable** — confirm Valhalla is running on
  `localhost:8002`.

- **Dashboard backend not running** — the frontend calls
  `http://localhost:8000`. Start the backend uvicorn command above. If using a
  non-default port, set `VITE_API_BASE_URL` accordingly.

- **Blank map / tile connectivity** — the default basemap uses OpenStreetMap
  raster tiles (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) and requires
  network access. A custom MapLibre style can be set via `VITE_MAP_STYLE_URL`.

- **"No alternatives returned"** — this is not necessarily an error. An engine
  returning only its primary route is normal. A `no_route` result means no
  usable primary route was returned.

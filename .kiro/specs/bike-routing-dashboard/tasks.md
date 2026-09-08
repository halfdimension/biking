# Implementation Plan: Bike Routing Comparison and Debugging Dashboard

## Overview

This plan implements the dashboard as two processes under `biking/`: a Python + FastAPI + httpx backend proxy and a React + TypeScript + Vite + MapLibre GL JS frontend. Work proceeds bottom-up: scaffold both projects, build and test the backend's pure logic (polyline6 decode, request builders, normalizers, allowlist, curl parsing) behind the API endpoints, then build the frontend shared types, store, layout, map rendering, and each analysis panel, wiring everything together and finishing with property/integration tests and the README.

The design uses concrete languages (Python for backend, TypeScript for frontend), so no language selection is needed. The design includes a Correctness Properties section (Properties 1–19), so property-based test sub-tasks are included (Hypothesis for backend, fast-check for frontend) and marked optional (`*`) per the NFR that PBT must not block delivery.

The engines are never modified, rebuilt, restarted, or executed — the dashboard only calls the running local HTTP services (Req 19). No tasks touch auth, database, docker, or cloud.

## Tasks

- [x] 1. Scaffold backend and frontend projects with configuration
  - [x] 1.1 Scaffold the FastAPI backend project
    - Create `biking/backend/` with `app/` package (`__init__.py`, `main.py`), `requirements.txt` (fastapi, uvicorn, httpx, hypothesis, pytest, pytest-asyncio), and `tests/`
    - Create `app/main.py` with a FastAPI app instance and CORS middleware allowing the local Vite dev origin, ready for router registration
    - _Requirements: 15, 19.4_

  - [x] 1.2 Create backend config module with host allowlist, base URLs, and timeout
    - Create `app/config.py` defining `ALLOWED_HOSTS = {"localhost:5000", "localhost:8002"}`, `OSRM_BASE_URL = "http://localhost:5000"`, `VALHALLA_BASE_URL = "http://localhost:8002"`, and `REQUEST_TIMEOUT_SECONDS = 30`
    - _Requirements: 10.4, 16.1, 17.12, 19.1_

  - [x] 1.3 Scaffold the Vite + React + TypeScript frontend project
    - Create `biking/frontend/` with Vite React-TS structure (`package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`)
    - Add dependencies: `maplibre-gl`, `zustand`; dev dependencies: `vitest`, `fast-check`, `@testing-library/react`, `jsdom`
    - Add `.env` / `vite-env` handling for `VITE_MAP_STYLE_URL` (default = OSM raster style) and read it via `import.meta.env`
    - _Requirements: 15.6, 20.4_

- [x] 2. Build backend Pydantic models and API skeleton
  - [x] 2.1 Define backend Pydantic request/response models
    - Create `app/models.py` with `NormalizedRoute`, `EngineResult`, `EngineError`, `RouteWarning`, `CompareResponse`, `CompareRequest` (start/dest only), `OsrmRawRequest` (url), `ValhallaRawRequest` (url+body), `CurlImportRequest` (curl), and `HealthResponse`
    - Mirror field names/shapes from the design Data Models exactly (`[lon,lat]` coordinates, nullable numeric fields, `EngineError.kind` literal set)
    - _Requirements: 2, 11, 12.1, 17_

  - [x] 2.2 Create API router skeleton and register endpoints
    - Create `app/routes.py` with stub handlers for `POST /api/compare`, `POST /api/osrm/raw`, `POST /api/valhalla/raw`, `POST /api/curl/import`, `GET /api/health`, and register the router in `app/main.py`
    - Return typed placeholder responses so the app boots and routes resolve
    - _Requirements: 2, 9, 10, 16_

- [x] 3. Implement polyline6 decoder
  - [x] 3.1 Implement `decode_polyline6` in the backend
    - Create `app/polyline.py` with `decode_polyline6(encoded: str) -> list[list[float]]` using factor `1e6`, zig-zag decoding, swapping to `[lon, lat]` output order
    - Raise a decode error on truncated/undecodable input so callers can isolate per route
    - _Requirements: 3.1, 3.2, 12.1_

  - [ ]* 3.2 Write property test for polyline6 round-trip
    - **Property 1: polyline6 round-trip** — encode then decode reproduces original `[lon,lat]` coordinates within `1e-6`
    - Implement a polyline6 encoder in the test only; use Hypothesis with valid geographic ranges, min 100 iterations
    - Tag: `Feature: bike-routing-dashboard, Property 1: polyline6 round-trip`
    - **Validates: Requirements 3.1, 3.2**

- [x] 4. Implement engine host allowlist enforcement and health probe
  - [x] 4.1 Implement httpx call wrapper with host allowlist and timing
    - Create `app/engines.py` with a helper that validates a URL's host against `ALLOWED_HOSTS`, issues the request via httpx with `REQUEST_TIMEOUT_SECONDS`, measures round-trip `durationMs`, and returns `(response | exception, durationMs)`
    - Reject non-allowlisted hosts without issuing any request
    - _Requirements: 10.4, 17.12, 19.1_

  - [x] 4.2 Implement error classification into EngineError kinds
    - In `app/engines.py`, map connection-refused/failure → `unreachable`, timeout → `timeout`, non-2xx HTTP → `http_error` (with `httpStatus`), and never raise out of the call layer
    - _Requirements: 17.1, 17.2, 17.3, 17.12_

  - [x] 4.3 Implement `GET /api/health` reachability probe
    - Probe `localhost:5000` and `localhost:8002` with a short timeout; any HTTP response (incl. 4xx/404/400) → `reachable`; refused/failed/timeout → `unreachable`; never surface a backend error
    - Wire into the `/api/health` handler returning `{ osrm, valhalla }`
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [ ]* 4.4 Write property test for host allowlist decision
    - **Property 10: Host allowlist decision** — accept iff host ∈ allowlist, reject (executing nothing) otherwise
    - Hypothesis over arbitrary URLs/hosts, min 100 iterations
    - Tag: `Feature: bike-routing-dashboard, Property 10: Host allowlist decision`
    - **Validates: Requirements 10.4, 19.1**

  - [ ]* 4.5 Write property test for error classification totality
    - **Property 9: Error classification totality** — every failure yields the correct `EngineError.kind` and never throws
    - Hypothesis over simulated exceptions/status codes, min 100 iterations
    - Tag: `Feature: bike-routing-dashboard, Property 9: Error classification totality`
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.12**

- [x] 5. Implement OSRM request builder and normalizer
  - [x] 5.1 Implement Default_OSRM_Request builder
    - In `app/engines.py` (or `app/requests.py`), build the canonical URL with `lon,lat;lon,lat` ordering and params `overview=full&geometries=polyline6&alternatives=true&annotations=nodes,distance,duration,weight,speed,datasources&steps=true`
    - _Requirements: 9.2, 9.3, 2.2_

  - [ ]* 5.2 Write property test for default OSRM request construction
    - **Property 12: Default OSRM request construction** — coordinates in `lon,lat;lon,lat` order and all default params present
    - Hypothesis over valid coordinates, min 100 iterations
    - Tag: `Feature: bike-routing-dashboard, Property 12: Default OSRM request construction`
    - **Validates: Requirements 9.2, 9.3**

  - [x] 5.3 Implement `normalize_osrm_response`
    - Create/extend `app/normalize.py` with `normalize_osrm_response`: handle `code != "Ok"`/missing routes → zero routes + `no_route`; `routes[0]` primary, `routes[1..]` alternates; per-route `distanceMeters=distance`, `durationSeconds=duration`, `cost=weight`; decode `geometry` polyline6 → `[lon,lat]`; missing fields → `null`; preserve full `raw`
    - Per-route malformed geometry: drop only that route, keep `status="ok"`, append `geometry_error` `RouteWarning` (engine + routeIndex)
    - _Requirements: 3.1, 3.3, 7.2, 7.4, 11.5, 11.6, 12.2, 17.8, 17.9, 17.10, 17.11_

  - [ ]* 5.4 Write unit tests for OSRM normalization edge cases
    - Cover NoRoute, zero alternates, missing summary fields, custom-field preservation via representative examples
    - _Requirements: 7.2, 7.4, 17.8, 17.9_

- [x] 6. Implement Valhalla request builder and normalizer
  - [x] 6.1 Implement Default_Valhalla_Request builder
    - Build the canonical body: `costing="motorcycle"`, `alternates=10`, `shape_format="polyline6"`, `directions_options.units="kilometers"`, `locations` as lat/lon `type:"break"` entries
    - _Requirements: 2.2, 7.3_

  - [x] 6.2 Implement `normalize_valhalla_response` with unit-aware conversion and multi-leg dedup
    - In `app/normalize.py`: error response → zero routes + `no_route`; `trip` primary, `alternates[i].trip` alternates; resolve units (prefer `trip.units`, else request context, else km) and convert km→m (`*1000`) / miles→m (`*1609.344`), always store meters; `durationSeconds=summary.time`, `cost=summary.cost`
    - Accept an OPTIONAL request-unit context parameter used as the fallback when `trip.units` is absent; resolution order stays: `trip.units` if present, else the request units context, else kilometers
    - Decode each `trip.legs[*].shape` independently and concatenate, skipping a duplicate boundary coordinate within `1e-6`; single leg is the simple case
    - Per-route malformed geometry isolation and `geometry_error` warning as with OSRM; preserve full `raw`; missing fields → `null`
    - _Requirements: 3.2, 7.3, 7.4, 11.5, 11.6, 12.3, 17.8, 17.9, 17.10, 17.11_

  - [ ]* 6.3 Write property test for Valhalla unit conversion
    - **Property 3: Valhalla unit conversion** — `distanceMeters` = length×1000 (km) or length×1609.344 (miles); duration/cost passthrough; always meters
    - Hypothesis over summaries + km/miles units, min 100 iterations
    - Tag: `Feature: bike-routing-dashboard, Property 3: Valhalla unit conversion`
    - **Validates: Requirements 7.3**

  - [ ]* 6.4 Write property tests shared across both normalizers
    - **Property 2: Normalization count invariant** — produced route count equals returned count (all-valid case), exactly one primary, zero alternates → primary only
    - **Property 5: NormalizedRoute structural invariant** — `[lon,lat]` in range, valid `engine`, `isPrimary == (index==0)`, numeric-or-null fields
    - **Property 6: No-route handling** — `code!="Ok"`/Valhalla error → zero routes + `no_route`, raw preserved
    - **Property 7: Per-route malformed-geometry isolation** — corrupt route dropped, status stays `ok`, raw preserved, `geometry_error` warning with engine+routeIndex
    - **Property 4: Raw response preservation** — preserved `raw` deep-equals original including custom fields
    - Each property is its own separate Hypothesis test, min 100 iterations, tagged `Feature: bike-routing-dashboard, Property {n}: {text}`
    - **Validates: Requirements 3.3, 3.4, 3.5, 8.3, 17.9 (P2); 12.1 (P5); 17.8 (P6); 17.10, 17.11 (P7); 11.1, 11.5, 11.6 (P4)**

- [x] 7. Implement POST /api/compare fan-out
  - [x] 7.1 Implement the compare handler with concurrent fan-out and error isolation
    - In `app/routes.py`, accept start+dest only, build canonical OSRM + Valhalla requests, run both via `asyncio.gather(..., return_exceptions=True)`, normalize each, and assemble independent `EngineResult` envelopes into `CompareResponse`
    - Convert any per-task exception to that engine's error envelope without aborting the sibling; carry `warnings`, `httpStatus`, `durationMs` per engine
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.7, 17.13_

  - [ ]* 7.2 Write property test for error isolation between engines
    - **Property 8: Error isolation between engines** — each envelope independent; one engine's failure never alters the other's routes/status
    - Hypothesis over pairs of per-engine outcomes, min 100 iterations
    - Tag: `Feature: bike-routing-dashboard, Property 8: Error isolation between engines`
    - **Validates: Requirements 2.2, 2.3, 17.13**

  - [ ]* 7.3 Write integration test for compare fan-out with mocked engines
    - Assert both engines are called concurrently and a full `CompareResponse` is produced
    - _Requirements: 2.1_

- [x] 8. Checkpoint - Real-engine backend integration against running local services
  - Run `POST /api/compare` against the ACTUAL running local engines (OSRM `http://localhost:5000`, Valhalla `http://localhost:8002`) — NOT mocks — using the reference testcase: start `lat=28.78447495380769, lon=76.87892122549387`, dest `lat=28.207132203283837, lon=77.45894473456683`
  - Verify `/api/compare` returns an independent success envelope for each engine — one engine failing MUST NOT fail the other
  - Verify OSRM `routes[]` normalize correctly into primary + alternates
  - Verify Valhalla `trip` + `alternates[].trip` normalize correctly into primary + alternates
  - Verify the Valhalla canonical costing sent is `"motorcycle"`
  - Verify decoded polyline6 coordinates fall within the expected Delhi/NCR area (roughly lat 28.0–29.0, lon 76.8–77.6) — i.e. not reversed and not empty
  - Verify `distanceMeters` / `durationSeconds` / `cost` are populated (non-null) for returned routes
  - Verify complete raw responses are preserved; for custom fields such as `turn_id`, `from_linkId_idx`, `to_linkId_idx`, `from_node_idx`, `to_node_idx`, and `annotations`, verify that any such custom fields PRESENT in the actual engine response remain unchanged (byte-for-byte / deep-equal) in the preserved raw response — and MUST NOT fail merely because a particular custom field is absent from this testcase
  - This checkpoint MUST NOT fail merely because fewer alternates are returned than requested
  - If the engines are not reachable, the developer should start them / confirm they are running before this checkpoint — do NOT build or execute the engines from the dashboard (Req 19)
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 7.2, 7.3, 11.1, 11.5, 12.2, 12.3, 17.9_

- [x] 9. Implement raw forwarding endpoints
  - [x] 9.1 Implement `POST /api/osrm/raw` and `POST /api/valhalla/raw`
    - OSRM raw: validate host is `localhost:5000`, GET the exact URL verbatim, time it, normalize, return single `EngineResult`
    - Valhalla raw: validate host is `localhost:8002`, POST the exact URL + JSON body verbatim (no default substitution of `costing`/options), normalize, return single `EngineResult`
    - For the Valhalla raw call, derive the fallback unit context from the request body's `directions_options.units` and pass it into `normalize_valhalla_response`
    - _Requirements: 9.4, 9.5, 9.6, 9.7, 7.3_

  - [ ]* 9.2 Write property test for verbatim raw forwarding
    - **Property 11: Verbatim raw forwarding** — outbound OSRM URL equals input exactly; forwarded Valhalla body deep-equals input
    - Hypothesis over allowed-host URLs and JSON bodies, min 100 iterations
    - Tag: `Feature: bike-routing-dashboard, Property 11: Verbatim raw forwarding`
    - **Validates: Requirements 9.5, 9.7**

- [x] 10. Implement curl import
  - [x] 10.1 Implement `parse_curl` and the `/api/curl/import` handler
    - Create `app/curlparse.py` using `shlex.split` (never a shell) to extract method/URL/headers/body; validate the host against the allowlist; map URL → engine (`/route/v1/` on :5000 → OSRM, `:8002/route` → Valhalla); execute via the allowlisted httpx path
    - Reject non-allowlisted host, non-curl input, missing URL, or invalid Valhalla JSON with a 400 and actionable message, executing nothing
    - For a Valhalla request imported via curl, derive the fallback unit context from the parsed JSON body's `directions_options.units` and pass it into `normalize_valhalla_response`
    - Wire the handler to return `{ engine, result: EngineResult }`
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 17.7, 19.1, 7.3_

  - [ ]* 10.2 Write unit test for curl safety
    - Input containing `$(...)`/backticks is tokenized, never executed, no side effects; non-allowlisted host rejected
    - _Requirements: 10.3, 10.4, 17.7_

- [x] 11. Implement frontend shared types, API client, and store
  - [x] 11.1 Define shared TypeScript types
    - Create `src/types.ts` with `Engine`, `NormalizedRoute`, `EngineResult`, `EngineError`, `RouteWarning`, `CompareResponse`, `TestCase`, `RouteQuality`, `EngineHealth`
    - Mirror the backend envelope shapes exactly
    - _Requirements: 12.1, 12.4_

  - [x] 11.2 Implement the API client
    - Create `src/api.ts` with `compare(start, dest)`, `osrmRaw(url)`, `valhallaRaw(url, body)`, `curlImport(curl)`, and `health()` calling the backend endpoints
    - _Requirements: 2, 9, 10, 16_

  - [x] 11.3 Implement the Zustand store
    - Create `src/store.ts` with `AppState` (coords, `mapClickTarget`, `mode`, drafts, `results`, `routes`, `visibility`, `selectedRouteId`, `testCases`, `quality`, `health`) and actions to set coords, arm map click target, set mode/drafts, run compare, `selectRoute`, toggle visibility, and manage test cases/quality
    - Flatten envelopes into `routes` and initialize `visibility` to all-visible for returned routes only on compare
    - _Requirements: 2, 5, 6, 12.4, 13, 14, 16_

- [x] 12. Build the React layout shell
  - [x] 12.1 Implement layout components
    - Create `Toolbar` (title, Compare button, health indicators), `LeftSidebar`, `MapView` placeholder (largest region), `RightSidebar`, and `BottomTabs` (Comparison, OSRM Raw Request, OSRM Response, Valhalla Raw Request, Valhalla Response, Assessment); assemble in `App.tsx` with desktop-first layout
    - Wire Compare button and health indicators to the store
    - _Requirements: 2.6, 2.7, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 16.5, 17.1, 17.2_

- [x] 13. Initialize MapLibre map with basemap, markers, and coordinate selection
  - [x] 13.1 Initialize the MapLibre map with a configurable no-key OSM basemap
    - In `MapView`, create the map with default center on Delhi NCR (`28.6139, 77.2090`) when no coords/routes exist
    - `VITE_MAP_STYLE_URL` is an OPTIONAL MapLibre STYLE URL: if it is configured, use it as the map style
    - If `VITE_MAP_STYLE_URL` is ABSENT, do NOT treat an OSM raster tile URL as a MapLibre style URL; instead construct an INLINE MapLibre style object containing a raster source with `tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"]`, `tileSize: 256`, and proper OpenStreetMap attribution, plus a raster layer consuming that source
    - _Requirements: 20.4, 20.5_

  - [x] 13.2 Render start/destination markers and map-based coordinate selection
    - Render distinct start and destination markers; implement "Set Start on Map"/"Set Destination on Map" arming + click-to-set; implement right-click context menu with "Set as Start"/"Set as Destination"
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 14. Implement coordinate inputs, validation, and request preview
  - [x] 14.1 Implement manual coordinate inputs with validation and live request preview
    - In `LeftSidebar`/`CoordinateInputs`, add manual lat/lon fields for start and dest; validate lat∈[-90,90], lon∈[-180,180] and both present, blocking send on invalid; regenerate Normal-mode OSRM/Valhalla request previews via a derived selector when coords change
    - _Requirements: 1.1, 1.8, 17.4, 9.2_

  - [ ]* 14.2 Write property test for coordinate validation
    - **Property 13: Coordinate validation** — pass iff lat∈[-90,90] and lon∈[-180,180] and both present; invalid pair produces no engine request
    - fast-check, min 100 iterations
    - Tag: `Feature: bike-routing-dashboard, Property 13: Coordinate validation`
    - **Validates: Requirements 17.4**

- [x] 15. Checkpoint - Ensure backend and frontend build and all tests pass
  - Ensure the backend boots, the frontend builds, and all tests pass, ask the user if questions arise.

- [x] 16. Implement route rendering with combined GeoJSON source and feature-state layers
  - [x] 16.1 Build the combined route GeoJSON source and three layers
    - In `MapView`, build one `FeatureCollection` from `routes` with `properties.routeId/engine/index/isPrimary/color` and `promoteId: "routeId"`; add layers `routes-hit` (transparent wide, bottom), `routes-base`, `routes-selected` (added last), none using a `filter`
    - Render all returned routes (primary + alternates) for both engines; feature count follows returned routes only
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.4_

  - [x] 16.2 Drive visibility/selection paint via feature-state
    - Set `feature-state.visible`/`selected` via `map.setFeatureState` keyed by `routeId`; `routes-base` opacity collapses to 0 when not visible and reduces when a selection exists; `routes-selected` draws only when `selected && visible` (else opacity/width 0)
    - Whenever new Compare results replace/update the combined `routes` GeoJSON source data (`setData`), after the source data is available, REAPPLY MapLibre feature-state for every current route — `visible` from the application visibility state and `selected` from `selectedRouteId`
    - Newly returned routes initially receive `visible=true`
    - Note: feature-state does NOT survive a source-data replacement, so it MUST be reapplied
    - _Requirements: 6.4, 6.5, 3.5_

  - [ ]* 16.3 Write property test for hit-test determinism
    - **Property 18: Hit-test determinism** — tie-break returns the same `routeId` on repeated evaluation (prefer selected, else topmost, stable engine-then-index)
    - fast-check over candidate feature sets, min 100 iterations
    - Tag: `Feature: bike-routing-dashboard, Property 18: Hit-test determinism`
    - **Validates: Requirements 6.1**

- [x] 17. Implement route color assignment
  - [x] 17.1 Implement `routeColor` HSL family generator
    - Create `src/color.ts` with `routeColor(engine, index)` assigning OSRM blue band and Valhalla warm band, rotating hue and modulating lightness for distinctness; used when building the GeoJSON `color` property
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 17.2 Write property tests for color family and distinctness
    - **Property 15: Color family band membership** — OSRM hue in blue band, Valhalla hue in warm band
    - **Property 16: Color distinctness** — for N in 1..32, generated colors pairwise distinct
    - Two separate fast-check tests, min 100 iterations each, tagged accordingly
    - **Validates: Requirements 4.1, 4.2 (P15); 4.4 (P16)**

- [x] 18. Implement map fitting
  - [x] 18.1 Implement the shared fit routine and controls
    - Implement one `fitTo(coords)` routine; auto-fit to combined bounds of all valid routes after a successful Compare; add a manual "Fit Routes" control using the same routine; fall back to fitting start/dest markers when no routes exist
    - _Requirements: 20.1, 20.2, 20.3_

- [x] 19. Checkpoint - Real-engine map integration
  - Using the SAME reference testcase (start `lat=28.78447495380769, lon=76.87892122549387`, dest `lat=28.207132203283837, lon=77.45894473456683`), run the backend + frontend against the ACTUAL running local engines and visually verify the map rendering
  - Verify OSRM primary and all returned alternates are plotted
  - Verify Valhalla primary and all returned alternates are plotted
  - Verify coordinates are not reversed
  - Verify routes render in the correct Delhi/NCR geographic location
  - Verify OSRM (blue family) and Valhalla (warm family) colors are distinguishable
  - Verify overlapping primary/alternate paths do not lose geometry
  - Verify automatic and manual route fitting works
  - Do NOT continue into secondary UI features (selection, tables, editors, curl, test cases, assessment) if this basic real-engine map integration is broken
  - _Requirements: 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 20.1, 20.2_

- [x] 20. Implement route visibility panel and bulk controls
  - [x] 20.1 Implement per-route visibility checkboxes and bulk controls
    - In `RightSidebar`/`VisibilityControls`, add per-route checkboxes grouped by engine and bulk controls (Show All, Hide All, OSRM Only, Valhalla Only, Primary Only, Alternatives Only) as pure `visible` feature-state transforms; hit layer width 0 when hidden
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [ ]* 20.2 Write property test for bulk visibility partition
    - **Property 17: Bulk visibility partition** — each bulk control yields its exact defined partition of the visibility map
    - fast-check over route sets, min 100 iterations
    - Tag: `Feature: bike-routing-dashboard, Property 17: Bulk visibility partition`
    - **Validates: Requirements 5.3, 5.4, 5.5, 5.6, 5.7, 5.8**

- [x] 21. Implement route selection across map, list, and table
  - [x] 21.1 Implement selection funnel and hit-testing
    - Implement `selectRoute(routeId)` as the single funnel; on map click call `queryRenderedFeatures` on `routes-hit`, resolve deterministically (prefer selected, else topmost, stable engine-then-index tie-break); wire list-entry and (later) table-row clicks to the same funnel; render selected thicker/opaque/on top, others dimmed
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6_

- [x] 22. Implement route summary and comparison table
  - [x] 22.1 Implement the route summary list
    - In `RouteList`/`SelectedRouteInfo`, show per route: engine, name/index, primary vs alternate, distance, duration, cost/weight when available, request execution time; missing values render without error; display selected route info
    - _Requirements: 6.6, 7.1, 7.4_

  - [x] 22.2 Implement the comparison table with vs-primary computation
    - In `ComparisonTab`, render columns Engine, Route, Distance, Duration, Cost/Weight, Distance vs Primary, Duration vs Primary; compute vs-primary against that route's own engine primary using meters; handle primary value 0 without NaN/Infinity; row click selects the route
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 22.3 Write property test for comparison vs-primary computation
    - **Property 14: Comparison vs-primary computation** — diff = (value − primary)/primary against own-engine primary; primary's own diff = 0; primary 0 yields no NaN/Infinity
    - fast-check, min 100 iterations
    - Tag: `Feature: bike-routing-dashboard, Property 14: Comparison vs-primary computation`
    - **Validates: Requirements 8.2**

- [x] 23. Implement raw request editors (Normal + Advanced)
  - [x] 23.1 Implement Normal preview and Advanced editors with guards
    - In OSRM/Valhalla Raw Request tabs: show Normal-mode generated request previews; add Advanced editable OSRM URL + "Send OSRM Request", and editable Valhalla URL + JSON body + "Send Valhalla Request" calling the raw endpoints; block send on invalid JSON body and invalid raw request with an error
    - _Requirements: 9.1, 9.4, 9.5, 9.6, 9.7, 17.5, 17.6_

- [x] 24. Implement raw response inspectors
  - [x] 24.1 Implement the Raw_Response_Inspector for both engines
    - In OSRM/Valhalla Response tabs: pretty-printed, collapsible JSON of the full raw response with a copy control; display errors clearly; preserve/display custom fields as received
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 25. Implement curl import UI
  - [x] 25.1 Implement separate OSRM/Valhalla curl paste areas
    - Add separate OSRM and Valhalla curl paste areas; submit text to `/api/curl/import` and display parsed/executed result or returned error
    - _Requirements: 10.1, 10.2, 17.7_

- [x] 26. Implement saved test cases
  - [x] 26.1 Implement test case save/load/rename/delete with localStorage
    - In `TestCases`: represent `{id,name,start,dest,notes?}`; Save Current Test, Load, Rename, Delete; persist to localStorage and hydrate on load; loading restores coords and regenerates previews but does not auto-Compare
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [ ]* 26.2 Write property test for persistence round-trip
    - **Property 19: Persistence round-trip** — saving a test case (and its quality rating/notes) to localStorage and reloading returns an equal value
    - fast-check over test cases + quality, min 100 iterations
    - Tag: `Feature: bike-routing-dashboard, Property 19: Persistence round-trip`
    - **Validates: Requirements 13.3, 14.3, 14.4**

- [x] 27. Implement assessment/quality notes
  - [x] 27.1 Implement route quality rating, notes, and warning display
    - In `AssessmentTab`: assign Good/Bad/Neutral rating and optional notes per returned route, persisted to localStorage (associated with the test case); display per-route normalization warnings including `geometry_error` entries
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 17.11_

- [x] 28. Wire cross-engine error handling in the UI
  - [x] 28.1 Surface per-engine and per-route errors with isolation
    - Map each `EngineError.kind` to an actionable message per engine (unreachable, timeout, http_error, no_route, invalid_request); render primary and a "no alternatives returned" note on zero alternates; retain and display the healthy engine's routes when the other errors; display per-route warnings
    - _Requirements: 17.1, 17.2, 17.3, 17.8, 17.9, 17.12, 17.13_

- [x] 29. Add remaining frontend example/integration tests
  - [x]* 29.1 Write frontend example/integration tests
    - Per-engine status/duration/HTTP-code rendering; comparison columns + row-click selection; selected-route layer/paint behavior; map fitting (Compare fit, Fit Routes, markers-only, Delhi default); geometry_error warning display; raw inspector pretty/collapsible/copy/error; curl safety; Advanced-mode guards; test-case load without auto-Compare; quality rating/notes; health treats any HTTP response as reachable and app stays usable
    - _Requirements: 2.4, 2.5, 6.4, 6.5, 6.6, 8.1, 8.4, 11.2, 11.3, 11.4, 13.4, 13.5, 14.1, 14.2, 16.1, 16.2, 16.3, 16.4, 16.5, 17.5, 17.6, 20.1, 20.2, 20.3, 20.5_

- [x] 30. Write the project README
  - [x] 30.1 Write `biking/README.md`
    - Document architecture, prerequisites, frontend and backend install and start steps, required OSRM/Valhalla endpoints, and Normal/Advanced/curl import usage
    - Note the engine-preservation constraint (dashboard only calls running services; never builds/restarts/executes engines)
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 19.2, 19.3_

- [x] 31. Final checkpoint - Full integration testing pass
  - Run the backend and frontend test suites (property + example/integration), fix failures, and confirm an end-to-end mocked Compare produces a full `CompareResponse`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; per the NFR, property-based tests are the priority for the correctness-critical pure logic but MUST NOT block delivery.
- Each task references specific requirements (and, for tests, specific correctness properties) for traceability.
- Property tests use Hypothesis (backend) and fast-check (frontend), each property implemented by a single test with the tag format `Feature: bike-routing-dashboard, Property {n}: {text}`, min 100 iterations.
- UI rendering, map paint/z-order, fit-bounds, and reachability are covered by example/integration tests, not PBT.
- No tasks modify, rebuild, restart, or execute the routing engines (Req 19); no auth/database/docker/cloud tasks are included.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "3.1", "11.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.1", "5.1", "6.1", "11.2", "11.3"] },
    { "id": 3, "tasks": ["4.2", "4.3", "5.2", "5.3", "6.2", "12.1"] },
    { "id": 4, "tasks": ["4.4", "4.5", "5.4", "6.3", "6.4", "7.1", "9.1", "13.1", "14.1"] },
    { "id": 5, "tasks": ["7.2", "7.3", "8", "9.2", "10.1", "13.2", "14.2", "17.1"] },
    { "id": 6, "tasks": ["10.2", "16.1", "17.2", "26.1"] },
    { "id": 7, "tasks": ["16.2", "20.1", "23.1", "24.1", "25.1", "26.2", "27.1", "30.1"] },
    { "id": 8, "tasks": ["16.3", "20.2", "21.1", "18.1"] },
    { "id": 9, "tasks": ["19", "22.1", "22.2", "28.1"] },
    { "id": 10, "tasks": ["22.3", "29.1"] }
  ]
}
```

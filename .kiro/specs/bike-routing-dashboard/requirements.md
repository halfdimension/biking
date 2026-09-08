# Requirements Document

## Introduction

The Bike Routing Comparison and Debugging Dashboard is a local engineering tool for analyzing and debugging route quality and alternate-route quality produced by two custom routing engines: an OSRM 5.25 custom fork and a Valhalla 3.3.0 custom fork. The dashboard sends requests to the already-running local services, visualizes their responses on a map, and provides side-by-side comparison, raw request/response inspection, and route quality assessment.

This is a debugging and analysis instrument for routing engineers, not a decorative consumer route viewer. The dashboard MUST NOT modify, rebuild, restart, or otherwise change either routing engine; it only calls the running local HTTP services and analyzes their responses.

The system consists of a React + TypeScript + Vite + MapLibre GL JS frontend and a Python + FastAPI backend that proxies requests to the local engines (avoiding CORS, providing a place for normalization, timing, and raw request forwarding). Version 1 uses no database; saved test cases and route quality notes persist through browser localStorage or simple local JSON.

## Glossary

- **Dashboard**: The complete Bike Routing Comparison and Debugging Dashboard, comprising the frontend application and the backend proxy service.
- **Frontend**: The React + TypeScript + Vite application using MapLibre GL JS that renders the user interface and map.
- **Backend**: The Python + FastAPI service that proxies requests from the Frontend to the routing engines and returns their responses.
- **OSRM_Engine**: The OSRM 5.25 custom fork running locally at `http://localhost:5000`, queried with the profile `biking`.
- **Valhalla_Engine**: The Valhalla 3.3.0 custom fork running locally, queried via `POST http://localhost:8002/route`.
- **Routing_Engine**: A collective term referring to either the OSRM_Engine or the Valhalla_Engine.
- **polyline6**: A polyline geometry encoding at precision 6 used by both engines for route shapes. THE Backend decodes polyline6 into `[lon,lat]` coordinate arrays during normalization, and the Frontend renders the already-decoded coordinates.
- **Primary_Route**: The main route returned by an engine. For OSRM_Engine it is `routes[0]`; for Valhalla_Engine it is `response.trip`.
- **Alternate_Route**: A non-primary route returned by an engine. For OSRM_Engine these are `routes[1..]`; for Valhalla_Engine these are `response.alternates[i].trip`.
- **NormalizedRoute**: The Dashboard's internal engine-agnostic route model: `{ id, engine: "osrm" | "valhalla", index, isPrimary, label, coordinates [lon,lat][], distanceMeters | null, durationSeconds | null, cost | null, raw }`.
- **Normal_Mode**: The request-building mode in which the Dashboard automatically constructs engine requests from the selected coordinates using the default parameter sets.
- **Advanced_Mode**: The request-building mode (also called Raw Mode) in which the user edits the full request (OSRM URL, or Valhalla URL and JSON body) and the Dashboard sends exactly what the user entered.
- **Default_OSRM_Request**: The OSRM request URL of the form `http://localhost:5000/route/v1/biking/{start_lon},{start_lat};{end_lon},{end_lat}?overview=full&geometries=polyline6&alternatives=true&annotations=nodes,distance,duration,weight,speed,datasources&steps=true`.
- **Default_Valhalla_Request**: The Valhalla JSON request body using `"costing": "motorcycle"`, `"alternates": 10`, `"shape_format": "polyline6"`, `"directions_options": {"units": "kilometers"}`, and `locations` entries expressed as lat/lon with `"type": "break"`. The `units` value is a default only; Advanced_Mode may send another unit such as `"miles"`, so unit handling MUST NOT permanently assume kilometers.
- **Test_Case**: A saved coordinate pair with metadata: `{ id, name, start lat/lon, dest lat/lon, optional notes }`.
- **Route_Quality_Rating**: A user-assigned assessment of a returned route with a value of Good, Bad, or Neutral/Unrated, plus optional free-text notes.
- **Engine_Health_Status**: An indicator of whether a Routing_Engine is currently reachable.
- **Route_Warning**: A per-route normalization warning with the fields `engine`, `routeIndex`, `kind`, and `message`.
- **Comparison_Table**: The tabular view comparing returned routes across both engines.
- **Raw_Response_Inspector**: The view that displays complete, unmodified engine responses.

## Requirements

### Requirement 1: Coordinate Selection

**User Story:** As a routing engineer, I want to specify start and destination coordinates through multiple input methods, so that I can quickly set up route tests using whichever method is most convenient.

#### Acceptance Criteria

1. THE Frontend SHALL provide manual latitude and longitude entry fields for both the start coordinate and the destination coordinate.
2. WHEN the user activates the "Set Start on Map" control and then clicks a location on the map, THE Frontend SHALL set the start coordinate to the clicked location's latitude and longitude.
3. WHEN the user activates the "Set Destination on Map" control and then clicks a location on the map, THE Frontend SHALL set the destination coordinate to the clicked location's latitude and longitude.
4. WHEN the user right-clicks a location on the map, THE Frontend SHALL display a context menu containing "Set as Start" and "Set as Destination" options.
5. WHEN the user selects "Set as Start" from the map context menu, THE Frontend SHALL set the start coordinate to the context menu location's latitude and longitude.
6. WHEN the user selects "Set as Destination" from the map context menu, THE Frontend SHALL set the destination coordinate to the context menu location's latitude and longitude.
7. THE Frontend SHALL render a distinct start marker and a distinct destination marker at their respective coordinates.
8. WHEN the start coordinate or the destination coordinate changes, THE Frontend SHALL regenerate the Default_OSRM_Request preview and the Default_Valhalla_Request preview from the current coordinates.

### Requirement 2: Compare Routes Action

**User Story:** As a routing engineer, I want to send a single Compare Routes action to both engines at once, so that I can evaluate their outputs for the same coordinate pair independently.

#### Acceptance Criteria

1. WHEN the user activates the Compare Routes action, THE Backend SHALL send a request to the OSRM_Engine and a request to the Valhalla_Engine concurrently.
2. WHEN the user activates the Compare Routes action, THE Backend SHALL build the canonical Default_OSRM_Request and Default_Valhalla_Request from the selected coordinates in Normal_Mode, and the Compare Routes action SHALL NOT use Advanced_Mode drafts.
3. WHERE the user needs Advanced_Mode requests, THE Frontend SHALL send Advanced OSRM requests via the OSRM raw path and Advanced Valhalla requests via the Valhalla raw path as defined in Requirement 9.
4. IF the OSRM_Engine request fails, THEN THE Backend SHALL still complete and return the Valhalla_Engine request result.
5. IF the Valhalla_Engine request fails, THEN THE Backend SHALL still complete and return the OSRM_Engine request result.
6. WHEN a Compare Routes action completes, THE Frontend SHALL display the success or error status for the OSRM_Engine independently from the Valhalla_Engine.
7. WHEN a Compare Routes action completes, THE Frontend SHALL display the HTTP status code and the request execution duration for the OSRM_Engine and for the Valhalla_Engine separately.

### Requirement 3: Route Geometry Rendering

**User Story:** As a routing engineer, I want route geometries from both engines rendered accurately on the map, so that I can visually inspect the paths each engine produces.

#### Acceptance Criteria

1. WHEN the OSRM_Engine returns a route with polyline6 geometry, THE Backend SHALL decode the polyline6 geometry into a MapLibre-ready `[lon,lat]` coordinate array during normalization, and THE Frontend SHALL render the already-decoded coordinates it receives.
2. WHEN the Valhalla_Engine returns a route with polyline6 geometry, THE Backend SHALL decode the polyline6 geometry into a MapLibre-ready `[lon,lat]` coordinate array during normalization, and THE Frontend SHALL render the already-decoded coordinates it receives.
3. THE Frontend SHALL render the Primary_Route and every returned Alternate_Route for the OSRM_Engine on the map.
4. THE Frontend SHALL render the Primary_Route and every returned Alternate_Route for the Valhalla_Engine on the map.
5. THE Frontend SHALL render only the number of routes actually returned by each Routing_Engine.

### Requirement 4: Route Color Assignment

**User Story:** As a routing engineer, I want routes color-coded by engine and individually distinguishable, so that I can tell which engine produced which route on any map background.

#### Acceptance Criteria

1. THE Frontend SHALL assign colors from a blue color family to OSRM_Engine routes.
2. THE Frontend SHALL assign colors from a red or warm color family to Valhalla_Engine routes.
3. THE Frontend SHALL render all simultaneously displayed routes with colors distinguishable from one another on a light map background and on a dark map background.
4. WHEN a Routing_Engine returns more routes than the expected count, THE Frontend SHALL generate additional distinct colors within that engine's color family for the extra routes.

### Requirement 5: Route Visibility Control

**User Story:** As a routing engineer, I want to control which routes are visible individually and in bulk, so that I can focus on specific routes during analysis.

#### Acceptance Criteria

1. THE Frontend SHALL display a per-route visibility checkbox for each returned route, grouped by Routing_Engine.
2. WHEN the user toggles a per-route visibility checkbox, THE Frontend SHALL show or hide the corresponding route on the map according to the checkbox state.
3. WHEN the user activates the "Show All" control, THE Frontend SHALL make all returned routes visible.
4. WHEN the user activates the "Hide All" control, THE Frontend SHALL hide all returned routes.
5. WHEN the user activates the "OSRM Only" control, THE Frontend SHALL make OSRM_Engine routes visible and hide Valhalla_Engine routes.
6. WHEN the user activates the "Valhalla Only" control, THE Frontend SHALL make Valhalla_Engine routes visible and hide OSRM_Engine routes.
7. WHEN the user activates the "Primary Routes Only" control, THE Frontend SHALL make Primary_Route entries visible and hide Alternate_Route entries.
8. WHEN the user activates the "Alternatives Only" control, THE Frontend SHALL make Alternate_Route entries visible and hide Primary_Route entries.

### Requirement 6: Route Selection

**User Story:** As a routing engineer, I want to select a route from the map, the route panel, or the comparison table, so that I can highlight and inspect a single route.

#### Acceptance Criteria

1. WHEN the user clicks a rendered route on the map, THE Frontend SHALL set that route as the selected route.
2. WHEN the user clicks a route entry in the route visibility panel, THE Frontend SHALL set that route as the selected route.
3. WHEN the user clicks a row in the Comparison_Table, THE Frontend SHALL set the corresponding route as the selected route.
4. WHILE a route is selected, THE Frontend SHALL render the selected route thicker than non-selected routes, fully opaque, and above all other routes.
5. WHILE a route is selected, THE Frontend SHALL render non-selected routes at a lower opacity than the selected route.
6. WHILE a route is selected, THE Frontend SHALL display the selected route's information.

### Requirement 7: Route Summary

**User Story:** As a routing engineer, I want a summary of each returned route's attributes, so that I can compare distance, duration, and cost across routes.

#### Acceptance Criteria

1. THE Frontend SHALL display, for each returned route, the Routing_Engine, the route name or index, whether the route is a Primary_Route or an Alternate_Route, the distance, the duration, the cost or weight when available, and the request execution time.
2. THE Frontend SHALL derive OSRM_Engine route summary values from the OSRM_Engine route response.
3. WHEN deriving Valhalla_Engine route summary values from the trip summary fields `summary.length`, `summary.time`, and `summary.cost`, THE Backend SHALL determine the actual distance units from the Valhalla response, preferring `trip.units` when available and otherwise using the request or units context, SHALL convert kilometers to meters by multiplying by 1000 and miles to meters by multiplying by 1609.344, and SHALL always express `NormalizedRoute.distanceMeters` in meters.
4. IF a summary value is missing from a route response, THEN THE Frontend SHALL display the summary for that route without the missing value and without error.

### Requirement 8: Comparison Table

**User Story:** As a routing engineer, I want a comparison table across both engines' routes, so that I can quantitatively evaluate route differences relative to each engine's primary route.

#### Acceptance Criteria

1. THE Comparison_Table SHALL contain the columns Engine, Route, Distance, Duration, Cost/Weight, Distance vs Primary, and Duration vs Primary.
2. THE Comparison_Table SHALL compute the Distance vs Primary and Duration vs Primary values for each route relative to that route's own engine Primary_Route.
3. WHEN the OSRM_Engine and the Valhalla_Engine return different route counts, THE Comparison_Table SHALL display all returned routes for both engines.
4. WHEN the user clicks a Comparison_Table row, THE Frontend SHALL set the corresponding route as the selected route.

### Requirement 9: Raw Request Editing

**User Story:** As a routing engineer, I want to edit and send raw engine requests, so that I can debug specific parameter combinations without the dashboard altering my input.

#### Acceptance Criteria

1. THE Frontend SHALL provide a Normal_Mode and an Advanced_Mode for request construction.
2. WHILE in Normal_Mode, THE Frontend SHALL build engine requests automatically from the current coordinates using the Default_OSRM_Request and Default_Valhalla_Request parameter sets.
3. WHILE in Normal_Mode, THE Frontend SHALL retain all default OSRM request parameters `overview=full`, `geometries=polyline6`, `alternatives=true`, `annotations=nodes,distance,duration,weight,speed,datasources`, and `steps=true`.
4. WHILE in Advanced_Mode, THE Frontend SHALL provide an editable full OSRM request URL field and a "Send OSRM Request" control.
5. WHEN the user activates "Send OSRM Request" in Advanced_Mode, THE Backend SHALL send exactly the OSRM request URL entered by the user without regenerating or overwriting any parameters.
6. WHILE in Advanced_Mode, THE Frontend SHALL provide an editable Valhalla URL field, an editable Valhalla JSON body field, and a "Send Valhalla Request" control.
7. WHEN the user activates "Send Valhalla Request" in Advanced_Mode, THE Backend SHALL submit exactly the Valhalla JSON body entered by the user without replacing the user-edited `costing` value or other options with defaults.

### Requirement 10: Curl Import

**User Story:** As a routing engineer, I want to import requests by pasting curl commands, so that I can reproduce requests captured from other tools quickly and safely.

#### Acceptance Criteria

1. THE Frontend SHALL provide a separate OSRM_Engine curl paste area and a separate Valhalla_Engine curl paste area.
2. WHEN the user submits a curl command for import, THE Frontend SHALL submit the curl text to the Backend and display the parsed or executed result or the returned error.
3. WHEN the Backend receives curl text for import, THE Backend SHALL parse the curl syntax to extract the HTTP method, URL, headers, and body.
4. THE Backend SHALL NOT invoke a shell when processing imported curl input.
5. IF an imported curl command targets a host other than the configured OSRM_Engine or Valhalla_Engine service (the allowlist), THEN THE Backend SHALL reject the import and return an actionable error message.

### Requirement 11: Raw Response Inspection

**User Story:** As a routing engineer, I want to inspect complete raw engine responses, so that I can debug custom engine fields that the map and table views do not show.

#### Acceptance Criteria

1. THE Raw_Response_Inspector SHALL retain the complete raw response from the OSRM_Engine and from the Valhalla_Engine.
2. THE Raw_Response_Inspector SHALL display each raw response as pretty-printed, collapsible JSON.
3. THE Raw_Response_Inspector SHALL provide a copy control for each raw response.
4. IF a Routing_Engine returns an error, THEN THE Raw_Response_Inspector SHALL display the error clearly.
5. THE Backend SHALL preserve all custom and unrecognized engine fields, including `turn_id`, `from_linkId_idx`, `to_linkId_idx`, `from_node_idx`, `to_node_idx`, and the annotations `nodes`, `distance`, `duration`, `weight`, `speed`, and `datasources`.
6. THE Backend SHALL normalize only the fields required for map and table rendering while preserving the entire original response.

### Requirement 12: Internal Normalized Route Model

**User Story:** As a routing engineer, I want engine responses converted to a common internal model, so that map rendering is decoupled from engine-specific response formats.

#### Acceptance Criteria

1. THE Backend SHALL represent each route as a NormalizedRoute containing `id`, `engine` valued `"osrm"` or `"valhalla"`, `index`, `isPrimary`, `label`, `coordinates` as an array of `[lon,lat]` pairs, `distanceMeters` or null, `durationSeconds` or null, `cost` or null, and `raw`.
2. THE Backend SHALL parse OSRM_Engine responses into NormalizedRoute values using a dedicated `normalizeOsrmResponse` function isolated from generic map rendering.
3. THE Backend SHALL parse Valhalla_Engine responses into NormalizedRoute values using a dedicated `normalizeValhallaResponse` function isolated from generic map rendering.
4. THE Frontend SHALL consume NormalizedRoute values for map rendering.

### Requirement 13: Test Case Management

**User Story:** As a routing engineer, I want to save and reload coordinate pairs as test cases, so that I can rerun the same scenarios repeatedly.

#### Acceptance Criteria

1. THE Frontend SHALL represent a Test_Case with an `id`, a `name`, a start latitude and longitude, a destination latitude and longitude, and optional notes.
2. THE Frontend SHALL provide "Save Current Test", "Load", "Rename", and "Delete" controls for Test_Case management.
3. WHEN the user activates "Save Current Test", THE Frontend SHALL persist the current coordinate pair as a Test_Case in localStorage.
4. WHEN the user loads a Test_Case, THE Frontend SHALL restore the start and destination coordinates and regenerate the Default_OSRM_Request and Default_Valhalla_Request previews.
5. WHEN the user loads a Test_Case, THE Frontend SHALL wait for the user to activate the Compare Routes action before sending any engine request.

### Requirement 14: Route Quality Notes

**User Story:** As a routing engineer, I want to rate and annotate returned routes, so that I can record quality judgments during analysis.

#### Acceptance Criteria

1. THE Frontend SHALL allow the user to assign a Route_Quality_Rating of Good, Bad, or Neutral/Unrated to each returned route.
2. THE Frontend SHALL allow the user to attach optional free-text notes to each returned route.
3. WHERE a saved Test_Case is associated with a rated route, THE Frontend SHALL persist the Route_Quality_Rating and notes with that Test_Case in localStorage.
4. THE Dashboard SHALL persist Route_Quality_Rating data without a server database in version 1.

### Requirement 15: UI Layout

**User Story:** As a routing engineer, I want a professional desktop-oriented engineering layout, so that I can access controls, map, and analysis panels efficiently.

#### Acceptance Criteria

1. THE Frontend SHALL display a top toolbar containing the application title, the Compare Routes control, and the Engine_Health_Status indicators.
2. THE Frontend SHALL display a left sidebar containing coordinate inputs, map selection controls, request options, and saved test cases.
3. THE Frontend SHALL display a center map region that occupies the largest space in the layout.
4. THE Frontend SHALL display a right sidebar containing the OSRM_Engine route list, the Valhalla_Engine route list, visibility controls, and selected route information.
5. THE Frontend SHALL display bottom tabs labeled Comparison, OSRM Raw Request, OSRM Response, Valhalla Raw Request, Valhalla Response, and Assessment.
6. THE Frontend SHALL prioritize desktop layout over mobile layout.

### Requirement 16: Engine Health Monitoring

**User Story:** As a routing engineer, I want to see whether each engine is reachable, so that I know when a failure is due to an unavailable engine.

#### Acceptance Criteria

1. THE Backend SHALL perform a reachability probe against the OSRM_Engine at `http://localhost:5000` and against the Valhalla_Engine at `http://localhost:8002`, where engine health means HTTP service reachability rather than a 2xx status.
2. IF a probe to `http://localhost:5000` or `http://localhost:8002` produces any HTTP response, including a 4xx or 404 response, THEN the corresponding engine SHALL be indicated as reachable in the Engine_Health_Status indicator.
3. IF a probe connection is refused, fails, or times out, THEN the corresponding engine SHALL be indicated as unreachable in the Engine_Health_Status indicator.
4. A 404 or 400 response from a lightweight root probe SHALL NOT by itself indicate that the engine is down.
5. WHILE either Routing_Engine is unreachable, THE Frontend SHALL start and remain usable.

### Requirement 17: Error Handling

**User Story:** As a routing engineer, I want clear and isolated error handling, so that failures are actionable and one engine's failure does not discard the other engine's results.

#### Acceptance Criteria

1. IF the OSRM_Engine is unavailable, THEN THE Frontend SHALL display an actionable error message for the OSRM_Engine.
2. IF the Valhalla_Engine is unavailable, THEN THE Frontend SHALL display an actionable error message for the Valhalla_Engine.
3. IF a Routing_Engine returns an HTTP error status, THEN THE Frontend SHALL display the HTTP error status and an actionable message.
4. IF the user provides invalid coordinates, THEN THE Frontend SHALL display a validation error and SHALL NOT send an engine request.
5. IF the user submits an invalid JSON body in Advanced_Mode, THEN THE Frontend SHALL display a JSON validation error and SHALL NOT send the request.
6. IF the user submits an invalid raw request, THEN THE Frontend SHALL display an error message and SHALL NOT send the request.
7. IF the user submits invalid curl input, THEN THE Frontend SHALL display an error message and SHALL NOT import the request.
8. IF a Routing_Engine returns a NoRoute response, THEN THE Frontend SHALL display a no-route message for that engine.
9. IF a Routing_Engine returns zero alternatives, THEN THE Frontend SHALL render the Primary_Route and display that no alternatives were returned.
10. IF a route geometry is malformed, THEN THE Backend SHALL drop only the malformed route, SHALL keep the engine result status as success when the engine request otherwise succeeded, SHALL preserve the full raw response, and SHALL add a geometry-error Route_Warning identifying the affected route by engine and route index.
11. THE Frontend SHALL display per-route normalization warnings, including geometry-error Route_Warning entries, for the affected routes.
12. IF a Routing_Engine request times out, THEN THE Frontend SHALL display a timeout error for that engine.
13. WHEN one Routing_Engine returns an error, THE Frontend SHALL retain and display the valid routes returned by the other Routing_Engine.

### Requirement 18: Project Documentation

**User Story:** As a developer setting up the dashboard, I want a README documenting architecture and setup, so that I can install and run the dashboard against my local engines.

#### Acceptance Criteria

1. THE README SHALL document the Dashboard architecture, prerequisites, Frontend installation steps, and Backend installation steps.
2. THE README SHALL document how to start the Frontend and the Backend.
3. THE README SHALL document the required OSRM_Engine and Valhalla_Engine endpoints.
4. THE README SHALL document Normal_Mode, Advanced_Mode, and curl import usage.

### Requirement 19: Engine Preservation Constraints

**User Story:** As a routing engineer, I want the dashboard to never alter the engines or their runtime, so that my analysis targets remain unchanged.

#### Acceptance Criteria

1. THE Dashboard SHALL only call the running local OSRM_Engine and Valhalla_Engine HTTP services.
2. THE Dashboard SHALL NOT modify, rebuild, or restart the OSRM_Engine or the Valhalla_Engine.
3. THE Dashboard SHALL NOT execute the provided engine build or runtime commands.
4. THE Dashboard SHALL NOT introduce authentication, cloud services, container orchestration, a database, or deployment infrastructure in version 1.

### Requirement 20: Map Presentation and Fitting

**User Story:** As a routing engineer, I want the map to present a detailed road basemap and frame the relevant geometry automatically, so that I can inspect routes without manually panning or zooming.

#### Acceptance Criteria

1. WHEN a Compare Routes action succeeds, THE Frontend SHALL automatically fit the map view to the combined bounds of all valid returned routes.
2. THE Frontend SHALL provide a manual "Fit Routes" control.
3. IF only start and/or destination markers are present and no routes exist, THEN THE Frontend SHALL fit the map view to those markers.
4. THE Frontend SHALL use a detailed OpenStreetMap-based MapLibre basemap suitable for road inspection that does not require an API key, and THE Frontend SHALL make the map style configurable.
5. WHEN no route and no coordinates exist, THE Frontend SHALL center the map on the Delhi NCR region as a default.

## Non-Functional / Testing Note

Version 1 SHALL retain strong tests (including property-based tests where they add value) for polyline6 decoding, OSRM_Engine and Valhalla_Engine normalization, coordinate ordering, unit conversion, malformed-geometry isolation, raw response preservation, request generation, curl safety and host allowlisting, error isolation, and comparison math. UI-specific behavior MAY be covered by ordinary unit and integration tests, and property-based testing MUST NOT block delivery of a working dashboard.

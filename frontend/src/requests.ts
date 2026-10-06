/**
 * Pure, display-only request preview builders and coordinate validators
 * (Task 14.1, Req 1.1, 1.8, 9.2, 17.4).
 *
 * These helpers mirror the backend's canonical `Default_OSRM_Request` and
 * `Default_Valhalla_Request` builders (see `backend/app/osrm.py` and
 * `backend/app/valhalla.py`) so the Normal-mode UI can show the user exactly
 * what will be sent. They are strictly for DISPLAY: Compare is always built by
 * the backend from start/dest only (design: POST /api/compare). Never send a
 * request from these previews.
 */

import type { Coordinate } from "./types";

/**
 * The fixed default OSRM query string the backend always applies. Kept byte-for-byte
 * identical (and in the same order) to `DEFAULT_OSRM_QUERY` in the backend so the
 * preview matches the real outbound request (Req 9.2, 9.3).
 */
export const DEFAULT_OSRM_QUERY =
  "overview=full" +
  "&geometries=polyline6" +
  "&alternatives=true" +
  "&annotations=nodes,distance,duration,weight,speed,datasources" +
  "&steps=true";

/** True when `lat` is a finite number within the valid latitude range [-90, 90]. */
export function isValidLat(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

/** True when `lon` is a finite number within the valid longitude range [-180, 180]. */
export function isValidLon(lon: number): boolean {
  return Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

/**
 * Build the canonical OSRM route URL for display (Req 9.2, 9.3).
 *
 * Coordinates are emitted in `lon,lat;lon,lat` order (OSRM's URL convention),
 * exactly like `build_default_osrm_url` in the backend, followed by the fixed
 * default query parameters. Display-only — do NOT use to send Compare.
 */
export function buildOsrmPreviewUrl(
  start: Coordinate,
  dest: Coordinate,
  baseUrl = "http://localhost:5000",
): string {
  const coords = `${start.lon},${start.lat};${dest.lon},${dest.lat}`;
  return `${baseUrl}/route/v1/biking/${coords}?${DEFAULT_OSRM_QUERY}`;
}

export const PROD_OSRM_QUERY =
  "steps=false" +
  "&geometries=polyline6" +
  "&overview=full" +
  "&alternatives=true" +
  "&annotations=nodes,distance,duration,weight,speed,datasources";

export function buildProdOsrmPreviewUrl(
  start: Coordinate,
  dest: Coordinate,
): string {
  const coords = `${start.lon},${start.lat};${dest.lon},${dest.lat}`;
  return `https://apis.mapmyindia.com/advancedmaps/v1/<TOKEN>/route_adv/biking/${coords}?${PROD_OSRM_QUERY}`;
}

export function buildProdValhallaPreviewUrl(
  start: Coordinate,
  dest: Coordinate,
): string {
  const locations = `${start.lon},${start.lat};${dest.lon},${dest.lat}`;
  const params = new URLSearchParams([
    ["profile", "biking"],
    ["access_token", "<TOKEN>"],
    ["locations", locations],
    ["date_time", '0,""'],
    ["speedTypes", "traffic"],
  ]);
  return `https://apis.mapmyindia.com/advancedmaps/v2/route?${params.toString().replace("%3CTOKEN%3E", "<TOKEN>")}`;
}

/**
 * Build the canonical Valhalla POST body for display (Req 2.2, 7.3).
 *
 * Mirrors `build_default_valhalla_body` in the backend: `locations` as lat/lon
 * `type: "break"` entries plus the fixed default options. Display-only — do NOT
 * use to send Compare.
 */
export function buildValhallaPreviewBody(
  start: Coordinate,
  dest: Coordinate,
): {
  locations: { lat: number; lon: number; type: string }[];
  costing: string;
  alternates: number;
  shape_format: string;
  directions_options: { units: string };
  costing_options: { motorcycle: { speed_types: string[] } };
  date_time: { type: number };
} {
  return {
    locations: [
      { lat: start.lat, lon: start.lon, type: "break" },
      { lat: dest.lat, lon: dest.lon, type: "break" },
    ],
    costing: "motorcycle",
    alternates: 10,
    shape_format: "polyline6",
    directions_options: { units: "kilometers" },
    costing_options: { motorcycle: { speed_types: ["current"] } },
    date_time: { type: 0 },
  };
}

/** Pretty-printed JSON of the canonical Valhalla body, for read-only display. */
export function buildValhallaPreviewJson(
  start: Coordinate,
  dest: Coordinate,
): string {
  return JSON.stringify(buildValhallaPreviewBody(start, dest), null, 2);
}

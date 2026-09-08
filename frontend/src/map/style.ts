/**
 * Basemap style resolution (Task 13.1, Req 20.4).
 *
 * The map basemap is configurable via the optional `VITE_MAP_STYLE_URL`
 * environment variable, which MUST be a MapLibre *style* URL (a style JSON
 * document). When it is set and non-empty, it is used directly as the map
 * style.
 *
 * When it is absent, we do NOT treat any raster tile URL as a MapLibre style
 * URL. Instead we build an INLINE MapLibre style object that declares a raster
 * source pointing at the standard OpenStreetMap tile server plus a single
 * raster layer consuming it. This gives a no-key, road-level basemap suitable
 * for route inspection.
 */
import type { StyleSpecification } from "maplibre-gl";

/** The standard OpenStreetMap raster tile template (no API key required). */
export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/**
 * Build the inline OSM raster MapLibre style object.
 *
 * Exposed for direct unit testing so we can assert its shape without a real
 * MapLibre instance.
 */
export function inlineOsmRasterStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: [OSM_TILE_URL],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [
      {
        id: "osm",
        type: "raster",
        source: "osm",
      },
    ],
  };
}

/**
 * Resolve the MapLibre style to use for the basemap.
 *
 * @param styleUrl Optional override, defaulting to `VITE_MAP_STYLE_URL`. When a
 *   non-empty string is provided, it is returned verbatim (used directly as the
 *   MapLibre style URL). Otherwise the inline OSM raster style object is
 *   returned.
 *
 * Designed as a pure function (with an injectable override) so it can be unit
 * tested without touching MapLibre or jsdom.
 */
export function resolveMapStyle(
  styleUrl: string | undefined = import.meta.env.VITE_MAP_STYLE_URL,
): string | StyleSpecification {
  if (typeof styleUrl === "string" && styleUrl.trim() !== "") {
    return styleUrl;
  }
  return inlineOsmRasterStyle();
}

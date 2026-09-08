/**
 * Unit tests for `resolveMapStyle` (Task 13.1, Req 20.4).
 *
 * These are pure and require no MapLibre instance or jsdom map support: the
 * override argument lets us exercise both branches directly.
 */
import { describe, it, expect } from "vitest";
import { resolveMapStyle, inlineOsmRasterStyle, OSM_TILE_URL } from "./style";
import type { StyleSpecification } from "maplibre-gl";

describe("resolveMapStyle", () => {
  it("returns the inline OSM raster style object when no style URL is set", () => {
    const style = resolveMapStyle(undefined) as StyleSpecification;

    expect(typeof style).toBe("object");
    expect(style.version).toBe(8);

    const osm = style.sources.osm as {
      type: string;
      tiles?: string[];
      tileSize?: number;
      attribution?: string;
    };
    expect(osm.type).toBe("raster");
    expect(osm.tiles?.[0]).toBe(OSM_TILE_URL);
    expect(osm.tileSize).toBe(256);
    expect(osm.attribution).toMatch(/OpenStreetMap/);

    // Exactly one raster layer consuming the osm source.
    expect(style.layers).toHaveLength(1);
    expect(style.layers[0]).toMatchObject({
      id: "osm",
      type: "raster",
      source: "osm",
    });
  });

  it("treats an empty / whitespace style URL as unset (inline style)", () => {
    expect(typeof resolveMapStyle("")).toBe("object");
    expect(typeof resolveMapStyle("   ")).toBe("object");
  });

  it("returns the style URL string verbatim when set and non-empty", () => {
    const url = "https://example.com/style.json";
    expect(resolveMapStyle(url)).toBe(url);
  });

  it("does not treat the OSM raster tile URL as a style URL by default", () => {
    // The inline builder embeds the tile URL inside a raster source, never as
    // the top-level style.
    const style = inlineOsmRasterStyle();
    expect(style).not.toBe(OSM_TILE_URL);
    const osm = style.sources.osm as { tiles?: string[] };
    expect(osm.tiles?.[0]).toBe(OSM_TILE_URL);
  });
});

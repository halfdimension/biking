/**
 * Unit tests for the per-route color family generator (Task 17.1, Req 4.1–4.4).
 *
 * Pure function — no MapLibre / jsdom needed. Optional property-based tests
 * (Task 17.2, Properties 15 & 16) are intentionally NOT included here; these are
 * ordinary example/edge-case unit tests covering the same behavior:
 *   - OSRM colors fall in the blue band; Valhalla colors in the warm band (Req 4.1, 4.2).
 *   - Primary (index 0) uses the family anchor hue (Req 4.4).
 *   - Generated colors are pairwise distinct across a bounded index range (Req 4.3, 4.4).
 */
import { describe, it, expect } from "vitest";
import { routeColor, HUE_BANDS, SATURATION } from "./color";
import type { Engine } from "../types";

/** Parse an `hsl(h, s%, l%)` string into numeric components. */
function parseHsl(s: string): { h: number; s: number; l: number } {
  const m = /^hsl\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*\)$/.exec(s);
  if (!m) throw new Error(`not a valid hsl() string: ${s}`);
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

describe("routeColor", () => {
  it("returns a well-formed hsl() string", () => {
    const c = routeColor("osrm", 0);
    expect(c).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
    const { s } = parseHsl(c);
    expect(s).toBe(SATURATION);
  });

  it("primary (index 0) uses the family anchor hue", () => {
    expect(parseHsl(routeColor("osrm", 0)).h).toBe(HUE_BANDS.osrm.anchor);
    expect(parseHsl(routeColor("valhalla", 0)).h).toBe(HUE_BANDS.valhalla.anchor);
    // Explicit anchor values from the design (Req 4.4).
    expect(routeColor("osrm", 0)).toBe("hsl(210, 88%, 42%)");
    expect(routeColor("valhalla", 0)).toBe("hsl(15, 88%, 42%)");
  });

  it("OSRM colors have a hue within the blue band (Req 4.1)", () => {
    const { anchor, span } = HUE_BANDS.osrm;
    for (let i = 0; i < 32; i++) {
      const { h } = parseHsl(routeColor("osrm", i));
      expect(h).toBeGreaterThanOrEqual(anchor);
      expect(h).toBeLessThan(anchor + span);
    }
  });

  it("Valhalla colors have a hue within the warm band (Req 4.2)", () => {
    const { anchor, span } = HUE_BANDS.valhalla;
    for (let i = 0; i < 32; i++) {
      const { h } = parseHsl(routeColor("valhalla", i));
      expect(h).toBeGreaterThanOrEqual(anchor);
      expect(h).toBeLessThan(anchor + span);
    }
  });

  it("OSRM and Valhalla bands do not overlap (engine is always separable)", () => {
    const osrm = HUE_BANDS.osrm;
    const val = HUE_BANDS.valhalla;
    const osrmEnd = osrm.anchor + osrm.span;
    const valEnd = val.anchor + val.span;
    // Warm band ends before the blue band starts.
    expect(valEnd).toBeLessThanOrEqual(osrm.anchor);
    expect(osrmEnd).toBeGreaterThan(osrm.anchor);
  });

  it.each<Engine>(["osrm", "valhalla"])(
    "generates pairwise-distinct colors for N in 1..32 (%s) (Req 4.4)",
    (engine) => {
      for (let n = 1; n <= 32; n++) {
        const colors = Array.from({ length: n }, (_, i) => routeColor(engine, i));
        const unique = new Set(colors);
        expect(unique.size).toBe(n);
      }
    },
  );

  it("is a pure function (same input → same output)", () => {
    expect(routeColor("osrm", 7)).toBe(routeColor("osrm", 7));
    expect(routeColor("valhalla", 3)).toBe(routeColor("valhalla", 3));
  });

  it("normalizes negative/fractional indices to the primary anchor family", () => {
    // Fractional index floors; negative index clamps to 0 (primary anchor).
    expect(routeColor("osrm", -5)).toBe(routeColor("osrm", 0));
    expect(routeColor("osrm", 1.9)).toBe(routeColor("osrm", 1));
  });
});

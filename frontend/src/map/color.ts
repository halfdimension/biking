/**
 * Per-route color family generator (Task 17.1, Req 4.1–4.4).
 *
 * Each routing engine owns an HSL hue *band*: OSRM gets a blue/cool band and
 * Valhalla gets a red/warm band (Req 4.1, 4.2). Within a band, {@link routeColor}
 * rotates the hue by index and modulates lightness so adjacent routes stay
 * distinguishable on both light AND dark basemaps (Req 4.3), and keeps producing
 * additional *distinct* colors as the index grows past the expected alternate
 * count (Req 4.4).
 *
 * Design intent (see design.md "Color assignment (Req 4)"):
 *   - OSRM band: anchor hue 210, span 50 (blues/cyans/violets ~185–260).
 *   - Valhalla band: anchor hue 15, span 45 (reds/oranges/yellows ~0–45).
 *   - hue = anchor + (index * STEP) % span   → rotate, wrapped within the band.
 *   - lightness cycles through several levels by index so two routes that land
 *     on the same (or near) hue still differ in lightness (Req 4.3, 4.4).
 *   - saturation is a constant, high value (88%) so every color is vivid and
 *     never pale against the light OSM raster basemap.
 *   - lightness levels stay in the mid-dark → mid range (42–56%) for the same
 *     reason: nothing washes out over light tiles, nothing vanishes on dark.
 *   - index 0 (primary) uses the band's anchor hue (Req 4.4 "primary anchor").
 *
 * The function is PURE: same (engine, index) always yields the same string, and
 * it has no side effects. That makes it directly unit-testable and safe to use
 * as the `colorFor` generator when building the combined route GeoJSON source.
 */
import type { Engine } from "../types";

/** An engine's HSL hue band. `anchor` is the primary (index 0) hue. */
export interface HueBand {
  /** Anchor hue used by the primary route (index 0). */
  anchor: number;
  /** Width of the hue band; rotation wraps within `[anchor, anchor+span)`. */
  span: number;
}

/**
 * Per-engine hue bands (exported for tests / callers that want to assert band
 * membership).
 *
 * OSRM is a cool blue band; Valhalla is a warm red/orange band. The bands do
 * not overlap, so an OSRM color is always visually separable from a Valhalla
 * color regardless of index (Req 4.1, 4.2).
 */
export const HUE_BANDS: Record<Engine, HueBand> = {
  // Blues → cyan/violet edges: 210 .. 260 (kept clear of the warm band).
  osrm: { anchor: 210, span: 50 },
  // Reds → orange/yellow: 15 .. 60 (kept clear of the cool band).
  valhalla: { anchor: 15, span: 45 },
};

/**
 * Hue rotation step per index. Coprime-ish with the band spans so successive
 * indices spread across the band rather than clustering, maximizing separation
 * before the rotation begins to wrap (Req 4.4).
 */
export const HUE_STEP = 23;

/**
 * Constant saturation (percent). Deliberately high so route lines read as
 * saturated, unambiguous color over the busy light OSM raster basemap rather
 * than as washed-out pastels.
 */
export const SATURATION = 88;

/**
 * Lightness levels (percent) cycled by index. Using more than two levels means
 * that even when the hue rotation lands two indices on the same hue, they still
 * differ in lightness — guaranteeing distinct colors across a bounded index
 * range (Req 4.3 distinguishable on light/dark; Req 4.4 dynamic distinct).
 *
 * The set spans mid-dark → mid (42–56%) so no color washes out on a light
 * basemap or disappears on a dark one. The previous pale 63% level was dropped
 * because at that lightness a thin line over light OSM tiles reads as gray.
 */
export const LIGHTNESS_LEVELS = [42, 52, 46, 56] as const;

/**
 * Generate the HSL color for a route.
 *
 * @param engine "osrm" (blue band) or "valhalla" (warm band).
 * @param index  Route index within the engine (0 = primary, uses anchor hue).
 * @returns An `hsl(h, s%, l%)` string.
 */
export function routeColor(engine: Engine, index: number): string {
  const band = HUE_BANDS[engine];
  // Normalize to a non-negative integer index; primary (0) → anchor hue.
  const i = Math.max(0, Math.floor(index));
  const hue = band.anchor + ((i * HUE_STEP) % band.span);
  const light = LIGHTNESS_LEVELS[i % LIGHTNESS_LEVELS.length];
  return `hsl(${hue}, ${SATURATION}%, ${light}%)`;
}

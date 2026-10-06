/**
 * MapLibre source + layer specs for the combined routes source (Task 16.1, 16.2).
 *
 * Design: Map Rendering & Layer / Hit-testing Strategy.
 *
 * One combined GeoJSON source (`routes`) with `promoteId: "routeId"` feeds THREE
 * line layers, none of which use a `filter`. Per-layer visibility and selection
 * emphasis are driven entirely by PAINT expressions reading `feature-state`:
 *
 *   - `visible`      → `["boolean", ["feature-state","visible"], true]`  (default true)
 *   - `selected`     → `["boolean", ["feature-state","selected"], false]` (default false)
 *
 * Sensible defaults mean that before any `setFeatureState` call, features still
 * render visible and unselected. Layer stacking (bottom → top):
 *   routes-hit → routes-base → routes-selected
 * so the selected route always draws above overlapping routes (Req 6.4).
 *
 * Kept as pure spec factories (no MapLibre instance needed) so they are easy to
 * reason about and reuse.
 */

export const ROUTES_SOURCE_ID = "routes";
export const HIT_LAYER_ID = "routes-hit";
export const BASE_LAYER_ID = "routes-base";
export const SELECTED_LAYER_ID = "routes-selected";

/** `feature-state.visible`, defaulting to true when unset. */
const VISIBLE_EXPR = ["boolean", ["feature-state", "visible"], true] as const;
/** `feature-state.selected`, defaulting to false when unset. */
const SELECTED_EXPR = ["boolean", ["feature-state", "selected"], false] as const;

/**
 * `routes-hit` — transparent wide line used only for click hit-testing (Task 20).
 * Width collapses to 0 when a feature is hidden so hidden routes are
 * non-hit-testable (design; Req 5.2).
 */
export function hitLayerSpec() {
  return {
    id: HIT_LAYER_ID,
    type: "line" as const,
    source: ROUTES_SOURCE_ID,
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
    paint: {
      "line-color": "#000000",
      "line-opacity": 0,
      // Wide clickable padding when visible, 0 (non-hittable) when hidden.
      "line-width": ["case", VISIBLE_EXPR, 16, 0],
    },
  };
}

/**
 * `routes-base` — the colored line for every route.
 *
 * Width is mildly zoom-interpolated and distinguishes primary from alternate:
 * primary ≈5px / alternate ≈4px at overview zoom (8), growing to 7px / 6px when
 * zoomed in (14) so lines stay readable without smothering the basemap.
 *
 * Opacity depends only on visibility: every visible route keeps its normal 0.85
 * base opacity before, during, and after selection. Selection emphasis is purely
 * additive and is supplied by `routes-selected`, which is stacked above this
 * layer. Hidden routes remain fully transparent.
 */
export function baseLayerSpec() {
  return {
    id: BASE_LAYER_ID,
    type: "line" as const,
    source: ROUTES_SOURCE_ID,
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
    paint: {
      "line-color": ["get", "color"],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        8,
        ["case", ["get", "isPrimary"], 5, 4],
        14,
        ["case", ["get", "isPrimary"], 7, 6],
      ],
      "line-opacity": [
        "case",
        VISIBLE_EXPR,
        0.85,
        0,
      ],
    },
  };
}

/**
 * `routes-selected` — same source, NO filter. Draws a feature only when it is
 * both `selected && visible` (thicker, fully opaque); otherwise opacity 0 so it
 * contributes nothing. Added LAST so the selected route is always on top
 * (Req 6.4). Width is also collapsed to 0 when not drawn.
 *
 * ~8px at overview zoom growing to 10px when zoomed in — comfortably heavier
 * than the base layer's 5/4px so the selection reads at a glance.
 *
 * IMPORTANT (MapLibre spec rule): a `["zoom"]`-driven `interpolate`/`step` must be
 * the TOP-LEVEL expression of a paint property. Nesting the zoom `interpolate`
 * inside a `["case", drawn, …, 0]` makes MapLibre reject `addLayer` outright
 * ("zoom" expression may only be used as input to a top-level "step" or
 * "interpolate" expression), which silently drops this whole layer and the
 * selected route never draws on top. So `interpolate` stays top-level and the
 * `drawn` case lives in each stop OUTPUT — same shape as `routes-base`.
 */
export function selectedLayerSpec() {
  const drawn = ["all", VISIBLE_EXPR, SELECTED_EXPR] as const;
  return {
    id: SELECTED_LAYER_ID,
    type: "line" as const,
    source: ROUTES_SOURCE_ID,
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
    paint: {
      "line-color": ["get", "color"],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        8,
        ["case", drawn, 8, 0],
        14,
        ["case", drawn, 10, 0],
      ],
      "line-opacity": ["case", drawn, 1, 0],
    },
  };
}

export const DEBUG_HIGHLIGHT_LAYER_ID = "route-debug-highlight";
export const DEBUG_HIT_LAYER_ID = "route-debug-hit";

/**
 * A subtle overlay for the exact hovered/pinned segments. It never changes the
 * normal route source or its colors and is driven only by debug feature-state.
 */
export function debugHighlightLayerSpec(sourceId: string) {
  const hovered = ["boolean", ["feature-state", "hovered"], false] as const;
  const pinned = ["boolean", ["feature-state", "pinned"], false] as const;
  const visible = ["any", hovered, pinned] as const;
  return {
    id: DEBUG_HIGHLIGHT_LAYER_ID,
    type: "line" as const,
    source: sourceId,
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
    paint: {
      "line-color": ["case", pinned, "#f59e0b", "#ffffff"],
      "line-width": ["case", pinned, 9, hovered, 8, 0],
      "line-opacity": ["case", pinned, 0.72, hovered, 0.52, 0],
      "line-blur": ["case", visible, 0.4, 0],
    },
  };
}

/** Transparent debug-only line used for the 6px-box mouse hit test. */
export function debugHitLayerSpec(sourceId: string) {
  return {
    id: DEBUG_HIT_LAYER_ID,
    type: "line" as const,
    source: sourceId,
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
    paint: {
      "line-color": "#000000",
      "line-opacity": 0,
      "line-width": 8,
    },
  };
}

export const ANALYSIS_MATCH_GLOW_LAYER_ID = "route-analysis-matches-glow";
export const ANALYSIS_MATCH_LAYER_ID = "route-analysis-matches-line";
export const ANALYSIS_FOCUS_GLOW_LAYER_ID = "route-analysis-focus-glow";
export const ANALYSIS_FOCUS_LAYER_ID = "route-analysis-focus-line";

/**
 * Additive Route Analysis overlay. The dark outline separates the cyan match
 * line from both route color families; debug hover/pin layers are added above.
 */
export function analysisMatchGlowLayerSpec(
  sourceId: string,
  layerId = ANALYSIS_MATCH_GLOW_LAYER_ID,
) {
  return {
    id: layerId,
    type: "line" as const,
    source: sourceId,
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
    paint: {
      "line-color": "#0f172a",
      "line-width": 11,
      "line-opacity": 0.68,
      "line-blur": 0.8,
    },
  };
}

export function analysisMatchLayerSpec(
  sourceId: string,
  layerId = ANALYSIS_MATCH_LAYER_ID,
) {
  return {
    id: layerId,
    type: "line" as const,
    source: sourceId,
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
    paint: {
      "line-color": "#22d3ee",
      "line-width": 6,
      "line-opacity": 0.96,
    },
  };
}

/** One-edge chart focus, deliberately stronger and distinct from cyan search. */
export function analysisFocusGlowLayerSpec(
  sourceId: string,
  layerId = ANALYSIS_FOCUS_GLOW_LAYER_ID,
) {
  return {
    id: layerId,
    type: "line" as const,
    source: sourceId,
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
    paint: {
      "line-color": "#111827",
      "line-width": 13,
      "line-opacity": 0.82,
      "line-blur": 0.7,
    },
  };
}

export function analysisFocusLayerSpec(
  sourceId: string,
  layerId = ANALYSIS_FOCUS_LAYER_ID,
) {
  return {
    id: layerId,
    type: "line" as const,
    source: sourceId,
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
    paint: {
      "line-color": "#d9f99d",
      "line-width": 7,
      "line-opacity": 1,
    },
  };
}

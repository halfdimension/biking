/**
 * Unit tests for the routes source/layer paint specs (Task 19 visual refinement).
 *
 * These are pure spec objects — no MapLibre or jsdom needed — so the visual
 * contract (widths, additive selection, layer order, and the design-critical
 * "no filter" rule) is regression-covered structurally.
 */
import { describe, it, expect } from "vitest";
import {
  ROUTES_SOURCE_ID,
  HIT_LAYER_ID,
  BASE_LAYER_ID,
  SELECTED_LAYER_ID,
  hitLayerSpec,
  baseLayerSpec,
  selectedLayerSpec,
} from "./layers";

const VISIBLE_EXPR = ["boolean", ["feature-state", "visible"], true];
const SELECTED_EXPR = ["boolean", ["feature-state", "selected"], false];

describe("routes layer specs", () => {
  it("all three layers read the single combined source and use NO filter", () => {
    for (const spec of [hitLayerSpec(), baseLayerSpec(), selectedLayerSpec()]) {
      expect(spec.source).toBe(ROUTES_SOURCE_ID);
      expect(spec.type).toBe("line");
      // Design-critical: visibility/selection is feature-state driven, never a filter.
      expect("filter" in spec).toBe(false);
    }
  });

  it("stacks bottom → top as hit, base, selected", () => {
    expect([hitLayerSpec().id, baseLayerSpec().id, selectedLayerSpec().id]).toEqual([
      HIT_LAYER_ID,
      BASE_LAYER_ID,
      SELECTED_LAYER_ID,
    ]);
    expect([HIT_LAYER_ID, BASE_LAYER_ID, SELECTED_LAYER_ID]).toEqual([
      "routes-hit",
      "routes-base",
      "routes-selected",
    ]);
  });

  it("keeps any zoom-driven width expression top-level (MapLibre spec rule)", () => {
    // MapLibre rejects addLayer when a ["zoom"] expression is nested inside another
    // expression, which silently drops the layer. Guard all three specs.
    for (const spec of [hitLayerSpec(), baseLayerSpec(), selectedLayerSpec()]) {
      const w = spec.paint["line-width"];
      if (Array.isArray(w) && JSON.stringify(w).includes('"zoom"')) {
        expect(["interpolate", "step"]).toContain(w[0]);
      }
    }
  });
});

describe("hitLayerSpec paint", () => {
  const paint = hitLayerSpec().paint;

  it("is fully transparent", () => {
    expect(paint["line-opacity"]).toBe(0);
    expect(paint["line-color"]).toBe("#000000");
  });

  it("gives a 16px hit width when visible and 0 when hidden", () => {
    expect(paint["line-width"]).toEqual(["case", VISIBLE_EXPR, 16, 0]);
  });
});

describe("baseLayerSpec paint", () => {
  const paint = baseLayerSpec().paint;

  it("colors from the feature's color property", () => {
    expect(paint["line-color"]).toEqual(["get", "color"]);
  });

  it("interpolates width by zoom, distinguishing primary from alternate", () => {
    const width = paint["line-width"] as unknown[];
    expect(width.slice(0, 4)).toEqual(["interpolate", ["linear"], ["zoom"], 8]);
    // zoom-8 stop: primary 5px, alternate 4px.
    expect(width[4]).toEqual(["case", ["get", "isPrimary"], 5, 4]);
    // zoom-14 stop grows slightly.
    expect(width[5]).toBe(14);
    expect(width[6]).toEqual(["case", ["get", "isPrimary"], 7, 6]);
  });

  it("keeps normal opacity for every visible route regardless of selection", () => {
    expect(paint["line-opacity"]).toEqual([
      "case",
      VISIBLE_EXPR,
      0.85,
      0,
    ]);

    // Neither this route's selected state nor another route's hasSelection
    // state may alter the base paint. The selected layer supplies emphasis.
    const opacityJson = JSON.stringify(paint["line-opacity"]);
    expect(opacityJson).not.toContain('"selected"');
    expect(opacityJson).not.toContain('"hasSelection"');
  });

  it("keeps explicitly hidden routes transparent", () => {
    const opacity = paint["line-opacity"] as unknown[];
    expect(opacity[opacity.length - 1]).toBe(0);
  });
});

describe("selectedLayerSpec paint", () => {
  const paint = selectedLayerSpec().paint;
  const drawn = ["all", VISIBLE_EXPR, SELECTED_EXPR];

  it("is fully opaque when drawn and invisible otherwise", () => {
    expect(paint["line-opacity"]).toEqual(["case", drawn, 1, 0]);
  });

  it("draws a heavy zoom-interpolated line starting at 8px, collapsing to 0", () => {
    // The zoom interpolate MUST stay top-level (MapLibre spec rule); the drawn
    // case sits in the stop outputs so width still collapses to 0 when not drawn.
    expect(paint["line-width"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      8,
      ["case", drawn, 8, 0],
      14,
      ["case", drawn, 10, 0],
    ]);
  });

  it("colors from the feature's color property", () => {
    expect(paint["line-color"]).toEqual(["get", "color"]);
  });
});

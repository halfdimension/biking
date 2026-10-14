import { describe, expect, it } from "vitest";
import {
  ALTERNATES_LAYER_ID,
  HIT_LAYER_ID,
  PRIMARY_LAYER_ID,
  ROUTES_SOURCE_ID,
  ROUTE_LINE_OFFSET_EXPRESSION,
  SELECTED_ALTERNATE_LAYER_ID,
  SELECTED_HALO_LAYER_ID,
  SELECTED_PRIMARY_LAYER_ID,
  alternatesLayerSpec,
  hitLayerSpec,
  primaryLayerSpec,
  selectedAlternateLayerSpec,
  selectedHaloLayerSpec,
  selectedPrimaryLayerSpec,
} from "./layers";

const VISIBLE_EXPR = ["boolean", ["feature-state", "visible"], true];
const SELECTED_EXPR = ["boolean", ["feature-state", "selected"], false];
const DRAWN_EXPR = ["all", VISIBLE_EXPR, SELECTED_EXPR];

const routeSpecs = () => [
  hitLayerSpec(),
  alternatesLayerSpec(),
  primaryLayerSpec(),
  selectedHaloLayerSpec(),
  selectedAlternateLayerSpec(),
  selectedPrimaryLayerSpec(),
];

describe("routes layer specs", () => {
  it("uses the single combined source in the required bottom-to-top order", () => {
    expect(routeSpecs().map((spec) => spec.id)).toEqual([
      HIT_LAYER_ID,
      ALTERNATES_LAYER_ID,
      PRIMARY_LAYER_ID,
      SELECTED_HALO_LAYER_ID,
      SELECTED_ALTERNATE_LAYER_ID,
      SELECTED_PRIMARY_LAYER_ID,
    ]);
    expect(routeSpecs().map((spec) => spec.id)).toEqual([
      "routes-hit",
      "routes-alternates",
      "routes-primary",
      "routes-selected-halo",
      "routes-selected-alternate",
      "routes-selected-primary",
    ]);
    for (const spec of routeSpecs()) {
      expect(spec.source).toBe(ROUTES_SOURCE_ID);
      expect(spec.type).toBe("line");
    }
  });

  it("applies the exact same feature-state offset expression everywhere", () => {
    for (const spec of routeSpecs()) {
      expect(spec.paint["line-offset"]).toEqual(
        ROUTE_LINE_OFFSET_EXPRESSION,
      );
    }
    expect(ROUTE_LINE_OFFSET_EXPRESSION).toEqual([
      "case",
      ["boolean", ["feature-state", "separated"], true],
      ["get", "displayOffsetPx"],
      0,
    ]);
  });

  it("renders primary solid and alternatives dashed", () => {
    expect(primaryLayerSpec().filter).toEqual([
      "==",
      ["get", "isPrimary"],
      true,
    ]);
    expect(primaryLayerSpec().paint).not.toHaveProperty("line-dasharray");
    expect(alternatesLayerSpec().filter).toEqual([
      "==",
      ["get", "isPrimary"],
      false,
    ]);
    expect(alternatesLayerSpec().paint["line-dasharray"]).toEqual([2, 1.5]);

    expect(selectedPrimaryLayerSpec().paint).not.toHaveProperty(
      "line-dasharray",
    );
    expect(
      selectedAlternateLayerSpec().paint["line-dasharray"],
    ).toEqual([2, 1.5]);
  });

  it("keeps primary slightly thicker than alternatives", () => {
    expect(primaryLayerSpec().paint["line-width"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      8,
      5,
      14,
      7,
    ]);
    expect(alternatesLayerSpec().paint["line-width"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      8,
      4,
      14,
      6,
    ]);
  });

  it("keeps hidden routes invisible and non-hittable", () => {
    expect(hitLayerSpec().paint["line-width"]).toEqual([
      "case",
      VISIBLE_EXPR,
      16,
      0,
    ]);
    for (const spec of [alternatesLayerSpec(), primaryLayerSpec()]) {
      expect(spec.paint["line-opacity"]).toEqual([
        "case",
        VISIBLE_EXPR,
        0.85,
        0,
      ]);
    }
  });

  it("draws a high-contrast selected halo without fading normal routes", () => {
    const halo = selectedHaloLayerSpec();
    expect(halo.paint["line-color"]).toBe("#ffffff");
    expect(halo.paint["line-opacity"]).toEqual([
      "case",
      DRAWN_EXPR,
      0.95,
      0,
    ]);
    expect(halo.paint["line-width"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      8,
      ["case", DRAWN_EXPR, 10, 0],
      14,
      ["case", DRAWN_EXPR, 12, 0],
    ]);

    for (const spec of [alternatesLayerSpec(), primaryLayerSpec()]) {
      expect(JSON.stringify(spec.paint["line-opacity"])).not.toContain(
        "selected",
      );
      expect(JSON.stringify(spec.paint["line-opacity"])).not.toContain(
        "hasSelection",
      );
    }
  });

  it("keeps zoom expressions at the top level for MapLibre compatibility", () => {
    for (const spec of routeSpecs()) {
      const width = spec.paint["line-width"];
      if (Array.isArray(width) && JSON.stringify(width).includes('"zoom"')) {
        expect(["interpolate", "step"]).toContain(width[0]);
      }
    }
  });
});

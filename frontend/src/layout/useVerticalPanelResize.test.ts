import { describe, expect, it } from "vitest";
import {
  STRUCTURAL_MAP_MIN_HEIGHT,
  renderableVerticalPanelHeight,
  verticalPanelBounds,
} from "./useVerticalPanelResize";

describe("vertical panel resize geometry", () => {
  it("keeps a preferred height that is within the live range", () => {
    expect(renderableVerticalPanelHeight(400, 800, 180)).toBe(400);
  });

  it("renders a preferred height above the dynamic maximum at that maximum", () => {
    expect(renderableVerticalPanelHeight(900, 800, 180)).toBe(752);
  });

  it("renders a preferred height below the panel minimum at the minimum", () => {
    expect(renderableVerticalPanelHeight(40, 800, 180)).toBe(180);
  });

  it("has neither the old 520px cap nor a viewport percentage cap", () => {
    expect(renderableVerticalPanelHeight(700, 800, 180)).toBe(700);
    expect(700).toBeGreaterThan(520);
    expect(700).toBeGreaterThan(800 * 0.65);
  });

  it("permits a 1000px panel when workspace geometry permits it", () => {
    expect(renderableVerticalPanelHeight(1000, 1200, 180)).toBe(1000);
  });

  it("sets maximum to workspace minus the structural map minimum", () => {
    expect(verticalPanelBounds(1200, 180).maximum).toBe(
      1200 - STRUCTURAL_MAP_MIN_HEIGHT,
    );
  });

  it("never returns negative geometry for a tiny workspace", () => {
    expect(verticalPanelBounds(30, 180)).toEqual({ minimum: 0, maximum: 0 });
    expect(renderableVerticalPanelHeight(280, 30, 180)).toBe(0);
  });

  it("never lets the effective minimum exceed the effective maximum", () => {
    const bounds = verticalPanelBounds(100, 180);
    expect(bounds).toEqual({ minimum: 52, maximum: 52 });
    expect(bounds.minimum).toBeLessThanOrEqual(bounds.maximum);
  });

  it("allows passive shrink and regrow without changing the preference", () => {
    const preferredHeight = 700;
    expect(renderableVerticalPanelHeight(preferredHeight, 500, 180)).toBe(452);
    expect(preferredHeight).toBe(700);
    expect(renderableVerticalPanelHeight(preferredHeight, 900, 180)).toBe(700);
  });
});

/**
 * Unit tests for the pure formatting helpers (Task 22, Req 7 + Req 8.2).
 */
import { describe, it, expect } from "vitest";
import {
  formatDistanceKm,
  formatDuration,
  formatDurationMs,
  formatCost,
  formatPercentDiff,
  DASH,
} from "./format";

describe("formatDistanceKm", () => {
  it("formats meters as km with 2 decimals", () => {
    expect(formatDistanceKm(132224.8)).toBe("132.22 km");
    expect(formatDistanceKm(0)).toBe("0.00 km");
    expect(formatDistanceKm(1500)).toBe("1.50 km");
  });

  it("renders a dash for null / non-finite", () => {
    expect(formatDistanceKm(null)).toBe(DASH);
    expect(formatDistanceKm(NaN)).toBe(DASH);
    expect(formatDistanceKm(Infinity)).toBe(DASH);
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatDuration(8572.8)).toBe("2 h 23 min");
    expect(formatDuration(3600)).toBe("1 h 0 min");
  });

  it("formats minutes-only under an hour", () => {
    expect(formatDuration(300)).toBe("5 min");
    expect(formatDuration(59 * 60)).toBe("59 min");
  });

  it("rounds sub-minute positive durations up to 1 min", () => {
    expect(formatDuration(45)).toBe("1 min");
    expect(formatDuration(1)).toBe("1 min");
  });

  it("renders 0 min for zero and a dash for null / non-finite", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(null)).toBe(DASH);
    expect(formatDuration(NaN)).toBe(DASH);
  });
});

describe("formatDurationMs", () => {
  it("keeps ms below a second and switches to s above", () => {
    expect(formatDurationMs(842.4)).toBe("842 ms");
    expect(formatDurationMs(1500)).toBe("1.50 s");
  });

  it("renders a dash for null", () => {
    expect(formatDurationMs(null)).toBe(DASH);
  });
});

describe("formatCost", () => {
  it("formats whole numbers without a decimal", () => {
    expect(formatCost(50)).toBe("50");
  });

  it("formats fractional cost to 1 decimal", () => {
    expect(formatCost(8573.7)).toBe("8573.7");
    expect(formatCost(8573.74)).toBe("8573.7");
  });

  it("renders a dash for null / non-finite", () => {
    expect(formatCost(null)).toBe(DASH);
    expect(formatCost(NaN)).toBe(DASH);
  });
});

describe("formatPercentDiff", () => {
  it("formats a positive diff with a leading +", () => {
    // (104.2 - 100) / 100 * 100 = +4.2%
    expect(formatPercentDiff(104.2, 100)).toBe("+4.2%");
  });

  it("formats a negative diff with the minus sign", () => {
    // (99 - 100) / 100 * 100 = -1.0%
    expect(formatPercentDiff(99, 100)).toBe("-1.0%");
  });

  it("formats the primary's own diff as 0.0%", () => {
    expect(formatPercentDiff(100, 100)).toBe("0.0%");
  });

  it("rounds to 1 decimal", () => {
    // (100.06 - 100) / 100 * 100 = 0.06 → rounds to 0.1
    expect(formatPercentDiff(100.06, 100)).toBe("+0.1%");
  });

  it("returns a dash when value or primary is null", () => {
    expect(formatPercentDiff(null, 100)).toBe(DASH);
    expect(formatPercentDiff(100, null)).toBe(DASH);
    expect(formatPercentDiff(null, null)).toBe(DASH);
  });

  it("returns a dash when the primary is zero (no divide-by-zero)", () => {
    expect(formatPercentDiff(50, 0)).toBe(DASH);
    expect(formatPercentDiff(0, 0)).toBe(DASH);
  });
});

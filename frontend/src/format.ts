/**
 * Pure formatting helpers for route summary values and the comparison table
 * (Task 22, Req 7 + Req 8).
 *
 * Every helper is PURE (no store, no DOM) and total: a `null` (missing) value
 * always renders as an em dash `"—"` rather than throwing (Req 7.4, 8.2). This
 * keeps the summary panel and comparison table free of engine-specific parsing
 * and safe against missing / degenerate inputs.
 *
 * Units in the normalized model are fixed: `distanceMeters` is meters,
 * `durationSeconds` is seconds, and `cost` is a unitless engine weight (OSRM
 * weight / Valhalla `summary.cost`). Formatting only presents those values in a
 * human-friendly way; it never re-derives them.
 */

/** The placeholder shown for any missing / non-computable value (Req 7.4). */
export const DASH = "—";

/**
 * Format a distance given in meters as kilometers with 2 decimals.
 *
 * e.g. `132224.8 → "132.22 km"`, `0 → "0.00 km"`. `null → "—"`.
 */
export function formatDistanceKm(meters: number | null): string {
  if (meters == null || !Number.isFinite(meters)) return DASH;
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Format a duration given in seconds as a human `h/min` string.
 *
 * Rules:
 *   - `>= 3600s` → `"{h} h {min} min"` (minutes rounded, e.g. `8572.8 → "2 h 23 min"`).
 *   - `>= 60s` and `< 3600s` → `"{min} min"` (e.g. `300 → "5 min"`).
 *   - `> 0` and `< 60s` → `"1 min"` (rounded up so a real route never reads as 0).
 *   - `0` → `"0 min"`.
 *   - `null` → `"—"`.
 */
export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return DASH;
  if (seconds <= 0) return "0 min";

  const totalMinutes = seconds < 60 ? 1 : Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} h ${minutes} min`;
}

/**
 * Format a request execution time given in milliseconds (Req 7.1 "request
 * execution time"). `null → "—"`. Sub-second values keep the ms unit.
 */
export function formatDurationMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Format a unitless cost / weight value. Whole numbers render without a decimal
 * point; otherwise 1 decimal is kept (e.g. `8573.7 → "8573.7"`, `50 → "50"`).
 * `null → "—"`.
 */
export function formatCost(cost: number | null): string {
  if (cost == null || !Number.isFinite(cost)) return DASH;
  if (Number.isInteger(cost)) return String(cost);
  return cost.toFixed(1);
}

/**
 * Format a signed percent difference of `value` vs `primary`, computed as
 * `((value - primary) / primary) * 100`, rounded to 1 decimal with an explicit
 * sign (e.g. `+4.2%`, `-1.0%`, `0.0%`).
 *
 * Safe handling (Req 8.2 / Property 14):
 *   - `value` or `primary` is `null` → `"—"`.
 *   - `primary === 0` → `"—"` (avoids divide-by-zero / Infinity / NaN).
 *   - a non-finite result → `"—"`.
 */
export function formatPercentDiff(
  value: number | null,
  primary: number | null,
): string {
  if (value == null || primary == null) return DASH;
  if (!Number.isFinite(value) || !Number.isFinite(primary)) return DASH;
  if (primary === 0) return DASH;

  const pct = ((value - primary) / primary) * 100;
  if (!Number.isFinite(pct)) return DASH;

  const rounded = Math.round(pct * 10) / 10;
  // Normalize -0 to 0 so a zero diff reads "0.0%" rather than "-0.0%".
  const safe = rounded === 0 ? 0 : rounded;
  // Positive gets an explicit "+"; negative already carries "-" from toFixed;
  // exactly zero (the primary's own diff) reads as a plain "0.0%".
  const sign = safe > 0 ? "+" : "";
  return `${sign}${safe.toFixed(1)}%`;
}

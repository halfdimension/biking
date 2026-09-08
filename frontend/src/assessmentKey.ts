/**
 * Deterministic, geometry-based persistence identity for route-quality
 * assessments (Req 14).
 *
 * WHY THIS EXISTS
 * ---------------
 * A `NormalizedRoute.id` is index-based (`${engine}:${index}`, e.g. "osrm:0").
 * The index reflects the route's position within an engine's alternate list for
 * the CURRENT run. That position can change between reruns (an engine may
 * reorder alternates), so persisting an assessment under `route.id` risks
 * re-attaching a saved rating to the WRONG geometry on a later Compare.
 *
 * This module derives a SEPARATE, deterministic persistence key from the
 * route's own geometry so a rating follows the geometry, not the index:
 *   - Same geometry across reruns  → SAME key (rating restored, any index).
 *   - Materially different geometry → DIFFERENT key (reads as Unrated).
 *   - OSRM vs Valhalla are always distinct (engine prefix), even if two
 *     engines happen to produce identical geometry.
 *
 * The route's index-based `id` is intentionally left untouched and continues to
 * drive ALL current-run UI state (map selection, visibility, table rows,
 * feature-state, labels). Only PERSISTENCE uses this geometry key.
 *
 * The fingerprint is a stable, non-cryptographic FNV-1a 32-bit hash over the
 * decoded `[lon, lat]` coordinate sequence, with each coordinate rounded to 6
 * decimal places (matching polyline6 precision) before hashing. Rounding makes
 * the key robust to sub-metre floating noise while still changing when the
 * geometry changes materially. The full coordinate array is NEVER stored — only
 * the compact `${engine}:${fingerprint}` string is persisted.
 *
 * The hash is ORDER-SENSITIVE on purpose: a route and its reverse are different
 * routes, so coordinates are hashed in sequence and never sorted.
 *
 * Reads never throw: empty coordinates produce a deterministic key.
 */

import type { NormalizedRoute } from "./types";

/** Fixed coordinate precision for fingerprinting (polyline6 = 6 decimals). */
const COORD_PRECISION = 6;
const COORD_SCALE = 10 ** COORD_PRECISION;

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;

/**
 * Round a coordinate value to the fixed precision and return it as an integer,
 * so hashing operates on stable integers rather than float bit patterns. Guards
 * non-finite values (NaN/Infinity) to 0 so a malformed coordinate never throws
 * and stays deterministic.
 */
function quantize(v: number): number {
  if (!Number.isFinite(v)) return 0;
  // Math.round is deterministic; the +0 normalizes -0 to 0.
  return Math.round(v * COORD_SCALE) + 0;
}

/**
 * Fold a 32-bit unsigned integer into the running FNV-1a hash, one byte at a
 * time (4 bytes), keeping the running value within 32 bits via `Math.imul`.
 */
function fnv1aMixUint32(hash: number, value: number): number {
  // Treat `value` as a 32-bit two's-complement integer and mix its 4 bytes.
  let h = hash;
  let v = value | 0;
  for (let i = 0; i < 4; i++) {
    const byte = v & 0xff;
    h ^= byte;
    h = Math.imul(h, FNV_PRIME);
    v >>>= 8;
  }
  return h >>> 0;
}

/**
 * Compute a stable, deterministic geometry fingerprint (8 lowercase hex chars)
 * for a decoded `[lon, lat]` coordinate sequence.
 *
 * The sequence is hashed IN ORDER (never sorted) so a reversed route yields a
 * different fingerprint. Each `[lon, lat]` pair is quantized to 6 decimals
 * before mixing. An empty sequence yields a deterministic fingerprint derived
 * from the bare offset basis, so the function never throws.
 */
export function geometryFingerprint(
  coordinates: readonly [number, number][] | undefined | null,
): string {
  let hash = FNV_OFFSET_BASIS >>> 0;
  const coords = coordinates ?? [];
  // Mix the length first so [] and [[0,0]] (which quantize identically at the
  // start) can never collide purely on prefix.
  hash = fnv1aMixUint32(hash, coords.length | 0);
  for (const pair of coords) {
    // Defensive: tolerate a malformed pair without throwing.
    const lon = Array.isArray(pair) ? pair[0] : NaN;
    const lat = Array.isArray(pair) ? pair[1] : NaN;
    hash = fnv1aMixUint32(hash, quantize(lon));
    hash = fnv1aMixUint32(hash, quantize(lat));
  }
  // 8-char zero-padded hex.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Return the deterministic PERSISTENCE key for a route's assessment:
 * `${engine}:${geometryFingerprint}` (e.g. "valhalla:1a2b3c4d").
 *
 * Distinct from `route.id` (which is index-based and drives current-run UI).
 * Two routes with the same geometry from the same engine share a key across
 * reruns regardless of their alternate index; different engines never share a
 * key because the engine name prefixes the fingerprint. Never throws.
 */
export function routeAssessmentKey(route: NormalizedRoute): string {
  return `${route.engine}:${geometryFingerprint(route.coordinates)}`;
}

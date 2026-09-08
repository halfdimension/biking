/**
 * Unit + property tests for deterministic hit-test resolution (Task 21.1,
 * Req 6.1). `resolveSelectedRouteId` is pure (no MapLibre), so it is exercised
 * directly here without any map mock.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { resolveSelectedRouteId, type RouteCandidate } from "./hitTest";

function cand(engine: string, index: number): RouteCandidate {
  return { routeId: `${engine}:${index}`, engine, index };
}

describe("resolveSelectedRouteId", () => {
  it("returns null when there are no candidates", () => {
    expect(resolveSelectedRouteId([], null)).toBeNull();
    expect(resolveSelectedRouteId([], "osrm:0")).toBeNull();
  });

  it("returns the only candidate's id for a single candidate", () => {
    expect(resolveSelectedRouteId([cand("osrm", 1)], null)).toBe("osrm:1");
    // ...even if a (different) route is currently selected.
    expect(resolveSelectedRouteId([cand("osrm", 1)], "valhalla:0")).toBe(
      "osrm:1",
    );
  });

  it("keeps the current selection when it is among the candidates", () => {
    const candidates = [cand("osrm", 0), cand("valhalla", 2), cand("osrm", 3)];
    expect(resolveSelectedRouteId(candidates, "valhalla:2")).toBe("valhalla:2");
  });

  it("picks the topmost/stable candidate when the selection is not present", () => {
    // Query order (topmost first) has valhalla:2 first, but the stable
    // engine-then-index order resolves to osrm:0 for reproducibility.
    const candidates = [cand("valhalla", 2), cand("osrm", 0), cand("osrm", 3)];
    expect(resolveSelectedRouteId(candidates, null)).toBe("osrm:0");
    // A stale selection not present in the set is ignored.
    expect(resolveSelectedRouteId(candidates, "valhalla:9")).toBe("osrm:0");
  });

  it("is order-independent for the same candidate set (determinism)", () => {
    const a = [cand("valhalla", 2), cand("osrm", 1), cand("osrm", 0)];
    const b = [cand("osrm", 0), cand("valhalla", 2), cand("osrm", 1)];
    const c = [cand("osrm", 1), cand("osrm", 0), cand("valhalla", 2)];
    const r = resolveSelectedRouteId(a, null);
    expect(resolveSelectedRouteId(b, null)).toBe(r);
    expect(resolveSelectedRouteId(c, null)).toBe(r);
    expect(r).toBe("osrm:0");
  });

  /**
   * Property: Hit-test determinism (design determinism, Req 6.1). For any
   * candidate set, the resolution does not depend on input order, and repeated
   * evaluation yields the same id (prefer selected, else stable topmost).
   *
   * **Validates: Requirements 6.1**
   */
  it("Property: resolution is order-independent and repeatable", () => {
    const candidateArb = fc
      .array(
        fc.record({
          engine: fc.constantFrom("osrm", "valhalla"),
          index: fc.integer({ min: 0, max: 20 }),
        }),
        { minLength: 1, maxLength: 8 },
      )
      // Dedup by routeId so a set has no duplicate ids.
      .map((raw) => {
        const seen = new Set<string>();
        const out: RouteCandidate[] = [];
        for (const { engine, index } of raw) {
          const routeId = `${engine}:${index}`;
          if (seen.has(routeId)) continue;
          seen.add(routeId);
          out.push({ routeId, engine, index });
        }
        return out;
      });

    fc.assert(
      fc.property(
        candidateArb,
        fc.option(fc.string(), { nil: null }),
        (candidates, selected) => {
          const first = resolveSelectedRouteId(candidates, selected);
          // Repeatable.
          expect(resolveSelectedRouteId(candidates, selected)).toBe(first);
          // Order-independent: a reversed copy resolves identically.
          const reversed = [...candidates].reverse();
          expect(resolveSelectedRouteId(reversed, selected)).toBe(first);
          // When the selection is present, it must be kept.
          if (
            selected !== null &&
            candidates.some((c) => c.routeId === selected)
          ) {
            expect(first).toBe(selected);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

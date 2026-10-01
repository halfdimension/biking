/**
 * Pure resolution for MapLibre debug-hit query results.
 *
 * Tile/render duplicates are removed by debug segment id while genuinely
 * distinct overlaps (including same-engine alternate routes) are retained.
 */
export interface RenderedDebugFeature {
  id?: string | number;
  properties?: {
    debugSegmentId?: unknown;
    routeId?: unknown;
  } | null;
}

export function resolveDebugSegmentIds(
  features: RenderedDebugFeature[],
  visibility: Record<string, boolean>,
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const feature of features) {
    const props = feature.properties ?? {};
    const id =
      feature.id != null
        ? String(feature.id)
        : typeof props.debugSegmentId === "string"
          ? props.debugSegmentId
          : "";
    const routeId =
      typeof props.routeId === "string" ? props.routeId : "";

    if (!id || !routeId || visibility[routeId] === false || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

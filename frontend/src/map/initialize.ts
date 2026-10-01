import type maplibregl from "maplibre-gl";
import { resolveMapStyle } from "./style";

export const DASHBOARD_MAP_CENTER: [number, number] = [77.209, 28.6139];
export const DASHBOARD_MAP_ZOOM = 10;

/** Constructor options shared by every dashboard MapLibre instance. */
export function dashboardMapOptions(
  container: HTMLElement,
): maplibregl.MapOptions {
  return {
    container,
    style: resolveMapStyle(),
    center: DASHBOARD_MAP_CENTER,
    zoom: DASHBOARD_MAP_ZOOM,
  };
}

/**
 * Install the proven map diagnostics and container-sizing lifecycle.
 *
 * The immediate animation-frame resize handles initial flex/grid layout, the
 * delayed resize handles CSS settling, ResizeObserver handles later panel
 * changes, and load/style.load cover map/style activation and remounts.
 */
export function attachDashboardMapLifecycle(
  map: maplibregl.Map,
  container: HTMLElement,
  label: string,
): () => void {
  const resize = () => {
    if (!map.getContainer || map.getContainer() === container) {
      map.resize();
    }
  };
  const handleError = (event: unknown) => {
    const error = (event && (event as { error?: unknown }).error) || event;
    console.error(`[${label}] MapLibre error:`, error);
  };
  const handleLoad = () => {
    const canvas = map.getCanvas();
    console.info(
      `[${label}] map load; canvas:`,
      canvas.width,
      "x",
      canvas.height,
    );
    resize();
  };

  map.on("error", handleError);
  map.on("load", handleLoad);
  map.on("style.load", resize);

  const animationFrame = requestAnimationFrame(resize);
  const settledResize = setTimeout(resize, 200);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  return () => {
    cancelAnimationFrame(animationFrame);
    clearTimeout(settledResize);
    resizeObserver.disconnect();
    map.off("error", handleError);
    map.off("load", handleLoad);
    map.off("style.load", resize);
  };
}

import type maplibregl from "maplibre-gl";

/** The complete MapLibre camera needed to reproduce a viewport exactly. */
export interface MapCameraState {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

/** Read a valid, settled camera snapshot from a live MapLibre map. */
export function readMapCamera(
  map: Pick<
    maplibregl.Map,
    "getCenter" | "getZoom" | "getBearing" | "getPitch"
  >,
): MapCameraState | null {
  if (
    typeof map.getCenter !== "function" ||
    typeof map.getZoom !== "function" ||
    typeof map.getBearing !== "function" ||
    typeof map.getPitch !== "function"
  ) {
    return null;
  }

  const center = map.getCenter();
  const camera: MapCameraState = {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
  return [...camera.center, camera.zoom, camera.bearing, camera.pitch].every(
    Number.isFinite,
  )
    ? camera
    : null;
}

/** Restore without animation so a remount cannot briefly drift or refit. */
export function restoreMapCamera(
  map: Pick<maplibregl.Map, "jumpTo">,
  camera: MapCameraState,
): void {
  map.jumpTo({
    center: camera.center,
    zoom: camera.zoom,
    bearing: camera.bearing,
    pitch: camera.pitch,
  });
}

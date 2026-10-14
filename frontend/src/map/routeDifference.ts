import type { RouteDifferenceResult } from "../analysis/routeDifference";

export const ROUTE_DIFFERENCE_SOURCE_ID = "route-difference";
export const ROUTE_DIFFERENCE_SHARED_LAYER_ID = "route-difference-shared";
export const ROUTE_DIFFERENCE_UNDERLAY_LAYER_ID = "route-difference-underlay";
export const ROUTE_DIFFERENCE_OSRM_LAYER_ID = "route-difference-osrm";
export const ROUTE_DIFFERENCE_VALHALLA_LAYER_ID = "route-difference-valhalla";
export const ROUTE_DIFFERENCE_ENDPOINT_RING_LAYER_ID =
  "route-difference-endpoint-rings";
export const ROUTE_DIFFERENCE_SPLIT_LAYER_ID = "route-difference-splits";
export const ROUTE_DIFFERENCE_REJOIN_LAYER_ID = "route-difference-rejoins";

export type RouteDifferenceFeatureKind =
  | "shared"
  | "divergence-osrm"
  | "divergence-valhalla"
  | "split"
  | "rejoin";

export interface RouteDifferenceFeatureProperties {
  kind: RouteDifferenceFeatureKind;
  divergenceIndex: number;
  sectionIndex: number;
  focused: boolean;
}

export interface RouteDifferenceFeature {
  type: "Feature";
  geometry:
    | { type: "LineString"; coordinates: [number, number][] }
    | { type: "Point"; coordinates: [number, number] };
  properties: RouteDifferenceFeatureProperties;
}

export interface RouteDifferenceFeatureCollection {
  type: "FeatureCollection";
  features: RouteDifferenceFeature[];
}

/** Build only true geographic geometry; normal-route display offsets never enter here. */
export function buildRouteDifferenceFeatureCollection(
  result: RouteDifferenceResult | null,
  overlayEnabled: boolean,
  focusedIndex: number | null,
): RouteDifferenceFeatureCollection {
  if (!result || !overlayEnabled) {
    return { type: "FeatureCollection", features: [] };
  }
  const features: RouteDifferenceFeature[] = [];
  result.osrmSharedSections.forEach((section, sectionIndex) => {
    if (section.geometry.length < 2) return;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: section.geometry },
      properties: {
        kind: "shared",
        divergenceIndex: -1,
        sectionIndex,
        focused: false,
      },
    });
  });
  result.divergences.forEach((divergence) => {
    const focused = divergence.index === focusedIndex;
    if (divergence.osrmGeometry.length >= 2) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: divergence.osrmGeometry,
        },
        properties: {
          kind: "divergence-osrm",
          divergenceIndex: divergence.index,
          sectionIndex: -1,
          focused,
        },
      });
    }
    if (divergence.valhallaGeometry.length >= 2) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: divergence.valhallaGeometry,
        },
        properties: {
          kind: "divergence-valhalla",
          divergenceIndex: divergence.index,
          sectionIndex: -1,
          focused,
        },
      });
    }
    if (divergence.split) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: divergence.split.coordinate },
        properties: {
          kind: "split",
          divergenceIndex: divergence.index,
          sectionIndex: -1,
          focused,
        },
      });
    }
    if (divergence.rejoin) {
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: divergence.rejoin.coordinate,
        },
        properties: {
          kind: "rejoin",
          divergenceIndex: divergence.index,
          sectionIndex: -1,
          focused,
        },
      });
    }
  });
  return { type: "FeatureCollection", features };
}

const DIVERGENCE_FILTER = [
  "in",
  ["get", "kind"],
  ["literal", ["divergence-osrm", "divergence-valhalla"]],
] as const;

export function routeDifferenceSharedLayerSpec() {
  return {
    id: ROUTE_DIFFERENCE_SHARED_LAYER_ID,
    type: "line" as const,
    source: ROUTE_DIFFERENCE_SOURCE_ID,
    filter: ["==", ["get", "kind"], "shared"],
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
    paint: {
      "line-color": "#64748b",
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 14, 6],
      "line-opacity": 0.76,
    },
  };
}

export function routeDifferenceUnderlayLayerSpec() {
  return {
    id: ROUTE_DIFFERENCE_UNDERLAY_LAYER_ID,
    type: "line" as const,
    source: ROUTE_DIFFERENCE_SOURCE_ID,
    filter: DIVERGENCE_FILTER,
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
    paint: {
      "line-color": "#ffffff",
      "line-width": [
        "case",
        ["==", ["get", "focused"], true],
        11,
        8,
      ],
      "line-opacity": 0.88,
    },
  };
}

function divergenceLayerSpec(
  id: string,
  kind: "divergence-osrm" | "divergence-valhalla",
  color: string,
) {
  return {
    id,
    type: "line" as const,
    source: ROUTE_DIFFERENCE_SOURCE_ID,
    filter: ["==", ["get", "kind"], kind],
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
    paint: {
      "line-color": color,
      "line-width": [
        "case",
        ["==", ["get", "focused"], true],
        8,
        5,
      ],
      "line-opacity": [
        "case",
        ["==", ["get", "focused"], true],
        1,
        0.88,
      ],
    },
  };
}

export function routeDifferenceOsrmLayerSpec() {
  return divergenceLayerSpec(
    ROUTE_DIFFERENCE_OSRM_LAYER_ID,
    "divergence-osrm",
    "#2563eb",
  );
}

export function routeDifferenceValhallaLayerSpec() {
  return divergenceLayerSpec(
    ROUTE_DIFFERENCE_VALHALLA_LAYER_ID,
    "divergence-valhalla",
    "#f97316",
  );
}

export function routeDifferenceEndpointRingLayerSpec() {
  return {
    id: ROUTE_DIFFERENCE_ENDPOINT_RING_LAYER_ID,
    type: "circle" as const,
    source: ROUTE_DIFFERENCE_SOURCE_ID,
    filter: [
      "in",
      ["get", "kind"],
      ["literal", ["split", "rejoin"]],
    ],
    paint: {
      "circle-color": "#ffffff",
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        8,
        ["case", ["==", ["get", "focused"], true], 7, 5],
        14,
        ["case", ["==", ["get", "focused"], true], 10, 7],
      ],
      "circle-opacity": 0.96,
    },
  };
}

function endpointLayerSpec(id: string, kind: "split" | "rejoin", color: string) {
  return {
    id,
    type: "circle" as const,
    source: ROUTE_DIFFERENCE_SOURCE_ID,
    filter: ["==", ["get", "kind"], kind],
    paint: {
      "circle-color": color,
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        8,
        ["case", ["==", ["get", "focused"], true], 5, 3.5],
        14,
        ["case", ["==", ["get", "focused"], true], 7, 5],
      ],
      "circle-opacity": 1,
    },
  };
}

export function routeDifferenceSplitLayerSpec() {
  return endpointLayerSpec(
    ROUTE_DIFFERENCE_SPLIT_LAYER_ID,
    "split",
    "#f59e0b",
  );
}

export function routeDifferenceRejoinLayerSpec() {
  return endpointLayerSpec(
    ROUTE_DIFFERENCE_REJOIN_LAYER_ID,
    "rejoin",
    "#10b981",
  );
}

export function routeDifferenceLayerSpecs() {
  return [
    routeDifferenceSharedLayerSpec(),
    routeDifferenceUnderlayLayerSpec(),
    routeDifferenceOsrmLayerSpec(),
    routeDifferenceValhallaLayerSpec(),
    routeDifferenceEndpointRingLayerSpec(),
    routeDifferenceSplitLayerSpec(),
    routeDifferenceRejoinLayerSpec(),
  ];
}

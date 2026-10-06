import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TraceMap, {
  buildTraceRoutesFeatureCollection,
  fitTraceMap,
} from "./TraceMap";
import { useStore } from "../store";
import { resolveMapStyle } from "../map/style";
import type {
  NormalizedRoute,
  ValhallaDebugSegment,
  ValhallaTraceResult,
} from "../types";
import { deriveRouteProfile } from "../analysis/routeProfile";
import { evaluateRouteQuery } from "../analysis/routeQuery";

let styleLoaded = true;
let unsetStyleAfterSourceAdd = false;
let constructorConfig: { style?: unknown; center?: unknown; zoom?: number } | undefined;
const instances: MockMap[] = [];

class MockSource {
  setData = vi.fn((data: unknown) => {
    this.data = data;
  });
  constructor(public data: unknown) {}
}

class MockMap {
  listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  sources = new Map<string, MockSource>();
  layers = new Map<string, unknown>();
  camera = {
    center: [77.209, 28.6139] as [number, number],
    zoom: 10,
    bearing: 0,
    pitch: 0,
  };
  addControl = vi.fn();
  remove = vi.fn();
  resize = vi.fn();
  fitBounds = vi.fn();
  easeTo = vi.fn((options: {
    center?: [number, number]; zoom?: number; bearing?: number; pitch?: number;
  }) => {
    if (options.center) this.camera.center = options.center;
    if (options.zoom !== undefined) this.camera.zoom = options.zoom;
    if (options.bearing !== undefined) this.camera.bearing = options.bearing;
    if (options.pitch !== undefined) this.camera.pitch = options.pitch;
  });
  jumpTo = vi.fn((options: {
    center?: [number, number]; zoom?: number; bearing?: number; pitch?: number;
  }) => {
    if (options.center) this.camera.center = options.center;
    if (options.zoom !== undefined) this.camera.zoom = options.zoom;
    if (options.bearing !== undefined) this.camera.bearing = options.bearing;
    if (options.pitch !== undefined) this.camera.pitch = options.pitch;
  });
  getCenter = vi.fn(() => ({
    lng: this.camera.center[0],
    lat: this.camera.center[1],
  }));
  getZoom = vi.fn(() => this.camera.zoom);
  getBearing = vi.fn(() => this.camera.bearing);
  getPitch = vi.fn(() => this.camera.pitch);
  setFeatureState = vi.fn();
  queryRenderedFeatures = vi.fn(() => []);
  getCanvas = vi.fn(() => ({ width: 900, height: 500 }));
  getContainer = vi.fn(() => this.config.container);

  constructor(public config: { container: HTMLElement; style?: unknown; center?: unknown; zoom?: number }) {
    constructorConfig = config;
    if (Array.isArray(config.center)) {
      this.camera.center = config.center as [number, number];
    }
    if (config.zoom !== undefined) this.camera.zoom = config.zoom;
    instances.push(this);
  }

  on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    const handlers = this.listeners.get(event) ?? new Set();
    handlers.add(handler);
    this.listeners.set(event, handlers);
    return this;
  });

  once = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    const onceHandler = (...args: unknown[]) => {
      this.off(event, onceHandler);
      handler(...args);
    };
    return this.on(event, onceHandler);
  });

  off = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    this.listeners.get(event)?.delete(handler);
    return this;
  });

  emit(event: string, ...args: unknown[]) {
    for (const handler of [...(this.listeners.get(event) ?? [])]) handler(...args);
  }

  isStyleLoaded = vi.fn(() => styleLoaded);

  addSource = vi.fn((id: string, spec: { data: unknown }) => {
    this.sources.set(id, new MockSource(spec.data));
    if (unsetStyleAfterSourceAdd) {
      styleLoaded = false;
      unsetStyleAfterSourceAdd = false;
    }
  });

  getSource = vi.fn((id: string) => this.sources.get(id));

  addLayer = vi.fn((layer: { id: string }) => {
    this.layers.set(layer.id, layer);
  });

  getLayer = vi.fn((id: string) => this.layers.get(id));
}

vi.mock("maplibre-gl", () => ({
  default: {
    Map: class {
      constructor(config: { container: HTMLElement; style?: unknown; center?: unknown; zoom?: number }) {
        return new MockMap(config);
      }
    },
    NavigationControl: class {},
  },
}));
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

function sourceRoute(coordinates: [number, number][] = [[77, 28], [77.1, 28.1]]): NormalizedRoute {
  return {
    id: "osrm:0",
    engine: "osrm",
    index: 0,
    isPrimary: true,
    label: "OSRM Primary",
    coordinates,
    distanceMeters: 1,
    durationSeconds: 1,
    cost: 1,
    raw: { geometry: "encoded" },
  };
}

function analysisSegment(): ValhallaDebugSegment {
  return {
    id: "trace:osrm:0:0",
    engine: "valhalla",
    routeId: "trace:osrm:0",
    routeIndex: 0,
    legIndex: 0,
    segmentIndex: 0,
    coordinates: [[77.015, 28.015], [77.075, 28.075]],
    properties: {
      id: "trace-edge",
      wayId: "trace-way",
      name: ["Trace edge"],
      lengthKm: 0.12,
      speed: 35,
      density: 15,
      roadClass: "kTrunk",
      surface: "kPavedSmooth",
      use: "kRoad",
      toll: false,
      unpaved: false,
      tunnel: false,
      bridge: false,
      roundabout: false,
      beginShapeIndex: 0,
      endShapeIndex: 1,
      traversability: "kBoth",
    },
  } as unknown as ValhallaDebugSegment;
}

function traceResult(
  traceGeometry: [number, number][],
  segments: ValhallaDebugSegment[] = [],
): ValhallaTraceResult {
  return {
    status: "ok",
    sourceRouteId: "osrm:0",
    originalGeometry: sourceRoute().coordinates,
    traceGeometry,
    exactGeometryMatch: true,
    originalPointCount: 2,
    tracePointCount: traceGeometry.length,
    geometryDeviation: null,
    segments,
    warnings: [],
    errors: [],
    httpStatus: 200,
    durationMs: 1,
  };
}

function resetStore(result: ValhallaTraceResult | null = null) {
  useStore.setState({
    traceResult: result,
    traceHoveredSegmentIds: [],
    tracePinnedSegmentIds: [],
    traceFitRequestId: 0,
    traceResultRevision: 0,
    traceInspectorCamera: null,
    traceInspectorCameraResultRevision: null,
    routeComparisonCamera: null,
    routeComparisonCameraResultRevision: null,
    comparisonResultRevision: 0,
    traceAnalysisExecutedSearch: null,
    traceAnalysisFocusedSegmentId: null,
  });
}

describe("TraceMap rendering lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    instances.length = 0;
    constructorConfig = undefined;
    styleLoaded = true;
    unsetStyleAfterSourceAdd = false;
    resetStore();
  });

  it("uses the shared working basemap style and valid lon/lat GeoJSON", () => {
    const route = sourceRoute([[77.2, 28.6], [77.3, 28.7]]);
    const trace = [[77.21, 28.61], [77.31, 28.71]] as [number, number][];
    const data = buildTraceRoutesFeatureCollection(route, trace);

    render(<TraceMap sourceRoute={route} />);

    expect(constructorConfig?.style).toEqual(resolveMapStyle());
    expect(data).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: route.coordinates },
          properties: { kind: "original" },
        },
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: trace },
          properties: { kind: "trace" },
        },
      ],
    });
    expect(data.features[0].geometry.coordinates[0]).toEqual([77.2, 28.6]);
  });

  it("waits for style readiness, then creates visible route and debug layers", () => {
    styleLoaded = false;
    resetStore(traceResult([[77, 28], [77.1, 28.1]]));
    render(<TraceMap sourceRoute={sourceRoute()} />);
    const map = instances[0];

    expect(map.sources.size).toBe(0);

    styleLoaded = true;
    act(() => map.emit("style.load"));

    expect(map.sources.has("trace-inspector-routes")).toBe(true);
    expect(map.sources.has("trace-inspector-debug")).toBe(true);
    expect(map.layers.has("trace-original-route")).toBe(true);
    expect(map.layers.has("trace-snapped-route")).toBe(true);
    expect(map.layers.has("route-debug-highlight")).toBe(true);
    expect(map.layers.has("route-debug-hit")).toBe(true);
    expect(map.layers.get("trace-original-route")).toEqual(
      expect.objectContaining({
        paint: expect.objectContaining({
          "line-color": "#2563eb",
          "line-width": 7,
          "line-opacity": 0.72,
        }),
      }),
    );
    expect(map.layers.get("trace-snapped-route")).toEqual(
      expect.objectContaining({
        paint: expect.objectContaining({
          "line-color": "#f97316",
          "line-width": 4,
          "line-opacity": 0.96,
        }),
      }),
    );
  });
  it("adds route layers when adding the source transiently unsettles the style", () => {
    unsetStyleAfterSourceAdd = true;
    render(<TraceMap sourceRoute={sourceRoute()} />);
    const map = instances[0];

    expect(map.sources.has("trace-inspector-routes")).toBe(true);
    expect(map.layers.has("trace-original-route")).toBe(true);
    expect(map.layers.has("trace-snapped-route")).toBe(true);
  });


  it("updates an existing route source even while style loading is transiently false", () => {
    render(<TraceMap sourceRoute={sourceRoute()} />);
    const map = instances[0];
    const source = map.sources.get("trace-inspector-routes")!;
    source.setData.mockClear();

    styleLoaded = false;
    act(() => useStore.setState({
      traceResult: traceResult([[77, 28], [77.05, 28.05], [77.1, 28.1]]),
    }));

    expect(source.setData).toHaveBeenCalledWith(
      expect.objectContaining({
        features: expect.arrayContaining([
          expect.objectContaining({
            properties: { kind: "trace" },
            geometry: expect.objectContaining({
              coordinates: [[77, 28], [77.05, 28.05], [77.1, 28.1]],
            }),
          }),
        ]),
      }),
    );

    styleLoaded = true;
    act(() => map.emit("style.load"));
    expect(map.layers.has("trace-snapped-route")).toBe(true);
  });

  it("fits identical source and trace geometries to their combined bounds", () => {
    const coordinates = [[77, 28], [77.2, 28.3]] as [number, number][];
    const map = new MockMap({ container: document.createElement("div") });

    fitTraceMap(map as unknown as import("maplibre-gl").Map, sourceRoute(coordinates), coordinates);

    expect(map.fitBounds).toHaveBeenCalledWith(
      [[77, 28], [77.2, 28.3]],
      { padding: 56, maxZoom: 16, duration: 300 },
    );
  });

  it("resizes on activation and cleans up safely across a remount", () => {
    const first = render(<TraceMap sourceRoute={sourceRoute()} />);
    const firstMap = instances[0];

    act(() => firstMap.emit("load"));
    expect(firstMap.resize).toHaveBeenCalled();

    first.unmount();
    expect(firstMap.remove).toHaveBeenCalled();

    const second = render(<TraceMap sourceRoute={sourceRoute()} />);
    expect(instances).toHaveLength(2);
    act(() => instances[1].emit("style.load"));
    expect(instances[1].resize).toHaveBeenCalled();
    second.unmount();
    expect(instances[1].remove).toHaveBeenCalled();
  });
});

describe("TraceMap camera persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    instances.length = 0;
    styleLoaded = true;
    resetStore(traceResult([[77, 28], [77.1, 28.1]]));
  });

  it("restores the exact settled trace camera on a same-result remount", () => {
    useStore.setState({ traceResultRevision: 5 });
    const route = sourceRoute();
    const first = render(<TraceMap sourceRoute={route} />);
    const firstMap = instances[0];
    const customCamera = {
      center: [77.081234, 28.041234] as [number, number],
      zoom: 17.125,
      bearing: 22,
      pitch: 37,
    };

    firstMap.camera = { ...customCamera };
    act(() => firstMap.emit("moveend"));
    expect(useStore.getState().traceInspectorCamera).toEqual(customCamera);
    first.unmount();

    render(<TraceMap sourceRoute={route} />);
    const restoredMap = instances[1];
    expect(restoredMap.jumpTo).toHaveBeenCalledWith(customCamera);
    expect(restoredMap.fitBounds).not.toHaveBeenCalled();
  });

  it("fits a new trace result once instead of restoring the old trace camera", () => {
    useStore.setState({
      traceResultRevision: 6,
      traceInspectorCameraResultRevision: 5,
      traceInspectorCamera: {
        center: [10, 20],
        zoom: 18,
        bearing: -25,
        pitch: 50,
      },
    });

    render(<TraceMap sourceRoute={sourceRoute()} />);
    const map = instances[0];
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.fitBounds).toHaveBeenCalledOnce();
  });

  it("persists an explicit Fit Routes camera and drawer resize leaves it unchanged", () => {
    const saved = {
      center: [77.05, 28.05] as [number, number],
      zoom: 14,
      bearing: 0,
      pitch: 0,
    };
    useStore.setState({
      traceResultRevision: 3,
      traceInspectorCameraResultRevision: 3,
      traceInspectorCamera: saved,
    });
    const view = render(<TraceMap sourceRoute={sourceRoute()} />);
    const map = instances[0];

    act(() => useStore.getState().requestTraceFit());
    expect(map.fitBounds).toHaveBeenCalledOnce();
    const fitted = {
      center: [77.06, 28.06] as [number, number],
      zoom: 15.5,
      bearing: 3,
      pitch: 12,
    };
    act(() => {
      map.camera = { ...fitted };
      map.emit("moveend");
    });
    expect(useStore.getState().traceInspectorCamera).toEqual(fitted);

    view.rerender(
      <TraceMap sourceRoute={sourceRoute()} compactDetails layoutRevision={1} />,
    );
    expect(map.resize).toHaveBeenCalled();
    expect(useStore.getState().traceInspectorCamera).toEqual(fitted);
  });

  it("restores pitch/bearing and persists a 2D reset", () => {
    useStore.setState({
      traceResultRevision: 8,
      traceInspectorCameraResultRevision: 8,
      traceInspectorCamera: {
        center: [77.2, 28.6],
        zoom: 16,
        bearing: -18,
        pitch: 48,
      },
    });
    render(<TraceMap sourceRoute={sourceRoute()} />);
    const map = instances[0];
    expect(map.jumpTo).toHaveBeenCalledWith(
      expect.objectContaining({ pitch: 48, bearing: -18 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "2D view" }));
    act(() => map.emit("moveend"));
    expect(useStore.getState().traceInspectorCamera).toEqual(
      expect.objectContaining({ pitch: 0, bearing: 0 }),
    );
  });
});

describe("TraceMap analysis overlays", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    instances.length = 0;
    styleLoaded = true;
    unsetStyleAfterSourceAdd = false;
    resetStore();
  });

  it("renders exact search/focus geometry below debug layers and restores it after style.load", () => {
    const segment = analysisSegment();
    const trace = traceResult(
      [[77, 28], [77.05, 28.05], [77.1, 28.1]],
      [segment],
    );
    const profile = deriveRouteProfile(trace.segments, "trace:osrm:0");
    const searchResult = evaluateRouteQuery(profile, {
      field: "density",
      operator: "=",
      value: "15",
    });
    useStore.setState({
      traceResult: trace,
      traceResultRevision: 9,
      traceAnalysisExecutedSearch: {
        traceResultRevision: 9,
        routeId: "trace:osrm:0",
        query: { field: "density", operator: "=", value: "15" },
        result: searchResult,
      },
      traceAnalysisFocusedSegmentId: segment.id,
    });

    render(<TraceMap sourceRoute={sourceRoute()} />);
    const map = instances[0];
    const matches = map.sources.get("trace-analysis-matches")!;
    const focus = map.sources.get("trace-analysis-focus")!;
    const matchData = matches.data as {
      features: Array<{ geometry: { coordinates: [number, number][] } }>;
    };
    const focusData = focus.data as {
      features: Array<{ geometry: { coordinates: [number, number][] } }>;
    };

    expect(matchData.features).toHaveLength(1);
    expect(matchData.features[0].geometry.coordinates).toEqual(
      segment.coordinates,
    );
    expect(focusData.features).toHaveLength(1);
    expect(focusData.features[0].geometry.coordinates).toEqual(
      segment.coordinates,
    );

    const order = Array.from(map.layers.keys());
    expect(order.indexOf("trace-original-route")).toBeLessThan(
      order.indexOf("trace-snapped-route"),
    );
    expect(order.indexOf("trace-snapped-route")).toBeLessThan(
      order.indexOf("trace-analysis-matches-glow"),
    );
    expect(order.indexOf("trace-analysis-matches-line")).toBeLessThan(
      order.indexOf("trace-analysis-focus-glow"),
    );
    expect(order.indexOf("trace-analysis-focus-line")).toBeLessThan(
      order.indexOf("route-debug-highlight"),
    );
    expect(order.indexOf("route-debug-highlight")).toBeLessThan(
      order.indexOf("route-debug-hit"),
    );

    map.sources.clear();
    map.layers.clear();
    act(() => map.emit("style.load"));
    expect(map.sources.has("trace-analysis-matches")).toBe(true);
    expect(map.sources.has("trace-analysis-focus")).toBe(true);
    expect(map.layers.has("trace-analysis-matches-line")).toBe(true);
    expect(map.layers.has("trace-analysis-focus-line")).toBe(true);
    expect(map.layers.has("route-debug-highlight")).toBe(true);
    expect(map.layers.has("route-debug-hit")).toBe(true);

    const sourceCount = map.sources.size;
    const layerCount = map.layers.size;
    act(() => map.emit("style.load"));
    expect(map.sources.size).toBe(sourceCount);
    expect(map.layers.size).toBe(layerCount);
  });

  it("clears search and focus independently without changing trace route/debug sources", () => {
    const segment = analysisSegment();
    const trace = traceResult([[77, 28], [77.1, 28.1]], [segment]);
    const profile = deriveRouteProfile(trace.segments, "trace:osrm:0");
    useStore.setState({
      traceResult: trace,
      traceResultRevision: 3,
      traceAnalysisExecutedSearch: {
        traceResultRevision: 3,
        routeId: "trace:osrm:0",
        query: { field: "speed", operator: "=", value: "35" },
        result: evaluateRouteQuery(profile, {
          field: "speed",
          operator: "=",
          value: "35",
        }),
      },
      traceAnalysisFocusedSegmentId: segment.id,
    });

    render(<TraceMap sourceRoute={sourceRoute()} />);
    const map = instances[0];
    const routeSource = map.sources.get("trace-inspector-routes");
    const debugSource = map.sources.get("trace-inspector-debug");

    act(() => useStore.getState().setTraceAnalysisFocusedSegmentId(null));
    expect(
      (map.sources.get("trace-analysis-focus")!.data as { features: unknown[] })
        .features,
    ).toEqual([]);
    expect(
      (map.sources.get("trace-analysis-matches")!.data as { features: unknown[] })
        .features,
    ).toHaveLength(1);

    act(() => useStore.getState().clearTraceAnalysisSearch());
    expect(
      (map.sources.get("trace-analysis-matches")!.data as { features: unknown[] })
        .features,
    ).toEqual([]);
    expect(map.sources.get("trace-inspector-routes")).toBe(routeSource);
    expect(map.sources.get("trace-inspector-debug")).toBe(debugSource);
  });
});

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TraceMap, {
  buildTraceRoutesFeatureCollection,
  fitTraceMap,
} from "./TraceMap";
import { useStore } from "../store";
import { resolveMapStyle } from "../map/style";
import type { NormalizedRoute, ValhallaTraceResult } from "../types";

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
  addControl = vi.fn();
  remove = vi.fn();
  resize = vi.fn();
  fitBounds = vi.fn();
  easeTo = vi.fn();
  setFeatureState = vi.fn();
  queryRenderedFeatures = vi.fn(() => []);
  getCanvas = vi.fn(() => ({ width: 900, height: 500 }));
  getContainer = vi.fn(() => this.config.container);

  constructor(public config: { container: HTMLElement; style?: unknown; center?: unknown; zoom?: number }) {
    constructorConfig = config;
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

function traceResult(traceGeometry: [number, number][]): ValhallaTraceResult {
  return {
    status: "ok",
    sourceRouteId: "osrm:0",
    originalGeometry: sourceRoute().coordinates,
    traceGeometry,
    exactGeometryMatch: true,
    originalPointCount: 2,
    tracePointCount: traceGeometry.length,
    geometryDeviation: null,
    segments: [],
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

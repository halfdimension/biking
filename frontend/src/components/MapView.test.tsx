/**
 * Light MapView tests for route rendering wiring (Task 16.1, 16.2).
 *
 * MapLibre GL does not run under jsdom, so it is mocked with vi.fn()s. These
 * tests assert the combined source + three layers are created and that
 * feature-state is applied and REAPPLIED after a source-data replacement — the
 * real paint/feature-state behavior is verified at the Task 19 real-map
 * checkpoint.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, fireEvent, screen } from "@testing-library/react";
import MapView from "./MapView";
import { useStore } from "../store";
import type { CompareDebug, NormalizedRoute } from "../types";

// MapLibre GL does not run under jsdom. This lifecycle-aware mock keeps sources,
// layers, and event listeners per map instance so remount behavior can be tested.
const setDataSpy = vi.fn();
let styleLoaded = true;
let unsettleStyleWhenRoutesSourceIsAdded = false;
let debugQueryFeatures: unknown[] = [];

type MapEventHandler = (...args: unknown[]) => void;

interface MockMap {
  addSource: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  getSource: ReturnType<typeof vi.fn>;
  getLayer: ReturnType<typeof vi.fn>;
  setFeatureState: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
  easeTo: ReturnType<typeof vi.fn>;
  jumpTo: ReturnType<typeof vi.fn>;
  getBounds: ReturnType<typeof vi.fn>;
  queryRenderedFeatures: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  camera: {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  };
  sourceData: globalThis.Map<string, unknown>;
  emit: (event: string, ...args: unknown[]) => void;
  listenerCount: (event: string) => number;
}

let mapInstance: MockMap;
let mapInstances: MockMap[] = [];
let mapConstructorConfig: { center?: [number, number]; zoom?: number } | undefined;

vi.mock("maplibre-gl", () => {
  class Map {
    sources = new globalThis.Map<string, { setData: (data: unknown) => void }>();
    sourceData = new globalThis.Map<string, unknown>();
    layers = new Set<string>();
    listeners = new globalThis.Map<
      string,
      Array<{ handler: MapEventHandler; once: boolean }>
    >();
    camera = {
      center: [77.209, 28.6139] as [number, number],
      zoom: 10,
      bearing: 0,
      pitch: 0,
    };
    on = vi.fn((event: string, handler: MapEventHandler) => {
      this.listeners.set(event, [
        ...(this.listeners.get(event) ?? []),
        { handler, once: false },
      ]);
      return this;
    });
    off = vi.fn((event: string, handler: MapEventHandler) => {
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter(
          (entry) => entry.handler !== handler,
        ),
      );
      return this;
    });
    once = vi.fn((event: string, handler: MapEventHandler) => {
      this.listeners.set(event, [
        ...(this.listeners.get(event) ?? []),
        { handler, once: true },
      ]);
      return this;
    });
    emit(event: string, ...args: unknown[]) {
      const current = [...(this.listeners.get(event) ?? [])];
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter(
          (entry) => !current.includes(entry) || !entry.once,
        ),
      );
      for (const entry of current) entry.handler(...args);
    }
    listenerCount(event: string) {
      return this.listeners.get(event)?.length ?? 0;
    }
    addControl = vi.fn();
    remove = vi.fn(() => this.listeners.clear());
    isStyleLoaded = vi.fn(() => styleLoaded);
    addSource = vi.fn((id: string, specification: { data?: unknown }) => {
      this.sourceData.set(id, specification.data);
      this.sources.set(id, {
        setData: (data: unknown) => {
          this.sourceData.set(id, data);
          setDataSpy(data);
        },
      });
      if (id === "routes" && unsettleStyleWhenRoutesSourceIsAdded) {
        styleLoaded = false;
      }
    });
    getSource = vi.fn((id: string) => this.sources.get(id));
    addLayer = vi.fn((specification: { id: string }) => {
      this.layers.add(specification.id);
    });
    getLayer = vi.fn((id: string) =>
      this.layers.has(id) ? { id } : undefined,
    );
    setFeatureState = vi.fn();
    setPaintProperty = vi.fn();
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
    getBounds = vi.fn();
    queryRenderedFeatures = vi.fn(() => debugQueryFeatures);
    resize = vi.fn();
    getCanvas = vi.fn(() => ({ width: 800, height: 600 }));
    constructor(config?: { center?: [number, number]; zoom?: number }) {
      mapInstance = this as unknown as MockMap;
      if (config?.center) this.camera.center = config.center;
      if (config?.zoom !== undefined) this.camera.zoom = config.zoom;
      mapInstances.push(mapInstance);
      mapConstructorConfig = config;
    }
  }
  class Marker {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {
      return this;
    }
  }
  class NavigationControl {}
  return { default: { Map, Marker, NavigationControl } };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

function route(overrides: Partial<NormalizedRoute> = {}): NormalizedRoute {
  return {
    id: "osrm:0",
    engine: "osrm",
    index: 0,
    isPrimary: true,
    label: "OSRM Primary",
    coordinates: [
      [77.6, 12.9],
      [77.65, 12.95],
    ],
    distanceMeters: 100,
    durationSeconds: 60,
    cost: 10,
    raw: {},
    ...overrides,
  };
}


function debugResult(): CompareDebug {
  return {
    osrm: {
      engine: "osrm",
      status: "ok",
      errors: [],
      segments: [{
        id: "osrm:0:0:0",
        engine: "osrm",
        routeId: "osrm:0",
        routeIndex: 0,
        legIndex: 0,
        segmentIndex: 0,
        coordinates: [[77.2, 28.6], [77.21, 28.61]],
        properties: {},
      }],
    },
    valhalla: {
      engine: "valhalla",
      status: "ok",
      errors: [],
      segments: [{
        id: "valhalla:0:0:0",
        engine: "valhalla",
        routeId: "valhalla:0",
        routeIndex: 0,
        legIndex: 0,
        segmentIndex: 0,
        coordinates: [[77.2, 28.6], [77.21, 28.61]],
        properties: {},
      }],
    },
  } as unknown as CompareDebug;
}
/** The most recently constructed mock Map instance. */
function lastMap(): MockMap {
  return mapInstance;
}

describe("MapView route rendering (Task 16)", () => {
  beforeEach(() => {
    mapInstances = [];
    unsettleStyleWhenRoutesSourceIsAdded = false;
    debugQueryFeatures = [];
    styleLoaded = true;
    setDataSpy.mockClear();
    vi.clearAllMocks();
    // Reset store slices MapView reads.
    useStore.setState({
      routes: [],
      visibility: {},
      selectedRouteId: null,
      start: null,
      dest: null,
      compareStatus: "idle",
      fitRequestId: 0,
      routeComparisonCamera: null,
      routeComparisonCameraResultRevision: null,
      comparisonResultRevision: 0,
      traceInspectorCamera: null,
    });
  });

  it("creates the combined source and three layers when routes arrive", () => {
    render(<MapView />);
    const map = lastMap();

    act(() => {
      useStore.setState({
        routes: [route({ id: "osrm:0" }), route({ id: "valhalla:0", engine: "valhalla" })],
        visibility: { "osrm:0": true, "valhalla:0": true },
        selectedRouteId: null,
      });
    });

    // Source added with promoteId.
    expect(map.addSource).toHaveBeenCalledWith(
      "routes",
      expect.objectContaining({ type: "geojson", promoteId: "routeId" }),
    );
    // Three layers, in order: hit, base, selected.
    const layerIds = map.addLayer.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(layerIds).toEqual(["routes-hit", "routes-base", "routes-selected"]);

    // feature-state applied for every route.
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: "routes", id: "osrm:0" },
      { visible: true, selected: false, hasSelection: false },
    );
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: "routes", id: "valhalla:0" },
      { visible: true, selected: false, hasSelection: false },
    );
  });

  it("reapplies feature-state after setData when routes are replaced", () => {
    render(<MapView />);
    const map = lastMap();

    // First compare result creates the source.
    act(() => {
      useStore.setState({
        routes: [route({ id: "osrm:0" })],
        visibility: { "osrm:0": true },
        selectedRouteId: null,
      });
    });
    map.setFeatureState.mockClear();

    // Second compare replaces the routes → setData + reapplied feature-state.
    act(() => {
      useStore.setState({
        routes: [route({ id: "osrm:0" }), route({ id: "osrm:1", index: 1, isPrimary: false })],
        visibility: { "osrm:0": true, "osrm:1": true },
        selectedRouteId: "osrm:1",
      });
    });

    expect(setDataSpy).toHaveBeenCalled();
    // feature-state reapplied for both routes, with the new selection.
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: "routes", id: "osrm:1" },
      { visible: true, selected: true, hasSelection: true },
    );
  });

  it("updates feature-state on selection change without setData", () => {
    render(<MapView />);
    const map = lastMap();

    act(() => {
      useStore.setState({
        routes: [route({ id: "osrm:0" })],
        visibility: { "osrm:0": true },
        selectedRouteId: null,
      });
    });
    map.setFeatureState.mockClear();
    setDataSpy.mockClear();

    act(() => {
      useStore.setState({ selectedRouteId: "osrm:0" });
    });

    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: "routes", id: "osrm:0" },
      { visible: true, selected: true, hasSelection: true },
    );
    expect(setDataSpy).not.toHaveBeenCalled();
  });

  it("restores pre-existing debug data after route setup unsettles a remounted style", async () => {
    const debug = debugResult();
    useStore.setState({
      routes: [
        route({ id: "osrm:0" }),
        route({ id: "valhalla:0", engine: "valhalla" }),
      ],
      visibility: { "osrm:0": true, "valhalla:0": true },
      edgeDebugEnabled: true,
      debugResults: debug,
      hoveredDebugSegmentIds: [],
      pinnedDebugSegmentIds: [],
    });
    styleLoaded = false;
    unsettleStyleWhenRoutesSourceIsAdded = true;

    render(<MapView />);
    const map = lastMap();
    expect(map.getSource("routes")).toBeUndefined();
    expect(map.getSource("route-debug-segments")).toBeUndefined();

    // Both effects were waiting for the first idle. Route setup runs first and
    // makes isStyleLoaded() transiently false before debug setup runs.
    act(() => {
      styleLoaded = true;
      map.emit("idle");
    });
    expect(map.getSource("routes")).toBeDefined();
    expect(map.getSource("route-debug-segments")).toBeUndefined();

    // The debug effect must retain its data and schedule another settle pass.
    act(() => {
      styleLoaded = true;
      map.emit("idle");
    });

    expect(map.getSource("route-debug-segments")).toBeDefined();
    expect(map.sourceData.get("route-debug-segments")).toEqual(
      expect.objectContaining({ features: expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({ debugSegmentId: "osrm:0:0:0" }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({ debugSegmentId: "valhalla:0:0:0" }),
        }),
      ]) }),
    );
    expect(map.getLayer("route-debug-hit")).toBeDefined();
    expect(map.getLayer("route-debug-highlight")).toBeDefined();
    expect(map.listenerCount("mousemove")).toBe(1);
    expect(map.listenerCount("mouseleave")).toBe(1);

    // The listener is attached to this remounted map and queries its restored
    // hit layer; hidden-route filtering still uses current store visibility.
    debugQueryFeatures = [{
      id: "osrm:0:0:0",
      properties: {
        debugSegmentId: "osrm:0:0:0",
        routeId: "osrm:0",
        engine: "osrm",
      },
    }];
    await act(async () => {
      map.emit("mousemove", {
        point: { x: 20, y: 20 },
        lngLat: { lng: 77.2, lat: 28.6 },
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(useStore.getState().hoveredDebugSegmentIds).toEqual(["osrm:0:0:0"]);

    act(() => {
      useStore.setState({ visibility: { "osrm:0": false, "valhalla:0": true } });
    });
    await act(async () => {
      map.emit("mousemove", {
        point: { x: 20, y: 20 },
        lngLat: { lng: 77.2, lat: 28.6 },
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(useStore.getState().hoveredDebugSegmentIds).toEqual([]);
  });

  it("cleans old listeners and attaches one fresh set across repeated remounts", () => {
    useStore.setState({
      routes: [route()],
      visibility: { "osrm:0": true },
      edgeDebugEnabled: true,
      debugResults: debugResult(),
    });

    const firstRender = render(<MapView />);
    const firstMap = lastMap();
    expect(firstMap.listenerCount("mousemove")).toBe(1);
    firstRender.unmount();
    expect(firstMap.listenerCount("mousemove")).toBe(0);
    expect(firstMap.remove).toHaveBeenCalledOnce();

    const secondRender = render(<MapView />);
    const secondMap = lastMap();
    expect(secondMap).not.toBe(firstMap);
    expect(secondMap.listenerCount("mousemove")).toBe(1);
    secondRender.unmount();
    expect(secondMap.listenerCount("mousemove")).toBe(0);

    render(<MapView />);
    const thirdMap = lastMap();
    expect(thirdMap).not.toBe(secondMap);
    expect(thirdMap.listenerCount("mousemove")).toBe(1);
    expect(mapInstances).toHaveLength(3);
  });

  it("updates an existing debug source while the style is settling", () => {
    useStore.setState({
      edgeDebugEnabled: true,
      debugResults: null,
      visibility: { "osrm:0": true },
    });
    render(<MapView />);
    setDataSpy.mockClear();
    styleLoaded = false;

    const debug = {
      osrm: {
        engine: "osrm",
        status: "ok",
        errors: [],
        segments: [{
          id: "osrm:0:0:0",
          engine: "osrm",
          routeId: "osrm:0",
          routeIndex: 0,
          legIndex: 0,
          segmentIndex: 0,
          coordinates: [[77.2, 28.6], [77.21, 28.61]],
          properties: {},
        }],
      },
      valhalla: { engine: "valhalla", status: "ok", errors: [], segments: [] },
    } as unknown as CompareDebug;

    act(() => useStore.setState({ debugResults: debug }));

    expect(setDataSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        features: [
          expect.objectContaining({
            properties: expect.objectContaining({ routeId: "osrm:0" }),
          }),
        ],
      }),
    );
    act(() => useStore.getState().setEdgeDebugEnabled(false));
    styleLoaded = true;
  });
});

describe("MapView fitting (Task 18.1, Req 20.1-20.3)", () => {
  beforeEach(() => {
    mapInstances = [];
    unsettleStyleWhenRoutesSourceIsAdded = false;
    debugQueryFeatures = [];
    styleLoaded = true;
    setDataSpy.mockClear();
    vi.clearAllMocks();
    useStore.setState({
      routes: [],
      visibility: {},
      selectedRouteId: null,
      start: null,
      dest: null,
      compareStatus: "idle",
      fitRequestId: 0,
      routeComparisonCamera: null,
      routeComparisonCameraResultRevision: null,
      comparisonResultRevision: 0,
    });
  });

  it("auto-fits to route bounds when a Compare completes (Req 20.1)", () => {
    render(<MapView />);
    const map = lastMap();

    // Simulate a successful compare: routes present + status "done".
    act(() => {
      useStore.setState({
        routes: [
          route({
            id: "osrm:0",
            coordinates: [
              [77.6, 12.9],
              [77.2, 28.6],
            ],
          }),
        ],
        visibility: { "osrm:0": true },
        compareStatus: "done",
      });
    });

    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [77.2, 12.9],
        [77.6, 28.6],
      ],
      expect.objectContaining({ padding: expect.any(Number) }),
    );
  });

  it("still auto-fits when isStyleLoaded() reports false (regression)", () => {
    // Real-world failure: right after the routes `setData`, MapLibre's
    // `isStyleLoaded()` transiently returns false. The old code gated the fit on
    // it and deferred to `map.once("load")` — but `load` had already fired during
    // map init and never fires again, so the fit was dropped forever and the
    // camera stayed at the Delhi default. Camera ops are safe while the style is
    // still settling, so the fit must happen regardless.
    styleLoaded = false;
    render(<MapView />);
    const map = lastMap();

    act(() => {
      useStore.setState({
        routes: [
          route({
            id: "osrm:0",
            coordinates: [
              [77.6, 12.9],
              [77.2, 28.6],
            ],
          }),
        ],
        visibility: { "osrm:0": true },
        compareStatus: "done",
      });
    });

    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [77.2, 12.9],
        [77.6, 28.6],
      ],
      expect.objectContaining({ padding: expect.any(Number) }),
    );
  });

  it("does not auto-fit on visibility toggle after a compare", () => {
    render(<MapView />);
    const map = lastMap();

    act(() => {
      useStore.setState({
        routes: [route({ id: "osrm:0" })],
        visibility: { "osrm:0": true },
        compareStatus: "done",
      });
    });
    map.fitBounds.mockClear();

    // Toggling visibility must not re-fit (routes identity + status unchanged).
    act(() => {
      useStore.setState({ visibility: { "osrm:0": false } });
    });

    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("fits to routes when requestFit is called and routes exist (Req 20.2)", () => {
    render(<MapView />);
    const map = lastMap();

    act(() => {
      useStore.setState({
        routes: [
          route({
            id: "osrm:0",
            coordinates: [
              [77.6, 12.9],
              [77.2, 28.6],
            ],
          }),
        ],
        visibility: { "osrm:0": true },
        compareStatus: "done",
      });
    });
    map.fitBounds.mockClear();

    act(() => {
      useStore.getState().requestFit();
    });

    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [77.2, 12.9],
        [77.6, 28.6],
      ],
      expect.objectContaining({ padding: expect.any(Number) }),
    );
  });

  it("fits to marker bounds when requestFit is called with no routes (Req 20.3)", () => {
    render(<MapView />);
    const map = lastMap();

    act(() => {
      useStore.setState({
        routes: [],
        start: { lat: 28.78, lon: 76.87 },
        dest: { lat: 28.2, lon: 77.45 },
      });
    });

    act(() => {
      useStore.getState().requestFit();
    });

    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [76.87, 28.2],
        [77.45, 28.78],
      ],
      expect.objectContaining({ padding: expect.any(Number) }),
    );
  });

  it("centers (easeTo) on a single marker when only one endpoint is set", () => {
    render(<MapView />);
    const map = lastMap();

    act(() => {
      useStore.setState({ routes: [], start: { lat: 28.6, lon: 77.2 }, dest: null });
    });

    act(() => {
      useStore.getState().requestFit();
    });

    expect(map.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [77.2, 28.6] }),
    );
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("does nothing on requestFit when there are no routes or markers", () => {
    render(<MapView />);
    const map = lastMap();

    act(() => {
      useStore.getState().requestFit();
    });

    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();
  });
});

describe("MapView initial view (Task 13.1, Req 20.5)", () => {
  beforeEach(() => {
    mapInstances = [];
    unsettleStyleWhenRoutesSourceIsAdded = false;
    debugQueryFeatures = [];
    styleLoaded = true;
    setDataSpy.mockClear();
    mapConstructorConfig = undefined;
    vi.clearAllMocks();
    useStore.setState({
      routes: [],
      visibility: {},
      selectedRouteId: null,
      start: null,
      dest: null,
      compareStatus: "idle",
      fitRequestId: 0,
      routeComparisonCamera: null,
      routeComparisonCameraResultRevision: null,
      comparisonResultRevision: 0,
    });
  });

  it("initializes the map centered on Delhi NCR at a default zoom when no coords/routes exist (Req 20.5)", () => {
    // No start/dest and no routes are seeded, so the map must fall back to its
    // Delhi NCR default view rather than fitting to anything. MapLibre uses
    // [lng, lat] order, so lon 77.209 comes before lat 28.6139.
    render(<MapView />);

    expect(mapConstructorConfig).toBeDefined();
    expect(mapConstructorConfig?.center).toEqual([77.209, 28.6139]);
    expect(typeof mapConstructorConfig?.zoom).toBe("number");
    // With nothing to frame, no camera fit is triggered on mount — the default
    // view stands.
    expect(lastMap().fitBounds).not.toHaveBeenCalled();
    expect(lastMap().easeTo).not.toHaveBeenCalled();
  });

  it("toggles a real pitched camera view and restores 2D", () => {
    render(<MapView />);
    const map = lastMap();

    fireEvent.click(screen.getByRole("button", { name: "Tilt map" }));
    expect(map.easeTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ pitch: 48, bearing: -18 }),
    );
    expect(screen.getByRole("button", { name: "2D view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "2D view" }));
    expect(map.easeTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ pitch: 0, bearing: 0 }),
    );
  });
});

describe("MapView camera persistence", () => {
  beforeEach(() => {
    mapInstances = [];
    styleLoaded = true;
    vi.clearAllMocks();
    useStore.setState({
      routes: [],
      visibility: {},
      selectedRouteId: null,
      start: null,
      dest: null,
      compareStatus: "idle",
      fitRequestId: 0,
      comparisonResultRevision: 0,
      routeComparisonCamera: null,
      routeComparisonCameraResultRevision: null,
      traceInspectorCamera: null,
      traceInspectorCameraResultRevision: null,
      traceResultRevision: 0,
    });
  });

  it("restores the exact settled camera on a same-result remount without refitting", () => {
    useStore.setState({
      routes: [route()],
      visibility: { "osrm:0": true },
      compareStatus: "done",
      comparisonResultRevision: 7,
    });
    const first = render(<MapView />);
    const firstMap = lastMap();
    const customCamera = {
      center: [77.321234, 28.612345] as [number, number],
      zoom: 16.75,
      bearing: -18,
      pitch: 48,
    };

    firstMap.camera = { ...customCamera };
    act(() => firstMap.emit("moveend"));
    expect(useStore.getState().routeComparisonCamera).toEqual(customCamera);
    first.unmount();

    render(<MapView />);
    const restoredMap = lastMap();
    expect(restoredMap.jumpTo).toHaveBeenCalledWith(customCamera);
    expect(restoredMap.fitBounds).not.toHaveBeenCalled();
  });

  it("fits a new comparison once instead of restoring the previous result camera", () => {
    useStore.setState({
      routes: [route()],
      visibility: { "osrm:0": true },
      compareStatus: "done",
      comparisonResultRevision: 2,
      routeComparisonCamera: {
        center: [12, 13],
        zoom: 17,
        bearing: 30,
        pitch: 40,
      },
      routeComparisonCameraResultRevision: 1,
    });

    render(<MapView />);
    const map = lastMap();
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.fitBounds).toHaveBeenCalledOnce();
  });

  it("persists the resulting camera after Fit Routes and keeps it through resize", () => {
    useStore.setState({
      routes: [route()],
      visibility: { "osrm:0": true },
      compareStatus: "done",
      comparisonResultRevision: 3,
    });
    render(<MapView />);
    const map = lastMap();
    act(() => {
      map.camera = {
        center: [77.4, 28.7],
        zoom: 12.5,
        bearing: 4,
        pitch: 9,
      };
      map.emit("moveend");
      useStore.getState().requestFit();
    });
    expect(map.fitBounds).toHaveBeenCalled();

    const fittedCamera = {
      center: [77.62, 12.93] as [number, number],
      zoom: 13.25,
      bearing: 0,
      pitch: 9,
    };
    act(() => {
      map.camera = { ...fittedCamera };
      map.emit("moveend");
    });
    expect(useStore.getState().routeComparisonCamera).toEqual(fittedCamera);

    act(() => useStore.getState().toggleLeftCollapsed());
    expect(useStore.getState().routeComparisonCamera).toEqual(fittedCamera);
  });

  it("persists pitch and bearing reset by the 2D control", () => {
    useStore.setState({
      comparisonResultRevision: 4,
      routeComparisonCameraResultRevision: 4,
      routeComparisonCamera: {
        center: [77.2, 28.6],
        zoom: 15,
        bearing: -18,
        pitch: 48,
      },
    });
    render(<MapView />);
    const map = lastMap();

    fireEvent.click(screen.getByRole("button", { name: "2D view" }));
    act(() => map.emit("moveend"));

    expect(useStore.getState().routeComparisonCamera).toEqual(
      expect.objectContaining({ pitch: 0, bearing: 0 }),
    );
  });

  it("keeps comparison and trace cameras completely independent", () => {
    const comparison = { center: [1, 2] as [number, number], zoom: 3, bearing: 4, pitch: 5 };
    const trace = { center: [6, 7] as [number, number], zoom: 8, bearing: 9, pitch: 10 };
    useStore.getState().setRouteComparisonCamera(comparison);
    expect(useStore.getState().traceInspectorCamera).toBeNull();
    useStore.getState().setTraceInspectorCamera(trace);
    expect(useStore.getState().routeComparisonCamera).toEqual(comparison);
    expect(useStore.getState().traceInspectorCamera).toEqual(trace);
  });
});

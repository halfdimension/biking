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
import { render, act } from "@testing-library/react";
import MapView from "./MapView";
import { useStore } from "../store";
import type { NormalizedRoute } from "../types";

// A single shared mock map instance so tests can inspect the calls MapView
// makes. getSource returns undefined until addSource is called, then a stub
// with a setData spy so the "routes changed" path exercises setData.
const setDataSpy = vi.fn();
let sourceCreated = false;
// Knob for the mock's `isStyleLoaded()`. Defaults to true; a regression test
// sets it false to reproduce the real-world condition where the style reports
// "not loaded" right after a source `setData`.
let styleLoaded = true;

interface MockMap {
  addSource: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  setFeatureState: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
  easeTo: ReturnType<typeof vi.fn>;
  jumpTo: ReturnType<typeof vi.fn>;
  getBounds: ReturnType<typeof vi.fn>;
}

// Module-level reference to the most recently constructed mock map so tests can
// inspect the calls MapView made against it.
let mapInstance: MockMap;
// The config object passed to the most recent `new maplibregl.Map(config)` call
// so a test can assert the initial camera (Delhi NCR default center, Req 20.5).
let mapConstructorConfig: { center?: [number, number]; zoom?: number } | undefined;

vi.mock("maplibre-gl", () => {
  class Map {
    on = vi.fn();
    off = vi.fn();
    once = vi.fn();
    addControl = vi.fn();
    remove = vi.fn();
    isStyleLoaded = vi.fn(() => styleLoaded);
    addSource = vi.fn(() => {
      sourceCreated = true;
    });
    getSource = vi.fn(() =>
      sourceCreated ? { setData: setDataSpy } : undefined,
    );
    addLayer = vi.fn();
    getLayer = vi.fn(() => undefined);
    setFeatureState = vi.fn();
    setPaintProperty = vi.fn();
    fitBounds = vi.fn();
    easeTo = vi.fn();
    jumpTo = vi.fn();
    getBounds = vi.fn();
    resize = vi.fn();
    getCanvas = vi.fn(() => ({ width: 800, height: 600 }));
    constructor(config?: { center?: [number, number]; zoom?: number }) {
      mapInstance = this as unknown as MockMap;
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

/** The most recently constructed mock Map instance. */
function lastMap(): MockMap {
  return mapInstance;
}

describe("MapView route rendering (Task 16)", () => {
  beforeEach(() => {
    sourceCreated = false;
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
});

describe("MapView fitting (Task 18.1, Req 20.1-20.3)", () => {
  beforeEach(() => {
    sourceCreated = false;
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
    sourceCreated = false;
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
});

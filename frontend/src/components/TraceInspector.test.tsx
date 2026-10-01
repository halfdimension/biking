import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TraceInspector from "./TraceInspector";
import { useStore } from "../store";
import type { CompareResponse, NormalizedRoute, ValhallaTraceResult } from "../types";

vi.mock("../api", () => ({
  compare: vi.fn(),
  osrmRaw: vi.fn(),
  valhallaRaw: vi.fn(),
  curlImport: vi.fn(),
  health: vi.fn(),
  valhallaTrace: vi.fn(),
}));

vi.mock("maplibre-gl", () => {
  class Map {
    on = vi.fn();
    off = vi.fn();
    once = vi.fn();
    addControl = vi.fn();
    remove = vi.fn();
    addSource = vi.fn();
    getSource = vi.fn();
    addLayer = vi.fn();
    getLayer = vi.fn();
    setFeatureState = vi.fn();
    queryRenderedFeatures = vi.fn(() => []);
    isStyleLoaded = vi.fn(() => true);
    fitBounds = vi.fn();
    easeTo = vi.fn();
    resize = vi.fn();
  }
  class NavigationControl {}
  return { default: { Map, NavigationControl } };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

import * as api from "../api";

function route(index = 0): NormalizedRoute {
  return {
    id: `osrm:${index}`,
    engine: "osrm",
    index,
    isPrimary: index === 0,
    label: index === 0 ? "OSRM Primary" : `OSRM Alt ${index}`,
    coordinates: [[77, 28], [77.1 + index * 0.01, 28.1]],
    distanceMeters: 1000,
    durationSeconds: 100,
    cost: 100,
    raw: { geometry: `encoded-${index}` },
  };
}

function comparison(routes = [route(0), route(1)]): CompareResponse {
  return {
    osrm: {
      engine: "osrm",
      status: "ok",
      httpStatus: 200,
      durationMs: 2,
      normalizedRoutes: routes,
      raw: {},
      warnings: [],
      error: null,
    },
    valhalla: {
      engine: "valhalla",
      status: "ok",
      httpStatus: 200,
      durationMs: 2,
      normalizedRoutes: [],
      raw: {},
      warnings: [],
      error: null,
    },
  };
}

function traceResult(sourceRouteId = "osrm:0"): ValhallaTraceResult {
  return {
    status: "ok",
    sourceRouteId,
    originalGeometry: [[77, 28], [77.1, 28.1]],
    traceGeometry: [[77, 28], [77.11, 28.11], [77.1, 28.1]],
    exactGeometryMatch: false,
    originalPointCount: 2,
    tracePointCount: 3,
    geometryDeviation: null,
    segments: [],
    warnings: [{
      kind: "geometry_changed",
      message: "Valhalla map_snap changed the source geometry.",
    }],
    errors: [],
    httpStatus: 200,
    durationMs: 4,
  };
}

describe("TraceInspector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      results: null,
      routes: [],
      selectedRouteId: null,
      traceSourceRouteId: null,
      traceSourceEncodedPolyline: null,
      traceStatus: "idle",
      traceResult: null,
      traceError: null,
      traceHoveredSegmentIds: [],
      traceHoveredPoint: null,
      tracePinnedSegmentIds: [],
      tracePinnedPoint: null,
      traceInspectorPinned: false,
      traceFitRequestId: 0,
    });
  });

  it("asks for a comparison when no OSRM route exists", () => {
    render(<TraceInspector />);
    expect(screen.getByText("Run a route comparison first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run Valhalla Trace" })).toBeDisabled();
  });

  it("populates the OSRM source selector and selects an alternate independently", async () => {
    act(() => useStore.setState({ results: comparison() }));
    render(<TraceInspector />);

    const selector = screen.getByRole("combobox", { name: "Route" });
    expect(within(selector).getByRole("option", { name: "OSRM Primary" })).toBeInTheDocument();
    expect(within(selector).getByRole("option", { name: "OSRM Alt 1" })).toBeInTheDocument();

    fireEvent.change(selector, { target: { value: "osrm:1" } });
    expect(useStore.getState().traceSourceRouteId).toBe("osrm:1");
    expect(useStore.getState().selectedRouteId).toBeNull();
  });

  it("runs the selected route, sends its preserved polyline, and shows changed geometry", async () => {
    vi.mocked(api.valhallaTrace).mockResolvedValue(traceResult());
    act(() => useStore.setState({
      results: comparison(),
      traceSourceRouteId: "osrm:0",
      selectedRouteId: "osrm:1",
    }));
    render(<TraceInspector />);

    fireEvent.click(screen.getByRole("button", { name: "Run Valhalla Trace" }));

    await waitFor(() => expect(api.valhallaTrace).toHaveBeenCalledWith("osrm:0", "encoded-0"));
    expect(await screen.findByText("Valhalla map_snap changed the source geometry.")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
    expect(useStore.getState().selectedRouteId).toBe("osrm:1");
    expect(screen.getByTestId("trace-map")).toBeInTheDocument();
    expect(screen.getByText("Original OSRM")).toBeInTheDocument();
    expect(screen.getByText("Valhalla map-match")).toBeInTheDocument();
  });

  it("surfaces structured trace errors without changing comparison results", async () => {
    const before = comparison([route(0)]);
    vi.mocked(api.valhallaTrace).mockResolvedValue({
      ...traceResult(),
      status: "error",
      traceGeometry: [],
      tracePointCount: 0,
      warnings: [],
      errors: [{ kind: "unreachable", message: "Valhalla is unavailable." }],
    });
    act(() => useStore.setState({
      results: before,
      traceSourceRouteId: "osrm:0",
    }));
    render(<TraceInspector />);

    fireEvent.click(screen.getByRole("button", { name: "Run Valhalla Trace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Valhalla is unavailable.");
    expect(useStore.getState().results).toBe(before);
  });
});

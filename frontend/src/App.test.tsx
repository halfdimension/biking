/**
 * Layout shell tests (Task 12.1, Req 15).
 *
 * Asserts the dashboard renders the toolbar title, a Compare Routes button, the
 * map placeholder, and all six bottom-tab labels, and that clicking a different
 * bottom tab switches the visible panel. The api module is mocked so the store's
 * `runCompare`/`refreshHealth` never hit the network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
  act,
} from "@testing-library/react";
import App from "./App";
import { useStore } from "./store";
import type { CompareDebug, NormalizedRoute } from "./types";

vi.mock("./api", () => ({
  API_BASE_URL: "http://localhost:8000",
  compare: vi.fn(),
  osrmRaw: vi.fn(),
  valhallaRaw: vi.fn(),
  curlImport: vi.fn(),
  health: vi.fn().mockResolvedValue({ osrm: "unknown", valhalla: "unknown" }),
}));

// MapLibre GL does not run under jsdom; mock it so the full-App render (which
// mounts MapView) does not crash (Task 13).
vi.mock("maplibre-gl", () => {
  class Map {
    on = vi.fn();
    off = vi.fn();
    once = vi.fn();
    addControl = vi.fn();
    remove = vi.fn();
    addSource = vi.fn();
    addLayer = vi.fn();
    getSource = vi.fn();
    getLayer = vi.fn();
    setData = vi.fn();
    setFeatureState = vi.fn();
    setPaintProperty = vi.fn();
    fitBounds = vi.fn();
    easeTo = vi.fn();
    jumpTo = vi.fn();
    getBounds = vi.fn();
    isStyleLoaded = vi.fn().mockReturnValue(true);
    resize = vi.fn();
    getCanvas = vi.fn(() => ({ width: 800, height: 600 }));
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

import * as api from "./api";

/**
 * Render the app and let the on-mount `refreshHealth` probe settle so the
 * resulting store update happens inside React's act() scope, keeping the tests
 * warning-free.
 */
async function renderApp() {
  const utils = render(<App />);
  await waitFor(() => expect(api.health).toHaveBeenCalled());
  return utils;
}

describe("App layout shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the toolbar title", async () => {
    await renderApp();
    expect(
      screen.getByText(/Bike Routing Comparison & Debugging Dashboard/i),
    ).toBeInTheDocument();
  });

  it("renders a Compare Routes button", async () => {
    await renderApp();
    expect(
      screen.getByRole("button", { name: /Compare Routes/i }),
    ).toBeInTheDocument();
  });

  it("renders the map placeholder region", async () => {
    await renderApp();
    expect(screen.getByTestId("map-view")).toBeInTheDocument();
  });

  it("renders all seven bottom tab labels", async () => {
    await renderApp();
    const tablist = screen.getByRole("tablist", { name: /Analysis panels/i });
    const labels = [
      "Comparison",
      "Edge Details",
      "OSRM Raw Request",
      "OSRM Response",
      "Valhalla Raw Request",
      "Valhalla Response",
      "Assessment",
    ];
    for (const label of labels) {
      expect(
        within(tablist).getByRole("tab", { name: label }),
      ).toBeInTheDocument();
    }
  });

  it("switches the visible panel when a different bottom tab is clicked", async () => {
    await renderApp();
    const panel = screen.getByTestId("bottom-tab-panel");
    // Default active tab is Comparison, which renders the comparison table.
    // With no routes yet it shows the empty-state hint.
    expect(panel).toHaveTextContent(/No routes yet/i);

    // Switch to the Assessment tab: it renders its own empty-state hint
    // ("run Compare to assess routes") distinct from the Comparison table.
    fireEvent.click(screen.getByRole("tab", { name: "Assessment" }));
    expect(panel).toHaveTextContent(/run Compare to assess routes/i);
  });

  it("keeps the right sidebar focused on route controls", async () => {
    await renderApp();
    const sidebar = screen.getByLabelText("Routes");
    expect(within(sidebar).getByText("Engine Status")).toBeInTheDocument();
    expect(within(sidebar).getByText("Visibility Controls")).toBeInTheDocument();
    expect(within(sidebar).queryByText("Pinned edge details")).not.toBeInTheDocument();
  });

  it("stays fully usable when an engine reports unreachable (Req 16.5)", async () => {
    await renderApp();

    // Simulate a health probe result where one engine is unreachable and the
    // other reachable — the backend classifies reachability; the frontend only
    // surfaces it and must NOT block the app on an unreachable engine.
    act(() => {
      useStore.setState({
        health: { osrm: "unreachable", valhalla: "reachable" },
      });
    });

    // The unreachable status is surfaced to the user...
    const osrmDot = screen.getByTestId("health-dot-osrm");
    expect(osrmDot.className).toContain("health-dot--unreachable");
    expect(
      screen.getByTitle(/OSRM: unreachable/i),
    ).toBeInTheDocument();

    // ...but the app remains fully usable: the map, the Compare button, and the
    // analysis tabs are all still present and interactive (not gated).
    expect(screen.getByTestId("map-view")).toBeInTheDocument();
    const compareBtn = screen.getByRole("button", { name: /Compare Routes/i });
    expect(compareBtn).toBeInTheDocument();
    expect(compareBtn).not.toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "Assessment" }));
    expect(screen.getByTestId("bottom-tab-panel")).toHaveTextContent(
      /run Compare to assess routes/i,
    );
  });

  it("preserves comparison/debug state through repeated navigation without rerunning compare", async () => {
    const preservedRoute: NormalizedRoute = {
      id: "osrm:0",
      engine: "osrm",
      index: 0,
      isPrimary: true,
      label: "OSRM Primary",
      coordinates: [[77.2, 28.6], [77.21, 28.61]],
      distanceMeters: 100,
      durationSeconds: 60,
      cost: 10,
      raw: {},
    };
    const preservedDebug = {
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
    useStore.setState({
      routes: [preservedRoute],
      visibility: { "osrm:0": true },
      selectedRouteId: "osrm:0",
      debugResults: preservedDebug,
      edgeDebugEnabled: true,
      compareStatus: "done",
    });
    await renderApp();
    const navigation = screen.getByRole("navigation", { name: "Dashboard screens" });

    for (let roundTrip = 0; roundTrip < 3; roundTrip += 1) {
      fireEvent.click(within(navigation).getByRole("button", { name: "Trace Inspector" }));
      fireEvent.click(within(navigation).getByRole("button", { name: "Route Comparison" }));
    }

    const state = useStore.getState();
    expect(state.routes).toEqual([preservedRoute]);
    expect(state.debugResults).toBe(preservedDebug);
    expect(state.visibility).toEqual({ "osrm:0": true });
    expect(state.selectedRouteId).toBe("osrm:0");
    expect(state.edgeDebugEnabled).toBe(true);
    expect(screen.getByRole("button", { name: "Edge Debug: ON" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(api.compare).not.toHaveBeenCalled();
  });

  it("keeps Edge Debug OFF through a navigation round trip", async () => {
    useStore.setState({ edgeDebugEnabled: false });
    await renderApp();
    const navigation = screen.getByRole("navigation", { name: "Dashboard screens" });
    fireEvent.click(within(navigation).getByRole("button", { name: "Trace Inspector" }));
    fireEvent.click(within(navigation).getByRole("button", { name: "Route Comparison" }));

    expect(useStore.getState().edgeDebugEnabled).toBe(false);
    expect(screen.getByRole("button", { name: "Edge Debug: OFF" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(api.compare).not.toHaveBeenCalled();
  });

  it("switches to Trace Inspector and back without a page reload", async () => {
    await renderApp();
    const navigation = screen.getByRole("navigation", { name: "Dashboard screens" });

    fireEvent.click(within(navigation).getByRole("button", { name: "Trace Inspector" }));
    expect(screen.getByRole("main", { name: "Trace Inspector" })).toBeInTheDocument();
    expect(screen.getByText("Run a route comparison first.")).toBeInTheDocument();
    expect(screen.queryByTestId("map-view")).not.toBeInTheDocument();

    fireEvent.click(within(navigation).getByRole("button", { name: "Route Comparison" }));
    expect(screen.getByTestId("map-view")).toBeInTheDocument();
  });
});

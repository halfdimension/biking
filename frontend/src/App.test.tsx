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

  it("renders all six bottom tab labels", async () => {
    await renderApp();
    const tablist = screen.getByRole("tablist", { name: /Analysis panels/i });
    const labels = [
      "Comparison",
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
});

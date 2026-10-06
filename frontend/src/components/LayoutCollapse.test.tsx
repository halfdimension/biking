/**
 * Collapsible layout panels + Focus Map tests (UI-only refinement).
 *
 * Covers the left/right/bottom collapse toggles (class + aria-expanded), the
 * bottom panel keeping its LOCAL active-tab across collapse/expand (proving
 * BottomTabs stays mounted), the Focus Map two-state toggle (from all-expanded
 * and from a mixed prior state), that `map.resize()` fires after a layout
 * change, and that application state (selection/coordinates) survives a
 * collapse/expand. The api module and MapLibre are mocked exactly as in
 * App.test.tsx / MapView.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import App from "../App";
import MapView from "./MapView";
import { useStore } from "../store";

vi.mock("../api", () => ({
  API_BASE_URL: "http://localhost:8000",
  compare: vi.fn(),
  osrmRaw: vi.fn(),
  valhallaRaw: vi.fn(),
  curlImport: vi.fn(),
  health: vi.fn().mockResolvedValue({ osrm: "unknown", valhalla: "unknown" }),
}));

// A shared spy on the mock map's resize so tests can assert it is called after
// a layout change.
const resizeSpy = vi.fn();
class TestPointerEvent extends MouseEvent {
  pointerId: number;

  constructor(
    type: string,
    init: MouseEventInit & { pointerId?: number } = {},
  ) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

Object.defineProperty(window, "PointerEvent", {
  configurable: true,
  value: TestPointerEvent,
});

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
    resize = resizeSpy;
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

import * as api from "./../api";

/** Render App and let the on-mount health probe settle inside act(). */
async function renderApp() {
  const utils = render(<App />);
  await waitFor(() => expect(api.health).toHaveBeenCalled());
  return utils;
}

function domRect(height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 1000,
    height,
    top: 0,
    right: 1000,
    bottom: height,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function mockComparisonWorkspaceHeight(initialHeight: number) {
  const workspace = document.querySelector(
    ".comparison-workspace",
  ) as HTMLDivElement;
  let workspaceHeight = initialHeight;
  Object.defineProperty(workspace, "getBoundingClientRect", {
    configurable: true,
    value: () => domRect(workspaceHeight),
  });
  fireEvent(window, new Event("resize"));
  return {
    workspace,
    setWorkspaceHeight: (height: number) => {
      workspaceHeight = height;
      fireEvent(window, new Event("resize"));
    },
  };
}

/** Reset the layout slice to all-expanded before each test. */
function resetLayout() {
  act(() => {
    useStore.setState({
      leftCollapsed: false,
      rightCollapsed: false,
      bottomCollapsed: false,
      routeComparisonPanelHeight: 280,
      mapFocused: false,
      layoutSnapshot: null,
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resizeSpy.mockClear();
  localStorage.clear();
  resetLayout();
});

describe("Left sidebar collapse", () => {
  it("toggles the collapsed class and aria-expanded on the control", async () => {
    await renderApp();
    const btn = screen.getByTestId("collapse-left");
    const aside = screen.getByLabelText("Controls");

    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(aside.className).not.toContain("left-sidebar--collapsed");

    fireEvent.click(btn);
    expect(screen.getByTestId("collapse-left")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByLabelText("Controls").className).toContain(
      "left-sidebar--collapsed",
    );

    // Expand again.
    fireEvent.click(screen.getByTestId("collapse-left"));
    expect(screen.getByTestId("collapse-left")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByLabelText("Controls").className).not.toContain(
      "left-sidebar--collapsed",
    );
  });
});

describe("Right sidebar collapse", () => {
  it("toggles the collapsed class and aria-expanded on the control", async () => {
    await renderApp();
    const btn = screen.getByTestId("collapse-right");
    const aside = screen.getByLabelText("Routes");

    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(aside.className).not.toContain("right-sidebar--collapsed");

    fireEvent.click(btn);
    expect(screen.getByTestId("collapse-right")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByLabelText("Routes").className).toContain(
      "right-sidebar--collapsed",
    );

    fireEvent.click(screen.getByTestId("collapse-right"));
    expect(screen.getByTestId("collapse-right")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByLabelText("Routes").className).not.toContain(
      "right-sidebar--collapsed",
    );
  });
});

describe("Bottom panel collapse", () => {
  it("toggles collapsed state and preserves the active tab across collapse/expand", async () => {
    await renderApp();

    // Switch to a NON-default tab first (default is Comparison).
    fireEvent.click(screen.getByRole("tab", { name: "Assessment" }));
    const panel = screen.getByTestId("bottom-tab-panel");
    expect(panel).toHaveTextContent(/run Compare to assess routes/i);

    const btn = screen.getByTestId("collapse-bottom");
    expect(btn).toHaveAttribute("aria-expanded", "true");

    // Collapse: body is hidden via CSS but the component stays mounted, so the
    // Assessment tab remains selected and its content stays in the DOM.
    fireEvent.click(btn);
    expect(screen.getByTestId("collapse-bottom")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(useStore.getState().bottomCollapsed).toBe(true);
    expect(
      screen.getByRole("tab", { name: "Assessment" }),
    ).toHaveAttribute("aria-selected", "true");

    // Expand: the last-selected (Assessment) tab is still shown.
    fireEvent.click(screen.getByTestId("collapse-bottom"));
    expect(screen.getByTestId("collapse-bottom")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByTestId("bottom-tab-panel")).toHaveTextContent(
      /run Compare to assess routes/i,
    );
  });
});

describe("Bottom panel resize", () => {
  it("resizes from the keyboard and preserves the height across collapse", async () => {
    await renderApp();
    const handle = screen.getByRole("separator", { name: "Resize bottom panel" });
    expect(handle).toHaveAttribute("aria-valuenow", "280");

    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(screen.getByRole("separator", { name: "Resize bottom panel" }))
      .toHaveAttribute("aria-valuenow", "304");

    fireEvent.click(screen.getByTestId("collapse-bottom"));
    expect(screen.queryByRole("separator", { name: "Resize bottom panel" }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("collapse-bottom"));
    expect(screen.getByRole("separator", { name: "Resize bottom panel" }))
      .toHaveAttribute("aria-valuenow", "304");
  });

  it("drags beyond the old caps up to the 48px structural map reserve", async () => {
    await renderApp();
    const { workspace } = mockComparisonWorkspaceHeight(900);
    const handle = screen.getByRole("separator", { name: "Resize bottom panel" });

    expect(handle).toHaveAttribute("aria-valuemax", "852");
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: -1000 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: -1000 });

    expect(workspace.querySelector<HTMLElement>(".bottom-tabs")?.style.height)
      .toBe("852px");
    expect(useStore.getState().routeComparisonPanelHeight).toBe(852);
    expect(852).toBeGreaterThan(520);
    expect(852).toBeGreaterThan(900 * 0.58);

    fireEvent.pointerDown(handle, { pointerId: 2, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientY: 2000 });
    fireEvent.pointerUp(handle, { pointerId: 2, clientY: 2000 });
    expect(useStore.getState().routeComparisonPanelHeight).toBe(180);
    expect(api.compare).not.toHaveBeenCalled();
  });

  it("clamps only the live height on shrink and restores the preference on regrow", async () => {
    useStore.setState({ routeComparisonPanelHeight: 700 });
    await renderApp();
    const layout = mockComparisonWorkspaceHeight(900);
    const panel = layout.workspace.querySelector<HTMLElement>(".bottom-tabs");
    expect(panel?.style.height).toBe("700px");

    layout.setWorkspaceHeight(500);
    expect(panel?.style.height).toBe("452px");
    expect(useStore.getState().routeComparisonPanelHeight).toBe(700);

    layout.setWorkspaceHeight(900);
    expect(panel?.style.height).toBe("700px");
    expect(useStore.getState().routeComparisonPanelHeight).toBe(700);
  });

  it("keeps the comparison preference through collapse, pin-open, and navigation", async () => {
    useStore.setState({ routeComparisonPanelHeight: 700 });
    await renderApp();
    mockComparisonWorkspaceHeight(900);

    fireEvent.click(screen.getByTestId("collapse-bottom"));
    act(() => {
      useStore.setState((state) => ({
        edgeDetailsOpenRequestId: state.edgeDetailsOpenRequestId + 1,
      }));
    });
    expect(useStore.getState().bottomCollapsed).toBe(false);
    expect(useStore.getState().routeComparisonPanelHeight).toBe(700);
    expect(screen.getByRole("separator", { name: "Resize bottom panel" }))
      .toHaveAttribute("aria-valuenow", "700");

    fireEvent.click(screen.getByRole("button", { name: "Trace Inspector" }));
    fireEvent.click(screen.getByRole("button", { name: "Route Comparison" }));
    mockComparisonWorkspaceHeight(900);
    expect(screen.getByRole("separator", { name: "Resize bottom panel" }))
      .toHaveAttribute("aria-valuenow", "700");
  });

  it("keeps the comparison height session-only", () => {
    useStore.getState().setRouteComparisonPanelHeight(640);
    expect(useStore.getState().routeComparisonPanelHeight).toBe(640);
    expect(localStorage.getItem("biking.layout.v1")).toBeNull();
  });
});

describe("Focus Map", () => {
  it("first click collapses all three; second click restores all-expanded", async () => {
    useStore.setState({ routeComparisonPanelHeight: 700 });
    await renderApp();
    const btn = screen.getByTestId("focus-map");

    // From all-expanded.
    fireEvent.click(btn);
    let s = useStore.getState();
    expect(s.leftCollapsed).toBe(true);
    expect(s.rightCollapsed).toBe(true);
    expect(s.bottomCollapsed).toBe(true);
    expect(s.mapFocused).toBe(true);

    // Second click restores the prior all-expanded states exactly.
    fireEvent.click(screen.getByTestId("focus-map"));
    s = useStore.getState();
    expect(s.leftCollapsed).toBe(false);
    expect(s.rightCollapsed).toBe(false);
    expect(s.bottomCollapsed).toBe(false);
    expect(s.mapFocused).toBe(false);
    expect(s.routeComparisonPanelHeight).toBe(700);
    expect(s.layoutSnapshot).toBeNull();
  });

  it("restores a MIXED prior state (left already collapsed) after on/off", async () => {
    await renderApp();
    // Seed a mixed prior state: left collapsed, right/bottom expanded.
    act(() => {
      useStore.setState({
        leftCollapsed: true,
        rightCollapsed: false,
        bottomCollapsed: false,
      });
    });

    fireEvent.click(screen.getByTestId("focus-map"));
    let s = useStore.getState();
    expect(s.leftCollapsed).toBe(true);
    expect(s.rightCollapsed).toBe(true);
    expect(s.bottomCollapsed).toBe(true);

    fireEvent.click(screen.getByTestId("focus-map"));
    s = useStore.getState();
    // Exact prior states restored: left collapsed, others expanded.
    expect(s.leftCollapsed).toBe(true);
    expect(s.rightCollapsed).toBe(false);
    expect(s.bottomCollapsed).toBe(false);
    expect(s.mapFocused).toBe(false);
  });
});

describe("MapView resize on layout change", () => {
  it("calls map.resize() after a collapse toggle (rAF + timeout)", () => {
    vi.useFakeTimers();
    try {
      render(<MapView />);
      resizeSpy.mockClear();

      act(() => {
        useStore.setState({ leftCollapsed: true });
      });

      // Advance the requestAnimationFrame + the ~200ms settle timeout.
      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(resizeSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Application state survives collapse/expand", () => {
  it("keeps selectedRouteId and coordinates unchanged across a collapse cycle", async () => {
    await renderApp();
    act(() => {
      useStore.setState({
        selectedRouteId: "osrm:1",
        start: { lat: 28.6, lon: 77.2 },
      });
    });

    // Collapse then expand each panel.
    fireEvent.click(screen.getByTestId("collapse-left"));
    fireEvent.click(screen.getByTestId("collapse-left"));
    fireEvent.click(screen.getByTestId("collapse-right"));
    fireEvent.click(screen.getByTestId("collapse-bottom"));

    const s = useStore.getState();
    expect(s.selectedRouteId).toBe("osrm:1");
    expect(s.start).toEqual({ lat: 28.6, lon: 77.2 });
  });
});

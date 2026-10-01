import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TraceInspector from "./TraceInspector";
import { useStore } from "../store";
import type {
  CompareResponse,
  NormalizedRoute,
  ValhallaDebugSegment,
  ValhallaTraceResult,
} from "../types";

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
    getSource = vi.fn();
    addLayer = vi.fn();
    getLayer = vi.fn();
    setFeatureState = vi.fn();
    queryRenderedFeatures = vi.fn(() => []);
    isStyleLoaded = vi.fn(() => true);
    fitBounds = vi.fn();
    easeTo = vi.fn();
    resize = resizeSpy;
  }
  class NavigationControl {}
  return { default: { Map, NavigationControl } };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

const route: NormalizedRoute = {
  id: "osrm:0",
  engine: "osrm",
  index: 0,
  isPrimary: true,
  label: "OSRM Primary",
  coordinates: [[77, 28], [77.1, 28.1]],
  distanceMeters: 1000,
  durationSeconds: 100,
  cost: 100,
  raw: { geometry: "encoded" },
};

const comparison: CompareResponse = {
  osrm: {
    engine: "osrm",
    status: "ok",
    httpStatus: 200,
    durationMs: 1,
    normalizedRoutes: [route],
    raw: {},
    warnings: [],
    error: null,
  },
  valhalla: {
    engine: "valhalla",
    status: "ok",
    httpStatus: 200,
    durationMs: 1,
    normalizedRoutes: [],
    raw: {},
    warnings: [],
    error: null,
  },
};

const cost = {
  elapsedCost: { seconds: 1, cost: 2 },
  transitionCost: { seconds: 0, cost: 0 },
};

function segment(id: string, index: number): ValhallaDebugSegment {
  return {
    id,
    engine: "valhalla",
    routeId: "trace:osrm:0",
    routeIndex: 0,
    legIndex: 0,
    segmentIndex: index,
    coordinates: [[77 + index * 0.01, 28], [77.01 + index * 0.01, 28.01]],
    properties: {
      id: index === 0 ? "edge-a" : "edge-b",
      wayId: "way-" + index,
      name: ["Trace Road " + index],
      lengthKm: 0.1,
      speed: 35,
      roadClass: "trunk",
      beginShapeIndex: index,
      endShapeIndex: index + 1,
      traversability: "both",
      use: "road",
      toll: false,
      unpaved: false,
      tunnel: false,
      bridge: false,
      roundabout: false,
      surface: "paved_smooth",
      density: 10,
      speedLimit: 40,
      defaultSpeed: 35,
      sourceAlongEdge: 0,
      targetAlongEdge: 1,
      spdLmt: 40,
      spdLmtHgv: 35,
      spdLmtBike: 20,
      frc: 2,
      tollRoad: 0,
      bikeSpeed: 20,
      nodeCost: cost,
      sourceNodeCost: cost,
      targetNodeCost: null,
    },
  };
}

const first = segment("trace:osrm:0:0", 0);
const second = segment("trace:osrm:0:1", 1);

const traceResult: ValhallaTraceResult = {
  status: "ok",
  sourceRouteId: route.id,
  originalGeometry: route.coordinates,
  traceGeometry: route.coordinates,
  exactGeometryMatch: true,
  originalPointCount: 2,
  tracePointCount: 2,
  geometryDeviation: null,
  segments: [first, second],
  warnings: [],
  errors: [],
  httpStatus: 200,
  durationMs: 1,
};

function seedTraceDrawer(overrides: Record<string, unknown> = {}) {
  useStore.setState({
    results: comparison,
    routes: [route],
    traceSourceRouteId: route.id,
    traceSourceEncodedPolyline: "encoded",
    traceStatus: "done",
    traceResult,
    traceError: null,
    traceHoveredSegmentIds: [],
    traceHoveredPoint: null,
    tracePinnedSegmentIds: [],
    tracePinnedPoint: null,
    traceInspectorPinned: false,
    traceDetailsCollapsed: true,
    traceDetailsExpandedHeight: 180,
    traceFitRequestId: 0,
    ...overrides,
  });
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

function mockTraceWorkspaceHeight(initialHeight: number) {
  const workspace = document.querySelector(".trace-workspace") as HTMLDivElement;
  const details = document.querySelector(".trace-details") as HTMLElement;
  let workspaceHeight = initialHeight;
  Object.defineProperty(workspace, "getBoundingClientRect", {
    configurable: true,
    value: () => domRect(workspaceHeight),
  });
  Object.defineProperty(details, "getBoundingClientRect", {
    configurable: true,
    value: () => {
      const match = workspace.style.gridTemplateRows.match(/([\d.]+)px$/);
      return domRect(match ? Number(match[1]) : 180);
    },
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

describe("Trace Inspector pinned-details drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedTraceDrawer();
  });

  it("expands on pin, preserves data while collapsed, and reopens for a new pin", () => {
    render(<TraceInspector />);

    act(() => {
      useStore.getState().setTraceHoveredSegmentIds(
        [first.id, second.id],
        [77.01, 28.01],
      );
      useStore.getState().pinTraceHoveredSegments();
    });

    let toggle = screen.getByRole("button", {
      name: "Collapse pinned trace edge details",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("2 segments")).toBeVisible();
    expect(screen.getByTestId("trace-edge-details-body")).toBeVisible();

    fireEvent.click(toggle);
    toggle = screen.getByRole("button", {
      name: "Expand pinned trace edge details",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("2 segments")).toBeVisible();
    expect(screen.getByTestId("trace-edge-details-body")).not.toBeVisible();
    expect(screen.getAllByText("Advanced")[0]).not.toBeVisible();
    expect(useStore.getState().tracePinnedSegmentIds).toEqual([
      first.id,
      second.id,
    ]);

    act(() => {
      useStore.getState().setTraceHoveredSegmentIds([second.id], [77.02, 28.02]);
    });
    expect(screen.getByRole("button", {
      name: "Expand pinned trace edge details",
    })).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(screen.getByRole("button", {
      name: "Collapse pinned trace edge details",
    })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("edge-a")).toBeVisible();

    fireEvent.click(screen.getByRole("button", {
      name: "Collapse pinned trace edge details",
    }));
    act(() => {
      useStore.getState().pinTraceHoveredSegments();
    });
    expect(screen.getByRole("button", {
      name: "Collapse pinned trace edge details",
    })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("1 segment")).toBeVisible();
    expect(screen.getAllByText("edge-b").some((item) => item.offsetParent !== null || !item.closest("[hidden]"))).toBe(true);

    fireEvent.click(screen.getByRole("button", {
      name: "Collapse pinned trace edge details",
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "Unpin / Clear Details",
    }));
    expect(useStore.getState().traceInspectorPinned).toBe(false);
    expect(useStore.getState().tracePinnedSegmentIds).toEqual([]);
    expect(screen.getByText("No pinned edge")).toBeVisible();
  });

  it("preserves collapsed presentation and pinned segments across a remount", () => {
    seedTraceDrawer({
      tracePinnedSegmentIds: [first.id],
      tracePinnedPoint: [77.01, 28.01],
      traceInspectorPinned: true,
      traceDetailsCollapsed: true,
    });

    const firstRender = render(<TraceInspector />);
    expect(screen.getByRole("button", {
      name: "Expand pinned trace edge details",
    })).toHaveAttribute("aria-expanded", "false");
    firstRender.unmount();

    render(<TraceInspector />);
    expect(screen.getByRole("button", {
      name: "Expand pinned trace edge details",
    })).toHaveAttribute("aria-expanded", "false");
    expect(useStore.getState().tracePinnedSegmentIds).toEqual([first.id]);
  });

  it("resizes TraceMap immediately and after the drawer transition", () => {
    vi.useFakeTimers();
    try {
      seedTraceDrawer({
        tracePinnedSegmentIds: [first.id],
        tracePinnedPoint: [77.01, 28.01],
        traceInspectorPinned: true,
        traceDetailsCollapsed: false,
      });
      render(<TraceInspector />);
      act(() => vi.runOnlyPendingTimers());
      resizeSpy.mockClear();

      fireEvent.click(screen.getByRole("button", {
        name: "Collapse pinned trace edge details",
      }));
      act(() => vi.runOnlyPendingTimers());

      expect(resizeSpy).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it("uses the 180px default and resizes upward and downward without changing pins", () => {
    seedTraceDrawer({
      tracePinnedSegmentIds: [first.id, second.id],
      tracePinnedPoint: [77.01, 28.01],
      traceInspectorPinned: true,
      traceDetailsCollapsed: false,
    });
    render(<TraceInspector />);
    const { workspace } = mockTraceWorkspaceHeight(600);
    const handle = screen.getByRole("separator", {
      name: "Resize pinned trace edge details",
    });

    expect(workspace.style.gridTemplateRows).toContain("180px");
    expect(handle).toHaveAttribute("aria-valuenow", "180");

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 400 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 300 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 300 });
    expect(workspace.style.gridTemplateRows).toContain("280px");
    expect(useStore.getState().traceDetailsExpandedHeight).toBe(280);

    fireEvent.pointerDown(handle, { pointerId: 2, clientY: 400 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientY: 440 });
    fireEvent.pointerUp(handle, { pointerId: 2, clientY: 440 });
    expect(workspace.style.gridTemplateRows).toContain("240px");
    expect(useStore.getState().tracePinnedSegmentIds).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("enforces the responsive minimum and maximum pointer-drag heights", () => {
    seedTraceDrawer({
      tracePinnedSegmentIds: [first.id],
      tracePinnedPoint: [77.01, 28.01],
      traceInspectorPinned: true,
      traceDetailsCollapsed: false,
    });
    render(<TraceInspector />);
    const { workspace } = mockTraceWorkspaceHeight(600);
    const handle = screen.getByRole("separator", {
      name: "Resize pinned trace edge details",
    });

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 400 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 1400 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 1400 });
    expect(workspace.style.gridTemplateRows).toContain("140px");

    fireEvent.pointerDown(handle, { pointerId: 2, clientY: 400 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientY: -1000 });
    fireEvent.pointerUp(handle, { pointerId: 2, clientY: -1000 });
    // min(65% of 600, 600 - 240px reserved map) = 360px.
    expect(workspace.style.gridTemplateRows).toContain("360px");
    expect(useStore.getState().traceDetailsExpandedHeight).toBe(360);
  });

  it("collapses to the compact row and restores the last manually selected height", () => {
    seedTraceDrawer({
      tracePinnedSegmentIds: [first.id],
      tracePinnedPoint: [77.01, 28.01],
      traceInspectorPinned: true,
      traceDetailsCollapsed: false,
    });
    render(<TraceInspector />);
    const { workspace } = mockTraceWorkspaceHeight(600);
    const handle = screen.getByRole("separator", {
      name: "Resize pinned trace edge details",
    });
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 400 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 280 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 280 });
    expect(useStore.getState().traceDetailsExpandedHeight).toBe(300);

    fireEvent.click(screen.getByRole("button", {
      name: "Collapse pinned trace edge details",
    }));
    expect(workspace).toHaveClass("trace-workspace--details-compact");
    expect(screen.queryByRole("separator", {
      name: "Resize pinned trace edge details",
    })).not.toBeInTheDocument();
    expect(useStore.getState().traceDetailsExpandedHeight).toBe(300);

    fireEvent.click(screen.getByRole("button", {
      name: "Expand pinned trace edge details",
    }));
    expect(workspace.style.gridTemplateRows).toContain("300px");
    expect(screen.getByRole("separator", {
      name: "Resize pinned trace edge details",
    })).toBeVisible();
  });

  it("supports clamped keyboard resizing and clamps when the workspace shrinks", () => {
    seedTraceDrawer({
      tracePinnedSegmentIds: [first.id],
      tracePinnedPoint: [77.01, 28.01],
      traceInspectorPinned: true,
      traceDetailsCollapsed: false,
      traceDetailsExpandedHeight: 350,
    });
    render(<TraceInspector />);
    const layout = mockTraceWorkspaceHeight(700);
    const handle = screen.getByRole("separator", {
      name: "Resize pinned trace edge details",
    });

    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(useStore.getState().traceDetailsExpandedHeight).toBe(370);
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(useStore.getState().traceDetailsExpandedHeight).toBe(350);

    layout.setWorkspaceHeight(500);
    // min(65% of 500, 500 - 240px reserved map) = 260px.
    expect(useStore.getState().traceDetailsExpandedHeight).toBe(260);
    expect(layout.workspace.style.gridTemplateRows).toContain("260px");
  });

  it("preserves a custom expanded height across a remount", () => {
    seedTraceDrawer({
      tracePinnedSegmentIds: [first.id],
      tracePinnedPoint: [77.01, 28.01],
      traceInspectorPinned: true,
      traceDetailsCollapsed: false,
      traceDetailsExpandedHeight: 300,
    });
    const firstRender = render(<TraceInspector />);
    let layout = mockTraceWorkspaceHeight(600);
    expect(layout.workspace.style.gridTemplateRows).toContain("300px");
    firstRender.unmount();

    render(<TraceInspector />);
    layout = mockTraceWorkspaceHeight(600);
    expect(layout.workspace.style.gridTemplateRows).toContain("300px");
    expect(useStore.getState().tracePinnedSegmentIds).toEqual([first.id]);
  });

  it("runs the final TraceMap resize path when pointer resizing commits", () => {
    vi.useFakeTimers();
    try {
      seedTraceDrawer({
        tracePinnedSegmentIds: [first.id],
        tracePinnedPoint: [77.01, 28.01],
        traceInspectorPinned: true,
        traceDetailsCollapsed: false,
      });
      render(<TraceInspector />);
      mockTraceWorkspaceHeight(600);
      act(() => vi.runOnlyPendingTimers());
      resizeSpy.mockClear();
      const handle = screen.getByRole("separator", {
        name: "Resize pinned trace edge details",
      });

      fireEvent.pointerDown(handle, { pointerId: 1, clientY: 400 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: 320 });
      fireEvent.pointerUp(handle, { pointerId: 1, clientY: 320 });
      act(() => vi.runOnlyPendingTimers());

      expect(resizeSpy).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

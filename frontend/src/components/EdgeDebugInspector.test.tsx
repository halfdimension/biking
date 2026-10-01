import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeDebugInspector, { EDGE_HOVER_DISMISS_DELAY_MS } from "./EdgeDebugInspector";
import EdgeDetailsPanel from "./EdgeDetailsPanel";
import { useStore } from "../store";
import type { CompareDebug, OsrmDebugSegment, ValhallaDebugSegment } from "../types";

const pathCost = {
  elapsedCost: { seconds: 10, cost: 11 },
  transitionCost: { seconds: 1, cost: 2 },
};

const osrm: OsrmDebugSegment = {
  id: "osrm:0:0:43",
  engine: "osrm",
  routeId: "osrm:0",
  routeIndex: 0,
  legIndex: 0,
  segmentIndex: 43,
  coordinates: [[77, 28], [77.1, 28.1]],
  properties: {
    distance: 16.03,
    duration: 1.6,
    weight: 1.7,
    speed: 10,
    datasources: 0,
    datasource: 0,
    datasourceName: null,
    fromNodeId: "9007199254740993",
    toNodeId: "9007199254740995",
  },
};

const valhalla: ValhallaDebugSegment = {
  id: "valhalla:0:0:27",
  engine: "valhalla",
  routeId: "valhalla:0",
  routeIndex: 0,
  legIndex: 0,
  segmentIndex: 27,
  coordinates: [[77, 28], [77.1, 28.1], [77.2, 28.2]],
  properties: {
    id: "6411379561360",
    wayId: "9007199254740997",
    name: ["Kartavya Path"],
    lengthKm: 0.5,
    speed: 35,
    roadClass: "kTrunk",
    beginShapeIndex: 4,
    endShapeIndex: 9,
    traversability: "kBoth",
    use: "kRoadUse",
    toll: false,
    unpaved: false,
    tunnel: false,
    bridge: true,
    roundabout: false,
    surface: "kPavedSmooth",
    density: 3,
    speedLimit: 40,
    defaultSpeed: 35,
    sourceAlongEdge: 0.25,
    targetAlongEdge: 1,
    spdLmt: 40,
    spdLmtHgv: 30,
    spdLmtBike: 20,
    frc: 2,
    tollRoad: 0,
    bikeSpeed: 20,
    nodeCost: pathCost,
    sourceNodeCost: pathCost,
    targetNodeCost: null,
  },
};

const debug: CompareDebug = {
  osrm: { engine: "osrm", status: "ok", segments: [osrm], errors: [] },
  valhalla: { engine: "valhalla", status: "ok", segments: [valhalla], errors: [] },
};

describe("EdgeDebugInspector compact hover summary", () => {
  beforeEach(() => {
    useStore.setState({
      edgeDebugEnabled: true,
      debugResults: debug,
      hoveredDebugSegmentIds: [osrm.id, valhalla.id],
      hoveredDebugPoint: [77.05, 28.05],
      pinnedDebugSegmentIds: [],
      pinnedDebugPoint: null,
      debugInspectorPinned: false,
      routes: [
        {
          id: "osrm:0", engine: "osrm", index: 0, isPrimary: true,
          label: "OSRM Primary", coordinates: [], distanceMeters: 0,
          durationSeconds: 0, cost: 0, raw: {},
        },
        {
          id: "valhalla:0", engine: "valhalla", index: 0, isPrimary: true,
          label: "Valhalla Primary", coordinates: [], distanceMeters: 0,
          durationSeconds: 0, cost: 0, raw: {},
        },
      ],
      visibility: { "osrm:0": true, "valhalla:0": true },
    });
  });

  it("shows compact OSRM and Valhalla sections for an overlap", () => {
    render(<EdgeDebugInspector />);

    const card = screen.getByLabelText("Hovered edge summary");
    expect(within(card).getByTestId("edge-hover-osrm")).toHaveTextContent(
      "OSRM Primary",
    );
    expect(within(card).getByTestId("edge-hover-valhalla")).toHaveTextContent(
      "Valhalla Primary",
    );
    expect(card).toHaveTextContent("10 m/s · 36.0 km/h");
    expect(card).toHaveTextContent("Kartavya Path");
    expect(card).toHaveTextContent("6411379561360");
    expect(card).toHaveTextContent("Click for full details");

    // Long-form fields are intentionally absent from hover.
    expect(within(card).queryByText("Weight")).not.toBeInTheDocument();
    expect(within(card).queryByText("From node ID")).not.toBeInTheDocument();
    expect(within(card).queryByText("Begin shape index")).not.toBeInTheDocument();
    expect(within(card).queryByText("Transition cost")).not.toBeInTheDocument();
  });

  it("shows only one compact section per engine when adjacent edges are hit", () => {
    const adjacent = { ...osrm, id: "osrm:0:0:44", segmentIndex: 44 };
    act(() => {
      useStore.setState({
        debugResults: {
          ...debug,
          osrm: { ...debug.osrm, segments: [osrm, adjacent] },
        },
        hoveredDebugSegmentIds: [osrm.id, adjacent.id, valhalla.id],
      });
    });
    render(<EdgeDebugInspector />);

    expect(screen.getAllByTestId("edge-hover-osrm")).toHaveLength(1);
    expect(screen.getAllByTestId("edge-hover-valhalla")).toHaveLength(1);
    expect(useStore.getState().hoveredDebugSegmentIds).toHaveLength(3);
  });

  it("excludes hidden routes from the hover summary", () => {
    act(() => {
      useStore.setState({
        visibility: { "osrm:0": true, "valhalla:0": false },
      });
    });
    render(<EdgeDebugInspector />);

    expect(screen.getByTestId("edge-hover-osrm")).toBeInTheDocument();
    expect(screen.queryByTestId("edge-hover-valhalla")).not.toBeInTheDocument();
  });

  it("does not occupy the map when there is no active hover", () => {
    act(() => {
      useStore.setState({ hoveredDebugSegmentIds: [], hoveredDebugPoint: null });
    });
    const { container } = render(<EdgeDebugInspector />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render while Edge Debug is off", () => {
    act(() => useStore.setState({ edgeDebugEnabled: false }));
    const { container } = render(<EdgeDebugInspector />);
    expect(container).toBeEmptyDOMElement();
  });
});
describe("EdgeDebugInspector delayed dismissal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState({
      edgeDebugEnabled: true,
      debugResults: debug,
      hoveredDebugSegmentIds: [osrm.id],
      hoveredDebugPoint: [77.05, 28.05],
      pinnedDebugSegmentIds: [],
      pinnedDebugPoint: null,
      debugInspectorPinned: false,
      routes: [
        {
          id: "osrm:0", engine: "osrm", index: 0, isPrimary: true,
          label: "OSRM Primary", coordinates: [], distanceMeters: 0,
          durationSeconds: 0, cost: 0, raw: {},
        },
        {
          id: "valhalla:0", engine: "valhalla", index: 0, isPrimary: true,
          label: "Valhalla Primary", coordinates: [], distanceMeters: 0,
          durationSeconds: 0, cost: 0, raw: {},
        },
      ],
      visibility: { "osrm:0": true, "valhalla:0": true },
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("appears immediately, survives route exit, and hides after three seconds", () => {
    render(<EdgeDebugInspector />);
    expect(screen.getByLabelText("Hovered edge summary")).toBeInTheDocument();

    act(() => {
      useStore.getState().setHoveredDebugSegmentIds([], null);
    });
    expect(screen.getByLabelText("Hovered edge summary")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(EDGE_HOVER_DISMISS_DELAY_MS - 1);
    });
    expect(screen.getByLabelText("Hovered edge summary")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(
      screen.queryByLabelText("Hovered edge summary"),
    ).not.toBeInTheDocument();
  });

  it("cancels dismissal while the card is hovered and restarts it on exit", () => {
    render(<EdgeDebugInspector />);

    const card = screen.getByLabelText("Hovered edge summary");
    fireEvent.mouseEnter(card);
    act(() => {
      vi.advanceTimersByTime(EDGE_HOVER_DISMISS_DELAY_MS * 2);
    });
    expect(screen.getByLabelText("Hovered edge summary")).toBeInTheDocument();

    fireEvent.mouseLeave(card);
    act(() => {
      vi.advanceTimersByTime(EDGE_HOVER_DISMISS_DELAY_MS - 1);
    });
    expect(screen.getByLabelText("Hovered edge summary")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(
      screen.queryByLabelText("Hovered edge summary"),
    ).not.toBeInTheDocument();
  });

  it("updates immediately when another segment is hovered before dismissal", () => {
    render(<EdgeDebugInspector />);
    expect(screen.getByTestId("edge-hover-osrm")).toBeInTheDocument();

    act(() => {
      useStore.getState().setHoveredDebugSegmentIds([], null);
      vi.advanceTimersByTime(1000);
      useStore.getState().setHoveredDebugSegmentIds(
        [valhalla.id],
        [77.15, 28.15],
      );
    });

    expect(screen.queryByTestId("edge-hover-osrm")).not.toBeInTheDocument();
    expect(screen.getByTestId("edge-hover-valhalla")).toHaveTextContent(
      "Kartavya Path",
    );

    act(() => {
      vi.advanceTimersByTime(EDGE_HOVER_DISMISS_DELAY_MS);
    });
    expect(screen.getByTestId("edge-hover-valhalla")).toBeInTheDocument();
  });

  it("does not clear pinned Edge Details when the hover card expires", () => {
    render(
      <>
        <EdgeDebugInspector />
        <EdgeDetailsPanel />
      </>,
    );
    act(() => {
      useStore.getState().pinHoveredDebugSegments();
      useStore.getState().setHoveredDebugSegmentIds([], null);
    });
    act(() => {
      vi.advanceTimersByTime(EDGE_HOVER_DISMISS_DELAY_MS);
    });

    expect(
      screen.queryByLabelText("Hovered edge summary"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("edge-details-osrm")).toBeInTheDocument();
    expect(useStore.getState().pinnedDebugSegmentIds).toEqual([osrm.id]);
  });

  it("cleans up a pending dismissal timer on unmount", () => {
    const { unmount } = render(<EdgeDebugInspector />);
    act(() => {
      useStore.getState().setHoveredDebugSegmentIds([], null);
    });
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

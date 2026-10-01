import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import BottomTabs from "./BottomTabs";
import EdgeDetailsPanel from "./EdgeDetailsPanel";
import { useStore } from "../store";
import type { CompareDebug, OsrmDebugSegment, ValhallaDebugSegment } from "../types";

const cost = {
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
    datasourceName: "profile",
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
  coordinates: [[77, 28], [77.1, 28.1]],
  properties: {
    id: "6411379561360",
    wayId: "9007199254740997",
    name: ["Kartavya Path"],
    lengthKm: 0.5,
    speed: 35,
    defaultSpeed: 30,
    density: 3,
    roadClass: "kTrunk",
    use: "kRoadUse",
    surface: "kPavedSmooth",
    traversability: "kBoth",
    toll: false,
    unpaved: false,
    tunnel: false,
    bridge: true,
    roundabout: false,
    beginShapeIndex: 4,
    endShapeIndex: 9,
    sourceAlongEdge: 0.25,
    targetAlongEdge: 1,
    speedLimit: 40,
    spdLmt: 40,
    spdLmtHgv: 30,
    spdLmtBike: 20,
    bikeSpeed: 20,
    frc: 2,
    tollRoad: 0,
    nodeCost: cost,
    sourceNodeCost: cost,
    targetNodeCost: null,
  },
};

const debug: CompareDebug = {
  osrm: { engine: "osrm", status: "ok", segments: [osrm], errors: [] },
  valhalla: { engine: "valhalla", status: "ok", segments: [valhalla], errors: [] },
};

function seedPinned() {
  useStore.setState({
    edgeDebugEnabled: true,
    debugResults: debug,
    hoveredDebugSegmentIds: [osrm.id, valhalla.id],
    hoveredDebugPoint: [77.05, 28.05],
    pinnedDebugSegmentIds: [osrm.id, valhalla.id],
    pinnedDebugPoint: [77.05, 28.05],
    debugInspectorPinned: true,
    bottomCollapsed: false,
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
}

describe("Edge Details panel", () => {
  beforeEach(seedPinned);

  it("shows both pinned engines with grouped full details", () => {
    render(<EdgeDetailsPanel />);

    const osrmSection = screen.getByTestId("edge-details-osrm");
    const valhallaSection = screen.getByTestId("edge-details-valhalla");
    expect(osrmSection).toHaveTextContent("9007199254740993");
    expect(osrmSection).toHaveTextContent("1.7");
    expect(valhallaSection).toHaveTextContent("6411379561360");
    expect(valhallaSection).toHaveTextContent("9007199254740997");
    expect(valhallaSection).toHaveTextContent("Kartavya Path");
    expect(valhallaSection).toHaveTextContent("BridgeYes");
    expect(screen.getAllByText("Hovered point (lat, lon)")).toHaveLength(2);
  });

  it("starts Advanced collapsed and expands PathCost details on demand", () => {
    render(<EdgeDetailsPanel />);
    const summaries = screen.getAllByText("Advanced");
    for (const summary of summaries) {
      expect(summary.parentElement).not.toHaveAttribute("open");
    }

    fireEvent.click(summaries[1]);
    expect(summaries[1].parentElement).toHaveAttribute("open");
    expect(screen.getByText("Node path cost")).toBeInTheDocument();
    expect(screen.getByText("Target node path cost")).toBeInTheDocument();
    expect(screen.getAllByText("Transition cost")).toHaveLength(3);
    expect(screen.getAllByText("—")).toHaveLength(4);
  });

  it("clears pinned details without stopping live hover", () => {
    render(<EdgeDetailsPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: "Unpin / Clear Details" }),
    );

    expect(useStore.getState().debugInspectorPinned).toBe(false);
    expect(useStore.getState().pinnedDebugSegmentIds).toEqual([]);
    expect(useStore.getState().hoveredDebugSegmentIds).toEqual([
      osrm.id,
      valhalla.id,
    ]);
    expect(screen.getByText("No pinned edge")).toBeInTheDocument();
  });

  it("does not show a pinned segment after its route is hidden", () => {
    act(() => {
      useStore.setState({
        visibility: { "osrm:0": true, "valhalla:0": false },
      });
    });
    render(<EdgeDetailsPanel />);
    expect(screen.getByTestId("edge-details-osrm")).toBeInTheDocument();
    expect(screen.queryByTestId("edge-details-valhalla")).not.toBeInTheDocument();
  });
});

describe("Edge Details tab activation", () => {
  it("the pin action used by a map click opens and activates Edge Details", () => {
    seedPinned();
    useStore.setState({
      debugInspectorPinned: false,
      pinnedDebugSegmentIds: [],
      pinnedDebugPoint: null,
      hoveredDebugSegmentIds: [osrm.id, valhalla.id],
      hoveredDebugPoint: [77.05, 28.05],
      bottomCollapsed: true,
    });
    render(<BottomTabs />);

    act(() => {
      useStore.getState().pinHoveredDebugSegments();
    });

    expect(screen.getByRole("tab", { name: /Edge Details/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(useStore.getState().bottomCollapsed).toBe(false);
    const panel = screen.getByTestId("bottom-tab-panel");
    expect(within(panel).getByTestId("edge-details-osrm")).toBeInTheDocument();
    expect(within(panel).getByTestId("edge-details-valhalla")).toBeInTheDocument();
  });
});

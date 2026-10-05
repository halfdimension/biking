import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store";
import type {
  CompareDebug,
  NormalizedRoute,
  OsrmDebugSegment,
  ValhallaDebugSegment,
} from "../types";
import BottomTabs from "./BottomTabs";
import RouteAnalysis from "./RouteAnalysis";

const cost = {
  elapsedCost: { seconds: 0, cost: 0 },
  transitionCost: { seconds: 0, cost: 0 },
};

function osrm(index: number, routeId = "osrm:0", speed = 5.9): OsrmDebugSegment {
  return {
    id: `${routeId}:0:${index}`,
    engine: "osrm",
    routeId,
    routeIndex: Number(routeId.split(":")[1]),
    legIndex: 0,
    segmentIndex: index,
    coordinates: [[77, 28], [77.001, 28.001]],
    properties: {
      distance: index === 0 ? 100 : 200,
      duration: 2,
      weight: 2,
      speed,
      datasources: 0,
      datasource: 0,
      datasourceName: "un_mmi_api_edge_BIKE",
      fromNodeId: "1",
      toNodeId: "2",
    },
  };
}

function valhalla(
  index: number,
  routeId = "valhalla:0",
  speed = 35,
  density: number | null = 3,
  defaultSpeed: number | null = 30,
): ValhallaDebugSegment {
  return {
    id: `${routeId}:0:${index}`,
    engine: "valhalla",
    routeId,
    routeIndex: Number(routeId.split(":")[1]),
    legIndex: 0,
    segmentIndex: index,
    coordinates: [[77, 28], [77.001, 28.001]],
    properties: {
      id: `edge-${index}`,
      wayId: `way-${index}`,
      name: ["Test Road"],
      lengthKm: index === 0 ? 0.1 : 0.2,
      speed,
      defaultSpeed: defaultSpeed as number,
      density: density as number,
      roadClass: "kPrimary",
      beginShapeIndex: 0,
      endShapeIndex: 1,
      traversability: "kBoth",
      use: "kRoadUse",
      toll: false,
      unpaved: false,
      tunnel: false,
      bridge: false,
      roundabout: false,
      surface: "kPavedSmooth",
      speedLimit: 40,
      sourceAlongEdge: 0,
      targetAlongEdge: 1,
      spdLmt: 40,
      spdLmtHgv: 30,
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

const routes: NormalizedRoute[] = [
  { id: "osrm:0", engine: "osrm", index: 0, isPrimary: true, label: "OSRM Primary", coordinates: [], distanceMeters: 300, durationSeconds: 10, cost: 10, raw: {} },
  { id: "osrm:1", engine: "osrm", index: 1, isPrimary: false, label: "OSRM Alt 1", coordinates: [], distanceMeters: 100, durationSeconds: 10, cost: 10, raw: {} },
  { id: "valhalla:0", engine: "valhalla", index: 0, isPrimary: true, label: "Valhalla Primary", coordinates: [], distanceMeters: 300, durationSeconds: 10, cost: 10, raw: {} },
];

function debugResult(): CompareDebug {
  return {
    osrm: {
      engine: "osrm", status: "ok",
      segments: [osrm(0), osrm(1), osrm(0, "osrm:1", 10)], errors: [],
    },
    valhalla: {
      engine: "valhalla", status: "ok",
      segments: [valhalla(0), valhalla(1, "valhalla:0", 45, 7, null)], errors: [],
    },
  };
}

function seed(debug: CompareDebug | null = debugResult(), selectedRouteId: string | null = null) {
  useStore.setState({
    routes,
    selectedRouteId,
    debugResults: debug,
    edgeDebugEnabled: debug !== null,
    bottomCollapsed: false,
    visibility: { "osrm:0": true, "osrm:1": true, "valhalla:0": true },
    comparisonResultRevision: 1,
    routeAnalysisRouteId: null,
    routeAnalysisMetricId: "speed",
    routeAnalysisQuery: { field: "speed", operator: "=", value: "" },
    routeAnalysisExecutedSearch: null,
  });
}

describe("Route Analysis", () => {
  beforeEach(() => seed());

  it("appears in the existing bottom tabs", () => {
    render(<BottomTabs />);
    expect(screen.getByRole("tab", { name: "Route Analysis" })).toBeInTheDocument();
  });

  it("shows the edge-debug requirement without debug results", () => {
    seed(null);
    render(<RouteAnalysis />);
    expect(screen.getByText("Route Analysis requires edge-debug data.")).toBeInTheDocument();
    expect(screen.getByText("Enable Edge Debug and run Compare Routes.")).toBeInTheDocument();
  });

  it("lists only normalized routes that have matching debug segments", () => {
    render(<RouteAnalysis />);
    const selector = screen.getByLabelText("Route");
    expect(within(selector).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "OSRM Primary", "OSRM Alt 1", "Valhalla Primary",
    ]);
  });

  it("prefers the main selected route, otherwise Valhalla Primary", () => {
    seed(debugResult(), "osrm:1");
    const { unmount } = render(<RouteAnalysis />);
    expect(screen.getByLabelText("Route")).toHaveValue("osrm:1");
    unmount();
    seed(debugResult(), null);
    render(<RouteAnalysis />);
    expect(screen.getByLabelText("Route")).toHaveValue("valhalla:0");
  });

  it("renders step speed profiles for Valhalla and OSRM", () => {
    render(<RouteAnalysis />);
    expect(screen.getByRole("img", { name: "Valhalla Primary Speed step profile" })).toBeInTheDocument();
    expect(document.querySelector(".route-analysis__profile")?.getAttribute("d")).toContain(" V ");
    fireEvent.change(screen.getByLabelText("Route"), { target: { value: "osrm:0" } });
    expect(screen.getByRole("img", { name: "OSRM Primary Speed step profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Profile summary")).toHaveTextContent("Weighted avg");
  });

  it("renders Valhalla density and reports it unavailable for OSRM", () => {
    render(<RouteAnalysis />);
    fireEvent.change(screen.getByLabelText("Metric"), { target: { value: "density" } });
    expect(screen.getByRole("img", { name: "Valhalla Primary Density step profile" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Route"), { target: { value: "osrm:0" } });
    expect(screen.getByText("Density is not available for this route/engine.")).toBeInTheDocument();
  });

  it("shows partial Default Speed availability without substituting actual speed", () => {
    render(<RouteAnalysis />);
    fireEvent.change(screen.getByLabelText("Metric"), { target: { value: "defaultSpeed" } });
    expect(screen.getByLabelText("Profile summary")).toHaveTextContent("1 / 2 segments");
    expect(screen.getByRole("img", { name: "Valhalla Primary Default Speed step profile" })).toBeInTheDocument();
  });

  it("changes the graph and summary when the local route selection changes", () => {
    render(<RouteAnalysis />);
    fireEvent.change(screen.getByLabelText("Route"), { target: { value: "osrm:1" } });
    expect(screen.getByLabelText("Profile summary")).toHaveTextContent("OSRM Alt 1");
    expect(screen.getByLabelText("Profile summary")).toHaveTextContent("1 segments");
    expect(useStore.getState().selectedRouteId).toBeNull();
  });

  it("removes a stale chart as soon as a new comparison clears debug data", () => {
    render(<RouteAnalysis />);
    expect(screen.getByTestId("route-profile-chart")).toBeInTheDocument();
    act(() => useStore.setState({ debugResults: null }));
    expect(screen.queryByTestId("route-profile-chart")).not.toBeInTheDocument();
    expect(screen.getByText("Route Analysis requires edge-debug data.")).toBeInTheDocument();
  });

  it("maps graph hover to an OSRM segment and shows original plus converted speed", () => {
    seed(debugResult(), "osrm:0");
    render(<RouteAnalysis />);
    const chart = screen.getByRole("img", { name: "OSRM Primary Speed step profile" });
    fireEvent.pointerMove(chart, { clientX: 100, clientY: 80 });
    const tooltip = screen.getByTestId("route-analysis-tooltip");
    expect(tooltip).toHaveTextContent("Segment 0");
    expect(tooltip).toHaveTextContent("5.9 m/s · 21.2 km/h");
    expect(tooltip).toHaveTextContent("un_mmi_api_edge_BIKE");
  });

  it("shows Valhalla edge fields in the hover tooltip", () => {
    render(<RouteAnalysis />);
    const chart = screen.getByRole("img", { name: "Valhalla Primary Speed step profile" });
    fireEvent.pointerMove(chart, { clientX: 100, clientY: 80 });
    const tooltip = screen.getByTestId("route-analysis-tooltip");
    expect(tooltip).toHaveTextContent("edge-0");
    expect(tooltip).toHaveTextContent("kPrimary");
    expect(tooltip).toHaveTextContent("kPavedSmooth");
    expect(tooltip).toHaveTextContent("Density3");
  });

  it("handles entirely missing values cleanly", () => {
    const debug = debugResult();
    debug.valhalla.segments = [valhalla(0, "valhalla:0", 35, null, null)];
    seed(debug);
    render(<RouteAnalysis />);
    fireEvent.change(screen.getByLabelText("Metric"), { target: { value: "defaultSpeed" } });
    expect(screen.getByText("Default Speed is not available for this route/engine.")).toBeInTheDocument();
    expect(screen.queryByText(/NaN|undefined/)).not.toBeInTheDocument();
  });

  it("observes chart container resizing and updates its responsive viewBox", () => {
    let callback: ResizeObserverCallback | null = null;
    const OriginalObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(next: ResizeObserverCallback) { callback = next; }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
    render(<RouteAnalysis />);
    const chart = screen.getByRole("img", { name: "Valhalla Primary Speed step profile" });
    act(() => callback?.([{ contentRect: { width: 540, height: 190 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(chart).toHaveAttribute("viewBox", "0 0 540 190");
    globalThis.ResizeObserver = OriginalObserver;
  });

  it("does not make a comparison request when tabs, routes, or metrics change", () => {
    const runCompare = vi.spyOn(useStore.getState(), "runCompare");
    render(<BottomTabs />);
    fireEvent.click(screen.getByRole("tab", { name: "Route Analysis" }));
    fireEvent.change(screen.getByLabelText("Route"), { target: { value: "osrm:0" } });
    fireEvent.change(screen.getByLabelText("Metric"), { target: { value: "density" } });
    expect(runCompare).not.toHaveBeenCalled();
    runCompare.mockRestore();
  });

  it("shows search controls with Valhalla-appropriate fields", () => {
    render(<RouteAnalysis />);
    expect(screen.getByRole("form", { name: "Search and highlight" })).toBeInTheDocument();
    const fields = screen.getByLabelText("Search field");
    expect(within(fields).getByRole("option", { name: "Road Class" })).toBeInTheDocument();
    expect(within(fields).queryByRole("option", { name: "Datasource" })).not.toBeInTheDocument();
  });

  it("switches to OSRM fields and labels speed in km/h", () => {
    render(<RouteAnalysis />);
    fireEvent.change(screen.getByLabelText("Route"), { target: { value: "osrm:0" } });
    const fields = screen.getByLabelText("Search field");
    expect(within(fields).getByRole("option", { name: "Datasource" })).toBeInTheDocument();
    expect(within(fields).queryByRole("option", { name: "Road Class" })).not.toBeInTheDocument();
    expect(within(fields).getByRole("option", { name: "Speed (km/h)" })).toBeInTheDocument();
    expect(screen.getByText("Value (km/h)")).toBeInTheDocument();
  });

  it("derives a categorical value dropdown from the selected route", () => {
    render(<RouteAnalysis />);
    fireEvent.change(screen.getByLabelText("Search field"), { target: { value: "roadClass" } });
    const value = screen.getByLabelText("Search value");
    expect(value.tagName).toBe("SELECT");
    expect(within(value).getByRole("option", { name: "kPrimary" })).toBeInTheDocument();
  });

  it("keeps ID entry string-safe", () => {
    render(<RouteAnalysis />);
    fireEvent.change(screen.getByLabelText("Search field"), { target: { value: "wayId" } });
    const value = screen.getByLabelText("Search value");
    expect(value).toHaveAttribute("type", "text");
    fireEvent.change(value, { target: { value: "90071992547409931234" } });
    expect(value).toHaveValue("90071992547409931234");
    expect(useStore.getState().routeAnalysisQuery.value).toBe("90071992547409931234");
  });

  it("highlights a query and reports count, distance, and route percentage", () => {
    render(<RouteAnalysis />);
    fireEvent.change(screen.getByLabelText("Search value"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
    const stats = screen.getByLabelText("Match statistics");
    expect(stats).toHaveTextContent("1 matching segments");
    expect(stats).toHaveTextContent("100 m matched");
    expect(stats).toHaveTextContent("33.3% of route");
    expect(useStore.getState().routeAnalysisExecutedSearch?.result.matchingSegmentIds)
      .toEqual(["valhalla:0:0:0"]);
  });

  it("clears an executed result without changing routes, selection, or debug pin", () => {
    useStore.setState({
      selectedRouteId: "osrm:0",
      pinnedDebugSegmentIds: ["valhalla:0:0:0"],
      debugInspectorPinned: true,
    });
    render(<RouteAnalysis />);
    fireEvent.change(screen.getByLabelText("Search value"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByLabelText("Match statistics")).not.toBeInTheDocument();
    expect(useStore.getState().routeAnalysisExecutedSearch).toBeNull();
    expect(useStore.getState().selectedRouteId).toBe("osrm:0");
    expect(useStore.getState().pinnedDebugSegmentIds).toEqual(["valhalla:0:0:0"]);
  });

  it("invalidates old results immediately when route or field changes", () => {
    render(<RouteAnalysis />);
    fireEvent.change(screen.getByLabelText("Search value"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
    expect(screen.getByLabelText("Match statistics")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search field"), { target: { value: "density" } });
    expect(screen.queryByLabelText("Match statistics")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search value"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
    fireEvent.change(screen.getByLabelText("Route"), { target: { value: "osrm:0" } });
    expect(screen.queryByLabelText("Match statistics")).not.toBeInTheDocument();
  });

  it("keeps an executed search when only the chart metric changes", () => {
    render(<RouteAnalysis />);
    fireEvent.change(screen.getByLabelText("Search value"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
    const executed = useStore.getState().routeAnalysisExecutedSearch;
    fireEvent.change(screen.getByLabelText("Metric"), { target: { value: "density" } });
    expect(screen.getByLabelText("Match statistics")).toBeInTheDocument();
    expect(useStore.getState().routeAnalysisExecutedSearch).toBe(executed);
  });

  it("restores selection, query, and result after a component remount", () => {
    const rendered = render(<RouteAnalysis />);
    fireEvent.change(screen.getByLabelText("Search value"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
    rendered.unmount();
    render(<RouteAnalysis />);
    expect(screen.getByLabelText("Route")).toHaveValue("valhalla:0");
    expect(screen.getByLabelText("Search value")).toHaveValue(35);
    expect(screen.getByLabelText("Match statistics")).toBeInTheDocument();
  });

  it("shows a hidden-route message while preserving the executed result", () => {
    render(<RouteAnalysis />);
    fireEvent.change(screen.getByLabelText("Search value"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
    act(() => useStore.getState().setVisibility("valhalla:0", false));
    expect(screen.getByText("Selected analysis route is hidden on the map.")).toBeInTheDocument();
    expect(useStore.getState().routeAnalysisExecutedSearch).not.toBeNull();
    act(() => useStore.getState().setVisibility("valhalla:0", true));
    expect(screen.queryByText("Selected analysis route is hidden on the map.")).not.toBeInTheDocument();
  });

  it("does not request an API comparison when highlighting or clearing", () => {
    const runCompare = vi.spyOn(useStore.getState(), "runCompare");
    render(<RouteAnalysis />);
    fireEvent.change(screen.getByLabelText("Search value"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(runCompare).not.toHaveBeenCalled();
    runCompare.mockRestore();
  });
});

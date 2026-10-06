import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { deriveRouteProfile } from "../analysis/routeProfile";
import { evaluateRouteQuery } from "../analysis/routeQuery";
import { useStore } from "../store";
import type {
  NormalizedRoute,
  ValhallaDebugSegment,
  ValhallaTraceResult,
} from "../types";
import TraceRouteAnalysis, {
  traceMetricsForProfile,
  traceQueryFieldsForProfile,
} from "./TraceRouteAnalysis";

const sourceRoute: NormalizedRoute = {
  id: "osrm:0",
  engine: "osrm",
  index: 0,
  isPrimary: true,
  label: "OSRM Primary",
  coordinates: [[77, 28], [77.3, 28.3]],
  distanceMeters: 300,
  durationSeconds: 30,
  cost: 30,
  raw: { geometry: "encoded" },
};

function traceSegment(
  index: number,
  overrides: Record<string, unknown> = {},
): ValhallaDebugSegment {
  return {
    id: `trace:osrm:0:${index}`,
    engine: "valhalla",
    routeId: "trace:osrm:0",
    routeIndex: 0,
    legIndex: 0,
    segmentIndex: index,
    coordinates: [
      [77 + index * 0.1, 28 + index * 0.1],
      [77 + (index + 1) * 0.1, 28 + (index + 1) * 0.1],
    ],
    properties: {
      id: `edge-${index}`,
      wayId: `way-${index}`,
      name: [index ? "Second Road" : "Trace Road"],
      lengthKm: index ? 0.2 : 0.1,
      speed: index ? 40.005 : 30,
      roadClass: index ? "kPrimary" : "kTrunk",
      beginShapeIndex: index,
      endShapeIndex: index + 1,
      traversability: "kBoth",
      use: "kRoad",
      toll: false,
      unpaved: false,
      tunnel: false,
      bridge: index === 1,
      roundabout: false,
      surface: index ? "kPaved" : "kPavedSmooth",
      density: index ? 10 : 15,
      ...overrides,
    },
  } as unknown as ValhallaDebugSegment;
}

const first = traceSegment(0);
const second = traceSegment(1);
const result: ValhallaTraceResult = {
  status: "partial",
  sourceRouteId: sourceRoute.id,
  originalGeometry: sourceRoute.coordinates,
  traceGeometry: [[77, 28], [77.1, 28.1], [77.3, 28.3]],
  exactGeometryMatch: false,
  originalPointCount: 2,
  tracePointCount: 3,
  geometryDeviation: null,
  segments: [first, second],
  warnings: [{ kind: "geometry_changed", message: "Geometry changed." }],
  errors: [{ kind: "edge_omitted", message: "One invalid edge was omitted." }],
  httpStatus: 200,
  durationMs: 2,
};

function seed() {
  useStore.setState({
    traceStatus: "done",
    traceResult: result,
    traceResultRevision: 7,
    traceSourceRouteId: sourceRoute.id,
    traceHoveredSegmentIds: [],
    traceHoveredPoint: null,
    tracePinnedSegmentIds: [],
    tracePinnedPoint: null,
    traceInspectorPinned: false,
    traceDetailsCollapsed: false,
    traceLowerTab: "route-analysis",
    traceAnalysisMetricId: "speed",
    traceAnalysisQuery: { field: "speed", operator: "=", value: "" },
    traceAnalysisExecutedSearch: null,
    traceAnalysisFocusedSegmentId: null,
  });
}

describe("Trace Route Analysis", () => {
  beforeEach(seed);

  it("builds the trace profile in source-to-destination order from lengthKm", () => {
    const profile = deriveRouteProfile([second, first], "trace:osrm:0");

    expect(profile.routeId).toBe("trace:osrm:0");
    expect(profile.segments.map((item) => item.debugSegmentId)).toEqual([
      first.id,
      second.id,
    ]);
    expect(profile.segments.map((item) => [
      item.startDistanceMeters,
      item.endDistanceMeters,
    ])).toEqual([[0, 100], [100, 300]]);
    expect(profile.totalDistanceMeters).toBe(300);
    expect(profile.segments.map((item) => item.segment.properties.speed)).toEqual([
      30,
      40.005,
    ]);
    expect(profile.segments.map((item) =>
      item.segment.engine === "valhalla" ? item.segment.properties.density : null
    )).toEqual([
      15,
      10,
    ]);
  });

  it("offers only metrics and Valhalla fields with actual trace data", () => {
    const profile = deriveRouteProfile(result.segments, "trace:osrm:0");
    const metricIds = traceMetricsForProfile(profile).map((item) => item.id);
    const fieldIds = traceQueryFieldsForProfile(profile).map((item) => item.id);

    expect(metricIds).toEqual(["speed", "density"]);
    expect(metricIds).not.toContain("defaultSpeed");
    expect(fieldIds).toEqual(expect.arrayContaining([
      "speed",
      "density",
      "roadClass",
      "surface",
      "use",
      "toll",
      "unpaved",
      "tunnel",
      "bridge",
      "roundabout",
      "name",
      "wayId",
      "edgeId",
    ]));
    expect(fieldIds).not.toEqual(expect.arrayContaining([
      "defaultSpeed",
      "frc",
      "spdLmt",
      "spdLmtHgv",
      "spdLmtBike",
      "bikeSpeed",
    ]));
  });

  it("supports partial changed-geometry traces and trace-distance search statistics", () => {
    render(<TraceRouteAnalysis sourceRoute={sourceRoute} result={result} />);

    const metric = screen.getByRole("combobox", { name: "Trace metric" });
    expect(within(metric).getByRole("option", { name: "Speed" })).toBeInTheDocument();
    expect(within(metric).getByRole("option", { name: "Density" })).toBeInTheDocument();
    expect(within(metric).queryByRole("option", { name: "Default Speed" })).toBeNull();

    fireEvent.change(
      screen.getByRole("combobox", { name: "Trace search field" }),
      { target: { value: "density" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Trace search value" }),
      { target: { value: "15" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));

    expect(screen.getByLabelText("Trace match statistics")).toHaveTextContent(
      "1 matching segments",
    );
    expect(screen.getByLabelText("Trace match statistics")).toHaveTextContent(
      "100 m matched",
    );
    expect(screen.getByLabelText("Trace match statistics")).toHaveTextContent(
      "33.3% of trace",
    );
    expect(useStore.getState().traceAnalysisExecutedSearch?.result.matchingSegmentIds)
      .toEqual([first.id]);
  });

  it("uses tolerant speed equality and supports exact edge and way IDs", () => {
    const profile = deriveRouteProfile(result.segments, "trace:osrm:0");

    for (const [field, value, expected] of [
      ["speed", "40", [second.id]],
      ["edgeId", "edge-0", [first.id]],
      ["wayId", "way-1", [second.id]],
      ["name", "second", [second.id]],
      ["roadClass", "kTrunk", [first.id]],
      ["surface", "kPaved", [second.id]],
    ] as const) {
      const definition = traceQueryFieldsForProfile(profile).find(
        (item) => item.id === field,
      );
      expect(definition).toBeDefined();
      const operator = field === "name" ? "contains" : "=";
      const query = { field, operator, value } as const;
      expect(evaluateRouteQuery(profile, query).matchingSegmentIds).toEqual(expected);
    }
  });

  it("synchronizes map hover, graph focus, and exact graph pin independently", () => {
    render(<TraceRouteAnalysis sourceRoute={sourceRoute} result={result} />);

    act(() => {
      useStore.getState().setTraceHoveredSegmentIds([second.id], [77.2, 28.2]);
    });
    expect(screen.getByTestId("route-analysis-tooltip")).toHaveTextContent(
      "edge-1",
    );

    const chart = screen.getByRole("img", {
      name: /Valhalla Trace — OSRM Primary Speed step profile/,
    });
    fireEvent.pointerMove(chart, { clientX: 80 });
    expect(useStore.getState().traceAnalysisFocusedSegmentId).toBe(first.id);
    expect(screen.getByTestId("route-analysis-tooltip")).toHaveTextContent(
      "edge-0",
    );

    fireEvent.pointerLeave(chart);
    expect(useStore.getState().traceAnalysisFocusedSegmentId).toBeNull();
    expect(screen.getByTestId("route-analysis-tooltip")).toHaveTextContent(
      "edge-1",
    );

    fireEvent.click(chart, { clientX: 80 });
    expect(useStore.getState().tracePinnedSegmentIds).toEqual([first.id]);
    expect(useStore.getState().tracePinnedPoint).toBeNull();
    expect(useStore.getState().traceInspectorPinned).toBe(true);
    expect(useStore.getState().traceLowerTab).toBe("edge-details");
    expect(useStore.getState().traceDetailsCollapsed).toBe(false);
  });

  it("shows clear states before a trace and for an unusable trace", () => {
    const view = render(
      <TraceRouteAnalysis sourceRoute={sourceRoute} result={null} />,
    );
    expect(screen.getByText(
      "Run Valhalla Trace to analyze map-matched edges.",
    )).toBeInTheDocument();

    view.rerender(
      <TraceRouteAnalysis
        sourceRoute={sourceRoute}
        result={{ ...result, segments: [] }}
      />,
    );
    expect(screen.getByText(
      "No usable map-matched trace edges are available.",
    )).toBeInTheDocument();
  });

  it("invalidates search and focus when the source route changes", () => {
    const profile = deriveRouteProfile(result.segments, "trace:osrm:0");
    useStore.setState({
      traceAnalysisExecutedSearch: {
        traceResultRevision: 7,
        routeId: "trace:osrm:0",
        query: { field: "density", operator: "=", value: "15" },
        result: {
          matchingSegmentIds: [first.id],
          matchingSegments: [profile.segments[0]],
          matchedDistanceMeters: 100,
          matchedPercentage: 100 / 3,
          totalSegmentCount: 2,
          matchingSegmentCount: 1,
          missingLengthSegmentCount: 0,
          hasIncompleteDistanceCoverage: false,
        },
      },
      traceAnalysisFocusedSegmentId: first.id,
    });

    act(() => useStore.getState().setTraceSourceRouteId("osrm:1"));

    expect(useStore.getState().traceAnalysisExecutedSearch).toBeNull();
    expect(useStore.getState().traceAnalysisFocusedSegmentId).toBeNull();
  });
});

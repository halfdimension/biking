/**
 * Component tests for the Assessment tab (Task 27.1, Req 14, 17.11).
 *
 * `Assessment` does not import maplibre-gl, so it renders in isolation. The
 * store is seeded via `useStore.setState` and reset before every test, and
 * localStorage is cleared so persistence assertions start clean.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
  act,
} from "@testing-library/react";
import Assessment from "./Assessment";
import { useStore } from "../store";
import { routeAssessmentKey } from "../assessmentKey";
import type {
  CompareResponse,
  Engine,
  EngineResult,
  NormalizedRoute,
  RouteWarning,
} from "../types";

function route(engine: Engine, index: number): NormalizedRoute {
  return {
    id: `${engine}:${index}`,
    engine,
    index,
    isPrimary: index === 0,
    label:
      index === 0
        ? `${engine === "osrm" ? "OSRM" : "Valhalla"} Primary`
        : `${engine === "osrm" ? "OSRM" : "Valhalla"} Alt ${index}`,
    coordinates: [
      [77.6, 12.9],
      [77.65, 12.95],
    ],
    distanceMeters: 1234 + index,
    durationSeconds: 567 + index,
    cost: 89 + index,
    raw: {},
  };
}

function engineResult(
  engine: Engine,
  routes: NormalizedRoute[],
  warnings: RouteWarning[] = [],
): EngineResult {
  return {
    engine,
    status: "ok",
    httpStatus: 200,
    durationMs: 9,
    normalizedRoutes: routes,
    raw: {},
    warnings,
    error: null,
  };
}

function results(
  osrmRoutes: NormalizedRoute[],
  valhallaRoutes: NormalizedRoute[],
  osrmWarnings: RouteWarning[] = [],
  valhallaWarnings: RouteWarning[] = [],
): CompareResponse {
  return {
    osrm: engineResult("osrm", osrmRoutes, osrmWarnings),
    valhalla: engineResult("valhalla", valhallaRoutes, valhallaWarnings),
  };
}

const ROUTES = [route("osrm", 0), route("valhalla", 1)];

beforeEach(() => {
  cleanup();
  localStorage.clear();
  useStore.setState({
    routes: [],
    results: null,
    assessments: {},
    sessionAssessments: {},
    currentTestCaseId: null,
  });
});

describe("Assessment", () => {
  it("shows a hint when there are no routes", () => {
    render(<Assessment />);
    expect(
      screen.getByText(/No routes yet — run Compare to assess routes\./i),
    ).toBeInTheDocument();
  });

  it("renders a card per route with engine, label, and distance", () => {
    useStore.setState({ routes: ROUTES, currentTestCaseId: "tc-A" });
    render(<Assessment />);

    expect(screen.getByTestId("assessment-card-osrm:0")).toBeInTheDocument();
    expect(screen.getByTestId("assessment-card-valhalla:1")).toBeInTheDocument();
    expect(screen.getByText("OSRM Primary")).toBeInTheDocument();
    expect(screen.getByText("Valhalla Alt 1")).toBeInTheDocument();
    // distanceMeters 1234 → "1.23 km"
    expect(screen.getByText("1.23 km")).toBeInTheDocument();
  });

  it("clicking Good sets the rating; clicking Unrated clears it", () => {
    useStore.setState({ routes: ROUTES, currentTestCaseId: "tc-A" });
    render(<Assessment />);

    // Persistence is keyed by the deterministic geometry key, not route.id.
    const osrmKey = routeAssessmentKey(route("osrm", 0));
    const card = screen.getByTestId("assessment-card-osrm:0");
    fireEvent.click(within(card).getByRole("button", { name: "Good" }));
    expect(useStore.getState().getAssessment(osrmKey)).toEqual({
      rating: "good",
    });

    fireEvent.click(within(card).getByRole("button", { name: "Unrated" }));
    expect(useStore.getState().getAssessment(osrmKey)).toBeUndefined();
  });

  it("typing in notes updates the store", () => {
    useStore.setState({ routes: ROUTES, currentTestCaseId: "tc-A" });
    render(<Assessment />);

    const valhallaKey = routeAssessmentKey(route("valhalla", 1));
    const card = screen.getByTestId("assessment-card-valhalla:1");
    const textarea = within(card).getByPlaceholderText(/quality notes/i);
    fireEvent.change(textarea, { target: { value: "detour via canal" } });

    expect(useStore.getState().getAssessment(valhallaKey)).toEqual({
      notes: "detour via canal",
    });
  });

  it("shows the session banner when no testcase is current and hides it when set", () => {
    useStore.setState({ routes: ROUTES, currentTestCaseId: null });
    const { rerender } = render(<Assessment />);
    expect(screen.getByTestId("assessment-session-banner")).toBeInTheDocument();

    act(() => {
      useStore.setState({ currentTestCaseId: "tc-A" });
    });
    rerender(<Assessment />);
    expect(
      screen.queryByTestId("assessment-session-banner"),
    ).not.toBeInTheDocument();
  });

  it("renders a per-route warning block separate from the rating control (Req 17.11)", () => {
    // A Valhalla warning for a route that IS rendered (valhalla:1).
    useStore.setState({
      routes: ROUTES,
      currentTestCaseId: "tc-A",
      results: results(
        [route("osrm", 0)],
        [route("valhalla", 1)],
        [],
        [
          {
            engine: "valhalla",
            routeIndex: 1,
            kind: "geometry_error",
            message: "Alternate 1 geometry was undecodable and was dropped.",
          },
        ],
      ),
    });
    render(<Assessment />);

    const card = screen.getByTestId("assessment-card-valhalla:1");
    const warnings = within(card).getByTestId("route-warnings");
    expect(within(warnings).getByText("geometry_error")).toBeInTheDocument();
    expect(
      within(warnings).getByText(/undecodable and was dropped/i),
    ).toBeInTheDocument();
    // The warning is NOT part of the rating group.
    const ratingGroup = within(card).getByRole("group", {
      name: /rating/i,
    });
    expect(
      within(ratingGroup).queryByText("geometry_error"),
    ).not.toBeInTheDocument();
  });

  it("surfaces a dropped-route warning whose route is not rendered", () => {
    // Warning for valhalla index 2, but only valhalla:1 is in routes.
    useStore.setState({
      routes: ROUTES,
      currentTestCaseId: "tc-A",
      results: results(
        [route("osrm", 0)],
        [route("valhalla", 1)],
        [],
        [
          {
            engine: "valhalla",
            routeIndex: 2,
            kind: "geometry_error",
            message: "Alternate 2 was dropped due to malformed geometry.",
          },
        ],
      ),
    });
    render(<Assessment />);

    const dropped = screen.getByTestId("dropped-routes");
    expect(within(dropped).getByText(/Valhalla #2/)).toBeInTheDocument();
    expect(within(dropped).getByText("geometry_error")).toBeInTheDocument();
    expect(
      within(dropped).getByText(/malformed geometry/i),
    ).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { analyzeRouteDifference } from "../analysis/routeDifference";
import { useStore } from "../store";
import type { NormalizedRoute } from "../types";
import RouteDifference from "./RouteDifference";

function route(
  engine: "osrm" | "valhalla",
  index: number,
  coordinates: [number, number][],
): NormalizedRoute {
  return {
    id: `${engine}:${index}`,
    engine,
    index,
    isPrimary: index === 0,
    label: `${engine === "osrm" ? "OSRM" : "Valhalla"} ${
      index === 0 ? "Primary" : `Alt ${index}`
    }`,
    coordinates,
    distanceMeters: engine === "osrm" ? 1000 : 1120,
    durationSeconds: engine === "osrm" ? 300 : 280,
    cost: null,
    raw: null,
  };
}

const OSRM = route("osrm", 0, [
  [77, 28.6],
  [77.01, 28.6],
]);
const OSRM_ALT = route("osrm", 1, [
  [77, 28.6],
  [77.01, 28.6],
]);
const VALHALLA = route("valhalla", 0, [
  [77, 28.6],
  [77.003, 28.6],
  [77.004, 28.601],
  [77.006, 28.601],
  [77.007, 28.6],
  [77.01, 28.6],
]);

function seed() {
  useStore.setState({
    routes: [OSRM, OSRM_ALT, VALHALLA],
    selectedRouteId: "valhalla:0",
    comparisonResultRevision: 3,
    routeDifferenceOsrmRouteId: "osrm:0",
    routeDifferenceValhallaRouteId: "valhalla:0",
    routeDifferenceStatus: "idle",
    routeDifferenceResult: null,
    routeDifferenceResultRevision: null,
    routeDifferenceError: null,
    routeDifferenceOverlayEnabled: true,
    routeDifferenceFocusedIndex: null,
    routeDifferenceFitRequestId: 0,
    routeDifferenceFitIndex: null,
  });
}

describe("RouteDifference", () => {
  beforeEach(seed);

  it("shows an unavailable state and disables analysis without both engines", () => {
    useStore.setState({
      routes: [OSRM],
      routeDifferenceValhallaRouteId: null,
    });
    render(<RouteDifference />);
    expect(screen.getByText(/requires at least one OSRM route/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Analyze Difference" }),
    ).toBeDisabled();
  });

  it("lists only the appropriate engine routes and keeps normal selection independent", () => {
    render(<RouteDifference />);
    const osrmSelect = screen.getByRole("combobox", { name: "OSRM route" });
    const valhallaSelect = screen.getByRole("combobox", {
      name: "Valhalla route",
    });
    expect(osrmSelect).toHaveValue("osrm:0");
    expect(valhallaSelect).toHaveValue("valhalla:0");
    expect(screen.getByRole("option", { name: "OSRM Alt 1" })).toBeVisible();

    fireEvent.change(osrmSelect, { target: { value: "osrm:1" } });
    expect(useStore.getState().routeDifferenceOsrmRouteId).toBe("osrm:1");
    expect(useStore.getState().selectedRouteId).toBe("valhalla:0");
  });

  it("renders summary, methodology, divergence cards, focus, and fit actions", () => {
    render(<RouteDifference />);
    fireEvent.click(
      screen.getByRole("button", { name: "Analyze Difference" }),
    );

    expect(screen.getByText("Corridor similarity")).toBeVisible();
    expect(screen.getByText("OSRM shared")).toBeVisible();
    expect(screen.getByText("Valhalla shared")).toBeVisible();
    expect(screen.getByText("Engine distance Δ")).toBeVisible();
    expect(screen.getAllByText("+0.12 km")).toHaveLength(2);
    expect(screen.getByText("-20s")).toBeVisible();
    expect(screen.getByText("How comparison works")).toBeVisible();
    expect(screen.getByText(/does not imply identical routing graph edges/i)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Divergence 1" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
    expect(useStore.getState().routeDifferenceFocusedIndex).toBe(0);
    expect(useStore.getState().selectedRouteId).toBe("valhalla:0");

    fireEvent.click(screen.getByRole("button", { name: "Fit on map" }));
    expect(useStore.getState().routeDifferenceFitRequestId).toBe(1);
    expect(useStore.getState().routeDifferenceFitIndex).toBe(0);
  });

  it("renders open start/end divergence labels", () => {
    const offset = route("valhalla", 0, [
      [77, 28.6003],
      [77.01, 28.6003],
    ]);
    const result = analyzeRouteDifference(OSRM, offset);
    useStore.setState({
      routes: [OSRM, offset],
      routeDifferenceResult: result,
      routeDifferenceResultRevision: 3,
      routeDifferenceStatus: "ready",
    });
    render(<RouteDifference />);
    expect(screen.getByText("From route start")).toBeVisible();
    expect(screen.getByText("Continues to destination")).toBeVisible();
  });
});

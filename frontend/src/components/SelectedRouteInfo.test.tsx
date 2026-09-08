/**
 * Component tests for the selected-route details panel (Task 21.1, Req 6.6).
 *
 * `SelectedRouteInfo` does not import maplibre-gl, so it renders in isolation.
 * The store is seeded via `useStore.setState` and reset before every test.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import SelectedRouteInfo from "./SelectedRouteInfo";
import { useStore } from "../store";
import type { Engine, NormalizedRoute } from "../types";

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

const ROUTES: NormalizedRoute[] = [route("osrm", 0), route("valhalla", 1)];

beforeEach(() => {
  cleanup();
  useStore.setState({ routes: [], selectedRouteId: null, results: null });
});

describe("SelectedRouteInfo", () => {
  it("shows a hint when no route is selected", () => {
    useStore.setState({ routes: ROUTES, selectedRouteId: null });
    render(<SelectedRouteInfo />);
    expect(
      screen.getByText(/No route selected/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("selected-route")).not.toBeInTheDocument();
  });

  it("shows the selected route's engine, label, distance and a Clear button", () => {
    useStore.setState({ routes: ROUTES, selectedRouteId: "valhalla:1" });
    render(<SelectedRouteInfo />);

    expect(screen.getByTestId("selected-route")).toBeInTheDocument();
    expect(screen.getByText("Valhalla Alt 1")).toBeInTheDocument();
    expect(screen.getByText("Valhalla")).toBeInTheDocument();
    expect(screen.getByText("Alternate")).toBeInTheDocument();
    // distanceMeters 1234 + 1 = 1235 m → formatted "1.24 km"
    expect(screen.getByText("1.24 km")).toBeInTheDocument();
    // route id
    expect(screen.getByText("valhalla:1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear selection" }),
    ).toBeInTheDocument();
  });

  it("Clear selection clears selectedRouteId in the store", () => {
    useStore.setState({ routes: ROUTES, selectedRouteId: "osrm:0" });
    render(<SelectedRouteInfo />);

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(useStore.getState().selectedRouteId).toBeNull();
  });

  it("renders an em dash for a missing numeric field (Req 7.4)", () => {
    const partial: NormalizedRoute = {
      ...route("osrm", 0),
      distanceMeters: null,
      cost: null,
    };
    useStore.setState({ routes: [partial], selectedRouteId: "osrm:0", results: null });
    render(<SelectedRouteInfo />);
    // Three em dashes: distance + cost + request time (no compare results).
    expect(screen.getAllByText("—")).toHaveLength(3);
  });
});

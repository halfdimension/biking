/**
 * Component tests for the comparison table (Task 22.2, Req 8.1–8.4).
 *
 * ComparisonTable does not import maplibre-gl, so it renders in isolation with
 * no map mock. The store is seeded via `useStore.setState` and reset before
 * every test.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import ComparisonTable from "./ComparisonTable";
import { useStore } from "../store";
import type { Engine, NormalizedRoute } from "../types";

function route(
  engine: Engine,
  index: number,
  distanceMeters: number,
  durationSeconds: number,
  cost: number,
): NormalizedRoute {
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
    distanceMeters,
    durationSeconds,
    cost,
    raw: {},
  };
}

/** 2 OSRM + 3 Valhalla routes with known values. */
const ROUTES: NormalizedRoute[] = [
  route("osrm", 0, 1000, 100, 50),
  route("osrm", 1, 1100, 90, 55),
  route("valhalla", 0, 2000, 200, 80),
  route("valhalla", 1, 2200, 260, 88),
  route("valhalla", 2, 1800, 200, 70),
];

function seed(
  routes: NormalizedRoute[] = ROUTES,
  selectedRouteId: string | null = null,
) {
  useStore.setState({ routes, selectedRouteId });
}

beforeEach(() => {
  cleanup();
  useStore.setState({ routes: [], selectedRouteId: null, results: null });
});

describe("ComparisonTable", () => {
  it("renders one row per route with engine, label and formatted values (Req 8.1)", () => {
    seed();
    render(<ComparisonTable />);

    const rows = screen.getAllByRole("button");
    expect(rows).toHaveLength(ROUTES.length);

    // OSRM primary row: distance 1.00 km, duration "2 min", cost 50, vs-primary 0.0%.
    const primary = screen.getByTestId("comparison-row-osrm:0");
    const cells = within(primary).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("OSRM");
    expect(cells[1]).toHaveTextContent("OSRM Primary");
    expect(cells[2]).toHaveTextContent("Primary");
    expect(cells[3]).toHaveTextContent("1.00 km");
    expect(cells[4]).toHaveTextContent("2 min");
    expect(cells[5]).toHaveTextContent("50");
    expect(cells[6]).toHaveTextContent("0.0%");
    expect(cells[7]).toHaveTextContent("0.0%");
  });

  it("computes vs-primary against the route's own-engine primary (Req 8.2)", () => {
    seed();
    render(<ComparisonTable />);

    // OSRM alt: distance (1100-1000)/1000 = +10.0%, duration (90-100)/100 = -10.0%.
    const osrmAlt = screen.getByTestId("comparison-row-osrm:1");
    const osrmCells = within(osrmAlt).getAllByRole("cell");
    expect(osrmCells[6]).toHaveTextContent("+10.0%");
    expect(osrmCells[7]).toHaveTextContent("-10.0%");

    // Valhalla alt 1 compares to Valhalla primary, not OSRM.
    const vAlt = screen.getByTestId("comparison-row-valhalla:1");
    const vCells = within(vAlt).getAllByRole("cell");
    expect(vCells[6]).toHaveTextContent("+10.0%"); // (2200-2000)/2000
    expect(vCells[7]).toHaveTextContent("+30.0%"); // (260-200)/200
  });

  it("selects the route via the store when a row is clicked (Req 8.4)", () => {
    seed();
    render(<ComparisonTable />);

    fireEvent.click(screen.getByTestId("comparison-row-valhalla:2"));
    expect(useStore.getState().selectedRouteId).toBe("valhalla:2");
  });

  it("selects the route on Enter/Space keydown", () => {
    seed();
    render(<ComparisonTable />);

    fireEvent.keyDown(screen.getByTestId("comparison-row-osrm:1"), {
      key: "Enter",
    });
    expect(useStore.getState().selectedRouteId).toBe("osrm:1");
  });

  it("marks the selected route's row (map→table sync)", () => {
    seed(ROUTES, "valhalla:1");
    render(<ComparisonTable />);

    const selectedRow = screen.getByTestId("comparison-row-valhalla:1");
    expect(selectedRow).toHaveAttribute("aria-selected", "true");
    expect(selectedRow.className).toContain("comparison-table__row--selected");

    const other = screen.getByTestId("comparison-row-osrm:0");
    expect(other).toHaveAttribute("aria-selected", "false");
  });

  it("shows all returned routes when engines return different counts (Req 8.3)", () => {
    seed([route("osrm", 0, 1000, 100, 50), route("valhalla", 0, 2000, 200, 80), route("valhalla", 1, 2200, 260, 88)]);
    render(<ComparisonTable />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("shows a muted message when there are no routes", () => {
    seed([]);
    render(<ComparisonTable />);
    expect(
      screen.getByText(/No routes yet — press Compare Routes\./i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

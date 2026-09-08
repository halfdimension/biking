/**
 * Component tests for the visibility panel (Task 20.1, Req 5.1–5.8).
 *
 * Neither `RouteVisibilityList` nor `BulkVisibilityControls` imports
 * maplibre-gl, so these render in isolation with no map mock. The store is
 * seeded directly via `useStore.setState` and reset before every test.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import RouteVisibilityList from "./RouteVisibilityList";
import BulkVisibilityControls from "./BulkVisibilityControls";
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
    distanceMeters: 1000 + index,
    durationSeconds: 100 + index,
    cost: 50 + index,
    raw: {},
  };
}

/** 2 OSRM routes + 3 Valhalla routes, all visible. */
const ROUTES: NormalizedRoute[] = [
  route("osrm", 0),
  route("osrm", 1),
  route("valhalla", 0),
  route("valhalla", 1),
  route("valhalla", 2),
];

function seed(routes: NormalizedRoute[] = ROUTES) {
  const visibility: Record<string, boolean> = {};
  for (const r of routes) visibility[r.id] = true;
  useStore.setState({ routes, visibility });
}

beforeEach(() => {
  cleanup();
  useStore.setState({ routes: [], visibility: {}, selectedRouteId: null });
});

describe("RouteVisibilityList", () => {
  it("renders one checked checkbox per route of its engine (Req 5.1)", () => {
    seed();

    const { unmount } = render(<RouteVisibilityList engine="osrm" />);
    let boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.checked)).toBe(true);
    expect(screen.getByLabelText("OSRM Primary")).toBeInTheDocument();
    expect(screen.getByLabelText("OSRM Alt 1")).toBeInTheDocument();
    unmount();

    render(<RouteVisibilityList engine="valhalla" />);
    boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => b.checked)).toBe(true);
    expect(screen.getByLabelText("Valhalla Alt 2")).toBeInTheDocument();
  });

  it("toggling a checkbox writes the route's visibility to the store (Req 5.2)", () => {
    seed();
    render(<RouteVisibilityList engine="osrm" />);

    const box = screen.getByLabelText("OSRM Alt 1") as HTMLInputElement;
    fireEvent.click(box);
    expect(useStore.getState().visibility["osrm:1"]).toBe(false);
    expect(box.checked).toBe(false);
    // The other route is untouched.
    expect(useStore.getState().visibility["osrm:0"]).toBe(true);

    fireEvent.click(box);
    expect(useStore.getState().visibility["osrm:1"]).toBe(true);
    expect(box.checked).toBe(true);
  });

  it("shows a hint and no checkboxes when the engine has no routes", () => {
    render(<RouteVisibilityList engine="osrm" />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      screen.getByText(/No routes yet — press Compare Routes\./),
    ).toBeInTheDocument();
  });

  it("clicking a row (not the checkbox) selects that route (Req 6.2)", () => {
    seed();
    render(<RouteVisibilityList engine="osrm" />);

    // The clickable row area is a button whose accessible name is the label.
    fireEvent.click(screen.getByRole("button", { name: "OSRM Alt 1" }));
    expect(useStore.getState().selectedRouteId).toBe("osrm:1");
  });

  it("clicking the checkbox toggles visibility WITHOUT changing selection (Req 5.2)", () => {
    seed();
    useStore.setState({ selectedRouteId: "osrm:0" });
    render(<RouteVisibilityList engine="osrm" />);

    const box = screen.getByLabelText("OSRM Alt 1") as HTMLInputElement;
    fireEvent.click(box);
    expect(useStore.getState().visibility["osrm:1"]).toBe(false);
    // Selection is untouched by the checkbox.
    expect(useStore.getState().selectedRouteId).toBe("osrm:0");
  });

  it("marks the selected row (class + aria-pressed) so map↔list stay in sync (Req 6.2)", () => {
    seed();
    useStore.setState({ selectedRouteId: "osrm:1" });
    render(<RouteVisibilityList engine="osrm" />);

    const selectedBtn = screen.getByRole("button", { name: "OSRM Alt 1" });
    expect(selectedBtn).toHaveAttribute("aria-pressed", "true");
    expect(selectedBtn.closest(".route-row")).toHaveClass(
      "route-row--selected",
    );

    const otherBtn = screen.getByRole("button", { name: "OSRM Primary" });
    expect(otherBtn).toHaveAttribute("aria-pressed", "false");
    expect(otherBtn.closest(".route-row")).not.toHaveClass(
      "route-row--selected",
    );
  });
});

describe("BulkVisibilityControls", () => {
  const visible = () =>
    Object.entries(useStore.getState().visibility)
      .filter(([, v]) => v)
      .map(([id]) => id)
      .sort();

  it("Show All makes every route visible (Req 5.3)", () => {
    seed();
    useStore.getState().hideAll();
    render(<BulkVisibilityControls />);

    fireEvent.click(screen.getByRole("button", { name: "Show All" }));
    expect(visible()).toEqual([
      "osrm:0",
      "osrm:1",
      "valhalla:0",
      "valhalla:1",
      "valhalla:2",
    ]);
  });

  it("Hide All hides every route (Req 5.4)", () => {
    seed();
    render(<BulkVisibilityControls />);

    fireEvent.click(screen.getByRole("button", { name: "Hide All" }));
    expect(visible()).toEqual([]);
    expect(Object.keys(useStore.getState().visibility)).toHaveLength(5);
  });

  it("OSRM Only shows OSRM and hides Valhalla (Req 5.5)", () => {
    seed();
    render(<BulkVisibilityControls />);

    fireEvent.click(screen.getByRole("button", { name: "OSRM Only" }));
    expect(visible()).toEqual(["osrm:0", "osrm:1"]);
  });

  it("Valhalla Only shows Valhalla and hides OSRM (Req 5.6)", () => {
    seed();
    render(<BulkVisibilityControls />);

    fireEvent.click(screen.getByRole("button", { name: "Valhalla Only" }));
    expect(visible()).toEqual(["valhalla:0", "valhalla:1", "valhalla:2"]);
  });

  it("Primary Only shows primaries and hides alternates (Req 5.7)", () => {
    seed();
    render(<BulkVisibilityControls />);

    fireEvent.click(screen.getByRole("button", { name: "Primary Only" }));
    expect(visible()).toEqual(["osrm:0", "valhalla:0"]);
  });

  it("Alternatives Only shows alternates and hides primaries (Req 5.8)", () => {
    seed();
    render(<BulkVisibilityControls />);

    fireEvent.click(screen.getByRole("button", { name: "Alternatives Only" }));
    expect(visible()).toEqual(["osrm:1", "valhalla:1", "valhalla:2"]);
  });

  it("disables every control when no routes are loaded", () => {
    render(<BulkVisibilityControls />);
    for (const label of [
      "Show All",
      "Hide All",
      "OSRM Only",
      "Valhalla Only",
      "Primary Only",
      "Alternatives Only",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
  });
});

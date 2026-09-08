/**
 * Light render tests for CoordinateInputs (Task 14.1, Req 1.1, 17.4).
 *
 * CoordinateInputs is tested in isolation (it does not pull in MapLibre), so no
 * maplibre-gl mock is needed. We verify that an out-of-range latitude shows an
 * inline error and does NOT write to the store, and that a valid start lat+lon
 * pair updates `store.start`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import CoordinateInputs from "./CoordinateInputs";
import { useStore } from "../store";

beforeEach(() => {
  cleanup();
  useStore.setState({ start: null, dest: null });
});

describe("CoordinateInputs", () => {
  it("shows an error and does not set the store for an out-of-range latitude", () => {
    render(<CoordinateInputs />);
    const startLat = screen.getByLabelText("Lat", {
      selector: "#start-lat",
    });
    fireEvent.change(startLat, { target: { value: "120" } });

    expect(screen.getByRole("alert")).toHaveTextContent(/between -90 and 90/i);
    expect(useStore.getState().start).toBeNull();
  });

  it("sets store.start when both start lat and lon are valid", () => {
    render(<CoordinateInputs />);
    const startLat = screen.getByLabelText("Lat", { selector: "#start-lat" });
    const startLon = screen.getByLabelText("Lon", { selector: "#start-lon" });

    fireEvent.change(startLat, { target: { value: "28.5" } });
    // Only lat set so far: not a complete valid point yet.
    expect(useStore.getState().start).toBeNull();

    fireEvent.change(startLon, { target: { value: "77.1" } });
    expect(useStore.getState().start).toEqual({ lat: 28.5, lon: 77.1 });
  });
});

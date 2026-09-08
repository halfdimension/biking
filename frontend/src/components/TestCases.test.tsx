/**
 * Component tests for the Saved Test Cases panel (Task 26.1, Req 13).
 *
 * The api module is mocked so we can assert the critical LOAD != RUN guarantee:
 * loading a test case must never trigger a Compare / api.compare (Req 13.5).
 *
 * Assertions:
 *   - Save is disabled until both start and destination are valid (Req 13.3).
 *   - Saving with coords adds a row.
 *   - Load restores start/dest and does NOT call api.compare.
 *   - Rename preserves coordinates.
 *   - Delete (window.confirm => true) removes the row.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
  act,
} from "@testing-library/react";

vi.mock("../api", () => ({
  compare: vi.fn(),
  health: vi.fn(),
  osrmRaw: vi.fn(),
  valhallaRaw: vi.fn(),
  curlImport: vi.fn(),
}));

import * as api from "../api";
import TestCases from "./TestCases";
import { useStore } from "../store";

const START = { lat: 28.78, lon: 76.87 };
const DEST = { lat: 28.2, lon: 77.45 };

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  useStore.setState({
    start: null,
    dest: null,
    testCases: [],
    assessments: {},
    currentTestCaseId: null,
    fitRequestId: 0,
  });
});

describe("TestCases", () => {
  it("disables Save when coordinates are missing and enables it when set", () => {
    const { rerender } = render(<TestCases />);
    expect(
      screen.getByRole("button", { name: /save current test/i }),
    ).toBeDisabled();

    useStore.setState({ start: START, dest: DEST });
    rerender(<TestCases />);
    expect(
      screen.getByRole("button", { name: /save current test/i }),
    ).toBeEnabled();
  });

  it("Save adds a row with the current coordinates", () => {
    useStore.setState({ start: START, dest: DEST });
    render(<TestCases />);

    fireEvent.change(screen.getByLabelText("New test case name"), {
      target: { value: "Delhi run" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save current test/i }));

    expect(screen.getByText("Delhi run")).toBeInTheDocument();
    expect(useStore.getState().testCases).toHaveLength(1);
  });

  it("Load restores coords and NEVER calls api.compare (LOAD != RUN)", () => {
    useStore.setState({ start: START, dest: DEST });
    render(<TestCases />);
    fireEvent.click(screen.getByRole("button", { name: /save current test/i }));

    // Clear coords in the store to prove Load restores them.
    useStore.setState({ start: null, dest: null });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^load$/i }));
    });

    const state = useStore.getState();
    expect(state.start).toEqual(START);
    expect(state.dest).toEqual(DEST);
    expect(api.compare).not.toHaveBeenCalled();
  });

  it("Rename preserves coordinates", () => {
    useStore.setState({ start: START, dest: DEST });
    render(<TestCases />);
    fireEvent.change(screen.getByLabelText("New test case name"), {
      target: { value: "Original" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save current test/i }));

    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByLabelText(/rename original/i);
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const tc = useStore.getState().testCases[0];
    expect(tc.name).toBe("Renamed");
    expect(tc.start).toEqual(START);
    expect(tc.dest).toEqual(DEST);
  });

  it("Delete removes the row when confirmed", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    useStore.setState({ start: START, dest: DEST });
    render(<TestCases />);
    fireEvent.change(screen.getByLabelText("New test case name"), {
      target: { value: "ToDelete" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save current test/i }));
    expect(screen.getByText("ToDelete")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(useStore.getState().testCases).toHaveLength(0);
    expect(screen.queryByText("ToDelete")).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("shows an empty state when no test cases are saved", () => {
    render(<TestCases />);
    expect(screen.getByText(/no saved test cases yet/i)).toBeInTheDocument();
  });

  it("indicates which test case is currently loaded", () => {
    useStore.setState({ start: START, dest: DEST });
    render(<TestCases />);
    fireEvent.click(screen.getByRole("button", { name: /save current test/i }));

    const row = screen.getByRole("listitem");
    expect(within(row).getByText(/\(loaded\)/i)).toBeInTheDocument();
  });
});

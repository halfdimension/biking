/**
 * Tests for the collapsible JSON tree viewer (Task 24.1, Req 11.2, 11.5, 11.6).
 *
 * JsonViewer has no store or map dependency, so it renders in isolation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import JsonViewer, { LARGE_THRESHOLD } from "./JsonViewer";

beforeEach(() => {
  cleanup();
});

describe("JsonViewer", () => {
  it("renders nested objects and arrays with all keys", () => {
    render(
      <JsonViewer
        value={{
          code: "Ok",
          routes: [{ distance: 1000, legs: [{ steps: [] }] }],
        }}
      />,
    );
    expect(screen.getByText("code")).toBeInTheDocument();
    expect(screen.getByText("routes")).toBeInTheDocument();
    expect(screen.getByText("distance")).toBeInTheDocument();
    expect(screen.getByText("legs")).toBeInTheDocument();
    expect(screen.getByText("steps")).toBeInTheDocument();
    expect(screen.getByText('"Ok"')).toBeInTheDocument();
    expect(screen.getByText("1000")).toBeInTheDocument();
  });

  it("shows custom / unknown keys, never dropping any field (Req 11.5, 11.6)", () => {
    render(
      <JsonViewer
        value={{
          turn_id: 42,
          from_linkId_idx: 1,
          to_linkId_idx: 2,
          from_node_idx: 3,
          to_node_idx: 4,
          some_totally_unknown_key: "keepme",
        }}
      />,
    );
    for (const key of [
      "turn_id",
      "from_linkId_idx",
      "to_linkId_idx",
      "from_node_idx",
      "to_node_idx",
      "some_totally_unknown_key",
    ]) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
    expect(screen.getByText('"keepme"')).toBeInTheDocument();
  });

  it("renders primitives: string, number, boolean, null", () => {
    render(
      <JsonViewer
        value={{ s: "hi", n: 3.14, bTrue: true, bFalse: false, nothing: null }}
      />,
    );
    expect(screen.getByText('"hi"')).toBeInTheDocument();
    expect(screen.getByText("3.14")).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
    expect(screen.getByText("false")).toBeInTheDocument();
    expect(screen.getByText("null")).toBeInTheDocument();
  });

  it("collapses a large array (> threshold) by default with an items summary and expands on click", () => {
    // Use string values distinct from their indices so a rendered value can be
    // told apart from the index key it sits under.
    const big = Array.from(
      { length: LARGE_THRESHOLD + 5 },
      (_, i) => `val-${i}`,
    );
    render(<JsonViewer value={{ annotations: big }} />);

    // The large array is collapsed: its summary is visible, its entries are not.
    const summary = screen.getByText(`${big.length} items`);
    expect(summary).toBeInTheDocument();
    // A value deep in the array should not be rendered yet.
    expect(
      screen.queryByText(`"val-${LARGE_THRESHOLD + 4}"`),
    ).not.toBeInTheDocument();

    fireEvent.click(summary);
    // After expanding, entries are rendered.
    expect(
      screen.getByText(`"val-${LARGE_THRESHOLD + 4}"`),
    ).toBeInTheDocument();
  });

  it("keeps small containers expanded by default", () => {
    render(<JsonViewer value={{ a: 1, b: 2 }} />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("toggles an object node collapse via its caret", () => {
    render(<JsonViewer value={{ outer: { inner: "v" } }} />);
    expect(screen.getByText('"v"')).toBeInTheDocument();

    // The 'outer' node's caret collapses it, hiding inner.
    const outerRow = screen.getByText("outer").closest(".json-viewer__row")!;
    const caret = within(outerRow as HTMLElement).getByRole("button");
    fireEvent.click(caret);
    expect(screen.queryByText('"v"')).not.toBeInTheDocument();
  });
});

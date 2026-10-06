/**
 * Component tests for the Raw_Response_Inspector (Task 24.1, Req 11.1–11.6).
 *
 * RawResponseInspector does not import maplibre-gl, so it renders in isolation.
 * The store is seeded via `useStore.setState` and reset before every test.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import RawResponseInspector from "./RawResponseInspector";
import { useStore } from "../store";
import type { EngineError, EngineResult } from "../types";

/** A minimal OK EngineResult carrying an arbitrary raw body. */
function okResult(
  engine: "osrm" | "valhalla",
  raw: unknown,
  httpStatus = 200,
): EngineResult {
  return {
    engine,
    status: "ok",
    httpStatus,
    durationMs: 12,
    normalizedRoutes: [],
    raw,
    warnings: [],
    error: null,
  };
}

/** OSRM-style raw with custom/unknown fields (Req 11.5). */
const OSRM_RAW = {
  code: "Ok",
  routes: [
    {
      distance: 1000,
      duration: 100,
      legs: [
        {
          steps: [
            {
              maneuver: { turn_id: 7, type: "turn" },
              from_linkId_idx: 11,
              to_linkId_idx: 12,
              from_node_idx: 13,
              to_node_idx: 14,
            },
          ],
          annotation: {
            nodes: [1, 2, 3],
            distance: [10, 20],
            duration: [1, 2],
            weight: [1, 2],
            speed: [10, 10],
            datasources: [0, 0],
          },
        },
      ],
    },
  ],
};

const RESET = {
  results: null,
  osrmRawState: { status: "idle" as const, result: null, error: null },
  valhallaRawState: { status: "idle" as const, result: null, error: null },
  compareStatus: "idle" as const,
  latestResponseSource: { osrm: null, valhalla: null },
};

beforeEach(() => {
  cleanup();
  useStore.setState(RESET);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RawResponseInspector", () => {
  it("shows a hint when no response has been produced yet", () => {
    render(<RawResponseInspector engine="osrm" />);
    expect(
      screen.getByText(/No response yet — run Compare or send an Advanced request\./i),
    ).toBeInTheDocument();
  });

  it("renders a compare result's full raw JSON incl. custom OSRM fields (Req 11.5)", () => {
    useStore.setState({
      results: {
        osrm: okResult("osrm", OSRM_RAW),
        valhalla: okResult("valhalla", { trip: {} }),
      },
    });
    render(<RawResponseInspector engine="osrm" />);

    expect(screen.getByTestId("raw-inspector-source-osrm")).toHaveTextContent(
      "Compare",
    );
    for (const key of [
      "turn_id",
      "from_linkId_idx",
      "to_linkId_idx",
      "from_node_idx",
      "to_node_idx",
      "annotation",
      "datasources",
    ]) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
  });

  it("preserves unknown Valhalla custom keys (Req 11.6)", () => {
    const valhallaRaw = {
      trip: {
        legs: [{ maneuvers: [{ type: 1 }], summary: { length: 5 } }],
        summary: { length: 5, time: 300 },
      },
      alternates: [],
      my_custom_engine_field: "should-show",
    };
    useStore.setState({
      results: {
        osrm: okResult("osrm", { code: "Ok", routes: [] }),
        valhalla: okResult("valhalla", valhallaRaw),
      },
    });
    render(<RawResponseInspector engine="valhalla" />);

    for (const key of [
      "trip",
      "alternates",
      "legs",
      "maneuvers",
      "my_custom_engine_field",
    ]) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
    // `summary` legitimately appears twice (leg summary + trip summary).
    expect(screen.getAllByText("summary").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('"should-show"')).toBeInTheDocument();
  });

  it("prefers the Advanced raw result over the Compare result and labels the source", () => {
    useStore.setState({
      results: {
        osrm: okResult("osrm", { code: "Ok", from_compare: true }),
        valhalla: okResult("valhalla", { trip: {} }),
      },
      osrmRawState: {
        status: "done",
        result: okResult("osrm", { code: "Ok", from_raw: true }),
        error: null,
      },
      latestResponseSource: { osrm: "raw", valhalla: null },
    });
    render(<RawResponseInspector engine="osrm" />);

    expect(screen.getByTestId("raw-inspector-source-osrm")).toHaveTextContent(
      "Advanced raw",
    );
    expect(screen.getByText("from_raw")).toBeInTheDocument();
    expect(screen.queryByText("from_compare")).not.toBeInTheDocument();
  });

  it("labels a protobuf-derived Valhalla Compare response explicitly", () => {
    useStore.setState({
      results: {
        osrm: okResult("osrm", { code: "Ok" }),
        valhalla: {
          ...okResult("valhalla", { directions: {}, trip: {} }),
          rawSource: "protobuf-derived",
        },
      },
      latestResponseSource: { osrm: "compare", valhalla: "compare" },
    });
    render(<RawResponseInspector engine="valhalla" />);

    expect(screen.getByTestId("raw-inspector-source-valhalla")).toHaveTextContent(
      "Compare · Local · Protobuf-derived",
    );
  });

  it("shows an error block AND the raw body when an errored result carries a body (Req 11.4)", () => {
    const error: EngineError = {
      kind: "http_error",
      message: "OSRM returned HTTP 400",
    };
    useStore.setState({
      results: {
        osrm: {
          ...okResult("osrm", { error_body: "bad request details" }, 400),
          status: "error",
          error,
        },
        valhalla: okResult("valhalla", { trip: {} }),
      },
    });
    render(<RawResponseInspector engine="osrm" />);

    expect(screen.getByRole("alert")).toHaveTextContent("http_error");
    expect(screen.getByRole("alert")).toHaveTextContent("OSRM returned HTTP 400");
    // The raw body is still shown below the error.
    expect(screen.getByText("error_body")).toBeInTheDocument();
    expect(screen.getByText('"bad request details"')).toBeInTheDocument();
  });

  it("shows Loading… while a raw send is in flight", () => {
    useStore.setState({
      osrmRawState: { status: "loading", result: null, error: null },
    });
    render(<RawResponseInspector engine="osrm" />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it("Copy JSON writes the full pretty-printed raw to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    useStore.setState({
      results: {
        osrm: okResult("osrm", OSRM_RAW),
        valhalla: okResult("valhalla", { trip: {} }),
      },
    });
    render(<RawResponseInspector engine="osrm" />);

    fireEvent.click(screen.getByRole("button", { name: /Copy JSON/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(OSRM_RAW, null, 2));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("does not crash when clipboard is unavailable and still confirms Copied", async () => {
    // Simulate a non-secure context: no clipboard.
    Object.assign(navigator, { clipboard: undefined });
    useStore.setState({
      results: {
        osrm: okResult("osrm", { code: "Ok" }),
        valhalla: okResult("valhalla", { trip: {} }),
      },
    });
    render(<RawResponseInspector engine="osrm" />);
    fireEvent.click(screen.getByRole("button", { name: /Copy JSON/i }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });
});

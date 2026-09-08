/**
 * Component tests for the per-engine status panel (Task 28.1,
 * Req 17.1, 17.2, 17.3, 17.8, 17.9, 17.12, 17.13).
 *
 * `EngineStatusPanel` and `ComparisonTable` do not import maplibre-gl, so they
 * render in isolation. The store is seeded via `useStore.setState` with MOCKED
 * `CompareResponse` fixtures (never by stopping a real engine) and reset before
 * every test. Covers: actionable per-kind messages, one-engine-failure
 * isolation, zero-alternates != no_route, per-route warning display, and the
 * graceful http_error with a null status code.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import EngineStatusPanel from "./EngineStatusPanel";
import ComparisonTable from "./ComparisonTable";
import { useStore } from "../store";
import { flattenRoutes } from "../store";
import type {
  CompareResponse,
  Engine,
  EngineError,
  EngineResult,
  NormalizedRoute,
  RouteWarning,
} from "../types";

function route(engine: Engine, index: number): NormalizedRoute {
  const name = engine === "osrm" ? "OSRM" : "Valhalla";
  return {
    id: `${engine}:${index}`,
    engine,
    index,
    isPrimary: index === 0,
    label: index === 0 ? `${name} Primary` : `${name} Alt ${index}`,
    coordinates: [
      [77.6, 12.9],
      [77.65, 12.95],
    ],
    distanceMeters: 1000 + index,
    durationSeconds: 500 + index,
    cost: 80 + index,
    raw: {},
  };
}

function okEngine(
  engine: Engine,
  routes: NormalizedRoute[],
  warnings: RouteWarning[] = [],
): EngineResult {
  return {
    engine,
    status: "ok",
    httpStatus: 200,
    durationMs: 12,
    normalizedRoutes: routes,
    raw: {},
    warnings,
    error: null,
  };
}

function errorEngine(
  engine: Engine,
  error: EngineError,
  httpStatus: number | null = null,
): EngineResult {
  return {
    engine,
    status: "error",
    httpStatus,
    durationMs: 4,
    normalizedRoutes: [],
    raw: null,
    warnings: [],
    error,
  };
}

function seed(results: CompareResponse) {
  useStore.setState({ results, routes: flattenRoutes(results) });
}

beforeEach(() => {
  cleanup();
  useStore.setState({ results: null, routes: [], selectedRouteId: null });
});

describe("EngineStatusPanel — idle and error states", () => {
  it("shows a muted idle hint when no compare has run", () => {
    render(<EngineStatusPanel engine="osrm" />);
    expect(screen.getByTestId("engine-status-osrm")).toBeInTheDocument();
    expect(screen.queryByTestId("engine-error-osrm")).not.toBeInTheDocument();
  });

  it("renders an actionable unreachable message with the engine label (Req 17.1)", () => {
    seed({
      osrm: errorEngine("osrm", { kind: "unreachable", message: "" }),
      valhalla: okEngine("valhalla", [route("valhalla", 0)]),
    });
    render(<EngineStatusPanel engine="osrm" />);

    const alert = screen.getByTestId("engine-error-osrm");
    expect(alert).toHaveAttribute("role", "alert");
    // Exact clean actionable text — no stack trace, no raw detail dump.
    expect(alert).toHaveTextContent("OSRM is unreachable at localhost:5000.");
    expect(alert).toHaveTextContent(/OSRM/);
    expect(alert).not.toHaveTextContent(/Failed to fetch/i);
  });

  it("renders a timeout message (Req 17.12)", () => {
    seed({
      osrm: okEngine("osrm", [route("osrm", 0)]),
      valhalla: errorEngine("valhalla", { kind: "timeout", message: "" }),
    });
    render(<EngineStatusPanel engine="valhalla" />);
    expect(screen.getByTestId("engine-error-valhalla")).toHaveTextContent(
      "Valhalla request timed out.",
    );
  });

  it("renders a no_route message (Req 17.8)", () => {
    seed({
      osrm: errorEngine("osrm", { kind: "no_route", message: "" }),
      valhalla: okEngine("valhalla", [route("valhalla", 0)]),
    });
    render(<EngineStatusPanel engine="osrm" />);
    expect(screen.getByTestId("engine-error-osrm")).toHaveTextContent(
      "OSRM returned no route for these coordinates.",
    );
  });

  it("renders an invalid_request message", () => {
    seed({
      osrm: errorEngine("osrm", { kind: "invalid_request", message: "" }),
      valhalla: okEngine("valhalla", [route("valhalla", 0)]),
    });
    render(<EngineStatusPanel engine="osrm" />);
    expect(screen.getByTestId("engine-error-osrm")).toHaveTextContent(
      "OSRM rejected the request.",
    );
  });

  it("renders http_error with status code + concise message (Req 17.3)", () => {
    seed({
      osrm: errorEngine(
        "osrm",
        { kind: "http_error", message: "Internal Server Error" },
        500,
      ),
      valhalla: okEngine("valhalla", [route("valhalla", 0)]),
    });
    render(<EngineStatusPanel engine="osrm" />);
    const alert = screen.getByTestId("engine-error-osrm");
    expect(alert).toHaveTextContent("HTTP 500");
    expect(alert).toHaveTextContent("Internal Server Error");
  });

  it("renders http_error gracefully when httpStatus is null (no 'HTTP null')", () => {
    seed({
      osrm: errorEngine("osrm", { kind: "http_error", message: "" }, null),
      valhalla: okEngine("valhalla", [route("valhalla", 0)]),
    });
    render(<EngineStatusPanel engine="osrm" />);
    const alert = screen.getByTestId("engine-error-osrm");
    expect(alert).not.toHaveTextContent(/HTTP null/);
    expect(alert).toHaveTextContent("OSRM returned an HTTP error.");
  });
});

describe("EngineStatusPanel — ok, zero-alternates, warnings", () => {
  it("shows an OK badge (not an error) when the engine succeeds", () => {
    seed({
      osrm: okEngine("osrm", [route("osrm", 0), route("osrm", 1)]),
      valhalla: okEngine("valhalla", [route("valhalla", 0)]),
    });
    render(<EngineStatusPanel engine="osrm" />);
    expect(screen.getByTestId("engine-ok-osrm")).toBeInTheDocument();
    expect(screen.queryByTestId("engine-error-osrm")).not.toBeInTheDocument();
    // Two routes → no "No alternatives" note.
    expect(
      screen.queryByTestId("engine-no-alternates-osrm"),
    ).not.toBeInTheDocument();
  });

  it("renders the OK status detail with route count and request duration (Req 2.4, 2.5)", () => {
    // okEngine sets durationMs=12 → formatDurationMs → "12 ms". Two routes.
    seed({
      osrm: okEngine("osrm", [route("osrm", 0), route("osrm", 1)]),
      valhalla: okEngine("valhalla", [route("valhalla", 0)]),
    });
    render(<EngineStatusPanel engine="osrm" />);

    const ok = screen.getByTestId("engine-ok-osrm");
    // Per-engine status is "OK", route count is shown, and the measured
    // request duration is surfaced (Req 2.4 status, 2.5 execution time).
    expect(ok).toHaveTextContent("OSRM OK");
    expect(ok).toHaveTextContent("2 routes");
    expect(ok).toHaveTextContent("12 ms");
  });

  it("zero alternates renders a note and is NOT treated as an error (Req 17.9)", () => {
    seed({
      osrm: okEngine("osrm", [route("osrm", 0)]), // primary only
      valhalla: okEngine("valhalla", [route("valhalla", 0), route("valhalla", 1)]),
    });
    render(<EngineStatusPanel engine="osrm" />);

    const note = screen.getByTestId("engine-no-alternates-osrm");
    expect(note).toHaveTextContent("No alternatives returned.");
    // It is NOT an error state.
    expect(screen.queryByTestId("engine-error-osrm")).not.toBeInTheDocument();
    expect(screen.getByTestId("engine-ok-osrm")).toBeInTheDocument();
  });

  it("surfaces a per-route warning identifying engine + index + kind + message (Req 17.8, 17.11)", () => {
    const warning: RouteWarning = {
      engine: "valhalla",
      routeIndex: 1,
      kind: "geometry_error",
      message: "Alternate 1 geometry was undecodable and was dropped.",
    };
    seed({
      osrm: okEngine("osrm", [route("osrm", 0)]),
      valhalla: okEngine("valhalla", [route("valhalla", 0)], [warning]),
    });
    render(<EngineStatusPanel engine="valhalla" />);

    const w = screen.getByTestId("engine-warning-valhalla-1");
    expect(w).toHaveTextContent("Valhalla #1");
    expect(w).toHaveTextContent("geometry_error");
    expect(w).toHaveTextContent(/undecodable and was dropped/i);
    // The valid sibling (primary) still shows an OK status — warning didn't
    // remove the panel or the routes (Req 17.11).
    expect(screen.getByTestId("engine-ok-valhalla")).toBeInTheDocument();
  });
});

describe("Cross-engine isolation (Req 17.13)", () => {
  it("OSRM ok + Valhalla error: OSRM routes render and OSRM shows OK while Valhalla shows its error", () => {
    seed({
      osrm: okEngine("osrm", [route("osrm", 0), route("osrm", 1)]),
      valhalla: errorEngine("valhalla", { kind: "unreachable", message: "" }),
    });
    render(
      <div>
        <EngineStatusPanel engine="osrm" />
        <EngineStatusPanel engine="valhalla" />
        <ComparisonTable />
      </div>,
    );

    // OSRM healthy panel.
    expect(screen.getByTestId("engine-ok-osrm")).toBeInTheDocument();
    expect(screen.queryByTestId("engine-error-osrm")).not.toBeInTheDocument();
    // Valhalla error panel.
    expect(screen.getByTestId("engine-error-valhalla")).toHaveTextContent(
      "Valhalla is unreachable at localhost:8002.",
    );
    // OSRM routes still render in the comparison table.
    expect(
      screen.getByTestId("comparison-row-osrm:0"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("comparison-row-osrm:1"),
    ).toBeInTheDocument();
    // No Valhalla rows (it errored) — but the table is NOT gated/hidden.
    expect(
      screen.queryByTestId("comparison-row-valhalla:0"),
    ).not.toBeInTheDocument();
  });

  it("Valhalla ok + OSRM error: the reverse isolation holds", () => {
    seed({
      osrm: errorEngine(
        "osrm",
        { kind: "http_error", message: "Internal Server Error" },
        500,
      ),
      valhalla: okEngine("valhalla", [route("valhalla", 0)]),
    });
    render(
      <div>
        <EngineStatusPanel engine="osrm" />
        <EngineStatusPanel engine="valhalla" />
        <ComparisonTable />
      </div>,
    );

    expect(screen.getByTestId("engine-error-osrm")).toHaveTextContent(
      "HTTP 500",
    );
    const vOk = screen.getByTestId("engine-ok-valhalla");
    expect(vOk).toBeInTheDocument();
    expect(within(vOk).getByText(/No alternatives returned\./)).toBeInTheDocument();
    expect(
      screen.getByTestId("comparison-row-valhalla:0"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("comparison-row-osrm:0"),
    ).not.toBeInTheDocument();
  });
});

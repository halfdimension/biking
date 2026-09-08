/**
 * Component tests for the Curl Import panel (Task 25.1, Req 10.1, 10.2, 17.7).
 *
 * The panel drives the store's `sendCurlImport`, which calls `api.curlImport`.
 * We mock `../api` so no network is touched, then assert:
 *   - two textareas + two Import buttons render (Req 10.1),
 *   - an empty area shows the local "Paste a curl command first." error and
 *     does NOT call the backend (Req 17.7),
 *   - a non-empty Import sends the EXACT pasted string to `api.curlImport`,
 *   - a rejected import shows the backend error near the submitted area (Req 10.2),
 *   - a successful import shows the resolved engine + route-count summary.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

vi.mock("../api", () => ({
  compare: vi.fn(),
  health: vi.fn(),
  osrmRaw: vi.fn(),
  valhallaRaw: vi.fn(),
  curlImport: vi.fn(),
}));

import * as api from "../api";
import CurlImport from "./CurlImport";
import { useStore } from "../store";
import type { EngineResult, NormalizedRoute } from "../types";

function route(engine: "osrm" | "valhalla", index: number): NormalizedRoute {
  return {
    id: `${engine}:${index}`,
    engine,
    index,
    isPrimary: index === 0,
    label: `${engine} ${index}`,
    coordinates: [
      [77.6, 12.9],
      [77.65, 12.95],
    ],
    distanceMeters: 1000,
    durationSeconds: 100,
    cost: 50,
    raw: {},
  };
}

function okResult(
  engine: "osrm" | "valhalla",
  routes: NormalizedRoute[],
): EngineResult {
  return {
    engine,
    status: "ok",
    httpStatus: 200,
    durationMs: 8,
    normalizedRoutes: routes,
    raw: {},
    warnings: [],
    error: null,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useStore.setState({
    routes: [],
    visibility: {},
    selectedRouteId: null,
    compareStatus: "idle",
    lastError: null,
    osrmRawState: { status: "idle", result: null, error: null },
    valhallaRawState: { status: "idle", result: null, error: null },
    curlImportState: { status: "idle", engine: null, result: null, error: null },
  });
});

describe("CurlImport", () => {
  it("renders two textareas and two Import buttons", () => {
    render(<CurlImport />);
    expect(screen.getByLabelText("OSRM curl command")).toBeInTheDocument();
    expect(screen.getByLabelText("Valhalla curl command")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import osrm curl/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import valhalla curl/i }),
    ).toBeInTheDocument();
  });

  it("shows a local error and does not call the backend for an empty area", () => {
    render(<CurlImport />);
    fireEvent.click(screen.getByRole("button", { name: /import osrm curl/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      /paste a curl command first/i,
    );
    expect(api.curlImport).not.toHaveBeenCalled();
  });

  it("sends the EXACT pasted string to api.curlImport", async () => {
    vi.mocked(api.curlImport).mockResolvedValue({
      engine: "osrm",
      result: okResult("osrm", [route("osrm", 0)]),
    });
    render(<CurlImport />);

    const pasted =
      "curl 'http://localhost:5000/route/v1/biking/1,1;2,2?steps=true'";
    fireEvent.change(screen.getByLabelText("OSRM curl command"), {
      target: { value: pasted },
    });
    fireEvent.click(screen.getByRole("button", { name: /import osrm curl/i }));

    await waitFor(() => expect(api.curlImport).toHaveBeenCalledTimes(1));
    expect(api.curlImport).toHaveBeenCalledWith(pasted);
  });

  it("shows the backend error message near the submitted area on rejection", async () => {
    vi.mocked(api.curlImport).mockRejectedValue(
      new Error("The curl command targets a host that is not allowed."),
    );
    render(<CurlImport />);

    fireEvent.change(screen.getByLabelText("Valhalla curl command"), {
      target: { value: "curl http://evil.example/route" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /import valhalla curl/i }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /host that is not allowed/i,
      ),
    );
  });

  it("shows the engine and route-count summary on success", async () => {
    vi.mocked(api.curlImport).mockResolvedValue({
      engine: "osrm",
      result: okResult("osrm", [route("osrm", 0), route("osrm", 1)]),
    });
    render(<CurlImport />);

    fireEvent.change(screen.getByLabelText("OSRM curl command"), {
      target: { value: "curl 'http://localhost:5000/route/v1/biking/1,1;2,2'" },
    });
    fireEvent.click(screen.getByRole("button", { name: /import osrm curl/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/OSRM/);
    expect(status).toHaveTextContent(/2 routes/);
    expect(status).toHaveTextContent(/HTTP 200/);
  });
});

/**
 * Component tests for the Valhalla raw request editor (Task 23.1, Req 9.6, 9.7, 17.5).
 *
 * Mocks `../api` so `api.valhallaRaw` is observable. Asserts:
 *   - invalid JSON body blocks Send (api not called) and shows a JSON error (Req 17.5),
 *   - a valid body with edited options is sent VERBATIM as a parsed object —
 *     `alternates === 3` and `costing === "motorcycle"` (no silent overwrite, Req 9.7),
 *   - Reset repopulates the canonical body (alternates 10, costing motorcycle).
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
import ValhallaRawRequest from "./ValhallaRawRequest";
import { useStore } from "../store";
import type { EngineResult } from "../types";

function okResult(): EngineResult {
  return {
    engine: "valhalla",
    status: "ok",
    httpStatus: 200,
    durationMs: 5,
    normalizedRoutes: [],
    raw: {},
    warnings: [],
    error: null,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useStore.setState({
    start: null,
    dest: null,
    valhallaUrlDraft: "",
    valhallaBodyDraft: "",
    valhallaRawState: { status: "idle", result: null, error: null },
    routes: [],
    visibility: {},
    selectedRouteId: null,
    compareStatus: "idle",
    lastError: null,
  });
});

describe("ValhallaRawRequest", () => {
  it("blocks Send on invalid JSON and shows a JSON error (Req 17.5)", () => {
    useStore.setState({ valhallaBodyDraft: "{ not: valid json " });
    render(<ValhallaRawRequest />);

    fireEvent.click(
      screen.getByRole("button", { name: /send valhalla request/i }),
    );

    expect(api.valhallaRaw).not.toHaveBeenCalled();
    // Send-time error (role=alert) plus the live indicator both flag invalid.
    expect(screen.getByRole("alert")).toHaveTextContent(/invalid json/i);
    expect(screen.getByTestId("valhalla-json-indicator")).toHaveTextContent(
      /invalid json/i,
    );
  });

  it("sends the exact parsed body verbatim (alternates 3, costing motorcycle) (Req 9.7)", async () => {
    vi.mocked(api.valhallaRaw).mockResolvedValue(okResult());
    const body = JSON.stringify(
      {
        locations: [
          { lat: 1, lon: 1, type: "break" },
          { lat: 2, lon: 2, type: "break" },
        ],
        costing: "motorcycle",
        alternates: 3,
        shape_format: "polyline6",
        directions_options: { units: "miles" },
      },
      null,
      2,
    );
    useStore.setState({
      valhallaUrlDraft: "http://localhost:8002/route",
      valhallaBodyDraft: body,
    });
    render(<ValhallaRawRequest />);

    fireEvent.click(
      screen.getByRole("button", { name: /send valhalla request/i }),
    );

    await waitFor(() => expect(api.valhallaRaw).toHaveBeenCalledTimes(1));
    const [url, sentBody] = vi.mocked(api.valhallaRaw).mock.calls[0];
    expect(url).toBe("http://localhost:8002/route");
    expect((sentBody as { alternates: number }).alternates).toBe(3);
    expect((sentBody as { costing: string }).costing).toBe("motorcycle");
    // Verbatim: units and shape_format are not overwritten.
    expect(
      (sentBody as { directions_options: { units: string } }).directions_options
        .units,
    ).toBe("miles");
  });

  it("Reset repopulates the canonical body (alternates 10, costing motorcycle)", () => {
    useStore.setState({
      start: { lat: 28.5, lon: 76.8 },
      dest: { lat: 28.2, lon: 77.4 },
      valhallaBodyDraft: '{"costing":"pedestrian","alternates":0}',
    });
    render(<ValhallaRawRequest />);

    fireEvent.click(screen.getByRole("button", { name: /reset to canonical/i }));

    const textarea = screen.getByLabelText(
      "Valhalla JSON body",
    ) as HTMLTextAreaElement;
    const parsed = JSON.parse(textarea.value);
    expect(parsed.alternates).toBe(10);
    expect(parsed.costing).toBe("motorcycle");
  });
});

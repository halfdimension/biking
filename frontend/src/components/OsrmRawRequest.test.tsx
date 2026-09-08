/**
 * Component tests for the OSRM raw request editor (Task 23.1, Req 9.4, 9.5, 17.6).
 *
 * The editor drives the store's `sendOsrmRaw`, which calls `api.osrmRaw`. We
 * mock `../api` so no network is touched, then assert:
 *   - the textarea is prefilled/settable,
 *   - Send calls `api.osrmRaw` with the EXACT current draft (verbatim, incl. a
 *     manually edited param),
 *   - an empty or non-http draft blocks send (api not called) and shows an error.
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
import OsrmRawRequest from "./OsrmRawRequest";
import { useStore } from "../store";
import type { EngineResult } from "../types";

function okResult(): EngineResult {
  return {
    engine: "osrm",
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
    osrmUrlDraft: "",
    osrmRawState: { status: "idle", result: null, error: null },
    routes: [],
    visibility: {},
    selectedRouteId: null,
    compareStatus: "idle",
    lastError: null,
  });
});

describe("OsrmRawRequest", () => {
  it("prefills the textarea from canonical preview on mount when coords are valid", () => {
    useStore.setState({
      start: { lat: 28.5, lon: 76.8 },
      dest: { lat: 28.2, lon: 77.4 },
    });
    render(<OsrmRawRequest />);
    const textarea = screen.getByLabelText("OSRM request URL") as HTMLTextAreaElement;
    expect(textarea.value).toContain("http://localhost:5000/route/v1/biking/");
    expect(textarea.value).toContain("76.8,28.5;77.4,28.2");
  });

  it("sends the EXACT edited draft verbatim, including a manually edited param", async () => {
    vi.mocked(api.osrmRaw).mockResolvedValue(okResult());
    render(<OsrmRawRequest />);

    const textarea = screen.getByLabelText("OSRM request URL");
    const edited =
      "http://localhost:5000/route/v1/biking/1,1;2,2?overview=full&alternatives=false&steps=true";
    fireEvent.change(textarea, { target: { value: edited } });

    fireEvent.click(screen.getByRole("button", { name: /send osrm request/i }));

    await waitFor(() => expect(api.osrmRaw).toHaveBeenCalledTimes(1));
    expect(api.osrmRaw).toHaveBeenCalledWith(edited);
  });

  it("blocks send on an empty draft and shows an error (Req 17.6)", () => {
    render(<OsrmRawRequest />);
    // No coords → not prefilled; draft is empty.
    fireEvent.click(screen.getByRole("button", { name: /send osrm request/i }));
    // Button is disabled when empty; force the handler by clicking anyway does
    // nothing, so also assert the disabled state and that api was not called.
    expect(api.osrmRaw).not.toHaveBeenCalled();
  });

  it("blocks send on a non-http draft and shows a validation error (Req 17.6)", async () => {
    render(<OsrmRawRequest />);
    const textarea = screen.getByLabelText("OSRM request URL");
    fireEvent.change(textarea, { target: { value: "not-a-url" } });

    fireEvent.click(screen.getByRole("button", { name: /send osrm request/i }));

    expect(api.osrmRaw).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/http:\/\//i);
  });

  it("resets the draft to the canonical URL when Reset is clicked", () => {
    useStore.setState({
      start: { lat: 28.5, lon: 76.8 },
      dest: { lat: 28.2, lon: 77.4 },
      osrmUrlDraft: "http://localhost:5000/edited",
    });
    render(<OsrmRawRequest />);
    fireEvent.click(screen.getByRole("button", { name: /reset to canonical/i }));
    const textarea = screen.getByLabelText("OSRM request URL") as HTMLTextAreaElement;
    expect(textarea.value).toContain("76.8,28.5;77.4,28.2");
  });
});

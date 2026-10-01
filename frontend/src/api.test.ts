import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_BASE_URL, compare, health } from "./api";
import type { CompareResponse } from "./types";

function makeCompareResponse(): CompareResponse {
  const empty = {
    engine: "osrm" as const,
    status: "ok" as const,
    httpStatus: 200,
    durationMs: 5,
    normalizedRoutes: [],
    raw: null,
    warnings: [],
    error: null,
  };
  return {
    osrm: { ...empty, engine: "osrm" },
    valhalla: { ...empty, engine: "valhalla" },
  };
}

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compare posts to /api/compare with start/dest body", async () => {
    const responseBody = makeCompareResponse();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => responseBody,
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const start = { lat: 12.9, lon: 77.6 };
    const dest = { lat: 12.95, lon: 77.65 };
    const result = await compare(start, dest);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/api/compare`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ start, dest });
    expect(result).toEqual(responseBody);
  });

  it("adds includeDebug only when explicitly enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeCompareResponse(),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const start = { lat: 12.9, lon: 77.6 };
    const dest = { lat: 12.95, lon: 77.65 };
    await compare(start, dest, true);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ start, dest, includeDebug: true });
  });

  it("compare throws with the response detail on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ detail: "bad coordinates" }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      compare({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }),
    ).rejects.toThrow("bad coordinates");
  });

  it("health returns unknown/unknown when fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await health();
    expect(result).toEqual({ osrm: "unknown", valhalla: "unknown" });
  });

  it("health returns unknown/unknown on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await health();
    expect(result).toEqual({ osrm: "unknown", valhalla: "unknown" });
  });

  it("health returns parsed body on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ osrm: "reachable", valhalla: "unreachable" }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await health();
    expect(result).toEqual({ osrm: "reachable", valhalla: "unreachable" });
  });
});

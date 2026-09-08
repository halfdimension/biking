/**
 * Unit tests for the pure request preview builders and coordinate validators
 * (Task 14.1). Covers validation boundaries, OSRM lon,lat ordering + default
 * params, and the canonical Valhalla body shape/options.
 */
import { describe, it, expect } from "vitest";
import {
  isValidLat,
  isValidLon,
  buildOsrmPreviewUrl,
  buildValhallaPreviewBody,
  buildValhallaPreviewJson,
} from "./requests";

describe("isValidLat", () => {
  it("accepts the boundary values 90 and -90", () => {
    expect(isValidLat(90)).toBe(true);
    expect(isValidLat(-90)).toBe(true);
    expect(isValidLat(0)).toBe(true);
  });

  it("rejects values outside [-90, 90]", () => {
    expect(isValidLat(90.1)).toBe(false);
    expect(isValidLat(-90.1)).toBe(false);
    expect(isValidLat(180)).toBe(false);
  });

  it("rejects non-finite values", () => {
    expect(isValidLat(NaN)).toBe(false);
    expect(isValidLat(Infinity)).toBe(false);
    expect(isValidLat(-Infinity)).toBe(false);
  });
});

describe("isValidLon", () => {
  it("accepts the boundary values 180 and -180", () => {
    expect(isValidLon(180)).toBe(true);
    expect(isValidLon(-180)).toBe(true);
    expect(isValidLon(0)).toBe(true);
  });

  it("rejects values outside [-180, 180]", () => {
    expect(isValidLon(181)).toBe(false);
    expect(isValidLon(-181)).toBe(false);
  });

  it("rejects non-finite values", () => {
    expect(isValidLon(NaN)).toBe(false);
    expect(isValidLon(Infinity)).toBe(false);
  });
});

describe("buildOsrmPreviewUrl", () => {
  const start = { lat: 28.78447495380769, lon: 76.87892122549387 };
  const dest = { lat: 28.207132203283837, lon: 77.45894473456683 };

  it("emits coordinates in lon,lat;lon,lat order", () => {
    const url = buildOsrmPreviewUrl(start, dest);
    expect(url).toContain(
      `/route/v1/biking/${start.lon},${start.lat};${dest.lon},${dest.lat}?`,
    );
  });

  it("contains all canonical default params", () => {
    const url = buildOsrmPreviewUrl(start, dest);
    expect(url).toContain("overview=full");
    expect(url).toContain("geometries=polyline6");
    expect(url).toContain("alternatives=true");
    expect(url).toContain(
      "annotations=nodes,distance,duration,weight,speed,datasources",
    );
    expect(url).toContain("steps=true");
  });

  it("uses the default base url and allows an override", () => {
    expect(buildOsrmPreviewUrl(start, dest)).toContain(
      "http://localhost:5000/route/v1/biking/",
    );
    expect(buildOsrmPreviewUrl(start, dest, "http://example:9999")).toContain(
      "http://example:9999/route/v1/biking/",
    );
  });
});

describe("buildValhallaPreviewBody", () => {
  const start = { lat: 28.78447495380769, lon: 76.87892122549387 };
  const dest = { lat: 28.207132203283837, lon: 77.45894473456683 };

  it("uses the canonical default options", () => {
    const body = buildValhallaPreviewBody(start, dest);
    expect(body.costing).toBe("motorcycle");
    expect(body.alternates).toBe(10);
    expect(body.shape_format).toBe("polyline6");
    expect(body.directions_options.units).toBe("kilometers");
  });

  it("emits locations as lat/lon type break entries in order", () => {
    const body = buildValhallaPreviewBody(start, dest);
    expect(body.locations).toEqual([
      { lat: start.lat, lon: start.lon, type: "break" },
      { lat: dest.lat, lon: dest.lon, type: "break" },
    ]);
  });

  it("buildValhallaPreviewJson pretty-prints the body", () => {
    const json = buildValhallaPreviewJson(start, dest);
    expect(json).toBe(JSON.stringify(buildValhallaPreviewBody(start, dest), null, 2));
    expect(JSON.parse(json).costing).toBe("motorcycle");
  });
});

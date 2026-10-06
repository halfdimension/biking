/**
 * Unit tests for the pure request preview builders and coordinate validators
 * (Task 14.1). Covers validation boundaries, OSRM lon,lat ordering + default
 * params, and the canonical Valhalla body shape/options.
 */
import { describe, it, expect } from "vitest";
import canonicalRequestDefaults from "../../shared/canonical_request_defaults.json";
import {
  isValidLat,
  isValidLon,
  buildOsrmPreviewUrl,
  buildValhallaPreviewBody,
  buildValhallaPreviewJson,
  DEFAULT_OSRM_QUERY,
  buildProdOsrmPreviewUrl,
  buildProdValhallaPreviewUrl,
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

describe("cross-language canonical request contract", () => {
  const start = { lat: 28.78447495380769, lon: 76.87892122549387 };
  const dest = { lat: 28.207132203283837, lon: 77.45894473456683 };

  it("keeps the frontend OSRM query byte-identical to the backend contract", () => {
    expect(DEFAULT_OSRM_QUERY).toBe(canonicalRequestDefaults.osrmQuery);
    expect(buildOsrmPreviewUrl(start, dest)).toBe(
      `http://localhost:5000/route/v1/biking/${start.lon},${start.lat};${dest.lon},${dest.lat}?${canonicalRequestDefaults.osrmQuery}`,
    );
  });

  it("keeps the parsed Valhalla preview semantically identical to the backend contract", () => {
    expect(buildValhallaPreviewBody(start, dest)).toEqual({
      locations: [
        { lat: start.lat, lon: start.lon, type: "break" },
        { lat: dest.lat, lon: dest.lon, type: "break" },
      ],
      ...canonicalRequestDefaults.valhallaOptions,
    });
    expect(JSON.parse(buildValhallaPreviewJson(start, dest))).toEqual(
      buildValhallaPreviewBody(start, dest),
    );
  });
});


describe("production request previews", () => {
  const start = { lat: 28.651770012429765, lon: 77.36783435642826 };
  const dest = { lat: 28.631769137973578, lon: 77.11696030930938 };

  it("shows the exact Prod OSRM semantics with a placeholder token", () => {
    const url = buildProdOsrmPreviewUrl(start, dest);
    expect(url).toContain("/advancedmaps/v1/<TOKEN>/route_adv/biking/");
    expect(url).toContain(`${start.lon},${start.lat};${dest.lon},${dest.lat}`);
    expect(url).toContain("steps=false");
    expect(url).not.toContain("steps=true");
    expect(url).toContain("geometries=polyline6");
    expect(url).toContain("annotations=nodes,distance,duration,weight,speed,datasources");
  });

  it("shows Prod Valhalla query semantics without any real token", () => {
    const url = buildProdValhallaPreviewUrl(start, dest);
    expect(url).toContain("access_token=<TOKEN>");
    expect(url).toContain("profile=biking");
    const parsed = new URL(url.replace("<TOKEN>", "TEST_TOKEN_DO_NOT_USE"));
    expect(parsed.searchParams.get("locations")).toBe(
      `${start.lon},${start.lat};${dest.lon},${dest.lat}`,
    );
    expect(parsed.searchParams.get("date_time")).toBe('0,""');
    expect(parsed.searchParams.get("speedTypes")).toBe("traffic");
  });
});

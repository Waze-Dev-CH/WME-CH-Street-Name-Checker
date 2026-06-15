import type { LineString } from "geojson";
import { describe, expect, it } from "vitest";
import { cantonCodeFromName, cantonMapUrl, cantonMapUrlForGeometry } from "../src/canton-map";

describe("cantonCodeFromName", () => {
  it("resolves canton names across languages, case and accents", () => {
    expect(cantonCodeFromName("Neuchâtel")).toBe("ne");
    expect(cantonCodeFromName("Genève")).toBe("ge");
    expect(cantonCodeFromName("Geneva")).toBe("ge");
    expect(cantonCodeFromName("Genf")).toBe("ge");
    expect(cantonCodeFromName("Bern")).toBe("be");
    expect(cantonCodeFromName("Berne")).toBe("be");
    expect(cantonCodeFromName("Zürich")).toBe("zh");
    expect(cantonCodeFromName("  vaud ")).toBe("vd");
  });

  it("returns null for unknown or empty input", () => {
    expect(cantonCodeFromName("Nowhere")).toBeNull();
    expect(cantonCodeFromName(null)).toBeNull();
    expect(cantonCodeFromName(undefined)).toBeNull();
  });
});

describe("cantonMapUrl", () => {
  it("builds a GeoMapFish URL (map_x/map_y) for Neuchâtel in LV95", () => {
    const url = cantonMapUrl("Neuchâtel", 6.75, 47.0);
    expect(url).toContain("sitn.ne.ch");
    expect(url).toMatch(/map_x=2\d{6}/); // LV95 easting ~2.5M
    expect(url).toMatch(/map_y=1\d{6}/);
  });

  it("builds a center+scale URL for Geneva and Fribourg", () => {
    expect(cantonMapUrl("Genève", 6.14, 46.2)).toContain("map.sitg.ge.ch");
    expect(cantonMapUrl("Genève", 6.14, 46.2)).toContain("center=");
    expect(cantonMapUrl("Fribourg", 7.16, 46.8)).toContain("map.geo.fr.ch");
  });

  it("builds the Bern and Solothurn specific URLs", () => {
    expect(cantonMapUrl("Bern", 7.44, 46.95)).toContain("topo.apps.be.ch");
    expect(cantonMapUrl("Bern", 7.44, 46.95)).toContain("addcrosshair=true");
    expect(cantonMapUrl("Solothurn", 7.53, 47.2)).toContain("geo.so.ch/map");
    expect(cantonMapUrl("Solothurn", 7.53, 47.2)).toContain("hc=1");
  });

  it("returns null for a canton with no configured map URL", () => {
    expect(cantonMapUrl("Zürich", 8.54, 47.37)).toBeNull();
    expect(cantonMapUrl("Nowhere", 8, 47)).toBeNull();
  });
});

describe("cantonMapUrlForGeometry", () => {
  const geometry: LineString = {
    type: "LineString",
    coordinates: [
      [6.74, 46.99],
      [6.76, 47.01],
    ],
  };

  it("centers on the geometry midpoint for a known canton", () => {
    expect(cantonMapUrlForGeometry(geometry, "Neuchâtel")).toContain("sitn.ne.ch");
  });

  it("returns null for an unknown canton", () => {
    expect(cantonMapUrlForGeometry(geometry, "Zürich")).toBeNull();
  });
});

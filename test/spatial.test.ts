import type { LineString } from "geojson";
import { describe, expect, it } from "vitest";
import { OfficialIndex } from "../src/matching/official-index";
import {
  distancePointToSegmentM,
  distanceToEntryM,
  nearestOfficial,
  samplePoints,
  SpatialIndex,
} from "../src/matching/spatial";
import { makeOfficial } from "./fixtures/swiss-names";

// Around Lausanne (lat 46.52): 0.0001° lat ≈ 11.06 m, 0.0001° lon ≈ 7.66 m.
const LAT = 46.52;

function street(label: string, lines: number[][][]) {
  return makeOfficial(label, { lines });
}

/** Horizontal official axis at the given latitude offset (meters north). */
function axisAt(northMeters: number, label = "Route Test") {
  const lat = LAT + northMeters / 110_574;
  return street(label, [
    [
      [6.6, lat],
      [6.61, lat],
    ],
  ]);
}

function segmentAt(northMeters: number): LineString {
  const lat = LAT + northMeters / 110_574;
  return {
    type: "LineString",
    coordinates: [
      [6.602, lat],
      [6.604, lat],
      [6.606, lat],
      [6.608, lat],
    ],
  };
}

describe("distancePointToSegmentM", () => {
  it("is zero on the segment", () => {
    expect(distancePointToSegmentM([6.605, LAT], [6.6, LAT], [6.61, LAT])).toBeCloseTo(0, 3);
  });

  it("measures perpendicular distance in meters", () => {
    const tenMetersNorth = LAT + 10 / 110_574;
    expect(distancePointToSegmentM([6.605, tenMetersNorth], [6.6, LAT], [6.61, LAT])).toBeCloseTo(
      10,
      1,
    );
  });

  it("clamps to endpoints beyond the segment", () => {
    // point 0.001° east of endpoint b -> ~76.6 m at this latitude
    const d = distancePointToSegmentM([6.611, LAT], [6.6, LAT], [6.61, LAT]);
    expect(d).toBeGreaterThan(70);
    expect(d).toBeLessThan(82);
  });

  it("handles degenerate zero-length segments", () => {
    expect(distancePointToSegmentM([6.6, LAT], [6.6, LAT], [6.6, LAT])).toBeCloseTo(0, 3);
  });
});

describe("samplePoints", () => {
  it("returns the midpoint for two-point segments", () => {
    const points = samplePoints({
      type: "LineString",
      coordinates: [
        [6.6, LAT],
        [6.61, LAT],
      ],
    });
    expect(points).toHaveLength(1);
    expect(points[0]?.[0]).toBeCloseTo(6.605, 6);
  });

  it("returns three samples for longer segments", () => {
    expect(samplePoints(segmentAt(0))).toHaveLength(3);
  });
});

describe("SpatialIndex / nearestOfficial", () => {
  it("finds the street under the segment", () => {
    const index = new OfficialIndex([axisAt(0, "Route de la Guérite")]);
    const spatial = new SpatialIndex(index.list);
    const hit = nearestOfficial(segmentAt(8), spatial);
    expect(hit?.entry.namePart).toBe("Route de la Guérite");
    expect(hit?.distanceM).toBeCloseTo(8, 0);
  });

  it("returns null beyond the threshold", () => {
    const index = new OfficialIndex([axisAt(0)]);
    const spatial = new SpatialIndex(index.list);
    expect(nearestOfficial(segmentAt(60), spatial)).toBeNull();
  });

  it("prefers the closer of two parallel streets", () => {
    const index = new OfficialIndex([axisAt(0, "Rue Proche"), axisAt(22, "Rue Lointaine")]);
    const spatial = new SpatialIndex(index.list);
    expect(nearestOfficial(segmentAt(5), spatial)?.entry.namePart).toBe("Rue Proche");
  });

  it("indexes bilingual streets once, under the full label", () => {
    const index = new OfficialIndex([
      street("Bielstrasse/Rue de Bienne", [
        [
          [6.6, LAT],
          [6.61, LAT],
        ],
      ]),
    ]);
    const spatial = new SpatialIndex(index.list);
    const hit = nearestOfficial(segmentAt(5), spatial);
    expect(hit?.entry.namePart).toBe("Bielstrasse/Rue de Bienne");
  });

  it("ignores entries without line geometry", () => {
    const index = new OfficialIndex([makeOfficial("Les Vergers", { lines: null })]);
    const spatial = new SpatialIndex(index.list);
    expect(spatial.size).toBe(0);
    expect(nearestOfficial(segmentAt(0), spatial)).toBeNull();
  });
});

describe("distanceToEntryM", () => {
  it("measures the distance to a specific street", () => {
    const index = new OfficialIndex([axisAt(30, "Rue Spécifique")]);
    const entry = index.list[0];
    expect(entry).toBeDefined();
    expect(distanceToEntryM(segmentAt(0), entry!)).toBeCloseTo(30, 0);
  });

  it("returns Infinity without geometry", () => {
    const index = new OfficialIndex([makeOfficial("Sans Géométrie")]);
    expect(distanceToEntryM(segmentAt(0), index.list[0]!)).toBe(Infinity);
  });
});

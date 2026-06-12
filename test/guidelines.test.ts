import type { LineString } from "geojson";
import type { Segment, SegmentAddress } from "wme-sdk-typings";
import { describe, expect, it } from "vitest";
import { evaluateGuidelines } from "../src/guidelines";
import type { IssueStatus } from "../src/matching/evaluate";

const GEOMETRY: LineString = {
  type: "LineString",
  coordinates: [
    [6.63, 46.52],
    [6.64, 46.52],
  ],
};

let nextId = 1;

function seg(overrides: Partial<Segment> = {}): Segment {
  return {
    id: nextId++,
    roadType: 1,
    junctionId: null,
    length: 100,
    geometry: GEOMETRY,
    fromNodeId: nextId * 100,
    toNodeId: nextId * 100 + 1,
    isAtoB: false,
    isBtoA: false,
    isTwoWay: true,
    primaryStreetId: null,
    alternateStreetIds: [],
    ...overrides,
  } as unknown as Segment;
}

const noAddress = (): SegmentAddress | null => null;

function statusOf(issues: ReturnType<typeof evaluateGuidelines>, segmentId: number): IssueStatus | undefined {
  return issues.find((i) => i.segmentId === segmentId)?.status;
}

describe("MICRO_SEGMENT", () => {
  it("flags drivable segments under 5 m", () => {
    const s = seg({ length: 3 } as Partial<Segment>);
    expect(statusOf(evaluateGuidelines([s], noAddress), s.id)).toBe("MICRO_SEGMENT");
  });

  it("ignores roundabout segments", () => {
    const s = seg({ length: 3, junctionId: 7 } as Partial<Segment>);
    expect(evaluateGuidelines([s], noAddress)).toHaveLength(0);
  });

  it("ignores non-drivable types (walking trail)", () => {
    const s = seg({ length: 3, roadType: 5 } as Partial<Segment>);
    expect(evaluateGuidelines([s], noAddress)).toHaveLength(0);
  });

  it("ignores segments of 5 m and more", () => {
    const s = seg({ length: 5 } as Partial<Segment>);
    expect(evaluateGuidelines([s], noAddress)).toHaveLength(0);
  });
});

describe("LOOP", () => {
  it("flags one-segment loops (same node at both ends)", () => {
    const s = seg({ fromNodeId: 1, toNodeId: 1 } as Partial<Segment>);
    expect(statusOf(evaluateGuidelines([s], noAddress), s.id)).toBe("LOOP");
  });

  it("flags both members of a two-segment loop, regardless of direction", () => {
    const a = seg({ fromNodeId: 1, toNodeId: 2 } as Partial<Segment>);
    const b = seg({ fromNodeId: 2, toNodeId: 1 } as Partial<Segment>);
    const issues = evaluateGuidelines([a, b], noAddress);
    expect(statusOf(issues, a.id)).toBe("LOOP");
    expect(statusOf(issues, b.id)).toBe("LOOP");
  });

  it("does not flag ordinary parallel-free segments", () => {
    const a = seg({ fromNodeId: 1, toNodeId: 2 } as Partial<Segment>);
    const b = seg({ fromNodeId: 2, toNodeId: 3 } as Partial<Segment>);
    expect(evaluateGuidelines([a, b], noAddress)).toHaveLength(0);
  });

  it("ignores roundabout segments sharing endpoints", () => {
    const a = seg({ fromNodeId: 1, toNodeId: 2, junctionId: 9 } as Partial<Segment>);
    const b = seg({ fromNodeId: 2, toNodeId: 1, junctionId: 9 } as Partial<Segment>);
    expect(evaluateGuidelines([a, b], noAddress)).toHaveLength(0);
  });
});

describe("NARROW_MISUSE", () => {
  it("flags one-way narrow streets", () => {
    const s = seg({ roadType: 22, isAtoB: true, isBtoA: false, isTwoWay: false, length: 80 } as Partial<Segment>);
    expect(statusOf(evaluateGuidelines([s], noAddress), s.id)).toBe("NARROW_MISUSE");
  });

  it("flags narrow streets under 50 m", () => {
    const s = seg({ roadType: 22, isTwoWay: true, length: 30 } as Partial<Segment>);
    expect(statusOf(evaluateGuidelines([s], noAddress), s.id)).toBe("NARROW_MISUSE");
  });

  it("accepts a two-way narrow street of 50 m or more", () => {
    const s = seg({ roadType: 22, isTwoWay: true, length: 60 } as Partial<Segment>);
    expect(evaluateGuidelines([s], noAddress)).toHaveLength(0);
  });
});

import type { Segment, SegmentAddress } from "wme-sdk-typings";
import type { Issue } from "./matching/evaluate";

/**
 * Swiss community guideline checks that need no external data:
 * - MICRO_SEGMENT: drivable segment < 5 m (roundabouts excluded)
 * - LOOP: loop made of fewer than 3 segments (self-loop or same-endpoints pair)
 * - NARROW_MISUSE: Narrow Street (type 22) one-way or < 50 m
 * Source: règles d'édition Suisse romande (forum/wiki condensé).
 */

const MIN_SEGMENT_LENGTH_M = 5;
const MIN_NARROW_STREET_LENGTH_M = 50;
const NARROW_STREET_TYPE = 22;

/** Road types forming the drivable network (loops/micro-segments rules apply). */
const DRIVABLE_TYPES = new Set([1, 2, 3, 4, 6, 7, 8, 17, 20, 22]);

export type GetAddressFn = (segmentId: number) => SegmentAddress | null;

function makeIssue(
  segment: Segment,
  status: Issue["status"],
  getAddress: GetAddressFn,
): Issue {
  const address = getAddress(segment.id);
  return {
    segmentId: segment.id,
    status,
    currentName: address?.street?.name?.trim() || null,
    suggestion: null,
    note: null,
    cityId: address?.city?.id ?? null,
    cityName: address?.city?.name ?? null,
    roadType: segment.roadType,
    length: segment.length,
    geometry: segment.geometry,
    fixable: false,
  };
}

function isOneWay(segment: Segment): boolean {
  return segment.isAtoB !== segment.isBtoA;
}

export function evaluateGuidelines(segments: Segment[], getAddress: GetAddressFn): Issue[] {
  const issues = new Map<number, Issue>();
  const byNodePair = new Map<string, Segment[]>();

  for (const segment of segments) {
    if (!DRIVABLE_TYPES.has(segment.roadType)) continue;
    const isRoundabout = segment.junctionId !== null;

    if (!isRoundabout && segment.length < MIN_SEGMENT_LENGTH_M) {
      issues.set(segment.id, makeIssue(segment, "MICRO_SEGMENT", getAddress));
    }

    if (
      segment.roadType === NARROW_STREET_TYPE &&
      (isOneWay(segment) || segment.length < MIN_NARROW_STREET_LENGTH_M)
    ) {
      if (!issues.has(segment.id)) {
        issues.set(segment.id, makeIssue(segment, "NARROW_MISUSE", getAddress));
      }
    }

    if (isRoundabout || segment.fromNodeId === null || segment.toNodeId === null) continue;

    // One-segment loop: both endpoints on the same node.
    if (segment.fromNodeId === segment.toNodeId) {
      issues.set(segment.id, makeIssue(segment, "LOOP", getAddress));
      continue;
    }

    const a = Math.min(segment.fromNodeId, segment.toNodeId);
    const b = Math.max(segment.fromNodeId, segment.toNodeId);
    const key = `${a}:${b}`;
    const list = byNodePair.get(key);
    if (list) list.push(segment);
    else byNodePair.set(key, [segment]);
  }

  // Two-segment loops: several drivable segments sharing both endpoints
  // ("same endpoint drivable segments"); every member gets flagged.
  for (const pair of byNodePair.values()) {
    if (pair.length < 2) continue;
    for (const segment of pair) {
      issues.set(segment.id, makeIssue(segment, "LOOP", getAddress));
    }
  }

  return [...issues.values()];
}

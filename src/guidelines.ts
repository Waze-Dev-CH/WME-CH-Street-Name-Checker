import type { Segment, SegmentAddress } from "wme-sdk-typings";
import type { Issue } from "./matching/evaluate";

/**
 * Swiss community guideline checks that need no external data:
 * - MICRO_SEGMENT: drivable segment < 5 m (roundabouts excluded)
 * - LOOP: loop made of fewer than 3 segments (self-loop or same-endpoints pair)
 * - NARROW_MISUSE: Narrow Street (type 22) one-way or < 50 m
 * - UNDER_LOCK / OVER_LOCK: lock rank below / above the Swiss minimum for the road type
 * Source: règles d'édition Suisse romande (forum/wiki condensé).
 */

const MIN_SEGMENT_LENGTH_M = 5;
const MIN_NARROW_STREET_LENGTH_M = 50;
const NARROW_STREET_TYPE = 22;

/** Road types forming the drivable network (loops/micro-segments rules apply). */
const DRIVABLE_TYPES = new Set([1, 2, 3, 4, 6, 7, 8, 17, 20, 22]);

/**
 * Minimum lock rank expected per road type (Swiss WME standard).
 * DRAFT to validate against the Swiss wiki/forum before release. Road types not
 * listed are not checked. Ramps (4) are excluded on purpose: their lock follows
 * the highest connected segment, not a flat per-type table.
 */
const EXPECTED_LOCK_BY_ROAD_TYPE = new Map<number, number>([
  [3, 5], // Freeway
  [6, 4], // Major Highway
  [7, 3], // Minor Highway
  [2, 2], // Primary Street
  [1, 1], // Street
]);

export type GetAddressFn = (segmentId: number) => SegmentAddress | null;

function makeIssue(
  segment: Segment,
  status: Issue["status"],
  getAddress: GetAddressFn,
  swissCountryId: number | null,
): Issue | null {
  const address = getAddress(segment.id);
  // Swiss guidelines do not apply to foreign segments in border viewports.
  // Fail-open when the Swiss country id could not be resolved.
  if (swissCountryId !== null && address?.country && address.country.id !== swissCountryId) {
    return null;
  }
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

export function evaluateGuidelines(
  segments: Segment[],
  getAddress: GetAddressFn,
  swissCountryId: number | null = null,
): Issue[] {
  const issues = new Map<number, Issue>();
  const byNodePair = new Map<string, Segment[]>();

  for (const segment of segments) {
    if (!DRIVABLE_TYPES.has(segment.roadType)) continue;
    const isRoundabout = segment.junctionId !== null;

    if (!isRoundabout && segment.length < MIN_SEGMENT_LENGTH_M) {
      const issue = makeIssue(segment, "MICRO_SEGMENT", getAddress, swissCountryId);
      if (issue) issues.set(segment.id, issue);
    }

    if (
      segment.roadType === NARROW_STREET_TYPE &&
      (isOneWay(segment) || segment.length < MIN_NARROW_STREET_LENGTH_M)
    ) {
      if (!issues.has(segment.id)) {
        const issue = makeIssue(segment, "NARROW_MISUSE", getAddress, swissCountryId);
        if (issue) issues.set(segment.id, issue);
      }
    }

    // Lock rank below / above the Swiss minimum expected for the road type.
    // Over-locking is often intentional, hence a separate, informative status.
    const expectedLock = EXPECTED_LOCK_BY_ROAD_TYPE.get(segment.roadType);
    if (
      expectedLock !== undefined &&
      typeof segment.lockRank === "number" &&
      segment.lockRank !== expectedLock &&
      !issues.has(segment.id)
    ) {
      const status = segment.lockRank < expectedLock ? "UNDER_LOCK" : "OVER_LOCK";
      const issue = makeIssue(segment, status, getAddress, swissCountryId);
      if (issue) {
        issue.note = { ...(issue.note ?? {}), currentLock: segment.lockRank, expectedLock };
        issues.set(segment.id, issue);
      }
    }

    if (isRoundabout || segment.fromNodeId === null || segment.toNodeId === null) continue;

    // One-segment loop: both endpoints on the same node.
    if (segment.fromNodeId === segment.toNodeId) {
      const issue = makeIssue(segment, "LOOP", getAddress, swissCountryId);
      if (issue) issues.set(segment.id, issue);
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
      const issue = makeIssue(segment, "LOOP", getAddress, swissCountryId);
      if (issue) issues.set(segment.id, issue);
    }
  }

  return [...issues.values()];
}

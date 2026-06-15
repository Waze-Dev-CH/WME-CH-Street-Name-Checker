import type { LineString } from "geojson";
import type { Segment, SegmentAddress } from "wme-sdk-typings";
import type { Settings } from "../settings";
import { isRouteDesignation, k1 } from "./normalize";
import { compareNameToCandidate, type IndexedEntry, type OfficialIndex } from "./official-index";
import {
  distanceToEntryM,
  FAR_STREET_M,
  SUGGEST_MAX_M,
  WRONG_STREET_MIN_COVERAGE,
  type NearestResult,
} from "./spatial";

export type IssueStatus =
  | "COSMETIC"
  | "VARIANT"
  | "NEAR"
  | "WRONG_TYPE"
  | "WRONG_STREET"
  | "WRONG_CITY"
  | "NOT_FOUND"
  | "UNNAMED"
  // Unnamed segment with no official street found underneath (geometry matching
  // on): legitimately unnamed, reported separately and hidden by default.
  | "UNNAMED_NO_MATCH"
  // Swiss guideline checks (see src/guidelines.ts):
  | "MICRO_SEGMENT"
  | "LOOP"
  | "NARROW_MISUSE"
  // Lock-level checks (see src/guidelines.ts): below / above the Swiss minimum
  // expected for the road type.
  | "UNDER_LOCK"
  | "OVER_LOCK";

/** Structured qualifiers, localized at display time by the UI. */
export interface IssueNote {
  unofficial?: boolean;
  planned?: boolean;
  /** Full bilingual label when the suggestion is one side of an "A/B" label. */
  fullLabel?: string;
  /** zip_label of the locality where the name actually exists (WRONG_CITY). */
  existsIn?: string;
  /** Distance to the official axis of the CURRENT name (WRONG_STREET review aid). */
  ownDistanceM?: number;
  /** Current lock LEVEL (1-6 as shown in WME) of the segment (UNDER_LOCK / OVER_LOCK). */
  currentLock?: number;
  /** Expected lock LEVEL (1-6) for the road type; the fix converts it back to lockRank. */
  expectedLock?: number;
}

export interface Issue {
  segmentId: number;
  status: IssueStatus;
  currentName: string | null;
  /** Official name to apply on fix; null when there is nothing to suggest. */
  suggestion: string | null;
  note: IssueNote | null;
  cityId: number | null;
  cityName: string | null;
  roadType: number;
  length: number;
  geometry: LineString;
  fixable: boolean;
}

/** Freeway, Ramp, Major Highway, Minor Highway. */
const HIGHWAY_ROAD_TYPES = new Set([3, 4, 6, 7]);

export type Verdict =
  | { kind: "ok" }
  | { kind: "okAlt" }
  | { kind: "skipped" }
  | { kind: "issue"; issue: Issue };

function noteFor(entry: IndexedEntry): IssueNote | null {
  const note: IssueNote = {};
  if (!entry.street.official) note.unofficial = true;
  const status = entry.street.status.toLowerCase();
  if (status !== "" && status !== "bestehend" && status !== "real" && status !== "existing") {
    note.planned = true;
  }
  if (entry.isSlashPart) note.fullLabel = entry.street.label;
  return Object.keys(note).length > 0 ? note : null;
}

export function evaluateSegment(
  segment: Segment,
  address: SegmentAddress,
  index: OfficialIndex,
  settings: Settings,
  /** Official street under the segment (geometry matching), when available. */
  nearest: NearestResult | null = null,
  /** Resolved Swiss country id, or null when unknown (then no segment is excluded). */
  swissCountryId: number | null = null,
): Verdict {
  if (!settings.checkedRoadTypes.includes(segment.roadType)) return { kind: "skipped" };
  // The register only covers Switzerland; foreign segments in border viewports
  // are ignored. Fail-open: without a resolved Swiss id, nothing is excluded.
  if (swissCountryId !== null && address.country && address.country.id !== swissCountryId) {
    return { kind: "skipped" };
  }

  const currentName = address.street?.name?.trim() || null;
  const baseIssue = {
    segmentId: segment.id,
    currentName,
    cityId: address.city?.id ?? null,
    cityName: address.city?.name ?? null,
    roadType: segment.roadType,
    length: segment.length,
    geometry: segment.geometry,
  };

  if (!currentName) {
    // Unnamed roundabout segments are normal in Waze.
    if (segment.junctionId !== null) return { kind: "skipped" };
    // With geometry matching, the official street under the segment becomes
    // a one-click suggestion.
    const suggestion = nearest && nearest.distanceM <= SUGGEST_MAX_M ? nearest.entry : null;
    // With geometry matching on, "no official street underneath" means the
    // segment is legitimately unnamed (normal). Without it we cannot tell, so it
    // stays UNNAMED (an editor still has to investigate).
    const status =
      suggestion === null && settings.geometryMatching ? "UNNAMED_NO_MATCH" : "UNNAMED";
    return {
      kind: "issue",
      issue: {
        ...baseIssue,
        status,
        suggestion: suggestion?.namePart ?? null,
        note: suggestion ? noteFor(suggestion) : null,
        fixable: suggestion !== null,
      },
    };
  }

  // Numbered route designations (A9, E62, A9 - E62) are the Waze convention
  // for highways and never exist in the register; accept them on highway-class
  // segments instead of reporting noise.
  if (HIGHWAY_ROAD_TYPES.has(segment.roadType) && isRouteDesignation(currentName)) {
    return { kind: "ok" };
  }

  const locality =
    settings.cityScoping !== "off" && address.city?.name ? k1(address.city.name) : undefined;

  const match = index.lookup(currentName, locality);
  if (match) {
    // Geometry takes precedence over name-only verdicts: when the name matches
    // an official street SOMEWHERE but a DIFFERENT official street clearly runs
    // under this segment, this is WRONG_STREET regardless of how well the name
    // matched (exact, or a mere cosmetic/variant/near/stem fix). Otherwise the
    // editor would correct the spelling first and only then be told the street
    // itself is wrong - two edits for one segment.
    const ownDistanceM =
      nearest && nearest.distanceM <= SUGGEST_MAX_M
        ? Math.min(...match.candidates.map((c) => distanceToEntryM(segment.geometry, c)))
        : Infinity;
    if (
      nearest &&
      nearest.distanceM <= SUGGEST_MAX_M &&
      nearest.coverage >= WRONG_STREET_MIN_COVERAGE &&
      k1(nearest.entry.namePart) !== k1(currentName) &&
      !nearest.entry.street.label.includes(currentName) &&
      ownDistanceM > FAR_STREET_M
    ) {
      return {
        kind: "issue",
        issue: {
          ...baseIssue,
          status: "WRONG_STREET",
          suggestion: nearest.entry.namePart,
          note: {
            ...(noteFor(nearest.entry) ?? {}),
            existsIn: match.entry.street.zipLabel,
            // review aid: how far the current name's own axis really is
            ...(Number.isFinite(ownDistanceM) ? { ownDistanceM: Math.round(ownDistanceM) } : {}),
          },
          fixable: true,
        },
      };
    }
    if (match.level === "exact") {
      if (locality && !match.inLocality) {
        return {
          kind: "issue",
          issue: {
            ...baseIssue,
            status: "WRONG_CITY",
            suggestion: null,
            note: { existsIn: match.entry.street.zipLabel },
            fixable: false,
          },
        };
      }
      return { kind: "ok" };
    }
    const statusByLevel = {
      cosmetic: "COSMETIC",
      variant: "VARIANT",
      near: "NEAR",
      stem: "WRONG_TYPE",
    } as const;
    return {
      kind: "issue",
      issue: {
        ...baseIssue,
        status: statusByLevel[match.level],
        suggestion: match.entry.namePart,
        note: noteFor(match.entry),
        fixable: true,
      },
    };
  }

  if (settings.altNameCountsAsOk) {
    for (const alt of address.altStreets) {
      const altName = alt.street?.name?.trim();
      if (!altName) continue;
      const altMatch = index.lookup(altName, locality);
      if (altMatch && (altMatch.level === "exact" || altMatch.level === "cosmetic")) {
        return { kind: "okAlt" };
      }
    }
  }

  // Last chance before NOT_FOUND: one-to-one comparison against the official
  // street under the segment. Resolves cases the set-based lookup dropped as
  // ambiguous (two stems or two fuzzy candidates) - proximity disambiguates.
  if (nearest && nearest.distanceM <= SUGGEST_MAX_M) {
    const level = compareNameToCandidate(currentName, nearest.entry.namePart);
    if (level && level !== "exact") {
      const statusByLevel = {
        cosmetic: "COSMETIC",
        variant: "VARIANT",
        near: "NEAR",
        stem: "WRONG_TYPE",
      } as const;
      return {
        kind: "issue",
        issue: {
          ...baseIssue,
          status: statusByLevel[level],
          suggestion: nearest.entry.namePart,
          note: noteFor(nearest.entry),
          fixable: true,
        },
      };
    }
  }

  return {
    kind: "issue",
    issue: {
      ...baseIssue,
      status: "NOT_FOUND",
      suggestion: null,
      note: null,
      fixable: false,
    },
  };
}

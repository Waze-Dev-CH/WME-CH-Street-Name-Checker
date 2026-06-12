import type { LineString } from "geojson";
import type { Segment, SegmentAddress } from "wme-sdk-typings";
import type { Settings } from "../settings";
import { k1 } from "./normalize";
import type { IndexedEntry, OfficialIndex } from "./official-index";

export type IssueStatus =
  | "COSMETIC"
  | "VARIANT"
  | "NEAR"
  | "WRONG_CITY"
  | "NOT_FOUND"
  | "UNNAMED"
  // Swiss guideline checks (see src/guidelines.ts):
  | "MICRO_SEGMENT"
  | "LOOP"
  | "NARROW_MISUSE";

/** Structured qualifiers, localized at display time by the UI. */
export interface IssueNote {
  unofficial?: boolean;
  planned?: boolean;
  /** Full bilingual label when the suggestion is one side of an "A/B" label. */
  fullLabel?: string;
  /** zip_label of the locality where the name actually exists (WRONG_CITY). */
  existsIn?: string;
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
): Verdict {
  if (!settings.checkedRoadTypes.includes(segment.roadType)) return { kind: "skipped" };

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
    return {
      kind: "issue",
      issue: {
        ...baseIssue,
        status: "UNNAMED",
        suggestion: null,
        note: null,
        fixable: false,
      },
    };
  }

  const locality =
    settings.cityScoping !== "off" && address.city?.name ? k1(address.city.name) : undefined;

  const match = index.lookup(currentName, locality);
  if (match) {
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
    const statusByLevel = { cosmetic: "COSMETIC", variant: "VARIANT", near: "NEAR" } as const;
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

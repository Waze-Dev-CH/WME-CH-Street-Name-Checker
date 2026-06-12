import type { LanguagePreference } from "./i18n";
import type { IssueStatus } from "./matching/evaluate";
import { log } from "./log";

// Road type ids from the WME SDK ROAD_TYPE constant (values verified against
// wme-sdk-typings v2.354). The SDK package is types-only, so ids are restated here.
export interface RoadTypeOption {
  id: number;
  label: string;
  defaultChecked: boolean;
}

export const ROAD_TYPE_OPTIONS: RoadTypeOption[] = [
  { id: 1, label: "Street", defaultChecked: true },
  { id: 2, label: "Primary Street", defaultChecked: true },
  { id: 7, label: "Minor Highway", defaultChecked: true },
  { id: 6, label: "Major Highway", defaultChecked: true },
  { id: 3, label: "Freeway", defaultChecked: false },
  { id: 4, label: "Ramp", defaultChecked: false },
  { id: 17, label: "Private Road", defaultChecked: false },
  { id: 20, label: "Parking Lot Road", defaultChecked: false },
  { id: 8, label: "Off-road", defaultChecked: false },
  { id: 22, label: "Alley", defaultChecked: false },
  { id: 5, label: "Walking Trail", defaultChecked: false },
  { id: 9, label: "Walkway", defaultChecked: false },
  { id: 10, label: "Pedestrian Boardwalk", defaultChecked: false },
  { id: 16, label: "Stairway", defaultChecked: false },
  { id: 15, label: "Ferry", defaultChecked: false },
  { id: 18, label: "Railroad", defaultChecked: false },
  { id: 19, label: "Runway/Taxiway", defaultChecked: false },
];

export type CityScoping = "off" | "warn" | "strict";

/** Severity order, also used by the settings grid. */
export const ALL_STATUSES: IssueStatus[] = [
  "COSMETIC",
  "VARIANT",
  "NEAR",
  "WRONG_TYPE",
  "WRONG_STREET",
  "WRONG_CITY",
  "NOT_FOUND",
  "UNNAMED",
  "MICRO_SEGMENT",
  "LOOP",
  "NARROW_MISUSE",
];

export interface Settings {
  version: 2;
  /** Master switch: off disables scanning, the layer and the edit-panel box. */
  enabled: boolean;
  /** Scan automatically on map moves; off = manual Rescan button only. */
  autoScan: boolean;
  minZoom: number;
  checkedRoadTypes: number[];
  /** Issue statuses reported everywhere (map, list, counters, navigation). */
  enabledStatuses: IssueStatus[];
  altNameCountsAsOk: boolean;
  cityScoping: CityScoping;
  showMapLabels: boolean;
  keepOldNameAsAlt: boolean;
  language: LanguagePreference;
  guidelineChecks: boolean;
  editPanelHelper: boolean;
  /** Use official street geometries to match segments spatially. */
  geometryMatching: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  enabled: true,
  autoScan: true,
  minZoom: 15,
  checkedRoadTypes: ROAD_TYPE_OPTIONS.filter((r) => r.defaultChecked).map((r) => r.id),
  enabledStatuses: [...ALL_STATUSES],
  altNameCountsAsOk: true,
  cityScoping: "off",
  showMapLabels: true,
  keepOldNameAsAlt: false,
  language: "auto",
  guidelineChecks: true,
  editPanelHelper: true,
  geometryMatching: true,
};

const STORAGE_KEY = "wme-ch-name-check.settings";

export function migrateSettings(parsed: Omit<Partial<Settings>, "version"> & { version?: number }): Settings {
  if (parsed.version === 1) {
    // v1 had a single showCosmetic boolean instead of the per-status grid
    const legacy = parsed as Partial<Settings> & { showCosmetic?: boolean };
    const enabledStatuses =
      legacy.showCosmetic === false
        ? ALL_STATUSES.filter((status) => status !== "COSMETIC")
        : [...ALL_STATUSES];
    return { ...DEFAULT_SETTINGS, ...parsed, version: 2, enabledStatuses };
  }
  if (parsed.version !== 2) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...parsed };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return migrateSettings(JSON.parse(raw) as Partial<Settings>);
  } catch (err) {
    log.warn("Failed to load settings, using defaults", err);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    log.warn("Failed to save settings", err);
  }
}

/** Mutable settings holder shared across modules. */
export class SettingsStore {
  private settings: Settings;

  constructor() {
    this.settings = loadSettings();
  }

  get(): Settings {
    return this.settings;
  }

  update(partial: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...partial };
    saveSettings(this.settings);
    return this.settings;
  }
}

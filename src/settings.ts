import type { LanguagePreference } from "./i18n";
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

export interface Settings {
  version: 1;
  minZoom: number;
  checkedRoadTypes: number[];
  altNameCountsAsOk: boolean;
  showCosmetic: boolean;
  cityScoping: CityScoping;
  showMapLabels: boolean;
  keepOldNameAsAlt: boolean;
  language: LanguagePreference;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  minZoom: 15,
  checkedRoadTypes: ROAD_TYPE_OPTIONS.filter((r) => r.defaultChecked).map((r) => r.id),
  altNameCountsAsOk: true,
  showCosmetic: true,
  cityScoping: "off",
  showMapLabels: true,
  keepOldNameAsAlt: false,
  language: "auto",
};

const STORAGE_KEY = "wme-ch-name-check.settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    if (parsed.version !== 1) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...parsed };
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

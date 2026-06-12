import { describe, expect, it } from "vitest";
import { ALL_STATUSES, DEFAULT_SETTINGS, migrateSettings } from "../src/settings";

describe("migrateSettings", () => {
  it("returns defaults for unknown versions", () => {
    expect(migrateSettings({ version: 99 })).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps v2 settings as-is, completed with defaults", () => {
    const migrated = migrateSettings({ version: 2, minZoom: 17 });
    expect(migrated.minZoom).toBe(17);
    expect(migrated.enabledStatuses).toEqual(ALL_STATUSES);
  });

  it("migrates v1 with showCosmetic=false to a grid without COSMETIC", () => {
    const migrated = migrateSettings({ version: 1, showCosmetic: false } as never);
    expect(migrated.version).toBe(2);
    expect(migrated.enabledStatuses).not.toContain("COSMETIC");
    expect(migrated.enabledStatuses).toContain("VARIANT");
  });

  it("migrates v1 with showCosmetic=true to the full grid", () => {
    const migrated = migrateSettings({ version: 1, showCosmetic: true, minZoom: 16 } as never);
    expect(migrated.enabledStatuses).toEqual(ALL_STATUSES);
    expect(migrated.minZoom).toBe(16);
  });
});

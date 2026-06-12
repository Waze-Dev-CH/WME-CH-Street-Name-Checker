import { afterEach, describe, expect, it } from "vitest";
import { LOCALES, resolveLocale, setLocale, t, type LocaleCode } from "../src/i18n";

afterEach(() => setLocale("en"));

describe("locale completeness", () => {
  const enKeys = Object.keys(LOCALES.en).sort();
  for (const code of Object.keys(LOCALES) as LocaleCode[]) {
    it(`${code} has exactly the same keys as en`, () => {
      expect(Object.keys(LOCALES[code]).sort()).toEqual(enKeys);
    });
  }

  it("every locale preserves the placeholders of the en string", () => {
    const placeholders = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const code of Object.keys(LOCALES) as LocaleCode[]) {
      for (const [key, enValue] of Object.entries(LOCALES.en)) {
        const localized = LOCALES[code][key as keyof typeof LOCALES.en];
        expect(placeholders(localized), `${code}.${key}`).toEqual(placeholders(enValue));
      }
    }
  });
});

describe("t", () => {
  it("replaces placeholders", () => {
    setLocale("en");
    expect(t("stateDone", { issues: 3, ok: 42, streets: 100 })).toBe(
      "3 issue(s) · 42 OK · 100 official streets",
    );
  });

  it("uses the active locale", () => {
    setLocale("fr");
    expect(t("rescan")).toBe("Rescanner");
    setLocale("de");
    expect(t("rescan")).toBe("Neu scannen");
    setLocale("it");
    expect(t("rescan")).toBe("Riscansiona");
  });
});

describe("resolveLocale", () => {
  it("honors an explicit preference", () => {
    expect(resolveLocale("it", "fr")).toBe("it");
  });

  it("follows the WME locale in auto mode", () => {
    expect(resolveLocale("auto", "fr")).toBe("fr");
    expect(resolveLocale("auto", "fr-CH")).toBe("fr");
    expect(resolveLocale("auto", "de-CH")).toBe("de");
    expect(resolveLocale("auto", "it")).toBe("it");
  });

  it("falls back to English for unsupported locales", () => {
    expect(resolveLocale("auto", "en-US")).toBe("en");
    expect(resolveLocale("auto", "es")).toBe("en");
    expect(resolveLocale("auto", "rm")).toBe("en");
  });
});

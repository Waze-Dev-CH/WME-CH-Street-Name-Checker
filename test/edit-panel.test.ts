import { describe, expect, it } from "vitest";
import { OfficialIndex } from "../src/matching/official-index";
import { filterEntries } from "../src/ui/edit-panel";
import { makeOfficial } from "./fixtures/swiss-names";

const index = new OfficialIndex([
  makeOfficial("Chemin sur Rosset", { zipLabel: "1040 Echallens", comName: "Echallens" }),
  makeOfficial("Chemin des Roses", { zipLabel: "1009 Pully", comName: "Pully" }),
  makeOfficial("Route de Berne", { zipLabel: "1040 Echallens", comName: "Echallens" }),
  makeOfficial("Rue de la Forêt", { zipLabel: "1003 Lausanne", comName: "Lausanne" }),
]);

describe("filterEntries", () => {
  it("matches case- and accent-insensitively", () => {
    const result = filterEntries(index.list, "foret", null);
    expect(result.map((e) => e.namePart)).toEqual(["Rue de la Forêt"]);
  });

  it("matches substrings anywhere in the name", () => {
    const result = filterEntries(index.list, "rosset", null);
    expect(result.map((e) => e.namePart)).toEqual(["Chemin sur Rosset"]);
  });

  it("lists the segment's locality first", () => {
    const result = filterEntries(index.list, "chemin", "echallens");
    expect(result.map((e) => e.namePart)).toEqual(["Chemin sur Rosset", "Chemin des Roses"]);
  });

  it("returns everything alphabetically on an empty query", () => {
    const result = filterEntries(index.list, "", null);
    expect(result.map((e) => e.namePart)).toEqual([
      "Chemin des Roses",
      "Chemin sur Rosset",
      "Route de Berne",
      "Rue de la Forêt",
    ]);
  });

  it("deduplicates identical names across communes", () => {
    const dup = new OfficialIndex([
      makeOfficial("Rue de la Gare", { zipLabel: "1003 Lausanne" }),
      makeOfficial("Rue de la Gare", { zipLabel: "1009 Pully" }),
    ]);
    expect(filterEntries(dup.list, "gare", null)).toHaveLength(1);
  });

  it("respects the limit", () => {
    expect(filterEntries(index.list, "", null, 2)).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";
import {
  invoiceLabelMatchesMergedCatalog,
  scoreNameMatchIncludingMergedAliases,
} from "./mergedCatalogMatch";

describe("mergedCatalogMatch", () => {
  it("reconhece alias unificado na nota", () => {
    expect(
      invoiceLabelMatchesMergedCatalog("HEINEKEN LT 600ML", [
        "HEINEKEN 600ML LONG NECK",
      ]),
    ).toBe(false);
    expect(
      invoiceLabelMatchesMergedCatalog("CERVEJA HEINEKEN 600", [
        "cerveja heineken 600",
      ]),
    ).toBe(true);
  });

  it("eleva score quando o nome da nota bate com alias", () => {
    const base = scoreNameMatchIncludingMergedAliases(
      "AGUA MINERAL SEM GAS 500ML",
      "AGUA MINERAL 1,5L",
      null,
    );
    const withAlias = scoreNameMatchIncludingMergedAliases(
      "AGUA MINERAL SEM GAS 500ML",
      "AGUA MINERAL 1,5L",
      ["AGUA MINERAL SEM GAS 500ML"],
    );
    expect(withAlias).toBeGreaterThan(base);
  });
});

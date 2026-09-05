import { describe, expect, it } from "vitest";
import { normalizeNcm8 } from "@/lib/ncm/normalizeNcm";
import {
  EULALIA_CONFLICTING_NCM_CODES,
  EULALIA_UNAMBIGUOUS_NCM_PRODUCT_RULES,
} from "./eulaliaUnambiguousNcmRules";

describe("EULALIA_UNAMBIGUOUS_NCM_PRODUCT_RULES", () => {
  it("tem códigos unívocos, sem conflitos nem manutenção", () => {
    expect(EULALIA_UNAMBIGUOUS_NCM_PRODUCT_RULES.length).toBeGreaterThanOrEqual(
      109,
    );
    const codes = EULALIA_UNAMBIGUOUS_NCM_PRODUCT_RULES.map(([ncm]) => ncm);
    expect(new Set(codes).size).toBe(codes.length);
    for (const conflict of EULALIA_CONFLICTING_NCM_CODES) {
      expect(codes).not.toContain(conflict);
    }
    expect(codes).not.toContain("84798999");
  });

  it("normaliza NCM de 10 dígitos para 22029900 → Soft Drink", () => {
    expect(normalizeNcm8("2202.99.00.01")).toBe("22029900");
    expect(
      EULALIA_UNAMBIGUOUS_NCM_PRODUCT_RULES.find(([ncm]) => ncm === "22029900"),
    ).toEqual(["22029900", "Soft Drink"]);
  });
});

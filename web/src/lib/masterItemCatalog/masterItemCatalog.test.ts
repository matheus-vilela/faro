import { describe, expect, it } from "vitest";
import { applyMasterCatalogToScores, resolveMasterItemCatalog } from "@/lib/masterItemCatalog/resolveMasterItemCatalog";
import type { CompanyMasterCatalogOverrideInput } from "@/lib/masterItemCatalog/companyContext";
import { suggestOperationalItemTypeFromName } from "@/lib/itemClassification/suggestOperationalItemType";

describe("resolveMasterItemCatalog", () => {
  it("CERV PILSEN 600ML → bebida (cerveja)", () => {
    const m = resolveMasterItemCatalog({ name: "CERV PILSEN 600ML" });
    expect(m).not.toBeNull();
    expect(m!.operationalType).toBe("PRODUTO_REVENDA");
    expect(m!.masterId).toBe("mc-beb-cerveja-estilos");
  });

  it("IPA LATA 473ML", () => {
    const m = resolveMasterItemCatalog({ name: "IPA LATA 473ML" });
    expect(m?.operationalType).toBe("PRODUTO_REVENDA");
  });

  it("BARRIL CHOPP PILSEN 30L", () => {
    const m = resolveMasterItemCatalog({ name: "BARRIL CHOPP PILSEN 30L" });
    expect(m?.operationalType).toBe("PRODUTO_REVENDA");
  });

  it("LIMAO TAHITI 10KG → insumo", () => {
    const m = resolveMasterItemCatalog({ name: "LIMAO TAHITI 10KG" });
    expect(m?.operationalType).toBe("INSUMO");
    expect(m?.neverRecipe).toBe(false);
  });

  it("GIN 750ML → destilado revenda", () => {
    const m = resolveMasterItemCatalog({ name: "GIN 750ML" });
    expect(m?.operationalType).toBe("PRODUTO_REVENDA");
    expect(m?.masterId).toBe("mc-beb-destilados");
  });

  it("MONITOR LED 24 → equipamento (nunca receita)", () => {
    const m = resolveMasterItemCatalog({ name: "MONITOR LED 24" });
    expect(m?.operationalType).toBe("ITEM_OPERACIONAL");
    expect(m?.neverRecipe).toBe(true);
  });

  it("DETERGENTE 5L", () => {
    const m = resolveMasterItemCatalog({ name: "DETERGENTE 5L" });
    expect(m?.operationalType).toBe("ITEM_OPERACIONAL");
    expect(m?.neverRecipe).toBe(true);
  });

  it("genérico sem sinal forte → null ou score baixo", () => {
    const m = resolveMasterItemCatalog({ name: "XPTO 123" });
    expect(m).toBeNull();
  });

  it("override de empresa reforça tipo alinhado ao alias", () => {
    const ov: CompanyMasterCatalogOverrideInput = {
      id: "1",
      custom_alias: "xpto premium",
      custom_name: null,
      override_operational_type: "INSUMO",
      master_external_key: null,
      score_adjustment: null,
      active: true,
    };
    const r = applyMasterCatalogToScores(
      { INSUMO: 0.1, PRODUTO_REVENDA: 0.2 },
      { name: "ITEM XPTO PREMIUM 500G" },
      { companyOverrides: [ov] },
    );
    expect(r.match).not.toBeNull();
    expect(r.match?.reasonPt).toContain("Regra da unidade");
    expect((r.next.INSUMO ?? 0) > 0.25).toBe(true);
  });
});

describe("motor integrado expõe master_catalog", () => {
  it("IPA preenche suggestion_reasons.master_catalog", () => {
    const r = suggestOperationalItemTypeFromName({ name: "IPA LATA 473ML" });
    expect(r.suggestion_reasons.master_catalog).toBeDefined();
    expect(r.suggestion_reasons.master_catalog?.master_item_id).toBe("mc-beb-cerveja-estilos");
    expect(r.suggestion_reasons.master_catalog?.reason_pt).toMatch(/Base mestre/i);
  });
});

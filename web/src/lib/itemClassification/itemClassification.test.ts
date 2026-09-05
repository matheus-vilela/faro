import { describe, expect, it } from "vitest";
import { evaluateConfigurationCompleteness } from "@/lib/itemClassification/evaluateConfigurationCompleteness";
import { suggestOperationalItemTypeFromName } from "@/lib/itemClassification/suggestOperationalItemType";

function expectRevendaBeverage(name: string) {
  const r = suggestOperationalItemTypeFromName({ name });
  expect(r.suggested_type).toBe("PRODUTO_REVENDA");
  expect(r.suggestion_reasons.operational_family).toBeDefined();
  return r;
}

function expectInsumo(name: string) {
  const r = suggestOperationalItemTypeFromName({ name });
  expect(r.suggested_type).toBe("INSUMO");
  return r;
}

describe("suggestOperationalItemTypeFromName (hospitality)", () => {
  it("CERV PILSEN 600ML → bebida revenda", () => {
    const r = expectRevendaBeverage("CERV PILSEN 600ML");
    expect(r.suggestion_reasons.summary_pt?.toLowerCase()).toMatch(/revenda|bebida|cervej/);
  });

  it("IPA LATA 473ML → bebida revenda", () => {
    expectRevendaBeverage("IPA LATA 473ML");
  });

  it("APA GARRAFA → bebida revenda", () => {
    expectRevendaBeverage("APA GARRAFA 600ml");
  });

  it("BARRIL CHOPP PILSEN 30L → bebida revenda (barril/chope)", () => {
    const r = expectRevendaBeverage("BARRIL CHOPP PILSEN 30L");
    expect(r.suggested_type).toBe("PRODUTO_REVENDA");
  });

  it("LIMAO TAHITI 10KG → insumo", () => {
    expectInsumo("LIMAO TAHITI 10KG");
  });

  it("ACUCAR REFINADO 5KG → insumo", () => {
    expectInsumo("ACUCAR REFINADO 5KG");
  });

  it("XAROPE DE ACUCAR 1L → insumo", () => {
    expectInsumo("XAROPE DE ACUCAR 1L");
  });

  it("GIN 750ML → bebida revenda (destilado tamanho varejo) com explicação", () => {
    const r = suggestOperationalItemTypeFromName({ name: "GIN 750ML" });
    expect(r.suggested_type).toBe("PRODUTO_REVENDA");
    expect(r.suggestion_reasons.operational_family).toBe("DESTILADO");
  });

  it("MONITOR LED 24 → não receita; operacional ou revisão, nunca ficha", () => {
    const r = suggestOperationalItemTypeFromName({ name: "MONITOR LED 24" });
    expect(r.suggested_type).not.toBe("RECEITA_FICHA");
    expect(
      r.suggested_type === "ITEM_OPERACIONAL" ||
        r.suggested_type === "REVISAO_PENDENTE" ||
        r.suggested_type === "NAO_ESTOCAVEL",
    ).toBe(true);
  });

  it("DETERGENTE 5L → consumo / operacional, não receita", () => {
    const r = suggestOperationalItemTypeFromName({ name: "DETERGENTE 5L" });
    expect(r.suggested_type).not.toBe("RECEITA_FICHA");
    expect(r.suggested_type).toBe("ITEM_OPERACIONAL");
  });

  it("EMBALAGEM 500ML C/100 → não receita, operacional", () => {
    const r = suggestOperationalItemTypeFromName({ name: "EMBALAGEM 500ML C/100" });
    expect(r.suggested_type).not.toBe("RECEITA_FICHA");
  });

  it("MOLHO DA CASA — tende a receita/ficha (preparo) ou revisão, não ficha por defeito cego", () => {
    const r = suggestOperationalItemTypeFromName({ name: "MOLHO DA CASA" });
    expect(
      r.suggested_type === "RECEITA_FICHA" || r.suggested_type === "INSUMO" || r.suggested_type === "REVISAO_PENDENTE",
    ).toBe(true);
  });

  it("Azeite extra virgem 1L continua a insinuar insumo alimentar", () => {
    const r = suggestOperationalItemTypeFromName({ name: "Azeite extra virgem 1L" });
    expect(r.suggested_type).toBe("INSUMO");
    expect(r.suggested_score).toBeGreaterThan(0.3);
  });

  it("ambíguo genérico → revisão", () => {
    const r = suggestOperationalItemTypeFromName({ name: "XPTO 123" });
    expect(r.suggested_type).toBe("REVISAO_PENDENTE");
  });
});

describe("peer tallies reforçam a mesma classe", () => {
  it("histórico de INSUMO no mesmo nome eleva o eixo e expõe peer_hint", () => {
    const name = "Tokenzz insumo 999";
    const base = suggestOperationalItemTypeFromName({ name });
    const boosted = suggestOperationalItemTypeFromName({
      name,
      peerNameTypeTallies: { INSUMO: 3 },
    });
    const sb = base.suggestion_reasons.scores_by_type;
    const st = boosted.suggestion_reasons.scores_by_type;
    expect(st?.INSUMO !== undefined && sb?.INSUMO !== undefined).toBe(true);
    expect((st?.INSUMO ?? 0) > (sb?.INSUMO ?? 0)).toBe(true);
    expect(boosted.suggestion_reasons.peer_hint).toBeDefined();
  });
});

describe("evaluateConfigurationCompleteness", () => {
  it("receita exige ficha (bloqueado sem vínculo)", () => {
    const r = evaluateConfigurationCompleteness({
      finalType: "RECEITA_FICHA",
      product: { unit: "un", cmv_category_id: "a" },
      linkedEntryBreakdownRecipeId: null,
    });
    expect(r.configuration_status).toBe("BLOQUEADO");
    expect(r.is_complete).toBe(false);
  });

  it("receita conclui com ficha, unidade e categoria", () => {
    const r = evaluateConfigurationCompleteness({
      finalType: "RECEITA_FICHA",
      product: { unit: "un", cmv_category_id: "a" },
      linkedEntryBreakdownRecipeId: "00000000-0000-4000-8000-000000000001",
    });
    expect(r.configuration_status).toBe("CONFIGURADO");
    expect(r.is_complete).toBe(true);
  });

  it("insumo sem unidade não conclui", () => {
    const r = evaluateConfigurationCompleteness({
      finalType: "INSUMO",
      product: { unit: "", cmv_category_id: "a" },
      linkedEntryBreakdownRecipeId: null,
    });
    expect(r.is_complete).toBe(false);
  });

  it("insumo sem categoria não conclui", () => {
    const r = evaluateConfigurationCompleteness({
      finalType: "INSUMO",
      product: { unit: "kg", cmv_category_id: null },
      linkedEntryBreakdownRecipeId: null,
    });
    expect(r.is_complete).toBe(false);
  });

  it("plano sem CMV conclui com categoria de produto", () => {
    const r = evaluateConfigurationCompleteness({
      finalType: "INSUMO",
      product: {
        unit: "kg",
        cmv_category_id: null,
        has_product_category_assignment: true,
      },
      linkedEntryBreakdownRecipeId: null,
    });
    expect(r.is_complete).toBe(true);
  });

  it("revisão pendente nunca conclui", () => {
    const r = evaluateConfigurationCompleteness({
      finalType: "REVISAO_PENDENTE",
      product: { unit: "un", cmv_category_id: "a" },
      linkedEntryBreakdownRecipeId: null,
    });
    expect(r.is_complete).toBe(false);
  });
});

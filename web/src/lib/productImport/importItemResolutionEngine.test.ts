import { describe, expect, it } from "vitest"
import {
  previewEntryBreakdownQuantities,
  resolveXmlImportLine,
  type EntryBreakdownRecipeRow,
  type ImportResolutionRuleRow,
  type ProductStockRow,
  type XmlLineForResolution,
} from "./importItemResolutionEngine"

const thresholds = { autoMatchMinScore: 95, confirmMinScore: 75 }

function baseProducts(): Map<string, ProductStockRow> {
  return new Map([
    ["limao", { id: "limao", stock_control_type: "DIRECT" }],
    ["acucar", { id: "acucar", stock_control_type: "DIRECT" }],
    ["cachaca", { id: "cachaca", stock_control_type: "DIRECT" }],
    ["caipirinha", { id: "caipirinha", stock_control_type: "RECIPE_CONTROLLED" }],
    ["refrigerante", { id: "refrigerante", stock_control_type: "DIRECT" }],
  ])
}

describe("resolveXmlImportLine", () => {
  it("item simples vira estoque direto com score alto", () => {
    const item: XmlLineForResolution = {
      productName: "Refrigerante 2L",
      quantity: 6,
      productMatch: {
        resolvedProductId: "refrigerante",
        suggestedProductId: "refrigerante",
        suggestedScore: 96,
        needsConfirmation: false,
        resolutionStatus: "AUTO_MATCH",
      },
    }
    const r = resolveXmlImportLine({
      companyId: "c1",
      supplierId: "s1",
      item,
      rules: [],
      productsById: baseProducts(),
      entryBreakdownRecipes: [],
      thresholds,
    })
    expect(r.import_nature).toBe("ESTOQUE_DIRETO")
    expect(r.import_stock_resolution).toBe("DIRECT")
    expect(r.import_pending_resolution).toBe(false)
    expect(
      (r.import_score_reasons_json as { master_catalog?: { master_item_id?: string } }).master_catalog
        ?.master_item_id,
    ).toBeDefined()
    expect(
      (r.import_score_reasons_json as { master_recipe?: { master_recipe_id?: string } }).master_recipe,
    ).toBeNull()
  })

  it("nome com sinal negativo forte bloqueia explosão por ficha ainda que o catálogo seja receita", () => {
    const rules: ImportResolutionRuleRow[] = []
    const recipes: EntryBreakdownRecipeRow[] = [
      {
        id: "rec_barril",
        output_product_id: "barril_unit",
        batch_yield: 1,
        active: true,
        recipe_type: "ENTRY_BREAKDOWN",
        version: 1,
      },
    ]
    const products = new Map<string, ProductStockRow>([
      ["barril_unit", { id: "barril_unit", stock_control_type: "RECIPE_CONTROLLED" }],
    ])
    const item: XmlLineForResolution = {
      productName: "Barril de chopp 30L vazio",
      quantity: 1,
      productMatch: {
        resolvedProductId: "barril_unit",
        suggestedProductId: "barril_unit",
        suggestedScore: 98,
        needsConfirmation: false,
        resolutionStatus: "AUTO_MATCH",
      },
    }
    const r = resolveXmlImportLine({
      companyId: "c1",
      supplierId: "s1",
      item,
      rules,
      productsById: products,
      entryBreakdownRecipes: recipes,
      thresholds,
    })
    expect(r.import_engine_suggestion).toBe("REVISAO_MANUAL")
    expect(r.import_pending_resolution).toBe(true)
    expect(r.import_stock_resolution).toBeNull()
  })

  it("item de drink expõe sugestão de template master_recipe na auditoria", () => {
    const item: XmlLineForResolution = {
      productName: "Caipirinha tradicional",
      quantity: 10,
      productMatch: {
        resolvedProductId: "caipirinha",
        suggestedProductId: "caipirinha",
        suggestedScore: 96,
        needsConfirmation: false,
        resolutionStatus: "AUTO_MATCH",
      },
    }
    const recipes: EntryBreakdownRecipeRow[] = [
      {
        id: "rec_caipi",
        output_product_id: "caipirinha",
        batch_yield: 1,
        active: true,
        recipe_type: "ENTRY_BREAKDOWN",
        version: 2,
      },
    ]
    const r = resolveXmlImportLine({
      companyId: "c1",
      supplierId: "s1",
      item,
      rules: [],
      productsById: baseProducts(),
      entryBreakdownRecipes: recipes,
      thresholds,
    })
    expect(
      (
        r.import_score_reasons_json as { master_recipe?: { master_recipe_id?: string; explanation_pt?: string } }
      ).master_recipe?.master_recipe_id,
    ).toBe("mr-drink-caipirinha-tradicional")
  })

  it("baixa confiança vai para revisão manual", () => {
    const item: XmlLineForResolution = {
      productName: "Item estranho",
      quantity: 1,
      productMatch: {
        resolvedProductId: "refrigerante",
        suggestedProductId: "refrigerante",
        suggestedScore: 50,
        needsConfirmation: false,
        resolutionStatus: "AUTO_MATCH",
      },
    }
    const r = resolveXmlImportLine({
      companyId: "c1",
      supplierId: "s1",
      item,
      rules: [],
      productsById: baseProducts(),
      entryBreakdownRecipes: [],
      thresholds,
    })
    expect(r.import_engine_suggestion).toBe("REVISAO_MANUAL")
    expect(r.import_pending_resolution).toBe(true)
    expect(r.import_stock_resolution).toBeNull()
  })

  it("regra aprendida EXPLODE_BY_RECIPE no XML vira revisão (explosão desligada)", () => {
    const rules: ImportResolutionRuleRow[] = [
      {
        id: "rule-caipi",
        supplier_id: "s1",
        raw_description_pattern: null,
        normalized_description: "caipirinha",
        ean: null,
        ncm: null,
        resolution_mode: "EXPLODE_BY_RECIPE",
        target_product_id: "caipirinha",
        target_recipe_id: "rec_caipi",
        auto_apply: true,
        confidence_override: null,
      },
    ]
    const recipes: EntryBreakdownRecipeRow[] = [
      {
        id: "rec_caipi",
        output_product_id: "caipirinha",
        batch_yield: 1,
        active: true,
        recipe_type: "ENTRY_BREAKDOWN",
        version: 1,
      },
    ]
    const item: XmlLineForResolution = {
      productName: "Caipirinha",
      quantity: 10,
      productMatch: {
        resolvedProductId: "caipirinha",
        suggestedProductId: "caipirinha",
        suggestedScore: 70,
        needsConfirmation: false,
        resolutionStatus: "PENDING_USER_CONFIRM",
      },
    }
    const r = resolveXmlImportLine({
      companyId: "c1",
      supplierId: "s1",
      item,
      rules,
      productsById: baseProducts(),
      entryBreakdownRecipes: recipes,
      thresholds,
    })
    expect(r.import_applied_rule_id).toBe("rule-caipi")
    expect(r.import_stock_resolution).toBeNull()
    expect(r.resolved_entry_breakdown_recipe_id).toBeNull()
    expect(r.import_pending_resolution).toBe(true)
    expect(r.import_nature).toBe("REVISAO_MANUAL")
    expect(r.import_engine_suggestion).toBe("REVISAO_MANUAL")
    expect(
      (r.import_score_reasons_json as { xml_recipe_path_disabled?: boolean })
        ?.xml_recipe_path_disabled,
    ).toBe(true)
  })

  it("produto composto sem ficha de entrada ativa bloqueia auto explosão", () => {
    const item: XmlLineForResolution = {
      productName: "Caipirinha",
      quantity: 1,
      productMatch: {
        resolvedProductId: "caipirinha",
        suggestedProductId: "caipirinha",
        suggestedScore: 99,
        needsConfirmation: false,
        resolutionStatus: "AUTO_MATCH",
      },
    }
    const r = resolveXmlImportLine({
      companyId: "c1",
      supplierId: "s1",
      item,
      rules: [],
      productsById: baseProducts(),
      entryBreakdownRecipes: [],
      thresholds,
    })
    expect(r.import_pending_resolution).toBe(true)
    expect(r.import_stock_resolution).toBeNull()
    expect(r.import_nature).toBe("REVISAO_MANUAL")
  })

  it("score alto com ficha ativa no XML não liga explosão (revisão pendente)", () => {
    const recipes: EntryBreakdownRecipeRow[] = [
      {
        id: "rec1",
        output_product_id: "caipirinha",
        batch_yield: 1,
        active: true,
        recipe_type: "ENTRY_BREAKDOWN",
        version: 2,
      },
    ]
    const item: XmlLineForResolution = {
      productName: "Caipirinha",
      quantity: 2,
      productMatch: {
        resolvedProductId: "caipirinha",
        suggestedProductId: "caipirinha",
        suggestedScore: 96,
        needsConfirmation: false,
        resolutionStatus: "AUTO_MATCH",
      },
    }
    const r = resolveXmlImportLine({
      companyId: "c1",
      supplierId: "s1",
      item,
      rules: [],
      productsById: baseProducts(),
      entryBreakdownRecipes: recipes,
      thresholds,
    })
    expect(r.resolved_entry_breakdown_recipe_id).toBeNull()
    expect(r.import_stock_resolution).toBeNull()
    expect(r.import_pending_resolution).toBe(true)
    expect(r.import_nature).toBe("REVISAO_MANUAL")
    expect(
      (r.import_score_reasons_json as { xml_recipe_path_disabled?: boolean })
        ?.xml_recipe_path_disabled,
    ).toBe(true)
  })

  it("reimportação: decisão memorizada não duplica regra no motor (apenas aplica rule id)", () => {
    const rules: ImportResolutionRuleRow[] = [
      {
        id: "stable",
        supplier_id: "s1",
        normalized_description: "limao tahiti kg",
        raw_description_pattern: null,
        ean: null,
        ncm: null,
        resolution_mode: "DIRECT_STOCK_ENTRY",
        target_product_id: "limao",
        target_recipe_id: null,
        auto_apply: true,
        confidence_override: 1,
      },
    ]
    const item: XmlLineForResolution = {
      productName: "Limão Tahiti KG",
      quantity: 5,
      productMatch: {
        resolvedProductId: null,
        suggestedProductId: "limao",
        suggestedScore: 60,
        needsConfirmation: false,
        resolutionStatus: "NEW_PRODUCT_STAGED",
      },
    }
    const r = resolveXmlImportLine({
      companyId: "c1",
      supplierId: "s1",
      item,
      rules,
      productsById: baseProducts(),
      entryBreakdownRecipes: [],
      thresholds,
    })
    expect(r.import_applied_rule_id).toBe("stable")
    expect(r.target_product_id).toBe("limao")
    expect(r.import_pending_resolution).toBe(false)
  })
})

describe("previewEntryBreakdownQuantities", () => {
  it("Caipirinha: escala e componentes (limão, açúcar, cachaça)", () => {
    const { scale, componentQtys } = previewEntryBreakdownQuantities({
      invoiceStockBasisQty: 10,
      batchYield: 1,
      ingredients: [
        { qtyPerBatchInStockUnit: 3, lossFactor: 1 },
        { qtyPerBatchInStockUnit: 0.2 },
        { qtyPerBatchInStockUnit: 0.05, lossFactor: 1.1 },
      ],
    })
    expect(scale).toBe(10)
    expect(componentQtys[0]).toBeCloseTo(30, 5)
    expect(componentQtys[1]).toBeCloseTo(2, 5)
    expect(componentQtys[2]).toBeCloseTo(0.55, 5)
  })

  it("conversão de unidade na base: fator de rendimento 2", () => {
    const { componentQtys } = previewEntryBreakdownQuantities({
      invoiceStockBasisQty: 4,
      batchYield: 2,
      ingredients: [{ qtyPerBatchInStockUnit: 1 }],
    })
    expect(componentQtys[0]).toBeCloseTo(2, 5)
  })
})

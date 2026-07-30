import { describe, expect, it } from "vitest";
import {
  BCG_QUADRANT_LABELS,
  buildCmvMargensDashboard,
  classifyBcg,
  CMV_MARGIN_TARGET_PCT,
  countByQuadrant,
  priceToReachMargin,
} from "@/lib/cmvMargensResumo";
import type { RevenueEntry } from "@/types/revenue";

function entry(partial: Partial<RevenueEntry> & Pick<RevenueEntry, "id" | "title">): RevenueEntry {
  return {
    company_id: "c1",
    created_by: null,
    entry_date: "2026-07-15",
    entry_mode: "product_sale",
    revenue_type: "operational",
    category_id: null,
    subcategory_id: "sub1",
    product_id: "p1",
    recipe_id: null,
    quantity: 10,
    pricing_mode: "unit",
    unit_value: 10,
    gross_amount: 100,
    tax_type: "currency",
    tax_value: 0,
    tax_amount: 0,
    net_amount: 100,
    source: "product_sale",
    cmv_amount: 40,
    cmv_needs_backfill: false,
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

describe("classifyBcg", () => {
  it("classifica os quatro quadrantes", () => {
    expect(classifyBcg(100, 60, 50)).toBe("estrela");
    expect(classifyBcg(100, 40, 50)).toBe("vaca");
    expect(classifyBcg(10, 60, 50)).toBe("aposta");
    expect(classifyBcg(10, 40, 50)).toBe("abacaxi");
    expect(BCG_QUADRANT_LABELS.estrela).toBe("Estrela");
  });
});

describe("priceToReachMargin", () => {
  it("calcula preço para margem alvo", () => {
    // custo 45 → preço para 55% = 45 / 0.45 = 100
    expect(priceToReachMargin(45, 55)).toBeCloseTo(100, 5);
  });

  it("retorna null com custo inválido", () => {
    expect(priceToReachMargin(0)).toBeNull();
    expect(priceToReachMargin(-1)).toBeNull();
  });
});

describe("countByQuadrant", () => {
  it("conta produtos por quadrante", () => {
    const counts = countByQuadrant([
      { quadrant: "estrela" },
      { quadrant: "estrela" },
      { quadrant: "vaca" },
      { quadrant: "abacaxi" },
    ] as never);
    expect(counts).toEqual({
      estrela: 2,
      vaca: 1,
      aposta: 0,
      abacaxi: 1,
    });
  });
});

describe("buildCmvMargensDashboard", () => {
  const productNameById = new Map([["p1", "Heineken"], ["p2", "Água"]]);
  const recipeNameById = new Map([["r1", "Caipirinha"]]);

  it("calcula KPIs, margem, markup e gaps", () => {
    const entries = [
      entry({
        id: "1",
        title: "Heineken",
        product_id: "p1",
        quantity: 10,
        net_amount: 140,
        gross_amount: 140,
        cmv_amount: 64,
        entry_date: "2026-07-15",
      }),
      entry({
        id: "2",
        title: "Água",
        product_id: "p2",
        quantity: 5,
        net_amount: 25,
        gross_amount: 25,
        cmv_amount: 0,
        cmv_needs_backfill: true,
        entry_date: "2026-07-14",
      }),
      entry({
        id: "3",
        title: "Heineken ontem",
        product_id: "p1",
        quantity: 8,
        net_amount: 112,
        gross_amount: 112,
        cmv_amount: 56,
        entry_date: "2026-07-08",
      }),
    ];

    const dash = buildCmvMargensDashboard({
      entries,
      period: "last7",
      todayYmd: "2026-07-15",
      sort: "melhor",
      productNameById,
      recipeNameById,
    });

    expect(dash.kpis.cmvPct).not.toBeNull();
    expect(dash.kpis.marginPct).not.toBeNull();
    // current period: entries on 09–15 → id1 (15) + id2 (14); id3 is previous week
    expect(dash.products.length).toBe(2);

    const heineken = dash.products.find((p) => p.key === "product:p1")!;
    expect(heineken.productId).toBe("p1");
    expect(heineken.recipeId).toBeNull();
    expect(heineken.shortLabel).toBe("Heineken");
    expect(heineken.sellPrice).toBeCloseTo(14, 5);
    expect(heineken.costPrice).toBeCloseTo(6.4, 5);
    expect(heineken.markup).toBeCloseTo(14 / 6.4, 5);
    expect(heineken.marginPct).toBeCloseTo(((140 - 64) / 140) * 100, 5);

    expect(dash.gaps.length).toBeGreaterThanOrEqual(1);
    expect(dash.kpis.pendingGapCount).toBeGreaterThanOrEqual(1);
    expect(dash.kpis.reconciledPct).toBeLessThan(100);
    expect(dash.insight.length).toBeGreaterThan(0);
    expect(dash.insight).toMatch(/sem CMV/i);
  });

  it("gera insight acionável quando CMV está completo", () => {
    const entries = [
      entry({
        id: "1",
        title: "Heineken Long Neck",
        product_id: "p1",
        quantity: 20,
        net_amount: 200,
        cmv_amount: 100, // 50% margem — perto da meta 55%
        entry_date: "2026-07-15",
      }),
      entry({
        id: "2",
        title: "Água",
        product_id: "p2",
        quantity: 5,
        net_amount: 50,
        cmv_amount: 10, // 80% margem
        entry_date: "2026-07-15",
      }),
    ];
    const dash = buildCmvMargensDashboard({
      entries,
      period: "today",
      todayYmd: "2026-07-15",
      sort: "volume",
      productNameById,
      recipeNameById,
    });
    expect(dash.gaps).toHaveLength(0);
    expect(dash.insight).toMatch(/Vaca leiteira|Estrela|margem/i);
    const heineken = dash.products.find((p) => p.key === "product:p1")!;
    expect(heineken.shortLabel).toBe("Heineken");
  });

  it("ordena por pior margem", () => {
    const entries = [
      entry({
        id: "1",
        title: "A",
        product_id: "p1",
        net_amount: 100,
        cmv_amount: 20,
        quantity: 10,
        entry_date: "2026-07-15",
      }),
      entry({
        id: "2",
        title: "B",
        product_id: "p2",
        net_amount: 100,
        cmv_amount: 70,
        quantity: 10,
        entry_date: "2026-07-15",
      }),
    ];
    const dash = buildCmvMargensDashboard({
      entries,
      period: "today",
      todayYmd: "2026-07-15",
      sort: "pior",
      productNameById,
      recipeNameById,
    });
    expect(dash.products[0]!.key).toBe("product:p2");
    expect(dash.products[0]!.marginPct!).toBeLessThan(CMV_MARGIN_TARGET_PCT);
  });

  it("trata produto que não compõe CMV como conciliado", () => {
    const entries = [
      entry({
        id: "1",
        title: "Detergente",
        product_id: "p2",
        net_amount: 50,
        cmv_amount: 0,
        entry_date: "2026-07-15",
      }),
    ];
    const dash = buildCmvMargensDashboard({
      entries,
      period: "today",
      todayYmd: "2026-07-15",
      sort: "volume",
      productNameById,
      recipeNameById,
      productMetaById: new Map([["p2", { composes_cmv: false }]]),
    });
    expect(dash.gaps).toHaveLength(0);
    expect(dash.kpis.reconciledPct).toBe(100);
  });

  it("agrega recipe_sale pelo prato", () => {
    const entries = [
      entry({
        id: "1",
        title: "Caipirinha",
        entry_mode: "recipe_sale",
        source: "recipe_sale",
        product_id: null,
        recipe_id: "r1",
        net_amount: 115,
        cmv_amount: 68,
        quantity: 10,
        entry_date: "2026-07-15",
      }),
    ];
    const dash = buildCmvMargensDashboard({
      entries,
      period: "today",
      todayYmd: "2026-07-15",
      sort: "melhor",
      productNameById,
      recipeNameById,
    });
    expect(dash.products).toHaveLength(1);
    expect(dash.products[0]!.label).toBe("Caipirinha");
    expect(dash.products[0]!.key).toBe("recipe:r1");
    expect(dash.products[0]!.recipeId).toBe("r1");
    expect(dash.products[0]!.productId).toBeNull();
  });
});

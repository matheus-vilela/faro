import {
  getResumoRanges,
  type ResumoPeriodFilter,
  type ResumoRanges,
} from "@/lib/vendasRealizadasResumo";
import { parseRevenueCmvLines } from "@/types/revenueCmv";
import type { RevenueEntry } from "@/types/revenue";

export type CmvPeriodFilter = ResumoPeriodFilter;

export type CmvSortMode = "melhor" | "pior" | "volume";

export type CmvViewMode = "tabela" | "bcg";

export type BcgQuadrant = "estrela" | "vaca" | "aposta" | "abacaxi";

/** Meta de margem bruta (%) — alinhada ao protótipo. */
export const CMV_MARGIN_TARGET_PCT = 55;

export type CmvProductRow = {
  key: string;
  label: string;
  /** Rótulo curto para bolhas BCG (até ~14 chars). */
  shortLabel: string;
  productId: string | null;
  recipeId: string | null;
  /** Quantidade vendida no período. */
  quantity: number;
  /** Receita líquida no período. */
  revenue: number;
  /** CMV total no período. */
  cmv: number;
  /** Preço médio de venda (líquido / qtde). */
  sellPrice: number;
  /** Custo médio unitário (CMV / qtde). */
  costPrice: number;
  /** Markup = venda / custo (null se custo 0). */
  markup: number | null;
  /** Margem bruta % = (receita − CMV) / receita. */
  marginPct: number | null;
  /** Delta de margem em pp vs período anterior (null se sem base). */
  marginDeltaPp: number | null;
  quadrant: BcgQuadrant;
};

export type CmvGapKind = "backfill" | "no_cost" | "recipe";

export type CmvGapRow = {
  key: string;
  label: string;
  kind: CmvGapKind;
  /** Receita líquida afetada no período. */
  revenue: number;
  /** Quantidade de lançamentos. */
  count: number;
  /** Peso relativo na receita elegível (0–1). */
  weight: number;
  /** product_id ou recipe_id para deep-link, se houver. */
  productId: string | null;
  recipeId: string | null;
  hint: string;
};

export type CmvKpis = {
  /** CMV / receita líquida, em % (0–100). */
  cmvPct: number | null;
  /** Margem bruta média % = 100 − cmvPct. */
  marginPct: number | null;
  /** Quantidade de produtos com margem abaixo da meta. */
  belowTargetCount: number;
  /** Receita com CMV válido / receita elegível (0–100). */
  reconciledPct: number;
  /** Receita elegível (vendas de produto/receita). */
  eligibleRevenue: number;
  /** Receita com CMV ok. */
  reconciledRevenue: number;
  pendingGapCount: number;
};

export type CmvMargensDashboard = {
  ranges: ResumoRanges;
  kpis: CmvKpis;
  products: CmvProductRow[];
  gaps: CmvGapRow[];
  insight: string;
  volumeThreshold: number;
  marginThreshold: number;
};

export type ProductCmvMeta = {
  composes_cmv?: boolean | null;
  average_cost?: number | null;
};

function inRange(ymd: string, start: string, end: string): boolean {
  return ymd >= start && ymd <= end;
}

function entryQuantity(e: RevenueEntry): number {
  const q = Number(e.quantity);
  if (Number.isFinite(q) && q > 0) return q;
  return 1;
}

function productKey(e: RevenueEntry): string {
  if (e.entry_mode === "product_sale" && e.product_id) {
    return `product:${e.product_id}`;
  }
  if (e.entry_mode === "recipe_sale" && e.recipe_id) {
    return `recipe:${e.recipe_id}`;
  }
  return `manual:${e.title.trim().toLowerCase() || e.id}`;
}

function productLabel(
  e: RevenueEntry,
  productNameById: Map<string, string>,
  recipeNameById: Map<string, string>,
): string {
  if (e.entry_mode === "product_sale" && e.product_id) {
    return productNameById.get(e.product_id) || e.title || "Produto";
  }
  if (e.entry_mode === "recipe_sale" && e.recipe_id) {
    return recipeNameById.get(e.recipe_id) || e.title || "Receita";
  }
  return e.title?.trim() || "Lançamento manual";
}

function isSaleEntry(e: RevenueEntry): boolean {
  return e.entry_mode === "product_sale" || e.entry_mode === "recipe_sale";
}

function entryCmv(e: RevenueEntry): number {
  return Math.max(0, Number(e.cmv_amount) || 0);
}

function productComposesCmv(
  e: RevenueEntry,
  productMetaById: Map<string, ProductCmvMeta>,
): boolean {
  if (e.entry_mode === "product_sale" && e.product_id) {
    const meta = productMetaById.get(e.product_id);
    if (meta && meta.composes_cmv === false) return false;
  }
  return true;
}

/** Venda elegível a CMV (produto/receita que compõe CMV). */
function isCmvEligible(
  e: RevenueEntry,
  productMetaById: Map<string, ProductCmvMeta>,
): boolean {
  if (!isSaleEntry(e)) return false;
  return productComposesCmv(e, productMetaById);
}

/** CMV considerado válido para “faturamento conciliado”. */
function hasValidCmv(
  e: RevenueEntry,
  productMetaById: Map<string, ProductCmvMeta>,
): boolean {
  if (!isCmvEligible(e, productMetaById)) return true;
  if (e.cmv_needs_backfill) return false;
  return entryCmv(e) > 0;
}

type ProductAcc = {
  key: string;
  label: string;
  productId: string | null;
  recipeId: string | null;
  quantity: number;
  revenue: number;
  cmv: number;
};

function shortLabelFrom(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "—";
  const first = trimmed.split(/\s+/)[0] ?? trimmed;
  if (first.length <= 14) return first;
  return `${first.slice(0, 13)}…`;
}

function idsFromKey(key: string): {
  productId: string | null;
  recipeId: string | null;
} {
  if (key.startsWith("product:")) {
    return { productId: key.slice("product:".length), recipeId: null };
  }
  if (key.startsWith("recipe:")) {
    return { productId: null, recipeId: key.slice("recipe:".length) };
  }
  return { productId: null, recipeId: null };
}

function accumulateProducts(
  entries: RevenueEntry[],
  productNameById: Map<string, string>,
  recipeNameById: Map<string, string>,
): Map<string, ProductAcc> {
  const map = new Map<string, ProductAcc>();
  for (const e of entries) {
    if (!isSaleEntry(e)) continue;
    const key = productKey(e);
    const label = productLabel(e, productNameById, recipeNameById);
    const ids = idsFromKey(key);
    const prev = map.get(key);
    const qty = entryQuantity(e);
    const revenue = Number(e.net_amount) || 0;
    const cmv = entryCmv(e);
    if (prev) {
      prev.quantity += qty;
      prev.revenue += revenue;
      prev.cmv += cmv;
    } else {
      map.set(key, {
        key,
        label,
        productId: ids.productId ?? e.product_id,
        recipeId: ids.recipeId ?? e.recipe_id,
        quantity: qty,
        revenue,
        cmv,
      });
    }
  }
  return map;
}

function marginPctOf(revenue: number, cmv: number): number | null {
  if (revenue <= 0) return null;
  return ((revenue - cmv) / revenue) * 100;
}

function markupOf(sellPrice: number, costPrice: number): number | null {
  if (costPrice <= 0) return null;
  return sellPrice / costPrice;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function classifyBcg(
  volume: number,
  marginPct: number | null,
  volumeThreshold: number,
  marginThreshold: number = CMV_MARGIN_TARGET_PCT,
): BcgQuadrant {
  const hiVol = volume >= volumeThreshold;
  const hiMarg = marginPct != null && marginPct >= marginThreshold;
  if (hiVol && hiMarg) return "estrela";
  if (hiVol && !hiMarg) return "vaca";
  if (!hiVol && hiMarg) return "aposta";
  return "abacaxi";
}

export const BCG_QUADRANT_LABELS: Record<BcgQuadrant, string> = {
  estrela: "Estrela",
  vaca: "Vaca leiteira",
  aposta: "Aposta",
  abacaxi: "Abacaxi",
};

/** Preço de venda necessário para atingir margem alvo dado o custo unitário. */
export function priceToReachMargin(
  costPrice: number,
  targetMarginPct: number = CMV_MARGIN_TARGET_PCT,
): number | null {
  if (!(costPrice > 0)) return null;
  const t = targetMarginPct / 100;
  if (t >= 1 || t < 0) return null;
  return costPrice / (1 - t);
}

export function countByQuadrant(
  products: CmvProductRow[],
): Record<BcgQuadrant, number> {
  const counts: Record<BcgQuadrant, number> = {
    estrela: 0,
    vaca: 0,
    aposta: 0,
    abacaxi: 0,
  };
  for (const p of products) {
    counts[p.quadrant] += 1;
  }
  return counts;
}

function sortProducts(
  rows: CmvProductRow[],
  sort: CmvSortMode,
): CmvProductRow[] {
  const copy = [...rows];
  if (sort === "pior") {
    copy.sort((a, b) => (a.marginPct ?? 999) - (b.marginPct ?? 999));
  } else if (sort === "volume") {
    copy.sort((a, b) => b.quantity - a.quantity);
  } else {
    copy.sort((a, b) => (b.marginPct ?? -999) - (a.marginPct ?? -999));
  }
  return copy;
}

function buildGaps(
  entries: RevenueEntry[],
  productNameById: Map<string, string>,
  recipeNameById: Map<string, string>,
  productMetaById: Map<string, ProductCmvMeta>,
  eligibleRevenue: number,
): CmvGapRow[] {
  type Acc = {
    key: string;
    label: string;
    kind: CmvGapKind;
    revenue: number;
    count: number;
    productId: string | null;
    recipeId: string | null;
  };
  const map = new Map<string, Acc>();

  for (const e of entries) {
    if (!isCmvEligible(e, productMetaById)) continue;
    if (hasValidCmv(e, productMetaById)) continue;

    let kind: CmvGapKind;
    if (e.cmv_needs_backfill) {
      kind = "backfill";
    } else if (e.entry_mode === "recipe_sale") {
      kind = "recipe";
    } else {
      kind = "no_cost";
    }

    const key = `${productKey(e)}:${kind}`;
    const label = productLabel(e, productNameById, recipeNameById);
    const revenue = Number(e.net_amount) || 0;
    const prev = map.get(key);
    if (prev) {
      prev.revenue += revenue;
      prev.count += 1;
    } else {
      map.set(key, {
        key,
        label,
        kind,
        revenue,
        count: 1,
        productId: e.product_id,
        recipeId: e.recipe_id,
      });
    }
  }

  const hints: Record<CmvGapKind, string> = {
    backfill: "Custo pendente de backfill — cadastre o custo do produto",
    no_cost: "Venda sem CMV — verifique custo médio do produto",
    recipe: "Receita sem CMV — revise a ficha técnica",
  };

  return [...map.values()]
    .map((row) => ({
      ...row,
      weight: eligibleRevenue > 0 ? row.revenue / eligibleRevenue : 0,
      hint: hints[row.kind],
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

function buildInsight(
  products: CmvProductRow[],
  kpis: CmvKpis,
): string {
  if (products.length === 0) {
    return "Não há vendas de produto ou receita neste período para analisar margens.";
  }
  if (kpis.pendingGapCount > 0) {
    return `${kpis.pendingGapCount} item(ns) ainda sem CMV confiável — ${kpis.reconciledPct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% do faturamento elegível está conciliado.`;
  }

  const withMargin = products.filter((p) => p.marginPct != null);
  const worst = [...withMargin].sort(
    (a, b) => (a.marginPct ?? 0) - (b.marginPct ?? 0),
  )[0];
  const best = [...withMargin].sort(
    (a, b) => (b.marginPct ?? 0) - (a.marginPct ?? 0),
  )[0];

  // Vaca perto da meta: sugestão de preço para virar Estrela
  const nearStar = products
    .filter(
      (p) =>
        p.quadrant === "vaca" &&
        p.marginPct != null &&
        p.marginPct >= CMV_MARGIN_TARGET_PCT - 5 &&
        p.marginPct < CMV_MARGIN_TARGET_PCT &&
        p.costPrice > 0,
    )
    .sort((a, b) => (b.marginPct ?? 0) - (a.marginPct ?? 0))[0];

  if (nearStar) {
    const target = priceToReachMargin(nearStar.costPrice);
    if (target != null && target > nearStar.sellPrice) {
      const bump = target - nearStar.sellPrice;
      return `${nearStar.label} está em Vaca leiteira com ${Math.round(nearStar.marginPct!)}% de margem (vende bem, mas abaixo da meta). Subir cerca de ${bump.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} no preço unitário já a leva para Estrela.`;
    }
  }

  if (!worst || !best) {
    return "Margens disponíveis para os produtos vendidos no período.";
  }

  const markups = products
    .map((p) => p.markup)
    .filter((m): m is number => m != null && m > 0);
  const medMarkup = markups.length > 0 ? median(markups) : null;

  if (worst.key === best.key) {
    return `${best.label} está com margem de ${Math.round(best.marginPct!)}%.`;
  }

  let line = `${best.label} lidera com ${Math.round(best.marginPct!)}% de margem. Sua pior margem agora é ${worst.label} com ${Math.round(worst.marginPct!)}%`;
  if (worst.markup != null) {
    line += ` — markup ${worst.markup.toFixed(2).replace(".", ",")}x`;
    if (medMarkup != null && worst.markup < medMarkup) {
      line += ` (abaixo da mediana ${medMarkup.toFixed(2).replace(".", ",")}x do cardápio)`;
    }
  }
  line += ".";

  if (worst.quadrant === "vaca" || worst.quadrant === "abacaxi") {
    line += ` Na matriz BCG ela aparece como ${BCG_QUADRANT_LABELS[worst.quadrant].toLowerCase()}.`;
  }

  return line;
}

/**
 * Agrega CMV e margens por produto/receita vendidos no período.
 * Preço de venda = receita líquida / quantidade; custo = CMV / quantidade.
 */
export function buildCmvMargensDashboard(input: {
  entries: RevenueEntry[];
  period: CmvPeriodFilter;
  todayYmd: string;
  sort: CmvSortMode;
  productNameById: Map<string, string>;
  recipeNameById: Map<string, string>;
  productMetaById?: Map<string, ProductCmvMeta>;
}): CmvMargensDashboard {
  const productMetaById = input.productMetaById ?? new Map();
  const ranges = getResumoRanges(input.period, input.todayYmd);
  const operational = input.entries.filter(
    (e) => e.revenue_type === "operational",
  );
  const current = operational.filter((e) =>
    inRange(e.entry_date.slice(0, 10), ranges.currentStart, ranges.currentEnd),
  );
  const previous = operational.filter((e) =>
    inRange(
      e.entry_date.slice(0, 10),
      ranges.previousStart,
      ranges.previousEnd,
    ),
  );

  const currentAcc = accumulateProducts(
    current,
    input.productNameById,
    input.recipeNameById,
  );
  const previousAcc = accumulateProducts(
    previous,
    input.productNameById,
    input.recipeNameById,
  );

  const volumes = [...currentAcc.values()].map((p) => p.quantity);
  const volumeThreshold =
    volumes.length > 0 ? Math.max(1, median(volumes)) : 1;

  let totalNet = 0;
  let totalCmv = 0;
  let eligibleRevenue = 0;
  let reconciledRevenue = 0;

  for (const e of current) {
    const net = Number(e.net_amount) || 0;
    totalNet += net;
    totalCmv += entryCmv(e);
    if (isCmvEligible(e, productMetaById)) {
      eligibleRevenue += net;
      if (hasValidCmv(e, productMetaById)) {
        reconciledRevenue += net;
      }
    } else if (isSaleEntry(e) && !productComposesCmv(e, productMetaById)) {
      // Produto operacional (não compõe CMV): conta como conciliado.
      eligibleRevenue += net;
      reconciledRevenue += net;
    }
  }

  const cmvPct = totalNet > 0 ? (totalCmv / totalNet) * 100 : null;
  const marginPct = cmvPct != null ? 100 - cmvPct : null;

  const productsRaw: CmvProductRow[] = [...currentAcc.values()].map((acc) => {
    const sellPrice = acc.quantity > 0 ? acc.revenue / acc.quantity : 0;
    const costPrice = acc.quantity > 0 ? acc.cmv / acc.quantity : 0;
    const mPct = marginPctOf(acc.revenue, acc.cmv);
    const prev = previousAcc.get(acc.key);
    const prevMargin =
      prev != null ? marginPctOf(prev.revenue, prev.cmv) : null;
    const marginDeltaPp =
      mPct != null && prevMargin != null ? mPct - prevMargin : null;
    return {
      key: acc.key,
      label: acc.label,
      shortLabel: shortLabelFrom(acc.label),
      productId: acc.productId,
      recipeId: acc.recipeId,
      quantity: acc.quantity,
      revenue: acc.revenue,
      cmv: acc.cmv,
      sellPrice,
      costPrice,
      markup: markupOf(sellPrice, costPrice),
      marginPct: mPct,
      marginDeltaPp,
      quadrant: classifyBcg(
        acc.quantity,
        mPct,
        volumeThreshold,
        CMV_MARGIN_TARGET_PCT,
      ),
    };
  });

  const belowTargetCount = productsRaw.filter(
    (p) => p.marginPct != null && p.marginPct < CMV_MARGIN_TARGET_PCT,
  ).length;

  const gaps = buildGaps(
    current,
    input.productNameById,
    input.recipeNameById,
    productMetaById,
    eligibleRevenue,
  );

  const kpis: CmvKpis = {
    cmvPct,
    marginPct,
    belowTargetCount,
    reconciledPct:
      eligibleRevenue > 0 ? (reconciledRevenue / eligibleRevenue) * 100 : 100,
    eligibleRevenue,
    reconciledRevenue,
    pendingGapCount: gaps.length,
  };

  const products = sortProducts(productsRaw, input.sort);

  return {
    ranges,
    kpis,
    products,
    gaps,
    insight: buildInsight(products, kpis),
    volumeThreshold,
    marginThreshold: CMV_MARGIN_TARGET_PCT,
  };
}

/** Expõe linhas de CMV de um lançamento (útil para detalhe / testes). */
export function sumCmvLinesAmount(raw: unknown): number {
  return parseRevenueCmvLines(raw).reduce((s, line) => s + line.amount, 0);
}

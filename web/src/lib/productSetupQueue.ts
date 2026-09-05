import {
  fetchDashboardImportReviewEpocRecipesNoIngredients,
  fetchDashboardImportReviewPendingRevenueLink,
} from "@/lib/dashboardImportReview";
import {
  fetchCompanyRecipesForPick,
  fetchProductRecipeMatchLists,
  type ProductRecipeMatchRow,
  type PurchaseMatchRow,
  type RecipePickRow,
} from "@/lib/onboardingProductRecipeMatch";
import { fetchExcludedFromSalesProductIds } from "@/lib/productExcludeFromSales";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProductSetupKind =
  | "purchase_unlinked"
  | "sold_unlinked"
  | "recipe_without_ingredients"
  | "recipe_sales_unlinked";

export type ProductSetupItem = {
  key: string;
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  kind: ProductSetupKind;
  sourceLabel: string;
  pendingQuestion: string;
  recipeId?: string | null;
  pendingSalesCount?: number;
  sku?: string | null;
  ean?: string | null;
  barcode?: string | null;
  priorityEpoc?: boolean;
  /** Volume de giro: saídas (venda) ou entradas (compra), para ordenar correção. */
  turnoverQty?: number;
};

export const PRODUCT_SETUP_KIND_LABEL: Record<ProductSetupKind, string> = {
  purchase_unlinked: "Compra sem uso",
  sold_unlinked: "Venda sem entrada",
  recipe_without_ingredients: "Ficha incompleta",
  recipe_sales_unlinked: "Vendas da ficha",
};

export type ProductSetupChoice =
  | "link_item"
  | "recipe"
  | "intermediate"
  | "sale_family"
  | "sale_family_variant"
  | "ingredient"
  | "skip";

export const PRODUCT_SETUP_CHOICE_LABEL: Record<ProductSetupChoice, string> = {
  link_item: "Unificar com outro item",
  recipe: "Ficha técnica",
  intermediate: "Produto intermediário",
  sale_family: "É um agrupamento",
  sale_family_variant: "Variante de um agrupamento",
  ingredient: "Insumo de uma ficha",
  skip: "É um produto",
};

const SOLD_SETUP_CHOICES: ProductSetupChoice[] = [
  "link_item",
  "recipe",
  "intermediate",
  "sale_family",
  "sale_family_variant",
  "skip",
];

const PURCHASE_SETUP_CHOICES: ProductSetupChoice[] = [
  "link_item",
  "ingredient",
  "sale_family_variant",
  "intermediate",
  "skip",
];

const FICHA_SALES_SETUP_CHOICES: ProductSetupChoice[] = ["recipe"];

export type ProductSetupChoiceOption = {
  value: ProductSetupChoice;
  label: string;
};

export function itemTurnoverQty(item: ProductSetupItem): number {
  return Number(item.turnoverQty ?? 0);
}

async function attachProductTurnover(
  client: SupabaseClient,
  companyId: string,
  items: ProductSetupItem[],
): Promise<ProductSetupItem[]> {
  const ids = [...new Set(items.map((item) => item.productId))];
  if (ids.length === 0) return items;
  const totals = new Map<string, { inQty: number; outQty: number }>();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const { data, error } = await client.rpc("product_movement_totals", {
      p_company_id: companyId,
      p_product_ids: chunk,
    });
    if (error) break;
    for (const row of data ?? []) {
      const rec = row as {
        product_id?: string;
        in_qty?: number;
        out_qty?: number;
      };
      const id = String(rec.product_id ?? "").trim();
      if (!id) continue;
      totals.set(id, {
        inQty: Number(rec.in_qty ?? 0),
        outQty: Number(rec.out_qty ?? 0),
      });
    }
  }
  return items.map((item) => {
    const t = totals.get(item.productId);
    const inQty = t?.inQty ?? 0;
    const outQty = t?.outQty ?? 0;
    const turnoverQty =
      item.kind === "purchase_unlinked"
        ? inQty
        : item.kind === "sold_unlinked" ||
            item.kind === "recipe_without_ingredients"
          ? outQty
          : Math.max(inQty, outQty);
    return { ...item, turnoverQty };
  });
}

export function isEpocSetupItem(item: ProductSetupItem): boolean {
  if (item.kind === "purchase_unlinked") return false;
  return (
    item.priorityEpoc === true ||
    item.sourceLabel.toUpperCase().includes("EPOC") ||
    item.kind === "sold_unlinked" ||
    item.kind === "recipe_without_ingredients"
  );
}

export function formatTurnoverLine(item: ProductSetupItem): string | null {
  const qty = itemTurnoverQty(item);
  if (qty <= 0) return null;
  const unit = item.unit && item.unit !== "—" ? item.unit : "un";
  const n = qty.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const isPurchase = item.kind === "purchase_unlinked";
  const singular = qty === 1;
  const verb = isPurchase
    ? singular
      ? "comprada"
      : "compradas"
    : singular
      ? "vendida"
      : "vendidas";
  if (
    isPurchase ||
    item.kind === "sold_unlinked" ||
    item.kind === "recipe_without_ingredients"
  ) {
    return `${n} ${unit} ${verb}`;
  }
  return `${n} ${unit}`;
}

export function maxTurnoverQty(...items: Array<ProductSetupItem | undefined>): number {
  return Math.max(0, ...items.map((item) => (item ? itemTurnoverQty(item) : 0)));
}

export function compareTurnoverDesc(
  a: ProductSetupItem,
  b: ProductSetupItem,
): number {
  const d = itemTurnoverQty(b) - itemTurnoverQty(a);
  if (d !== 0) return d;
  return a.name.localeCompare(b.name, "pt-BR");
}

export function setupChoicesForItem(
  item: ProductSetupItem,
): ProductSetupChoiceOption[] {
  const values =
    item.kind === "purchase_unlinked"
      ? PURCHASE_SETUP_CHOICES
      : item.kind === "recipe_sales_unlinked"
        ? FICHA_SALES_SETUP_CHOICES
        : SOLD_SETUP_CHOICES;
  return values.map((value) => ({
    value,
    label: PRODUCT_SETUP_CHOICE_LABEL[value],
  }));
}

export type ProductSetupQueue = {
  items: ProductSetupItem[];
  counts: {
    total: number;
    purchases: number;
    sold: number;
    recipes: number;
  };
  soldOnly: ProductRecipeMatchRow[];
  purchases: PurchaseMatchRow[];
  recipes: RecipePickRow[];
  error: string | null;
};

function asMatchRow(item: ProductSetupItem): ProductRecipeMatchRow {
  return {
    product_id: item.productId,
    name: item.name,
    unit: item.unit,
    current_quantity: item.quantity,
    sku: item.sku,
    ean: item.ean,
    barcode: item.barcode,
    recipe_id: item.recipeId ?? null,
  };
}

export function setupItemAsMatchRow(item: ProductSetupItem): ProductRecipeMatchRow {
  return asMatchRow(item);
}

export async function fetchProductSetupQueue(
  client: SupabaseClient,
  companyId: string,
): Promise<ProductSetupQueue> {
  const [lists, pendingRecipes, pendingSales, recipesPick, excludedIds] =
    await Promise.all([
    fetchProductRecipeMatchLists(client, companyId, {
      purchaseLimit: 2000,
      purchaseOffset: 0,
      soldLimit: 2000,
      soldOffset: 0,
    }),
    fetchDashboardImportReviewEpocRecipesNoIngredients(client, companyId),
    fetchDashboardImportReviewPendingRevenueLink(client, companyId),
    fetchCompanyRecipesForPick(client, companyId),
    fetchExcludedFromSalesProductIds(companyId),
  ]);

  const error =
    lists.error ??
    pendingRecipes.error ??
    pendingSales.error ??
    recipesPick.error ??
    null;

  const recipePendingIds = new Set(
    pendingRecipes.rows.map((row) => row.product_id),
  );
  const salesLinkIds = new Set(pendingSales.rows.map((row) => row.product_id));
  const recipeOutputIds = new Set(
    recipesPick.rows
      .map((row) => row.output_product_id)
      .filter((id): id is string => Boolean(id)),
  );
  const excludedFromSales = new Set(excludedIds);

  const items: ProductSetupItem[] = [];

  for (const purchase of lists.purchases) {
    if (purchase.utilizations.length > 0) continue;
    if (recipeOutputIds.has(purchase.product_id)) continue;
    items.push({
      key: `purchase:${purchase.product_id}`,
      productId: purchase.product_id,
      name: purchase.name,
      unit: purchase.unit,
      quantity: purchase.current_quantity,
      kind: "purchase_unlinked",
      sourceLabel: "Nota / compra",
      pendingQuestion:
        "A qual item isso se relaciona? Sem o vínculo, a próxima nota pode entrar no cadastro errado.",
      sku: purchase.sku,
      ean: purchase.ean,
      barcode: purchase.barcode,
    });
  }

  for (const row of pendingRecipes.rows) {
    items.push({
      key: `recipe:${row.product_id}`,
      productId: row.product_id,
      name: row.name,
      unit: row.unit,
      quantity: 0,
      kind: "recipe_without_ingredients",
      sourceLabel: row.priority_epoc ? "PDV (EPOC) / venda" : "Venda",
      pendingQuestion:
        "Este item vendido parece uma ficha técnica. Informe os insumos ou diga que não é ficha.",
      recipeId: row.recipe_id,
      priorityEpoc: row.priority_epoc === true,
    });
  }

  for (const sold of lists.soldOnly) {
    if (excludedFromSales.has(sold.product_id)) continue;
    if (recipePendingIds.has(sold.product_id)) continue;
    if (salesLinkIds.has(sold.product_id)) continue;
    // Ficha já existe: a correlação ainda devolve o item (só saída), mas o setup acabou.
    if (sold.recipe_id) continue;
    if (recipeOutputIds.has(sold.product_id)) continue;
    items.push({
      key: `sold:${sold.product_id}`,
      productId: sold.product_id,
      name: sold.name,
      unit: sold.unit,
      quantity: sold.current_quantity,
      kind: "sold_unlinked",
      sourceLabel: "PDV / venda",
      pendingQuestion:
        "Este item sai na venda, mas não tem entrada. É ficha, intermediário, agrupamento, o mesmo produto de uma compra, ou só produto?",
      recipeId: sold.recipe_id,
      sku: sold.sku,
      ean: sold.ean,
      barcode: sold.barcode,
    });
  }

  for (const row of pendingSales.rows) {
    items.push({
      key: `sales:${row.product_id}`,
      productId: row.product_id,
      name: row.name,
      unit: "—",
      quantity: 0,
      kind: "recipe_sales_unlinked",
      sourceLabel: "Ficha técnica",
      pendingQuestion:
        "A ficha já tem insumos, mas as vendas importadas ainda estão ligadas ao produto. Ligue-as à ficha.",
      recipeId: row.recipe_id,
      pendingSalesCount: row.pending_sales_count,
    });
  }

  const counts = {
    total: items.length,
    purchases: items.filter((i) => i.kind === "purchase_unlinked").length,
    sold: items.filter((i) => i.kind === "sold_unlinked").length,
    recipes: items.filter(
      (i) =>
        i.kind === "recipe_without_ingredients" ||
        i.kind === "recipe_sales_unlinked",
    ).length,
  };

  const withTurnover = await attachProductTurnover(client, companyId, items);

  return {
    items: withTurnover,
    counts,
    soldOnly: lists.soldOnly,
    purchases: lists.purchases,
    recipes: recipesPick.rows,
    error,
  };
}

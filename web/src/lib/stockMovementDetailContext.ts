import { recipeKindFilterValue } from "@/lib/recipeListFilter";
import { recipeSheetPath } from "@/lib/productStockPaths";
import {
  fetchStockMovementInvoiceContext,
  type StockMovementInvoiceContext,
} from "@/lib/stockMovementInvoiceContext";
import { supabase } from "@/lib/supabase";

const REVENUE_REFS = new Set([
  "revenue_entry",
  "revenue_entry_update",
  "revenue_entry_delete",
]);

export type ProductStockRole =
  | "direct"
  | "recipe_sale"
  | "intermediate"
  | "sale_family"
  | "service";

export type StockMovementRecipeKind = "sale" | "production";

export type StockMovementProductInfo = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  stock_control_type: string | null;
  role: ProductStockRole;
  average_cost: number | null;
  last_unit_value: number | null;
};

export type StockMovementRecipeInfo = {
  id: string;
  name: string;
  recipe_type: string | null;
  kind: StockMovementRecipeKind;
  output_product_id: string | null;
  output_product_name: string | null;
  href: string;
  /** A linha é baixa de insumo (não o prato/intermediário produzido). */
  ingredientOut: boolean;
};

export type StockMovementRevenueInfo = {
  id: string;
  entry_date: string;
  title: string;
  entry_mode: string | null;
  quantity: number | null;
  sale_unit_code: string | null;
  unit_value: number | null;
  gross_amount: number;
  net_amount: number;
  tax_amount: number;
  cmv_amount: number | null;
  recipe_id: string | null;
  product_id: string | null;
};

export type StockMovementDetailContext = {
  product: StockMovementProductInfo | null;
  recipe: StockMovementRecipeInfo | null;
  revenue: StockMovementRevenueInfo | null;
  invoice: StockMovementInvoiceContext | null;
};

export function isRevenueStockMovementReference(
  referenceType: string | null | undefined,
): boolean {
  return REVENUE_REFS.has((referenceType ?? "").trim().toLowerCase());
}

export function productStockRoleFromType(
  stockControlType: string | null | undefined,
): ProductStockRole {
  const t = (stockControlType ?? "").trim().toUpperCase();
  if (t === "RECIPE_CONTROLLED") return "recipe_sale";
  if (t === "INTERMEDIATE") return "intermediate";
  if (t === "SALE_FAMILY") return "sale_family";
  if (t === "SERVICE") return "service";
  return "direct";
}

export function productStockRoleLabel(role: ProductStockRole): string {
  switch (role) {
    case "recipe_sale":
      return "Ficha técnica";
    case "intermediate":
      return "Produto intermediário";
    case "sale_family":
      return "Agrupamento";
    case "service":
      return "Serviço";
    default:
      return "Produto";
  }
}

export function productStockRoleHint(role: ProductStockRole): string {
  switch (role) {
    case "recipe_sale":
      return "Prato ou dose: a venda baixa os insumos da ficha, não este cadastro.";
    case "intermediate":
      return "Produz e estoca. A venda baixa só este saldo; os insumos saem na produção.";
    case "sale_family":
      return "Item de cardápio sem estoque próprio. A baixa vai nas variantes.";
    case "service":
      return "Sem estoque.";
    default:
      return "Compra entra saldo. Venda ou uso baixa 1:1.";
  }
}

export function recipeKindLabel(kind: StockMovementRecipeKind): string {
  return kind === "production" ? "Ficha de produção" : "Ficha técnica";
}

export function movementLineTotalCost(
  quantity: number,
  unitCost: number | null,
): number | null {
  if (unitCost == null || !Number.isFinite(unitCost)) return null;
  const qty = Math.abs(Number(quantity));
  if (!Number.isFinite(qty)) return null;
  return qty * unitCost;
}

type RecipeRow = {
  id: string;
  name: string | null;
  recipe_type: string | null;
  output_product_id: string | null;
};

async function outputProductName(
  productId: string | null,
): Promise<string | null> {
  if (!productId) return null;
  const { data, error } = await supabase
    .from("products")
    .select("name")
    .eq("id", productId)
    .maybeSingle();
  if (error || !data) return null;
  return String(data.name ?? "").trim() || null;
}

async function recipeInfoFromRow(
  row: RecipeRow,
  ingredientOut: boolean,
): Promise<StockMovementRecipeInfo> {
  const kind = recipeKindFilterValue(row.recipe_type);
  return {
    id: row.id,
    name: (row.name ?? "").trim() || "Ficha",
    recipe_type: row.recipe_type,
    kind,
    output_product_id: row.output_product_id,
    output_product_name: await outputProductName(row.output_product_id),
    href: recipeSheetPath(kind, row.output_product_id),
    ingredientOut,
  };
}

async function loadRecipeById(
  recipeId: string,
  ingredientOut: boolean,
): Promise<StockMovementRecipeInfo | null> {
  const { data, error } = await supabase
    .from("recipes")
    .select("id, name, recipe_type, output_product_id")
    .eq("id", recipeId)
    .maybeSingle();
  if (error || !data) return null;
  return recipeInfoFromRow(data as RecipeRow, ingredientOut);
}

async function loadRecipeByOutput(
  productId: string,
  ingredientOut: boolean,
): Promise<StockMovementRecipeInfo | null> {
  const { data, error } = await supabase
    .from("recipes")
    .select("id, name, recipe_type, output_product_id")
    .eq("output_product_id", productId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return recipeInfoFromRow(data as RecipeRow, ingredientOut);
}

async function loadRevenue(
  entryId: string,
): Promise<StockMovementRevenueInfo | null> {
  const { data, error } = await supabase
    .from("revenue_entries")
    .select(
      "id, entry_date, title, entry_mode, quantity, sale_unit_code, unit_value, gross_amount, net_amount, tax_amount, cmv_amount, recipe_id, product_id",
    )
    .eq("id", entryId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id as string,
    entry_date: String(data.entry_date ?? "").slice(0, 10),
    title: String(data.title ?? "").trim() || "Venda",
    entry_mode: (data.entry_mode as string | null) ?? null,
    quantity:
      data.quantity != null && Number.isFinite(Number(data.quantity))
        ? Number(data.quantity)
        : null,
    sale_unit_code: (data.sale_unit_code as string | null) ?? null,
    unit_value:
      data.unit_value != null && Number.isFinite(Number(data.unit_value))
        ? Number(data.unit_value)
        : null,
    gross_amount: Number(data.gross_amount) || 0,
    net_amount: Number(data.net_amount) || 0,
    tax_amount: Number(data.tax_amount) || 0,
    cmv_amount:
      data.cmv_amount != null && Number.isFinite(Number(data.cmv_amount))
        ? Number(data.cmv_amount)
        : null,
    recipe_id: (data.recipe_id as string | null) ?? null,
    product_id: (data.product_id as string | null) ?? null,
  };
}

async function loadProductionOutputProductId(
  batchId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("stock_movements")
    .select("product_id")
    .eq("reference_type", "intermediate_production")
    .eq("reference_id", batchId)
    .eq("type", "in")
    .limit(1)
    .maybeSingle();
  if (error || !data?.product_id) return null;
  return String(data.product_id);
}

async function loadBackfillSourceRecipe(
  sourceMovementId: string,
  ingredientOut: boolean,
): Promise<StockMovementRecipeInfo | null> {
  const { data, error } = await supabase
    .from("stock_movements")
    .select("product_id")
    .eq("id", sourceMovementId)
    .maybeSingle();
  if (error || !data?.product_id) return null;
  return loadRecipeByOutput(String(data.product_id), ingredientOut);
}

export async function fetchStockMovementDetailContext(input: {
  companyId: string;
  productId: string;
  type: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
  unitCost: number | null;
}): Promise<StockMovementDetailContext> {
  const ref = (input.referenceType ?? "").trim().toLowerCase();
  const refId = input.referenceId?.trim() || null;
  const isOut = input.type.trim().toLowerCase() !== "in";

  const [productRes, invoice] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name, sku, unit, stock_control_type, average_cost, last_unit_value",
      )
      .eq("id", input.productId)
      .maybeSingle(),
    fetchStockMovementInvoiceContext({
      companyId: input.companyId,
      productId: input.productId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      createdAt: input.createdAt,
      unitCost: input.unitCost,
    }),
  ]);

  const productRow = productRes.data;
  const product: StockMovementProductInfo | null = productRow
    ? {
        id: productRow.id as string,
        name: String(productRow.name ?? "").trim() || "Produto",
        sku: (productRow.sku as string | null) ?? null,
        unit: String(productRow.unit ?? "un").trim() || "un",
        stock_control_type:
          (productRow.stock_control_type as string | null) ?? null,
        role: productStockRoleFromType(
          productRow.stock_control_type as string | null,
        ),
        average_cost:
          productRow.average_cost != null
            ? Number(productRow.average_cost)
            : null,
        last_unit_value:
          productRow.last_unit_value != null
            ? Number(productRow.last_unit_value)
            : null,
      }
    : null;

  let revenue: StockMovementRevenueInfo | null = null;
  if (isRevenueStockMovementReference(ref) && refId) {
    revenue = await loadRevenue(refId);
  }

  let recipe: StockMovementRecipeInfo | null = null;

  if (ref === "recipe" && refId) {
    recipe = await loadRecipeById(refId, isOut);
  } else if (ref === "technical_sheet_backfill" && refId) {
    recipe = await loadBackfillSourceRecipe(refId, true);
  } else if (ref === "intermediate_production") {
    const outputId =
      input.type === "in"
        ? input.productId
        : refId
          ? await loadProductionOutputProductId(refId)
          : null;
    if (outputId) {
      recipe = await loadRecipeByOutput(outputId, input.type !== "in");
    }
  } else if (revenue?.recipe_id) {
    recipe = await loadRecipeById(revenue.recipe_id, isOut);
  }

  if (
    !recipe &&
    product &&
    (product.role === "recipe_sale" || product.role === "intermediate")
  ) {
    recipe = await loadRecipeByOutput(
      product.id,
      isOut && product.role !== "recipe_sale" && product.role !== "intermediate",
    );
  }

  if (recipe && product) {
    const isOutput =
      recipe.output_product_id != null &&
      recipe.output_product_id === product.id;
    recipe = { ...recipe, ingredientOut: !isOutput && isOut };
  }

  return { product, recipe, revenue, invoice };
}

export const REVENUE_ENTRY_MODE_LABEL: Record<string, string> = {
  manual: "Manual",
  product_sale: "Venda de produto",
  recipe_sale: "Venda por ficha",
};

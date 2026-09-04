import {
  fetchProductsForStockExport,
} from "@/lib/exportProductStockExcel";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import { applyStockMovementDirectionFilter } from "@/lib/stockMovementFilters";
import { periodLabel } from "../formatters";
import type { ReportResult, ReportRunContext } from "../types";

const TYPE_LABEL: Record<string, string> = {
  in: "Entrada",
  out: "Saída",
  waste: "Perda",
};

export async function buildStockCatalogReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  const mode = ctx.filters.stockMode;
  const filters = ctx.stockFilters ?? {
    search: "",
    filterCategoryId: "all",
    filterActive: "all",
    filterComposesCmv: "all",
    filterUpdatedPreset: "all",
    filterUpdatedFrom: "",
    filterUpdatedTo: "",
    filterStockAlert: "all",
    filterStockOnlyOrigin: "all",
    lowStockOnly: false,
  };
  const products = await fetchProductsForStockExport(
    ctx.companyId,
    filters,
    mode,
  );
  const productIds = products.map((p) => p.id);
  const names: Record<string, string[]> = {};
  if (productIds.length) {
    const { data: links, error } = await supabase
      .from("product_category_assignments")
      .select("product_id, category_id")
      .in("product_id", productIds);
    if (error) throw error;
    const catIds = [...new Set((links ?? []).map((l) => l.category_id))];
    const { data: cats } = catIds.length
      ? await supabase
          .from("company_product_categories")
          .select("id, name")
          .eq("company_id", ctx.companyId)
          .in("id", catIds)
      : { data: [] };
    const catById = new Map((cats ?? []).map((c) => [c.id, c.name as string]));
    for (const row of links ?? []) {
      const name = catById.get(row.category_id);
      if (!name) continue;
      const list = names[row.product_id] ?? [];
      list.push(name);
      names[row.product_id] = list;
    }
  }

  return {
    title: "Estoque (catálogo)",
    slug: "estoque",
    subtitle: ctx.companyName,
    metaLines: [
      `Empresa: ${ctx.companyName}`,
      mode === "all" ? "Todos os produtos" : "Com filtros atuais",
    ],
    tables: [
      {
        title: "Produtos",
        columns: [
          { key: "name", header: "Produto" },
          { key: "qty", header: "Quantidade", format: "number", align: "right" },
          { key: "unit", header: "Unidade" },
          { key: "last", header: "Último preço", format: "money", align: "right" },
          { key: "avg", header: "Preço médio", format: "money", align: "right" },
          { key: "min", header: "Estoque mínimo", format: "number", align: "right" },
          { key: "cats", header: "Categorias" },
        ],
        rows: products.map((p) => ({
          name: p.name,
          qty: Number(p.current_quantity),
          unit: p.unit,
          last: p.last_unit_value,
          avg: p.average_cost,
          min: Number(p.min_quantity ?? 0),
          cats: (names[p.id] ?? []).join(", "),
        })),
      },
    ],
  };
}

export async function buildStockMovementsReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  // Query builder generics explode when composed with the direction helper.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase
    .from("stock_movements")
    .select(
      "created_at, type, quantity, unit_cost, reference_type, products(name, unit)",
    )
    .eq("company_id", ctx.companyId)
    .order("created_at", { ascending: false });

  if (ctx.filters.dateFrom) {
    q = q.gte("created_at", `${ctx.filters.dateFrom}T00:00:00.000`);
  }
  if (ctx.filters.dateTo) {
    q = q.lte("created_at", `${ctx.filters.dateTo}T23:59:59.999`);
  }

  q = applyStockMovementDirectionFilter(q, ctx.filters.movementDirection);

  const rows = (await fetchAllInRange(q as never)) as {
    created_at: string;
    type: string;
    quantity: number;
    unit_cost: number | null;
    reference_type: string | null;
    products: { name: string; unit: string } | { name: string; unit: string }[] | null;
  }[];

  return {
    title: "Movimentações de estoque",
    slug: "estoque_movimentacoes",
    subtitle: ctx.companyName,
    metaLines: [
      `Empresa: ${ctx.companyName}`,
      `Período: ${periodLabel(ctx.filters.dateFrom, ctx.filters.dateTo)}`,
    ],
    tables: [
      {
        title: "Movimentações",
        columns: [
          { key: "date", header: "Data", format: "date" },
          { key: "product", header: "Produto" },
          { key: "type", header: "Tipo" },
          { key: "qty", header: "Qtde", format: "number", align: "right" },
          { key: "unit", header: "Unidade" },
          { key: "cost", header: "Custo un.", format: "money", align: "right" },
          { key: "origin", header: "Origem" },
        ],
        rows: rows.map((r) => {
          const prod = Array.isArray(r.products) ? r.products[0] : r.products;
          return {
            date: r.created_at.slice(0, 10),
            product: prod?.name ?? "",
            type: TYPE_LABEL[r.type] ?? r.type,
            qty: Number(r.quantity) || 0,
            unit: prod?.unit ?? "",
            cost: r.unit_cost,
            origin: r.reference_type ?? "",
          };
        }),
      },
    ],
  };
}

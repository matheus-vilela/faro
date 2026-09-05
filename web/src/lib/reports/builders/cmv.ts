import { localDateYmd } from "@/lib/boletoPayment";
import {
  BCG_QUADRANT_LABELS,
  buildCmvMargensDashboard,
  type ProductCmvMeta,
} from "@/lib/cmvMargensResumo";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import type { RevenueEntry } from "@/types/revenue";
import { getResumoRanges } from "@/lib/vendasRealizadasResumo";
import type { ReportResult, ReportRunContext } from "../types";

export async function buildCmvMarginsReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  const period = ctx.filters.cmvPeriod;
  const todayYmd = localDateYmd();
  const { fetchStart, fetchEnd } = getResumoRanges(period, todayYmd, null, {
    weekStartsOn: ctx.weekStartsOn,
  });

  const revenueRows = await fetchAllInRange<RevenueEntry>(
    supabase
      .from("revenue_entries")
      .select("*")
      .eq("company_id", ctx.companyId)
      .gte("entry_date", fetchStart)
      .lte("entry_date", fetchEnd)
      .order("entry_date", { ascending: true }),
  );

  const productIds = [
    ...new Set(
      revenueRows
        .map((r) => r.product_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const recipeIds = [
    ...new Set(
      revenueRows
        .map((r) => r.recipe_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const cmvProductIds = new Set<string>(productIds);
  for (const row of revenueRows) {
    const lines = Array.isArray(row.cmv_lines) ? row.cmv_lines : [];
    for (const line of lines) {
      if (line && typeof line === "object" && "product_id" in line) {
        const id = String((line as { product_id: unknown }).product_id ?? "");
        if (id) cmvProductIds.add(id);
      }
    }
  }

  const [productsRes, recipesRes] = await Promise.all([
    cmvProductIds.size
      ? supabase
          .from("products")
          .select("id, name, composes_cmv, average_cost, exclude_from_sales")
          .in("id", [...cmvProductIds])
      : Promise.resolve({ data: [], error: null }),
    recipeIds.length
      ? supabase.from("recipes").select("id, name").in("id", recipeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (productsRes.error) throw productsRes.error;
  if (recipesRes.error) throw recipesRes.error;

  const productNameById = new Map<string, string>();
  const productMetaById = new Map<string, ProductCmvMeta>();
  for (const p of (productsRes.data ?? []) as {
    id: string;
    name: string;
    composes_cmv?: boolean | null;
    average_cost?: number | null;
    exclude_from_sales?: boolean | null;
  }[]) {
    productNameById.set(p.id, p.name);
    productMetaById.set(p.id, {
      composes_cmv: p.composes_cmv,
      average_cost: p.average_cost,
      exclude_from_sales: p.exclude_from_sales,
    });
  }
  const recipeNameById = new Map<string, string>();
  for (const r of (recipesRes.data ?? []) as { id: string; name: string }[]) {
    recipeNameById.set(r.id, r.name);
  }

  const dash = buildCmvMargensDashboard({
    entries: revenueRows,
    period,
    todayYmd,
    sort: "volume",
    productNameById,
    recipeNameById,
    productMetaById,
    weekStartsOn: ctx.weekStartsOn,
  });

  const periodLabelMap = {
    today: "Hoje",
    last7: "Esta semana",
    month: "Este mês",
    custom: "Personalizado",
  };

  return {
    title: "CMV e margens",
    slug: "cmv_margens",
    subtitle: ctx.companyName,
    metaLines: [
      `Empresa: ${ctx.companyName}`,
      `Período: ${periodLabelMap[period] ?? period}`,
    ],
    tables: [
      {
        title: "Indicadores",
        columns: [
          { key: "label", header: "Indicador" },
          { key: "value", header: "Valor" },
        ],
        rows: [
          {
            label: "CMV %",
            value:
              dash.kpis.cmvPct == null ? "" : `${dash.kpis.cmvPct.toFixed(1)}%`,
          },
          {
            label: "Margem %",
            value:
              dash.kpis.marginPct == null
                ? ""
                : `${dash.kpis.marginPct.toFixed(1)}%`,
          },
          { label: "Abaixo da meta", value: dash.kpis.belowTargetCount },
        ],
      },
      {
        title: "Produtos",
        columns: [
          { key: "label", header: "Produto" },
          { key: "quantity", header: "Qtde", format: "number", align: "right" },
          { key: "revenue", header: "Receita", format: "money", align: "right" },
          { key: "cmv", header: "CMV", format: "money", align: "right" },
          { key: "marginPct", header: "Margem %", format: "number", align: "right" },
          { key: "markup", header: "Markup", format: "number", align: "right" },
          { key: "quadrant", header: "BCG" },
        ],
        rows: dash.products.map((p) => ({
          label: p.label,
          quantity: p.quantity,
          revenue: p.revenue,
          cmv: p.cmv,
          marginPct: p.marginPct,
          markup: p.markup,
          quadrant: BCG_QUADRANT_LABELS[p.quadrant] ?? p.quadrant,
        })),
      },
    ],
  };
}

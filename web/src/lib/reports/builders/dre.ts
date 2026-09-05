import { getMonthRange } from "@/components/MonthSelector";
import {
  aggregateTotalsByCategory,
  buildDreComputedFromMaps,
  type DreComputed,
} from "@/lib/dre/computeDre";
import { mapCategoryToDreBucket } from "@/lib/dre/dreMapping";
import { fetchExpenseItemsForRateio } from "@/lib/dre/fetchExpenseItemsForRateio";
import { ptBrUi } from "@/lib/ptBrUiStrings";
import {
  boletoHasUnclassifiedRemainder,
  expandBoletosToDrePurchaseAmounts,
  groupRateioItemsByExpenseId,
} from "@/lib/dre/rateioBoletoByItems";
import { buildDreTreeForBucket, type DreTreeNode } from "@/lib/dre/dreTree";
import { supabase } from "@/lib/supabase";
import {
  fetchExcludedFromSalesProductIds,
  sumRevenueCmvAppearingAsSale,
} from "@/lib/productExcludeFromSales";
import type { CompanyCategory } from "@/types/category";
import { isBoletoPayable, isBoletoTransfer } from "@/types/expense";
import type { DreSemCategoriaBoleto } from "@/hooks/useDreReport";
import { boletoFlowLabel, boletoSituationLabel } from "../fetchBoletos";
import { monthYearLabel } from "../formatters";
import type { ReportResult, ReportRunContext, ReportTable } from "../types";

const DRE_LINE_LABELS: { key: keyof DreComputed; label: string }[] = [
  { key: "vendasBrutas", label: "Vendas brutas" },
  { key: "deducoesReceita", label: ptBrUi.dre.deducoesReceitaLabel },
  { key: "vendasLiquidas", label: "Vendas líquidas" },
  { key: "cmv", label: "CMV" },
  { key: "lucroBruto", label: "Lucro bruto" },
  { key: "despesasVariaveis", label: "Despesas variáveis" },
  { key: "despesasFixas", label: "Despesas fixas" },
  { key: "resultadoOperacional", label: "Resultado operacional" },
  { key: "resultadoFinanceiroReceitas", label: "Resultado financeiro (receitas)" },
  { key: "resultadoFinanceiroDespesas", label: "Resultado financeiro (despesas)" },
  { key: "resultadoFinanceiroLiquido", label: "Resultado financeiro líquido" },
  { key: "resultadoAntesImposto", label: "Resultado antes do imposto" },
  { key: "impostos", label: "Impostos" },
  { key: "lucroLiquido", label: "Lucro líquido" },
];

function flattenTree(
  nodes: DreTreeNode[],
  depth = 0,
): { name: string; amount: number }[] {
  const out: { name: string; amount: number }[] = [];
  for (const n of nodes) {
    out.push({ name: `${"— ".repeat(depth)}${n.name}`, amount: n.amount });
    out.push(...flattenTree(n.children, depth + 1));
  }
  return out;
}

async function loadDreSnapshot(companyId: string, month: number, year: number) {
  const { start, end } = getMonthRange(month, year);
  const startDate = start.slice(0, 10);
  const endDate = end.slice(0, 10);

  const [catRes, bolRes, revCmvRes, excludedIds] = await Promise.all([
    supabase
      .from("company_categories")
      .select("*")
      .eq("company_id", companyId)
      .order("ordem", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("boletos")
      .select(
        "id, description, amount, due_date, flow_type, company_category_id, status, revenue_entry_id, expense_id, category, entry_kind",
      )
      .eq("company_id", companyId)
      .neq("entry_kind", "transfer")
      .gte("due_date", startDate)
      .lte("due_date", endDate)
      .order("due_date", { ascending: true }),
    supabase
      .from("revenue_entries")
      .select("cmv_amount, product_id, entry_mode")
      .eq("company_id", companyId)
      .in("entry_mode", ["product_sale", "recipe_sale"])
      .gte("entry_date", startDate)
      .lte("entry_date", endDate),
    fetchExcludedFromSalesProductIds(companyId),
  ]);
  if (catRes.error) throw catRes.error;
  if (bolRes.error) throw bolRes.error;
  if (revCmvRes.error) throw revCmvRes.error;

  const categories = (catRes.data ?? []) as CompanyCategory[];
  const boletosInPeriod = (bolRes.data ?? []) as DreSemCategoriaBoleto[];
  const expenseIds = boletosInPeriod
    .map((b) => b.expense_id)
    .filter((id): id is string => Boolean(id));
  const items = await fetchExpenseItemsForRateio(companyId, expenseIds);
  const rateioItemsByExpenseId = groupRateioItemsByExpenseId(items);
  const salesCmvInPeriod = sumRevenueCmvAppearingAsSale(
    (revCmvRes.data ?? []) as Array<{
      cmv_amount?: number | null;
      product_id?: string | null;
      entry_mode?: string | null;
    }>,
    new Set(excludedIds),
  );
  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const boletosForDreAggregation = boletosInPeriod.filter((b) => {
    if (isBoletoTransfer(b)) return false;
    if (!b.revenue_entry_id || !isBoletoPayable(b)) return true;
    const cat = b.company_category_id
      ? categoriesById.get(b.company_category_id)
      : undefined;
    return cat ? mapCategoryToDreBucket(cat) !== "CMV" : true;
  });
  const boletosSemCategoria = boletosInPeriod.filter((b) => {
    if (isBoletoTransfer(b)) return false;
    const rateio = b.expense_id
      ? (rateioItemsByExpenseId.get(b.expense_id) ?? [])
      : [];
    return boletoHasUnclassifiedRemainder(
      {
        amount: Number(b.amount),
        expense_id: b.expense_id,
        company_category_id: b.company_category_id ?? null,
      },
      rateio,
    );
  });
  const expanded = expandBoletosToDrePurchaseAmounts(
    boletosForDreAggregation.map((b) => ({
      amount: Number(b.amount),
      expense_id: b.expense_id,
      company_category_id: b.company_category_id ?? null,
    })),
    rateioItemsByExpenseId,
    categoriesById,
  );
  const categoryTotals = aggregateTotalsByCategory(expanded, categoriesById);
  const computed = buildDreComputedFromMaps(
    categoryTotals.byCategoryId,
    categoriesById,
    salesCmvInPeriod,
  );
  return {
    categories,
    boletosSemCategoria,
    computed,
    salesCmvInPeriod,
    byCategoryId: categoryTotals.byCategoryId,
  };
}

export async function buildDreReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  const { month, year, dreView } = ctx.filters;
  const snap = await loadDreSnapshot(ctx.companyId, month, year);
  const tables: ReportTable[] = [
    {
      title: "DRE",
      columns: [
        { key: "label", header: "Linha" },
        { key: "amount", header: "Valor", format: "money" as const, align: "right" as const },
      ],
      rows: DRE_LINE_LABELS.map((l) => ({
        label: l.label,
        amount: snap.computed[l.key],
      })),
    },
  ];

  if (dreView === "linhas") {
    const trees = [
      { label: "Vendas brutas", bucket: "VENDAS_BRUTAS" as const },
      { label: ptBrUi.dre.deducoesReceitaLabel, bucket: "DEDUCAO_RECEITA" as const },
      { label: "CMV", bucket: "CMV" as const },
      { label: "Despesas variáveis", bucket: "DESPESAS_VARIAVEIS" as const },
      { label: "Despesas fixas", bucket: "DESPESAS_FIXAS" as const },
      {
        label: "Resultado financeiro (receitas)",
        bucket: "RESULTADO_FINANCEIRO_RECEITA" as const,
      },
      {
        label: "Resultado financeiro (despesas)",
        bucket: "RESULTADO_FINANCEIRO_DESPESA" as const,
      },
      { label: "Impostos", bucket: "IMPOSTOS" as const },
    ];
    for (const t of trees) {
      const nodes = buildDreTreeForBucket(
        snap.categories,
        snap.byCategoryId,
        t.bucket,
      );
      const rows = flattenTree(nodes);
      if (t.bucket === "CMV" && snap.salesCmvInPeriod > 0) {
        rows.unshift({
          name: "CMV de vendas (fichas)",
          amount: snap.salesCmvInPeriod,
        });
      }
      if (rows.length) {
        tables.push({
          title: t.label,
          columns: [
            { key: "name", header: "Categoria" },
            { key: "amount", header: "Valor", format: "money" as const, align: "right" as const },
          ],
          rows,
        });
      }
    }
  }

  return {
    title: "DRE",
    slug: "dre",
    subtitle: ctx.companyName,
    metaLines: [
      `Empresa: ${ctx.companyName}`,
      `Competência: ${monthYearLabel(month, year)}`,
    ],
    tables,
  };
}

export async function buildDreUncategorizedReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  const { month, year } = ctx.filters;
  const snap = await loadDreSnapshot(ctx.companyId, month, year);
  return {
    title: "DRE sem categoria",
    slug: "dre_sem_categoria",
    subtitle: ctx.companyName,
    metaLines: [
      `Empresa: ${ctx.companyName}`,
      `Competência: ${monthYearLabel(month, year)}`,
    ],
    tables: [
      {
        title: "Sem categoria",
        columns: [
          { key: "due_date", header: "Vencimento", format: "date" },
          { key: "description", header: "Descrição" },
          { key: "flow", header: "Fluxo" },
          { key: "status", header: "Status" },
          { key: "amount", header: "Valor", format: "money", align: "right" },
        ],
        rows: snap.boletosSemCategoria.map((b) => ({
          due_date: b.due_date,
          description: b.description,
          flow: boletoFlowLabel(b.flow_type),
          status: boletoSituationLabel(b),
          amount: Number(b.amount) || 0,
        })),
      },
    ],
  };
}

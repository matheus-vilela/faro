import { computeCashFlowProjection } from "@/lib/cashFlowSimulation/computeCashFlowProjection";
import { fetchKnownCashFlowItems } from "@/lib/cashFlowSimulation/fetchKnownCashFlowItems";
import { SCENARIO_OPTIONS } from "@/lib/cashFlowSimulation/scenarioPresets";
import {
  CASH_FLOW_PREFS_STORAGE_PREFIX,
  DEFAULT_CASH_FLOW_PREFS,
  type CashFlowSimulationPrefs,
  type HorizonWeeks,
  type ScenarioKey,
} from "@/lib/cashFlowSimulation/types";
import { localDateYmd } from "@/lib/boletoPayment";
import { hasPermission } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import { companyCategoryDisplayName } from "@/lib/companyCategoryLabels";
import type { CompanyCategory } from "@/types/category";
import type { ReportResult, ReportRunContext } from "../types";
import { periodLabel } from "../formatters";

function parseHorizonWeeks(raw: unknown): HorizonWeeks {
  const n = Number(raw);
  if (n === 4 || n === 8 || n === 12) return n;
  return DEFAULT_CASH_FLOW_PREFS.horizonWeeks;
}

function parseScenario(raw: unknown): ScenarioKey {
  if (raw === "base" || raw === "optimistic" || raw === "pessimistic") {
    return raw;
  }
  return DEFAULT_CASH_FLOW_PREFS.scenario;
}

function loadCashFlowPrefs(companyId: string): CashFlowSimulationPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_CASH_FLOW_PREFS };
  try {
    const raw = localStorage.getItem(
      `${CASH_FLOW_PREFS_STORAGE_PREFIX}${companyId}`,
    );
    if (!raw) return { ...DEFAULT_CASH_FLOW_PREFS };
    const parsed = JSON.parse(raw) as Partial<CashFlowSimulationPrefs>;
    return {
      openingBalance:
        typeof parsed.openingBalance === "number" &&
        Number.isFinite(parsed.openingBalance)
          ? parsed.openingBalance
          : DEFAULT_CASH_FLOW_PREFS.openingBalance,
      scenario: parseScenario(parsed.scenario),
      horizonWeeks: parseHorizonWeeks(parsed.horizonWeeks),
    };
  } catch {
    return { ...DEFAULT_CASH_FLOW_PREFS };
  }
}

export async function buildCashFlowSummaryReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  const stored = loadCashFlowPrefs(ctx.companyId);
  const scenario = ctx.filters.scenario || stored.scenario;
  const horizonWeeks = ctx.filters.horizonWeeks || stored.horizonWeeks;
  const openingBalance = Number.isFinite(ctx.filters.openingBalance)
    ? ctx.filters.openingBalance
    : stored.openingBalance;
  const todayYmd = localDateYmd();
  const includePayables =
    ctx.isCompanyOwner || hasPermission(ctx.permissions, "contas_a_pagar");
  const includeReceivables =
    ctx.isCompanyOwner || hasPermission(ctx.permissions, "vendas_realizadas");

  const rawItems = await fetchKnownCashFlowItems({
    companyId: ctx.companyId,
    todayYmd,
    horizonWeeks,
    includePayables,
    includeReceivables,
    weekStartsOn: ctx.weekStartsOn,
  });
  const projection = computeCashFlowProjection({
    rawItems,
    scenario,
    openingBalance,
    todayYmd,
    horizonWeeks,
    weekStartsOn: ctx.weekStartsOn,
  });
  const scenarioLabel =
    SCENARIO_OPTIONS.find((s) => s.value === scenario)?.label ?? scenario;

  return {
    title: "Fluxo de caixa resumido",
    slug: "fluxo_caixa_resumo",
    subtitle: ctx.companyName,
    metaLines: [
      `Empresa: ${ctx.companyName}`,
      `Cenário: ${scenarioLabel}`,
      `Horizonte: ${horizonWeeks} semanas`,
      `Saldo inicial: ${openingBalance}`,
    ],
    tables: [
      {
        title: "Indicadores",
        columns: [
          { key: "label", header: "Indicador" },
          { key: "value", header: "Valor", format: "money", align: "right" },
        ],
        rows: [
          { label: "Saldo inicial", value: projection.kpis.openingBalance },
          { label: "Entradas", value: projection.kpis.totalInflows },
          { label: "Saídas", value: projection.kpis.totalOutflows },
          { label: "Menor saldo", value: projection.kpis.minBalance },
          { label: "Saldo final", value: projection.kpis.endingBalance },
        ],
      },
      {
        title: "Semanas",
        columns: [
          { key: "label", header: "Semana" },
          { key: "inflows", header: "Entradas", format: "money", align: "right" },
          { key: "outflows", header: "Saídas", format: "money", align: "right" },
          { key: "netFlow", header: "Líquido", format: "money", align: "right" },
          {
            key: "runningBalance",
            header: "Saldo",
            format: "money",
            align: "right",
          },
        ],
        rows: projection.buckets.map((b) => ({
          label: b.label,
          inflows: b.inflows,
          outflows: b.outflows,
          netFlow: b.netFlow,
          runningBalance: b.runningBalance,
        })),
      },
    ],
  };
}

export async function buildCashFlowByCategoryReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  const includePayables =
    ctx.isCompanyOwner || hasPermission(ctx.permissions, "contas_a_pagar");
  const includeReceivables =
    ctx.isCompanyOwner || hasPermission(ctx.permissions, "vendas_realizadas");
  const { dateFrom, dateTo, basis, natureza, categoryId } = ctx.filters;

  let q = supabase
    .from("boletos")
    .select(
      "amount, paid_amount, paid_at, due_date, status, flow_type, company_category_id, exclude_from_fluxo, entry_kind, description",
    )
    .eq("company_id", ctx.companyId)
    .eq("exclude_from_fluxo", false)
    .neq("entry_kind", "transfer");

  if (basis === "caixa") {
    q = q
      .eq("status", "paid")
      .gte("paid_at", `${dateFrom}T00:00:00`)
      .lte("paid_at", `${dateTo}T23:59:59.999`);
  } else {
    q = q.gte("due_date", dateFrom).lte("due_date", dateTo);
  }

  const [rows, catRes] = await Promise.all([
    fetchAllInRange<{
      amount: number;
      paid_amount: number | null;
      flow_type: string | null;
      company_category_id: string | null;
      exclude_from_fluxo?: boolean;
      entry_kind?: string | null;
      description?: string | null;
    }>(q),
    supabase.from("company_categories").select("*").eq("company_id", ctx.companyId),
  ]);
  if (catRes.error) throw catRes.error;
  const categories = (catRes.data ?? []) as CompanyCategory[];
  const byId = new Map(categories.map((c) => [c.id, c]));

  type Agg = { inflows: number; outflows: number };
  const map = new Map<string, Agg>();
  for (const b of rows) {
    if (b.entry_kind === "transfer") continue;
    if (b.exclude_from_fluxo === true) continue;
    const isIn = b.flow_type === "receivable";
    if (isIn && !includeReceivables) continue;
    if (!isIn && !includePayables) continue;
    const cat = b.company_category_id
      ? byId.get(b.company_category_id)
      : undefined;
    if (natureza !== "all" && cat?.natureza !== natureza) continue;
    if (categoryId !== "all" && b.company_category_id !== categoryId) continue;
    const key = b.company_category_id ?? "__none__";
    const amount =
      basis === "caixa"
        ? Number(b.paid_amount ?? b.amount) || 0
        : Number(b.amount) || 0;
    const cur = map.get(key) ?? { inflows: 0, outflows: 0 };
    if (isIn) cur.inflows += amount;
    else cur.outflows += amount;
    map.set(key, cur);
  }

  const tableRows = [...map.entries()]
    .map(([id, agg]) => {
      const cat = id === "__none__" ? null : byId.get(id);
      return {
        category: cat ? companyCategoryDisplayName(cat) : "Sem categoria",
        natureza: cat?.natureza === "RECEITA" ? "Receita" : cat?.natureza === "DESPESA" ? "Despesa" : "",
        inflows: agg.inflows,
        outflows: agg.outflows,
        net: agg.inflows - agg.outflows,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category, "pt-BR"));

  return {
    title: "Fluxo de caixa por categoria",
    slug: "fluxo_caixa_categoria",
    subtitle: ctx.companyName,
    metaLines: [
      `Empresa: ${ctx.companyName}`,
      `Período: ${periodLabel(dateFrom, dateTo)}`,
      `Base: ${basis === "caixa" ? "caixa (pagamento)" : "competência (vencimento)"}`,
    ],
    tables: [
      {
        title: "Por categoria",
        columns: [
          { key: "category", header: "Categoria" },
          { key: "natureza", header: "Natureza" },
          { key: "inflows", header: "Entradas", format: "money", align: "right" },
          { key: "outflows", header: "Saídas", format: "money", align: "right" },
          { key: "net", header: "Líquido", format: "money", align: "right" },
        ],
        rows: tableRows,
      },
    ],
  };
}

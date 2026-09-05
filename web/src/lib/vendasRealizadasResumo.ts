import { addDaysYmd, getMonthYmdRange } from "@/lib/payableTotals";
import {
  companyCategoryDisplayName,
} from "@/lib/companyCategoryLabels";
import { filterRevenueEntriesAppearingAsSale } from "@/lib/productExcludeFromSales";
import type { CompanyCategory } from "@/types/category";
import type { RevenueEntry } from "@/types/revenue";

export type ResumoPeriodFilter = "today" | "last7" | "month" | "custom";

export type ResumoCustomRange = {
  start: string;
  end: string;
};

/** Opções de calendário da unidade (semana contábil). */
export type ResumoRangeOptions = {
  /**
   * Dia em que a semana contábil começa (0=domingo … 6=sábado).
   * Default: 1 (segunda-feira).
   */
  weekStartsOn?: number;
};

/** Nomes longos dos dias (índice = Date.getDay()). */
export const WEEKDAY_LONG_PT = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

export function normalizeWeekStartsOn(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 6) return 1;
  return n;
}

/** Dia de término da semana contábil (= início + 6). */
export function accountingWeekEndsOn(weekStartsOn: number): number {
  return (normalizeWeekStartsOn(weekStartsOn) + 6) % 7;
}

export function weekdayIndexFromYmd(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1).getDay();
}

/** Primeiro dia da semana contábil que contém `ymd`. */
export function startOfAccountingWeek(
  ymd: string,
  weekStartsOn: number,
): string {
  const startOn = normalizeWeekStartsOn(weekStartsOn);
  const dow = weekdayIndexFromYmd(ymd);
  const delta = (dow - startOn + 7) % 7;
  return addDaysYmd(ymd.slice(0, 10), -delta);
}

export type ResumoRankingMode = "product" | "payment";

export type ResumoRanges = {
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
  compareLabel: string;
  championsTitle: string;
  /** Rótulo curto no centro do donut (ex.: "7 dias"). */
  periodShortLabel: string;
  fetchStart: string;
  fetchEnd: string;
};

/** Linha de confronto entre possíveis fontes de “venda líquida”. */
export type NetSalesSourceRow = {
  key: string;
  label: string;
  value: number;
  /** Diferença vs KPI de vendas líquidas exibido no card. */
  diffVsKpiNet: number;
  note?: string;
  isKpi?: boolean;
  /** Destaque visual (ex.: pendura). */
  emphasis?: boolean;
};

export type ResumoKpiMetrics = {
  gross: number;
  net: number;
  count: number;
  ticket: number;
};

export type ResumoKpiDelta = {
  current: number;
  previous: number;
  pctChange: number | null;
};

export type ResumoChampionRow = {
  key: string;
  label: string;
  categoryLabel: string;
  quantity: number;
  revenue: number;
  revenueShare: number;
};

export type ResumoDailyPoint = {
  date: string;
  label: string;
  net: number;
};

export type ResumoCategoryRow = {
  key: string;
  label: string;
  revenue: number;
  share: number;
};

/** Forma de pagamento (visão “Por tipo de transação”). */
export type ResumoPaymentRow = {
  key: string;
  label: string;
  shortLabel: string;
  /** Valor total no período (fonte: faturamento EPOC). */
  amount: number;
  share: number;
  /** Se false, não entra no KPI de vendas líquidas / relatórios de receita. */
  includeInNetSales: boolean;
  /** Nome da adquirente associada à forma, se houver. */
  acquirerName: string | null;
};

/** Linha diária de forma de pagamento vinda do faturamento EPOC. */
export type EpocPaymentLineInput = {
  faturamento_date: string;
  amount: number | null;
  payment_method_id: string;
  payment_methods: {
    sku: string;
    name: string;
    include_in_net_sales?: boolean | null;
    acquirer_name?: string | null;
  } | null;
};

/** Dia de faturamento EPOC (Total Geral da tabela_3). */
export type EpocFaturamentoDayInput = {
  faturamento_date: string;
  quantity: number | null;
  produtos: number | null;
  servicos: number | null;
  taxas: number | null;
  total: number | null;
  ticket_medio: number | null;
};

export type ResumoDashboard = {
  kpis: {
    gross: ResumoKpiDelta;
    net: ResumoKpiDelta;
    count: ResumoKpiDelta;
    ticket: ResumoKpiDelta;
  };
  /** Há realizado no período atual (EPOC ou lançamentos). */
  hasPeriodSales: boolean;
  champions: ResumoChampionRow[];
  payments: ResumoPaymentRow[];
  daily: ResumoDailyPoint[];
  categories: ResumoCategoryRow[];
  ranges: ResumoRanges;
};

/** Chaves canônicas → rótulos do print. */
export const PAYMENT_METHOD_META: Record<
  string,
  { label: string; shortLabel: string }
> = {
  credit_card: { label: "Cartão de crédito", shortLabel: "Crédito" },
  pix: { label: "Pix", shortLabel: "Pix" },
  debit_card: { label: "Cartão de débito", shortLabel: "Débito" },
  cash: { label: "Dinheiro", shortLabel: "Dinheiro" },
  meal_voucher: { label: "Vale-refeição", shortLabel: "Vale-refeição" },
  other: { label: "Outros", shortLabel: "Outros" },
};

const PAYMENT_ALIAS_TO_KEY: Array<{ re: RegExp; key: string }> = [
  { re: /vale[-\s]?refei|vr\b|sodexo|alelo|ticket\s*restaurante/i, key: "meal_voucher" },
  { re: /cr[eé]dito|credit/i, key: "credit_card" },
  { re: /d[eé]bito|debit/i, key: "debit_card" },
  { re: /\bpix\b/i, key: "pix" },
  { re: /dinheiro|esp[eé]cie|cash/i, key: "cash" },
];

/**
 * Extrai forma de pagamento de um lançamento.
 * Aceita `payment_method` / `payment_type` se existirem no payload,
 * ou tenta inferir pelo título (ex.: lançamentos manuais agregados).
 */
export function resolvePaymentMethodKey(
  entry: RevenueEntry & {
    payment_method?: string | null;
    payment_type?: string | null;
  },
): string | null {
  const raw = (
    entry.payment_method ||
    entry.payment_type ||
    ""
  )
    .trim()
    .toLowerCase();
  if (raw) {
    if (raw in PAYMENT_METHOD_META) return raw;
    for (const { re, key } of PAYMENT_ALIAS_TO_KEY) {
      if (re.test(raw)) return key;
    }
    return `custom:${raw}`;
  }

  const title = entry.title?.trim() ?? "";
  for (const { re, key } of PAYMENT_ALIAS_TO_KEY) {
    if (re.test(title)) return key;
  }
  return null;
}

function paymentLabels(key: string): { label: string; shortLabel: string } {
  if (key.startsWith("custom:")) {
    const name = key.slice("custom:".length);
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    return { label, shortLabel: label };
  }
  return (
    PAYMENT_METHOD_META[key] ?? {
      label: key,
      shortLabel: key,
    }
  );
}

const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymdParts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return [y || 1970, m || 1, d || 1];
}

function daysInclusive(startYmd: string, endYmd: string): number {
  const [ys, ms, ds] = ymdParts(startYmd);
  const [ye, me, de] = ymdParts(endYmd);
  const start = Date.UTC(ys, ms - 1, ds);
  const end = Date.UTC(ye, me - 1, de);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function weekdayShort(ymd: string): string {
  const [y, m, d] = ymdParts(ymd);
  return WEEKDAY_SHORT[new Date(y, m - 1, d).getDay()] ?? ymd.slice(8);
}

function dayOfMonthLabel(ymd: string): string {
  return String(ymdParts(ymd)[2]);
}

/** Agrupa folha sob o pai intermediário; se o pai for raiz, usa o nome da folha. */
export function categoryGroupLabel(
  leafId: string | null | undefined,
  byId: Map<string, CompanyCategory>,
): string {
  if (!leafId) return "Sem categoria";
  const leaf = byId.get(leafId);
  if (!leaf) return "Sem categoria";
  if (leaf.parent_id) {
    const parent = byId.get(leaf.parent_id);
    if (parent?.parent_id) {
      return companyCategoryDisplayName(parent);
    }
    return companyCategoryDisplayName(leaf);
  }
  return companyCategoryDisplayName(leaf);
}

function normalizeCustomRange(
  custom: ResumoCustomRange | null | undefined,
  todayYmd: string,
): { start: string; end: string } {
  const fallbackStart = addDaysYmd(todayYmd, -6);
  let start = (custom?.start || fallbackStart).slice(0, 10);
  let end = (custom?.end || todayYmd).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) start = fallbackStart;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) end = todayYmd;
  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  return { start, end };
}

export function getResumoRanges(
  period: ResumoPeriodFilter,
  todayYmd: string,
  custom?: ResumoCustomRange | null,
  options?: ResumoRangeOptions | null,
): ResumoRanges {
  if (period === "today") {
    const yesterday = addDaysYmd(todayYmd, -1);
    return {
      currentStart: todayYmd,
      currentEnd: todayYmd,
      previousStart: yesterday,
      previousEnd: yesterday,
      compareLabel: "vs dia anterior",
      championsTitle: "hoje",
      periodShortLabel: "hoje",
      fetchStart: yesterday,
      fetchEnd: todayYmd,
    };
  }

  if (period === "month") {
    const [y, m] = ymdParts(todayYmd);
    const { startYmd: monthStart } = getMonthYmdRange(m, y);
    const dayOfMonth = ymdParts(todayYmd)[2];
    const prevMonthDate = new Date(y, m - 2, 1);
    const prevY = prevMonthDate.getFullYear();
    const prevM = prevMonthDate.getMonth() + 1;
    const prevLastDay = new Date(prevY, prevM, 0).getDate();
    const prevEndDay = Math.min(dayOfMonth, prevLastDay);
    const previousStart = `${prevY}-${pad2(prevM)}-01`;
    const previousEnd = `${prevY}-${pad2(prevM)}-${pad2(prevEndDay)}`;
    return {
      currentStart: monthStart,
      currentEnd: todayYmd,
      previousStart,
      previousEnd,
      compareLabel: "vs mês anterior",
      championsTitle: "este mês",
      periodShortLabel: "mês",
      fetchStart: previousStart,
      fetchEnd: todayYmd,
    };
  }

  if (period === "custom") {
    const { start, end } = normalizeCustomRange(custom, todayYmd);
    const len = daysInclusive(start, end);
    const previousEnd = addDaysYmd(start, -1);
    const previousStart = addDaysYmd(previousEnd, -(len - 1));
    return {
      currentStart: start,
      currentEnd: end,
      previousStart,
      previousEnd,
      compareLabel: "vs período anterior",
      championsTitle: "período selecionado",
      periodShortLabel: "período",
      fetchStart: previousStart,
      fetchEnd: end,
    };
  }

  // last7 → semana contábil atual (início configurável → hoje), vs mesma janela na semana anterior
  const weekStartsOn = normalizeWeekStartsOn(options?.weekStartsOn);
  const currentStart = startOfAccountingWeek(todayYmd, weekStartsOn);
  const previousStart = addDaysYmd(currentStart, -7);
  const previousEnd = addDaysYmd(todayYmd, -7);
  const endsOn = accountingWeekEndsOn(weekStartsOn);
  return {
    currentStart,
    currentEnd: todayYmd,
    previousStart,
    previousEnd,
    compareLabel: "vs semana anterior",
    championsTitle: "esta semana",
    periodShortLabel: `${WEEKDAY_SHORT[weekStartsOn] ?? "Sem"}–${WEEKDAY_SHORT[endsOn] ?? "Sem"}`,
    fetchStart: previousStart,
    fetchEnd: todayYmd,
  };
}

function dailyPointLabel(
  period: ResumoPeriodFilter,
  date: string,
  rangeLen: number,
): string {
  if (period === "today") return "Hoje";
  if (period === "month" || (period === "custom" && rangeLen > 7)) {
    return dayOfMonthLabel(date);
  }
  return weekdayShort(date);
}

/** Detecta forma de pagamento “pendura” (conta do cliente / fiado). */
export function isPenduraPaymentMethod(
  sku?: string | null,
  name?: string | null,
): boolean {
  const blob = `${sku ?? ""} ${name ?? ""}`.toLowerCase();
  return /pendura/.test(blob);
}

/** Default true quando o flag não veio no payload (legado / join incompleto). */
export function paymentMethodCountsInNetSales(
  paymentMethods:
    | { include_in_net_sales?: boolean | null }
    | null
    | undefined,
): boolean {
  return paymentMethods?.include_in_net_sales !== false;
}

export function sumEpocPenduraPayments(
  lines: EpocPaymentLineInput[],
): number {
  let total = 0;
  for (const line of lines) {
    if (
      isPenduraPaymentMethod(
        line.payment_methods?.sku,
        line.payment_methods?.name,
      )
    ) {
      total += Number(line.amount) || 0;
    }
  }
  return total;
}

export function sumEpocPaymentAmounts(
  lines: EpocPaymentLineInput[],
  mode: "all" | "net_sales" = "net_sales",
): number {
  let total = 0;
  for (const line of lines) {
    if (
      mode === "net_sales" &&
      !paymentMethodCountsInNetSales(line.payment_methods)
    ) {
      continue;
    }
    total += Number(line.amount) || 0;
  }
  return total;
}

/**
 * Confronta todas as fontes possíveis de “venda líquida” no período atual
 * para achar divergências (KPI atual = soma das formas de pagamento EPOC,
 * ou produtos+serviços / net dos lançamentos quando não há formas).
 */
export function buildNetSalesSourceBreakdown(input: {
  fatDays: EpocFaturamentoDayInput[];
  epocPayments: EpocPaymentLineInput[];
  revenueEntries: RevenueEntry[];
  /** Soma de service_daily_sales (gross_value / Vl.Bruto) no período. */
  serviceDailySalesTotal: number;
  kpiNet: number;
  kpiGross: number;
}): NetSalesSourceRow[] {
  let epocProdutos = 0;
  let epocServicos = 0;
  let epocTaxas = 0;
  let epocTotal = 0;
  for (const d of input.fatDays) {
    epocProdutos += Number(d.produtos) || 0;
    epocServicos += Number(d.servicos) || 0;
    epocTaxas += Number(d.taxas) || 0;
    epocTotal += Number(d.total) || 0;
  }
  const epocProdutosMaisServicos = epocProdutos + epocServicos;
  const epocTotalMenosTaxas = epocTotal - epocTaxas;
  const epocPagamentos = input.epocPayments.reduce(
    (s, line) => s + (Number(line.amount) || 0),
    0,
  );
  const epocPendura = sumEpocPenduraPayments(input.epocPayments);
  const penduraShare =
    epocPagamentos > 0 ? epocPendura / epocPagamentos : 0;

  const operational = input.revenueEntries.filter(
    (e) => e.revenue_type === "operational",
  );
  let revenueNet = 0;
  let revenueGross = 0;
  for (const e of operational) {
    revenueNet += Number(e.net_amount) || 0;
    revenueGross += Number(e.gross_amount) || 0;
  }

  const row = (
    key: string,
    label: string,
    value: number,
    note?: string,
    opts?: { isKpi?: boolean; emphasis?: boolean },
  ): NetSalesSourceRow => ({
    key,
    label,
    value,
    diffVsKpiNet: value - input.kpiNet,
    note,
    isKpi: opts?.isKpi,
    emphasis: opts?.emphasis,
  });

  const penduraPctLabel =
    penduraShare > 0
      ? ` (${(penduraShare * 100).toLocaleString("pt-BR", {
          maximumFractionDigits: 1,
        })}% da soma)`
      : "";

  return [
    row(
      "kpi_net",
      "KPI vendas líquidas (card)",
      input.kpiNet,
      "Valor exibido no resumo (soma das formas de pagamento EPOC; senão produtos+serviços ou net dos lançamentos)",
      { isKpi: true },
    ),
    row(
      "kpi_gross",
      "KPI vendas brutas (card)",
      input.kpiGross,
      "EPOC total ou gross dos lançamentos",
    ),
    row("epoc_produtos", "EPOC · produtos", epocProdutos),
    row("epoc_servicos", "EPOC · serviços", epocServicos),
    row(
      "epoc_pagamentos",
      "EPOC · soma formas de pagamento",
      epocPagamentos,
      epocPendura > 0
        ? `Inclui pendura: ${epocPendura.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          })}${penduraPctLabel}. Fonte do card de vendas líquidas`
        : "Fonte do card de vendas líquidas quando há formas no período",
    ),
    row(
      "epoc_pendura",
      "EPOC · pendura (dentro das formas)",
      epocPendura,
      "Parte da soma de formas de pagamento identificada como pendura",
      { emphasis: true },
    ),
    row(
      "epoc_prod_serv",
      "EPOC · produtos + serviços",
      epocProdutosMaisServicos,
      "Fallback de líquidas quando não há formas de pagamento no período",
    ),
    row("epoc_taxas", "EPOC · taxas", epocTaxas),
    row("epoc_total", "EPOC · total (brutas)", epocTotal),
    row(
      "epoc_total_menos_taxas",
      "EPOC · total − taxas",
      epocTotalMenosTaxas,
      "Deve aproximar produtos + serviços se o fechamento for consistente",
    ),
    row(
      "revenue_net",
      "Lançamentos · net_amount (operacional)",
      revenueNet,
    ),
    row(
      "revenue_gross",
      "Lançamentos · gross_amount (operacional)",
      revenueGross,
    ),
    row(
      "service_daily",
      "Serviços diários (service_daily_sales)",
      input.serviceDailySalesTotal,
      "Detalhe de vendas de serviço; não inclui produtos",
    ),
  ];
}

function inRange(ymd: string, start: string, end: string): boolean {
  return ymd >= start && ymd <= end;
}

function sumMetrics(entries: RevenueEntry[]): ResumoKpiMetrics {
  let gross = 0;
  let net = 0;
  for (const e of entries) {
    gross += Number(e.gross_amount) || 0;
    net += Number(e.net_amount) || 0;
  }
  const count = entries.length;
  return {
    gross,
    net,
    count,
    ticket: count > 0 ? net / count : 0,
  };
}

/**
 * KPIs a partir do faturamento diário EPOC (campos da tabela diária):
 * - brutas = `total`
 * - líquidas (fallback) = produtos + serviços — o card do resumo prefere a soma
 *   das formas de pagamento quando houver linhas em `epoc_faturamento_daily_payment_methods`
 * - transações = `quantity`
 * - tíquete = total / quantity (ponderado no período)
 */
export function sumFaturamentoMetrics(
  days: EpocFaturamentoDayInput[],
): ResumoKpiMetrics {
  let gross = 0;
  let net = 0;
  let count = 0;
  for (const d of days) {
    gross += Number(d.total) || 0;
    net += (Number(d.produtos) || 0) + (Number(d.servicos) || 0);
    count += Number(d.quantity) || 0;
  }
  return {
    gross,
    net,
    count,
    ticket: count > 0 ? gross / count : 0,
  };
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) {
    if (current === 0) return 0;
    return null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

function toDelta(current: number, previous: number): ResumoKpiDelta {
  return {
    current,
    previous,
    pctChange: pctChange(current, previous),
  };
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

function buildChampions(
  entries: RevenueEntry[],
  categoriesById: Map<string, CompanyCategory>,
  productNameById: Map<string, string>,
  recipeNameById: Map<string, string>,
): ResumoChampionRow[] {
  const totalNet = entries.reduce((s, e) => s + (Number(e.net_amount) || 0), 0);
  type Acc = {
    key: string;
    label: string;
    categoryLabel: string;
    quantity: number;
    revenue: number;
  };
  const map = new Map<string, Acc>();

  for (const e of entries) {
    const key = productKey(e);
    const label = productLabel(e, productNameById, recipeNameById);
    const categoryLabel = categoryGroupLabel(e.subcategory_id, categoriesById);
    const prev = map.get(key);
    if (prev) {
      prev.quantity += entryQuantity(e);
      prev.revenue += Number(e.net_amount) || 0;
    } else {
      map.set(key, {
        key,
        label,
        categoryLabel,
        quantity: entryQuantity(e),
        revenue: Number(e.net_amount) || 0,
      });
    }
  }

  return [...map.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map((row) => ({
      ...row,
      revenueShare: totalNet > 0 ? row.revenue / totalNet : 0,
    }));
}

function finalizePaymentRows(
  map: Map<
    string,
    {
      key: string;
      label: string;
      shortLabel: string;
      amount: number;
      includeInNetSales: boolean;
      acquirerName: string | null;
    }
  >,
): ResumoPaymentRow[] {
  const total = [...map.values()].reduce((s, r) => s + r.amount, 0);
  return [...map.values()]
    .sort((a, b) => b.amount - a.amount)
    .map((row) => ({
      key: row.key,
      label: row.label,
      shortLabel: row.shortLabel,
      amount: row.amount,
      share: total > 0 ? row.amount / total : 0,
      includeInNetSales: row.includeInNetSales,
      acquirerName: row.acquirerName,
    }));
}

function buildPayments(entries: RevenueEntry[]): ResumoPaymentRow[] {
  const map = new Map<
    string,
    {
      key: string;
      label: string;
      shortLabel: string;
      amount: number;
      includeInNetSales: boolean;
      acquirerName: string | null;
    }
  >();

  for (const e of entries) {
    const key = resolvePaymentMethodKey(e);
    if (!key) continue;
    const { label, shortLabel } = paymentLabels(key);
    const prev = map.get(key);
    const amount = Number(e.net_amount) || 0;
    if (prev) {
      prev.amount += amount;
    } else {
      map.set(key, {
        key,
        label,
        shortLabel,
        amount,
        includeInNetSales: true,
        acquirerName: null,
      });
    }
  }

  return finalizePaymentRows(map);
}

function shortPaymentLabel(name: string, sku: string): string {
  const base = name.trim() || sku.trim() || "Outros";
  if (base.length <= 18) return base;
  return `${base.slice(0, 16)}…`;
}

/**
 * Agrega formas de pagamento do faturamento EPOC (fonte principal da aba
 * “Por tipo de transação”). Só forma + valor — o relatório não traz nº de
 * transações confiável para tíquete médio.
 */
export function buildPaymentsFromEpoc(
  lines: EpocPaymentLineInput[],
): ResumoPaymentRow[] {
  const map = new Map<
    string,
    {
      key: string;
      label: string;
      shortLabel: string;
      amount: number;
      includeInNetSales: boolean;
      acquirerName: string | null;
    }
  >();

  for (const line of lines) {
    const sku = line.payment_methods?.sku?.trim() ?? "";
    const name = line.payment_methods?.name?.trim() ?? "";
    const acquirerName =
      line.payment_methods?.acquirer_name?.trim() || null;
    const key = line.payment_method_id || (sku ? `sku:${sku}` : "unknown");
    const label = name || sku || "Forma sem nome";
    const shortLabel = shortPaymentLabel(label, sku);
    const amount = Number(line.amount) || 0;
    const includeInNetSales = paymentMethodCountsInNetSales(
      line.payment_methods,
    );
    const prev = map.get(key);
    if (prev) {
      prev.amount += amount;
      prev.includeInNetSales = prev.includeInNetSales && includeInNetSales;
      if (name && prev.label === (sku || "Forma sem nome")) {
        prev.label = name;
        prev.shortLabel = shortPaymentLabel(name, sku);
      }
      if (!prev.acquirerName && acquirerName) {
        prev.acquirerName = acquirerName;
      }
    } else {
      map.set(key, {
        key,
        label,
        shortLabel,
        amount,
        includeInNetSales,
        acquirerName,
      });
    }
  }

  return finalizePaymentRows(map);
}

function buildDailySeries(
  entries: RevenueEntry[],
  ranges: ResumoRanges,
  period: ResumoPeriodFilter,
): ResumoDailyPoint[] {
  const byDate = new Map<string, number>();
  for (const e of entries) {
    const d = e.entry_date.slice(0, 10);
    byDate.set(d, (byDate.get(d) ?? 0) + (Number(e.net_amount) || 0));
  }

  const points: ResumoDailyPoint[] = [];
  const len = daysInclusive(ranges.currentStart, ranges.currentEnd);
  for (let i = 0; i < len; i++) {
    const date = addDaysYmd(ranges.currentStart, i);
    points.push({
      date,
      label: dailyPointLabel(period, date, len),
      net: byDate.get(date) ?? 0,
    });
  }
  return points;
}

/** Série diária a partir das formas de pagamento EPOC (líquidas = soma do dia). */
function buildDailySeriesFromPayments(
  lines: EpocPaymentLineInput[],
  ranges: ResumoRanges,
  period: ResumoPeriodFilter,
): ResumoDailyPoint[] {
  const byDate = new Map<string, number>();
  for (const line of lines) {
    if (!paymentMethodCountsInNetSales(line.payment_methods)) continue;
    const key = line.faturamento_date.slice(0, 10);
    byDate.set(key, (byDate.get(key) ?? 0) + (Number(line.amount) || 0));
  }

  const points: ResumoDailyPoint[] = [];
  const len = daysInclusive(ranges.currentStart, ranges.currentEnd);
  for (let i = 0; i < len; i++) {
    const date = addDaysYmd(ranges.currentStart, i);
    points.push({
      date,
      label: dailyPointLabel(period, date, len),
      net: byDate.get(date) ?? 0,
    });
  }
  return points;
}

/** Série diária a partir do faturamento EPOC (fallback = produtos + serviços). */
function buildDailySeriesFromFaturamento(
  days: EpocFaturamentoDayInput[],
  ranges: ResumoRanges,
  period: ResumoPeriodFilter,
): ResumoDailyPoint[] {
  const byDate = new Map<string, number>();
  for (const d of days) {
    const key = d.faturamento_date.slice(0, 10);
    const net = (Number(d.produtos) || 0) + (Number(d.servicos) || 0);
    byDate.set(key, (byDate.get(key) ?? 0) + net);
  }

  const points: ResumoDailyPoint[] = [];
  const len = daysInclusive(ranges.currentStart, ranges.currentEnd);
  for (let i = 0; i < len; i++) {
    const date = addDaysYmd(ranges.currentStart, i);
    points.push({
      date,
      label: dailyPointLabel(period, date, len),
      net: byDate.get(date) ?? 0,
    });
  }
  return points;
}

function buildCategories(
  entries: RevenueEntry[],
  categoriesById: Map<string, CompanyCategory>,
): ResumoCategoryRow[] {
  const totalNet = entries.reduce((s, e) => s + (Number(e.net_amount) || 0), 0);
  const map = new Map<string, { label: string; revenue: number }>();

  for (const e of entries) {
    const label = categoryGroupLabel(e.subcategory_id, categoriesById);
    const key = label;
    const prev = map.get(key);
    const amount = Number(e.net_amount) || 0;
    if (prev) {
      prev.revenue += amount;
    } else {
      map.set(key, { label, revenue: amount });
    }
  }

  return [...map.entries()]
    .map(([key, row]) => ({
      key,
      label: row.label,
      revenue: row.revenue,
      share: totalNet > 0 ? row.revenue / totalNet : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

export function buildVendasRealizadasResumo(input: {
  entries: RevenueEntry[];
  period: ResumoPeriodFilter;
  todayYmd: string;
  rankingMode: ResumoRankingMode;
  categoriesById: Map<string, CompanyCategory>;
  productNameById: Map<string, string>;
  recipeNameById: Map<string, string>;
  /** Produtos de categoria marcada como não-venda. */
  excludedProductIds?: ReadonlySet<string>;
  /** Formas de pagamento do faturamento EPOC (período já filtrado ou completo). */
  epocPayments?: EpocPaymentLineInput[];
  /** Dias de faturamento EPOC para os KPIs (fonte preferencial). */
  epocFaturamentoDays?: EpocFaturamentoDayInput[];
  /** Obrigatório quando period === "custom". */
  customRange?: ResumoCustomRange | null;
  /** Dia de início da semana contábil (0=dom … 6=sáb). */
  weekStartsOn?: number;
}): ResumoDashboard {
  const ranges = getResumoRanges(
    input.period,
    input.todayYmd,
    input.customRange,
    { weekStartsOn: input.weekStartsOn },
  );
  const operational = filterRevenueEntriesAppearingAsSale(
    input.entries.filter((e) => e.revenue_type === "operational"),
    input.excludedProductIds,
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

  const fatDays = input.epocFaturamentoDays ?? [];
  const fatCurrent = fatDays.filter((d) =>
    inRange(
      d.faturamento_date.slice(0, 10),
      ranges.currentStart,
      ranges.currentEnd,
    ),
  );
  const fatPrevious = fatDays.filter((d) =>
    inRange(
      d.faturamento_date.slice(0, 10),
      ranges.previousStart,
      ranges.previousEnd,
    ),
  );

  // Fonte por período: EPOC do intervalo selecionado; senão lançamentos do mesmo intervalo.
  // (Antes um OR global fazia o período atual zerar quando só o anterior tinha EPOC.)
  const curM =
    fatCurrent.length > 0
      ? sumFaturamentoMetrics(fatCurrent)
      : sumMetrics(current);
  const prevM =
    fatPrevious.length > 0
      ? sumFaturamentoMetrics(fatPrevious)
      : sumMetrics(previous);

  const epocCurrent = (input.epocPayments ?? []).filter((line) =>
    inRange(
      line.faturamento_date.slice(0, 10),
      ranges.currentStart,
      ranges.currentEnd,
    ),
  );
  const epocPrevious = (input.epocPayments ?? []).filter((line) =>
    inRange(
      line.faturamento_date.slice(0, 10),
      ranges.previousStart,
      ranges.previousEnd,
    ),
  );

  // Vendas líquidas (card): soma das formas com include_in_net_sales.
  if (epocCurrent.length > 0) {
    curM.net = sumEpocPaymentAmounts(epocCurrent, "net_sales");
  }
  if (epocPrevious.length > 0) {
    prevM.net = sumEpocPaymentAmounts(epocPrevious, "net_sales");
  }

  const paymentsFromEpoc = buildPaymentsFromEpoc(epocCurrent);
  const payments =
    paymentsFromEpoc.length > 0 ? paymentsFromEpoc : buildPayments(current);

  const daily =
    epocCurrent.length > 0
      ? buildDailySeriesFromPayments(epocCurrent, ranges, input.period)
      : fatCurrent.length > 0
        ? buildDailySeriesFromFaturamento(fatCurrent, ranges, input.period)
        : buildDailySeries(current, ranges, input.period);

  const hasPeriodSales =
    fatCurrent.length > 0 ||
    current.length > 0 ||
    curM.gross > 0 ||
    curM.net > 0 ||
    curM.count > 0;

  return {
    ranges,
    hasPeriodSales,
    kpis: {
      gross: toDelta(curM.gross, prevM.gross),
      net: toDelta(curM.net, prevM.net),
      count: toDelta(curM.count, prevM.count),
      ticket: toDelta(curM.ticket, prevM.ticket),
    },
    champions: buildChampions(
      current,
      input.categoriesById,
      input.productNameById,
      input.recipeNameById,
    ),
    payments,
    daily,
    categories: buildCategories(current, input.categoriesById),
  };
}

export function formatCompactBrl(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("pt-BR", {
      maximumFractionDigits: 1,
    })}M`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toLocaleString("pt-BR", {
      maximumFractionDigits: 1,
    })}K`;
  }
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  });
}

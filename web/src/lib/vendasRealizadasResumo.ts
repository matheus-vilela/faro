import { addDaysYmd, getMonthYmdRange } from "@/lib/payableTotals";
import {
  companyCategoryDisplayName,
} from "@/lib/companyCategoryLabels";
import type { CompanyCategory } from "@/types/category";
import type { RevenueEntry } from "@/types/revenue";

export type ResumoPeriodFilter = "today" | "last7" | "month";

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
};

/** Linha diária de forma de pagamento vinda do faturamento EPOC. */
export type EpocPaymentLineInput = {
  faturamento_date: string;
  amount: number | null;
  payment_method_id: string;
  payment_methods: { sku: string; name: string } | null;
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

export function getResumoRanges(
  period: ResumoPeriodFilter,
  todayYmd: string,
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

  // last7 (default)
  const currentStart = addDaysYmd(todayYmd, -6);
  const previousEnd = addDaysYmd(currentStart, -1);
  const previousStart = addDaysYmd(previousEnd, -6);
  return {
    currentStart,
    currentEnd: todayYmd,
    previousStart,
    previousEnd,
    compareLabel: "vs semana anterior",
    championsTitle: "últimos 7 dias",
    periodShortLabel: "7 dias",
    fetchStart: previousStart,
    fetchEnd: todayYmd,
  };
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
 * KPIs a partir do faturamento diário EPOC:
 * - brutas = `total`
 * - líquidas = produtos + serviços (sem taxas)
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
    { key: string; label: string; shortLabel: string; amount: number }
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
    }));
}

function buildPayments(entries: RevenueEntry[]): ResumoPaymentRow[] {
  const map = new Map<
    string,
    { key: string; label: string; shortLabel: string; amount: number }
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
      map.set(key, { key, label, shortLabel, amount });
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
    { key: string; label: string; shortLabel: string; amount: number }
  >();

  for (const line of lines) {
    const sku = line.payment_methods?.sku?.trim() ?? "";
    const name = line.payment_methods?.name?.trim() ?? "";
    const key = line.payment_method_id || (sku ? `sku:${sku}` : "unknown");
    const label = name || sku || "Forma sem nome";
    const shortLabel = shortPaymentLabel(label, sku);
    const amount = Number(line.amount) || 0;
    const prev = map.get(key);
    if (prev) {
      prev.amount += amount;
      if (name && prev.label === (sku || "Forma sem nome")) {
        prev.label = name;
        prev.shortLabel = shortPaymentLabel(name, sku);
      }
    } else {
      map.set(key, { key, label, shortLabel, amount });
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
    let label: string;
    if (period === "today") {
      label = "Hoje";
    } else if (period === "month") {
      label = dayOfMonthLabel(date);
    } else {
      label = weekdayShort(date);
    }
    points.push({
      date,
      label,
      net: byDate.get(date) ?? 0,
    });
  }
  return points;
}

/** Série diária a partir do faturamento EPOC (líquido = produtos + serviços). */
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
    let label: string;
    if (period === "today") {
      label = "Hoje";
    } else if (period === "month") {
      label = dayOfMonthLabel(date);
    } else {
      label = weekdayShort(date);
    }
    points.push({
      date,
      label,
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
  /** Formas de pagamento do faturamento EPOC (período já filtrado ou completo). */
  epocPayments?: EpocPaymentLineInput[];
  /** Dias de faturamento EPOC para os KPIs (fonte preferencial). */
  epocFaturamentoDays?: EpocFaturamentoDayInput[];
}): ResumoDashboard {
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
  const paymentsFromEpoc = buildPaymentsFromEpoc(epocCurrent);
  const payments =
    paymentsFromEpoc.length > 0 ? paymentsFromEpoc : buildPayments(current);

  const daily =
    fatCurrent.length > 0
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

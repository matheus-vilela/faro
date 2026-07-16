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
  count: number;
  amount: number;
  ticket: number;
  share: number;
};

export type ResumoDashboard = {
  kpis: {
    gross: ResumoKpiDelta;
    net: ResumoKpiDelta;
    count: ResumoKpiDelta;
    ticket: ResumoKpiDelta;
  };
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

function buildPayments(entries: RevenueEntry[]): ResumoPaymentRow[] {
  const map = new Map<
    string,
    { key: string; label: string; shortLabel: string; count: number; amount: number }
  >();

  for (const e of entries) {
    const key = resolvePaymentMethodKey(e);
    if (!key) continue;
    const { label, shortLabel } = paymentLabels(key);
    const prev = map.get(key);
    const amount = Number(e.net_amount) || 0;
    if (prev) {
      prev.count += 1;
      prev.amount += amount;
    } else {
      map.set(key, { key, label, shortLabel, count: 1, amount });
    }
  }

  const total = [...map.values()].reduce((s, r) => s + r.amount, 0);
  return [...map.values()]
    .sort((a, b) => b.amount - a.amount)
    .map((row) => ({
      key: row.key,
      label: row.label,
      shortLabel: row.shortLabel,
      count: row.count,
      amount: row.amount,
      ticket: row.count > 0 ? row.amount / row.count : 0,
      share: total > 0 ? row.amount / total : 0,
    }));
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

  const curM = sumMetrics(current);
  const prevM = sumMetrics(previous);

  return {
    ranges,
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
    payments: buildPayments(current),
    daily: buildDailySeries(current, ranges, input.period),
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

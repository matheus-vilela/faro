import { getMonthRange, type MonthYear } from "@/components/MonthSelector";
import {
  aggregateTotalsByCategory,
  buildDreComputedFromMaps,
  type DreComputed,
} from "@/lib/dre/computeDre";
import { mapCategoryToDreBucket } from "@/lib/dre/dreMapping";
import { shiftMonth } from "@/lib/dre/dreInsight";
import { fetchExpenseItemsForRateio } from "@/lib/dre/fetchExpenseItemsForRateio";
import {
  expandBoletosToDrePurchaseAmounts,
  groupRateioItemsByExpenseId,
} from "@/lib/dre/rateioBoletoByItems";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import { isBoletoPayable } from "@/types/expense";

export type DreHistoryPoint = {
  period: MonthYear;
  label: string;
  computed: DreComputed;
};

const MONTH_SHORT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

type BolRow = {
  amount: number;
  due_date: string;
  flow_type: string | null;
  company_category_id: string | null;
  revenue_entry_id: string | null;
  expense_id: string | null;
};

type RevRow = {
  cmv_amount: number | null;
  entry_date: string;
};

function periodKey(p: MonthYear): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

function ymdToPeriod(ymd: string): MonthYear {
  const [y, m] = ymd.slice(0, 10).split("-").map(Number);
  return { year: y, month: m };
}

/**
 * Carrega DRE agregados dos últimos `months` meses até `endPeriod` (inclusive),
 * com uma query de boletos + CMV no intervalo.
 */
export async function fetchDreHistory(
  companyId: string,
  categories: CompanyCategory[],
  endPeriod: MonthYear,
  months: number,
): Promise<DreHistoryPoint[]> {
  const periods: MonthYear[] = [];
  for (let i = months - 1; i >= 0; i--) {
    periods.push(shiftMonth(endPeriod, -i));
  }
  const first = periods[0];
  const last = periods[periods.length - 1];
  const { start } = getMonthRange(first.month, first.year);
  const { end } = getMonthRange(last.month, last.year);
  const startDate = start.slice(0, 10);
  const endDate = end.slice(0, 10);

  const categoriesById = new Map(categories.map((c) => [c.id, c]));

  const [bolRes, revRes] = await Promise.all([
    supabase
      .from("boletos")
      .select(
        "amount, due_date, flow_type, company_category_id, revenue_entry_id, expense_id",
      )
      .eq("company_id", companyId)
      .gte("due_date", startDate)
      .lte("due_date", endDate),
    supabase
      .from("revenue_entries")
      .select("cmv_amount, entry_date")
      .eq("company_id", companyId)
      .in("entry_mode", ["product_sale", "recipe_sale"])
      .gte("entry_date", startDate)
      .lte("entry_date", endDate),
  ]);

  if (bolRes.error) throw bolRes.error;
  if (revRes.error) throw revRes.error;

  const boletos = (bolRes.data ?? []) as BolRow[];
  const revs = (revRes.data ?? []) as RevRow[];
  const items = await fetchExpenseItemsForRateio(
    companyId,
    boletos.map((b) => b.expense_id).filter((id): id is string => Boolean(id)),
  );
  const itemsByExpenseId = groupRateioItemsByExpenseId(items);

  const bolByPeriod = new Map<string, BolRow[]>();
  for (const b of boletos) {
    const p = ymdToPeriod(b.due_date);
    const key = periodKey(p);
    const list = bolByPeriod.get(key) ?? [];
    list.push(b);
    bolByPeriod.set(key, list);
  }

  const cmvByPeriod = new Map<string, number>();
  for (const r of revs) {
    const p = ymdToPeriod(r.entry_date);
    const key = periodKey(p);
    cmvByPeriod.set(
      key,
      (cmvByPeriod.get(key) ?? 0) + Math.max(0, Number(r.cmv_amount) || 0),
    );
  }

  return periods.map((period) => {
    const key = periodKey(period);
    const rows = bolByPeriod.get(key) ?? [];
    const filtered = rows.filter((b) => {
      if (!b.revenue_entry_id || !isBoletoPayable(b)) {
        return true;
      }
      const cat = b.company_category_id
        ? categoriesById.get(b.company_category_id)
        : undefined;
      return cat ? mapCategoryToDreBucket(cat) !== "CMV" : true;
    });
    const totals = aggregateTotalsByCategory(
      expandBoletosToDrePurchaseAmounts(
        filtered.map((b) => ({
          amount: Number(b.amount),
          expense_id: b.expense_id,
          company_category_id: b.company_category_id,
        })),
        itemsByExpenseId,
        categoriesById,
      ),
      categoriesById,
    );
    const computed = buildDreComputedFromMaps(
      totals.byCategoryId,
      categoriesById,
      cmvByPeriod.get(key) ?? 0,
    );
    return {
      period,
      label: MONTH_SHORT[period.month - 1],
      computed,
    };
  });
}

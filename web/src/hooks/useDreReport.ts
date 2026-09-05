import { getMonthRange } from "@/components/MonthSelector";
import type { MonthYear } from "@/components/MonthSelector";
import {
  aggregateTotalsByCategory,
  buildDreComputedFromMaps,
  type DreComputed,
  type CategoryTotals,
} from "@/lib/dre/computeDre";
import { mapCategoryToDreBucket } from "@/lib/dre/dreMapping";
import {
  dreHasMappedMovement,
  dreHasOnlyUnclassified,
} from "@/lib/dre/dreMovement";
import { fetchExpenseItemsForRateio } from "@/lib/dre/fetchExpenseItemsForRateio";
import {
  boletoHasUnclassifiedRemainder,
  expandBoletosToDrePurchaseAmounts,
  groupRateioItemsByExpenseId,
  type RateioLine,
} from "@/lib/dre/rateioBoletoByItems";
import { supabase } from "@/lib/supabase";
import {
  fetchExcludedFromSalesProductIds,
  sumRevenueCmvAppearingAsSale,
} from "@/lib/productExcludeFromSales";
import type { CompanyCategory } from "@/types/category";
import type { Boleto } from "@/types/expense";
import { isBoletoPayable, isBoletoTransfer } from "@/types/expense";
import { useCallback, useEffect, useMemo, useState } from "react";

/** Boleto do período DRE com campos para listagem de sem categoria. */
export type DreSemCategoriaBoleto = Pick<
  Boleto,
  | "id"
  | "description"
  | "amount"
  | "due_date"
  | "flow_type"
  | "company_category_id"
  | "status"
  | "revenue_entry_id"
  | "expense_id"
  | "category"
  | "entry_kind"
>;

export interface UseDreReportState {
  loading: boolean;
  error: string | null;
  categories: CompanyCategory[];
  boletosInPeriod: DreSemCategoriaBoleto[];
  boletosSemCategoria: DreSemCategoriaBoleto[];
  salesCmvInPeriod: number;
  categoryTotals: CategoryTotals;
  computed: DreComputed | null;
  periodLabel: string;
  hasMappedMovement: boolean;
  hasOnlyUnclassified: boolean;
  reload: () => Promise<void>;
}

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/**
 * DRE por competência (vencimento): boletos com due_date no mês selecionado.
 * Inclui pendentes e pagos — reconhecimento pelo vencimento, não pelo caixa.
 */
export function useDreReport(
  companyId: string | undefined,
  period: MonthYear,
  options?: { enabled?: boolean },
): UseDreReportState {
  const enabled = options?.enabled ?? true;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<CompanyCategory[]>([]);
  const [boletosInPeriod, setBoletosInPeriod] = useState<
    UseDreReportState["boletosInPeriod"]
  >([]);
  const [salesCmvInPeriod, setSalesCmvInPeriod] = useState(0);
  const [rateioItemsByExpenseId, setRateioItemsByExpenseId] = useState<
    Map<string, RateioLine[]>
  >(() => new Map());

  const load = useCallback(async () => {
    if (!enabled) return;
    if (!companyId) {
      setCategories([]);
      setBoletosInPeriod([]);
      setSalesCmvInPeriod(0);
      setRateioItemsByExpenseId(new Map());
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const { start, end } = getMonthRange(period.month, period.year);
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
        .order("due_date", { ascending: true })
        .order("amount", { ascending: false }),
      supabase
        .from("revenue_entries")
        .select("cmv_amount, product_id, entry_mode")
        .eq("company_id", companyId)
        .in("entry_mode", ["product_sale", "recipe_sale"])
        .gte("entry_date", startDate)
        .lte("entry_date", endDate),
      fetchExcludedFromSalesProductIds(companyId),
    ]);

    if (catRes.error) {
      setError(catRes.error.message);
      setCategories([]);
      setBoletosInPeriod([]);
      setSalesCmvInPeriod(0);
      setRateioItemsByExpenseId(new Map());
      setLoading(false);
      return;
    }
    if (bolRes.error) {
      setError(bolRes.error.message);
      setCategories([]);
      setBoletosInPeriod([]);
      setSalesCmvInPeriod(0);
      setRateioItemsByExpenseId(new Map());
      setLoading(false);
      return;
    }
    if (revCmvRes.error) {
      setError(revCmvRes.error.message);
      setCategories([]);
      setBoletosInPeriod([]);
      setSalesCmvInPeriod(0);
      setRateioItemsByExpenseId(new Map());
      setLoading(false);
      return;
    }

    setCategories((catRes.data ?? []) as CompanyCategory[]);
    const boletos = (bolRes.data ?? []) as DreSemCategoriaBoleto[];
    setBoletosInPeriod(boletos);
    const expenseIds = boletos
      .map((b) => b.expense_id)
      .filter((id): id is string => Boolean(id));
    try {
      const items = await fetchExpenseItemsForRateio(companyId, expenseIds);
      setRateioItemsByExpenseId(groupRateioItemsByExpenseId(items));
    } catch (e) {
      console.error(e);
      setRateioItemsByExpenseId(new Map());
    }
    const salesCmv = sumRevenueCmvAppearingAsSale(
      (revCmvRes.data ?? []) as Array<{
        cmv_amount?: number | null;
        product_id?: string | null;
        entry_mode?: string | null;
      }>,
      new Set(excludedIds),
    );
    setSalesCmvInPeriod(salesCmv);
    setLoading(false);
  }, [companyId, period.month, period.year, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const categoriesById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const boletosForDreAggregation = useMemo(() => {
    return boletosInPeriod.filter((b) => {
      if (isBoletoTransfer(b)) return false;
      if (!b.revenue_entry_id || !isBoletoPayable(b)) return true;
      const cat = b.company_category_id
        ? categoriesById.get(b.company_category_id)
        : undefined;
      return cat ? mapCategoryToDreBucket(cat) !== "CMV" : true;
    });
  }, [boletosInPeriod, categoriesById]);

  const boletosSemCategoria = useMemo(() => {
    return boletosInPeriod.filter((b) => {
      if (isBoletoTransfer(b)) return false;
      const items = b.expense_id
        ? (rateioItemsByExpenseId.get(b.expense_id) ?? [])
        : [];
      return boletoHasUnclassifiedRemainder(
        {
          amount: Number(b.amount),
          expense_id: b.expense_id,
          company_category_id: b.company_category_id ?? null,
        },
        items,
      );
    });
  }, [boletosInPeriod, rateioItemsByExpenseId]);

  const categoryTotals = useMemo(() => {
    const expanded = expandBoletosToDrePurchaseAmounts(
      boletosForDreAggregation.map((b) => ({
        amount: Number(b.amount),
        expense_id: b.expense_id,
        company_category_id: b.company_category_id ?? null,
      })),
      rateioItemsByExpenseId,
      categoriesById,
    );
    return aggregateTotalsByCategory(expanded, categoriesById);
  }, [boletosForDreAggregation, categoriesById, rateioItemsByExpenseId]);

  const computed = useMemo(() => {
    if (!categories.length && !boletosInPeriod.length && salesCmvInPeriod <= 0) {
      return null;
    }
    return buildDreComputedFromMaps(
      categoryTotals.byCategoryId,
      categoriesById,
      salesCmvInPeriod,
    );
  }, [
    categoryTotals.byCategoryId,
    categoriesById,
    categories.length,
    boletosInPeriod.length,
    salesCmvInPeriod,
  ]);

  const hasMappedMovement = useMemo(
    () => dreHasMappedMovement(computed, salesCmvInPeriod, categoryTotals),
    [computed, salesCmvInPeriod, categoryTotals],
  );

  const hasOnlyUnclassified = useMemo(
    () =>
      dreHasOnlyUnclassified(
        boletosInPeriod.length,
        hasMappedMovement,
        categoryTotals.semCategoriaCount,
      ),
    [
      boletosInPeriod.length,
      hasMappedMovement,
      categoryTotals.semCategoriaCount,
    ],
  );

  const periodLabel = `${MONTH_NAMES[period.month - 1]} ${period.year}`;

  return {
    loading,
    error,
    categories,
    boletosInPeriod,
    boletosSemCategoria,
    salesCmvInPeriod,
    categoryTotals,
    computed,
    periodLabel,
    hasMappedMovement,
    hasOnlyUnclassified,
    reload: load,
  };
}

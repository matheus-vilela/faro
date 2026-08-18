import type { MonthYear } from "@/components/MonthSelector";
import { computeBudgetComparison } from "@/lib/budget/computeBudgetComparison";
import { fetchActualAvg3Months } from "@/lib/budget/fetchActualAvg3Months";
import { fetchActualByCategory } from "@/lib/budget/fetchActualByCategory";
import { fetchCategoryBudgets } from "@/lib/budget/fetchCategoryBudgets";
import {
  BUDGET_PREFS_STORAGE_PREFIX,
  DEFAULT_BUDGET_PREFS,
  type BudgetBasis,
  type BudgetComparisonResult,
  type CategoryBudgetRow,
} from "@/lib/budget/types";
import {
  clearBudgetsForMonth,
  copyBudgetsFromPreviousMonth,
  upsertCategoryBudget,
} from "@/lib/budget/upsertCategoryBudget";
import { shiftMonth } from "@/lib/dre/dreInsight";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import { useCallback, useEffect, useMemo, useState } from "react";

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

function storageKey(companyId: string): string {
  return `${BUDGET_PREFS_STORAGE_PREFIX}${companyId}`;
}

function parseBasis(raw: unknown): BudgetBasis {
  if (raw === "competencia" || raw === "caixa") return raw;
  return DEFAULT_BUDGET_PREFS.basis;
}

function loadBasis(companyId: string): BudgetBasis {
  if (typeof window === "undefined") return DEFAULT_BUDGET_PREFS.basis;
  try {
    const raw = localStorage.getItem(storageKey(companyId));
    if (!raw) return DEFAULT_BUDGET_PREFS.basis;
    const parsed = JSON.parse(raw) as { basis?: unknown };
    return parseBasis(parsed.basis);
  } catch {
    return DEFAULT_BUDGET_PREFS.basis;
  }
}

function saveBasis(companyId: string, basis: BudgetBasis): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(companyId), JSON.stringify({ basis }));
  } catch {
    // ignore
  }
}

export function useBudgetComparison(
  companyId: string | undefined,
  period: MonthYear,
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<CompanyCategory[]>([]);
  const [budgets, setBudgets] = useState<CategoryBudgetRow[]>([]);
  const [actualByCategoryId, setActualByCategoryId] = useState<
    Map<string, number>
  >(new Map());
  const [avg3mByCategoryId, setAvg3mByCategoryId] = useState<
    Map<string, number>
  >(new Map());
  const [salesCmv, setSalesCmv] = useState(0);
  const [semCategoriaCount, setSemCategoriaCount] = useState(0);
  const [semCategoriaTotal, setSemCategoriaTotal] = useState(0);
  const [previousMonthBudgetCount, setPreviousMonthBudgetCount] = useState(0);
  const [basis, setBasisState] = useState<BudgetBasis>(
    DEFAULT_BUDGET_PREFS.basis,
  );
  const [savingCategoryId, setSavingCategoryId] = useState<string | null>(
    null,
  );
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  useEffect(() => {
    if (companyId) setBasisState(loadBasis(companyId));
  }, [companyId]);

  const setBasis = useCallback(
    (value: BudgetBasis) => {
      setBasisState(value);
      if (companyId) saveBasis(companyId, value);
    },
    [companyId],
  );

  const load = useCallback(async () => {
    if (!companyId) {
      setLoading(true);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const catRes = await supabase
        .from("company_categories")
        .select("*")
        .eq("company_id", companyId)
        .order("ordem", { ascending: true })
        .order("name", { ascending: true });

      if (catRes.error) throw catRes.error;

      const cats = (catRes.data ?? []) as CompanyCategory[];
      const categoriesById = new Map(cats.map((c) => [c.id, c]));
      const prevPeriod = shiftMonth(period, -1);

      const [budgetRows, prevBudgetRows, actualRes, avgMap] = await Promise.all([
        fetchCategoryBudgets(companyId, period.year, period.month),
        fetchCategoryBudgets(companyId, prevPeriod.year, prevPeriod.month),
        fetchActualByCategory(companyId, period, basis, categoriesById),
        fetchActualAvg3Months(companyId, period, basis, categoriesById),
      ]);

      setCategories(cats);
      setBudgets(budgetRows);
      setPreviousMonthBudgetCount(prevBudgetRows.length);
      setActualByCategoryId(actualRes.byCategoryId);
      setAvg3mByCategoryId(avgMap);
      setSalesCmv(actualRes.salesCmv);
      setSemCategoriaCount(actualRes.semCategoriaCount);
      setSemCategoriaTotal(actualRes.semCategoriaTotal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar orçamento.");
      setCategories([]);
      setBudgets([]);
      setPreviousMonthBudgetCount(0);
      setActualByCategoryId(new Map());
      setAvg3mByCategoryId(new Map());
      setSalesCmv(0);
      setSemCategoriaCount(0);
      setSemCategoriaTotal(0);
    } finally {
      setLoading(false);
    }
  }, [companyId, period.month, period.year, basis]);

  useEffect(() => {
    void load();
  }, [load]);

  const comparison: BudgetComparisonResult | null = useMemo(() => {
    if (
      !categories.length &&
      !budgets.length &&
      actualByCategoryId.size === 0 &&
      salesCmv <= 0
    ) {
      return null;
    }
    return computeBudgetComparison({
      categories,
      budgets,
      actualByCategoryId,
      salesCmv,
    });
  }, [categories, budgets, actualByCategoryId, salesCmv]);

  const expenseCategoryCount = useMemo(
    () => categories.filter((c) => c.natureza === "DESPESA" && c.ativo !== false).length,
    [categories],
  );

  const periodLabel = `${MONTH_NAMES[period.month - 1]} ${period.year}`;

  const saveBudget = useCallback(
    async (categoryId: string, amount: number) => {
      if (!companyId) return;
      setSavingCategoryId(categoryId);
      try {
        await upsertCategoryBudget({
          companyId,
          categoryId,
          year: period.year,
          month: period.month,
          amount,
        });
        setBudgets((prev) => {
          const next = prev.filter((b) => b.categoryId !== categoryId);
          if (amount > 0) next.push({ categoryId, amount });
          return next;
        });
      } finally {
        setSavingCategoryId(null);
      }
    },
    [companyId, period.month, period.year],
  );

  const copyFromPreviousMonth = useCallback(async () => {
    if (!companyId) return 0;
    setBulkActionLoading(true);
    try {
      const count = await copyBudgetsFromPreviousMonth({
        companyId,
        year: period.year,
        month: period.month,
      });
      await load();
      return count;
    } finally {
      setBulkActionLoading(false);
    }
  }, [companyId, period.month, period.year, load]);

  const applyAvg3mAsBudget = useCallback(async () => {
    if (!companyId || avg3mByCategoryId.size === 0) return 0;
    setBulkActionLoading(true);
    try {
      let count = 0;
      for (const [categoryId, amount] of avg3mByCategoryId) {
        const rounded = Math.round(amount * 100) / 100;
        if (rounded <= 0) continue;
        await upsertCategoryBudget({
          companyId,
          categoryId,
          year: period.year,
          month: period.month,
          amount: rounded,
        });
        count += 1;
      }
      await load();
      return count;
    } finally {
      setBulkActionLoading(false);
    }
  }, [companyId, avg3mByCategoryId, period.month, period.year, load]);

  const clearMonthBudgets = useCallback(async () => {
    if (!companyId) return;
    setBulkActionLoading(true);
    try {
      await clearBudgetsForMonth({
        companyId,
        year: period.year,
        month: period.month,
      });
      setBudgets([]);
    } finally {
      setBulkActionLoading(false);
    }
  }, [companyId, period.month, period.year]);

  return {
    loading,
    error,
    basis,
    setBasis,
    comparison,
    categories,
    expenseCategoryCount,
    periodLabel,
    savingCategoryId,
    bulkActionLoading,
    avg3mByCategoryId,
    previousMonthBudgetCount,
    semCategoriaCount,
    semCategoriaTotal,
    salesCmv,
    saveBudget,
    copyFromPreviousMonth,
    applyAvg3mAsBudget,
    clearMonthBudgets,
    reload: load,
  };
}

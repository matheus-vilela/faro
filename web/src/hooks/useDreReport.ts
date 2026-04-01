import { getMonthRange } from "@/components/MonthSelector";
import type { MonthYear } from "@/components/MonthSelector";
import {
  aggregateTotalsByCategory,
  buildDreComputedFromMaps,
  type DreComputed,
  type CategoryTotals,
} from "@/lib/dre/computeDre";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import type { Boleto } from "@/types/expense";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface UseDreReportState {
  loading: boolean;
  error: string | null;
  categories: CompanyCategory[];
  boletosInPeriod: Pick<
    Boleto,
    "id" | "amount" | "due_date" | "flow_type" | "company_category_id" | "status"
  >[];
  categoryTotals: CategoryTotals;
  computed: DreComputed | null;
  periodLabel: string;
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
): UseDreReportState {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<CompanyCategory[]>([]);
  const [boletosInPeriod, setBoletosInPeriod] = useState<
    Pick<
      Boleto,
      "id" | "amount" | "due_date" | "flow_type" | "company_category_id" | "status"
    >[]
  >([]);

  const load = useCallback(async () => {
    if (!companyId) {
      setCategories([]);
      setBoletosInPeriod([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const { start, end } = getMonthRange(period.month, period.year);
    const startDate = start.slice(0, 10);
    const endDate = end.slice(0, 10);

    const [catRes, bolRes] = await Promise.all([
      supabase
        .from("company_categories")
        .select("*")
        .eq("company_id", companyId)
        .order("ordem", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("boletos")
        .select("id, amount, due_date, flow_type, company_category_id, status")
        .eq("company_id", companyId)
        .gte("due_date", startDate)
        .lte("due_date", endDate),
    ]);

    if (catRes.error) {
      setError(catRes.error.message);
      setCategories([]);
      setBoletosInPeriod([]);
      setLoading(false);
      return;
    }
    if (bolRes.error) {
      setError(bolRes.error.message);
      setCategories([]);
      setBoletosInPeriod([]);
      setLoading(false);
      return;
    }

    setCategories((catRes.data ?? []) as CompanyCategory[]);
    setBoletosInPeriod((bolRes.data ?? []) as UseDreReportState["boletosInPeriod"]);
    setLoading(false);
  }, [companyId, period.month, period.year]);

  useEffect(() => {
    void load();
  }, [load]);

  const categoriesById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const categoryTotals = useMemo(() => {
    return aggregateTotalsByCategory(
      boletosInPeriod.map((b) => ({
        amount: Number(b.amount),
        company_category_id: b.company_category_id ?? null,
      })),
      categoriesById,
    );
  }, [boletosInPeriod, categoriesById]);

  const computed = useMemo(() => {
    if (!categories.length && !boletosInPeriod.length) return null;
    return buildDreComputedFromMaps(categoryTotals.byCategoryId, categoriesById);
  }, [categoryTotals.byCategoryId, categoriesById, categories.length, boletosInPeriod.length]);

  const periodLabel = `${MONTH_NAMES[period.month - 1]} ${period.year}`;

  return {
    loading,
    error,
    categories,
    boletosInPeriod,
    categoryTotals,
    computed,
    periodLabel,
  };
}

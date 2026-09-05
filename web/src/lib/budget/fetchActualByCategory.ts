import type { MonthYear } from "@/components/MonthSelector";
import { getMonthYmdRange } from "@/lib/payableTotals";
import { supabase } from "@/lib/supabase";
import {
  fetchExcludedFromSalesProductIds,
  sumRevenueCmvAppearingAsSale,
} from "@/lib/productExcludeFromSales";
import type { CompanyCategory } from "@/types/category";
import { mapCategoryToDreBucket } from "@/lib/dre/dreMapping";
import { fetchExpenseItemsForRateio } from "@/lib/dre/fetchExpenseItemsForRateio";
import {
  expandBoletoAmountByItemCategories,
  groupRateioItemsByExpenseId,
  omitPurchaseCmvCategoryAmounts,
} from "@/lib/dre/rateioBoletoByItems";
import type { BudgetBasis } from "./types";

export type ActualByCategoryResult = {
  byCategoryId: Map<string, number>;
  /** Payables no período sem company_category_id. */
  semCategoriaCount: number;
  semCategoriaTotal: number;
  /** CMV de vendas (revenue_entries) no mês — competência por entry_date. */
  salesCmv: number;
};

/** Categorias de despesa que entram no realizado do orçamento. */
export function isBudgetActualCategory(
  cat: CompanyCategory | undefined,
): cat is CompanyCategory {
  if (!cat || cat.natureza !== "DESPESA") return false;
  const bucket = mapCategoryToDreBucket(cat);
  return (
    bucket !== "EXCLUDE" &&
    bucket !== "UNMAPPED" &&
    bucket !== "VENDAS_BRUTAS" &&
    bucket !== "DEDUCAO_RECEITA" &&
    bucket !== "RESULTADO_FINANCEIRO_RECEITA"
  );
}

type BoletoRow = {
  amount: number;
  paid_amount: number | null;
  company_category_id: string | null;
  flow_type: string | null;
  entry_kind?: string | null;
  expense_id?: string | null;
};

/**
 * Realizado de despesas no período.
 * - Competência: due_date no mês (payable ou flow_type nulo)
 * - Caixa: paid_at no mês, status paid
 * Inclui CMV de vendas (só na base competência) para alinhar com o DRE.
 */
export async function fetchActualByCategory(
  companyId: string,
  period: MonthYear,
  basis: BudgetBasis,
  categoriesById: Map<string, CompanyCategory>,
): Promise<ActualByCategoryResult> {
  const { startYmd, endYmd } = getMonthYmdRange(period.month, period.year);

  let query = supabase
    .from("boletos")
    .select(
      "amount, paid_amount, company_category_id, flow_type, entry_kind, expense_id",
    )
    .eq("company_id", companyId)
    .or("flow_type.eq.payable,flow_type.is.null")
    .neq("entry_kind", "transfer");

  if (basis === "competencia") {
    query = query.gte("due_date", startYmd).lte("due_date", endYmd);
  } else {
    query = query
      .eq("status", "paid")
      .gte("paid_at", `${startYmd}T00:00:00`)
      .lte("paid_at", `${endYmd}T23:59:59.999`);
  }

  const salesCmvPromise =
    basis === "competencia"
      ? Promise.all([
          supabase
            .from("revenue_entries")
            .select("cmv_amount, product_id, entry_mode")
            .eq("company_id", companyId)
            .in("entry_mode", ["product_sale", "recipe_sale"])
            .gte("entry_date", startYmd)
            .lte("entry_date", endYmd),
          fetchExcludedFromSalesProductIds(companyId),
        ]).then(([revRes, excludedIds]) => ({
          ...revRes,
          excludedIds,
        }))
      : Promise.resolve({
          data: [] as {
            cmv_amount: number | null;
            product_id?: string | null;
            entry_mode?: string | null;
          }[],
          error: null,
          excludedIds: [] as string[],
        });

  const [bolRes, revRes] = await Promise.all([query, salesCmvPromise]);

  if (bolRes.error) throw bolRes.error;
  if (revRes.error) throw revRes.error;

  const byCategoryId = new Map<string, number>();
  let semCategoriaCount = 0;
  let semCategoriaTotal = 0;

  const boletos = (bolRes.data ?? []) as BoletoRow[];
  const items = await fetchExpenseItemsForRateio(
    companyId,
    boletos.map((b) => b.expense_id).filter((id): id is string => Boolean(id)),
  );
  const itemsByExpenseId = groupRateioItemsByExpenseId(items);

  for (const b of boletos) {
    // Exclui recebíveis explícitos (já filtrados no query, reforço)
    if (b.flow_type === "receivable") continue;

    const amount =
      basis === "caixa"
        ? Number(b.paid_amount ?? b.amount) || 0
        : Number(b.amount) || 0;
    if (!Number.isFinite(amount) || amount === 0) continue;

    const expenseId = b.expense_id?.trim() || null;
    const slices = omitPurchaseCmvCategoryAmounts(
      expandBoletoAmountByItemCategories(
        {
          amount,
          expense_id: expenseId,
          company_category_id: b.company_category_id,
        },
        expenseId ? (itemsByExpenseId.get(expenseId) ?? []) : [],
      ),
      categoriesById,
    );

    for (const slice of slices) {
      if (!slice.company_category_id) {
        semCategoriaCount += 1;
        semCategoriaTotal += Math.abs(slice.amount);
        continue;
      }
      const cat = categoriesById.get(slice.company_category_id);
      if (!isBudgetActualCategory(cat)) continue;
      byCategoryId.set(
        slice.company_category_id,
        (byCategoryId.get(slice.company_category_id) ?? 0) + slice.amount,
      );
    }
  }

  const salesCmv = sumRevenueCmvAppearingAsSale(
    (revRes.data ?? []) as Array<{
      cmv_amount?: number | null;
      product_id?: string | null;
      entry_mode?: string | null;
    }>,
    new Set(revRes.excludedIds ?? []),
  );

  return {
    byCategoryId,
    semCategoriaCount,
    semCategoriaTotal,
    salesCmv,
  };
}

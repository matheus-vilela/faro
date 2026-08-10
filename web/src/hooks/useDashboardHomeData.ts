import { useCallback, useEffect, useMemo, useState } from "react";
import { getMonthRange, type MonthYear } from "@/components/MonthSelector";
import { useCompany, useHasPermission, useIsOwnerAccess } from "@/contexts/CompanyContext";
import { localDateYmd } from "@/lib/boletoPayment";
import { syncCompanyAlerts } from "@/lib/companyAlerts/syncCompanyAlerts";
import {
  buildCmvMargensDashboard,
  type ProductCmvMeta,
} from "@/lib/cmvMargensResumo";
import {
  buildHomeActionItems,
  buildHomeInsightText,
  type HomeActionItem,
  type WhatsappPendingExpense,
} from "@/lib/dashboardHomeActions";
import {
  fetchDashboardImportReviewEpocRecipesNoIngredients,
  fetchDashboardImportReviewPendingRevenueLink,
} from "@/lib/dashboardImportReview";
import {
  aggregateTotalsByCategory,
  buildDreComputedFromMaps,
} from "@/lib/dre/computeDre";
import { mapCategoryToDreBucket } from "@/lib/dre/dreMapping";
import { fetchPurchaseWithoutUtilCount } from "@/lib/onboardingProductRecipeMatch";
import { addDaysYmd, computePayableTotals } from "@/lib/payableTotals";
import {
  computePurchasesDashboardCounts,
  type PurchasesDashboardCounts,
} from "@/lib/productPurchasesDashboard";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import {
  buildVendasRealizadasResumo,
  getResumoRanges,
  normalizeWeekStartsOn,
  type EpocFaturamentoDayInput,
  type EpocPaymentLineInput,
  type ResumoDashboard,
} from "@/lib/vendasRealizadasResumo";
import type { CompanyCategory } from "@/types/category";
import type { CompanyAlertRow } from "@/types/companyAlert";
import type { Expense } from "@/types/expense";
import { isBoletoPayable, isBoletoTransfer } from "@/types/expense";
import type { Product } from "@/types/product";
import type { RevenueEntry } from "@/types/revenue";
import type { DashboardHomePeriod } from "@/hooks/useDashboardHomePeriod";

export type UpcomingPayableRow = {
  id: string;
  description: string | null;
  due_date: string;
  amount: number;
};

function normalizeEpocPaymentRows(rows: unknown[]): EpocPaymentLineInput[] {
  return rows.map((raw) => {
    const row = raw as {
      faturamento_date: string;
      amount: number | null;
      payment_method_id: string;
      payment_methods:
        | {
            sku: string;
            name: string;
            include_in_net_sales?: boolean | null;
          }
        | {
            sku: string;
            name: string;
            include_in_net_sales?: boolean | null;
          }[]
        | null;
    };
    const pm = Array.isArray(row.payment_methods)
      ? (row.payment_methods[0] ?? null)
      : (row.payment_methods ?? null);
    return {
      faturamento_date: row.faturamento_date,
      amount: row.amount,
      payment_method_id: row.payment_method_id,
      payment_methods: pm
        ? {
            sku: pm.sku,
            name: pm.name,
            include_in_net_sales: pm.include_in_net_sales !== false,
          }
        : null,
    };
  });
}

function expenseAmount(
  items: Pick<Expense, "expense_items">["expense_items"],
): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, it) => {
    const q = Number(it?.quantity) || 0;
    const u = Number(it?.unit_value) || 0;
    return sum + q * u;
  }, 0);
}

export function useDashboardHomeData(period: DashboardHomePeriod) {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;
  const canSeeAlerts = useHasPermission("alertas");
  const isOwner = useIsOwnerAccess();

  const [loading, setLoading] = useState(true);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [sales, setSales] = useState<ResumoDashboard | null>(null);
  const [marginPct, setMarginPct] = useState<number | null>(null);
  const [cmvPct, setCmvPct] = useState<number | null>(null);
  const [dueIn7Amount, setDueIn7Amount] = useState(0);
  const [dueIn7Count, setDueIn7Count] = useState(0);
  const [upcoming, setUpcoming] = useState<UpcomingPayableRow[]>([]);
  const [lucroMes, setLucroMes] = useState<number | null>(null);
  const [actions, setActions] = useState<HomeActionItem[]>([]);
  const [purchases, setPurchases] = useState<PurchasesDashboardCounts>({
    criticalStock: 0,
    withoutPrice: 0,
    withoutMinStock: 0,
    stalePrice: 0,
  });

  const todayYmd = localDateYmd();
  const weekStartsOn = normalizeWeekStartsOn(
    currentCompany?.accounting_week_starts_on,
  );

  const periodWord = useMemo(() => {
    if (period === "today") return "hoje";
    if (period === "month") return "no mês";
    return "na semana";
  }, [period]);

  const periodLabelShort = useMemo(() => {
    if (period === "today") return "de hoje";
    if (period === "month") return "do mês";
    return "da semana";
  }, [period]);

  const loadSalesAndKpis = useCallback(async () => {
    if (!companyId) {
      setSales(null);
      setMarginPct(null);
      setCmvPct(null);
      setDueIn7Amount(0);
      setDueIn7Count(0);
      setUpcoming([]);
      setLucroMes(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const ranges = getResumoRanges(period, todayYmd, null, { weekStartsOn });
      const now = new Date();
      const monthPeriod: MonthYear = {
        month: now.getMonth() + 1,
        year: now.getFullYear(),
      };
      const monthRange = getMonthRange(monthPeriod.month, monthPeriod.year);
      const monthStart = monthRange.start.slice(0, 10);
      const monthEnd = monthRange.end.slice(0, 10);
      const sevenEnd = addDaysYmd(todayYmd, 6);
      const payablesStart = addDaysYmd(todayYmd, -1);

      const [
        revenueRows,
        epocPaymentRows,
        epocFatRows,
        catRows,
        boletosRows,
        dreBoletosRes,
        dreCmvRes,
      ] = await Promise.all([
        fetchAllInRange<RevenueEntry>(
          supabase
            .from("revenue_entries")
            .select("*")
            .eq("company_id", companyId)
            .gte("entry_date", ranges.fetchStart)
            .lte("entry_date", ranges.fetchEnd)
            .order("entry_date", { ascending: true }),
        ),
        fetchAllInRange(
          supabase
            .from("epoc_faturamento_daily_payment_methods")
            .select(
              "faturamento_date, amount, payment_method_id, payment_methods ( sku, name, include_in_net_sales )",
            )
            .eq("company_id", companyId)
            .gte("faturamento_date", ranges.fetchStart)
            .lte("faturamento_date", ranges.fetchEnd)
            .order("faturamento_date", { ascending: true }),
        ).then((rows) => normalizeEpocPaymentRows(rows)),
        fetchAllInRange(
          supabase
            .from("epoc_faturamento_daily")
            .select(
              "faturamento_date, quantity, produtos, servicos, taxas, total, ticket_medio",
            )
            .eq("company_id", companyId)
            .gte("faturamento_date", ranges.fetchStart)
            .lte("faturamento_date", ranges.fetchEnd)
            .order("faturamento_date", { ascending: true }),
        ).then((rows) => rows as unknown as EpocFaturamentoDayInput[]),
        supabase
          .from("company_categories")
          .select("*")
          .eq("company_id", companyId)
          .then(({ data, error }) => {
            if (error) throw error;
            return (data as CompanyCategory[]) ?? [];
          }),
        supabase
          .from("boletos")
          .select("id, description, due_date, amount, status, is_projected")
          .eq("company_id", companyId)
          .eq("flow_type", "payable")
          .eq("exclude_from_fluxo", false)
          .neq("entry_kind", "transfer")
          .gte("due_date", payablesStart)
          .lte("due_date", sevenEnd)
          .order("due_date", { ascending: true })
          .order("amount", { ascending: false }),
        supabase
          .from("boletos")
          .select(
            "id, description, amount, due_date, flow_type, company_category_id, status, revenue_entry_id, expense_id, category, entry_kind",
          )
          .eq("company_id", companyId)
          .eq("exclude_from_fluxo", false)
          .gte("due_date", monthStart)
          .lte("due_date", monthEnd),
        supabase
          .from("revenue_entries")
          .select("cmv_amount")
          .eq("company_id", companyId)
          .in("entry_mode", ["product_sale", "recipe_sale"])
          .gte("entry_date", monthStart)
          .lte("entry_date", monthEnd),
      ]);

      const productIds = [
        ...new Set(
          revenueRows
            .map((r) => r.product_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const recipeIds = [
        ...new Set(
          revenueRows
            .map((r) => r.recipe_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      const cmvProductIds = new Set<string>(productIds);
      for (const row of revenueRows) {
        const lines = Array.isArray(row.cmv_lines) ? row.cmv_lines : [];
        for (const line of lines) {
          if (line && typeof line === "object" && "product_id" in line) {
            const id = String(
              (line as { product_id: unknown }).product_id ?? "",
            );
            if (id) cmvProductIds.add(id);
          }
        }
      }

      const [productsRes, recipesRes] = await Promise.all([
        cmvProductIds.size
          ? supabase
              .from("products")
              .select("id, name, composes_cmv, average_cost")
              .in("id", [...cmvProductIds])
          : Promise.resolve({ data: [], error: null }),
        recipeIds.length
          ? supabase.from("recipes").select("id, name").in("id", recipeIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (recipesRes.error) throw recipesRes.error;

      const productNameById = new Map<string, string>();
      const productMetaById = new Map<string, ProductCmvMeta>();
      for (const p of (productsRes.data ?? []) as Array<{
        id: string;
        name: string;
        composes_cmv: boolean | null;
        average_cost: number | null;
      }>) {
        productNameById.set(p.id, p.name);
        productMetaById.set(p.id, {
          composes_cmv: p.composes_cmv !== false,
          average_cost: p.average_cost,
        });
      }
      const recipeNameById = new Map(
        ((recipesRes.data as { id: string; name: string }[]) ?? []).map(
          (r) => [r.id, r.name] as const,
        ),
      );
      const categoriesById = new Map(catRows.map((c) => [c.id, c]));

      const resumo = buildVendasRealizadasResumo({
        entries: revenueRows,
        period,
        todayYmd,
        rankingMode: "product",
        categoriesById,
        productNameById,
        recipeNameById,
        epocPayments: epocPaymentRows,
        epocFaturamentoDays: epocFatRows,
        weekStartsOn,
      });
      setSales(resumo);

      const cmvDash = buildCmvMargensDashboard({
        entries: revenueRows,
        period,
        todayYmd,
        sort: "pior",
        productNameById,
        recipeNameById,
        productMetaById,
        weekStartsOn,
      });
      setMarginPct(cmvDash.kpis.marginPct);
      setCmvPct(cmvDash.kpis.cmvPct);

      const boletos = (boletosRows.data ?? []) as Array<{
        id: string;
        description: string | null;
        due_date: string;
        amount: number;
        status: string;
        is_projected?: boolean | null;
      }>;
      const totals = computePayableTotals(boletos, monthPeriod, todayYmd);
      setDueIn7Amount(totals.dueInNext7Days.amount);
      setDueIn7Count(totals.dueInNext7Days.count);
      setUpcoming(
        boletos
          .filter((b) => {
            const due = String(b.due_date ?? "").slice(0, 10);
            return (
              b.status === "pending" &&
              due >= todayYmd &&
              due <= sevenEnd
            );
          })
          .slice(0, 6)
          .map((b) => ({
            id: b.id,
            description: b.description,
            due_date: String(b.due_date).slice(0, 10),
            amount: Number(b.amount) || 0,
          })),
      );

      const dreBoletosRaw = (dreBoletosRes.data ?? []) as Array<{
        amount: number;
        company_category_id: string | null;
        flow_type: string | null;
        entry_kind: string | null;
        revenue_entry_id: string | null;
      }>;
      const dreBoletos = dreBoletosRaw.filter((b) => {
        if (isBoletoTransfer(b)) return false;
        if (!b.revenue_entry_id || !isBoletoPayable(b)) return true;
        const cat = b.company_category_id
          ? categoriesById.get(b.company_category_id)
          : undefined;
        return cat ? mapCategoryToDreBucket(cat) !== "CMV" : true;
      });
      const salesCmv = (dreCmvRes.data ?? []).reduce(
        (s, r) =>
          s +
          Math.max(
            0,
            Number((r as { cmv_amount?: number }).cmv_amount) || 0,
          ),
        0,
      );
      const categoryTotals = aggregateTotalsByCategory(
        dreBoletos.map((b) => ({
          amount: Number(b.amount) || 0,
          company_category_id: b.company_category_id ?? null,
        })),
        categoriesById,
      );
      const computed = buildDreComputedFromMaps(
        categoryTotals.byCategoryId,
        categoriesById,
        salesCmv,
      );
      setLucroMes(computed.lucroLiquido);
    } catch (e) {
      console.error(e);
      setSales(null);
      setMarginPct(null);
      setCmvPct(null);
      setDueIn7Amount(0);
      setDueIn7Count(0);
      setUpcoming([]);
      setLucroMes(null);
    }
    setLoading(false);
  }, [companyId, period, todayYmd, weekStartsOn]);

  const loadActions = useCallback(async () => {
    if (!companyId) {
      setActions([]);
      setPurchases({
        criticalStock: 0,
        withoutPrice: 0,
        withoutMinStock: 0,
        stalePrice: 0,
      });
      setActionsLoading(false);
      return;
    }

    setActionsLoading(true);
    try {
      void syncCompanyAlerts(companyId).catch((err) =>
        console.warn("[DashboardHome] syncCompanyAlerts:", err),
      );

      const todayStr = todayYmd;
      const tomorrowStr = addDaysYmd(todayYmd, 1);

      const [
        productsRows,
        withoutUtil,
        step1,
        step2,
        whatsappRes,
        boletosRes,
        alertsRes,
      ] = await Promise.all([
        fetchAllInRange<
          Pick<
            Product,
            | "min_quantity"
            | "current_quantity"
            | "last_unit_value"
            | "last_unit_value_stock"
            | "average_cost"
            | "updated_at"
          >
        >(
          supabase
            .from("products")
            .select(
              "min_quantity, current_quantity, last_unit_value, last_unit_value_stock, average_cost, updated_at",
            )
            .eq("company_id", companyId)
            .eq("listed_in_product_catalog", true)
            .or("is_active.is.null,is_active.eq.true"),
        ),
        fetchPurchaseWithoutUtilCount(supabase, companyId),
        canSeeAlerts
          ? fetchDashboardImportReviewEpocRecipesNoIngredients(
              supabase,
              companyId,
            )
          : Promise.resolve({ rows: [], error: null }),
        canSeeAlerts
          ? fetchDashboardImportReviewPendingRevenueLink(supabase, companyId)
          : Promise.resolve({ rows: [], error: null }),
        isOwner
          ? supabase
              .from("expenses")
              .select(
                "id, supplier_name, created_at, expense_items (quantity, unit_value)",
              )
              .eq("company_id", companyId)
              .eq("expense_source", "whatsapp")
              .eq("status", "pending")
              .order("created_at", { ascending: false })
              .limit(8)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("boletos")
          .select("id, due_date, amount, status")
          .eq("company_id", companyId)
          .eq("flow_type", "payable")
          .eq("exclude_from_fluxo", false)
          .neq("entry_kind", "transfer")
          .in("due_date", [todayStr, tomorrowStr])
          .eq("status", "pending"),
        canSeeAlerts
          ? supabase
              .from("company_alerts")
              .select("id, kind, severity, title, message, link_path")
              .eq("company_id", companyId)
              .eq("status", "open")
              .order("updated_at", { ascending: false })
              .limit(20)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const purchaseCounts = computePurchasesDashboardCounts(productsRows);
      setPurchases(purchaseCounts);

      const fichas =
        (step1.error ? 0 : step1.rows.length) +
        (step2.error ? 0 : step2.rows.length);

      const whatsappPending: WhatsappPendingExpense[] = (
        (whatsappRes.data ?? []) as Pick<
          Expense,
          "id" | "supplier_name" | "expense_items"
        >[]
      ).map((e) => ({
        id: e.id,
        supplier_name: e.supplier_name,
        amount: expenseAmount(e.expense_items),
      }));

      const boletosList = (boletosRes.data ?? []) as Array<{
        due_date: string;
        amount: number;
      }>;
      let payablesTodayCount = 0;
      let payablesTodayAmount = 0;
      let payablesTomorrowCount = 0;
      let payablesTomorrowAmount = 0;
      for (const b of boletosList) {
        const due = String(b.due_date).slice(0, 10);
        const amount = Number(b.amount) || 0;
        if (due === todayStr) {
          payablesTodayCount += 1;
          payablesTodayAmount += amount;
        } else if (due === tomorrowStr) {
          payablesTomorrowCount += 1;
          payablesTomorrowAmount += amount;
        }
      }

      setActions(
        buildHomeActionItems({
          canSeeAlerts,
          isOwner,
          whatsappPending,
          payablesTodayCount,
          payablesTodayAmount,
          payablesTomorrowCount,
          payablesTomorrowAmount,
          fichasPendentesCount: fichas,
          withoutUtilCount: withoutUtil.error ? 0 : withoutUtil.count,
          purchases: purchaseCounts,
          openAlerts: (alertsRes.data ?? []) as Pick<
            CompanyAlertRow,
            "id" | "kind" | "severity" | "title" | "message" | "link_path"
          >[],
        }),
      );
    } catch (e) {
      console.error(e);
      setActions([]);
    }
    setActionsLoading(false);
  }, [canSeeAlerts, companyId, isOwner, todayYmd]);

  useEffect(() => {
    queueMicrotask(() => void loadSalesAndKpis());
  }, [loadSalesAndKpis]);

  useEffect(() => {
    queueMicrotask(() => void loadActions());
  }, [loadActions]);

  const insight = useMemo(() => {
    const fat = sales?.kpis.net.current ?? 0;
    const delta = sales?.kpis.net.pctChange ?? null;
    if (actionsLoading) {
      return buildHomeInsightText({
        periodLabel: periodLabelShort,
        faturamento: fat,
        faturamentoDeltaPct: delta,
        actionCount: -1,
      });
    }
    return buildHomeInsightText({
      periodLabel: periodLabelShort,
      faturamento: fat,
      faturamentoDeltaPct: delta,
      actionCount: actions.length,
    });
  }, [actions.length, actionsLoading, periodLabelShort, sales]);

  return {
    loading,
    actionsLoading,
    sales,
    marginPct,
    cmvPct,
    dueIn7Amount,
    dueIn7Count,
    upcoming,
    lucroMes,
    actions,
    purchases,
    insight,
    periodWord,
    periodLabelShort,
    reloadActions: loadActions,
    reloadAll: async () => {
      await Promise.all([loadSalesAndKpis(), loadActions()]);
    },
  };
}

import {
  BoletosCalendar,
  type BoletosCalendarViewMode,
  type CalendarDayListPayload,
} from "@/components/BoletosCalendar";
import { CreateBoletoSheet } from "@/components/CreateBoletoSheet";
import { ExpenseDetailSheet } from "@/components/expenses/ExpenseDetailSheet";
import { SeriesBoletoActionsSheet } from "@/components/fluxo/SeriesBoletoActionsSheet";
import { PayBoletoDialog } from "@/components/fluxo/PayBoletoDialog";
import { PayableTotalsCards } from "@/components/fluxo/PayableTotalsCards";
import { getMonthRange, type MonthYear } from "@/components/MonthSelector";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { ReferencePeriodCard } from "@/components/ReferencePeriodCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCompany } from "@/contexts/CompanyContext";
import { useDebounce } from "@/hooks/useDebounce";
import { formatCompetenceLabel, localDateYmd } from "@/lib/boletoPayment";
import { formatBoletoCategoryLabel } from "@/lib/boletoCategory";
import { boletoVisibleInFluxo } from "@/lib/boletoFluxo";
import { formatBoletoFluxoDescription } from "@/lib/boletoFluxoDescription";
import { getCalendarGridDateRange } from "@/lib/boletosCalendarGrid";
import { syncCompanyAlerts } from "@/lib/companyAlerts/syncCompanyAlerts";
import { fetchPayableReceiptContext } from "@/lib/fetchPayableReceiptContext";
import {
  EMPTY_PAYABLE_RECEIPT_CONTEXT,
  isBoletoPendingMerchandiseReceipt,
  isBoletoReadyToPay,
  isScheduledPayableBoleto,
  sumPayableBuckets,
  type PayableReceiptContext,
} from "@/lib/payableBoletoReceipt";
import {
  fetchMergedPayableBoletosInRange,
  fetchSeriesMastersWithAnchorBoletos,
  suppressProjectedMonth,
} from "@/lib/expenseSeriesApi";
import {
  filterBoletosBySearch,
  isProjectedBoleto,
} from "@/lib/expenseSeriesProjection";
import {
  computePayableTotals,
  EMPTY_PAYABLE_TOTALS,
  formatPayableMonthName,
  getPayableTotalsFetchRange,
  type PayableTotals,
} from "@/lib/payableTotals";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import { cn } from "@/lib/utils";
import type { CompanyBankAccount } from "@/types/bankAccount";
import type { CompanyCategory } from "@/types/category";
import type { Boleto, BoletoFlowType, PaymentType } from "@/types/expense";
import { isBoletoPayable } from "@/types/expense";
import type {
  ExpenseSeriesMaster,
  FluxoBoletoRow,
} from "@/types/expenseSeries";
import type { RevenueEntry } from "@/types/revenue";
import type { LucideIcon } from "lucide-react";
import { CheckCircle2, Copy, FileText, Loader2, PackageSearch, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { RevenueDetailSheet } from "../revenue/RevenueDetailSheet";
import {
  type RevenueCalendarDayListPayload,
  RevenueEntriesCalendar,
} from "../revenue/RevenueEntriesCalendar";

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  boleto: "Boleto",
  pix: "PIX",
  ted: "TED",
};

const STATUS_LABELS = { pending: "Pendente", paid: "Pago" };

function fluxoBoletoSupplierLabel(b: FluxoBoletoRow): string | null {
  return b.supplier?.name?.trim() || null;
}

export type FluxoBoletosPageConfig = {
  flowType: BoletoFlowType;
  title: string;
  description: string;
  icon: LucideIcon;
  periodDescription: string;
  listTitle: string;
  listDescription: string;
  searchPlaceholder: string;
  emptyListMessage: string;
  addButtonLabel: string;
  calendarViewMode: BoletosCalendarViewMode;
};

export function FluxoBoletosPage({
  config,
}: {
  config: FluxoBoletosPageConfig;
}) {
  const {
    flowType,
    title,
    description,
    icon: PageIcon,
    periodDescription,
    listTitle,
    listDescription,
    searchPlaceholder,
    emptyListMessage,
    addButtonLabel,
    calendarViewMode,
  } = config;
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const expenseIdFromUrl = searchParams.get("expense");

  const now = new Date();
  const [period, setPeriod] = useState<MonthYear>({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });
  const [calendarBoletos, setCalendarBoletos] = useState<FluxoBoletoRow[]>([]);
  const [calendarRevenueEntries, setCalendarRevenueEntries] = useState<
    RevenueEntry[]
  >([]);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const isReceivableFlow = flowType === "receivable";

  const [boletosList, setBoletosList] = useState<FluxoBoletoRow[]>([]);
  const [boletosListCount, setBoletosListCount] = useState(0);
  const [seriesMasters, setSeriesMasters] = useState<ExpenseSeriesMaster[]>([]);
  const [seriesEditOpen, setSeriesEditOpen] = useState(false);
  const [seriesEditBoleto, setSeriesEditBoleto] =
    useState<FluxoBoletoRow | null>(null);
  const [boletosPage, setBoletosPage] = useState(1);
  const [boletosSearch, setBoletosSearch] = useState("");
  const debouncedSearch = useDebounce(boletosSearch, 300);
  const [loadingList, setLoadingList] = useState(true);

  const [boletoSheetOpen, setBoletoSheetOpen] = useState(false);
  const [createBoletoDefaultDueDate, setCreateBoletoDefaultDueDate] = useState<
    string | undefined
  >(undefined);
  const [calendarDayList, setCalendarDayList] =
    useState<CalendarDayListPayload | null>(null);
  const [revenueCalendarDayList, setRevenueCalendarDayList] =
    useState<RevenueCalendarDayListPayload | null>(null);
  const [detailRevenueId, setDetailRevenueId] = useState<string | null>(null);
  const [boletoResumo, setBoletoResumo] = useState<FluxoBoletoRow | null>(null);
  const [expenseDetailId, setExpenseDetailId] = useState<string | null>(null);
  const [markPaidDialogOpen, setMarkPaidDialogOpen] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [deleteBoletoDialogOpen, setDeleteBoletoDialogOpen] = useState(false);
  const [deletingBoleto, setDeletingBoleto] = useState(false);
  const [companyCategories, setCompanyCategories] = useState<CompanyCategory[]>(
    [],
  );
  const [payableReceiptContext, setPayableReceiptContext] =
    useState<PayableReceiptContext>(EMPTY_PAYABLE_RECEIPT_CONTEXT);
  const [bankAccountsById, setBankAccountsById] = useState<
    Map<string, CompanyBankAccount>
  >(new Map());
  const [payableTotals, setPayableTotals] =
    useState<PayableTotals>(EMPTY_PAYABLE_TOTALS);
  const [totalsLoading, setTotalsLoading] = useState(false);

  const categoriesById = useMemo(
    () => new Map(companyCategories.map((c) => [c.id, c])),
    [companyCategories],
  );

  const boletoCategoryLabel = useCallback(
    (b: Boleto) => formatBoletoCategoryLabel(b, categoriesById),
    [categoriesById],
  );

  useEffect(() => {
    if (!companyId) {
      queueMicrotask(() => setCompanyCategories([]));
      return;
    }
    void supabase
      .from("company_categories")
      .select("*")
      .eq("company_id", companyId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .then(({ data }) => {
        setCompanyCategories((data as CompanyCategory[]) ?? []);
      });
  }, [companyId]);

  useEffect(() => {
    if (!companyId || flowType !== "payable") {
      queueMicrotask(() => setBankAccountsById(new Map()));
      return;
    }
    void supabase
      .from("company_bank_accounts")
      .select("*")
      .eq("company_id", companyId)
      .order("name", { ascending: true })
      .then(({ data }) => {
        const map = new Map<string, CompanyBankAccount>();
        for (const row of (data ?? []) as CompanyBankAccount[]) {
          map.set(row.id, row);
        }
        setBankAccountsById(map);
      });
  }, [companyId, flowType, boletosList]);

  const fetchCalendarBoletos = useCallback(async () => {
    if (!companyId || isReceivableFlow) return;
    setCalendarLoading(true);
    const { startIso, endIso } = getCalendarGridDateRange(
      period.month,
      period.year,
    );
    try {
      const merged = await fetchMergedPayableBoletosInRange(
        companyId,
        startIso,
        endIso,
      );
      setCalendarBoletos(
        merged.filter((b) => isProjectedBoleto(b) || boletoVisibleInFluxo(b)),
      );
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível carregar o calendário.");
      setCalendarBoletos([]);
    }
    setCalendarLoading(false);
  }, [companyId, period.month, period.year, flowType, isReceivableFlow]);

  const fetchCalendarRevenueEntries = useCallback(async () => {
    if (!companyId || !isReceivableFlow) return;
    setCalendarLoading(true);
    const { startIso, endIso } = getCalendarGridDateRange(
      period.month,
      period.year,
    );
    try {
      const data = await fetchAllInRange<RevenueEntry>(
        supabase
          .from("revenue_entries")
          .select("*")
          .eq("company_id", companyId)
          .gte("entry_date", startIso)
          .lte("entry_date", endIso)
          .order("entry_date", { ascending: true })
          .order("created_at", { ascending: true }),
      );
      setCalendarRevenueEntries(data);
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível carregar o calendário de vendas.");
      setCalendarRevenueEntries([]);
    }
    setCalendarLoading(false);
  }, [companyId, period.month, period.year, isReceivableFlow]);

  const fetchBoletosList = useCallback(async () => {
    if (!companyId) return;
    setLoadingList(true);
    const { start, end } = getMonthRange(period.month, period.year);
    const startYmd = start.slice(0, 10);
    const endYmd = end.slice(0, 10);
    try {
      if (flowType === "payable") {
        const merged = await fetchMergedPayableBoletosInRange(
          companyId,
          startYmd,
          endYmd,
        );
        const visible = merged.filter(
          (b) => isProjectedBoleto(b) || boletoVisibleInFluxo(b),
        );
        const filtered = filterBoletosBySearch(visible, debouncedSearch);
        setBoletosListCount(filtered.length);
        const pageStart = (boletosPage - 1) * PAGE_SIZE;
        setBoletosList(filtered.slice(pageStart, pageStart + PAGE_SIZE));
      } else {
        let query = supabase
          .from("boletos")
          .select("*", { count: "exact" })
          .eq("company_id", companyId)
          .eq("flow_type", flowType)
          .eq("exclude_from_fluxo", false)
          .gte("due_date", startYmd)
          .lte("due_date", endYmd)
          .order("due_date", { ascending: true });
        if (debouncedSearch.trim()) {
          const term = `%${debouncedSearch.trim()}%`;
          query = query.or(`description.ilike.${term},provider.ilike.${term}`);
        }
        const { data, count } = await query.range(
          (boletosPage - 1) * PAGE_SIZE,
          boletosPage * PAGE_SIZE - 1,
        );
        setBoletosList((data as FluxoBoletoRow[]) ?? []);
        setBoletosListCount(count ?? 0);
      }
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível carregar a lista.");
      setBoletosList([]);
      setBoletosListCount(0);
    }
    setLoadingList(false);
  }, [
    companyId,
    period.month,
    period.year,
    debouncedSearch,
    boletosPage,
    flowType,
  ]);

  const fetchPayableTotals = useCallback(async () => {
    if (!companyId || isReceivableFlow) {
      setPayableTotals(EMPTY_PAYABLE_TOTALS);
      setTotalsLoading(false);
      return;
    }
    setTotalsLoading(true);
    const todayYmd = localDateYmd();
    const { startYmd, endYmd } = getPayableTotalsFetchRange(period, todayYmd);
    try {
      const merged = await fetchMergedPayableBoletosInRange(
        companyId,
        startYmd,
        endYmd,
      );
      const visible = merged.filter(
        (b) => isProjectedBoleto(b) || boletoVisibleInFluxo(b),
      );
      setPayableTotals(computePayableTotals(visible, period, todayYmd));
    } catch (e) {
      console.error(e);
      setPayableTotals(EMPTY_PAYABLE_TOTALS);
    }
    setTotalsLoading(false);
  }, [companyId, period.month, period.year, isReceivableFlow]);

  useEffect(() => {
    if (!companyId || flowType !== "payable") {
      queueMicrotask(() => setSeriesMasters([]));
      return;
    }
    void fetchSeriesMastersWithAnchorBoletos(companyId)
      .then(setSeriesMasters)
      .catch(console.error);
  }, [companyId, flowType, boletosList, calendarBoletos]);

  useEffect(() => {
    queueMicrotask(() => setBoletosPage(1));
  }, [debouncedSearch, period.month, period.year]);

  useEffect(() => {
    queueMicrotask(() => {
      if (isReceivableFlow) void fetchCalendarRevenueEntries();
      else void fetchCalendarBoletos();
    });
  }, [fetchCalendarBoletos, fetchCalendarRevenueEntries, isReceivableFlow]);

  useEffect(() => {
    queueMicrotask(() => void fetchBoletosList());
  }, [fetchBoletosList]);

  useEffect(() => {
    queueMicrotask(() => void fetchPayableTotals());
  }, [fetchPayableTotals]);

  useEffect(() => {
    if (!companyId || flowType !== "payable") {
      queueMicrotask(() =>
        setPayableReceiptContext(EMPTY_PAYABLE_RECEIPT_CONTEXT),
      );
      return;
    }
    void fetchPayableReceiptContext(calendarBoletos)
      .then(setPayableReceiptContext)
      .catch((error) => {
        console.error(error);
        setPayableReceiptContext(EMPTY_PAYABLE_RECEIPT_CONTEXT);
      });
  }, [companyId, flowType, calendarBoletos]);

  const boletoReadyToPay = useCallback(
    (b: FluxoBoletoRow) => isBoletoReadyToPay(b, payableReceiptContext),
    [payableReceiptContext],
  );

  const boletoPendingMerchandiseReceipt = useCallback(
    (b: FluxoBoletoRow) =>
      isBoletoPendingMerchandiseReceipt(b, payableReceiptContext),
    [payableReceiptContext],
  );

  const listReadyToPay = useMemo(
    () => boletosList.filter((b) => boletoReadyToPay(b)),
    [boletosList, boletoReadyToPay],
  );

  const listPendingReceipt = useMemo(
    () => boletosList.filter((b) => boletoPendingMerchandiseReceipt(b)),
    [boletosList, boletoPendingMerchandiseReceipt],
  );

  const listOther = useMemo(
    () =>
      boletosList.filter(
        (b) => !boletoReadyToPay(b) && !boletoPendingMerchandiseReceipt(b),
      ),
    [boletosList, boletoReadyToPay, boletoPendingMerchandiseReceipt],
  );

  useEffect(() => {
    if (expenseIdFromUrl) queueMicrotask(() => setBoletoSheetOpen(true));
  }, [expenseIdFromUrl]);

  useEffect(() => {
    queueMicrotask(() => setMarkPaidDialogOpen(false));
  }, [boletoResumo?.id]);

  const refreshAll = useCallback(() => {
    if (isReceivableFlow) void fetchCalendarRevenueEntries();
    else void fetchCalendarBoletos();
    void fetchBoletosList();
    void fetchPayableTotals();
  }, [
    fetchCalendarBoletos,
    fetchCalendarRevenueEntries,
    fetchBoletosList,
    fetchPayableTotals,
    isReceivableFlow,
  ]);

  const refreshBoletoResumo = useCallback(async () => {
    if (!boletoResumo?.id || !companyId) return;
    const { data } = await supabase
      .from("boletos")
      .select("*")
      .eq("id", boletoResumo.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (data) setBoletoResumo(data as FluxoBoletoRow);
  }, [boletoResumo?.id, companyId]);

  const closeExpenseDetail = useCallback(() => {
    setExpenseDetailId(null);
    void refreshBoletoResumo();
    refreshAll();
  }, [refreshAll, refreshBoletoResumo]);

  const formatDate = (s: string) => {
    const raw = String(s ?? "").trim();
    if (!raw) return "—";
    const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const d = ymd
      ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12, 0, 0)
      : new Date(raw.includes("T") ? raw : `${raw}T12:00:00`);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  const handlePayBoletoSuccess = useCallback(
    (updated: Boleto) => {
      const merged: FluxoBoletoRow = {
        ...updated,
        supplier: boletoResumo?.supplier,
      };
      setBoletoResumo(merged);
      setCalendarDayList((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((b) =>
            b.id === merged.id ? { ...b, ...merged } : b,
          ),
        };
      });
      setMarkPaidDialogOpen(false);
      refreshAll();
      if (companyId) void syncCompanyAlerts(companyId);
    },
    [boletoResumo?.supplier, companyId, refreshAll],
  );

  const confirmMarkReceivableAsPaid = useCallback(async () => {
    if (!boletoResumo || !companyId) return;
    if (isProjectedBoleto(boletoResumo)) {
      toast.error(
        "Esta ocorrência ainda é projetada. Edite e materialize antes de marcar como paga.",
      );
      return;
    }
    setMarkingPaid(true);
    const { data, error } = await supabase
      .from("boletos")
      .update({
        status: "paid",
        updated_at: new Date().toISOString(),
      })
      .eq("id", boletoResumo.id)
      .eq("company_id", companyId)
      .select()
      .single();
    setMarkingPaid(false);
    if (error) {
      toast.error(error.message ?? "Não foi possível atualizar o status.");
      return;
    }
    const updated = data as FluxoBoletoRow;
    setBoletoResumo(updated);
    setCalendarDayList((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((b) =>
          b.id === updated.id ? { ...b, ...updated } : b,
        ),
      };
    });
    setMarkPaidDialogOpen(false);
    refreshAll();
    toast.success("Conta marcada como recebida.");
  }, [boletoResumo, companyId, refreshAll]);

  const canDeleteBoletoResumo =
    !!boletoResumo &&
    (isProjectedBoleto(boletoResumo) || boletoResumo.status === "pending");

  const boletoDeleteDescription = useMemo(() => {
    if (!boletoResumo) return "";
    if (isProjectedBoleto(boletoResumo)) {
      return "Esta ocorrência projetada deixará de aparecer no calendário. A série continua ativa.";
    }
    if (boletoResumo.revenue_entry_id) {
      return "A venda vinculada e os boletos a receber associados serão excluídos.";
    }
    if (boletoResumo.expense_id) {
      return "A conta será removida do fluxo. Se houver nota fiscal vinculada, ela permanece em Notas Fiscais.";
    }
    return "Esta conta será excluída permanentemente.";
  }, [boletoResumo]);

  const confirmDeleteBoleto = useCallback(async () => {
    if (!boletoResumo || !companyId) return;
    const projected = isProjectedBoleto(boletoResumo);
    setDeletingBoleto(true);
    try {
      if (projected) {
        const masterId = boletoResumo.series_master_expense_id;
        if (!masterId) {
          toast.error("Série não encontrada.");
          return;
        }
        await suppressProjectedMonth(
          masterId,
          boletoResumo.due_date.slice(0, 7),
        );
      } else if (boletoResumo.revenue_entry_id) {
        const { error } = await supabase.rpc("delete_revenue_entry", {
          p_entry_id: boletoResumo.revenue_entry_id,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("boletos")
          .delete()
          .eq("id", boletoResumo.id)
          .eq("company_id", companyId);
        if (error) throw error;
      }
      setDeleteBoletoDialogOpen(false);
      setBoletoResumo(null);
      setCalendarDayList((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.filter((b) => b.id !== boletoResumo.id),
        };
      });
      refreshAll();
      void syncCompanyAlerts(companyId);
      toast.success(
        projected ? "Ocorrência removida da projeção." : "Conta excluída.",
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível excluir a conta.",
      );
    } finally {
      setDeletingBoleto(false);
    }
  }, [boletoResumo, companyId, refreshAll]);

  const resolveSeriesMaster = (
    b: FluxoBoletoRow,
  ): ExpenseSeriesMaster | null => {
    const masterId = b.series_master_expense_id ?? b.expense_id;
    if (!masterId) return null;
    return seriesMasters.find((m) => m.id === masterId) ?? null;
  };

  const renderListCard = (b: FluxoBoletoRow) => {
    const payable = isBoletoPayable(b);
    const projected = isProjectedBoleto(b);
    const pendingReceipt =
      flowType === "payable" && boletoPendingMerchandiseReceipt(b);
    const statusLabel = projected
      ? "Projetada"
      : b.status === "pending"
        ? pendingReceipt
          ? "Aguardando recebimento"
          : "Pendente"
        : payable
          ? "Pago"
          : "Recebido";
    return (
      <div
        key={b.id}
        role="button"
        tabIndex={0}
        onClick={() => setBoletoResumo(b)}
        onKeyDown={(e) => e.key === "Enter" && setBoletoResumo(b)}
        className="flex flex-col gap-3 rounded-lg border p-4 cursor-pointer transition-colors hover:bg-muted/50 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium leading-snug">
              {formatBoletoFluxoDescription(b)}
            </p>
            <span
              className={cn(
                "text-xs font-semibold rounded-full px-2.5 py-0.5",
                projected
                  ? "bg-sky-500/15 text-sky-800 dark:text-sky-200"
                  : pendingReceipt
                    ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
                    : b.status === "pending"
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      : payable
                        ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-sky-600/15 text-sky-700 dark:text-sky-300",
              )}
            >
              {statusLabel}
            </span>
            {pendingReceipt && (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-800 dark:text-amber-200"
              >
                <PackageSearch className="mr-1 h-3 w-3" />
                Mercadoria não recebida
              </Badge>
            )}
            {projected && (
              <Badge variant="outline" className="text-[10px]">
                Virtual
              </Badge>
            )}
            {!projected &&
              b.series_master_expense_id &&
              b.expense_id !== b.series_master_expense_id && (
                <Badge variant="secondary" className="text-[10px]">
                  Exceção
                </Badge>
              )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {payable && (
              <span className="inline-block text-xs font-medium text-muted-foreground rounded-md bg-muted px-2 py-0.5">
                {PAYMENT_TYPE_LABELS[b.payment_type ?? "boleto"]}
              </span>
            )}
            <span className="inline-block text-xs font-medium text-primary rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5">
              {boletoCategoryLabel(b)}
            </span>
          </div>
          {fluxoBoletoSupplierLabel(b) ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {fluxoBoletoSupplierLabel(b)}
            </p>
          ) : null}
          {b.provider ? (
            <p className="mt-2 text-sm text-muted-foreground">{b.provider}</p>
          ) : null}
          {pendingReceipt && (
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
              Vinculada a NF ou romaneio sem recebimento confirmado. Confirme a
              mercadoria em Recebimento antes de pagar.
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-row items-end justify-between border-t border-border pt-3 sm:flex-col sm:items-end sm:justify-start sm:border-t-0 sm:pt-0 sm:text-right">
          <div className="flex  items-center justify-end gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Vencimento:
            </p>
            <p className="mt-0.5 text-sm font-medium tabular-nums text-foreground">
              {formatDate(b.due_date)}
            </p>
          </div>
          <p
            className={cn(
              "text-md font-bold tabular-nums sm:text-lg",
              payable
                ? "text-destructive"
                : "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {formatCurrency(b.amount)}
          </p>
        </div>
      </div>
    );
  };

  const renderCalendarDayCompactCard = (b: FluxoBoletoRow) => {
    const payable = isBoletoPayable(b);
    const pendingReceipt =
      flowType === "payable" && boletoPendingMerchandiseReceipt(b);
    const statusLabel =
      b.status === "pending"
        ? pendingReceipt
          ? "Aguardando recebimento"
          : "Pendente"
        : payable
          ? "Pago"
          : "Recebido";

    return (
      <button
        key={b.id}
        type="button"
        onClick={() => setBoletoResumo(b)}
        className={cn(
          "w-full rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
          pendingReceipt
            ? "border-amber-500/35 bg-amber-500/[0.06] dark:border-amber-500/40"
            : payable
              ? "border-destructive/30 dark:border-destructive/35"
              : "border-emerald-600/30 dark:border-emerald-500/35",
          "flex flex-col gap-1.5 sm:gap-2",
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-1.5 no-wrap">
            {b.provider ? (
              <p className="text-sm font-medium leading-snug flex-1">
                {b.provider}
              </p>
            ) : null}

            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                pendingReceipt
                  ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
                  : b.status === "pending"
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : payable
                      ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300"
                      : "bg-sky-600/15 text-sky-700 dark:text-sky-300",
              )}
            >
              {statusLabel}
            </span>
          </div>
          <p className="mt-1.5 truncate text-xs text-muted-foreground">
            {formatBoletoFluxoDescription(b)}
          </p>
          {fluxoBoletoSupplierLabel(b) ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {fluxoBoletoSupplierLabel(b)}
            </p>
          ) : null}
          {pendingReceipt && (
            <p className="mt-1.5 text-[11px] leading-snug text-amber-800 dark:text-amber-200">
              NF ou romaneio sem recebimento da mercadoria confirmado.
            </p>
          )}
        </div>
        <div className="flex items-end justify-between border-t border-border/70 pt-1.5">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="uppercase tracking-wide">Venc.:</span>
            <span className="font-medium text-foreground">
              {formatDate(b.due_date)}
            </span>
          </div>
          <p
            className={cn(
              "text-base font-bold tabular-nums",
              pendingReceipt
                ? "text-amber-700 dark:text-amber-300"
                : payable
                  ? "text-destructive"
                  : "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {formatCurrency(b.amount)}
          </p>
        </div>
      </button>
    );
  };

  const calendarDayItems = (calendarDayList?.items ?? []) as FluxoBoletoRow[];

  const calendarDayBuckets = useMemo(() => {
    const items = (calendarDayList?.items ?? []) as FluxoBoletoRow[];
    if (flowType !== "payable") {
      return {
        ready: [] as FluxoBoletoRow[],
        pending: [] as FluxoBoletoRow[],
        other: items,
        totals: { readyToPay: 0, pendingReceipt: 0 },
      };
    }
    const ready = items.filter((b) => boletoReadyToPay(b));
    const pending = items.filter((b) =>
      boletoPendingMerchandiseReceipt(b),
    );
    const other = items.filter(
      (b) => !boletoReadyToPay(b) && !boletoPendingMerchandiseReceipt(b),
    );
    const totals = sumPayableBuckets(items, payableReceiptContext);
    return { ready, pending, other, totals };
  }, [
    calendarDayList,
    flowType,
    boletoReadyToPay,
    boletoPendingMerchandiseReceipt,
    payableReceiptContext,
  ]);

  const revenueCalendarDayItems = revenueCalendarDayList?.items ?? [];

  const renderRevenueCalendarDayCompactCard = (e: RevenueEntry) => (
    <button
      key={e.id}
      type="button"
      onClick={() => {
        setRevenueCalendarDayList(null);
        setDetailRevenueId(e.id);
      }}
      className="flex w-full flex-col gap-1.5 rounded-lg border border-emerald-600/30 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 dark:border-emerald-500/35"
    >
      <p className="text-sm font-medium leading-snug">{e.title}</p>
      <div className="flex items-end justify-between border-t border-border/70 pt-1.5">
        <span className="text-xs text-muted-foreground">
          {formatDate(e.entry_date)}
        </span>
        <p className="text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
          {formatCurrency(Number(e.net_amount))}
        </p>
      </div>
    </button>
  );

  return (
    <PageShell>
      <PageHeader
        title={title}
        description={description}
        icon={PageIcon}
        action={
          <Button
            onClick={() => {
              setCreateBoletoDefaultDueDate(undefined);
              setBoletoSheetOpen(true);
            }}
            className="h-10 w-full shrink-0 sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            {addButtonLabel}
          </Button>
        }
      />

      <ReferencePeriodCard
        value={period}
        onChange={setPeriod}
        description={periodDescription}
      />

      {!isReceivableFlow && (
        <PayableTotalsCards
          totals={payableTotals}
          loading={totalsLoading}
          monthName={formatPayableMonthName(period.month, period.year)}
          formatCurrency={formatCurrency}
        />
      )}

      {currentCompany?.id && (
        <CreateBoletoSheet
          open={boletoSheetOpen}
          onOpenChange={(open) => {
            setBoletoSheetOpen(open);
            if (!open) setCreateBoletoDefaultDueDate(undefined);
            if (!open && expenseIdFromUrl) navigate("/app/despesas");
          }}
          companyId={currentCompany.id}
          expenseId={expenseIdFromUrl}
          defaultDueDate={createBoletoDefaultDueDate}
          fixedAccountFlow={flowType}
          onSuccess={() => {
            refreshAll();
            void syncCompanyAlerts(currentCompany.id);
            if (expenseIdFromUrl) navigate("/app/despesas");
          }}
        />
      )}
      {isReceivableFlow ? (
        <RevenueEntriesCalendar
          month={period.month}
          year={period.year}
          entries={calendarRevenueEntries}
          loading={calendarLoading}
          onDayListOpen={setRevenueCalendarDayList}
          formatCurrency={formatCurrency}
        />
      ) : (
        <BoletosCalendar
          month={period.month}
          year={period.year}
          boletos={calendarBoletos}
          loading={calendarLoading}
          viewMode={calendarViewMode}
          onDayListOpen={setCalendarDayList}
          formatCurrency={formatCurrency}
          isPayableReadyToPay={
            flowType === "payable" ? boletoReadyToPay : undefined
          }
          onlyScheduledPayables={
            flowType === "payable" ? isScheduledPayableBoleto : undefined
          }
        />
      )}

      <Card>
        <CardHeader className="flex flex-col gap-5 space-y-0">
          <div>
            <CardTitle>{listTitle}</CardTitle>
            <CardDescription>{listDescription}</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <div className="mb-4 flex flex-wrap gap-3 items-center">
            <Input
              placeholder={searchPlaceholder}
              value={boletosSearch}
              onChange={(e) => setBoletosSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>
          {loadingList ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : boletosList.length === 0 ? (
            <p className="text-muted-foreground">{emptyListMessage}</p>
          ) : (
            <div className="space-y-6">
              {flowType === "payable" && listReadyToPay.length > 0 && (
                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold">Valores a pagar</h3>
                    <p className="text-xs text-muted-foreground">
                      Contas agendadas liberadas para pagamento.
                    </p>
                  </div>
                  {listReadyToPay.map((b) => renderListCard(b))}
                </div>
              )}
              {flowType === "payable" && listPendingReceipt.length > 0 && (
                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                      Valores a confirmar
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      NF ou romaneio aguardando recebimento da mercadoria.
                    </p>
                  </div>
                  {listPendingReceipt.map((b) => renderListCard(b))}
                </div>
              )}
              {(flowType !== "payable" || listOther.length > 0) && (
                <div className="space-y-2">
                  {flowType === "payable" && listOther.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold">Quitadas</h3>
                      <p className="text-xs text-muted-foreground">
                        Contas já pagas neste mês.
                      </p>
                    </div>
                  )}
                  {(flowType === "payable" ? listOther : boletosList).map((b) =>
                    renderListCard(b),
                  )}
                </div>
              )}
            </div>
          )}
          {!loadingList && (
            <Pagination
              page={boletosPage}
              totalCount={boletosListCount}
              onPageChange={setBoletosPage}
            />
          )}
        </CardContent>
      </Card>

      {!isReceivableFlow && (
        <Sheet
          open={!!calendarDayList}
          onOpenChange={(o) => !o && setCalendarDayList(null)}
        >
          <SheetContent className="z-50 flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
            <SheetHeader className="shrink-0 space-y-1 border-b px-6 py-4 pr-12 text-left">
              <SheetTitle className="capitalize">
                Lançamentos neste dia
              </SheetTitle>
              <SheetDescription className="capitalize">
                {calendarDayList?.title}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
              {calendarDayList && calendarDayList.items.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nenhum lançamento com vencimento neste dia.
                </p>
              )}
              {flowType === "payable" && calendarDayItems.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-destructive/25 bg-destructive/[0.05] px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-destructive">
                      A pagar
                    </p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-destructive">
                      {formatCurrency(calendarDayBuckets.totals.readyToPay)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                      A confirmar
                    </p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-amber-700 dark:text-amber-300">
                      {formatCurrency(calendarDayBuckets.totals.pendingReceipt)}
                    </p>
                  </div>
                </div>
              )}
              {calendarDayItems.length > 0 && (
                <div className="space-y-5">
                  {flowType === "payable" &&
                    calendarDayBuckets.ready.length > 0 && (
                      <div className="space-y-2">
                        <div>
                          <h3 className="text-sm font-semibold">
                            Valores a pagar
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            Liberadas para pagamento neste dia.
                          </p>
                        </div>
                        {calendarDayBuckets.ready.map((b) =>
                          renderCalendarDayCompactCard(b),
                        )}
                      </div>
                    )}
                  {flowType === "payable" &&
                    calendarDayBuckets.pending.length > 0 && (
                      <div className="space-y-2">
                        <div>
                          <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                            Valores a confirmar
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            NF ou romaneio aguardando recebimento da mercadoria.
                          </p>
                        </div>
                        {calendarDayBuckets.pending.map((b) =>
                          renderCalendarDayCompactCard(b),
                        )}
                      </div>
                    )}
                  {(flowType !== "payable" ||
                    calendarDayBuckets.other.length > 0) && (
                    <div className="space-y-2">
                      {flowType === "payable" &&
                        calendarDayBuckets.other.length > 0 && (
                          <div>
                            <h3 className="text-sm font-semibold">Quitadas</h3>
                            <p className="text-xs text-muted-foreground">
                              Contas já pagas com vencimento neste dia.
                            </p>
                          </div>
                        )}
                      {(flowType === "payable"
                        ? calendarDayBuckets.other
                        : calendarDayItems
                      ).map((b) => renderCalendarDayCompactCard(b))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <SheetFooter className="shrink-0 border-t px-6 py-4">
              <Button
                className="w-full"
                onClick={() => {
                  if (!calendarDayList) return;
                  const dk = calendarDayList.dateKey;
                  setCalendarDayList(null);
                  setCreateBoletoDefaultDueDate(dk);
                  setBoletoSheetOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Adicionar conta neste dia
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}

      {isReceivableFlow && (
        <Sheet
          open={!!revenueCalendarDayList}
          onOpenChange={(o) => !o && setRevenueCalendarDayList(null)}
        >
          <SheetContent className="z-50 flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
            <SheetHeader className="shrink-0 space-y-1 border-b px-6 py-4 pr-12 text-left">
              <SheetTitle className="capitalize">Vendas neste dia</SheetTitle>
              <SheetDescription className="capitalize">
                {revenueCalendarDayList?.title}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-4">
              {revenueCalendarDayList &&
                revenueCalendarDayList.items.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma venda neste dia.
                  </p>
                )}
              {revenueCalendarDayItems.length > 0 && (
                <div className="space-y-2">
                  {revenueCalendarDayItems.map((e) =>
                    renderRevenueCalendarDayCompactCard(e),
                  )}
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}

      {isReceivableFlow && (
        <RevenueDetailSheet
          revenueEntryId={detailRevenueId}
          onClose={() => setDetailRevenueId(null)}
          onRefresh={refreshAll}
        />
      )}

      <Sheet
        open={!!boletoResumo}
        onOpenChange={(o) => !o && setBoletoResumo(null)}
      >
        <SheetContent className="z-[60] sm:max-w-md">
          {boletoResumo && (
            <>
              <SheetHeader>
                <SheetTitle>Resumo da conta</SheetTitle>
                <SheetDescription>
                  {isBoletoPayable(boletoResumo)
                    ? "Dados para pagamento"
                    : "Dados do recebimento"}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-6 py-6">
                <div>
                  <p className="font-semibold">
                    {formatBoletoFluxoDescription(boletoResumo)}
                  </p>
                  <p
                    className={cn(
                      "text-2xl font-bold mt-1",
                      isBoletoPayable(boletoResumo)
                        ? "text-destructive"
                        : "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {formatCurrency(
                      boletoResumo.status === "paid" &&
                        boletoResumo.paid_amount != null
                        ? boletoResumo.paid_amount
                        : boletoResumo.amount,
                    )}
                  </p>
                  {boletoResumo.status === "paid" &&
                    boletoResumo.paid_amount != null &&
                    boletoResumo.paid_amount !== boletoResumo.amount && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Valor original: {formatCurrency(boletoResumo.amount)}
                      </p>
                    )}
                  <p className="text-sm text-muted-foreground mt-1">
                    Vencimento: {formatDate(boletoResumo.due_date)}
                  </p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge
                      variant="outline"
                      className={
                        isBoletoPayable(boletoResumo)
                          ? "border-destructive/30 bg-destructive/10 text-destructive"
                          : "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                      }
                    >
                      {isBoletoPayable(boletoResumo)
                        ? "Conta a pagar"
                        : "Conta a receber"}
                    </Badge>
                    {isBoletoPayable(boletoResumo) && (
                      <Badge variant="secondary">
                        {
                          PAYMENT_TYPE_LABELS[
                            boletoResumo.payment_type ?? "boleto"
                          ]
                        }
                      </Badge>
                    )}
                    {isProjectedBoleto(boletoResumo) ? (
                      <Badge
                        variant="outline"
                        className="border-sky-600/30 bg-sky-500/10 text-sky-900 dark:text-sky-100"
                      >
                        Ocorrência projetada
                      </Badge>
                    ) : (
                      <Badge
                        variant={
                          boletoResumo.status === "paid" ? "default" : "outline"
                        }
                      >
                        {STATUS_LABELS[boletoResumo.status]}
                      </Badge>
                    )}
                    {fluxoBoletoSupplierLabel(boletoResumo) && (
                      <span className="text-sm text-muted-foreground">
                        {fluxoBoletoSupplierLabel(boletoResumo)}
                      </span>
                    )}
                    {boletoResumo.provider && (
                      <span className="text-sm text-muted-foreground">
                        {boletoResumo.provider}
                      </span>
                    )}
                  </div>
                  <Badge variant="outline" className="mt-2">
                    {boletoCategoryLabel(boletoResumo)}
                  </Badge>
                  {flowType === "payable" &&
                    boletoPendingMerchandiseReceipt(boletoResumo) && (
                      <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
                        <p className="font-medium">Mercadoria ainda não recebida</p>
                        <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-100/90">
                          Esta conta está vinculada a uma NF ou romaneio sem
                          recebimento confirmado. Confirme a mercadoria antes de
                          pagar.
                        </p>
                      </div>
                    )}
                  {boletoResumo.status === "paid" &&
                    isBoletoPayable(boletoResumo) &&
                    boletoResumo.paid_at && (
                      <div className="mt-4 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground space-y-1">
                        <p>Pago em {formatDate(boletoResumo.paid_at)}</p>
                        {boletoResumo.competence_date ? (
                          <p>
                            Competência:{" "}
                            {formatCompetenceLabel(boletoResumo.competence_date)}
                          </p>
                        ) : null}
                        {boletoResumo.company_bank_account_id &&
                        bankAccountsById.get(
                          boletoResumo.company_bank_account_id,
                        ) ? (
                          <p>
                            Conta:{" "}
                            {
                              bankAccountsById.get(
                                boletoResumo.company_bank_account_id,
                              )!.name
                            }
                          </p>
                        ) : null}
                        {boletoResumo.paid_amount != null ? (
                          <p>
                            Valor pago:{" "}
                            {formatCurrency(boletoResumo.paid_amount)}
                          </p>
                        ) : null}
                      </div>
                    )}
                </div>

                {boletoResumo.status === "pending" && (
                  <>
                    {(boletoResumo.payment_type ?? "boleto") === "boleto" &&
                      boletoResumo.barcode && (
                        <div className="rounded-lg border p-4 space-y-2">
                          <p className="text-sm font-medium">
                            Código de barras
                          </p>
                          <p className="text-sm font-mono break-all">
                            {boletoResumo.barcode}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              navigator.clipboard.writeText(
                                boletoResumo.barcode ?? "",
                              );
                              toast.success("Código copiado");
                            }}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copiar código
                          </Button>
                        </div>
                      )}
                    {(boletoResumo.payment_type ?? "boleto") === "pix" &&
                      boletoResumo.pix_key && (
                        <div className="rounded-lg border p-4 space-y-2">
                          <p className="text-sm font-medium">Chave PIX</p>
                          <p className="text-sm font-mono break-all">
                            {boletoResumo.pix_key}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              navigator.clipboard.writeText(
                                boletoResumo.pix_key ?? "",
                              );
                              toast.success("Chave copiada");
                            }}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copiar chave
                          </Button>
                        </div>
                      )}
                    {(boletoResumo.payment_type ?? "boleto") === "ted" &&
                      (boletoResumo.bank_name ||
                        boletoResumo.agency ||
                        boletoResumo.account) && (
                        <div className="rounded-lg border p-4 space-y-2">
                          <p className="text-sm font-medium">Dados bancários</p>
                          <div className="text-sm space-y-1">
                            {boletoResumo.bank_name && (
                              <p>Banco: {boletoResumo.bank_name}</p>
                            )}
                            {boletoResumo.bank_code && (
                              <p>Código: {boletoResumo.bank_code}</p>
                            )}
                            {boletoResumo.agency && (
                              <p>Agência: {boletoResumo.agency}</p>
                            )}
                            {boletoResumo.account && (
                              <p>Conta: {boletoResumo.account}</p>
                            )}
                          </div>
                        </div>
                      )}
                  </>
                )}
              </div>
              <div className="flex flex-col gap-2 pt-4">
                {flowType === "payable" &&
                  (isProjectedBoleto(boletoResumo) ||
                    !!boletoResumo.series_master_expense_id) && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        const master = resolveSeriesMaster(boletoResumo);
                        if (!master) {
                          toast.error("Série não encontrada.");
                          return;
                        }
                        setSeriesEditBoleto(boletoResumo);
                        setBoletoResumo(null);
                        setSeriesEditOpen(true);
                      }}
                    >
                      Editar ocorrência / série
                    </Button>
                  )}
                {boletoResumo.status === "pending" &&
                  !isProjectedBoleto(boletoResumo) && (
                    <Button
                      className="w-full"
                      onClick={() => setMarkPaidDialogOpen(true)}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      {isBoletoPayable(boletoResumo)
                        ? "Marcar como pago"
                        : "Marcar como recebido"}
                    </Button>
                  )}
                {boletoResumo.expense_id &&
                  !isProjectedBoleto(boletoResumo) && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        setExpenseDetailId(boletoResumo.expense_id)
                      }
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Ver nota fiscal
                    </Button>
                  )}
                {canDeleteBoletoResumo && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
                    disabled={deletingBoleto}
                    onClick={() => setDeleteBoletoDialogOpen(true)}
                  >
                    {deletingBoleto ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    Excluir conta
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <SeriesBoletoActionsSheet
        open={seriesEditOpen}
        onOpenChange={(open) => {
          setSeriesEditOpen(open);
          if (!open) setSeriesEditBoleto(null);
        }}
        boleto={seriesEditBoleto}
        master={seriesEditBoleto ? resolveSeriesMaster(seriesEditBoleto) : null}
        onSuccess={() => {
          setSeriesEditOpen(false);
          setSeriesEditBoleto(null);
          refreshAll();
        }}
      />

      <ExpenseDetailSheet
        expenseId={expenseDetailId}
        elevated
        onClose={closeExpenseDetail}
        onRefresh={closeExpenseDetail}
      />

      <PayBoletoDialog
        open={
          markPaidDialogOpen &&
          !!boletoResumo &&
          isBoletoPayable(boletoResumo)
        }
        onOpenChange={setMarkPaidDialogOpen}
        boleto={boletoResumo}
        companyId={companyId ?? ""}
        supplierName={
          boletoResumo ? fluxoBoletoSupplierLabel(boletoResumo) : null
        }
        onSuccess={handlePayBoletoSuccess}
      />

      <Dialog
        open={
          markPaidDialogOpen &&
          !!boletoResumo &&
          !isBoletoPayable(boletoResumo)
        }
        onOpenChange={(open) => {
          if (!open && markingPaid) return;
          setMarkPaidDialogOpen(open);
        }}
      >
        <DialogContent
          overlayClassName="z-[80]"
          className="z-[80]"
          onPointerDownOutside={(e) => markingPaid && e.preventDefault()}
          onEscapeKeyDown={(e) => markingPaid && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {boletoResumo && isBoletoPayable(boletoResumo)
                ? "Marcar como pago"
                : "Marcar como recebido"}
            </DialogTitle>
            <DialogDescription>
              {boletoResumo && isBoletoPayable(boletoResumo)
                ? "Confirma que esta conta já foi quitada? Ela será marcada como paga nesta empresa."
                : "Confirma que este valor já foi recebido? O lançamento será marcado como quitado nesta empresa."}
            </DialogDescription>
          </DialogHeader>
          {boletoResumo && (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <p className="font-medium">
                {formatBoletoFluxoDescription(boletoResumo)}
              </p>
              <p className="text-muted-foreground tabular-nums">
                {formatCurrency(boletoResumo.amount)} · venc.{" "}
                {formatDate(boletoResumo.due_date)}
              </p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={markingPaid}
              onClick={() => setMarkPaidDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={markingPaid}
              onClick={() => void confirmMarkReceivableAsPaid()}
            >
              {markingPaid ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Salvando…
                </>
              ) : (
                "Confirmar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteBoletoDialogOpen}
        onOpenChange={(open) => {
          if (!open && deletingBoleto) return;
          setDeleteBoletoDialogOpen(open);
        }}
      >
        <DialogContent
          overlayClassName="z-[80]"
          className="z-[80]"
          onPointerDownOutside={(e) => deletingBoleto && e.preventDefault()}
          onEscapeKeyDown={(e) => deletingBoleto && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Excluir conta</DialogTitle>
            <DialogDescription>{boletoDeleteDescription}</DialogDescription>
          </DialogHeader>
          {boletoResumo && (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <p className="font-medium">
                {formatBoletoFluxoDescription(boletoResumo)}
              </p>
              <p className="text-muted-foreground tabular-nums">
                {formatCurrency(boletoResumo.amount)} · venc.{" "}
                {formatDate(boletoResumo.due_date)}
              </p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={deletingBoleto}
              onClick={() => setDeleteBoletoDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingBoleto}
              onClick={() => void confirmDeleteBoleto()}
            >
              {deletingBoleto ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Excluindo…
                </>
              ) : (
                "Excluir"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

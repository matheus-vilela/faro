import {
  BoletosCalendar,
  type BoletosCalendarViewMode,
  type CalendarDayListPayload,
} from "@/components/BoletosCalendar";
import { CreateBoletoSheet } from "@/components/CreateBoletoSheet";
import { ExpenseDetailSheet } from "@/components/expenses/ExpenseDetailSheet";
import { BoletoResumoSheet } from "@/components/fluxo/BoletoResumoSheet";
import { SeriesBoletoActionsSheet } from "@/components/fluxo/SeriesBoletoActionsSheet";
import { EditBoletoSheet } from "@/components/fluxo/EditBoletoSheet";
import { PayBoletoDialog } from "@/components/fluxo/PayBoletoDialog";
import { PayableByCategoryView } from "@/components/fluxo/PayableByCategoryView";
import { PayableByDueDateView } from "@/components/fluxo/PayableByDueDateView";
import { PayableListViewToggle } from "@/components/fluxo/PayableListViewToggle";
import { PayableTotalsCards } from "@/components/fluxo/PayableTotalsCards";
import { getMonthRange, type MonthYear } from "@/components/MonthSelector";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { ExportButton, HeaderExportActions } from "@/components/reports/ExportButton";
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
import { localDateYmd } from "@/lib/boletoPayment";
import {
  fetchSplitRemainderBoletos,
  undoPayBoleto,
} from "@/lib/boletoPaymentApi";
import { monthYmdBounds, orderedYmdRange } from "@/lib/monthYmdRange";
import { formatBoletoCategoryLabel } from "@/lib/boletoCategory";
import { boletoVisibleInFluxo } from "@/lib/boletoFluxo";
import { formatBoletoFluxoDescription } from "@/lib/boletoFluxoDescription";
import { getCalendarGridDateRange } from "@/lib/boletosCalendarGrid";
import { syncCompanyAlerts } from "@/lib/companyAlerts/syncCompanyAlerts";
import { fetchPayableReceiptContext } from "@/lib/fetchPayableReceiptContext";
import { fetchExpenseItemsForRateio } from "@/lib/dre/fetchExpenseItemsForRateio";
import {
  groupRateioItemsByExpenseId,
  type RateioLine,
} from "@/lib/dre/rateioBoletoByItems";
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
import type { PayableListView } from "@/lib/payableListViews";
import { sortPayablesPaidLast } from "@/lib/payableListViews";
import {
  computePayableTotals,
  EMPTY_PAYABLE_TOTALS,
  formatPayableMonthName,
  getMonthYmdRange,
  getPayableTotalsFetchRange,
  type PayableTotals,
} from "@/lib/payableTotals";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import { cn } from "@/lib/utils";
import type { CompanyBankAccount } from "@/types/bankAccount";
import type { CompanyCategory } from "@/types/category";
import type { Boleto, BoletoFlowType, PaymentType } from "@/types/expense";
import { isBoletoPayable, isBoletoTransfer } from "@/types/expense";
import type {
  ExpenseSeriesMaster,
  FluxoBoletoRow,
} from "@/types/expenseSeries";
import type { RevenueEntry } from "@/types/revenue";
import type { ServiceDailySaleCalendarRow } from "@/types/serviceDailySale";
import type { LucideIcon } from "lucide-react";
import { Loader2, PackageSearch, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { RevenueDetailSheet } from "../revenue/RevenueDetailSheet";
import {
  type RevenueCalendarDayListPayload,
  RevenueEntriesCalendar,
} from "../revenue/RevenueEntriesCalendar";
import { RevenueDaySalesSheet } from "../revenue/RevenueDaySalesSheet";
import { VendasRealizadasListTable } from "./VendasRealizadasListTable";

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  boleto: "Boleto",
  pix: "PIX",
  ted: "TED",
};

const SERVICE_SALES_SELECT =
  "id, sale_date, quantity, unit_price, gross_value, discount, surcharge, allocation, service:services(id, code, name)";

/** Impede o clique no calendário de reabrir o painel no mesmo gesto em que ele fecha. */
function armSuppressUntilAfterClick(flag: { current: boolean }) {
  flag.current = true;
  const release = () => {
    flag.current = false;
  };
  window.addEventListener(
    "click",
    () => {
      window.setTimeout(release, 0);
    },
    { once: true, capture: true },
  );
  window.setTimeout(release, 400);
}

/** Shape bruto do PostgREST (embed many-to-one pode vir como array). */
type ServiceDailySaleDbRow = Omit<ServiceDailySaleCalendarRow, "service"> & {
  service?:
    | ServiceDailySaleCalendarRow["service"]
    | NonNullable<ServiceDailySaleCalendarRow["service"]>[]
    | null;
};

function normalizeServiceDailySales(
  rows: ServiceDailySaleDbRow[],
): ServiceDailySaleCalendarRow[] {
  return rows.map((row) => {
    const rawService = row.service;
    const service = Array.isArray(rawService)
      ? (rawService[0] ?? null)
      : (rawService ?? null);
    return { ...row, service };
  });
}

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
  afterHeader,
  embedded = false,
}: {
  config: FluxoBoletosPageConfig;
  /** Conteúdo renderizado logo abaixo do PageHeader (ex.: abas). */
  afterHeader?: ReactNode;
  /** Sem PageShell/PageHeader — o pai já renderiza o chrome. */
  embedded?: boolean;
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
  const [listDateFrom, setListDateFrom] = useState(
    () => monthYmdBounds(now.getMonth() + 1, now.getFullYear()).min,
  );
  const [listDateTo, setListDateTo] = useState(
    () => monthYmdBounds(now.getMonth() + 1, now.getFullYear()).max,
  );
  const [calendarBoletos, setCalendarBoletos] = useState<FluxoBoletoRow[]>([]);
  const [calendarRevenueEntries, setCalendarRevenueEntries] = useState<
    RevenueEntry[]
  >([]);
  const [calendarServiceSales, setCalendarServiceSales] = useState<
    ServiceDailySaleCalendarRow[]
  >([]);
  const [monthServiceSales, setMonthServiceSales] = useState<
    ServiceDailySaleCalendarRow[]
  >([]);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const isReceivableFlow = flowType === "receivable";
  const competenceMonthBounds = useMemo(
    () => monthYmdBounds(period.month, period.year),
    [period.month, period.year],
  );
  const listDateRange = useMemo(() => {
    const fromDate = listDateFrom.trim() || competenceMonthBounds.min;
    const toDate = listDateTo.trim() || competenceMonthBounds.max;
    return orderedYmdRange(fromDate, toDate);
  }, [listDateFrom, listDateTo, competenceMonthBounds]);
  const applyPeriod = (next: MonthYear) => {
    const bounds = monthYmdBounds(next.month, next.year);
    setPeriod(next);
    setListDateFrom(bounds.min);
    setListDateTo(bounds.max);
  };

  const [boletosList, setBoletosList] = useState<FluxoBoletoRow[]>([]);
  const [listRevenueEntries, setListRevenueEntries] = useState<RevenueEntry[]>(
    [],
  );
  const [boletosMonthFiltered, setBoletosMonthFiltered] = useState<
    FluxoBoletoRow[]
  >([]);
  const [boletosListCount, setBoletosListCount] = useState(0);
  const [seriesMasters, setSeriesMasters] = useState<ExpenseSeriesMaster[]>([]);
  const [seriesEditOpen, setSeriesEditOpen] = useState(false);
  const [seriesEditBoleto, setSeriesEditBoleto] =
    useState<FluxoBoletoRow | null>(null);
  const [boletosPage, setBoletosPage] = useState(1);
  const [boletosSearch, setBoletosSearch] = useState("");
  const debouncedSearch = useDebounce(boletosSearch, 300);
  const [loadingList, setLoadingList] = useState(true);
  const [listView, setListView] = useState<PayableListView>("category");
  const [calendarDayListView, setCalendarDayListView] =
    useState<PayableListView>("category");

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
  const [payInitialPartial, setPayInitialPartial] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [editBoletoOpen, setEditBoletoOpen] = useState(false);
  const [editBoleto, setEditBoleto] = useState<FluxoBoletoRow | null>(null);
  const [undoPayDialogOpen, setUndoPayDialogOpen] = useState(false);
  const [undoingPay, setUndoingPay] = useState(false);
  const [splitRemainderChildren, setSplitRemainderChildren] = useState<
    Awaited<ReturnType<typeof fetchSplitRemainderBoletos>>
  >([]);
  const [deleteBoletoDialogOpen, setDeleteBoletoDialogOpen] = useState(false);
  const [deletingBoleto, setDeletingBoleto] = useState(false);
  const [companyCategories, setCompanyCategories] = useState<CompanyCategory[]>(
    [],
  );
  const [payableReceiptContext, setPayableReceiptContext] =
    useState<PayableReceiptContext>(EMPTY_PAYABLE_RECEIPT_CONTEXT);
  const [rateioItemsByExpenseId, setRateioItemsByExpenseId] = useState<
    Map<string, RateioLine[]>
  >(() => new Map());
  const [bankAccountsById, setBankAccountsById] = useState<
    Map<string, CompanyBankAccount>
  >(new Map());
  const [payableTotals, setPayableTotals] =
    useState<PayableTotals>(EMPTY_PAYABLE_TOTALS);
  const [totalsLoading, setTotalsLoading] = useState(false);
  const suppressCalendarDayReopenRef = useRef(false);
  const suppressRevenueDayReopenRef = useRef(false);

  const closeCalendarDayList = useCallback(() => {
    armSuppressUntilAfterClick(suppressCalendarDayReopenRef);
    setCalendarDayList(null);
    setCalendarDayListView("category");
  }, []);

  const handleCalendarDayListOpen = useCallback(
    (payload: CalendarDayListPayload) => {
      if (suppressCalendarDayReopenRef.current || calendarDayList) {
        closeCalendarDayList();
        return;
      }
      setCalendarDayList(payload);
    },
    [calendarDayList, closeCalendarDayList],
  );

  const handleRevenueDayListOpen = useCallback(
    (payload: RevenueCalendarDayListPayload) => {
      if (suppressRevenueDayReopenRef.current || revenueCalendarDayList) {
        armSuppressUntilAfterClick(suppressRevenueDayReopenRef);
        setRevenueCalendarDayList(null);
        return;
      }
      setRevenueCalendarDayList(payload);
    },
    [revenueCalendarDayList],
  );

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
      const visible = merged.filter(
        (b) => isProjectedBoleto(b) || boletoVisibleInFluxo(b),
      );
      setCalendarBoletos(visible);
      setCalendarDayList((prev) => {
        if (!prev) return prev;
        const dateKey = prev.dateKey;
        return {
          ...prev,
          items: visible.filter(
            (b) => String(b.due_date ?? "").slice(0, 10) === dateKey,
          ),
        };
      });
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
      const [data, servicesData] = await Promise.all([
        fetchAllInRange<RevenueEntry>(
          supabase
            .from("revenue_entries")
            .select("*")
            .eq("company_id", companyId)
            .gte("entry_date", startIso)
            .lte("entry_date", endIso)
            .order("entry_date", { ascending: true })
            .order("created_at", { ascending: true }),
        ),
        fetchAllInRange<ServiceDailySaleDbRow>(
          supabase
            .from("service_daily_sales")
            .select(SERVICE_SALES_SELECT)
            .eq("company_id", companyId)
            .gte("sale_date", startIso)
            .lte("sale_date", endIso)
            .order("sale_date", { ascending: true }),
        ),
      ]);
      setCalendarRevenueEntries(data);
      const services = normalizeServiceDailySales(servicesData);
      setCalendarServiceSales(services);
      setRevenueCalendarDayList((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: data.filter(
            (entry) => entry.entry_date.slice(0, 10) === prev.dateKey,
          ),
          serviceItems: services.filter(
            (sale) => sale.sale_date.slice(0, 10) === prev.dateKey,
          ),
        };
      });
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível carregar o calendário de vendas.");
      setCalendarRevenueEntries([]);
      setCalendarServiceSales([]);
    }
    setCalendarLoading(false);
  }, [companyId, period.month, period.year, isReceivableFlow]);

  const fetchMonthServiceSales = useCallback(async () => {
    if (!companyId || !isReceivableFlow) {
      setMonthServiceSales([]);
      return;
    }
    const startYmd = listDateRange.gte;
    const endYmd = listDateRange.lte;
    try {
      const data = await fetchAllInRange<ServiceDailySaleDbRow>(
        supabase
          .from("service_daily_sales")
          .select(SERVICE_SALES_SELECT)
          .eq("company_id", companyId)
          .gte("sale_date", startYmd)
          .lte("sale_date", endYmd)
          .order("sale_date", { ascending: false }),
      );
      setMonthServiceSales(normalizeServiceDailySales(data));
    } catch (e) {
      console.error(e);
      setMonthServiceSales([]);
    }
  }, [companyId, isReceivableFlow, listDateRange]);

  const fetchBoletosList = useCallback(async () => {
    if (!companyId) return;
    setLoadingList(true);
    const monthRange = getMonthRange(period.month, period.year);
    const startYmd =
      flowType === "receivable"
        ? listDateRange.gte
        : monthRange.start.slice(0, 10);
    const endYmd =
      flowType === "receivable"
        ? listDateRange.lte
        : monthRange.end.slice(0, 10);
    try {
      if (flowType === "payable") {
        setListRevenueEntries([]);
        const merged = await fetchMergedPayableBoletosInRange(
          companyId,
          startYmd,
          endYmd,
        );
        const visible = merged.filter(
          (b) => isProjectedBoleto(b) || boletoVisibleInFluxo(b),
        );
        const filtered = filterBoletosBySearch(visible, debouncedSearch);
        setBoletosMonthFiltered(filtered);
        setBoletosListCount(filtered.length);
        const pageStart = (boletosPage - 1) * PAGE_SIZE;
        setBoletosList(filtered.slice(pageStart, pageStart + PAGE_SIZE));
      } else {
        setBoletosMonthFiltered([]);
        setBoletosList([]);
        const data = await fetchAllInRange<RevenueEntry>(
          supabase
            .from("revenue_entries")
            .select("*")
            .eq("company_id", companyId)
            .gte("entry_date", startYmd)
            .lte("entry_date", endYmd)
            .order("entry_date", { ascending: true })
            .order("created_at", { ascending: true }),
        );
        setListRevenueEntries(data);
        setBoletosListCount(data.length);
      }
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível carregar a lista.");
      setBoletosList([]);
      setListRevenueEntries([]);
      setBoletosMonthFiltered([]);
      setBoletosListCount(0);
    }
    setLoadingList(false);
  }, [
    companyId,
    period.month,
    period.year,
    flowType,
    debouncedSearch,
    boletosPage,
    listDateRange,
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
        (b) =>
          (isProjectedBoleto(b) || boletoVisibleInFluxo(b)) &&
          !isBoletoTransfer(b),
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
  }, [debouncedSearch, period.month, period.year, listDateFrom, listDateTo]);

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
    queueMicrotask(() => void fetchMonthServiceSales());
  }, [fetchMonthServiceSales]);

  useEffect(() => {
    queueMicrotask(() => void fetchPayableTotals());
  }, [fetchPayableTotals]);

  useEffect(() => {
    if (!companyId || flowType !== "payable") {
      queueMicrotask(() => {
        setPayableReceiptContext(EMPTY_PAYABLE_RECEIPT_CONTEXT);
        setRateioItemsByExpenseId(new Map());
      });
      return;
    }
    const byKey = new Map<string, FluxoBoletoRow>();
    for (const b of [...calendarBoletos, ...boletosMonthFiltered]) {
      const key =
        b.id ||
        `${b.series_master_expense_id ?? b.expense_id ?? "x"}-${b.due_date}-${b.amount}`;
      byKey.set(key, b);
    }
    void fetchPayableReceiptContext([...byKey.values()])
      .then(setPayableReceiptContext)
      .catch((error) => {
        console.error(error);
        setPayableReceiptContext(EMPTY_PAYABLE_RECEIPT_CONTEXT);
      });
    const expenseIds = [...byKey.values()]
      .map((b) => b.expense_id)
      .filter((id): id is string => Boolean(id));
    void fetchExpenseItemsForRateio(companyId, expenseIds)
      .then((items) => setRateioItemsByExpenseId(groupRateioItemsByExpenseId(items)))
      .catch((error) => {
        console.error(error);
        setRateioItemsByExpenseId(new Map());
      });
  }, [companyId, flowType, calendarBoletos, boletosMonthFiltered]);

  const scheduledMonthBoletos = useMemo(
    () => boletosMonthFiltered.filter((b) => isScheduledPayableBoleto(b)),
    [boletosMonthFiltered],
  );

  const todayYmd = localDateYmd();

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
    queueMicrotask(() => {
      setMarkPaidDialogOpen(false);
      setUndoPayDialogOpen(false);
      setPayInitialPartial(false);
    });
  }, [boletoResumo?.id]);

  const refreshAll = useCallback(() => {
    if (isReceivableFlow) {
      void fetchCalendarRevenueEntries();
      void fetchMonthServiceSales();
    } else {
      void fetchCalendarBoletos();
    }
    void fetchBoletosList();
    void fetchPayableTotals();
  }, [
    fetchCalendarBoletos,
    fetchCalendarRevenueEntries,
    fetchMonthServiceSales,
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

  useEffect(() => {
    if (
      !companyId ||
      !boletoResumo?.id ||
      boletoResumo.status !== "paid" ||
      !isBoletoPayable(boletoResumo)
    ) {
      queueMicrotask(() => setSplitRemainderChildren([]));
      return;
    }
    let cancelled = false;
    void fetchSplitRemainderBoletos({
      companyId,
      parentBoletoId: boletoResumo.id,
    }).then((rows) => {
      if (!cancelled) setSplitRemainderChildren(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [boletoResumo, companyId]);

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

  const applyBoletoLocalUpdate = useCallback((updated: FluxoBoletoRow) => {
    const mergeRow = (b: FluxoBoletoRow): FluxoBoletoRow =>
      b.id === updated.id
        ? { ...b, ...updated, supplier: updated.supplier ?? b.supplier }
        : b;
    const dueYmd = String(updated.due_date ?? "").slice(0, 10);
    setBoletosList((prev) => prev.map(mergeRow));
    setBoletosMonthFiltered((prev) => prev.map(mergeRow));
    setCalendarBoletos((prev) => prev.map(mergeRow));
    setCalendarDayList((prev) => {
      if (!prev) return prev;
      const patched = prev.items.map((b) => mergeRow(b as FluxoBoletoRow));
      const items =
        dueYmd === prev.dateKey
          ? patched.some((b) => b.id === updated.id)
            ? patched
            : [...patched, updated]
          : patched.filter((b) => b.id !== updated.id);
      return { ...prev, items };
    });
    setBoletoResumo((prev) =>
      prev && prev.id === updated.id ? mergeRow(prev) : prev,
    );
  }, []);

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

  const handleEditBoletoSuccess = useCallback(
    (updated: Boleto) => {
      const merged: FluxoBoletoRow = {
        ...updated,
        supplier: editBoleto?.supplier ?? boletoResumo?.supplier,
      };
      applyBoletoLocalUpdate(merged);
      setBoletoResumo(merged);
      setEditBoletoOpen(false);
      setEditBoleto(null);
      refreshAll();
    },
    [
      applyBoletoLocalUpdate,
      boletoResumo?.supplier,
      editBoleto?.supplier,
      refreshAll,
    ],
  );

  const pendingSplitRemainder = useMemo(
    () => splitRemainderChildren.filter((c) => c.status === "pending"),
    [splitRemainderChildren],
  );

  const confirmUndoPay = useCallback(async () => {
    if (!boletoResumo || !companyId) return;
    setUndoingPay(true);
    try {
      const updated = await undoPayBoleto({
        boletoId: boletoResumo.id,
        companyId,
      });
      const merged: FluxoBoletoRow = {
        ...updated,
        supplier: boletoResumo.supplier,
      };
      setBoletoResumo(merged);
      setUndoPayDialogOpen(false);
      refreshAll();
      void syncCompanyAlerts(companyId);
      toast.success(
        pendingSplitRemainder.length > 0
          ? "Pagamento desfeito. O saldo foi reunido nesta conta."
          : "Pagamento desfeito. A conta voltou para em aberto.",
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Não foi possível desfazer o pagamento.",
      );
    } finally {
      setUndoingPay(false);
    }
  }, [boletoResumo, companyId, pendingSplitRemainder.length, refreshAll]);

  const confirmMarkReceivableAsPaid = useCallback(async () => {
    if (!boletoResumo || !companyId) return;
    if (isProjectedBoleto(boletoResumo)) {
      toast.error(
        "Esta ocorrência ainda é projetada. Edite e materialize antes de marcar como paga.",
      );
      return;
    }
    setMarkingPaid(true);
    const updatedAt = new Date().toISOString();
    const paidAt = localDateYmd();
    const { data, error } = await supabase
      .from("boletos")
      .update({
        status: "paid",
        paid_at: paidAt,
        updated_at: updatedAt,
      })
      .eq("id", boletoResumo.id)
      .eq("company_id", companyId)
      .select()
      .single();

    if (
      !error &&
      data &&
      isBoletoTransfer(boletoResumo) &&
      boletoResumo.transfer_group_id
    ) {
      const { error: pairErr } = await supabase
        .from("boletos")
        .update({
          status: "paid",
          paid_at: paidAt,
          paid_amount: Number(boletoResumo.amount) || 0,
          updated_at: updatedAt,
        })
        .eq("company_id", companyId)
        .eq("transfer_group_id", boletoResumo.transfer_group_id)
        .eq("entry_kind", "transfer")
        .neq("id", boletoResumo.id)
        .eq("status", "pending");
      if (pairErr) {
        console.error(pairErr);
        toast.error(
          "Recebimento registrado, mas a contraparte da transferência não foi quitada.",
        );
      }
    }

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
            {isBoletoTransfer(b) && (
              <Badge variant="outline" className="text-[10px]">
                Transferência
              </Badge>
            )}
            {b.split_from_boleto_id && (
              <Badge
                variant="outline"
                className="border-violet-600/30 bg-violet-500/10 text-[10px] text-violet-900 dark:text-violet-100"
              >
                Saldo restante
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
            {payable && !isBoletoTransfer(b) && (
              <span className="inline-block text-xs font-medium text-muted-foreground rounded-md bg-muted px-2 py-0.5">
                {PAYMENT_TYPE_LABELS[b.payment_type ?? "boleto"]}
              </span>
            )}
            <span className="inline-block text-xs font-medium text-primary rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5">
              {isBoletoTransfer(b)
                ? "Transferência"
                : boletoCategoryLabel(b)}
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

  const calendarDayItemsSorted = useMemo(
    () => sortPayablesPaidLast(calendarDayItems),
    [calendarDayItems],
  );

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

  const addButton = (
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
  );

  const { startYmd, endYmd } = getMonthYmdRange(period.month, period.year);
  const exportButton = currentCompany?.id ? (
    <ExportButton
      reportId={isReceivableFlow ? "receivables_open" : "payables_open"}
      allowedReportIds={
        isReceivableFlow
          ? ["receivables_open", "receipts_made", "financial_movement"]
          : ["payables_open", "payables_overdue", "payments_made", "financial_movement"]
      }
      lockReport={false}
      initialFilters={{
        dateFrom: startYmd,
        dateTo: endYmd,
        month: period.month,
        year: period.year,
        search: boletosSearch,
      }}
    />
  ) : null;

  const headerActions = (
    <HeaderExportActions exportSlot={exportButton} primary={addButton} />
  );

  const body = (
    <>
      {embedded ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{description}</p>
          {headerActions}
        </div>
      ) : (
        <PageHeader
          title={title}
          description={description}
          icon={PageIcon}
          action={headerActions}
        />
      )}

      {!embedded && afterHeader ? (
        <div className="w-fit max-w-full">{afterHeader}</div>
      ) : null}

      <ReferencePeriodCard
        value={period}
        onChange={isReceivableFlow ? applyPeriod : setPeriod}
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
            if (!open && expenseIdFromUrl) navigate("/app/notas-recebimento");
          }}
          companyId={currentCompany.id}
          expenseId={expenseIdFromUrl}
          defaultDueDate={createBoletoDefaultDueDate}
          fixedAccountFlow={flowType}
          onSuccess={() => {
            refreshAll();
            void syncCompanyAlerts(currentCompany.id);
            if (expenseIdFromUrl) navigate("/app/notas-recebimento");
          }}
        />
      )}
      {isReceivableFlow ? (
        <RevenueEntriesCalendar
          month={period.month}
          year={period.year}
          entries={calendarRevenueEntries}
          serviceSales={calendarServiceSales}
          loading={calendarLoading}
          onDayListOpen={handleRevenueDayListOpen}
          formatCurrency={formatCurrency}
        />
      ) : (
        <BoletosCalendar
          month={period.month}
          year={period.year}
          boletos={calendarBoletos}
          loading={calendarLoading}
          viewMode={calendarViewMode}
          onDayListOpen={handleCalendarDayListOpen}
          formatCurrency={formatCurrency}
          isPayableReadyToPay={
            flowType === "payable" ? boletoReadyToPay : undefined
          }
          onlyScheduledPayables={
            flowType === "payable" ? isScheduledPayableBoleto : undefined
          }
        />
      )}

      {!isReceivableFlow ? (
        <div className="space-y-4">
          <PayableListViewToggle value={listView} onChange={setListView} />
          <div className="flex flex-wrap gap-3 items-center">
            <Input
              placeholder={searchPlaceholder}
              value={boletosSearch}
              onChange={(e) => setBoletosSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>
          {listView === "category" && (
            <PayableByCategoryView
              boletos={scheduledMonthBoletos}
              categoriesById={categoriesById}
              expenseById={payableReceiptContext.expenseById}
              todayYmd={todayYmd}
              loading={loadingList}
              emptyMessage={emptyListMessage}
              formatCurrency={formatCurrency}
              onSelect={setBoletoResumo}
              itemsByExpenseId={rateioItemsByExpenseId}
            />
          )}
          {listView === "due" && (
            <PayableByDueDateView
              boletos={scheduledMonthBoletos}
              categoriesById={categoriesById}
              expenseById={payableReceiptContext.expenseById}
              todayYmd={todayYmd}
              loading={loadingList}
              emptyMessage={emptyListMessage}
              formatCurrency={formatCurrency}
              onSelect={setBoletoResumo}
            />
          )}
          {listView === "status" && (
            <Card>
              <CardHeader className="flex flex-col gap-5 space-y-0">
                <div>
                  <CardTitle>{listTitle}</CardTitle>
                  <CardDescription>{listDescription}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {loadingList ? (
                  <p className="text-muted-foreground">Carregando...</p>
                ) : boletosList.length === 0 ? (
                  <p className="text-muted-foreground">{emptyListMessage}</p>
                ) : (
                  <div className="space-y-6">
                    {listReadyToPay.length > 0 && (
                      <div className="space-y-2">
                        <div>
                          <h3 className="text-sm font-semibold">
                            Valores a pagar
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            Contas agendadas liberadas para pagamento.
                          </p>
                        </div>
                        {listReadyToPay.map((b) => renderListCard(b))}
                      </div>
                    )}
                    {listPendingReceipt.length > 0 && (
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
                    {listOther.length > 0 && (
                      <div className="space-y-2">
                        <div>
                          <h3 className="text-sm font-semibold">Quitadas</h3>
                          <p className="text-xs text-muted-foreground">
                            Contas já pagas neste mês.
                          </p>
                        </div>
                        {listOther.map((b) => renderListCard(b))}
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
          )}
        </div>
      ) : (
        <Card>
          <CardHeader className="flex flex-col gap-5 space-y-0">
            <div>
              <CardTitle>{listTitle}</CardTitle>
              <CardDescription>{listDescription}</CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <VendasRealizadasListTable
              revenueEntries={listRevenueEntries}
              serviceSales={monthServiceSales}
              categories={companyCategories}
              categoriesById={categoriesById}
              loading={loadingList}
              emptyMessage={emptyListMessage}
              formatCurrency={formatCurrency}
              onSelectRevenueEntry={setDetailRevenueId}
              dateFrom={listDateFrom}
              dateTo={listDateTo}
              monthBounds={competenceMonthBounds}
              onDateFromChange={setListDateFrom}
              onDateToChange={setListDateTo}
            />
          </CardContent>
        </Card>
      )}

      {!isReceivableFlow && (
        <Sheet
          open={!!calendarDayList}
          modal={false}
          onOpenChange={(o) => {
            if (!o && (boletoResumo || seriesEditOpen || editBoletoOpen)) return;
            if (!o) closeCalendarDayList();
          }}
        >
          <SheetContent
            maximizable
            className="z-50 flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
          >
            <SheetHeader className="shrink-0 space-y-1 border-b px-6 py-4 pr-20 text-left">
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
                <div className="space-y-4">
                  <PayableListViewToggle
                    value={calendarDayListView}
                    onChange={setCalendarDayListView}
                  />
                  {calendarDayListView === "category" && (
                    <PayableByCategoryView
                      boletos={calendarDayItemsSorted}
                      categoriesById={categoriesById}
                      expenseById={payableReceiptContext.expenseById}
                      todayYmd={todayYmd}
                      loading={false}
                      emptyMessage="Nenhum lançamento com vencimento neste dia."
                      formatCurrency={formatCurrency}
                      onSelect={setBoletoResumo}
                      itemsByExpenseId={rateioItemsByExpenseId}
                    />
                  )}
                  {calendarDayListView === "due" && (
                    <PayableByDueDateView
                      boletos={calendarDayItemsSorted}
                      categoriesById={categoriesById}
                      expenseById={payableReceiptContext.expenseById}
                      todayYmd={todayYmd}
                      loading={false}
                      emptyMessage="Nenhum lançamento com vencimento neste dia."
                      formatCurrency={formatCurrency}
                      onSelect={setBoletoResumo}
                    />
                  )}
                  {calendarDayListView === "status" && (
                    <div className="space-y-5">
                      {calendarDayBuckets.ready.length > 0 && (
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
                      {calendarDayBuckets.pending.length > 0 && (
                        <div className="space-y-2">
                          <div>
                            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                              Valores a confirmar
                            </h3>
                            <p className="text-xs text-muted-foreground">
                              NF ou romaneio aguardando recebimento da
                              mercadoria.
                            </p>
                          </div>
                          {calendarDayBuckets.pending.map((b) =>
                            renderCalendarDayCompactCard(b),
                          )}
                        </div>
                      )}
                      {calendarDayBuckets.other.length > 0 && (
                        <div className="space-y-2">
                          <div>
                            <h3 className="text-sm font-semibold">Quitadas</h3>
                            <p className="text-xs text-muted-foreground">
                              Contas já pagas com vencimento neste dia.
                            </p>
                          </div>
                          {calendarDayBuckets.other.map((b) =>
                            renderCalendarDayCompactCard(b),
                          )}
                        </div>
                      )}
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
                  setCalendarDayListView("category");
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
        <RevenueDaySalesSheet
          payload={revenueCalendarDayList}
          open={!!revenueCalendarDayList}
          onOpenChange={(o) => {
            if (!o && detailRevenueId) return;
            if (!o) {
              armSuppressUntilAfterClick(suppressRevenueDayReopenRef);
              setRevenueCalendarDayList(null);
            }
          }}
          formatCurrency={formatCurrency}
          onProductClick={(id) => {
            setDetailRevenueId(id);
          }}
          onEpocDaySynced={() => void fetchCalendarRevenueEntries()}
        />
      )}

      {isReceivableFlow && (
        <RevenueDetailSheet
          revenueEntryId={detailRevenueId}
          onClose={() => setDetailRevenueId(null)}
          onRefresh={refreshAll}
        />
      )}

      <BoletoResumoSheet
        boleto={boletoResumo}
        open={!!boletoResumo}
        onOpenChange={(o) => {
          if (!o && editBoletoOpen) return;
          if (!o) setBoletoResumo(null);
        }}
        flowType={flowType}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
        categoryLabel={boletoCategoryLabel}
        bankAccountName={
          boletoResumo?.company_bank_account_id
            ? (bankAccountsById.get(boletoResumo.company_bank_account_id)
                ?.name ?? null)
            : null
        }
        pendingMerchandise={
          flowType === "payable" &&
          !!boletoResumo &&
          boletoPendingMerchandiseReceipt(boletoResumo)
        }
        canDelete={canDeleteBoletoResumo}
        deleting={deletingBoleto}
        onEdit={() => {
          if (!boletoResumo) return;
          setEditBoleto(boletoResumo);
          setEditBoletoOpen(true);
        }}
        onEditSeries={() => {
          if (!boletoResumo) return;
          const master = resolveSeriesMaster(boletoResumo);
          if (!master) {
            toast.error("Série não encontrada.");
            return;
          }
          setSeriesEditBoleto(boletoResumo);
          setBoletoResumo(null);
          setSeriesEditOpen(true);
        }}
        onMarkPaid={() => {
          setPayInitialPartial(false);
          setMarkPaidDialogOpen(true);
        }}
        onPayPartial={() => {
          setPayInitialPartial(true);
          setMarkPaidDialogOpen(true);
        }}
        onUndoPay={() => setUndoPayDialogOpen(true)}
        onViewExpense={() => {
          if (!boletoResumo?.expense_id) return;
          setExpenseDetailId(boletoResumo.expense_id);
        }}
        onDelete={() => setDeleteBoletoDialogOpen(true)}
      />

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

      <EditBoletoSheet
        open={editBoletoOpen}
        onOpenChange={(open) => {
          setEditBoletoOpen(open);
          if (!open) setEditBoleto(null);
        }}
        boleto={editBoleto}
        companyId={companyId ?? ""}
        onSuccess={handleEditBoletoSuccess}
      />

      <ExpenseDetailSheet
        expenseId={expenseDetailId}
        elevated
        onClose={closeExpenseDetail}
        onRefresh={refreshAll}
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
        initialPartial={payInitialPartial}
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
        open={undoPayDialogOpen}
        onOpenChange={(open) => {
          if (!open && undoingPay) return;
          setUndoPayDialogOpen(open);
        }}
      >
        <DialogContent
          overlayClassName="z-[80]"
          className="z-[80]"
          onPointerDownOutside={(e) => undoingPay && e.preventDefault()}
          onEscapeKeyDown={(e) => undoingPay && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Desfazer pagamento</DialogTitle>
            <DialogDescription>
              {pendingSplitRemainder.length > 0
                ? "A conta voltará para em aberto e o saldo restante será reunido neste lançamento, com o valor cheio."
                : boletoResumo && isBoletoTransfer(boletoResumo)
                  ? "A saída e a entrada da transferência voltarão para em aberto."
                  : "A conta voltará para em aberto e os dados do pagamento serão limpos."}
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
              {pendingSplitRemainder.length > 0 ? (
                <p className="text-muted-foreground mt-1">
                  Saldo a reunir:{" "}
                  {formatCurrency(
                    pendingSplitRemainder.reduce(
                      (sum, row) => sum + (Number(row.amount) || 0),
                      0,
                    ),
                  )}
                </p>
              ) : null}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={undoingPay}
              onClick={() => setUndoPayDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={undoingPay}
              onClick={() => void confirmUndoPay()}
            >
              {undoingPay ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Desfazendo…
                </>
              ) : (
                "Desfazer pagamento"
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
    </>
  );

  if (embedded) {
    return <div className="flex flex-col gap-4">{body}</div>;
  }

  return <PageShell>{body}</PageShell>;
}

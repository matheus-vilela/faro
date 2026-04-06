import {
  BoletosCalendar,
  type CalendarDayListPayload,
} from "@/components/BoletosCalendar";
import { CreateBoletoSheet } from "@/components/CreateBoletoSheet";
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
import { syncCompanyAlerts } from "@/lib/companyAlerts/syncCompanyAlerts";
import { useDebounce } from "@/hooks/useDebounce";
import { formatBoletoCategoryLabel } from "@/lib/boletoCategory";
import { formatBoletoFluxoDescription } from "@/lib/boletoFluxoDescription";
import { getCalendarGridDateRange } from "@/lib/boletosCalendarGrid";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyCategory } from "@/types/category";
import type { Boleto, PaymentType } from "@/types/expense";
import { isBoletoPayable } from "@/types/expense";
import {
  CalendarDays,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  boleto: "Boleto",
  pix: "PIX",
  ted: "TED",
};

const STATUS_LABELS = { pending: "Pendente", paid: "Pago" };

type FluxoTab = "calendar" | "payable" | "receivable";

export function FluxoDeCaixa() {
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
  const [activeTab, setActiveTab] = useState<FluxoTab>("calendar");

  const [calendarBoletos, setCalendarBoletos] = useState<Boleto[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(true);

  const [boletosPayable, setBoletosPayable] = useState<Boleto[]>([]);
  const [boletosPayableCount, setBoletosPayableCount] = useState(0);
  const [boletosPagePayable, setBoletosPagePayable] = useState(1);
  const [boletosSearchPayable, setBoletosSearchPayable] = useState("");
  const debouncedSearchPayable = useDebounce(boletosSearchPayable, 300);
  const [loadingPayable, setLoadingPayable] = useState(true);

  const [boletosReceivable, setBoletosReceivable] = useState<Boleto[]>([]);
  const [boletosReceivableCount, setBoletosReceivableCount] = useState(0);
  const [boletosPageReceivable, setBoletosPageReceivable] = useState(1);
  const [boletosSearchReceivable, setBoletosSearchReceivable] = useState("");
  const debouncedSearchReceivable = useDebounce(boletosSearchReceivable, 300);
  const [loadingReceivable, setLoadingReceivable] = useState(true);

  const [boletoSheetOpen, setBoletoSheetOpen] = useState(false);
  const [createBoletoDefaultDueDate, setCreateBoletoDefaultDueDate] = useState<
    string | undefined
  >(undefined);
  const [calendarDayList, setCalendarDayList] =
    useState<CalendarDayListPayload | null>(null);
  const [boletoResumo, setBoletoResumo] = useState<Boleto | null>(null);
  const [markPaidDialogOpen, setMarkPaidDialogOpen] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [companyCategories, setCompanyCategories] = useState<CompanyCategory[]>(
    [],
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

  const fetchCalendarBoletos = useCallback(async () => {
    if (!companyId) return;
    setCalendarLoading(true);
    const { startIso, endIso } = getCalendarGridDateRange(
      period.month,
      period.year,
    );
    const { data } = await supabase
      .from("boletos")
      .select("*")
      .eq("company_id", companyId)
      .gte("due_date", startIso)
      .lte("due_date", endIso)
      .order("due_date", { ascending: true });
    setCalendarBoletos((data as Boleto[]) ?? []);
    setCalendarLoading(false);
  }, [companyId, period.month, period.year]);

  const fetchBoletosPayable = useCallback(async () => {
    if (!companyId) return;
    setLoadingPayable(true);
    const { start, end } = getMonthRange(period.month, period.year);
    let query = supabase
      .from("boletos")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .eq("flow_type", "payable")
      .gte("due_date", start.slice(0, 10))
      .lte("due_date", end.slice(0, 10))
      .order("due_date", { ascending: true });
    if (debouncedSearchPayable.trim()) {
      const term = `%${debouncedSearchPayable.trim()}%`;
      query = query.or(`description.ilike.${term},provider.ilike.${term}`);
    }
    const { data, count } = await query.range(
      (boletosPagePayable - 1) * PAGE_SIZE,
      boletosPagePayable * PAGE_SIZE - 1,
    );
    setBoletosPayable((data as Boleto[]) ?? []);
    setBoletosPayableCount(count ?? 0);
    setLoadingPayable(false);
  }, [
    companyId,
    period.month,
    period.year,
    debouncedSearchPayable,
    boletosPagePayable,
  ]);

  const fetchBoletosReceivable = useCallback(async () => {
    if (!companyId) return;
    setLoadingReceivable(true);
    const { start, end } = getMonthRange(period.month, period.year);
    let query = supabase
      .from("boletos")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .eq("flow_type", "receivable")
      .gte("due_date", start.slice(0, 10))
      .lte("due_date", end.slice(0, 10))
      .order("due_date", { ascending: true });
    if (debouncedSearchReceivable.trim()) {
      const term = `%${debouncedSearchReceivable.trim()}%`;
      query = query.or(`description.ilike.${term},provider.ilike.${term}`);
    }
    const { data, count } = await query.range(
      (boletosPageReceivable - 1) * PAGE_SIZE,
      boletosPageReceivable * PAGE_SIZE - 1,
    );
    setBoletosReceivable((data as Boleto[]) ?? []);
    setBoletosReceivableCount(count ?? 0);
    setLoadingReceivable(false);
  }, [
    companyId,
    period.month,
    period.year,
    debouncedSearchReceivable,
    boletosPageReceivable,
  ]);

  useEffect(() => {
    queueMicrotask(() => setBoletosPagePayable(1));
  }, [debouncedSearchPayable, period.month, period.year]);

  useEffect(() => {
    queueMicrotask(() => setBoletosPageReceivable(1));
  }, [debouncedSearchReceivable, period.month, period.year]);

  useEffect(() => {
    queueMicrotask(() => void fetchCalendarBoletos());
  }, [fetchCalendarBoletos]);

  useEffect(() => {
    queueMicrotask(() => void fetchBoletosPayable());
  }, [fetchBoletosPayable]);

  useEffect(() => {
    queueMicrotask(() => void fetchBoletosReceivable());
  }, [fetchBoletosReceivable]);

  useEffect(() => {
    if (expenseIdFromUrl) queueMicrotask(() => setBoletoSheetOpen(true));
  }, [expenseIdFromUrl]);

  useEffect(() => {
    if (activeTab !== "calendar")
      queueMicrotask(() => setCalendarDayList(null));
  }, [activeTab]);

  useEffect(() => {
    queueMicrotask(() => setMarkPaidDialogOpen(false));
  }, [boletoResumo?.id]);

  const refreshAll = useCallback(() => {
    void fetchCalendarBoletos();
    void fetchBoletosPayable();
    void fetchBoletosReceivable();
  }, [fetchCalendarBoletos, fetchBoletosPayable, fetchBoletosReceivable]);

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  const confirmMarkBoletoAsPaid = useCallback(async () => {
    if (!boletoResumo || !companyId) return;
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
    const updated = data as Boleto;
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
    toast.success(
      isBoletoPayable(updated)
        ? "Conta marcada como paga."
        : "Conta marcada como recebida.",
    );
  }, [boletoResumo, companyId, refreshAll]);

  const renderListCard = (b: Boleto) => {
    const payable = isBoletoPayable(b);
    const statusLabel =
      b.status === "pending"
        ? "Pendente"
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
                b.status === "pending"
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  : payable
                    ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-sky-600/15 text-sky-700 dark:text-sky-300",
              )}
            >
              {statusLabel}
            </span>
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
          {b.provider ? (
            <p className="mt-2 text-sm text-muted-foreground">{b.provider}</p>
          ) : null}
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

  const renderCalendarDayCompactCard = (b: Boleto) => {
    const payable = isBoletoPayable(b);
    const statusLabel =
      b.status === "pending" ? "Pendente" : payable ? "Pago" : "Recebido";

    return (
      <button
        key={b.id}
        type="button"
        onClick={() => setBoletoResumo(b)}
        className={cn(
          "w-full rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
          payable
            ? "border-destructive/30 dark:border-destructive/35"
            : "border-emerald-600/30 dark:border-emerald-500/35",
          "flex flex-col gap-1.5 sm:gap-2",
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-medium leading-snug">
              {formatBoletoFluxoDescription(b)}
            </p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                b.status === "pending"
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  : payable
                    ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-sky-600/15 text-sky-700 dark:text-sky-300",
              )}
            >
              {statusLabel}
            </span>
          </div>
          {b.provider ? (
            <p className="mt-1.5 truncate text-xs text-muted-foreground">
              {b.provider}
            </p>
          ) : null}
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
              payable
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

  const calendarDayReceivableItems =
    calendarDayList?.items.filter((b) => !isBoletoPayable(b)) ?? [];
  const calendarDayPayableItems =
    calendarDayList?.items.filter((b) => isBoletoPayable(b)) ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Fluxo de Caixa"
        description="Contas a pagar e a receber com calendário e listas por tipo"
        icon={FileText}
        action={
          <Button
            onClick={() => {
              setCreateBoletoDefaultDueDate(undefined);
              setBoletoSheetOpen(true);
            }}
            className="h-10 w-full shrink-0 sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            Adicionar nova conta
          </Button>
        }
      />

      <ReferencePeriodCard
        value={period}
        onChange={setPeriod}
        description="Calendário e listas usam este mês"
      />

      <nav
        className="flex flex-wrap gap-2 border-b border-border pb-px"
        aria-label="Modo de visualização"
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "calendar"}
          className={cn(
            "inline-flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2.5 text-sm font-medium transition-colors",
            activeTab === "calendar"
              ? "border-border bg-background text-foreground shadow-sm"
              : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          onClick={() => setActiveTab("calendar")}
        >
          <CalendarDays className="h-4 w-4 shrink-0" />
          Calendário
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "payable"}
          className={cn(
            "inline-flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2.5 text-sm font-medium transition-colors",
            activeTab === "payable"
              ? "border-border bg-background text-foreground shadow-sm"
              : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          onClick={() => setActiveTab("payable")}
        >
          <TrendingDown className="h-4 w-4 shrink-0 text-destructive" />
          Contas a Pagar
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "receivable"}
          className={cn(
            "inline-flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2.5 text-sm font-medium transition-colors",
            activeTab === "receivable"
              ? "border-border bg-background text-foreground shadow-sm"
              : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          onClick={() => setActiveTab("receivable")}
        >
          <TrendingUp className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          Contas a Receber
        </button>
      </nav>

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
          onSuccess={() => {
            refreshAll();
            void syncCompanyAlerts(currentCompany.id);
            if (expenseIdFromUrl) navigate("/app/despesas");
          }}
        />
      )}
      {activeTab === "calendar" ? (
        <BoletosCalendar
          month={period.month}
          year={period.year}
          boletos={calendarBoletos}
          loading={calendarLoading}
          onDayListOpen={setCalendarDayList}
          formatCurrency={formatCurrency}
        />
      ) : activeTab === "payable" ? (
        <Card>
          <CardHeader className="flex flex-col gap-5 space-y-0">
            <div>
              <CardTitle>Contas a Pagar</CardTitle>
              <CardDescription>
                Saídas previstas no mês selecionado (categorias de despesa)
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <>
              <div className="mb-4 flex flex-wrap gap-3 items-center">
                <Input
                  placeholder="Filtrar por descrição ou beneficiário..."
                  value={boletosSearchPayable}
                  onChange={(e) => setBoletosSearchPayable(e.target.value)}
                  className="max-w-sm"
                />
              </div>
              {loadingPayable ? (
                <p className="text-muted-foreground">Carregando...</p>
              ) : boletosPayable.length === 0 ? (
                <p className="text-muted-foreground">
                  Nenhuma conta a pagar neste mês
                </p>
              ) : (
                <div className="space-y-2">
                  {boletosPayable.map((b) => renderListCard(b))}
                </div>
              )}
              {!loadingPayable && (
                <Pagination
                  page={boletosPagePayable}
                  totalCount={boletosPayableCount}
                  onPageChange={setBoletosPagePayable}
                />
              )}
            </>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-col gap-5 space-y-0">
            <div>
              <CardTitle>Contas a Receber</CardTitle>
              <CardDescription>
                Entradas previstas no mês selecionado (categorias de receita)
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <>
              <div className="mb-4 flex flex-wrap gap-3 items-center">
                <Input
                  placeholder="Filtrar por descrição ou origem..."
                  value={boletosSearchReceivable}
                  onChange={(e) => setBoletosSearchReceivable(e.target.value)}
                  className="max-w-sm"
                />
              </div>
              {loadingReceivable ? (
                <p className="text-muted-foreground">Carregando...</p>
              ) : boletosReceivable.length === 0 ? (
                <p className="text-muted-foreground">
                  Nenhuma conta a receber neste mês
                </p>
              ) : (
                <div className="space-y-2">
                  {boletosReceivable.map((b) => renderListCard(b))}
                </div>
              )}
              {!loadingReceivable && (
                <Pagination
                  page={boletosPageReceivable}
                  totalCount={boletosReceivableCount}
                  onPageChange={setBoletosPageReceivable}
                />
              )}
            </>
          </CardContent>
        </Card>
      )}

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
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-4">
            {calendarDayList && calendarDayList.items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum lançamento com vencimento neste dia.
              </p>
            )}
            {calendarDayReceivableItems.length > 0 && (
              <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Contas a Receber
                </h4>
                <div className="space-y-2">
                  {calendarDayReceivableItems.map((b) =>
                    renderCalendarDayCompactCard(b),
                  )}
                </div>
              </section>
            )}
            {calendarDayPayableItems.length > 0 && (
              <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Contas a Pagar
                </h4>
                <div className="space-y-2">
                  {calendarDayPayableItems.map((b) =>
                    renderCalendarDayCompactCard(b),
                  )}
                </div>
              </section>
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
                    {formatCurrency(boletoResumo.amount)}
                  </p>
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
                    <Badge
                      variant={
                        boletoResumo.status === "paid" ? "default" : "outline"
                      }
                    >
                      {STATUS_LABELS[boletoResumo.status]}
                    </Badge>
                    {boletoResumo.provider && (
                      <span className="text-sm text-muted-foreground">
                        {boletoResumo.provider}
                      </span>
                    )}
                  </div>
                  <Badge variant="outline" className="mt-2">
                    {boletoCategoryLabel(boletoResumo)}
                  </Badge>
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
                {boletoResumo.status === "pending" && (
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
                {boletoResumo.expense_id && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setBoletoResumo(null);
                      navigate(
                        `/app/despesas?expense=${boletoResumo.expense_id}`,
                      );
                    }}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Ir para despesa
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={markPaidDialogOpen}
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
              onClick={() => void confirmMarkBoletoAsPaid()}
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
    </PageShell>
  );
}

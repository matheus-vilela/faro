import {
  BoletosCalendar,
  type CalendarDayListPayload,
} from "@/components/BoletosCalendar";
import { CreateBoletoSheet } from "@/components/CreateBoletoSheet";
import { getMonthRange, type MonthYear } from "@/components/MonthSelector";
import { ReferencePeriodCard } from "@/components/ReferencePeriodCard";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
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
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCompany } from "@/contexts/CompanyContext";
import { useDebounce } from "@/hooks/useDebounce";
import { BOLETO_CATEGORY_LABELS } from "@/lib/boletoCategory";
import { getCalendarGridDateRange } from "@/lib/boletosCalendarGrid";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Boleto, BoletoCategory, PaymentType } from "@/types/expense";
import {
  CalendarDays,
  CheckCircle2,
  Copy,
  ExternalLink,
  LayoutList,
  Loader2,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  boleto: "Boleto",
  pix: "PIX",
  ted: "TED",
};

const STATUS_LABELS = { pending: "Pendente", paid: "Pago" };

function categoryLabel(c?: BoletoCategory | null): string {
  return BOLETO_CATEGORY_LABELS[c ?? "outros"];
}

type BoletosTab = "calendar" | "list";

export function Boletos() {
  const { currentCompany } = useCompany();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const expenseIdFromUrl = searchParams.get("expense");

  const now = new Date();
  const [period, setPeriod] = useState<MonthYear>({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });
  const [activeTab, setActiveTab] = useState<BoletosTab>("calendar");

  const [calendarBoletos, setCalendarBoletos] = useState<Boleto[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(true);

  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [boletosCount, setBoletosCount] = useState(0);
  const [boletosPage, setBoletosPage] = useState(1);
  const [boletosSearch, setBoletosSearch] = useState("");
  const debouncedSearch = useDebounce(boletosSearch, 300);
  const [loading, setLoading] = useState(true);
  const [boletoSheetOpen, setBoletoSheetOpen] = useState(false);
  const [calendarDayList, setCalendarDayList] =
    useState<CalendarDayListPayload | null>(null);
  const [boletoResumo, setBoletoResumo] = useState<Boleto | null>(null);
  const [markPaidDialogOpen, setMarkPaidDialogOpen] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);

  const fetchCalendarBoletos = useCallback(async () => {
    if (!currentCompany?.id) return;
    setCalendarLoading(true);
    const { startIso, endIso } = getCalendarGridDateRange(
      period.month,
      period.year,
    );
    const { data } = await supabase
      .from("boletos")
      .select("*")
      .eq("company_id", currentCompany.id)
      .gte("due_date", startIso)
      .lte("due_date", endIso)
      .order("due_date", { ascending: true });
    setCalendarBoletos((data as Boleto[]) ?? []);
    setCalendarLoading(false);
  }, [currentCompany?.id, period.month, period.year]);

  const fetchBoletos = useCallback(async () => {
    if (!currentCompany?.id) return;
    setLoading(true);
    const { start, end } = getMonthRange(period.month, period.year);
    let query = supabase
      .from("boletos")
      .select("*", { count: "exact" })
      .eq("company_id", currentCompany.id)
      .gte("due_date", start.slice(0, 10))
      .lte("due_date", end.slice(0, 10))
      .order("due_date", { ascending: true });
    if (debouncedSearch.trim()) {
      const term = `%${debouncedSearch.trim()}%`;
      query = query.or(`description.ilike.${term},provider.ilike.${term}`);
    }
    const { data, count } = await query.range(
      (boletosPage - 1) * PAGE_SIZE,
      boletosPage * PAGE_SIZE - 1,
    );
    setBoletos((data as Boleto[]) ?? []);
    setBoletosCount(count ?? 0);
    setLoading(false);
  }, [
    currentCompany?.id,
    period.month,
    period.year,
    debouncedSearch,
    boletosPage,
  ]);

  useEffect(() => {
    setBoletosPage(1);
  }, [debouncedSearch, period.month, period.year]);

  useEffect(() => {
    void fetchCalendarBoletos();
  }, [fetchCalendarBoletos]);

  useEffect(() => {
    void fetchBoletos();
  }, [fetchBoletos]);

  useEffect(() => {
    if (expenseIdFromUrl) setBoletoSheetOpen(true);
  }, [expenseIdFromUrl]);

  useEffect(() => {
    if (activeTab !== "calendar") setCalendarDayList(null);
  }, [activeTab]);

  useEffect(() => {
    setMarkPaidDialogOpen(false);
  }, [boletoResumo?.id]);

  const refreshAll = useCallback(() => {
    void fetchCalendarBoletos();
    void fetchBoletos();
  }, [fetchCalendarBoletos, fetchBoletos]);

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
    if (!boletoResumo || !currentCompany?.id) return;
    setMarkingPaid(true);
    const { data, error } = await supabase
      .from("boletos")
      .update({
        status: "paid",
        updated_at: new Date().toISOString(),
      })
      .eq("id", boletoResumo.id)
      .eq("company_id", currentCompany.id)
      .select()
      .single();
    setMarkingPaid(false);
    if (error) {
      toast.error(error.message ?? "Não foi possível marcar como pago.");
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
    toast.success("Conta marcada como paga.");
  }, [boletoResumo, currentCompany?.id, refreshAll]);

  return (
    <PageShell>
      <PageHeader
        title="Contas a pagar"
        description="Cadastre contas a pagar e vincule às despesas"
        action={
          <Button
            onClick={() => setBoletoSheetOpen(true)}
            className="h-10 w-full shrink-0 sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nova conta
          </Button>
        }
      />

      <ReferencePeriodCard
        value={period}
        onChange={setPeriod}
        description="Calendário e lista usam este mês"
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
          aria-selected={activeTab === "list"}
          className={cn(
            "inline-flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2.5 text-sm font-medium transition-colors",
            activeTab === "list"
              ? "border-border bg-background text-foreground shadow-sm"
              : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          onClick={() => setActiveTab("list")}
        >
          <LayoutList className="h-4 w-4 shrink-0" />
          Lista
        </button>
      </nav>

      {currentCompany?.id && (
        <CreateBoletoSheet
          open={boletoSheetOpen}
          onOpenChange={(open) => {
            setBoletoSheetOpen(open);
            if (!open && expenseIdFromUrl) navigate("/app/despesas");
          }}
          companyId={currentCompany.id}
          expenseId={expenseIdFromUrl}
          onSuccess={() => {
            refreshAll();
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
          onDayBoletoClick={setBoletoResumo}
          formatCurrency={formatCurrency}
        />
      ) : (
        <Card>
          <CardHeader className="flex flex-col gap-5 space-y-0">
            <div>
              <CardTitle>Lista de contas</CardTitle>
              <CardDescription>
                Listagem detalhada com filtro e paginação
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <>
              <div className="mb-4 flex flex-wrap gap-3 items-center">
                <Input
                  placeholder="Filtrar por descrição ou provedor..."
                  value={boletosSearch}
                  onChange={(e) => setBoletosSearch(e.target.value)}
                  className="max-w-sm"
                />
              </div>
              {loading ? (
                <p className="text-muted-foreground">Carregando...</p>
              ) : boletos.length === 0 ? (
                <p className="text-muted-foreground">
                  Nenhum boleto cadastrado
                </p>
              ) : (
                <div className="space-y-2">
                  {boletos.map((b) => (
                    <div
                      key={b.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setBoletoResumo(b)}
                      onKeyDown={(e) => e.key === "Enter" && setBoletoResumo(b)}
                      className="flex flex-col gap-3 rounded-lg border p-4 cursor-pointer transition-colors hover:bg-muted/50 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-snug">
                          {b.description}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-primary rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5">
                            {categoryLabel(b.category)}
                          </span>
                          <span className="text-xs font-medium text-muted-foreground rounded-md bg-muted px-2 py-0.5">
                            {PAYMENT_TYPE_LABELS[b.payment_type ?? "boleto"]}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {STATUS_LABELS[b.status]}
                          </span>
                        </div>
                        {b.provider ? (
                          <p className="mt-2 text-sm text-muted-foreground">
                            {b.provider}
                          </p>
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
                        <p className="text-md font-bold tabular-nums text-primary sm:text-lg">
                          {formatCurrency(b.amount)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!loading && (
                <Pagination
                  page={boletosPage}
                  totalCount={boletosCount}
                  onPageChange={setBoletosPage}
                />
              )}
            </>
          </CardContent>
        </Card>
      )}

      <Sheet
        // modal={!boletoResumo}
        open={!!calendarDayList}
        onOpenChange={(o) => !o && setCalendarDayList(null)}
      >
        <SheetContent className="z-50 flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <SheetHeader className="shrink-0 space-y-1 border-b px-6 py-4 pr-12 text-left">
            <SheetTitle className="capitalize">Contas neste dia</SheetTitle>
            <SheetDescription className="capitalize">
              {calendarDayList?.title}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-4">
            {calendarDayList?.items.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBoletoResumo(b)}
                className={cn(
                  "w-full rounded-lg border p-3 text-left text-sm transition-colors",
                  b.status === "paid"
                    ? "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted/60"
                    : "border-primary/25 bg-primary/10 hover:bg-primary/15 dark:border-primary/35 dark:bg-primary/15 dark:hover:bg-primary/20",
                )}
              >
                <span className="font-medium">{b.description}</span>
                <div className="flex items-center justify-between">
                  <span className="mt-1 block text-lg font-semibold tabular-nums text-primary">
                    {formatCurrency(b.amount)}
                  </span>
                  <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    {/* {PAYMENT_TYPE_LABELS[b.payment_type ?? "boleto"]} */}
                    <span className="mt-0.5 block text-[11px] text-primary">
                      {categoryLabel(b.category)}
                    </span>
                    {b.status === "paid" ? " · Pago" : " · Pendente"}
                  </span>
                </div>
              </button>
            ))}
          </div>
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
                <SheetTitle>Resumo do boleto</SheetTitle>
                <SheetDescription>Dados para pagamento</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 py-6">
                <div>
                  <p className="font-semibold">{boletoResumo.description}</p>
                  <p className="text-2xl font-bold text-primary mt-1">
                    {formatCurrency(boletoResumo.amount)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Vencimento: {formatDate(boletoResumo.due_date)}
                  </p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge
                      variant="outline"
                      className="border-primary/30 bg-primary/10 text-primary"
                    >
                      {categoryLabel(boletoResumo.category)}
                    </Badge>
                    <Badge variant="secondary">
                      {
                        PAYMENT_TYPE_LABELS[
                          boletoResumo.payment_type ?? "boleto"
                        ]
                      }
                    </Badge>
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
                    Marcar como pago
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
            <DialogTitle>Marcar como pago</DialogTitle>
            <DialogDescription>
              Confirma que esta conta já foi quitada? Ela será marcada como paga
              nesta empresa.
            </DialogDescription>
          </DialogHeader>
          {boletoResumo && (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <p className="font-medium">{boletoResumo.description}</p>
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

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  FileText,
  Loader2,
  PackageX,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

type PendingRow = {
  id: string;
  kind: string;
  status: "OPEN" | "RESOLVED" | "IGNORED";
  title: string;
  detail: string | null;
  created_at: string;
};

export function DashboardAlertsCard({
  loading,
  totalAlerts,
  lowStock,
  withoutBoleto,
  notReceived,
  boletoD3,
  boletoD1,
  importPending,
}: {
  loading: boolean;
  totalAlerts: number;
  lowStock: number;
  withoutBoleto: number;
  notReceived: number;
  boletoD3: number;
  boletoD1: number;
  importPending: number;
}) {
  const { currentCompany } = useCompany();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [status, setStatus] = useState<"all" | "OPEN" | "RESOLVED" | "IGNORED">("OPEN");
  const [kind, setKind] = useState<string>("all");
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(importPending);

  const loadPendingRows = useCallback(async () => {
    if (!currentCompany?.id) return;
    setLoadingPending(true);
    let q = supabase
      .from("import_review_pending")
      .select("id, kind, status, title, detail, created_at")
      .eq("company_id", currentCompany.id)
      .order("created_at", { ascending: false })
      .limit(300);
    if (status !== "all") q = q.eq("status", status);
    if (kind !== "all") q = q.eq("kind", kind);

    const [{ data, error }, { count, error: countError }] = await Promise.all([
      q,
      supabase
        .from("import_review_pending")
        .select("id", { count: "exact", head: true })
        .eq("company_id", currentCompany.id)
        .eq("status", "OPEN"),
    ]);
    setLoadingPending(false);

    if (error || countError) {
      return;
    }
    setRows((data ?? []) as PendingRow[]);
    setPendingCount(count ?? 0);
  }, [currentCompany?.id, kind, status]);

  useEffect(() => {
    setPendingCount(importPending);
  }, [importPending]);

  useEffect(() => {
    if (!sheetOpen) return;
    void loadPendingRows();
  }, [loadPendingRows, sheetOpen]);

  const closePending = async (id: string, next: "RESOLVED" | "IGNORED") => {
    const previous = rows;
    setBusy(id);
    setRows((current) => current.map((row) => (row.id === id ? { ...row, status: next } : row)));
    setPendingCount((current) => Math.max(0, current - 1));

    const { error } = await supabase
      .from("import_review_pending")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", id);

    setBusy(null);
    if (error) {
      setRows(previous);
      setPendingCount((current) => current + 1);
      return;
    }
  };

  const displayedPendingCount = useMemo(() => Math.max(0, pendingCount), [pendingCount]);

  return (
    <Card className="overflow-hidden border-l-4 border-l-amber-500/80 shadow-sm ring-1 ring-border/60">
      <CardHeader className="border-b border-border/50 bg-linear-to-br from-amber-500/[0.07] to-transparent pb-4 dark:from-amber-500/12">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-400">
              <Bell className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-lg font-semibold tracking-tight">
                Alertas da operação
              </CardTitle>
              <CardDescription className="mt-1">
                Estoque, recebimentos e despesas — toque para abrir só aquele
                tipo.
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" asChild>
            <Link to="/app/alertas">
              Ver todos
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando alertas…
          </div>
        ) : totalAlerts === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/25 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum alerta aberto. Boa conferência.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            <li>
              <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-900 dark:text-amber-400">
                        <Bell className="h-4 w-4" />
                      </span>
                      <span className="truncate">Pendências da importação</span>
                    </span>
                    <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                      {displayedPendingCount}
                    </span>
                  </button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full p-0 sm:max-w-2xl">
                  <SheetHeader className="border-b px-4 py-3">
                    <SheetTitle>Central de pendências</SheetTitle>
                    <SheetDescription>
                      Resolva conflitos sem sair do dashboard.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="space-y-4 overflow-y-auto p-4">
                    <div className="flex items-center justify-between rounded-lg border bg-card p-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Itens pendentes</p>
                        <Badge className="mt-1 bg-destructive text-destructive-foreground hover:bg-destructive">
                          {displayedPendingCount} pendente{displayedPendingCount === 1 ? "" : "s"}
                        </Badge>
                      </div>
                    </div>
                    <Card>
                      <CardHeader>
                        <CardTitle>Filtros</CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-wrap gap-3">
                        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                          <SelectTrigger className="w-[180px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todos status</SelectItem>
                            <SelectItem value="OPEN">Abertos</SelectItem>
                            <SelectItem value="RESOLVED">Resolvidos</SelectItem>
                            <SelectItem value="IGNORED">Ignorados</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={kind} onValueChange={setKind}>
                          <SelectTrigger className="w-[240px]">
                            <SelectValue placeholder="Tipo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todos tipos</SelectItem>
                            <SelectItem value="missing_conversion">Sem conversão</SelectItem>
                            <SelectItem value="missing_category">Sem categoria</SelectItem>
                            <SelectItem value="unit_conflict">Conflito de unidade</SelectItem>
                            <SelectItem value="possible_duplicate">Possível duplicidade</SelectItem>
                            <SelectItem value="missing_product_match">Sem vínculo de produto</SelectItem>
                          </SelectContent>
                        </Select>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle>Lista</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {loadingPending ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Carregando pendências...
                          </div>
                        ) : rows.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Nenhuma pendência para o filtro atual.</p>
                        ) : rows.map((r) => {
                          const isResolved = r.status === "RESOLVED";
                          const isOpen = r.status === "OPEN";
                          return (
                            <div
                              key={r.id}
                              className={cn(
                                "rounded-lg border p-3 transition-all",
                                isResolved && "border-emerald-500/70 bg-emerald-50/40 py-2 dark:bg-emerald-950/20"
                              )}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className={cn("text-sm font-medium", isResolved && "text-emerald-700 dark:text-emerald-300")}>{r.title}</p>
                                <div className="flex items-center gap-2">
                                  {isResolved ? (
                                    <Badge variant="outline" className="border-emerald-500 text-emerald-700 dark:text-emerald-300">
                                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                      Resolvido
                                    </Badge>
                                  ) : null}
                                  <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-BR")}</span>
                                </div>
                              </div>
                              {!isResolved ? (
                                <>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Tipo: <strong>{r.kind}</strong> · Status: <strong>{r.status}</strong>
                                  </p>
                                  {r.detail ? <p className="mt-1 text-sm text-muted-foreground">{r.detail}</p> : null}
                                </>
                              ) : null}
                              {isOpen ? (
                                <div className="mt-2 flex gap-2">
                                  <Button size="sm" onClick={() => void closePending(r.id, "RESOLVED")} disabled={busy === r.id}>
                                    Resolver
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => void closePending(r.id, "IGNORED")} disabled={busy === r.id}>
                                    Ignorar
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  </div>
                </SheetContent>
              </Sheet>
            </li>
            <li>
              <Link
                to="/app/alertas?kind=boleto_vencimento_d1"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-800 dark:text-red-400">
                    <CalendarClock className="h-4 w-4" />
                  </span>
                  <span className="truncate">Boletos D-1 (amanhã)</span>
                </span>
                <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                  {boletoD1}
                </span>
              </Link>
            </li>
            <li>
              <Link
                to="/app/alertas?kind=boleto_vencimento_d3"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-900 dark:text-amber-400">
                    <CalendarClock className="h-4 w-4" />
                  </span>
                  <span className="truncate">Boletos D-3 (em 3 dias)</span>
                </span>
                <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                  {boletoD3}
                </span>
              </Link>
            </li>
            <li>
              <Link
                to="/app/alertas?kind=recebimento_falta"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/15 text-orange-800 dark:text-orange-400">
                    <PackageX className="h-4 w-4" />
                  </span>
                  <span className="truncate">Itens não entregues</span>
                </span>
                <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                  {notReceived}
                </span>
              </Link>
            </li>
            <li>
              <Link
                to="/app/alertas?kind=expense_no_boleto"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-900 dark:text-amber-400">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="truncate">Despesas sem boleto</span>
                </span>
                <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                  {withoutBoleto}
                </span>
              </Link>
            </li>
            <li>
              <Link
                to="/app/produtos?estoque=baixo"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-800 dark:text-rose-400">
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <span className="truncate">Estoque baixo</span>
                </span>
                <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                  {lowStock}
                </span>
              </Link>
            </li>
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

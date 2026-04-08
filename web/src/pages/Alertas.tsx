import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/contexts/CompanyContext";
import {
  dismissCompanyAlert,
  syncCompanyAlerts,
} from "@/lib/companyAlerts/syncCompanyAlerts";
import { canGestorAccess } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyAlertKind, CompanyAlertRow } from "@/types/companyAlert";
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Package,
  PackageX,
  RefreshCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

const KIND_LABEL: Record<CompanyAlertKind, string> = {
  low_stock: "Estoque baixo",
  expense_no_boleto: "Sem boleto",
  recebimento_falta: "Falta no recebimento",
  boleto_vencimento_d3: "Boleto a pagar",
  boleto_vencimento_d1: "Boleto a pagar",
};

function isBoletoVencimentoKind(k: CompanyAlertKind): boolean {
  return k === "boleto_vencimento_d3" || k === "boleto_vencimento_d1";
}

function VencimentoWindowBadge({ kind }: { kind: CompanyAlertKind }) {
  if (kind === "boleto_vencimento_d3") {
    return (
      <Badge
        variant="outline"
        className="border-amber-600/45 bg-amber-500/15 text-[11px] font-bold uppercase tracking-wide text-amber-950 dark:border-amber-500/50 dark:text-amber-100"
      >
        D-3
      </Badge>
    );
  }
  if (kind === "boleto_vencimento_d1") {
    return (
      <Badge
        variant="destructive"
        className="text-[11px] font-bold uppercase tracking-wide"
      >
        D-1
      </Badge>
    );
  }
  return null;
}

function severityBadgeVariant(
  s: CompanyAlertRow["severity"],
): "default" | "secondary" | "destructive" | "outline" {
  if (s === "danger") return "destructive";
  if (s === "warning") return "secondary";
  return "outline";
}

function alertCardAccent(severity: CompanyAlertRow["severity"]) {
  return cn(
    "border-l-4 shadow-sm transition-shadow hover:shadow-md",
    severity === "danger" &&
      "border-l-destructive bg-gradient-to-br from-destructive/[0.06] to-card dark:from-destructive/10",
    severity === "warning" &&
      "border-l-amber-500 bg-gradient-to-br from-amber-500/[0.07] to-card dark:from-amber-500/15",
    severity === "info" &&
      "border-l-sky-500 bg-gradient-to-br from-sky-500/[0.06] to-card dark:from-sky-500/10",
  );
}

function kindIconWrap(kind: CompanyAlertKind) {
  return cn(
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border",
    kind === "low_stock" &&
      "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    kind === "expense_no_boleto" &&
      "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    kind === "recebimento_falta" &&
      "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-400",
    kind === "boleto_vencimento_d3" &&
      "border-amber-600/35 bg-amber-500/12 text-amber-800 dark:text-amber-300",
    kind === "boleto_vencimento_d1" &&
      "border-red-500/35 bg-red-500/12 text-red-800 dark:text-red-400",
  );
}

function KindIcon({ kind }: { kind: CompanyAlertKind }) {
  const cls = "h-5 w-5";
  if (kind === "low_stock") return <Package className={cls} strokeWidth={2} />;
  if (kind === "expense_no_boleto")
    return <FileText className={cls} strokeWidth={2} />;
  if (kind === "boleto_vencimento_d3" || kind === "boleto_vencimento_d1")
    return <CalendarClock className={cls} strokeWidth={2} />;
  return <PackageX className={cls} strokeWidth={2} />;
}

export function Alertas() {
  const { currentCompany, currentRole } = useCompany();
  const companyId = currentCompany?.id;
  const canSee = currentRole ? canGestorAccess(currentRole) : false;
  const [searchParams, setSearchParams] = useSearchParams();

  const kindFilter = useMemo(() => {
    const k = searchParams.get("kind");
    if (
      k === "recebimento_falta" ||
      k === "expense_no_boleto" ||
      k === "low_stock" ||
      k === "boleto_vencimento_d3" ||
      k === "boleto_vencimento_d1"
    ) {
      return k;
    }
    return "all";
  }, [searchParams]);

  const handleKindFilterChange = (v: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v === "all") next.delete("kind");
        else next.set("kind", v);
        return next;
      },
      { replace: true },
    );
  };

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [rows, setRows] = useState<CompanyAlertRow[]>([]);
  const [search, setSearch] = useState("");
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [alertToDismiss, setAlertToDismiss] = useState<CompanyAlertRow | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!companyId || !canSee) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("company_alerts")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "open")
      .order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      setRows([]);
    } else {
      setRows((data ?? []) as CompanyAlertRow[]);
    }
    setLoading(false);
  }, [companyId, canSee]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const handleRefresh = async () => {
    if (!currentCompany?.id || !canSee) return;
    setSyncing(true);
    await syncCompanyAlerts(currentCompany.id);
    const { data, error } = await supabase
      .from("company_alerts")
      .select("*")
      .eq("company_id", currentCompany.id)
      .eq("status", "open")
      .order("created_at", { ascending: false });
    if (!error) setRows((data ?? []) as CompanyAlertRow[]);
    setSyncing(false);
  };

  const confirmDismissAlert = async () => {
    if (!alertToDismiss) return;
    const id = alertToDismiss.id;
    setDismissingId(id);
    const ok = await dismissCompanyAlert(id);
    setDismissingId(null);
    if (ok) {
      setRows((prev) => prev.filter((r) => r.id !== id));
      setAlertToDismiss(null);
    }
  };

  const filtered = useMemo(() => {
    let list = rows;
    if (kindFilter !== "all") {
      list = list.filter((r) => r.kind === kindFilter);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.message ?? "").toLowerCase().includes(q) ||
        KIND_LABEL[r.kind].toLowerCase().includes(q) ||
        (r.kind === "boleto_vencimento_d3" && q.includes("d-3")) ||
        (r.kind === "boleto_vencimento_d1" && q.includes("d-1")),
    );
  }, [rows, kindFilter, search]);

  const totalOpen = rows.length;

  if (!canSee) {
    return (
      <PageShell className="space-y-8" narrow>
        <PageHeader
          title="Alertas"
          description="Resumo operacional e financeiro"
          icon={Bell}
        />
        <Card>
          <CardHeader>
            <CardTitle>Acesso restrito</CardTitle>
            <CardDescription>
              Apenas gestores e proprietários visualizam esta página.
            </CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="space-y-8" narrow>
      <PageHeader
        title="Alertas"
        description="Estoque, recebimentos, despesas sem boleto e contas a pagar (D-3 / D-1) com vencimento em boletos"
        icon={Bell}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {totalOpen > 0 && (
              <Badge variant="secondary" className="text-base px-3 py-1">
                {totalOpen} aberto{totalOpen !== 1 ? "s" : ""}
              </Badge>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => void handleRefresh()}
              disabled={syncing || loading || !currentCompany?.id}
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-2 hidden sm:inline">Atualizar</span>
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          placeholder="Buscar por título ou detalhe..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <Select value={kindFilter} onValueChange={handleKindFilterChange}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="low_stock">{KIND_LABEL.low_stock}</SelectItem>
            <SelectItem value="expense_no_boleto">
              {KIND_LABEL.expense_no_boleto}
            </SelectItem>
            <SelectItem value="recebimento_falta">
              {KIND_LABEL.recebimento_falta}
            </SelectItem>
            <SelectItem value="boleto_vencimento_d1">
              Vencimento D-1 (amanhã)
            </SelectItem>
            <SelectItem value="boleto_vencimento_d3">
              Vencimento D-3 (em 3 dias)
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        </div>
      ) : totalOpen === 0 ? (
        <Card className="border-dashed border-2 bg-muted/20">
          <CardContent className="flex flex-col items-center justify-center py-16 px-6">
            <div className="rounded-2xl bg-emerald-500/10 p-5 mb-5 ring-1 ring-emerald-500/20">
              <CheckCircle2 className="h-14 w-14 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h3 className="text-lg font-semibold tracking-tight">
              Tudo em ordem
            </h3>
            <p className="text-muted-foreground text-center max-w-sm mt-2 text-sm leading-relaxed">
              Não há alertas abertos. Use &quot;Atualizar&quot; para sincronizar
              com as regras atuais (estoque, boletos e recebimentos).
            </p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nenhum resultado com os filtros atuais.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {filtered.map((r) => (
            <li key={r.id}>
              <div
                className={cn(
                  "flex flex-col gap-4 rounded-xl border border-border/80 p-4 sm:flex-row sm:items-start sm:gap-5",
                  alertCardAccent(r.severity),
                )}
              >
                <div className={kindIconWrap(r.kind)}>
                  <KindIcon kind={r.kind} />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <VencimentoWindowBadge kind={r.kind} />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {KIND_LABEL[r.kind]}
                    </span>
                    {!isBoletoVencimentoKind(r.kind) ? (
                      <Badge
                        variant={severityBadgeVariant(r.severity)}
                        className="text-[10px] uppercase tracking-wide"
                      >
                        {r.severity === "danger"
                          ? "Alta"
                          : r.severity === "warning"
                            ? "Média"
                            : "Info"}
                      </Badge>
                    ) : null}
                  </div>
                  <h3 className="font-display text-base font-semibold leading-snug tracking-[-0.02em] text-foreground">
                    {r.title}
                  </h3>
                  {r.message ? (
                    <p className="text-sm leading-relaxed text-muted-foreground line-clamp-3">
                      {r.message}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-row items-center justify-end gap-2 border-t border-border/50 pt-3 sm:border-t-0 sm:pt-0 sm:flex-col sm:items-stretch">
                  {r.link_path ? (
                    <Button
                      variant="default"
                      size="sm"
                      className="gap-1.5"
                      asChild
                    >
                      <Link to={r.link_path}>
                        <ExternalLink className="h-3.5 w-3.5" />
                        Abrir
                      </Link>
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setAlertToDismiss(r)}
                    disabled={dismissingId === r.id}
                    aria-label="Dispensar alerta"
                  >
                    <X className="h-4 w-4" />
                    Dispensar
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={!!alertToDismiss}
        onOpenChange={(open) => {
          if (!open && !dismissingId) setAlertToDismiss(null);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Dispensar este alerta?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  O alerta será ocultado da lista. Enquanto a situação continuar
                  (por exemplo, estoque ainda abaixo do mínimo), ele não será
                  exibido de novo automaticamente.
                </p>
                {alertToDismiss ? (
                  <p className="rounded-md border bg-muted/50 px-3 py-2 text-foreground font-medium line-clamp-2">
                    {alertToDismiss.title}
                  </p>
                ) : null}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAlertToDismiss(null)}
              disabled={!!dismissingId}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void confirmDismissAlert()}
              disabled={!!dismissingId}
            >
              {dismissingId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
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

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { readEpocCsvSyncPending } from "@/lib/epocCsvSyncProgress";
import { supabase } from "@/lib/supabase";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

function epocCsvDashboardAckKey(companyId: string): string {
  return `faro:epocCsvRevenueDashboardAck:${companyId}`;
}

function loadDashboardAckJobId(companyId: string): string | null {
  try {
    return localStorage.getItem(epocCsvDashboardAckKey(companyId));
  } catch {
    return null;
  }
}

function saveDashboardAckJobId(companyId: string, jobId: string): void {
  try {
    localStorage.setItem(epocCsvDashboardAckKey(companyId), jobId);
  } catch {
    /* ignore */
  }
}

export type IntegrationCsvRevenueJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

type JobRow = {
  id: string;
  status: IntegrationCsvRevenueJobStatus;
  provider: string;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  csv_resume_row_index: number | null;
  metadata: Record<string, unknown> | null;
};

function statusLabel(s: IntegrationCsvRevenueJobStatus): string {
  switch (s) {
    case "PENDING":
      return "Na fila";
    case "PROCESSING":
      return "A processar";
    case "COMPLETED":
      return "Concluído";
    case "FAILED":
      return "Erro";
    default:
      return s;
  }
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} d`;
}

export function DashboardIntegrationCsvRevenueCard({
  companyId,
}: {
  companyId: string | undefined;
}) {
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  /** `epoc-sync-csv` a correr (ainda sem linha em `integration_csv_revenue_import_jobs`). */
  const [edgeSyncPending, setEdgeSyncPending] = useState(false);
  const [acknowledgedJobId, setAcknowledgedJobId] = useState<string | null>(
    () => (companyId ? loadDashboardAckJobId(companyId) : null),
  );

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!companyId) {
        setJobs([]);
        if (!opts?.silent) setLoading(false);
        return;
      }
      if (!opts?.silent) setLoading(true);
      const { data, error } = await supabase
        .from("integration_csv_revenue_import_jobs")
        .select(
          "id, status, provider, created_at, updated_at, error_message, csv_resume_row_index, metadata",
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(12);

      if (error) {
        console.error("[DashboardIntegrationCsvRevenueCard]", error);
        setJobs([]);
      } else {
        setJobs((data ?? []) as JobRow[]);
      }
      if (!opts?.silent) setLoading(false);
    },
    [companyId],
  );

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (!companyId) {
      queueMicrotask(() => setEdgeSyncPending(false));
      return;
    }
    const tick = () => setEdgeSyncPending(readEpocCsvSyncPending(companyId));
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, [companyId]);

  useEffect(() => {
    if (!companyId) {
      queueMicrotask(() => setAcknowledgedJobId(null));
      return;
    }
    queueMicrotask(() =>
      setAcknowledgedJobId(loadDashboardAckJobId(companyId)),
    );
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith("faro:epocCsvSyncPending:")) {
        setEdgeSyncPending(readEpocCsvSyncPending(companyId));
      }
      if (e.key === epocCsvDashboardAckKey(companyId)) {
        setAcknowledgedJobId(loadDashboardAckJobId(companyId));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [companyId]);

  const hasActive = useMemo(
    () => jobs.some((j) => j.status === "PENDING" || j.status === "PROCESSING"),
    [jobs],
  );

  const pollImportJobs = useMemo(
    () => hasActive || edgeSyncPending,
    [hasActive, edgeSyncPending],
  );

  useEffect(() => {
    if (!companyId || !pollImportJobs) return;
    const ms = edgeSyncPending && !hasActive ? 4000 : 12_000;
    const id = window.setInterval(() => void load({ silent: true }), ms);
    return () => window.clearInterval(id);
  }, [companyId, pollImportJobs, hasActive, edgeSyncPending, load]);

  const primary = useMemo(() => {
    const active = jobs.find(
      (j) => j.status === "PENDING" || j.status === "PROCESSING",
    );
    if (active) return active;
    return jobs[0] ?? null;
  }, [jobs]);

  const isTerminal =
    primary?.status === "COMPLETED" || primary?.status === "FAILED";

  const terminalAcked =
    !!primary && isTerminal && acknowledgedJobId === primary.id;

  const showCard = !!companyId && (loading || edgeSyncPending || hasActive || (primary && !terminalAcked));

  const onConfirmTerminal = useCallback(() => {
    if (!companyId || !primary || !isTerminal) return;
    saveDashboardAckJobId(companyId, primary.id);
    setAcknowledgedJobId(primary.id);
  }, [companyId, primary, isTerminal]);

  const progressPercent = useMemo(() => {
    if (edgeSyncPending && !hasActive) return 18;
    if (!primary || primary.status === "FAILED") return 0;
    if (primary.status === "COMPLETED") return 100;
    const meta = primary.metadata ?? {};
    const total = Number(meta.csv_total_data_rows ?? 0);
    const cur = Math.max(0, Number(primary.csv_resume_row_index ?? 0));
    if (total <= 0) return primary.status === "PROCESSING" ? 8 : 0;
    return Math.min(100, Math.round((cur / total) * 100));
  }, [primary, edgeSyncPending, hasActive]);

  const subtitle = useMemo(() => {
    if (edgeSyncPending && !hasActive) {
      return "A função epoc-sync-csv está a ligar ao portal e a guardar a tabela/CSV. Depois disso o import de receitas entra na fila.";
    }
    if (!primary) {
      return "Quando sincronizar o CSV da EPOC, o progresso do import de receitas aparece aqui.";
    }
    const meta = primary.metadata ?? {};
    const created = Number(meta.revenue_entries_created_total ?? 0) || 0;
    const skipped = Number(meta.rows_skipped_total ?? 0) || 0;
    const totalRows = Number(meta.csv_total_data_rows ?? 0) || null;
    if (primary.status === "COMPLETED") {
      return `${created} receita(s) criadas${skipped ? ` · ${skipped} linha(s) ignoradas` : ""}${totalRows ? ` · ${totalRows} linhas no CSV` : ""}.`;
    }
    if (primary.status === "FAILED") {
      return (
        primary.error_message?.slice(0, 220) ||
        "O processamento falhou; reveja a integração e os logs."
      );
    }
    if (primary.status === "PENDING") {
      return "Aguardando o processador (webhook ou fila). Pode levar alguns segundos.";
    }
    return `${created} receita(s) até agora · ${skipped} ignoradas${totalRows ? ` · linha ${Math.min(primary.csv_resume_row_index ?? 0, totalRows)}/${totalRows}` : ""}.`;
  }, [primary, edgeSyncPending, hasActive]);

  const percent = Math.max(0, Math.min(100, progressPercent));
  const showAnyActive = hasActive || edgeSyncPending;
  const showSpinner = loading || showAnyActive;

  if (!showCard) {
    return null;
  }

  return (
    <Card className="border-2 border-sky-500/45 bg-linear-to-r from-sky-500/15 via-cyan-500/12 to-emerald-500/10 shadow-md">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/30 text-sky-950 ring-1 ring-sky-700/20 dark:text-sky-100">
              {showSpinner ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : primary?.status === "COMPLETED" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
              ) : primary?.status === "FAILED" ? (
                <AlertCircle className="h-5 w-5 text-destructive" />
              ) : (
                <FileSpreadsheet className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-sky-900/85 dark:text-sky-100/85">
                Integração EPOC · receitas (CSV)
              </p>
              <h3 className="text-lg font-black tracking-tight text-foreground sm:text-xl">
                {hasActive
                  ? "Import de receitas em curso"
                  : edgeSyncPending
                    ? "Sincronização EPOC em curso"
                    : primary
                      ? `Sincronização EPOC: ${statusLabel(primary.status)}`
                      : "Nenhum import de CSV recente"}
              </h3>
              <p className="mt-1 text-sm font-medium text-sky-950/90 dark:text-sky-100/90">
                {loading ? "A carregar…" : subtitle}
              </p>
              {primary && !(edgeSyncPending && !hasActive) ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatRelativeTime(primary.created_at)} ·{" "}
                  <span className="font-mono text-[11px]">
                    {primary.id.slice(0, 8)}…
                  </span>
                  {primary.provider ? ` · ${primary.provider}` : null}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            {primary && isTerminal && !terminalAcked ? (
              <Button size="sm" type="button" onClick={onConfirmTerminal}>
                Confirmar
              </Button>
            ) : null}
            {primary?.status === "FAILED" && !terminalAcked ? (
              <Button size="sm" variant="secondary" asChild>
                <Link to="/app/integracoes">
                  Ver detalhes
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            ) : null}
            <Button size="sm" className="shrink-0" variant="outline" asChild>
              <Link to="/app/integracoes">
                Abrir integrações
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-sky-950/15 dark:bg-sky-100/20">
          <div
            className="h-full rounded-full bg-linear-to-r from-sky-500 to-cyan-500 transition-all"
            style={{
              width: `${showSpinner ? Math.max(12, percent) : primary?.status === "FAILED" ? 0 : percent}%`,
            }}
            aria-hidden
          />
        </div>

        {/* {jobs.length > 1 ? (
          <ul className="mt-4 space-y-1.5 border-t border-sky-900/10 pt-3 text-xs text-muted-foreground dark:border-sky-100/15">
            {jobs.slice(0, 5).map((j) => (
              <li
                key={j.id}
                className="flex flex-wrap items-baseline justify-between gap-2"
              >
                <span>
                  <span className="font-medium text-foreground">
                    {statusLabel(j.status)}
                  </span>{" "}
                  <span className="font-mono">{j.id.slice(0, 8)}</span>
                </span>
                <span>{formatRelativeTime(j.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : null} */}
      </CardContent>
    </Card>
  );
}

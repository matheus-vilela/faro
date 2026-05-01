import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  clearEpocCsvSyncPending,
  readEpocCsvSyncPending,
} from "@/lib/epocCsvSyncProgress";
import { supabase } from "@/lib/supabase";
import { invokeEpocCsvSync } from "@/services/epocSyncCsvService";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

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

type SyncRunRow = {
  outcome: string;
  summary: string;
  created_at: string;
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

/**
 * Banner no dashboard apenas enquanto o primeiro import de receitas (CSV → fila) não
 * for concluído com sucesso, com integração EPOC ativa.
 */
export function DashboardIntegrationCsvRevenueCard({
  companyId,
}: {
  companyId: string | undefined;
}) {
  const [bootLoading, setBootLoading] = useState(true);
  const [epocEnabled, setEpocEnabled] = useState(false);
  /** Algum job epoc já chegou a COMPLETED alguma vez nesta empresa. */
  const [hadCompletedEpocImport, setHadCompletedEpocImport] = useState(false);

  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  /** Última tentativa registada na tabela epoc_csv_sync_runs (ex.: no_tbl_export). */
  const [latestSyncRun, setLatestSyncRun] = useState<SyncRunRow | null>(null);

  const [edgeSyncPending, setEdgeSyncPending] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  /** Evita flicker entre fim da edge e aparecimento do job. */
  const [stickyVisible, setStickyVisible] = useState(false);

  const loadBootstrap = useCallback(async () => {
    if (!companyId) {
      setEpocEnabled(false);
      setHadCompletedEpocImport(false);
      setLatestSyncRun(null);
      setBootLoading(false);
      return;
    }
    setBootLoading(true);
    const [intRes, completedRes, runRes] = await Promise.all([
      supabase
        .from("company_integrations")
        .select("enabled")
        .eq("company_id", companyId)
        .eq("provider", "epoc")
        .maybeSingle(),
      supabase
        .from("integration_csv_revenue_import_jobs")
        .select("id")
        .eq("company_id", companyId)
        .eq("provider", "epoc")
        .eq("status", "COMPLETED")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("epoc_csv_sync_runs")
        .select("outcome,summary,created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const enabled =
      intRes.data?.enabled === true && !intRes.error ? true : false;
    const hadDone = !!completedRes.data?.id && !completedRes.error;
    const runErr = !!runRes.error;
    const run =
      runErr || !runRes.data
        ? null
        : {
            outcome: String(runRes.data.outcome ?? ""),
            summary: String(runRes.data.summary ?? ""),
            created_at: String(runRes.data.created_at ?? ""),
          };

    setEpocEnabled(enabled);
    setHadCompletedEpocImport(hadDone);
    setLatestSyncRun(run);
    setBootLoading(false);
  }, [companyId]);

  const loadJobs = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!companyId) {
        setJobs([]);
        if (!opts?.silent) setJobsLoading(false);
        return;
      }
      if (!opts?.silent) setJobsLoading(true);
      const { data, error } = await supabase
        .from("integration_csv_revenue_import_jobs")
        .select(
          "id, status, provider, created_at, updated_at, error_message, csv_resume_row_index, metadata",
        )
        .eq("company_id", companyId)
        .eq("provider", "epoc")
        .order("created_at", { ascending: false })
        .limit(12);

      if (error) {
        console.error("[DashboardIntegrationCsvRevenueCard]", error);
        setJobs([]);
      } else {
        setJobs((data ?? []) as JobRow[]);
      }
      if (!opts?.silent) setJobsLoading(false);
    },
    [companyId],
  );

  const load = useCallback(async () => {
    await Promise.all([loadBootstrap(), loadJobs()]);
  }, [loadBootstrap, loadJobs]);

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
    if (!companyId) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith("faro:epocCsvSyncPending:")) {
        setEdgeSyncPending(readEpocCsvSyncPending(companyId));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [companyId]);

  /** Enquanto houver erro de sync registado mas nenhuma atividade nova, sugere novo sync. */
  const syncEndedWithIssue = useMemo(() => {
    if (!latestSyncRun) return false;
    return (
      latestSyncRun.outcome === "no_tbl_export" ||
      latestSyncRun.outcome === "failed"
    );
  }, [latestSyncRun]);

  const hasActive = useMemo(
    () => jobs.some((j) => j.status === "PENDING" || j.status === "PROCESSING"),
    [jobs],
  );

  const primary = useMemo(() => {
    const active = jobs.find(
      (j) => j.status === "PENDING" || j.status === "PROCESSING",
    );
    if (active) return active;
    return jobs[0] ?? null;
  }, [jobs]);

  const isTerminalFailure =
    primary?.status === "FAILED" ||
    (syncEndedWithIssue &&
      !primary &&
      !hasActive &&
      !edgeSyncPending);

  const onboardingBannerEligible =
    !!companyId && epocEnabled && !hadCompletedEpocImport;

  useEffect(() => {
    if (!companyId || !onboardingBannerEligible) {
      queueMicrotask(() => setStickyVisible(false));
      return;
    }
    if (
      edgeSyncPending ||
      hasActive ||
      !!primary ||
      syncEndedWithIssue ||
      bootLoading ||
      jobsLoading
    ) {
      queueMicrotask(() => setStickyVisible(true));
    }
  }, [
    companyId,
    onboardingBannerEligible,
    bootLoading,
    jobsLoading,
    edgeSyncPending,
    hasActive,
    primary,
    syncEndedWithIssue,
  ]);

  const pollImportJobs = useMemo(
    () =>
      onboardingBannerEligible &&
      (hasActive ||
        edgeSyncPending ||
        (stickyVisible && primary?.status !== "FAILED")),
    [
      onboardingBannerEligible,
      hasActive,
      edgeSyncPending,
      stickyVisible,
      primary?.status,
    ],
  );

  useEffect(() => {
    if (!companyId || !pollImportJobs) return;
    const ms = edgeSyncPending && !hasActive ? 4000 : 12_000;
    const id = window.setInterval(() => {
      void loadJobs({ silent: true });
      void loadBootstrap();
    }, ms);
    return () => window.clearInterval(id);
  }, [companyId, pollImportJobs, hasActive, edgeSyncPending, loadJobs, loadBootstrap]);

  /** Reconsulta rápida quando o primeiro import concluir. */
  useEffect(() => {
    if (primary?.status !== "COMPLETED") return;
    void loadBootstrap();
  }, [primary?.status, loadBootstrap]);

  const showCard =
    onboardingBannerEligible &&
    (bootLoading ||
      jobsLoading ||
      stickyVisible ||
      edgeSyncPending ||
      retryBusy);

  const retryOnboardingEpocImport = useCallback(async () => {
    if (!companyId) return;
    setRetryBusy(true);
    try {
      clearEpocCsvSyncPending(companyId);
      const res = await invokeEpocCsvSync(companyId, {
        sync_mode: "onboarding_initial",
      });
      if (!res.ok) {
        toast.error(
          res.error?.slice(0, 240) ??
            "Não foi possível repetir a sincronização com o portal EPOC.",
        );
      } else {
        toast.success(
          "Sincronização iniciada — o CSV será gerado e o import de receitas entrará na fila.",
          { duration: 5000 },
        );
      }
      await Promise.all([loadBootstrap(), loadJobs()]);
    } finally {
      setRetryBusy(false);
    }
  }, [companyId, loadBootstrap, loadJobs]);

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
    if (bootLoading || jobsLoading) return "A carregar…";
    if (edgeSyncPending && !hasActive) {
      return "A função está a obter dados do portal EPOC. Depois disto o CSV entra na fila de receitas.";
    }
    if (primary?.status === "FAILED") {
      return (
        primary.error_message?.slice(0, 220) ||
        "O processamento do CSV falhou; pode tentar de novo ou rever a integração."
      );
    }
    if (syncEndedWithIssue && !hasActive && !edgeSyncPending) {
      return (
        latestSyncRun?.summary?.slice(0, 260) ??
        "A exportação no portal não produziu tabela utilizável nesta sincronização."
      );
    }
    if (!primary) {
      return "Quando a sincronização EPOC correr, o progresso aparece aqui até à primeira importação estar concluída.";
    }
    const meta = primary.metadata ?? {};
    const created = Number(meta.revenue_entries_created_total ?? 0) || 0;
    const skipped = Number(meta.rows_skipped_total ?? 0) || 0;
    const totalRows = Number(meta.csv_total_data_rows ?? 0) || null;
    if (primary.status === "COMPLETED") {
      return `${created} receita(s) criadas${skipped ? ` · ${skipped} linha(s) ignoradas` : ""}${totalRows ? ` · ${totalRows} linhas no CSV` : ""}.`;
    }
    if (primary.status === "PENDING") {
      return "A processar o CSV das receitas na integração. Pode demorar alguns segundos.";
    }
    return `${created} receita(s) até agora · ${skipped} ignoradas${totalRows ? ` · Total: ${totalRows}` : ""}.`;
  }, [
    primary,
    edgeSyncPending,
    hasActive,
    bootLoading,
    jobsLoading,
    syncEndedWithIssue,
    latestSyncRun?.summary,
  ]);

  const percent = Math.max(0, Math.min(100, progressPercent));
  const showSpinner =
    bootLoading || jobsLoading || hasActive || edgeSyncPending || retryBusy;

  if (!showCard || (hasActive && !primary && !retryBusy)) {
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
              ) : isTerminalFailure ? (
                <AlertCircle className="h-5 w-5 text-destructive" />
              ) : (
                <FileSpreadsheet className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-sky-900/85 dark:text-sky-100/85">
                Onboarding EPOC · receitas
              </p>
              <h3 className="text-lg font-black tracking-tight text-foreground sm:text-xl">
                {hasActive
                  ? "Import de receitas em curso"
                  : edgeSyncPending
                    ? "Sincronização com o portal EPOC"
                    : primary
                      ? `Import: ${statusLabel(primary.status)}`
                      : syncEndedWithIssue
                        ? "Sincronização sem CSV utilizável"
                        : "À espera da sincronização EPOC"}
              </h3>
              <p className="mt-1 text-sm font-medium text-sky-950/90 dark:text-sky-100/90">
                {subtitle}
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

          <div className="flex shrink-0 flex-col gap-2 sm:flex-col sm:flex-wrap sm:items-end sm:justify-end">
            {(primary?.status === "FAILED" ||
              (syncEndedWithIssue &&
                !hasActive &&
                !edgeSyncPending)) && (
              <Button
                size="sm"
                type="button"
                disabled={retryBusy}
                onClick={() => void retryOnboardingEpocImport()}
              >
                {retryBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                Tentar novamente
              </Button>
            )}
            <Button size="sm" className="shrink-0" variant="outline" asChild>
              <Link to="/app/integracoes">
                Integrações EPOC
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
      </CardContent>
    </Card>
  );
}

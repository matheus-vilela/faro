import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompany, type Company } from "@/contexts/CompanyContext";
import {
  COMPANY_INTEGRATION_UPDATED_EVENT,
  type CompanyIntegrationUpdatedDetail,
} from "@/lib/companyIntegrationEvents";
import {
  clearEpocCsvSyncPending,
  isEpocCsvSyncUiBusy,
  readEpocCsvSyncPending,
} from "@/lib/epocCsvSyncProgress";
import { isOnboardingPdvJsonCompleted } from "@/lib/onboardingPdvDefaults";
import { supabase } from "@/lib/supabase";
import { completeCompanyOnboardingIntegrationPdvStep } from "@/services/companyOnboardingFlagsService";
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
 * Receitas via CSV EPOC: onboarding até `onboarding_pdv.completed`; depois só quando
 * há sync/import em curso ou estado que precise de ação (erro, retry).
 */
export function DashboardIntegrationCsvRevenueCard({
  company,
}: {
  company: Company;
}) {
  const { refetchCompanies } = useCompany();
  const companyId = company.id;
  const pdvSyncLocked = company.onboarding_pdv?.sync === true;
  const [retryBusy, setRetryBusy] = useState(false);
  const epocSyncUiBusy = companyId
    ? isEpocCsvSyncUiBusy(companyId, { localSyncing: retryBusy })
    : false;
  const [bootLoading, setBootLoading] = useState(true);
  const [epocEnabled, setEpocEnabled] = useState(false);

  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  /** Última tentativa registada na tabela epoc_csv_sync_runs (ex.: no_tbl_export). */
  const [latestSyncRun, setLatestSyncRun] = useState<SyncRunRow | null>(null);

  const [edgeSyncPending, setEdgeSyncPending] = useState(false);
  const [completeIntegrationBusy, setCompleteIntegrationBusy] = useState(false);

  const loadBootstrap = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!companyId) {
        setEpocEnabled(false);
        setLatestSyncRun(null);
        if (!opts?.silent) setBootLoading(false);
        return;
      }
      if (!opts?.silent) {
        setBootLoading(true);
      }
      const [intRes, runRes] = await Promise.all([
        supabase
          .from("company_integrations")
          .select("enabled")
          .eq("company_id", companyId)
          .eq("provider", "epoc")
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
      setLatestSyncRun(run);
      if (!opts?.silent) setBootLoading(false);
    },
    [companyId],
  );

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
        const rows = (data ?? []) as JobRow[];
        setJobs(rows);
        if (rows.length > 0) {
          clearEpocCsvSyncPending(companyId);
        }
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
    const onIntegrationUpdated = (ev: Event) => {
      const d = (ev as CustomEvent<CompanyIntegrationUpdatedDetail>).detail;
      if (
        !companyId ||
        !d ||
        d.companyId !== companyId ||
        d.provider !== "epoc"
      ) {
        return;
      }
      setEpocEnabled(d.enabled);
      void loadBootstrap({ silent: true });
    };
    window.addEventListener(
      COMPANY_INTEGRATION_UPDATED_EVENT,
      onIntegrationUpdated,
    );
    return () =>
      window.removeEventListener(
        COMPANY_INTEGRATION_UPDATED_EVENT,
        onIntegrationUpdated,
      );
  }, [companyId, loadBootstrap]);

  useEffect(() => {
    if (!companyId) return;
    const ch = supabase
      .channel(`company_integrations:${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "company_integrations",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          void loadBootstrap({ silent: true });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [companyId, loadBootstrap]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !companyId) return;
      void loadBootstrap({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [companyId, loadBootstrap]);

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

  /** Mesmo separador: sync iniciada em Integrações antes de existir job na fila. */
  const lsSyncPending =
    companyId != null ? readEpocCsvSyncPending(companyId) : false;
  const edgePendingEffective = edgeSyncPending || lsSyncPending;

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

  /** Flags só a partir da prop `company` (igual ao cartão fiscal · NF-e): estável ao mudar de ecrã. */
  const onboardingPdvDone = isOnboardingPdvJsonCompleted(company.onboarding_pdv);

  /**
   * Mesma fonte que o resto do onboarding: `setup.epoc` no objeto `company` até
   * `company_integrations` responder.
   */
  const epocEnabledEffective = useMemo(() => {
    if (epocEnabled) return true;
    const epoc = company.setup?.epoc;
    if (!epoc || typeof epoc !== "object" || Array.isArray(epoc)) return false;
    const o = epoc as Record<string, unknown>;
    if (o.mode === "no") return false;
    return o.enabled === true;
  }, [epocEnabled, company.setup?.epoc]);

  /** Em fase de onboarding PDV: critério síncrono a partir da prop `company` (sem esperar re-fetch). */
  const inPdvIntegrationOnboarding = !isOnboardingPdvJsonCompleted(
    company.onboarding_pdv,
  );

  /**
   * Com `primary === null`, `primary?.status !== "COMPLETED"` era verdadeiro e, junto a
   * `syncEndedWithIssue`, mantinha o cartão até os jobs carregarem — flash ao voltar ao dash.
   */
  const importOutcomeStillLoading =
    (bootLoading || jobsLoading) && jobs.length === 0 && primary == null;

  const syncRunIssueBlocksIdle =
    syncEndedWithIssue &&
    !importOutcomeStillLoading &&
    (primary == null || primary.status !== "COMPLETED");

  /**
   * Após onboarding PDV concluído, não ocupar o dash em estado idle.
   * `syncEndedWithIssue` sozinho não deve manter o cartão se já há import COMPLETED —
   * o EPOC pode registar dias sem eventos; o alerta diário trata rotinas posteriores.
   */
  const keepVisibleAfterPdvOnboarding = useMemo(
    () =>
      pdvSyncLocked ||
      edgePendingEffective ||
      hasActive ||
      primary?.status === "FAILED" ||
      syncRunIssueBlocksIdle ||
      retryBusy ||
      completeIntegrationBusy,
    [
      pdvSyncLocked,
      edgePendingEffective,
      hasActive,
      primary?.status,
      syncRunIssueBlocksIdle,
      retryBusy,
      completeIntegrationBusy,
    ],
  );

  const isTerminalFailure =
    primary?.status === "FAILED" ||
    (syncEndedWithIssue && !primary && !hasActive && !edgePendingEffective);

  const onboardingBannerEligible =
    !!companyId && (!onboardingPdvDone || epocEnabledEffective);

  /** Só faz polling quando a integração está ativa ou há sync pendente (localStorage). */
  const pollImportJobs = useMemo(
    () =>
      !!companyId &&
      (inPdvIntegrationOnboarding ||
        epocEnabled ||
        lsSyncPending ||
        pdvSyncLocked),
    [
      companyId,
      inPdvIntegrationOnboarding,
      epocEnabled,
      lsSyncPending,
      pdvSyncLocked,
    ],
  );

  useEffect(() => {
    if (!companyId || !pollImportJobs) return;
    const ms = edgePendingEffective && !hasActive ? 4000 : 12_000;
    const id = window.setInterval(() => {
      void loadJobs({ silent: true });
      void loadBootstrap({ silent: true });
    }, ms);
    return () => window.clearInterval(id);
  }, [
    companyId,
    pollImportJobs,
    hasActive,
    edgePendingEffective,
    loadJobs,
    loadBootstrap,
  ]);

  /** Reconsulta rápida quando o primeiro import concluir. */
  useEffect(() => {
    if (primary?.status !== "COMPLETED") return;
    void loadBootstrap({ silent: true });
  }, [primary?.status, loadBootstrap]);

  const completeIntegrationOnboarding = useCallback(async () => {
    if (!companyId) return;
    setCompleteIntegrationBusy(true);
    try {
      const res = await completeCompanyOnboardingIntegrationPdvStep(companyId);
      if (res.error) {
        toast.error(
          res.error.slice(0, 220) ||
            "Não foi possível concluir a etapa de integração.",
        );
        return;
      }
      toast.success("Integração PDV marcada como concluída.", {
        duration: 3500,
      });
      await refetchCompanies();
    } finally {
      setCompleteIntegrationBusy(false);
    }
  }, [companyId, refetchCompanies]);

  const retryOnboardingEpocImport = useCallback(async () => {
    if (!companyId) return;
    setRetryBusy(true);
    try {
      clearEpocCsvSyncPending(companyId);
      const res = await invokeEpocCsvSync(companyId, {
        sync_mode: "onboarding_initial",
        lockOnboardingPdv: true,
        resetPdvOnboardingCompleted: true,
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
      await Promise.all([
        loadBootstrap({ silent: true }),
        loadJobs(),
        refetchCompanies(),
      ]);
    } finally {
      setRetryBusy(false);
    }
  }, [companyId, loadBootstrap, loadJobs, refetchCompanies]);

  const progressPercent = useMemo(() => {
    if (edgePendingEffective && !hasActive) return 18;
    if (primary?.status === "FAILED") return 0;
    if (!primary) {
      if (isTerminalFailure) return 0;
      if (onboardingBannerEligible) return 18;
      return 0;
    }
    if (primary.status === "COMPLETED") return 100;
    const meta = primary.metadata ?? {};
    const total = Number(meta.csv_total_data_rows ?? 0);
    const cur = Math.max(0, Number(primary.csv_resume_row_index ?? 0));
    if (total <= 0) return primary.status === "PROCESSING" ? 8 : 0;
    return Math.min(100, Math.round((cur / total) * 100));
  }, [
    primary,
    edgePendingEffective,
    hasActive,
    isTerminalFailure,
    onboardingBannerEligible,
  ]);

  const subtitle = useMemo(() => {
    if (bootLoading || jobsLoading) return "A carregar…";
    if (edgePendingEffective && !hasActive) {
      return "A função está a obter dados do portal EPOC. Depois disto o CSV entra na fila de receitas.";
    }
    if (primary?.status === "FAILED") {
      return (
        primary.error_message?.slice(0, 220) ||
        "O processamento do CSV falhou; pode tentar de novo ou rever a integração."
      );
    }
    if (!primary) {
      if (syncEndedWithIssue && !hasActive && !edgePendingEffective) {
        return (
          latestSyncRun?.summary?.slice(0, 260) ??
          "A exportação no portal não produziu tabela utilizável nesta sincronização."
        );
      }
      return "Quando a sincronização EPOC correr, o progresso aparece aqui até à primeira importação estar concluída.";
    }
    const meta = primary.metadata ?? {};
    const created = Number(meta.revenue_entries_created_total ?? 0) || 0;
    const skipped = Number(meta.rows_skipped_total ?? 0) || 0;
    const totalRows = Number(meta.csv_total_data_rows ?? 0) || null;
    if (primary.status === "COMPLETED") {
      return `${created} receita(s) criadas${skipped ? ` · ${skipped} linha(s) ignoradas` : ""}${totalRows ? ` · ${totalRows} linhas no CSV` : ""}.`;
    }
    if (syncEndedWithIssue && !hasActive && !edgePendingEffective) {
      return (
        latestSyncRun?.summary?.slice(0, 260) ??
        "A exportação no portal não produziu tabela utilizável nesta sincronização."
      );
    }
    if (primary.status === "PENDING") {
      return "A processar o CSV das receitas na integração. Pode demorar alguns segundos.";
    }
    return `${created} receita(s) até agora · ${skipped} ignoradas${totalRows ? ` · Total: ${totalRows}` : ""}.`;
  }, [
    primary,
    edgePendingEffective,
    hasActive,
    bootLoading,
    jobsLoading,
    syncEndedWithIssue,
    latestSyncRun?.summary,
  ]);

  const percent = Math.max(0, Math.min(100, progressPercent));
  const showSpinner =
    bootLoading ||
    jobsLoading ||
    hasActive ||
    edgePendingEffective ||
    retryBusy;

  const postPdvShow = onboardingPdvDone && keepVisibleAfterPdvOnboarding;

  const shouldRenderCard = inPdvIntegrationOnboarding || postPdvShow;

  if (!shouldRenderCard) {
    return null;
  }

  if (inPdvIntegrationOnboarding) {
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
                  : edgePendingEffective
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
              {primary && !(edgePendingEffective && !hasActive) ? (
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
              (syncEndedWithIssue && !hasActive && !edgePendingEffective)) && (
              <Button
                size="sm"
                type="button"
                disabled={epocSyncUiBusy}
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
            {primary?.status === "COMPLETED" ? (
              <Button
                size="sm"
                type="button"
                className="shrink-0"
                variant="default"
                disabled={completeIntegrationBusy}
                onClick={() => void completeIntegrationOnboarding()}
              >
                {completeIntegrationBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Concluir integração
              </Button>
            ) : null}
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

import epocLogo from "@/assets/empresas/epoc.webp";
import { EpocFlowDiagnosticPanel } from "@/components/integrations/EpocFlowDiagnosticPanel";
import {
  IntegrationProviderCard,
  IntegrationProviderCardSkeleton,
} from "@/components/integrations/IntegrationProviderCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useCompany } from "@/contexts/CompanyContext";
import { emitCompanyIntegrationUpdated } from "@/lib/companyIntegrationEvents";
import { isEpocCsvSyncUiBusy } from "@/lib/epocCsvSyncProgress";
import { inferEpocFlowDiagnosticFromLegacy } from "@/lib/epocFlowDiagnostic";
import { isOnboardingPdvSyncInProgress } from "@/lib/onboardingPdvDefaults";
import { supabase } from "@/lib/supabase";
import { triggerEpocPipelineInBackground } from "@/services/epocPipelineService";
import {
  invokeEpocCsvSync,
  releaseStalePdvSyncLockIfIdle,
} from "@/services/epocSyncCsvService";
import {
  mergeEpocSettingsForUpsert,
  parseEpocSettings,
  type CompanyIntegrationRow,
  type EpocAmbiente,
  type EpocIntegrationSettings,
} from "@/types/companyIntegration";
import {
  Clock3,
  Download,
  Loader2,
  RefreshCw,
  Save,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

/** Fila após CSV gerado → importação de receitas. */
type EpocImportJobHistoryRow = {
  rowKind: "import_job";
  id: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  created_at: string;
  updated_at: string;
  error_message: string | null;
  storage_path: string;
  csv_resume_row_index: number | null;
  metadata: Record<string, unknown> | null;
};

/** Tentativa de export EPOC (manual ou agendada), incl. sem #tblExport. */
type EpocSyncRunHistoryRow = {
  rowKind: "sync_run";
  id: string;
  created_at: string;
  sync_mode: string;
  outcome: string;
  summary: string;
  dates_consulted: unknown;
  steps_prefix: string | null;
  metadata: Record<string, unknown> | null;
};

type EpocSyncHistoryRow = EpocImportJobHistoryRow | EpocSyncRunHistoryRow;

type EpocSheetConfigBaseline = {
  enabled: boolean;
  baseUrl: string;
  username: string;
};

export function EpocIntegrationCard({ companyId }: { companyId: string }) {
  const { userCompanies, refetchCompanies } = useCompany();
  const companyMeta = useMemo(
    () => userCompanies.find((uc) => uc.company.id === companyId)?.company,
    [userCompanies, companyId],
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [codigoFilial, setCodigoFilial] = useState("");
  const [ambiente, setAmbiente] = useState<EpocAmbiente>("producao");
  const [existingPassword, setExistingPassword] = useState<string | null>(null);
  const epocSyncUiBusy = useMemo(
    () =>
      isEpocCsvSyncUiBusy(companyId, {
        localSyncing: false,
        onboardingPdv: companyMeta?.onboarding_pdv,
      }),
    [companyId, companyMeta?.onboarding_pdv],
  );
  const [activeTab, setActiveTab] = useState<"config" | "history">("config");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [syncHistory, setSyncHistory] = useState<EpocSyncHistoryRow[]>([]);
  /** Jobs ligados a sync_runs (inclui ids fora do top-N do histórico). */
  const [importJobsById, setImportJobsById] = useState<
    Map<string, EpocImportJobHistoryRow>
  >(() => new Map());
  const [downloadingIgnoredReportJobId, setDownloadingIgnoredReportJobId] =
    useState<string | null>(null);
  const [historyDeleteOpen, setHistoryDeleteOpen] = useState(false);
  const [historyDeleteTarget, setHistoryDeleteTarget] = useState<
    | { rowKind: "import_job"; id: string }
    | { rowKind: "sync_run"; id: string }
    | null
  >(null);
  const [historyDeleteLoading, setHistoryDeleteLoading] = useState(false);
  const [replayRunId, setReplayRunId] = useState<string | null>(null);
  const [sheetConfigBaseline, setSheetConfigBaseline] =
    useState<EpocSheetConfigBaseline | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("company_integrations")
      .select("*")
      .eq("company_id", companyId)
      .eq("provider", "epoc")
      .maybeSingle();

    if (error) {
      console.error(error);
      toast.error("Não foi possível carregar a integração EPOC.");
      setLoading(false);
      return;
    }

    if (data) {
      const r = data as CompanyIntegrationRow;
      setEnabled(r.enabled);
      const s = parseEpocSettings(
        (r.settings ?? {}) as Record<string, unknown>,
      );
      setUsername(s.username);
      setPassword("");
      setBaseUrl(s.base_url ?? "");
      setCodigoFilial(s.codigo_filial ?? "");
      setAmbiente(s.ambiente ?? "producao");
      setExistingPassword(
        s.password && s.password.length > 0 ? s.password : null,
      );
      setSheetConfigBaseline({
        enabled: r.enabled,
        baseUrl: (s.base_url ?? "").trim(),
        username: (s.username ?? "").trim(),
      });
    } else {
      setEnabled(false);
      setUsername("");
      setPassword("");
      setBaseUrl("");
      setCodigoFilial("");
      setAmbiente("producao");
      setExistingPassword(null);
      setSheetConfigBaseline({
        enabled: false,
        baseUrl: "",
        username: "",
      });
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (!companyMeta?.onboarding_pdv?.sync) return;
    void releaseStalePdvSyncLockIfIdle(companyId).then((released) => {
      if (released) void refetchCompanies();
    });
  }, [companyId, companyMeta?.onboarding_pdv?.sync, refetchCompanies]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    const [jobsRes, runsRes] = await Promise.all([
      supabase
        .from("integration_csv_revenue_import_jobs")
        .select(
          "id, status, created_at, updated_at, error_message, storage_path, csv_resume_row_index, metadata",
        )
        .eq("company_id", companyId)
        .eq("provider", "epoc")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("epoc_csv_sync_runs")
        .select(
          "id, created_at, sync_mode, outcome, summary, dates_consulted, steps_prefix, metadata",
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    setHistoryLoading(false);
    if (jobsRes.error) {
      console.error(jobsRes.error);
      toast.error("Não foi possível carregar o histórico de sincronizações.");
      return;
    }
    if (runsRes.error) {
      console.warn("[EPOC histórico] epoc_csv_sync_runs:", runsRes.error);
    }

    const jobRows: EpocImportJobHistoryRow[] = (jobsRes.data ?? []).map(
      (r) => ({
        rowKind: "import_job" as const,
        id: String(r.id),
        status: r.status as EpocImportJobHistoryRow["status"],
        created_at: String(r.created_at),
        updated_at: String(r.updated_at),
        error_message: r.error_message ?? null,
        storage_path: String(r.storage_path ?? ""),
        csv_resume_row_index:
          r.csv_resume_row_index != null
            ? Number(r.csv_resume_row_index)
            : null,
        metadata: (r.metadata ?? null) as Record<string, unknown> | null,
      }),
    );

    const runRows: EpocSyncRunHistoryRow[] = (runsRes.data ?? []).map((r) => ({
      rowKind: "sync_run" as const,
      id: String(r.id),
      created_at: String(r.created_at),
      sync_mode: String(r.sync_mode ?? ""),
      outcome: String(r.outcome ?? ""),
      summary: String(r.summary ?? ""),
      dates_consulted: r.dates_consulted,
      steps_prefix: r.steps_prefix != null ? String(r.steps_prefix) : null,
      metadata: (r.metadata ?? null) as Record<string, unknown> | null,
    }));

    const jobsById = new Map<string, EpocImportJobHistoryRow>();
    for (const job of jobRows) jobsById.set(job.id, job);

    const missingLinkedJobIds = [
      ...new Set(
        runRows
          .map((r) => r.metadata?.csv_revenue_import_job_id)
          .filter(
            (id): id is string =>
              typeof id === "string" && id.length > 0 && !jobsById.has(id),
          ),
      ),
    ].slice(0, 50);

    if (missingLinkedJobIds.length > 0) {
      const linkedRes = await supabase
        .from("integration_csv_revenue_import_jobs")
        .select(
          "id, status, created_at, updated_at, error_message, storage_path, csv_resume_row_index, metadata",
        )
        .eq("company_id", companyId)
        .eq("provider", "epoc")
        .in("id", missingLinkedJobIds);
      if (!linkedRes.error) {
        for (const r of linkedRes.data ?? []) {
          const job: EpocImportJobHistoryRow = {
            rowKind: "import_job",
            id: String(r.id),
            status: r.status as EpocImportJobHistoryRow["status"],
            created_at: String(r.created_at),
            updated_at: String(r.updated_at),
            error_message: r.error_message ?? null,
            storage_path: String(r.storage_path ?? ""),
            csv_resume_row_index:
              r.csv_resume_row_index != null
                ? Number(r.csv_resume_row_index)
                : null,
            metadata: (r.metadata ?? null) as Record<string, unknown> | null,
          };
          jobsById.set(job.id, job);
        }
      }
    }

    setImportJobsById(jobsById);

    const merged = [...jobRows, ...runRows].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    setSyncHistory(merged.slice(0, 80));
  }, [companyId]);

  useEffect(() => {
    if (!sheetOpen || activeTab !== "history") return;
    queueMicrotask(() => void loadHistory());
  }, [sheetOpen, activeTab, loadHistory]);

  const isSheetConfigDirty = useMemo(() => {
    if (!sheetConfigBaseline) return false;
    return (
      enabled !== sheetConfigBaseline.enabled ||
      baseUrl.trim() !== sheetConfigBaseline.baseUrl ||
      username.trim() !== sheetConfigBaseline.username ||
      password.trim().length > 0
    );
  }, [sheetConfigBaseline, enabled, baseUrl, username, password]);

  const fileNameFromStoragePath = (path: string, fallback: string) => {
    const t = path.trim();
    const i = t.lastIndexOf("/");
    return (i >= 0 ? t.slice(i + 1) : t) || fallback;
  };

  const cleanText = (v: unknown) => String(v ?? "").trim();

  const jobStatusLabel = (s: EpocImportJobHistoryRow["status"]) => {
    if (s === "PENDING") return "Na fila";
    if (s === "PROCESSING") return "A processar";
    if (s === "COMPLETED") return "Concluída";
    return "Falhou";
  };

  const syncRunOutcomeLabel = (outcome: string) => {
    if (outcome === "no_tbl_export") return "Sem dados no portal";
    if (outcome === "failed") return "Falha na exportação";
    if (outcome === "success") return "Exportação registada";
    return outcome;
  };

  const syncModeLabel = (mode: string) => {
    if (mode === "previous_day") return "Dia anterior (rotina)";
    if (mode === "full") return "Janela completa";
    return mode || "—";
  };

  const formatDatesConsulted = (v: unknown): string => {
    if (Array.isArray(v)) {
      return v
        .map((x) => String(x))
        .filter(Boolean)
        .join(", ");
    }
    return "";
  };

  const diasBrListFromConsulted = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    const re = /^\d{2}\/\d{2}\/\d{4}$/;
    const out: string[] = [];
    for (const x of v) {
      const t = String(x).trim();
      if (re.test(t)) out.push(t);
    }
    return out.slice(0, 10);
  };

  const portalPorDiaFromMeta = (
    meta: Record<string, unknown> | null,
  ): Record<string, string> | null => {
    if (!meta) return null;
    const raw = meta.portal_por_dia;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string" && v.trim()) out[String(k)] = v.trim();
    }
    return Object.keys(out).length > 0 ? out : null;
  };

  const portalPorDiaEntriesOrdered = (
    portalPorDia: Record<string, string>,
    datesConsulted: unknown,
  ): Array<{ dia: string; mensagem: string }> => {
    const order = diasBrListFromConsulted(datesConsulted);
    const used = new Set<string>();
    const rows: Array<{ dia: string; mensagem: string }> = [];
    for (const d of order) {
      const m = portalPorDia[d];
      if (m) {
        rows.push({ dia: d, mensagem: m });
        used.add(d);
      }
    }
    for (const [d, mensagem] of Object.entries(portalPorDia)) {
      if (!used.has(d)) rows.push({ dia: d, mensagem });
    }
    return rows;
  };

  const openHistoryDelete = (
    target:
      | { rowKind: "import_job"; id: string }
      | { rowKind: "sync_run"; id: string },
  ) => {
    setHistoryDeleteTarget(target);
    setHistoryDeleteOpen(true);
  };

  const confirmHistoryDelete = async () => {
    if (!historyDeleteTarget) return;
    setHistoryDeleteLoading(true);
    const table =
      historyDeleteTarget.rowKind === "import_job"
        ? "integration_csv_revenue_import_jobs"
        : "epoc_csv_sync_runs";
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("id", historyDeleteTarget.id)
      .eq("company_id", companyId);
    setHistoryDeleteLoading(false);
    if (error) {
      console.error(error);
      toast.error(
        error.message || "Não foi possível remover este registo do histórico.",
      );
      return;
    }
    toast.success("Registo removido do histórico.");
    setHistoryDeleteOpen(false);
    setHistoryDeleteTarget(null);
    void loadHistory();
  };

  const handleDownloadIgnoredRowsReport = async (
    jobId: string,
    bucket: string,
    path: string,
  ) => {
    const cleanBucket = cleanText(bucket) || "company-setup";
    const cleanPath = cleanText(path);
    if (!cleanPath) {
      toast.error("Este job não possui relatório de ignoradas.");
      return;
    }
    setDownloadingIgnoredReportJobId(jobId);
    const { data, error } = await supabase.storage
      .from(cleanBucket)
      .download(cleanPath);
    setDownloadingIgnoredReportJobId(null);
    if (error) {
      console.error(error);
      toast.error(error.message || "Não foi possível baixar o relatório.");
      return;
    }
    const name = fileNameFromStoragePath(cleanPath, "ignored-rows-report.csv");
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.click();
    URL.revokeObjectURL(url);
    toast.message(`Download iniciado: ${name}`);
  };

  const handleReplaySyncRun = async (run: EpocSyncRunHistoryRow) => {
    if (!enabled || !baseUrl.trim()) {
      toast.error("Ative a integração e indique a URL base do portal EPOC.");
      return;
    }
    const dias = diasBrListFromConsulted(run.dates_consulted);
    if (dias.length === 0) {
      toast.error(
        "Este registo não tem datas válidas para repetir a sincronização.",
      );
      return;
    }
    setReplayRunId(run.id);
    try {
      const res = await invokeEpocCsvSync(companyId, {
        consulta_dias_br: dias,
      });
      if (res.steps?.length) {
        console.groupCollapsed(`[epoc-sync-csv] replay (${res.steps.length})`);
        for (const st of res.steps) {
          console.info(
            `#${st.index} ${st.name} [${st.status}]`,
            st.message ?? "",
          );
        }
        console.groupEnd();
      }
      if (!res.ok) {
        toast.error(
          res.error ?? "Falha ao repetir a sincronização desta(s) data(s).",
        );
        return;
      }
      if (res.continuing) {
        toast.message(
          res.message?.trim() ||
            "Download do CSV em lotes — continua em segundo plano.",
          { duration: 8000 },
        );
        await load();
        void loadHistory();
        return;
      }
      toast.success(
        res.csv_uploaded
          ? "Exportação repetida — CSV guardado; o import pode demorar."
          : "Pedido enviado; verifique os passos nos logs.",
      );
      await load();
      void loadHistory();
    } finally {
      setReplayRunId(null);
      await refetchCompanies();
    }
  };

  const handleSave = async () => {
    const u = username.trim();
    if (!u) {
      toast.error("Informe o usuário EPOC.");
      return;
    }
    if (enabled && !existingPassword && !password.trim()) {
      toast.error("Informe a senha ou desative a integração até configurar.");
      return;
    }
    setSaving(true);

    const { data: prevRow } = await supabase
      .from("company_integrations")
      .select("settings")
      .eq("company_id", companyId)
      .eq("provider", "epoc")
      .maybeSingle();

    const settings: EpocIntegrationSettings = {
      username: u,
      base_url: baseUrl.trim() || undefined,
      codigo_filial: codigoFilial.trim() || undefined,
      ambiente,
    };
    const pwd = password.trim();
    if (pwd) {
      settings.password = pwd;
    } else if (existingPassword) {
      settings.password = existingPassword;
    }

    const merged = mergeEpocSettingsForUpsert(
      prevRow?.settings as Record<string, unknown> | undefined,
      settings,
    );

    const payload = {
      company_id: companyId,
      provider: "epoc" as const,
      enabled,
      settings: merged,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("company_integrations")
      .upsert(payload, { onConflict: "company_id,provider" });

    setSaving(false);
    if (error) {
      console.error(error);
      toast.error(error.message || "Erro ao salvar.");
      return;
    }

    toast.success("Integração EPOC salva.");
    emitCompanyIntegrationUpdated({
      companyId,
      provider: "epoc",
      enabled,
    });
    setPassword("");
    await load();
    setSheetOpen(false);

    if (enabled && baseUrl.trim()) {
      const pdvBusy = isOnboardingPdvSyncInProgress(
        companyMeta?.onboarding_pdv,
      );
      triggerEpocPipelineInBackground(companyId, {
        mode: pdvBusy ? "onboarding" : undefined,
      });
      void refetchCompanies();
      toast.message(
        "Sincronização EPOC enfileirada: o pipeline consulta o portal e importa vendas.",
        { duration: 6000 },
      );
    }
  };

  if (loading) {
    return <IntegrationProviderCardSkeleton />;
  }

  return (
    <div className="h-full w-full min-w-0">
      <IntegrationProviderCard
        title="EPOC"
        description="Sincronização automática uma vez ao dia."
        status={enabled ? "active" : "inactive"}
        statusLabel={enabled ? "Ativo" : "Inativo"}
        meta={
          enabled
            ? "Sincronização automática diária"
            : "Portal ainda não conectado"
        }
        actionLabel={enabled ? "Gerenciar" : "Configurar"}
        onOpen={() => setSheetOpen(true)}
        brand={
          <div className="flex h-full items-center justify-center bg-black">
            <img src={epocLogo} alt="" className="h-7 w-auto object-contain" />
          </div>
        }
      />

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setActiveTab("config");
        }}
      >
        <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Integração EPOC</SheetTitle>
            <SheetDescription>
              URL do portal, usuário, senha e código de filial caso haja.
              Somente quem administra a unidade vê estes campos.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-5 py-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={activeTab === "config" ? "default" : "outline"}
                onClick={() => setActiveTab("config")}
              >
                Configuração
              </Button>
              <Button
                type="button"
                variant={activeTab === "history" ? "default" : "outline"}
                onClick={() => setActiveTab("history")}
              >
                Histórico
              </Button>
            </div>

            {activeTab === "config" ? (
              <>
                <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/25 px-3 py-3">
                  <div>
                    <Label
                      htmlFor="epoc-enabled"
                      className="text-sm font-medium"
                    >
                      Integração ativa
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Quando ativo, o Faro usa estas credenciais na rotina que
                      importa vendas do EPOC (execução diária automática).
                    </p>
                  </div>
                  <Switch
                    id="epoc-enabled"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="epoc-base-url">URL base (portal EPOC)</Label>
                  <Input
                    id="epoc-base-url"
                    type="url"
                    placeholder="https://… ou http://…:porta"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="epoc-user">Usuário</Label>
                    <Input
                      id="epoc-user"
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Login EPOC"
                      className="min-w-0"
                    />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="epoc-pass">Senha</Label>
                    <PasswordInput
                      id="epoc-pass"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        existingPassword
                          ? "Deixe em branco para manter"
                          : "Senha"
                      }
                      className="min-w-0"
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  className="w-full"
                  onClick={() => void handleSave()}
                  disabled={saving || !isSheetConfigDirty}
                >
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Salvar
                </Button>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* <div className="space-y-2">
                    <Label htmlFor="epoc-filial">Código da filial</Label>
                    <Input
                      id="epoc-filial"
                      value={codigoFilial}
                      onChange={(e) => setCodigoFilial(e.target.value)}
                      placeholder="Ex.: "
                    />
                    <p className="text-xs text-muted-foreground">
                      Se vazio, o servidor usa 123A como padrão.
                    </p>
                  </div> */}
                  {/* <div className="space-y-2">
                    <Label>Ambiente</Label>
                    <Select
                      value={ambiente}
                      onValueChange={(v) => setAmbiente(v as EpocAmbiente)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="producao">Produção</SelectItem>
                        <SelectItem value="homologacao">Homologação</SelectItem>
                      </SelectContent>
                    </Select>
                  </div> */}
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    Importações e tentativas de sync
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadHistory()}
                    disabled={historyLoading}
                  >
                    {historyLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Atualizar
                  </Button>
                </div>
                {historyLoading ? (
                  <div className="rounded-lg border border-border/80 bg-muted/20 p-4 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />A carregar
                      histórico…
                    </span>
                  </div>
                ) : syncHistory.length === 0 ? (
                  <div className="rounded-lg border border-border/80 bg-muted/20 p-4 text-sm text-muted-foreground">
                    Nenhum registo encontrado (importações ou tentativas de
                    export, incluindo rotina agendada).
                  </div>
                ) : (
                  <div className="space-y-2">
                    {syncHistory.map((item) => {
                      if (item.rowKind === "sync_run") {
                        const idShort = item.id.slice(0, 8);
                        const datesLine = formatDatesConsulted(
                          item.dates_consulted,
                        );
                        const replayDias = diasBrListFromConsulted(
                          item.dates_consulted,
                        );
                        const portalPorDia = portalPorDiaFromMeta(
                          item.metadata,
                        );
                        const portalLinhas =
                          portalPorDia &&
                          portalPorDiaEntriesOrdered(
                            portalPorDia,
                            item.dates_consulted,
                          );
                        const linkedJobId =
                          typeof item.metadata?.csv_revenue_import_job_id ===
                          "string"
                            ? item.metadata.csv_revenue_import_job_id
                            : null;
                        const linkedJob = linkedJobId
                          ? importJobsById.get(linkedJobId)
                          : undefined;
                        const flowDiagnostic =
                          inferEpocFlowDiagnosticFromLegacy({
                            kind: "sync_run",
                            outcome: item.outcome,
                            summary: item.summary,
                            metadata: item.metadata,
                            linkedImportJob: linkedJob
                              ? {
                                  status: linkedJob.status,
                                  errorMessage: linkedJob.error_message,
                                  metadata: linkedJob.metadata,
                                }
                              : null,
                          });
                        return (
                          <div
                            key={`run-${item.id}`}
                            className="rounded-lg border border-border/80 bg-card p-3 text-sm"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                                <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                                {syncRunOutcomeLabel(item.outcome)}
                              </span>
                              <div className="flex shrink-0 items-center gap-1">
                                <span className="font-mono text-xs text-muted-foreground">
                                  {idShort}…
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  title="Apagar este registo"
                                  aria-label="Apagar registo do histórico"
                                  onClick={() =>
                                    openHistoryDelete({
                                      rowKind: "sync_run",
                                      id: item.id,
                                    })
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {syncModeLabel(item.sync_mode)} ·{" "}
                              {new Date(item.created_at).toLocaleString(
                                "pt-BR",
                              )}
                            </p>
                            <p className="mt-2 text-sm text-foreground">
                              {item.summary}
                            </p>
                            <div className="mt-3">
                              <EpocFlowDiagnosticPanel
                                diagnostic={flowDiagnostic}
                                compact
                              />
                            </div>
                            {portalLinhas && portalLinhas.length > 1 ? (
                              <ul className="mt-2 space-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                                <li className="font-medium text-foreground/80">
                                  Retorno do portal por dia consultado
                                </li>
                                {portalLinhas.map(({ dia, mensagem }) => (
                                  <li key={dia}>
                                    <span className="font-mono">{dia}</span>
                                    {": "}
                                    {mensagem}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            {datesLine ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Data(s) consultada(s): {datesLine}
                              </p>
                            ) : null}
                            {replayDias.length > 0 ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="mt-2 w-full"
                                disabled={
                                  !enabled ||
                                  replayRunId === item.id ||
                                  epocSyncUiBusy
                                }
                                onClick={() => void handleReplaySyncRun(item)}
                              >
                                {replayRunId === item.id ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="mr-2 h-4 w-4" />
                                )}
                                Sincronizar esta(s) data(s) novamente
                              </Button>
                            ) : null}
                          </div>
                        );
                      }

                      const meta = item.metadata ?? {};
                      const created =
                        Number(meta.revenue_entries_created_total ?? 0) || 0;
                      const skipped = Number(meta.rows_skipped_total ?? 0) || 0;
                      const productsCreated =
                        Number(meta.products_auto_created_total ?? 0) || 0;
                      const recipesCreated =
                        Number(meta.recipes_auto_created_total ?? 0) || 0;
                      const totalRows =
                        Number(meta.csv_total_data_rows ?? 0) || 0;
                      const jobIdShort = item.id.slice(0, 8);
                      const storageName = fileNameFromStoragePath(
                        item.storage_path,
                        "epoc.csv",
                      );
                      const ignoredReportPath =
                        typeof meta.ignored_rows_report_storage_path ===
                        "string"
                          ? meta.ignored_rows_report_storage_path
                          : "";
                      const ignoredReportBucket =
                        typeof meta.ignored_rows_report_storage_bucket ===
                        "string"
                          ? meta.ignored_rows_report_storage_bucket
                          : "company-setup";
                      const canDownloadIgnoredReport =
                        !!ignoredReportPath.trim();
                      const flowDiagnostic = inferEpocFlowDiagnosticFromLegacy({
                        kind: "import_job",
                        status: item.status,
                        errorMessage: item.error_message,
                        metadata: meta,
                      });
                      return (
                        <div
                          key={`job-${item.id}`}
                          className="rounded-lg border border-border/80 bg-card p-3 text-sm"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                              {item.status === "FAILED" ? (
                                <SquareTerminal className="h-4 w-4 shrink-0 text-destructive" />
                              ) : (
                                <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                              )}
                              {jobStatusLabel(item.status)}
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                              <span className="font-mono text-xs text-muted-foreground">
                                {jobIdShort}…
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                title="Apagar este registo"
                                aria-label="Apagar registo do histórico"
                                onClick={() =>
                                  openHistoryDelete({
                                    rowKind: "import_job",
                                    id: item.id,
                                  })
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground space-y-1">
                            <p>
                              Criado:{" "}
                              {new Date(item.created_at).toLocaleString(
                                "pt-BR",
                              )}
                            </p>
                            <p>
                              Atualizado:{" "}
                              {new Date(item.updated_at).toLocaleString(
                                "pt-BR",
                              )}
                            </p>
                            <p>CSV: {storageName}</p>
                            <p>
                              Receitas: {created} · Ignoradas: {skipped}
                              {totalRows > 0
                                ? ` · Linhas CSV: ${totalRows}`
                                : ""}
                            </p>
                            {productsCreated > 0 || recipesCreated > 0 ? (
                              <p>
                                Catálogo: {productsCreated} produto(s) novo(s)
                                {recipesCreated > 0
                                  ? ` · ${recipesCreated} ficha(s) técnica(s)`
                                  : ""}
                              </p>
                            ) : null}
                            {item.csv_resume_row_index != null ? (
                              <p>Cursor: linha {item.csv_resume_row_index}</p>
                            ) : null}
                            {item.error_message ? (
                              <p className="text-destructive">
                                Erro: {item.error_message}
                              </p>
                            ) : null}
                          </div>
                          <div className="mt-3">
                            <EpocFlowDiagnosticPanel
                              diagnostic={flowDiagnostic}
                              compact
                            />
                          </div>
                          {canDownloadIgnoredReport ? (
                            <div className="mt-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full"
                                onClick={() =>
                                  void handleDownloadIgnoredRowsReport(
                                    item.id,
                                    ignoredReportBucket,
                                    ignoredReportPath,
                                  )
                                }
                                disabled={
                                  downloadingIgnoredReportJobId === item.id
                                }
                              >
                                {downloadingIgnoredReportJobId === item.id ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <Download className="mr-2 h-4 w-4" />
                                )}
                                Baixar relatório de ignoradas
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={historyDeleteOpen}
        onOpenChange={(open) => {
          setHistoryDeleteOpen(open);
          if (!open) setHistoryDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apagar registo do histórico?</DialogTitle>
            <DialogDescription>
              {historyDeleteTarget?.rowKind === "import_job"
                ? "Remove apenas a linha da lista de importação. O ficheiro CSV no Storage não é apagado. Se o job ainda estiver na fila ou a processar, evite apagar para não deixar o estado inconsistente."
                : "Remove este registo de tentativa de exportação (ex.: dia sem dados no portal). O trace no Storage, se existir, não é apagado."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setHistoryDeleteOpen(false);
                setHistoryDeleteTarget(null);
              }}
              disabled={historyDeleteLoading}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmHistoryDelete()}
              disabled={historyDeleteLoading || !historyDeleteTarget}
            >
              {historyDeleteLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />A apagar…
                </>
              ) : (
                "Apagar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import {
  FiscalCertificateConfigSection,
  useFiscalIntegrationStatus,
} from "@/components/integrations/FiscalCertificateConfigSection";
import { FiscalFlowDiagnosticPanel } from "@/components/integrations/FiscalFlowDiagnosticPanel";
import { IntegrationProviderCard } from "@/components/integrations/IntegrationProviderCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import {
  FISCAL_SYNC_CONFLICT_MESSAGE,
  isFiscalSyncInProgress,
} from "@/lib/companySyncLocks";
import { inferNfeFlowDiagnosticFromHistory } from "@/lib/nfeFlowDiagnostic";
import { supabase } from "@/lib/supabase";
import {
  listFocusNfeConsultaHistory,
  purgeNfeConsultaHistory,
  type FocusNfeConsultaHistoryRow,
} from "@/services/focusGetSyncNfeService";
import { invokeNfePipelineForCompany } from "@/services/nfePipelineService";
import type { CompanySetupMap } from "@/types/companySetup";
import {
  AlertTriangle,
  Clock3,
  FileKey,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatDateTimeBr(iso: string): string {
  if (!iso.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR");
}

export function FiscalIntegrationCard({ companyId }: { companyId: string }) {
  const { isAdmin } = useAuth();
  const { refetchCompanies, userCompanies } = useCompany();
  const companyMeta = userCompanies.find(
    (uc) => uc.company.id === companyId,
  )?.company;
  const { active, hasEmpresaFocus, certAtivo, lastSyncAt } =
    useFiscalIntegrationStatus();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"config" | "history">("config");
  const [syncing, setSyncing] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<FocusNfeConsultaHistoryRow[]>([]);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);

  const setupRaw = useMemo(
    () => asObj(companyMeta?.setup) as CompanySetupMap,
    [companyMeta?.setup],
  );
  const onboardingBatchId = useMemo(() => {
    const xmlZip = setupRaw.xml_zip_import;
    return String(xmlZip?.job_batch_id ?? "").trim();
  }, [setupRaw.xml_zip_import]);

  /** Onboarding com sync ativo (card do painel) — não bloqueia consulta manual. */
  const fiscalOnboardingSyncActive = isFiscalSyncInProgress(
    companyMeta?.onboarding_fiscal,
  );

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    const res = await listFocusNfeConsultaHistory(companyId, 50);
    setHistoryLoading(false);
    if (!res.ok) {
      console.error(res.error);
      toast.error(
        res.error?.trim()
          ? `Não foi possível carregar o histórico: ${res.error}`
          : "Não foi possível carregar o histórico de consultas.",
      );
      return;
    }
    setHistory(res.rows);
  }, [companyId]);

  useEffect(() => {
    if (!sheetOpen || activeTab !== "history") return;
    queueMicrotask(() => void loadHistory());
  }, [sheetOpen, activeTab, loadHistory]);

  const handleSyncNow = async () => {
    if (!active) {
      toast.error("Configure o certificado A1 antes de consultar a SEFAZ.");
      return;
    }
    setSyncing(true);
    try {
      const res = await invokeNfePipelineForCompany({ companyId });
      try {
        await refetchCompanies();
      } catch {
        /* ignore */
      }
      if (activeTab === "history") {
        try {
          await loadHistory();
        } catch {
          /* ignore */
        }
      }
      if (res.ok) {
        toast.success(
          "Consulta NF-e enfileirada. O processamento continua em segundo plano.",
        );
        setActiveTab("history");
        void loadHistory();
      } else {
        toast.error(res.error || FISCAL_SYNC_CONFLICT_MESSAGE);
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Falha ao consultar a SEFAZ.",
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleClearConsultaHistory = async () => {
    if (!isAdmin) {
      toast.error("Apenas administradores podem limpar o histórico.");
      return;
    }
    setClearingHistory(true);
    try {
      const res = await purgeNfeConsultaHistory(companyId);
      if (!res.ok) {
        toast.error(
          res.error === "forbidden"
            ? "Sem permissão para limpar o histórico."
            : res.error,
        );
        return;
      }
      toast.success(
        res.deletedCount === 0
          ? "Não havia registos de histórico nesta unidade."
          : `${res.deletedCount} registo(s) de histórico removido(s).`,
      );
      setClearHistoryOpen(false);
      setHistory([]);
      await loadHistory();
    } catch (e: unknown) {
      toast.error(
        e instanceof Error ? e.message : "Falha ao limpar o histórico.",
      );
    } finally {
      setClearingHistory(false);
    }
  };

  const handlePurgeOnboardingXml = async () => {
    setPurging(true);
    try {
      const { data, error } = await supabase.rpc(
        "purge_company_onboarding_xml_expenses",
        { p_company_id: companyId },
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      const row = data as Record<string, unknown> | null;
      if (!row || row.ok !== true) {
        const msg =
          typeof row?.message === "string"
            ? row.message
            : typeof row?.error === "string"
              ? row.error
              : "Não foi possível remover as despesas.";
        toast.error(msg);
        return;
      }
      const n = Number(row.deleted_count ?? 0);
      toast.success(
        n === 0
          ? "Nenhuma despesa encontrada para esse lote de XML do onboarding."
          : `${n} despesa(s) removida(s).`,
      );
      setPurgeOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro ao executar limpeza.";
      toast.error(msg);
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="h-full min-w-0">
      <IntegrationProviderCard
        title="Fiscal"
        description="Certificado A1 e consulta de NF-e recebidas na SEFAZ NFe."
        status={
          active ? "active" : hasEmpresaFocus && !certAtivo ? "warning" : "inactive"
        }
        statusLabel={
          active
            ? "Ativo"
            : hasEmpresaFocus && !certAtivo
              ? "Sem certificado"
              : "Inativo"
        }
        meta={
          lastSyncAt
            ? `Última consulta: ${formatDateTimeBr(lastSyncAt)}`
            : "Ainda sem consulta na SEFAZ"
        }
        actionLabel={active ? "Gerenciar" : "Configurar"}
        onOpen={() => setSheetOpen(true)}
        brand={
          <div className="flex h-full items-center justify-center bg-sky-950">
            <div className="flex items-center gap-3 text-sky-50">
              <FileKey className="h-8 w-8" aria-hidden />
              <span className="text-xl font-semibold tracking-tight">
                NF-e
              </span>
            </div>
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
            <SheetTitle>Integração Fiscal</SheetTitle>
            <SheetDescription>
              Certificado digital A1 para consultar NF-e de compra recebidas na
              SEFAZ. A rotina automática consulta periodicamente; use o botão
              abaixo para forçar uma consulta.
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
                <FiscalCertificateConfigSection compact />

                <div className="space-y-2 rounded-lg border border-border/80 bg-muted/15 p-3">
                  <p className="text-sm font-medium">Consulta NF-e recebidas</p>
                  <p className="text-xs text-muted-foreground">
                    Busca novas notas de compra na SEFAZ e prepara a
                    interpretação para Despesas.
                  </p>
                  {lastSyncAt ? (
                    <p className="text-xs text-muted-foreground">
                      Última consulta: {formatDateTimeBr(lastSyncAt)}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Nenhuma consulta registrada ainda.
                    </p>
                  )}
                  {fiscalOnboardingSyncActive ? (
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      Há uma sincronização de onboarding em curso; pode
                      consultar de novo para acordar a fila.
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => void handleSyncNow()}
                    disabled={!active || syncing}
                  >
                    {syncing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Consultar SEFAZ agora
                  </Button>
                </div>

                {onboardingBatchId ? (
                  <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-sm font-medium text-destructive">
                      Despesas do onboarding (XML)
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Remove despesas criadas no passo XML do assistente inicial
                      (lote {onboardingBatchId.slice(0, 8)}…).
                    </p>
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-50">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <p>Ação irreversível.</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setPurgeOpen(true)}
                      disabled={purging}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remover despesas do XML do onboarding
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Histórico de consultas</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {isAdmin ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setClearHistoryOpen(true)}
                        disabled={historyLoading || clearingHistory}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Limpar histórico
                      </Button>
                    ) : null}
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
                </div>
                {historyLoading ? (
                  <div className="rounded-lg border border-border/80 bg-muted/20 p-4 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />A carregar
                      histórico…
                    </span>
                  </div>
                ) : history.length === 0 ? (
                  <div className="rounded-lg border border-border/80 bg-muted/20 p-4 text-sm text-muted-foreground">
                    Nenhuma consulta registrada. Use &quot;Consultar SEFAZ
                    agora&quot; na aba Configuração ou aguarde a rotina
                    automática.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {history.map((item) => {
                      const idShort = item.exec_id.slice(0, 8);
                      const flowDiagnostic = inferNfeFlowDiagnosticFromHistory({
                        summary: item.summary,
                        flowDiagnostic: item.flow_diagnostic,
                        nfesEncontradas: item.nfes_encontradas,
                        stagingXmlTotal: item.staging_xml_total,
                        listedCount: item.listed_count,
                        downloadedCount: item.downloaded_count,
                        processedCount: item.processed_count,
                        failedCount: item.failed_count,
                        ignoredCount: item.ignored_count,
                      });
                      const searchPending =
                        flowDiagnostic.phases.nfe_search?.status === "pending";
                      const outcomeLabel = flowDiagnostic.blocked_at
                        ? "Consulta com pendências"
                        : searchPending
                          ? "Consulta enfileirada"
                          : item.nfes_encontradas === 0
                            ? "Consulta sem NF-e novas"
                            : "Consulta registada";
                      return (
                        <div
                          key={item.exec_id}
                          className="rounded-lg border border-border/80 bg-card p-3 text-sm"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                              <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                              {outcomeLabel}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {idShort}…
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDateTimeBr(item.consulta_at)}
                            {item.onboarding ? " · onboarding" : ""}
                          </p>
                          <p className="mt-2 text-sm text-foreground">
                            {flowDiagnostic.summary?.trim() ||
                              item.summary?.trim() ||
                              (item.nfes_encontradas === 0
                                ? "Nenhuma NF-e nova na consulta."
                                : `${item.nfes_encontradas} NF-e(s) encontrada(s).`)}
                          </p>
                          {item.nfes_encontradas !== 0 && (
                            <div className="mt-3">
                              <FiscalFlowDiagnosticPanel
                                diagnostic={flowDiagnostic}
                                compact
                              />
                            </div>
                          )}
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

      <Dialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover despesas do onboarding?</DialogTitle>
            <DialogDescription>
              Serão apagadas as despesas desta unidade associadas ao lote de
              importação XML gravado no onboarding.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPurgeOpen(false)}
              disabled={purging}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={purging}
              onClick={() => void handlePurgeOnboardingXml()}
            >
              {purging ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />A remover…
                </>
              ) : (
                "Confirmar exclusão"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={clearHistoryOpen} onOpenChange={setClearHistoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Limpar histórico de consultas?</DialogTitle>
            <DialogDescription>
              Serão apagados todos os registos de histórico de consultas NF-e
              desta unidade. Esta ação é irreversível e só está disponível para
              administradores Faro.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-50">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              Não remove notas, despesas nem XMLs — apenas o histórico exibido
              nesta aba.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setClearHistoryOpen(false)}
              disabled={clearingHistory}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={clearingHistory}
              onClick={() => void handleClearConsultaHistory()}
            >
              {clearingHistory ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />A limpar…
                </>
              ) : (
                "Limpar histórico"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

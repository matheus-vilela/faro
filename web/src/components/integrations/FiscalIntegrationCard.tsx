import {
  FiscalCertificateConfigSection,
  useFiscalIntegrationStatus,
} from "@/components/integrations/FiscalCertificateConfigSection";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCompany } from "@/contexts/CompanyContext";
import {
  FISCAL_SYNC_CONFLICT_MESSAGE,
  isFiscalSyncInProgress,
} from "@/lib/companySyncLocks";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import {
  invokeFocusGetSyncNfe,
  listFocusNfeConsultaHistory,
  type FocusNfeConsultaHistoryRow,
} from "@/services/focusGetSyncNfeService";
import type { CompanySetupMap } from "@/types/companySetup";
import {
  AlertTriangle,
  ChevronRight,
  Clock3,
  FileKey,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function interpretStatusLabel(status: string | null): string {
  if (!status) return "Consulta registrada";
  if (status === "pending") return "Interpretação na fila";
  if (status === "processing") return "A interpretar XMLs";
  if (status === "done") return "Interpretação concluída";
  if (status === "failed") return "Falha na interpretação";
  return status;
}

function formatDateTimeBr(iso: string): string {
  if (!iso.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR");
}

export function FiscalIntegrationCard({ companyId }: { companyId: string }) {
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

  const setupRaw = useMemo(
    () => asObj(companyMeta?.setup) as CompanySetupMap,
    [companyMeta?.setup],
  );
  const onboardingBatchId = useMemo(() => {
    const xmlZip = setupRaw.xml_zip_import;
    return String(xmlZip?.job_batch_id ?? "").trim();
  }, [setupRaw.xml_zip_import]);

  const fiscalSyncBusy = isFiscalSyncInProgress(companyMeta?.onboarding_fiscal);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    const res = await listFocusNfeConsultaHistory(companyId, 50);
    setHistoryLoading(false);
    if (!res.ok) {
      console.error(res.error);
      toast.error("Não foi possível carregar o histórico de consultas.");
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
    if (fiscalSyncBusy) {
      toast.message(FISCAL_SYNC_CONFLICT_MESSAGE);
      return;
    }
    setSyncing(true);
    try {
      const res = await invokeFocusGetSyncNfe({ companyId });
      await refetchCompanies();
      if (activeTab === "history") await loadHistory();
      if (res.ok) {
        const d0 = Array.isArray(res.data.detail)
          ? res.data.detail[0]
          : undefined;
        if (d0?.skipped) {
          toast.message(String(d0.skipped));
        } else {
          toast.success("Consulta NF-e recebidas concluída.");
        }
      } else {
        toast.error(res.error);
      }
    } finally {
      setSyncing(false);
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
    <>
      <Card
        className={cn(
          "overflow-hidden transition-shadow hover:shadow-md",
          active
            ? "border-emerald-500/35 ring-1 ring-emerald-500/20"
            : "border-border/80",
        )}
      >
        <div className="flex min-h-22 items-stretch">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-4 p-5 text-left transition-colors",
              "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
          >
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border",
                active
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-400"
                  : "border-border bg-muted/50 text-muted-foreground",
              )}
            >
              <FileKey className="h-6 w-6" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold tracking-tight text-foreground">
                Fiscal
              </p>
              <p className="text-sm text-muted-foreground line-clamp-2">
                Certificado A1 e consulta de NF-e recebidas na SEFAZ NFe.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {active ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-400">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.25)]"
                    aria-hidden
                  />
                  Ativo
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span
                    className="h-2 w-2 rounded-full bg-muted-foreground/50"
                    aria-hidden
                  />
                  {hasEmpresaFocus && !certAtivo
                    ? "Sem certificado"
                    : "Inativo"}
                </span>
              )}
              <ChevronRight
                className="h-5 w-5 text-muted-foreground"
                aria-hidden
              />
            </div>
          </button>
        </div>
      </Card>

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
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => void handleSyncNow()}
                    disabled={!active || syncing || fiscalSyncBusy}
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
                      Remove despesas criadas no passo XML do assistente
                      inicial (lote {onboardingBatchId.slice(0, 8)}…).
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
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Histórico de consultas</p>
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
                      return (
                        <div
                          key={item.exec_id}
                          className="rounded-lg border border-border/80 bg-card p-3 text-sm"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                              <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                              {interpretStatusLabel(item.interpret_status)}
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
                            {item.nfes_encontradas === 0
                              ? "Nenhuma NF-e nova na consulta."
                              : `${item.nfes_encontradas} NF-e(s) encontrada(s).`}
                            {item.staging_xml_total != null &&
                            item.staging_xml_total > 0
                              ? ` · ${item.staging_xml_total} XML(s) a interpretar.`
                              : ""}
                          </p>
                          {item.interpret_error ? (
                            <p className="mt-2 text-xs text-destructive">
                              {item.interpret_error}
                            </p>
                          ) : null}
                          {item.finished_at ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Interpretação concluída:{" "}
                              {formatDateTimeBr(item.finished_at)}
                            </p>
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
    </>
  );
}

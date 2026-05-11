import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { drainProcessImportJobBatch } from "@/lib/processImportJobBatchClient";
import { supabase } from "@/lib/supabase";
import { hasFocusNfeEmpresaId } from "@/services/focusAtualizarCertificadoService";
import { patchCompanyMaps } from "@/services/unitSetupService";
import type { FocusNfeMap } from "@/types/companySetup";
import { Ban, CloudDownload, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type FocusSyncResponse = {
  ok?: boolean;
  error?: string;
  exec_id?: string;
  companies?: number;
  detail?: Array<Record<string, unknown>>;
  continuacao?: {
    lista_incompleta?: boolean;
    pending_queue_remaining?: number;
    chain_scheduled?: boolean;
    mensagem?: string;
  };
};

function formatDateTimePt(iso: string | undefined): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso.trim());
  if (Number.isNaN(d.getTime())) return iso.trim();
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  companyId: string;
  focusnfe: FocusNfeMap;
  onSynced: () => Promise<void>;
  /** Se true: trava `syncing_fiscal` até conclusão da etapa ou falha do invoke. */
  lockFiscalOnboarding?: boolean;
  /** Espelho de `companies.syncing_fiscal` — desativa disparos manuais noutros ecrãs. */
  serverSyncingFiscal?: boolean;
};

export function FiscalNfeRecebidasManualSyncCard({
  companyId,
  focusnfe,
  onSynced,
  lockFiscalOnboarding = false,
  serverSyncingFiscal = false,
}: Props) {
  const hasFocus = hasFocusNfeEmpresaId(focusnfe);
  const ultimaVersao = focusnfe.nfes_recebidas_ultima_versao;
  const ultimaSync = String(focusnfe.nfes_recebidas_ultima_sync_at ?? "").trim();

  const [versaoInput, setVersaoInput] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [stoppingBatch, setStoppingBatch] = useState(false);
  const [testLimitedMode, setTestLimitedMode] = useState(true);
  const [testSingleKey, setTestSingleKey] = useState("");

  const invokeFocusSync = useCallback(
    async (
      body: Record<string, unknown>,
    ): Promise<{ res: FocusSyncResponse | null; error: string | null }> => {
      const { data, error } = await supabase.functions.invoke(
        "focus-sync-nfe-recebidas",
        { body },
      );
      if (error) {
        return { res: null, error: error.message ?? "Falha ao chamar sincronização." };
      }
      const res = data as FocusSyncResponse | null;
      if (!res || res.ok !== true) {
        const msg =
          typeof res?.error === "string" && res.error.trim()
            ? res.error
            : "Resposta inválida da sincronização.";
        return { res, error: msg };
      }
      return { res, error: null };
    },
    [],
  );

  useEffect(() => {
    if (ultimaVersao !== undefined && ultimaVersao !== null) {
      const n = Number(ultimaVersao);
      if (Number.isFinite(n) && n >= 0) {
        setVersaoInput(String(Math.floor(n)));
        return;
      }
    }
    setVersaoInput("");
  }, [companyId, ultimaVersao]);

  const handleSync = useCallback(async () => {
    if (!companyId || !hasFocus) return;
    let fiscalLockCleared = false;
    let companyRefetched = false;
    const clearFiscalLock = async () => {
      if (!lockFiscalOnboarding || fiscalLockCleared) return;
      await patchCompanyMaps(companyId, { syncing_fiscal: false });
      fiscalLockCleared = true;
    };
    const refreshCompany = async () => {
      if (companyRefetched) return;
      await onSynced();
      companyRefetched = true;
    };
    let versaoInicial: number | undefined;
    const trimmed = versaoInput.trim();
    if (trimmed !== "") {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Informe um número ≥ 0 ou deixe vazio para usar o valor gravado na unidade.");
        return;
      }
      versaoInicial = Math.floor(n);
    }
    setSyncing(true);
    try {
      if (lockFiscalOnboarding) {
        const { error: lockErr } = await patchCompanyMaps(companyId, {
          syncing_fiscal: true,
        });
        if (lockErr) {
          toast.error(lockErr.slice(0, 220));
          return;
        }
        await refreshCompany();
      }
      const body: Record<string, unknown> = {
        manual: true,
        company_id: companyId,
      };
      if (testLimitedMode) {
        const keyDigits = testSingleKey.replace(/\D/g, "");
        body.test_mode = true;
        /** Evita `invoke` do batch no servidor: o browser faz `drainProcessImportJobBatch` sozinho (sem corrida com waitUntil). */
        body.skip_process_import_job_batch = true;
        if (keyDigits.length === 44) {
          body.test_single_key = keyDigits;
        }
        body.max_list_pages = 1;
        body.max_xml_downloads = 1;
      }
      if (versaoInicial !== undefined) {
        body.versao_inicial = versaoInicial;
        // Forçando cursor para uma versão explícita (ex.: 0), pedimos reimportação
        // sem bloquear por logs antigos.
        body.force_reimport = true;
      }
      body.phase = "auto";
      body.max_chain_depth = 0;
      const maxSyncRounds = 30;
      let syncRound = 0;
      let lastRes: FocusSyncResponse | null = null;
      let lastBatchId: string | null = null;
      while (syncRound < maxSyncRounds) {
        syncRound += 1;
        const { res, error } = await invokeFocusSync(body);
        if (error) {
          await clearFiscalLock();
          if (lockFiscalOnboarding) await refreshCompany();
          toast.error(error);
          return;
        }
        lastRes = res;
        const detailRound = res?.detail?.[0];
        if (detailRound && typeof detailRound.batch_id === "string" && detailRound.batch_id.trim()) {
          lastBatchId = detailRound.batch_id;
        }
        const contRound = res?.continuacao;
        const shouldContinue =
          contRound?.chain_scheduled === true ||
          contRound?.lista_incompleta === true ||
          (typeof contRound?.pending_queue_remaining === "number" && contRound.pending_queue_remaining > 0);
        if (!shouldContinue) break;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      if (!lastRes) {
        await clearFiscalLock();
        if (lockFiscalOnboarding) await refreshCompany();
        toast.error("Sincronização sem resposta.");
        return;
      }
      const detail = lastRes.detail?.[0];
      if (detail?.error) {
        await clearFiscalLock();
        toast.error(String(detail.error));
        await refreshCompany();
        return;
      }
      if (detail?.skipped) {
        await clearFiscalLock();
        toast.message(String(detail.skipped));
        await refreshCompany();
        return;
      }
      const novos = detail ? Number(detail.novos_xml_batch ?? 0) : null;
      let batchId = lastBatchId ?? (detail && typeof detail.batch_id === "string" ? detail.batch_id : null);
      if (!batchId) {
        const { data: fallbackBatch } = await supabase
          .from("import_job_batches")
          .select("id, source_file_name")
          .eq("company_id", companyId)
          .ilike("source_file_name", "focus_nfes_recebidas_%")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        batchId = fallbackBatch?.id ? String(fallbackBatch.id) : null;
      }
      const summaryBits = [
        "Sincronização concluída.",
        novos !== null && !Number.isNaN(novos) ? `${novos} XML(s) neste lote.` : null,
        batchId ? `Lote: ${batchId.slice(0, 8)}…` : null,
      ].filter(Boolean);
      toast.success(summaryBits.join(" "));
      if (!batchId) {
        toast.message("Sem lote novo nesta execução — não houve disparo ao process-import-job-batch.");
        await refreshCompany();
      } else if (testLimitedMode) {
        toast.message(
          "Modo teste: o servidor também pode ter iniciado o batch; o navegador acompanha até 1 ficheiro por rodada.",
        );
        const drain = await drainProcessImportJobBatch(batchId, {
          maxRounds: 40,
          pauseMs: 350,
          test_single_file: true,
        });
        if (!drain.ok) {
          toast.error(drain.error ?? "Falha ao acompanhar o process-import-job-batch.");
        } else if (drain.last) {
          const L = drain.last;
          toast.success(
            [
              "process-import-job-batch (modo teste: 1 ficheiro por rodada).",
              `Processados ${Number(L.processed_files ?? 0)} · sucesso ${Number(L.success_files ?? 0)} · falhas ${Number(L.failed_files ?? 0)}`,
              typeof L.remaining_files === "number" && L.remaining_files > 0
                ? `· ainda na fila: ${L.remaining_files}`
                : null,
            ]
              .filter(Boolean)
              .join(" "),
          );
        }
      } else {
        toast.message(
          "process-import-job-batch já foi chamado pela sync no servidor em segundo plano. Atualize importações ou despesas dentro de instantes.",
        );
      }
      const cont = lastRes.continuacao;
      if (
        cont?.chain_scheduled ||
        cont?.lista_incompleta ||
        (typeof cont?.pending_queue_remaining === "number" && cont.pending_queue_remaining > 0)
      ) {
        toast.message(
          cont?.mensagem?.trim() ||
            "Há listagem ou fila pendente: a sincronização pode continuar automaticamente ou na próxima chamada.",
        );
      }
      await refreshCompany();
    } catch (e: unknown) {
      await clearFiscalLock();
      if (lockFiscalOnboarding) await refreshCompany();
      const msg = e instanceof Error ? e.message : "Erro ao sincronizar.";
      toast.error(msg);
    } finally {
      await clearFiscalLock();
      if (lockFiscalOnboarding) await refreshCompany();
      setSyncing(false);
    }
  }, [companyId, hasFocus, versaoInput, onSynced, lockFiscalOnboarding, invokeFocusSync, testLimitedMode, testSingleKey]);

  const handleStopProcessImportBatch = useCallback(async () => {
    if (!companyId) return;
    setStoppingBatch(true);
    try {
      const cancelIso = new Date().toISOString();
      const { data: updatedBatches, error: updErr } = await supabase
        .from("import_job_batches")
        .update({
          status: "CANCELLED",
          last_error: "Cancelado manualmente no card fiscal.",
          updated_at: cancelIso,
        })
        .eq("company_id", companyId)
        .in("status", ["QUEUED", "PROCESSING"])
        .select("id");
      if (updErr) {
        toast.error(updErr.message);
        return;
      }
      const batchIds = (updatedBatches ?? []).map((b) => String((b as { id?: string }).id ?? "")).filter(Boolean);
      if (batchIds.length === 0) {
        toast.message("Não há lotes ativos do process-import-job-batch para parar.");
        return;
      }
      await supabase
        .from("import_job_files")
        .update({
          status: "CANCELLED",
          last_error: "Cancelado manualmente no card fiscal.",
          finished_at: cancelIso,
          updated_at: cancelIso,
        })
        .in("batch_id", batchIds)
        .eq("status", "QUEUED");
      toast.success(`Parada solicitada para ${batchIds.length} lote(s) ativo(s).`);
      await onSynced();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Falha ao parar importação.";
      toast.error(msg);
    } finally {
      setStoppingBatch(false);
    }
  }, [companyId, onSynced]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CloudDownload className="h-4 w-4" />
          NF-e recebidas (Focus)
        </CardTitle>
        <CardDescription>
          Parâmetro <span className="font-mono text-xs">versao</span> da API Focus — próximo
          ponto da listagem. Valor gravado nesta unidade:{" "}
          <span className="font-mono text-xs">
            {ultimaVersao !== undefined && ultimaVersao !== null && Number.isFinite(Number(ultimaVersao))
              ? String(Math.floor(Number(ultimaVersao)))
              : "—"}
          </span>
          . Última sync: {formatDateTimePt(ultimaSync || undefined)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="fiscal-nfe-versao">Versão inicial do próximo fluxo</Label>
          <Input
            id="fiscal-nfe-versao"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            placeholder="Ex.: 0 para recomeçar; vazio = usar valor gravado"
            value={versaoInput}
            onChange={(e) => setVersaoInput(e.target.value)}
            disabled={!hasFocus || syncing || serverSyncingFiscal}
            className="max-w-xs font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Se deixar vazio, a função usa só o cursor já salvo em{" "}
            <code className="rounded bg-muted px-1">focusnfe.nfes_recebidas_ultima_versao</code>.
            Com número, força esse valor nesta execução (útil para reprocessar a partir de um
            ponto).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="fiscal-focus-test-limit"
            checked={testLimitedMode}
            onCheckedChange={(v) => setTestLimitedMode(v === true)}
            disabled={syncing || stoppingBatch}
          />
          <Label htmlFor="fiscal-focus-test-limit" className="font-normal">
            Modo teste limitado (1 página/lista Focus, 1 XML, batch com 1 ficheiro por invoke)
          </Label>
        </div>
        {testLimitedMode ? (
          <div className="space-y-2">
            <Label htmlFor="fiscal-focus-test-key">Chave NF-e para teste (opcional)</Label>
            <Input
              id="fiscal-focus-test-key"
              inputMode="numeric"
              placeholder="44 dígitos (se vazio, usa fluxo reduzido padrão)"
              value={testSingleKey}
              onChange={(e) => setTestSingleKey(e.target.value)}
              disabled={syncing || stoppingBatch}
              className="max-w-xl font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Com chave válida, a sync enfileira apenas essa NF-e e evita a listagem pesada.
            </p>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!hasFocus || syncing || serverSyncingFiscal}
            onClick={() => void handleSync()}
          >
            {syncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                A sincronizar…
              </>
            ) : (
              <>
                <CloudDownload className="mr-2 h-4 w-4" />
                Buscar NF-e recebidas agora
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={stoppingBatch || syncing}
            onClick={() => void handleStopProcessImportBatch()}
          >
            {stoppingBatch ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                A parar…
              </>
            ) : (
              <>
                <Ban className="mr-2 h-4 w-4" />
                Parar process-import-job-batch
              </>
            )}
          </Button>
        </div>
        {!hasFocus ? (
          <p className="text-sm text-muted-foreground">
            Associe a unidade à Focus NFe (empresa criada na API) para habilitar esta busca.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

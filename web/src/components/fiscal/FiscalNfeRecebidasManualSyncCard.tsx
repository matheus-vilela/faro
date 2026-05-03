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
import { supabase } from "@/lib/supabase";
import { hasFocusNfeEmpresaId } from "@/services/focusAtualizarCertificadoService";
import { patchCompanyMaps } from "@/services/unitSetupService";
import type { FocusNfeMap } from "@/types/companySetup";
import { CloudDownload, Loader2 } from "lucide-react";
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
        await onSynced();
      }
      const body: Record<string, unknown> = {
        manual: true,
        company_id: companyId,
      };
      if (versaoInicial !== undefined) {
        body.versao_inicial = versaoInicial;
      }
      const { data, error } = await supabase.functions.invoke(
        "focus-sync-nfe-recebidas",
        { body },
      );
      if (error) {
        if (lockFiscalOnboarding) {
          await patchCompanyMaps(companyId, { syncing_fiscal: false });
          await onSynced();
        }
        toast.error(error.message ?? "Falha ao chamar sincronização.");
        return;
      }
      const res = data as FocusSyncResponse | null;
      if (!res || res.ok !== true) {
        if (lockFiscalOnboarding) {
          await patchCompanyMaps(companyId, { syncing_fiscal: false });
          await onSynced();
        }
        const msg =
          typeof res?.error === "string" && res.error.trim()
            ? res.error
            : "Resposta inválida da sincronização.";
        toast.error(msg);
        return;
      }
      const detail = res.detail?.[0];
      if (detail?.error) {
        if (lockFiscalOnboarding) {
          await patchCompanyMaps(companyId, { syncing_fiscal: false });
        }
        toast.error(String(detail.error));
        await onSynced();
        return;
      }
      if (detail?.skipped) {
        if (lockFiscalOnboarding) {
          await patchCompanyMaps(companyId, { syncing_fiscal: false });
        }
        toast.message(String(detail.skipped));
        await onSynced();
        return;
      }
      const novos = detail
        ? Number(detail.novos_xml_batch ?? detail.novos_xml_na_fila ?? 0)
        : null;
      const batchId = detail && typeof detail.batch_id === "string" ? detail.batch_id : null;
      const parts = [
        "Sincronização concluída.",
        novos !== null && !Number.isNaN(novos) ? `${novos} XML(s) novos neste lote.` : null,
        batchId ? `Lote: ${batchId.slice(0, 8)}…` : null,
      ].filter(Boolean);
      toast.success(parts.join(" "));
      const cont = res.continuacao;
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
      await onSynced();
    } catch (e: unknown) {
      if (lockFiscalOnboarding) {
        await patchCompanyMaps(companyId, { syncing_fiscal: false });
        await onSynced();
      }
      const msg = e instanceof Error ? e.message : "Erro ao sincronizar.";
      toast.error(msg);
    } finally {
      setSyncing(false);
    }
  }, [companyId, hasFocus, versaoInput, onSynced, lockFiscalOnboarding]);

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
        {!hasFocus ? (
          <p className="text-sm text-muted-foreground">
            Associe a unidade à Focus NFe (empresa criada na API) para habilitar esta busca.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

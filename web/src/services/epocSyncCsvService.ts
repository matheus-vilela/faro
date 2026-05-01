import {
  clearEpocCsvSyncPending,
  markEpocCsvSyncPending,
} from "@/lib/epocCsvSyncProgress";
import { supabase } from "@/lib/supabase";

/**
 * Chama a edge `epoc-sync-csv`: cada etapa (login, index, validadorOz/acoes nas duas fases) é
 * gravada como um `step` no Storage com URL assinada, e o JSON traz `steps[]` para inspeção
 * e download. Sucesso só quando a fase 2 contém `id=tblExport` e o CSV é gerado.
 */
export type EpocSyncStepStatus = "ok" | "fail" | "warn";
export type EpocSyncStep = {
  index: number;
  name: string;
  label: string;
  status: EpocSyncStepStatus;
  http_status?: number | null;
  content_type?: string | null;
  bytes?: number;
  message?: string;
  storage_path?: string | null;
  file_name?: string | null;
  download_url?: string | null;
  detalhes?: Record<string, unknown>;
};

export type InvokeEpocCsvSyncOptions = {
  /**
   * - full: últimos 10 dias
   * - previous_day: dia civil anterior em America/Sao_Paulo
   * - onboarding_initial: do 1.º dia do mês anterior até hoje (SP); usado no setup da unidade
   */
  sync_mode?: "full" | "previous_day" | "onboarding_initial";
  /** Datas no formato EPOC dd/MM/aaaa (repetição a partir do histórico). */
  consulta_dias_br?: string[];
};

export type EpocSyncCsvResponse = {
  ok: boolean;
  error?: string;
  /** Trace de cada etapa (login → index → validador/acoes 1/2 → tblExport). */
  steps?: EpocSyncStep[];
  steps_prefix?: string;
  /** Falso quando a resposta fase2 não trouxe `id=tblExport`. */
  tblExport_found?: boolean;
  /** CSV consolidado dos últimos 60 dias. */
  csv_uploaded?: boolean;
  storage_path?: string | null;
  file_name?: string | null;
  size_bytes?: number;
  download_url?: string | null;
  signed_url_expires_in?: number | null;
  /** Fila criada para import de receitas (webhook → `process-integration-csv-revenue-job`). */
  csv_revenue_import_job_id?: string | null;
};

/** Invoca a edge e devolve a resposta (URLs assinadas após sucesso). */
export async function invokeEpocCsvSync(
  companyId: string,
  options?: InvokeEpocCsvSyncOptions,
): Promise<EpocSyncCsvResponse> {
  markEpocCsvSyncPending(companyId);
  const body: Record<string, unknown> = { company_id: companyId };
  if (options?.sync_mode === "previous_day") {
    body.sync_mode = "previous_day";
  } else if (options?.sync_mode === "onboarding_initial") {
    body.sync_mode = "onboarding_initial";
  } else if (options?.sync_mode === "full") {
    body.sync_mode = "full";
  }
  if (options?.consulta_dias_br?.length) {
    body.consulta_dias_br = options.consulta_dias_br.slice(0, 10);
  }
  try {
    const { data, error } = await supabase.functions.invoke<EpocSyncCsvResponse>(
      "epoc-sync-csv",
      { body },
    );
    if (error) {
      clearEpocCsvSyncPending(companyId);
      return { ok: false, error: error.message };
    }
    if (!data) {
      clearEpocCsvSyncPending(companyId);
      return { ok: false, error: "Resposta vazia da função" };
    }
    if (!data.ok) {
      clearEpocCsvSyncPending(companyId);
      return data;
    }
    // Mantém o card do dashboard visível durante a janela de transição
    // entre o fim da sync EPOC e a criação do job de importação CSV.
    window.setTimeout(() => clearEpocCsvSyncPending(companyId), 120_000);
    return data;
  } catch (e) {
    clearEpocCsvSyncPending(companyId);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Falha ao executar sincronização.",
    };
  }
}

export function triggerEpocCsvSyncInBackground(
  companyId: string,
  options?: InvokeEpocCsvSyncOptions,
): void {
  void (async () => {
    const data = await invokeEpocCsvSync(companyId, options);
    if (!data.ok && data.error) {
      console.warn("[epoc-sync-csv]", data.error);
      return;
    }
    if (data.ok) {
      console.info(
        "[epoc-sync-csv] concluído (CSV no Storage, em segundo plano).",
      );
    } else {
      console.warn("[epoc-sync-csv]", data.error ?? "ok false");
    }
  })();
}

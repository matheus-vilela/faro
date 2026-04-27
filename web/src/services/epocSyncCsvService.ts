import { supabase } from "@/lib/supabase";

/**
 * Chama a edge `epoc-sync-csv`: cada etapa (login, index, validadorOz/acoes nas duas fases) é
 * gravada como um `step` no Storage com URL assinada, e o JSON traz `steps[]` para inspeção
 * e download. Sucesso só quando a fase 2 contém `id=tblExport`.
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

export type EpocSyncCsvResponse = {
  ok: boolean;
  error?: string;
  /** Trace de cada etapa (login → index → validador/acoes 1/2 → tblExport). */
  steps?: EpocSyncStep[];
  steps_prefix?: string;
  /** Falso quando a resposta fase2 foi guardada, mas o id de exportação não veio. */
  tblExport_found?: boolean;
  /** HTML com a tabela `#tblExport` (ficheiro no Storage). */
  acoes_response_storage_path?: string;
  acoes_response_file_name?: string;
  acoes_response_size_bytes?: number;
  acoes_response_content_type?: string | null;
  acoes_response_download_url?: string | null;
  /** @deprecated use `acoes_response_download_url` (mesma URL). */
  html_storage_path?: string;
  html_file_name?: string;
  html_size_bytes?: number;
  html_download_url?: string | null;
  /** CSV (não usado no fluxo atual, mantido para compatibilidade). */
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
): Promise<EpocSyncCsvResponse> {
  const { data, error } = await supabase.functions.invoke<EpocSyncCsvResponse>(
    "epoc-sync-csv",
    { body: { company_id: companyId } },
  );
  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data) {
    return { ok: false, error: "Resposta vazia da função" };
  }
  return data;
}

export function triggerEpocCsvSyncInBackground(companyId: string): void {
  void (async () => {
    const { data, error } = await supabase.functions.invoke<EpocSyncCsvResponse>(
      "epoc-sync-csv",
      { body: { company_id: companyId } },
    );
    if (error) {
      console.warn("[epoc-sync-csv]", error.message);
      return;
    }
    if (data && !data.ok) {
      console.warn("[epoc-sync-csv]", data.error ?? "ok false");
    } else if (data?.ok) {
      console.info(
        "[epoc-sync-csv] concluído (resposta acoes.php + CSV no Storage, em segundo plano).",
      );
    }
  })();
}

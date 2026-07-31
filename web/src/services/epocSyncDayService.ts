import { fetchSupabaseEdgeFunction } from "@/lib/supabase";
import {
  downloadTextAsFile,
  yesterdayIsoSaoPaulo,
} from "@/services/epocFaturamentoExportService";

export { downloadTextAsFile, yesterdayIsoSaoPaulo };

export type EpocSyncDayDayResult = {
  date_br: string;
  date_iso: string | null;
  status: "ok" | "skipped_no_faturamento" | "error" | string;
  message?: string;
  produtos_rows?: number;
  servicos_rows?: number;
  faturamento_rows?: number;
};

export type EpocSyncDayTotals = {
  dias_ok: number;
  dias_skipped_no_faturamento: number;
  dias_erro: number;
  produtos_rows: number;
  faturamento_rows: number;
  servicos_rows: number;
};

export type EpocSyncDayOk = {
  ok: true;
  continuing?: boolean;
  company_id?: string;
  source?: string;
  sync_run_id?: string;
  chain_attempt?: number;
  days_done?: number;
  days_planned?: number;
  days_label?: string;
  days_requested?: string[];
  days?: EpocSyncDayDayResult[];
  storage_bucket?: string;
  storage_prefix?: string;
  storage_paths?: {
    produtos: string | null;
    faturamento: string | null;
    servicos: string | null;
  };
  persist?: Array<Record<string, unknown>>;
  csv_import_job_id?: string | null;
  csv_import_error?: string | null;
  partial_sync_summary?: string | null;
  csv?: {
    produtos: string;
    faturamento: string;
    servicos: string;
  };
  totals?: EpocSyncDayTotals;
  stats?: EpocSyncDayTotals & {
    produtos_dias_com_dados?: number;
    faturamento_dias_com_dados?: number;
    servicos_dias_com_dados?: number;
  };
  message?: string;
  status?: string;
  last_error?: string | null;
  updated_at?: string;
  has_csv?: boolean;
};

export type EpocSyncDayFail = {
  ok: false;
  error: string;
  continuing?: boolean;
  sync_run_id?: string;
};

export type EpocSyncDayResult = EpocSyncDayOk | EpocSyncDayFail;

async function parseEpocSyncDayResponse(
  res: Response,
): Promise<EpocSyncDayResult> {
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return {
      ok: false,
      error: `Resposta inválida (HTTP ${res.status}).`,
    };
  }

  if (
    payload &&
    typeof payload === "object" &&
    "ok" in payload &&
    (payload as { ok: unknown }).ok === true
  ) {
    return payload as EpocSyncDayOk;
  }

  const err =
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
      ? (payload as { error: string }).error
      : `Falha no sync-day (HTTP ${res.status}).`;

  return {
    ok: false,
    error: err,
    ...(payload && typeof payload === "object"
      ? {
          continuing: (payload as { continuing?: boolean }).continuing,
          sync_run_id:
            typeof (payload as { sync_run_id?: unknown }).sync_run_id ===
              "string"
              ? (payload as { sync_run_id: string }).sync_run_id
              : undefined,
        }
      : {}),
  };
}

/** Dispara `epoc-sync-day` para um período (auto-cadeia no servidor). */
export async function invokeEpocSyncDay(params: {
  companyId: string;
  /** yyyy-MM-dd inclusive */
  dataDeIso: string;
  /** yyyy-MM-dd inclusive */
  dataAteIso: string;
  maxDaysPerInvoke?: number;
}): Promise<EpocSyncDayResult> {
  const res = await fetchSupabaseEdgeFunction("epoc-sync-day", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_id: params.companyId,
      data_de: params.dataDeIso,
      data_ate: params.dataAteIso,
      max_days: params.maxDaysPerInvoke ?? 2,
    }),
  });
  return parseEpocSyncDayResponse(res);
}

/** Lê progresso da cadeia / CSVs finais sem bater no portal. */
export async function pollEpocSyncDayStatus(params: {
  companyId: string;
  syncRunId?: string;
  stepsPrefix?: string;
  /** Força merge a partir de parts/ no Storage. */
  forceRebuildCsv?: boolean;
}): Promise<EpocSyncDayResult> {
  const res = await fetchSupabaseEdgeFunction("epoc-sync-day", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_id: params.companyId,
      status_poll: true,
      force_rebuild_csv: params.forceRebuildCsv === true,
      ...(params.syncRunId ? { sync_run_id: params.syncRunId } : {}),
      ...(params.stepsPrefix ? { steps_prefix: params.stepsPrefix } : {}),
    }),
  });
  return parseEpocSyncDayResponse(res);
}

import { formatSupabaseFunctionError, supabase } from "@/lib/supabase";

export type FocusGetSyncNfeDetail = {
  ok?: boolean;
  skipped?: string;
  error?: string;
  company_id?: string;
  exec_id?: string;
  nfes_listadas?: number;
  nfes_com_xml?: number;
};

export type FocusGetSyncNfeResponse = {
  ok?: boolean;
  error?: string;
  detail?: FocusGetSyncNfeDetail[];
};

export async function invokeFocusGetSyncNfe(input: {
  companyId: string;
  onboarding?: boolean;
  versao?: number;
}): Promise<
  | { ok: true; data: FocusGetSyncNfeResponse }
  | { ok: false; error: string; data?: FocusGetSyncNfeResponse }
> {
  const body: Record<string, unknown> = {
    manual: true,
    company_id: input.companyId,
  };
  if (input.onboarding === true) body.onboarding = true;
  if (input.versao != null && Number.isFinite(input.versao)) {
    body.versao = input.versao;
  }

  const { data, error } = await supabase.functions.invoke("focus-get-sync-nfe", {
    body,
  });

  if (error) {
    return {
      ok: false,
      error: formatSupabaseFunctionError(error),
    };
  }

  const typed = (data ?? {}) as FocusGetSyncNfeResponse;
  const d0 = Array.isArray(typed.detail) ? typed.detail[0] : undefined;

  if (typed.ok === true && d0?.ok === true) {
    return { ok: true, data: typed };
  }
  if (typed.ok === true && d0?.skipped) {
    return { ok: true, data: typed };
  }

  const err =
    (typeof typed.error === "string" && typed.error) ||
    (typeof d0?.error === "string" && d0.error) ||
    (typeof d0?.skipped === "string" && d0.skipped) ||
    "Resposta inesperada da consulta NF-e.";

  return { ok: false, error: err, data: typed };
}

export type FocusNfeConsultaHistoryRow = {
  exec_id: string;
  consulta_at: string;
  nfes_encontradas: number;
  onboarding: boolean;
  staging_xml_total: number | null;
  summary: string | null;
  flow_diagnostic: unknown | null;
  listed_count: number | null;
  downloaded_count: number | null;
  processed_count: number | null;
  failed_count: number | null;
  ignored_count: number | null;
};

function mapConsultaHistoryRow(r: Record<string, unknown>): FocusNfeConsultaHistoryRow {
  return {
    exec_id: String(r.exec_id),
    consulta_at: String(r.consulta_at ?? ""),
    nfes_encontradas: Number(r.nfes_encontradas ?? 0),
    onboarding: r.onboarding === true,
    staging_xml_total:
      r.staging_xml_total != null ? Number(r.staging_xml_total) : null,
    summary: typeof r.summary === "string" ? r.summary : null,
    flow_diagnostic: r.flow_diagnostic ?? null,
    listed_count: r.listed_count != null ? Number(r.listed_count) : null,
    downloaded_count:
      r.downloaded_count != null ? Number(r.downloaded_count) : null,
    processed_count:
      r.processed_count != null ? Number(r.processed_count) : null,
    failed_count: r.failed_count != null ? Number(r.failed_count) : null,
    ignored_count: r.ignored_count != null ? Number(r.ignored_count) : null,
  };
}

/** Admin Faro: apaga todo o histórico de consultas NF-e da unidade. */
export async function purgeNfeConsultaHistory(
  companyId: string,
): Promise<
  | { ok: true; deletedCount: number }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc("purge_nfe_consulta_history", {
    p_company_id: companyId,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  const row =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  if (!row || row.ok !== true) {
    const msg =
      typeof row?.error === "string"
        ? row.error
        : "Não foi possível limpar o histórico.";
    return { ok: false, error: msg };
  }
  return {
    ok: true,
    deletedCount: Number(row.deleted_count ?? 0) || 0,
  };
}

export async function listFocusNfeConsultaHistory(
  companyId: string,
  limit = 50,
): Promise<
  | { ok: true; rows: FocusNfeConsultaHistoryRow[] }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc("focus_nfe_consulta_history_list", {
    p_company_id: companyId,
    p_limit: limit,
  });
  if (!error) {
    const rows = (Array.isArray(data) ? data : []).map((r) =>
      mapConsultaHistoryRow(r as Record<string, unknown>),
    );
    return { ok: true, rows };
  }

  // Fallback: leitura direta (membro/admin via RLS) se a RPC falhar (schema cache, etc.).
  console.warn(
    "[listFocusNfeConsultaHistory] RPC falhou, fallback table:",
    error.message,
  );
  const { data: tableData, error: tableErr } = await supabase
    .from("nfe_consulta_history")
    .select(
      "exec_id, consulta_at, nfes_encontradas, onboarding, staging_xml_total, summary, flow_diagnostic, listed_count, downloaded_count, processed_count, failed_count, ignored_count",
    )
    .eq("company_id", companyId)
    .order("consulta_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (tableErr) {
    return { ok: false, error: error.message };
  }
  return {
    ok: true,
    rows: (tableData ?? []).map((r) =>
      mapConsultaHistoryRow(r as Record<string, unknown>),
    ),
  };
}

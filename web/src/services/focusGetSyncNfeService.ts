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
  interpret_status: string | null;
  interpret_error: string | null;
  onboarding: boolean;
  staging_xml_total: number | null;
  finished_at: string | null;
};

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
  if (error) {
    return { ok: false, error: error.message };
  }
  const rows = (Array.isArray(data) ? data : []).map((r) => ({
    exec_id: String(r.exec_id),
    consulta_at: String(r.consulta_at ?? ""),
    nfes_encontradas: Number(r.nfes_encontradas ?? 0),
    interpret_status:
      r.interpret_status != null ? String(r.interpret_status) : null,
    interpret_error:
      r.interpret_error != null ? String(r.interpret_error) : null,
    onboarding: r.onboarding === true,
    staging_xml_total:
      r.staging_xml_total != null ? Number(r.staging_xml_total) : null,
    finished_at: r.finished_at != null ? String(r.finished_at) : null,
  }));
  return { ok: true, rows };
}

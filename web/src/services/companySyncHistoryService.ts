import { supabase } from "@/lib/supabase";

export type PurgeCompanySyncHistoryResult = {
  nfeHistory: number;
  nfeJobs: number;
  nfeStaging: number;
  epocRuns: number;
  epocJobs: number;
  csvJobs: number;
};

/** Admin Faro: para sync PDV/fiscal em curso e apaga o histórico da unidade. */
export async function purgeCompanySyncHistory(
  companyId: string,
): Promise<
  | { ok: true; counts: PurgeCompanySyncHistoryResult }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc("purge_company_sync_history", {
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
        : "Não foi possível limpar o histórico de sincronização.";
    return { ok: false, error: msg };
  }
  return {
    ok: true,
    counts: {
      nfeHistory: Number(row.nfe_history ?? 0) || 0,
      nfeJobs: Number(row.nfe_jobs ?? 0) || 0,
      nfeStaging: Number(row.nfe_staging ?? 0) || 0,
      epocRuns: Number(row.epoc_runs ?? 0) || 0,
      epocJobs: Number(row.epoc_jobs ?? 0) || 0,
      csvJobs: Number(row.csv_jobs ?? 0) || 0,
    },
  };
}

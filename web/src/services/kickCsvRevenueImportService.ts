import { supabase } from "@/lib/supabase";

export type KickCsvRevenueImportAction =
  | "triggered"
  | "reconciled"
  | "recreated";

export type KickCsvRevenueImportResponse = {
  ok: boolean;
  error?: string;
  job_id?: string;
  /** triggered = job existente; recreated = novo job do CSV no Storage; reconciled = onboarding alinhado com job COMPLETED. */
  action?: KickCsvRevenueImportAction;
  job_status?: string;
  resumed?: boolean;
};

/** Retoma job EPOC PENDING/PROCESSING (interpretação do CSV). */
export async function kickCsvRevenueImportJob(
  companyId: string,
  jobId?: string,
): Promise<KickCsvRevenueImportResponse> {
  const body: Record<string, string> = { company_id: companyId };
  if (jobId?.trim()) body.job_id = jobId.trim();

  const { data, error, response } = await supabase.functions.invoke<
    KickCsvRevenueImportResponse
  >("kick-csv-revenue-import-job", { body });

  if (error) {
    let msg = error.message;
    if (response) {
      try {
        const raw = await response.clone().text();
        if (raw) {
          try {
            const j = JSON.parse(raw) as { error?: string };
            if (j.error) msg = j.error;
          } catch {
            msg = raw.slice(0, 500);
          }
        }
      } catch {
        /* ignore */
      }
    }
    return { ok: false, error: msg };
  }

  if (!data?.ok) {
    return {
      ok: false,
      error: data?.error ?? "Falha ao retomar importação do CSV.",
    };
  }

  return data;
}

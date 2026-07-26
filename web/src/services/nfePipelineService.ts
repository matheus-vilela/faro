import { formatSupabaseFunctionError, supabase } from "@/lib/supabase";

export type NfeDispatcherResponse = {
  ok?: boolean;
  error?: string;
  enqueued?: number;
  job_id?: string | null;
  ensured?: string | null;
  backfilled?: number;
  due?: number;
};

/**
 * Acorda o pipeline NF-e para uma unidade (ensure state + enfileira sync_company).
 * O worker (cron 1 min) processa a fila.
 */
export async function invokeNfePipelineForCompany(input: {
  companyId: string;
  windowStartDate?: string;
}): Promise<
  | { ok: true; data: NfeDispatcherResponse }
  | { ok: false; error: string; data?: NfeDispatcherResponse }
> {
  const body: Record<string, unknown> = {
    manual: true,
    company_id: input.companyId,
    wake: true,
  };
  if (
    input.windowStartDate &&
    /^\d{4}-\d{2}-\d{2}$/.test(input.windowStartDate)
  ) {
    body.window_start_date = input.windowStartDate;
  }

  const { data, error } = await supabase.functions.invoke("nfe-dispatcher", {
    body,
  });

  if (error) {
    return {
      ok: false,
      error: formatSupabaseFunctionError(error),
    };
  }

  const typed = (data ?? {}) as NfeDispatcherResponse;
  if (typed.ok === true) {
    return { ok: true, data: typed };
  }

  return {
    ok: false,
    error:
      (typeof typed.error === "string" && typed.error) ||
      "Falha ao enfileirar sync NF-e.",
    data: typed,
  };
}

/** Garante nfe_sync_state (RPC) sem necessariamente disparar a Edge. */
export async function ensureNfeSyncState(input: {
  companyId: string;
  windowStartDate?: string;
  wake?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("nfe_sync_ensure_company_for_member", {
    p_company_id: input.companyId,
    p_window_start_date: input.windowStartDate ?? null,
    p_wake: input.wake !== false,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

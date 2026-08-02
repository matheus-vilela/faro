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

async function extractFunctionsInvokeError(
  error: unknown,
  data: unknown,
): Promise<string> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const bodyErr = (data as { error?: unknown }).error;
    if (typeof bodyErr === "string" && bodyErr.trim()) return bodyErr.trim();
  }
  const ctx =
    error && typeof error === "object" && "context" in error
      ? (error as { context: unknown }).context
      : null;
  if (ctx && typeof ctx === "object" && ctx !== null && "json" in ctx) {
    try {
      const j = await (ctx as Response).json();
      if (j && typeof j === "object" && typeof (j as { error?: unknown }).error === "string") {
        const msg = String((j as { error: string }).error).trim();
        if (msg) return msg;
      }
    } catch {
      /* ignore */
    }
  }
  return formatSupabaseFunctionError(error);
}

/**
 * Acorda o pipeline NF-e para uma unidade (ensure state + enfileira sync_company).
 * O worker processa a fila (cron ou wake imediato do dispatcher).
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

  const typed = (data ?? {}) as NfeDispatcherResponse;
  if (typed.ok === true) {
    return { ok: true, data: typed };
  }

  if (error) {
    return {
      ok: false,
      error: await extractFunctionsInvokeError(error, data),
      data: typed,
    };
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

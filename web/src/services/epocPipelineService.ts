import { formatSupabaseFunctionError, supabase } from "@/lib/supabase";

export type EpocDispatcherResponse = {
  ok?: boolean;
  error?: string;
  enqueued?: number;
  job_id?: string | null;
  ensured?: string | null;
  backfilled?: number;
  due?: number;
};

/**
 * Acorda o pipeline Epoc para uma unidade (ensure state + enfileira sync_company).
 * O worker (cron 1 min) processa a fila.
 */
export async function invokeEpocPipelineForCompany(input: {
  companyId: string;
  windowStartDate?: string;
  /** Força mode no ensure (ex.: onboarding no setup). */
  mode?: "onboarding" | "steady";
}): Promise<
  | { ok: true; data: EpocDispatcherResponse }
  | { ok: false; error: string; data?: EpocDispatcherResponse }
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
  if (input.mode === "onboarding" || input.mode === "steady") {
    body.mode = input.mode;
  }

  const { data, error } = await supabase.functions.invoke("epoc-dispatcher", {
    body,
  });

  if (error) {
    return {
      ok: false,
      error: formatSupabaseFunctionError(error),
    };
  }

  const typed = (data ?? {}) as EpocDispatcherResponse;
  if (typed.ok === true) {
    return { ok: true, data: typed };
  }

  return {
    ok: false,
    error:
      (typeof typed.error === "string" && typed.error) ||
      "Falha ao enfileirar sync Epoc.",
    data: typed,
  };
}

/** Garante epoc_sync_state (RPC) sem necessariamente disparar a Edge. */
export async function ensureEpocSyncState(input: {
  companyId: string;
  windowStartDate?: string;
  wake?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("epoc_sync_ensure_company_for_member", {
    p_company_id: input.companyId,
    p_window_start_date: input.windowStartDate ?? null,
    p_wake: input.wake !== false,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Fire-and-forget: acorda pipeline e mostra toast em falha. */
export function triggerEpocPipelineInBackground(
  companyId: string,
  opts?: { mode?: "onboarding" | "steady" },
): void {
  void (async () => {
    const r = await invokeEpocPipelineForCompany({
      companyId,
      mode: opts?.mode,
    });
    if (!r.ok) {
      console.warn("[epoc-dispatcher]", r.error);
    } else {
      console.info("[epoc-dispatcher] sync_company enfileirado");
    }
  })();
}

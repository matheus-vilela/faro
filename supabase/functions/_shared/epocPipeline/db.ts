import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type { EpocJobRow, EpocSyncStateRow } from "./types.ts";

export async function enqueueJob(
  admin: SupabaseClient,
  input: {
    type: string;
    companyId: string;
    payload?: Record<string, unknown>;
    priority?: number;
    runAfter?: string;
  },
): Promise<{ id: string | null; error?: string }> {
  const { data, error } = await admin.rpc("epoc_jobs_enqueue", {
    p_type: input.type,
    p_company_id: input.companyId,
    p_payload: input.payload ?? {},
    p_priority: input.priority ?? 0,
    p_run_after: input.runAfter ?? new Date().toISOString(),
  });
  if (error) return { id: null, error: error.message };
  return { id: data != null ? String(data) : null };
}

export async function completeJob(
  admin: SupabaseClient,
  jobId: string,
  ok: boolean,
  opts?: {
    errorMsg?: string;
    retryAfterMs?: number;
    softRequeue?: boolean;
    attemptsAfterClaim?: number;
  },
): Promise<void> {
  const retryAfter = opts?.retryAfterMs != null && opts.retryAfterMs > 0
    ? new Date(Date.now() + opts.retryAfterMs).toISOString()
    : null;

  if (!ok && opts?.softRequeue) {
    const attempts = Math.max(0, (opts.attemptsAfterClaim ?? 1) - 1);
    const { error } = await admin.from("epoc_jobs").update({
      status: "queued",
      leased_until: null,
      leased_by: null,
      run_after: retryAfter ?? new Date(Date.now() + 60_000).toISOString(),
      last_error: (opts.errorMsg ?? "soft requeue").slice(0, 2000),
      attempts,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);
    if (error) {
      console.warn("[epoc-pipeline] soft_requeue", jobId, error.message);
    }
    return;
  }

  const { error } = await admin.rpc("epoc_jobs_complete", {
    p_job_id: jobId,
    p_ok: ok,
    p_error: opts?.errorMsg ?? null,
    p_retry_after: retryAfter,
  });
  if (error) {
    console.warn("[epoc-pipeline] epoc_jobs_complete", jobId, error.message);
  }
}

export async function claimJobs(
  admin: SupabaseClient,
  limit: number,
  workerId: string,
  leaseSeconds: number,
): Promise<EpocJobRow[]> {
  const { data, error } = await admin.rpc("epoc_jobs_claim", {
    p_limit: limit,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    console.warn("[epoc-pipeline] epoc_jobs_claim", error.message);
    return [];
  }
  return (Array.isArray(data) ? data : []) as EpocJobRow[];
}

export async function loadSyncState(
  admin: SupabaseClient,
  companyId: string,
): Promise<EpocSyncStateRow | null> {
  const { data, error } = await admin
    .from("epoc_sync_state")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    console.warn("[epoc-pipeline] loadSyncState", companyId, error.message);
    return null;
  }
  return data as EpocSyncStateRow | null;
}

export async function loadOnboardingPdv(
  admin: SupabaseClient,
  companyId: string,
): Promise<Record<string, unknown>> {
  const { data } = await admin
    .from("companies")
    .select("onboarding_pdv")
    .eq("id", companyId)
    .maybeSingle();
  if (
    data?.onboarding_pdv && typeof data.onboarding_pdv === "object" &&
    !Array.isArray(data.onboarding_pdv)
  ) {
    return data.onboarding_pdv as Record<string, unknown>;
  }
  return {};
}

export async function patchOnboardingPdvFields(
  admin: SupabaseClient,
  companyId: string,
  patch: Record<string, unknown>,
): Promise<{ error?: string }> {
  const prev = await loadOnboardingPdv(admin, companyId);
  if (prev.completed === true && patch.completed !== true) {
    // Não reabre completed salvo pedido explícito.
  }
  const next = { ...prev, ...patch };
  const { error } = await admin
    .from("companies")
    .update({
      onboarding_pdv: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);
  if (error) return { error: error.message };
  return {};
}

/** Espelha campos lidos pelo dashboard de sync diário em company_integrations.settings. */
export async function mirrorDailyAttemptSettings(
  admin: SupabaseClient,
  companyId: string,
  ok: boolean,
  detail?: string,
): Promise<void> {
  const { data: row } = await admin
    .from("company_integrations")
    .select("settings")
    .eq("company_id", companyId)
    .eq("provider", "epoc")
    .maybeSingle();
  const settings =
    row?.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
      ? { ...(row.settings as Record<string, unknown>) }
      : {};
  const now = new Date().toISOString();
  settings.epoc_daily_sync_rotacao_at = now;
  settings.epoc_daily_sync_last_attempt_at = now;
  settings.epoc_daily_sync_last_attempt_ok = ok;
  if (detail) {
    settings.epoc_daily_sync_last_attempt_detail = detail.slice(0, 500);
  }
  await admin
    .from("company_integrations")
    .update({
      settings,
      updated_at: now,
    })
    .eq("company_id", companyId)
    .eq("provider", "epoc");
}

export async function nextSteadySyncAtIso(
  admin: SupabaseClient,
): Promise<string> {
  const { data, error } = await admin.rpc("epoc_next_steady_sync_at");
  if (error || data == null) {
    // Fallback: +24h
    return new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  }
  return String(data);
}

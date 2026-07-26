import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type { NfeJobRow, NfeSyncStateRow } from "./types.ts";

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
  const { data, error } = await admin.rpc("nfe_jobs_enqueue", {
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
    /** attempts atuais após o claim; soft requeue devolve 1. */
    attemptsAfterClaim?: number;
  },
): Promise<void> {
  const retryAfter = opts?.retryAfterMs != null && opts.retryAfterMs > 0
    ? new Date(Date.now() + opts.retryAfterMs).toISOString()
    : null;

  if (!ok && opts?.softRequeue) {
    const attempts = Math.max(0, (opts.attemptsAfterClaim ?? 1) - 1);
    const { error } = await admin.from("nfe_jobs").update({
      status: "queued",
      leased_until: null,
      leased_by: null,
      run_after: retryAfter ?? new Date(Date.now() + 60_000).toISOString(),
      last_error: (opts.errorMsg ?? "soft requeue").slice(0, 2000),
      attempts,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);
    if (error) {
      console.warn("[nfe-pipeline] soft_requeue", jobId, error.message);
    }
    return;
  }

  const { error } = await admin.rpc("nfe_jobs_complete", {
    p_job_id: jobId,
    p_ok: ok,
    p_error: opts?.errorMsg ?? null,
    p_retry_after: retryAfter,
  });
  if (error) {
    console.warn("[nfe-pipeline] nfe_jobs_complete", jobId, error.message);
  }
}

export async function claimJobs(
  admin: SupabaseClient,
  limit: number,
  workerId: string,
  leaseSeconds: number,
): Promise<NfeJobRow[]> {
  const { data, error } = await admin.rpc("nfe_jobs_claim", {
    p_limit: limit,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    console.warn("[nfe-pipeline] nfe_jobs_claim", error.message);
    return [];
  }
  return (Array.isArray(data) ? data : []) as NfeJobRow[];
}

export async function loadSyncState(
  admin: SupabaseClient,
  companyId: string,
): Promise<NfeSyncStateRow | null> {
  const { data, error } = await admin
    .from("nfe_sync_state")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    console.warn("[nfe-pipeline] loadSyncState", companyId, error.message);
    return null;
  }
  return data as NfeSyncStateRow | null;
}

export async function loadCompanyFocus(
  admin: SupabaseClient,
  companyId: string,
): Promise<{
  document: string;
  focusnfe: Record<string, unknown>;
  onboarding_fiscal: Record<string, unknown>;
} | null> {
  const { data, error } = await admin
    .from("companies")
    .select("document, focusnfe, onboarding_fiscal")
    .eq("id", companyId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    document: String(data.document ?? ""),
    focusnfe:
      data.focusnfe && typeof data.focusnfe === "object" &&
        !Array.isArray(data.focusnfe)
        ? (data.focusnfe as Record<string, unknown>)
        : {},
    onboarding_fiscal:
      data.onboarding_fiscal && typeof data.onboarding_fiscal === "object" &&
        !Array.isArray(data.onboarding_fiscal)
        ? (data.onboarding_fiscal as Record<string, unknown>)
        : {},
  };
}

export function cnpj14(document: string): string | null {
  const d = document.replace(/\D/g, "").slice(0, 14);
  return d.length === 14 ? d : null;
}

export async function companyHasOpenJobs(
  admin: SupabaseClient,
  companyId: string,
  excludeJobId?: string,
): Promise<boolean> {
  let q = admin
    .from("nfe_jobs")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .in("status", ["queued", "leased"]);
  if (excludeJobId) q = q.neq("id", excludeJobId);
  const { count, error } = await q;
  if (error) {
    console.warn("[nfe-pipeline] companyHasOpenJobs", error.message);
    return true;
  }
  return (count ?? 0) > 0;
}

export async function patchOnboardingCaptureCompleted(
  admin: SupabaseClient,
  companyId: string,
  stats: { max_nfes_sync: number; nfes_sync: number; nfes_ignored: number },
  opts?: { markCompleted?: boolean },
): Promise<{ error?: string }> {
  const { data: row, error: rErr } = await admin
    .from("companies")
    .select("onboarding_fiscal")
    .eq("id", companyId)
    .maybeSingle();
  if (rErr) return { error: rErr.message };
  const base =
    row?.onboarding_fiscal && typeof row.onboarding_fiscal === "object" &&
      !Array.isArray(row.onboarding_fiscal)
      ? { ...(row.onboarding_fiscal as Record<string, unknown>) }
      : {};
  if (base.completed === true) return {};
  const next: Record<string, unknown> = {
    ...base,
    sync: false,
    capture_completed: true,
    max_nfes_sync: stats.max_nfes_sync,
    nfes_sync: stats.nfes_sync,
    nfes_ignored: stats.nfes_ignored,
    sefaz_unavailable: false,
  };
  if (opts?.markCompleted) {
    next.completed = true;
  }
  delete next.sefaz_unavailable_at;
  delete next.sefaz_retry_at;
  delete next.sefaz_error_detail;
  const { error } = await admin
    .from("companies")
    .update({
      onboarding_fiscal: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);
  if (error) return { error: error.message };
  return {};
}

export async function patchOnboardingSefazUnavailable(
  admin: SupabaseClient,
  companyId: string,
  detail: string,
  retryMinutes = 30,
): Promise<void> {
  const { data: row } = await admin
    .from("companies")
    .select("onboarding_fiscal")
    .eq("id", companyId)
    .maybeSingle();
  const base =
    row?.onboarding_fiscal && typeof row.onboarding_fiscal === "object" &&
      !Array.isArray(row.onboarding_fiscal)
      ? { ...(row.onboarding_fiscal as Record<string, unknown>) }
      : {};
  if (base.completed === true || base.capture_completed === true) return;
  const retryAt = new Date(Date.now() + retryMinutes * 60_000).toISOString();
  const next = {
    ...base,
    sync: true,
    sefaz_unavailable: true,
    sefaz_unavailable_at: new Date().toISOString(),
    sefaz_retry_at: retryAt,
    sefaz_error_detail: detail.slice(0, 300),
  };
  await admin
    .from("companies")
    .update({
      onboarding_fiscal: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);
}

export async function clearOnboardingSefaz(
  admin: SupabaseClient,
  companyId: string,
): Promise<void> {
  const { data: row } = await admin
    .from("companies")
    .select("onboarding_fiscal")
    .eq("id", companyId)
    .maybeSingle();
  const base =
    row?.onboarding_fiscal && typeof row.onboarding_fiscal === "object" &&
      !Array.isArray(row.onboarding_fiscal)
      ? { ...(row.onboarding_fiscal as Record<string, unknown>) }
      : {};
  const next = { ...base, sefaz_unavailable: false };
  delete next.sefaz_unavailable_at;
  delete next.sefaz_retry_at;
  delete next.sefaz_error_detail;
  await admin
    .from("companies")
    .update({
      onboarding_fiscal: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);
}

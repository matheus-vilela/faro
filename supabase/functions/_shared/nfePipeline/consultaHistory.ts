/**
 * Persistência do histórico de consultas NF-e (nfe_consulta_history).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  buildNfeCycleFlowDiagnostic,
  buildNfeQueuedFlowDiagnostic,
  type NfeFlowDiagnostic,
} from "../nfeFlowDiagnostic.ts";
import { enqueueJob, enqueuePendingInterpretations, onboardingHasActiveWork } from "./db.ts";

const LOG = "[nfe-pipeline]";

function nowIso(): string {
  return new Date().toISOString();
}

/** Grava histórico no momento do enqueue (etapa 1 = Em curso). */
export async function upsertQueuedNfeConsultaHistory(
  admin: SupabaseClient,
  input: {
    companyId: string;
    cycleId: string;
    onboarding: boolean;
  },
): Promise<void> {
  const { data: existing } = await admin
    .from("nfe_consulta_history")
    .select("listed_count, downloaded_count, processed_count")
    .eq("company_id", input.companyId)
    .eq("exec_id", input.cycleId)
    .maybeSingle();
  const listed = Number(existing?.listed_count ?? 0) || 0;
  const downloaded = Number(existing?.downloaded_count ?? 0) || 0;
  const processed = Number(existing?.processed_count ?? 0) || 0;
  // Não zerar um ciclo já em progresso (senão a UI volta a 0/X a cada poll).
  if (listed > 0 || downloaded > 0 || processed > 0) {
    return;
  }

  const flowDiagnostic = buildNfeQueuedFlowDiagnostic();
  const { error } = await admin.from("nfe_consulta_history").upsert(
    {
      company_id: input.companyId,
      exec_id: input.cycleId,
      consulta_at: nowIso(),
      nfes_encontradas: 0,
      staging_xml_total: 0,
      onboarding: input.onboarding,
      summary: flowDiagnostic.summary,
      flow_diagnostic: flowDiagnostic,
      listed_count: 0,
      downloaded_count: 0,
      processed_count: 0,
      failed_count: 0,
      ignored_count: 0,
    },
    { onConflict: "company_id,exec_id" },
  );
  if (error) {
    console.error(LOG, "consulta_history_queued", {
      company_id: input.companyId,
      exec_id: input.cycleId,
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    throw new Error(`Falha ao gravar histórico da consulta: ${error.message}`);
  }
}

/**
 * Enfileira sync_company com cycle_id e cria/atualiza histórico pendente.
 * Respeita dedupe do job (reutiliza cycle_id já no payload).
 */
export async function enqueueSyncCompanyWithQueuedHistory(
  admin: SupabaseClient,
  input: {
    companyId: string;
    priority: number;
    onboarding: boolean;
  },
): Promise<{
  jobId: string | null;
  cycleId: string | null;
  error?: string;
  skipped?: string;
}> {
  const active = input.onboarding
    ? await onboardingHasActiveWork(admin, input.companyId)
    : { busy: false, cycleId: null as string | null };
  if (active.busy) {
    if (active.reason === "pending_interpret") {
      try {
        await enqueuePendingInterpretations(admin, input.companyId);
      } catch (e) {
        console.warn(
          LOG,
          "enqueue_pending_on_skip",
          input.companyId,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
    return {
      jobId: null,
      cycleId: active.cycleId,
      skipped: active.reason ?? "onboarding_active",
    };
  }

  const cycleId = active.cycleId || crypto.randomUUID();
  const enq = await enqueueJob(admin, {
    type: "sync_company",
    companyId: input.companyId,
    payload: { cycle_id: cycleId },
    priority: input.priority,
  });
  if (enq.error) {
    return { jobId: null, cycleId: null, error: enq.error };
  }
  if (!enq.id) {
    return { jobId: null, cycleId: null, error: "enqueue sem job_id" };
  }

  let effectiveCycleId = cycleId;
  const { data: job } = await admin
    .from("nfe_jobs")
    .select("payload")
    .eq("id", enq.id)
    .maybeSingle();
  const payload =
    job?.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? (job.payload as Record<string, unknown>)
      : {};
  const existingCycle =
    typeof payload.cycle_id === "string" ? payload.cycle_id.trim() : "";

  if (existingCycle && existingCycle !== cycleId) {
    effectiveCycleId = existingCycle;
  } else if (!existingCycle) {
    const { error: patchErr } = await admin
      .from("nfe_jobs")
      .update({
        payload: { ...payload, cycle_id: cycleId },
        updated_at: nowIso(),
      })
      .eq("id", enq.id);
    if (patchErr) {
      console.warn(LOG, "sync_company_payload_cycle", enq.id, patchErr.message);
    }
  }

  try {
    await upsertQueuedNfeConsultaHistory(admin, {
      companyId: input.companyId,
      cycleId: effectiveCycleId,
      onboarding: input.onboarding,
    });
  } catch (e) {
    // Job já enfileirado; não falha o wake — só regista o erro de histórico.
    console.error(LOG, "consulta_history_after_enqueue", {
      company_id: input.companyId,
      job_id: enq.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return { jobId: enq.id, cycleId: effectiveCycleId };
}

/**
 * Recalcula e grava o diagnóstico do ciclo a partir dos nfe_documents
 * com este cycle_id (exec_id do histórico).
 */
export async function recordConsultaHistory(
  admin: SupabaseClient,
  companyId: string,
  cycleId: string | null,
  onboarding: boolean,
  opts?: {
    searchFailed?: boolean;
    searchError?: string | null;
    flowDiagnostic?: NfeFlowDiagnostic | null;
  },
): Promise<void> {
  if (!cycleId) return;

  try {
    const base = () =>
      admin
        .from("nfe_documents")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("cycle_id", cycleId);

    const [
      listedRes,
      ignoredRes,
      downloadedRes,
      downloadFailedRes,
      processedRes,
      processFailedRes,
    ] = await Promise.all([
      base().neq("fetch_status", "ignored"),
      base().eq("fetch_status", "ignored"),
      base()
        .eq("fetch_status", "downloaded")
        .not("xml_storage_path", "is", null),
      base().eq("fetch_status", "failed"),
      base().eq("fetch_status", "downloaded").eq("process_status", "done"),
      base().eq("fetch_status", "downloaded").eq("process_status", "failed"),
    ]);

    for (const res of [
      listedRes,
      ignoredRes,
      downloadedRes,
      downloadFailedRes,
      processedRes,
      processFailedRes,
    ]) {
      if (res.error) {
        console.warn(LOG, "consulta_history_count", companyId, res.error.message);
      }
    }

    const listed = listedRes.count ?? 0;
    const ignored = ignoredRes.count ?? 0;
    const downloaded = downloadedRes.count ?? 0;
    const downloadFailed = downloadFailedRes.count ?? 0;
    const processed = processedRes.count ?? 0;
    const processFailed = processFailedRes.count ?? 0;

    let listExhausted: boolean | undefined;
    if (onboarding) {
      const { data: co } = await admin
        .from("companies")
        .select("onboarding_fiscal")
        .eq("id", companyId)
        .maybeSingle();
      const fiscal =
        co?.onboarding_fiscal && typeof co.onboarding_fiscal === "object" &&
          !Array.isArray(co.onboarding_fiscal)
          ? (co.onboarding_fiscal as Record<string, unknown>)
          : {};
      listExhausted = fiscal.list_exhausted === true;
    }

    const flowDiagnostic =
      opts?.flowDiagnostic ??
      buildNfeCycleFlowDiagnostic({
        searchFailed:
          Boolean(opts?.searchFailed) && listed === 0 && ignored === 0,
        searchError: opts?.searchError,
        listed,
        downloaded,
        downloadFailed,
        processed,
        processFailed,
        ignored,
        listExhausted,
      });

    const { error: insErr } = await admin.from("nfe_consulta_history").upsert(
      {
        company_id: companyId,
        exec_id: cycleId,
        nfes_encontradas: listed,
        staging_xml_total: downloaded,
        onboarding,
        summary: flowDiagnostic.summary,
        flow_diagnostic: flowDiagnostic,
        listed_count: listed,
        downloaded_count: downloaded,
        processed_count: processed,
        failed_count: processFailed + downloadFailed,
        ignored_count: ignored,
      },
      { onConflict: "company_id,exec_id" },
    );

    if (insErr) {
      console.warn(LOG, "consulta_history_insert", companyId, insErr.message);
      return;
    }

    console.log(LOG, JSON.stringify({
      fase: "consulta_history",
      company_id: companyId,
      exec_id: cycleId,
      nfes_encontradas: listed,
      staging_xml_total: downloaded,
      processed,
      process_failed: processFailed,
      download_failed: downloadFailed,
      ignored,
      onboarding,
      flow_blocked_at: flowDiagnostic.blocked_at,
    }));
  } catch (e) {
    console.warn(
      LOG,
      "consulta_history_exception",
      companyId,
      e instanceof Error ? e.message : String(e),
    );
  }
}

/**
 * Recalcula históricos recentes em que o snapshot ficou atrás dos
 * nfe_documents (ex.: close_cycle gravou 0/N e zerou o cycle_id).
 */
export async function reconcileStaleConsultaHistories(
  admin: SupabaseClient,
  limit = 20,
): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from("nfe_consulta_history")
    .select(
      "company_id, exec_id, onboarding, downloaded_count, processed_count",
    )
    .gte("consulta_at", since)
    .order("consulta_at", { ascending: false })
    .limit(200);
  if (error) {
    console.warn(LOG, "consulta_history_reconcile_list", error.message);
    return 0;
  }

  let n = 0;
  for (const row of rows ?? []) {
    const down = Number(row.downloaded_count ?? 0) || 0;
    const proc = Number(row.processed_count ?? 0) || 0;
    if (down <= 0 || proc >= down) continue;

    const companyId = String(row.company_id ?? "");
    const cycleId = String(row.exec_id ?? "").trim();
    if (!companyId || !cycleId) continue;

    const { count: liveDown } = await admin
      .from("nfe_documents")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("cycle_id", cycleId)
      .eq("fetch_status", "downloaded");
    if ((liveDown ?? 0) === 0) continue;

    await recordConsultaHistory(
      admin,
      companyId,
      cycleId,
      Boolean(row.onboarding),
    );
    n += 1;
    if (n >= limit) break;
  }
  return n;
}

export type { NfeFlowDiagnostic };

/**
 * Persistência do histórico de consultas NF-e (nfe_consulta_history).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  buildNfeQueuedFlowDiagnostic,
  type NfeFlowDiagnostic,
} from "../nfeFlowDiagnostic.ts";
import { enqueueJob } from "./db.ts";

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
}> {
  const cycleId = crypto.randomUUID();
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

export type { NfeFlowDiagnostic };

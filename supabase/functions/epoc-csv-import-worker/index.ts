/**
 * Orquestrador do import CSV Epoc (Fase heartbeat + self-call + watchdog).
 *
 * - POST { job_id, worker_token? } — claim/renew e processa um turno de chunks
 * - POST { mode: "watchdog" } — retoma jobs PROCESSING com heartbeat ≥ 2 min
 *
 * Auth: Bearer SERVICE_ROLE ou EPOC_DAILY_CRON_SECRET (cron).
 * O processamento pesado continua em process-integration-csv-revenue-job
 * com orchestrated=true (sem depender da fila pgmq para continuar).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  claimEpocCsvImportJob,
  EPOC_CSV_IMPORT_STALE_SECONDS,
  heartbeatEpocCsvImportJob,
  pickStaleEpocCsvImportJobs,
  runCsvImportChunkSession,
  selfInvokeEpocCsvImportWorker,
} from "../_shared/epocCsvImportOrchestrator.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOG = "[epoc-csv-import-worker]";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function authorize(req: Request): { ok: true; bearer: string } | { ok: false; response: Response } {
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  const cronSecret = Deno.env.get("EPOC_DAILY_CRON_SECRET")?.trim() ?? "";

  if (!bearer) {
    return { ok: false, response: json({ ok: false, error: "Não autorizado." }, 401) };
  }
  if (serviceKey && bearer === serviceKey) {
    return { ok: true, bearer };
  }
  if (cronSecret && bearer === cronSecret) {
    return { ok: true, bearer };
  }
  return { ok: false, response: json({ ok: false, error: "Não autorizado." }, 401) };
}

async function processOneJob(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  selfBearer: string,
  jobId: string,
  workerTokenIn: string | null,
): Promise<Record<string, unknown>> {
  const claim = await claimEpocCsvImportJob(
    admin,
    jobId,
    workerTokenIn,
    EPOC_CSV_IMPORT_STALE_SECONDS,
  );
  if (!claim) {
    return { ok: false, job_id: jobId, error: "claim falhou" };
  }

  if (claim.action === "terminal") {
    return {
      ok: true,
      job_id: jobId,
      skipped: true,
      reason: "terminal",
      status: claim.status,
    };
  }

  if (claim.action === "alive") {
    return {
      ok: true,
      job_id: jobId,
      skipped: true,
      reason: "alive",
      heartbeat_window_seconds: EPOC_CSV_IMPORT_STALE_SECONDS,
    };
  }

  const token = claim.worker_token;
  if (!token) {
    return { ok: false, job_id: jobId, error: "worker_token ausente após claim" };
  }

  // Orquestrador já pôs status=PROCESSING — o processador deve sempre usar resume
  // (o path sem resume exige PENDING e ainda zera o cursor).
  const session = await runCsvImportChunkSession(
    supabaseUrl,
    serviceKey,
    jobId,
    {
      resume: true,
      logTag: LOG,
      // Um turno curto: o processador já faz 1–2 chunks; o self-call encadeia o resto.
      // Timeout alto demais + chain inline longo deixava o job órfão em 0/N.
      timeoutMs: 90_000,
    },
  );

  await heartbeatEpocCsvImportJob(admin, jobId, token);

  const leaseBusy =
    session.body?.skipped === true &&
    session.body?.reason === "chunk_lease_busy";
  const transientFail =
    !session.ok &&
    session.body?.skipped !== true &&
    (session.status === 0 ||
      /abort|timeout|timed out|network/i.test(session.error ?? ""));

  // Continuar: ainda há chunks, lease ocupado por invocação irmã, ou timeout transitório.
  // NÃO tratar lease_busy como "concluído" (bug que deixava o card em 0/N).
  if (session.continuing === true || leaseBusy || transientFail) {
    await heartbeatEpocCsvImportJob(admin, jobId, token);
    selfInvokeEpocCsvImportWorker(
      supabaseUrl,
      // Self-call com service role para auth estável (cron bearer também serve).
      serviceKey || selfBearer,
      { job_id: jobId, worker_token: token },
      LOG,
    );
    console.log(LOG, JSON.stringify({
      fase: "self_invoke",
      job_id: jobId,
      resume: claim.csv_resume_row_index,
      action: claim.action,
      continuing: session.continuing === true,
      lease_busy: leaseBusy,
      transient_fail: transientFail,
      session_ok: session.ok,
      session_error: session.error ?? null,
    }));
    return {
      ok: true,
      job_id: jobId,
      worker_token: token,
      continuing: true,
      chained: true,
      lease_busy: leaseBusy,
      detail: session.body,
      ...(transientFail
        ? { session_error: session.error ?? "falha transitória no turno" }
        : {}),
    };
  }

  if (!session.ok && session.body?.skipped === true) {
    return {
      ok: true,
      job_id: jobId,
      worker_token: token,
      skipped: true,
      reason: session.body.reason ?? "processor_skipped",
      detail: session.body,
    };
  }

  if (!session.ok) {
    return {
      ok: false,
      job_id: jobId,
      worker_token: token,
      error: session.error ?? "falha no turno de chunks",
      detail: session.body,
    };
  }

  console.log(LOG, JSON.stringify({
    fase: "turno_concluido",
    job_id: jobId,
    phase: session.phase ?? null,
    action: claim.action,
  }));

  return {
    ok: true,
    job_id: jobId,
    worker_token: token,
    continuing: false,
    phase: session.phase ?? "completed",
    detail: session.body,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const auth = authorize(req);
  if (!auth.ok) return auth.response;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (body.mode === "watchdog") {
    const stale = await pickStaleEpocCsvImportJobs(
      admin,
      5,
      EPOC_CSV_IMPORT_STALE_SECONDS,
    );
    const outcomes: Array<Record<string, unknown>> = [];
    for (const jobId of stale) {
      // Reclaim (token null) — heartbeat velho.
      const r = await processOneJob(
        admin,
        supabaseUrl,
        serviceKey,
        auth.bearer,
        jobId,
        null,
      );
      outcomes.push(r);
    }
    console.log(LOG, JSON.stringify({
      fase: "watchdog",
      stale: stale.length,
      processed: outcomes.length,
    }));
    return json({
      ok: true,
      mode: "watchdog",
      stale: stale.length,
      outcomes,
    });
  }

  const jobId = typeof body.job_id === "string" ? body.job_id.trim() : "";
  if (!jobId) {
    return json({ ok: false, error: "job_id é obrigatório (ou mode=watchdog)." }, 400);
  }
  const workerToken =
    typeof body.worker_token === "string" && body.worker_token.trim()
      ? body.worker_token.trim()
      : null;

  const result = await processOneJob(
    admin,
    supabaseUrl,
    serviceKey,
    auth.bearer,
    jobId,
    workerToken,
  );

  return json(result, result.ok === false ? 500 : 200);
});

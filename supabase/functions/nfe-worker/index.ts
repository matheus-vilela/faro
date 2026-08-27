/**
 * Worker do pipeline NF-e (Fase 1).
 *
 * Cron: Bearer FOCUS_NFE_RECEBIDAS_CRON_SECRET
 * Manual: { manual: true } + JWT (ops/dev)
 *
 * Claim (SKIP LOCKED) → jobs até ~10s antes do próximo cron.
 * `download_xml` corre até 4 em paralelo; os restantes tipos ficam sequenciais.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { isPlatformAdminUser } from "../_shared/companyAccess.ts";
import {
  authorizeNfePipeline,
  corsHeaders,
  json,
  parseJsonBody,
} from "../_shared/nfePipeline/auth.ts";
import { claimJobs, completeJob } from "../_shared/nfePipeline/db.ts";
import {
  leaseSeconds,
  workerBudgetMs,
  workerDownloadConcurrency,
  workerJobsPerTick,
  workerStopBeforeTickMs,
} from "../_shared/nfePipeline/env.ts";
import { runNfeJob } from "../_shared/nfePipeline/handlers.ts";
import type { JobResult, NfeJobRow } from "../_shared/nfePipeline/types.ts";
import { workerShouldStopForNextTick } from "../_shared/nfePipeline/workerSchedule.ts";

const LOG = "[nfe-worker]";

type JobOutcome = {
  job_id: string;
  type: string;
  company_id: string;
  ok: boolean;
  deferred?: boolean;
  fatal?: boolean;
  error?: string;
  detail?: Record<string, unknown> | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  let bodyRaw: unknown = {};
  try {
    bodyRaw = await req.json();
  } catch {
    bodyRaw = {};
  }
  const body = parseJsonBody(bodyRaw);

  const auth = await authorizeNfePipeline(req, body);
  if (!auth.ok) return auth.response;
  const { admin, mode, userId } = auth;

  // Invoke manual processa a fila global — só cron secret ou is_admin.
  if (mode === "manual") {
    if (!userId || !(await isPlatformAdminUser(admin, userId))) {
      return json(
        {
          ok: false,
          error:
            "Apenas administradores da plataforma podem invocar o worker manualmente.",
        },
        403,
      );
    }
  }

  const budgetMs = workerBudgetMs();
  const maxJobs = workerJobsPerTick();
  const lease = leaseSeconds();
  const stopBeforeMs = workerStopBeforeTickMs();
  const downloadParallel = workerDownloadConcurrency();
  const alignToCron = mode !== "manual";
  const workerId = `nfe-worker-${crypto.randomUUID().slice(0, 8)}`;
  const t0 = performance.now();

  const results: JobOutcome[] = [];
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let deferred = 0;

  const shouldStop = () =>
    processed >= maxJobs ||
    workerShouldStopForNextTick({
      alignToCron,
      stopBeforeMs,
      elapsedMs: performance.now() - t0,
      budgetMs,
    });

  const settle = async (job: NfeJobRow): Promise<void> => {
    let result: JobResult;
    try {
      result = await runNfeJob(admin, job);
    } catch (e) {
      result = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        retryAfterMs: 30_000,
      };
    }

    if (result.ok) {
      succeeded += 1;
      await completeJob(admin, job.id, true);
      results.push({
        job_id: job.id,
        type: job.type,
        company_id: job.company_id,
        ok: true,
        detail: result.detail ?? null,
      });
      return;
    }

    if (result.softRequeue) {
      deferred += 1;
      await completeJob(admin, job.id, false, {
        errorMsg: result.error,
        retryAfterMs: result.retryAfterMs,
        softRequeue: true,
        attemptsAfterClaim: job.attempts,
      });
      results.push({
        job_id: job.id,
        type: job.type,
        company_id: job.company_id,
        ok: true,
        deferred: true,
        error: result.error,
      });
      return;
    }

    failed += 1;
    if (result.fatal) {
      await admin.from("nfe_jobs").update({
        status: "dead",
        leased_until: null,
        leased_by: null,
        last_error: result.error.slice(0, 2000),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
    } else {
      await completeJob(admin, job.id, false, {
        errorMsg: result.error,
        retryAfterMs: result.retryAfterMs,
      });
    }
    results.push({
      job_id: job.id,
      type: job.type,
      company_id: job.company_id,
      ok: false,
      error: result.error,
      fatal: result.fatal === true,
    });
  };

  while (!shouldStop()) {
    const room = maxJobs - processed;
    const claimN = Math.min(downloadParallel, Math.max(1, room));
    const batch = await claimJobs(admin, claimN, workerId, lease);
    if (batch.length === 0) break;

    processed += batch.length;
    const downloads = batch.filter((j) => j.type === "download_xml");
    const others = batch.filter((j) => j.type !== "download_xml");

    for (const job of others) {
      await settle(job);
    }
    if (downloads.length > 0) {
      await Promise.all(downloads.map((job) => settle(job)));
    }
  }

  const elapsedMs = Math.round(performance.now() - t0);
  console.log(LOG, JSON.stringify({
    fase: "worker_fim",
    mode,
    processed,
    succeeded,
    failed,
    deferred,
    download_parallel: downloadParallel,
    elapsed_ms: elapsedMs,
  }));

  return json({
    ok: true,
    mode,
    processed,
    succeeded,
    failed,
    deferred,
    elapsed_ms: elapsedMs,
    detail: results,
  });
});

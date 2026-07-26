/**
 * Worker do pipeline Epoc (Fase 1).
 *
 * Cron: Bearer EPOC_DAILY_CRON_SECRET
 * Manual: { manual: true } + JWT (ops/dev)
 *
 * Claim (SKIP LOCKED) → executa jobs até budget de tempo.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authorizeEpocPipeline,
  corsHeaders,
  json,
  parseJsonBody,
} from "../_shared/epocPipeline/auth.ts";
import { claimJobs, completeJob } from "../_shared/epocPipeline/db.ts";
import {
  leaseSeconds,
  workerBudgetMs,
  workerJobsPerTick,
} from "../_shared/epocPipeline/env.ts";
import { runEpocJob } from "../_shared/epocPipeline/handlers.ts";

const LOG = "[epoc-worker]";

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

  const auth = await authorizeEpocPipeline(req, body);
  if (!auth.ok) return auth.response;
  const { admin, mode } = auth;

  const budgetMs = workerBudgetMs();
  const maxJobs = workerJobsPerTick();
  const lease = leaseSeconds();
  const workerId = `epoc-worker-${crypto.randomUUID().slice(0, 8)}`;
  const t0 = performance.now();

  const results: Array<Record<string, unknown>> = [];
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  while (processed < maxJobs && performance.now() - t0 < budgetMs) {
    const remainingBudget = budgetMs - (performance.now() - t0);
    if (remainingBudget < 10_000) break;

    const batch = await claimJobs(admin, 1, workerId, lease);
    if (batch.length === 0) break;

    const job = batch[0];
    processed += 1;

    let result;
    try {
      result = await runEpocJob(admin, job);
    } catch (e) {
      result = {
        ok: false as const,
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
    } else if (result.softRequeue) {
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
    } else {
      failed += 1;
      if (result.fatal) {
        await admin.from("epoc_jobs").update({
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
    }
  }

  const elapsedMs = Math.round(performance.now() - t0);
  console.log(LOG, JSON.stringify({
    fase: "worker_fim",
    mode,
    processed,
    succeeded,
    failed,
    elapsed_ms: elapsedMs,
  }));

  return json({
    ok: true,
    mode,
    processed,
    succeeded,
    failed,
    elapsed_ms: elapsedMs,
    detail: results,
  });
});

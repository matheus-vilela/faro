/**
 * Dispatcher do pipeline Epoc (Fase 1).
 *
 * Cron: Bearer EPOC_DAILY_CRON_SECRET
 * Manual: { manual: true, company_id?, wake?: true, window_start_date?: "YYYY-MM-DD" } + JWT
 *
 * - Backfill de empresas Epoc sem epoc_sync_state
 * - Enfileira sync_company para empresas due (next_sync_at)
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { userHasCompanyAccess } from "../_shared/companyAccess.ts";
import {
  authorizeEpocPipeline,
  corsHeaders,
  json,
  parseJsonBody,
} from "../_shared/epocPipeline/auth.ts";
import { enqueueJob } from "../_shared/epocPipeline/db.ts";
import { dispatcherCompaniesPerTick } from "../_shared/epocPipeline/env.ts";

const LOG = "[epoc-dispatcher]";

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
  const { admin, mode, userId } = auth;

  const limit = dispatcherCompaniesPerTick();
  let ensured: string | null = null;
  let enqueued = 0;
  let backfilled = 0;

  const companyId =
    typeof body.company_id === "string" && body.company_id.trim()
      ? body.company_id.trim()
      : null;

  if (mode === "manual" && companyId) {
    if (!userId) {
      return json({ ok: false, error: "Sessão inválida." }, 401);
    }
    if (!(await userHasCompanyAccess(admin, userId, companyId))) {
      return json({ ok: false, error: "Sem acesso a esta unidade." }, 403);
    }

    const windowDate =
      typeof body.window_start_date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(body.window_start_date)
        ? body.window_start_date
        : null;

    const modeOverride =
      body.mode === "onboarding" || body.mode === "steady"
        ? body.mode
        : null;

    const { data: state, error: ensErr } = await admin.rpc(
      "epoc_sync_ensure_company",
      {
        p_company_id: companyId,
        p_window_start_date: windowDate,
        p_mode: modeOverride,
        p_wake: body.wake !== false,
      },
    );
    if (ensErr) {
      return json({ ok: false, error: ensErr.message }, 400);
    }
    ensured = companyId;

    const priority = Number((state as { priority?: number } | null)?.priority ?? 0);

    // Não empilhar sync se já há jobs abertos (fetch/close/import em curso).
    const { count: openJobs } = await admin
      .from("epoc_jobs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", ["queued", "leased"]);
    if ((openJobs ?? 0) > 0) {
      console.log(LOG, JSON.stringify({
        fase: "manual_wake_skip_open_jobs",
        company_id: companyId,
        open_jobs: openJobs,
      }));
      return json({
        ok: true,
        mode,
        ensured,
        enqueued: 0,
        skipped: true,
        reason: "ja_ha_jobs_abertos",
      });
    }

    const enq = await enqueueJob(admin, {
      type: "sync_company",
      companyId,
      payload: {},
      priority,
    });
    if (enq.error) {
      return json({ ok: false, error: enq.error, ensured }, 500);
    }
    if (enq.id) enqueued += 1;

    console.log(LOG, JSON.stringify({
      fase: "manual_wake",
      company_id: companyId,
      job_id: enq.id,
    }));

    return json({
      ok: true,
      mode,
      ensured,
      enqueued,
      job_id: enq.id,
    });
  }

  // Recupera ciclos stuck (running sem jobs abertos há > 45 min).
  {
    const cutoff = new Date(Date.now() - 45 * 60_000).toISOString();
    const { data: stuck } = await admin
      .from("epoc_sync_state")
      .select("company_id")
      .eq("status", "running")
      .lt("running_since", cutoff)
      .limit(50);
    for (const row of stuck ?? []) {
      const cid = String(row.company_id);
      const { count } = await admin
        .from("epoc_jobs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", cid)
        .in("status", ["queued", "leased"]);
      if ((count ?? 0) === 0) {
        await admin.from("epoc_sync_state").update({
          status: "idle",
          running_since: null,
          cycle_id: null,
          next_sync_at: new Date().toISOString(),
          last_error: "ciclo stuck recuperado pelo dispatcher",
          updated_at: new Date().toISOString(),
        }).eq("company_id", cid);
      }
    }
  }

  const { data: bfCount, error: bfErr } = await admin.rpc(
    "epoc_sync_backfill_missing_states",
    { p_limit: 50 },
  );
  if (bfErr) {
    console.warn(LOG, "backfill", bfErr.message);
  } else {
    backfilled = Number(bfCount ?? 0) || 0;
  }

  const { data: due, error: dueErr } = await admin.rpc(
    "epoc_sync_pick_due_companies",
    { p_limit: limit },
  );
  if (dueErr) {
    return json({ ok: false, error: dueErr.message }, 500);
  }

  const rows = Array.isArray(due) ? due : [];
  const details: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const cid = String((row as { company_id: string }).company_id);
    const priority = Number((row as { priority?: number }).priority ?? 0);

    // Reserva agenda para não re-pick no próximo tick enquanto o job não arranca.
    await admin.from("epoc_sync_state").update({
      next_sync_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("company_id", cid);

    const enq = await enqueueJob(admin, {
      type: "sync_company",
      companyId: cid,
      payload: {},
      priority,
    });
    if (enq.error) {
      details.push({ company_id: cid, error: enq.error });
      continue;
    }
    if (enq.id) enqueued += 1;
    details.push({ company_id: cid, job_id: enq.id });
  }

  console.log(LOG, JSON.stringify({
    fase: "dispatch",
    mode,
    backfilled,
    due: rows.length,
    enqueued,
  }));

  return json({
    ok: true,
    mode,
    backfilled,
    due: rows.length,
    enqueued,
    detail: details,
  });
});

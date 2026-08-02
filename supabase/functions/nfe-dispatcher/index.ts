/**
 * Dispatcher do pipeline NF-e (Fase 1).
 *
 * Cron: Bearer FOCUS_NFE_RECEBIDAS_CRON_SECRET
 * Manual: { manual: true, company_id?, wake?: true, window_start_date?: "YYYY-MM-DD" } + JWT
 *
 * - Backfill de empresas Focus sem nfe_sync_state
 * - Enfileira sync_company para empresas due (next_sync_at)
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { userHasCompanyAccess } from "../_shared/companyAccess.ts";
import {
  authorizeNfePipeline,
  corsHeaders,
  json,
  parseJsonBody,
} from "../_shared/nfePipeline/auth.ts";
import { enqueueSyncCompanyWithQueuedHistory } from "../_shared/nfePipeline/consultaHistory.ts";
import { dispatcherCompaniesPerTick } from "../_shared/nfePipeline/env.ts";

const LOG = "[nfe-dispatcher]";

/** Acorda o worker imediatamente (cron secret); falha é só log. */
async function wakeNfeWorker(): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
  const secret = Deno.env.get("FOCUS_NFE_RECEBIDAS_CRON_SECRET")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !secret) return;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/nfe-worker`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        apikey: serviceKey || secret,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(LOG, "wake_worker_http", res.status, text.slice(0, 200));
    }
  } catch (e) {
    console.warn(
      LOG,
      "wake_worker",
      e instanceof Error ? e.message : String(e),
    );
  }
}

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

  const limit = dispatcherCompaniesPerTick();
  let ensured: string | null = null;
  let enqueued = 0;
  let backfilled = 0;

  // Manual: ensure + wake de uma empresa
  const companyId =
    typeof body.company_id === "string" && body.company_id.trim()
      ? body.company_id.trim()
      : null;

  if (mode === "manual" && companyId) {
    if (!userId) {
      return json({ ok: false, error: "Sessão inválida." }, 401);
    }
    // Membro da unidade ou profiles.is_admin (acesso a qualquer unidade).
    if (!(await userHasCompanyAccess(admin, userId, companyId))) {
      return json({ ok: false, error: "Sem acesso a esta unidade." }, 403);
    }

    const windowDate =
      typeof body.window_start_date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(body.window_start_date)
        ? body.window_start_date
        : null;

    const { data: state, error: ensErr } = await admin.rpc(
      "nfe_sync_ensure_company",
      {
        p_company_id: companyId,
        p_window_start_date: windowDate,
        p_mode: null,
        p_wake: body.wake !== false,
      },
    );
    if (ensErr) {
      return json({ ok: false, error: ensErr.message }, 400);
    }
    ensured = companyId;

    const priority = Number((state as { priority?: number } | null)?.priority ?? 0);
    const onboarding =
      String((state as { mode?: string } | null)?.mode ?? "") === "onboarding";
    const enq = await enqueueSyncCompanyWithQueuedHistory(admin, {
      companyId,
      priority,
      onboarding,
    });
    if (enq.error) {
      return json({ ok: false, error: enq.error, ensured }, 500);
    }
    if (enq.jobId) enqueued += 1;

    console.log(LOG, JSON.stringify({
      fase: "manual_wake",
      company_id: companyId,
      job_id: enq.jobId,
      cycle_id: enq.cycleId,
    }));

    // Fire-and-forget: não esperar o worker (pode demorar e estourar o timeout do invoke).
    try {
      // deno-lint-ignore no-explicit-any
      const ER = (globalThis as any).EdgeRuntime;
      if (ER && typeof ER.waitUntil === "function") {
        ER.waitUntil(wakeNfeWorker());
      } else {
        void wakeNfeWorker();
      }
    } catch {
      void wakeNfeWorker();
    }

    return json({
      ok: true,
      mode,
      ensured,
      enqueued,
      job_id: enq.jobId,
      cycle_id: enq.cycleId,
    });
  }

  // Recupera ciclos stuck (running sem jobs abertos há > 30 min).
  {
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data: stuck } = await admin
      .from("nfe_sync_state")
      .select("company_id")
      .eq("status", "running")
      .lt("running_since", cutoff)
      .limit(50);
    for (const row of stuck ?? []) {
      const cid = String(row.company_id);
      const { count } = await admin
        .from("nfe_jobs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", cid)
        .in("status", ["queued", "leased"]);
      if ((count ?? 0) === 0) {
        await admin.from("nfe_sync_state").update({
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

  // Cron / dispatcher geral
  const { data: bfCount, error: bfErr } = await admin.rpc(
    "nfe_sync_backfill_missing_states",
    { p_limit: 50 },
  );
  if (bfErr) {
    console.warn(LOG, "backfill", bfErr.message);
  } else {
    backfilled = Number(bfCount ?? 0) || 0;
  }

  const { data: due, error: dueErr } = await admin.rpc(
    "nfe_sync_pick_due_companies",
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
    const onboarding =
      String((row as { mode?: string }).mode ?? "") === "onboarding";

    // Reserva agenda para não re-pick no próximo tick enquanto o job não arranca.
    await admin.from("nfe_sync_state").update({
      next_sync_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("company_id", cid);

    const enq = await enqueueSyncCompanyWithQueuedHistory(admin, {
      companyId: cid,
      priority,
      onboarding,
    });
    if (enq.error) {
      details.push({ company_id: cid, error: enq.error });
      continue;
    }
    if (enq.jobId) enqueued += 1;
    details.push({
      company_id: cid,
      job_id: enq.jobId,
      cycle_id: enq.cycleId,
    });
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

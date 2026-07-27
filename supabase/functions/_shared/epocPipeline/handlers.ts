import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { triggerEpocCsvImportWorker } from "../epocCsvImportOrchestrator.ts";
import {
  enqueueJob,
  loadOnboardingPdv,
  loadSyncState,
  mirrorDailyAttemptSettings,
  nextSteadySyncAtIso,
  patchOnboardingPdvFields,
} from "./db.ts";
import {
  backoffMinutes,
  onboardingEmptyPollMinutes,
} from "./env.ts";
import type { EpocJobRow, JobResult } from "./types.ts";

async function kickStalledCsvImport(
  admin: SupabaseClient,
  companyId: string,
  jobIdHint: string | null,
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceKey) return;

  let jobId = jobIdHint;
  if (!jobId) {
    const { data } = await admin
      .from("integration_csv_revenue_import_jobs")
      .select("id")
      .eq("company_id", companyId)
      .eq("provider", "epoc")
      .in("status", ["PENDING", "PROCESSING"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    jobId = data?.id ? String(data.id) : null;
  }
  if (!jobId) return;

  // O orquestrador valida heartbeat (alive < 2 min → skip; órfão → reclaim).
  const trig = await triggerEpocCsvImportWorker(
    supabaseUrl,
    serviceKey,
    jobId,
    { logTag: LOG, timeoutMs: 20_000 },
  );
  console.log(LOG, JSON.stringify({
    fase: "kick_stalled_csv_import",
    company_id: companyId,
    job_id: jobId,
    ok: trig.ok,
    error: trig.error ?? null,
  }));
}

const LOG = "[epoc-pipeline]";

function nowIso(): string {
  return new Date().toISOString();
}

function addMinutesIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

type SyncCsvResponse = {
  ok?: boolean;
  error?: string;
  outcome?: string;
  message?: string;
  csv_revenue_import_job_id?: string | null;
  storage_path?: string | null;
  tblExport_found?: boolean;
};

async function invokeEpocSyncCsv(
  companyId: string,
  syncMode: "onboarding_initial" | "previous_day",
): Promise<
  | { ok: true; data: SyncCsvResponse; status: number }
  | { ok: false; error: string; status: number; data?: SyncCsvResponse }
> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, error: "SUPABASE_URL/SERVICE_ROLE em falta", status: 500 };
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/epoc-sync-csv`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify({
      company_id: companyId,
      sync_mode: syncMode,
    }),
  });

  let data: SyncCsvResponse = {};
  try {
    data = (await res.json()) as SyncCsvResponse;
  } catch {
    data = {};
  }

  if (!res.ok || data.ok !== true) {
    return {
      ok: false,
      error: (typeof data.error === "string" && data.error) ||
        (typeof data.message === "string" && data.message) ||
        `epoc-sync-csv HTTP ${res.status}`,
      status: res.status,
      data,
    };
  }
  return { ok: true, data, status: res.status };
}

async function handleSyncCompany(
  admin: SupabaseClient,
  job: EpocJobRow,
): Promise<JobResult> {
  const companyId = job.company_id;
  let state = await loadSyncState(admin, companyId);
  if (!state) {
    const { error } = await admin.rpc("epoc_sync_ensure_company", {
      p_company_id: companyId,
      p_window_start_date: null,
      p_mode: null,
      p_wake: false,
    });
    if (error) return { ok: false, error: error.message, fatal: true };
    state = await loadSyncState(admin, companyId);
  }
  if (!state) return { ok: false, error: "epoc_sync_state ausente", fatal: true };

  // Não iniciar novo ciclo se já há import CSV ativo (evita sobrescrever sales_total).
  const { data: activeImport } = await admin
    .from("integration_csv_revenue_import_jobs")
    .select("id, status")
    .eq("company_id", companyId)
    .eq("provider", "epoc")
    .in("status", ["PENDING", "PROCESSING"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeImport?.id) {
    console.log(LOG, JSON.stringify({
      fase: "sync_company_skip_import_ativo",
      company_id: companyId,
      import_job_id: activeImport.id,
      import_status: activeImport.status,
    }));
    await admin.from("epoc_sync_state").update({
      status: "running",
      last_import_job_id: String(activeImport.id),
      last_error: null,
      updated_at: nowIso(),
    }).eq("company_id", companyId);
    await enqueueJob(admin, {
      type: "close_cycle",
      companyId,
      payload: { resume_existing_import: true },
      priority: state.priority,
      runAfter: addMinutesIso(1),
    });
    return {
      ok: true,
      detail: {
        skipped: true,
        reason: "import_ja_ativo",
        import_job_id: activeImport.id,
      },
    };
  }

  const obGuard = await loadOnboardingPdv(admin, companyId);
  if (
    state.mode === "onboarding" &&
    (obGuard.import_status === "pending" ||
      obGuard.import_status === "processing")
  ) {
    await enqueueJob(admin, {
      type: "close_cycle",
      companyId,
      payload: { resume_existing_import: true },
      priority: state.priority,
      runAfter: addMinutesIso(1),
    });
    return {
      ok: true,
      detail: { skipped: true, reason: "onboarding_import_em_curso" },
    };
  }

  const cycleId = crypto.randomUUID();
  const { error: updErr } = await admin
    .from("epoc_sync_state")
    .update({
      status: "running",
      running_since: nowIso(),
      cycle_id: cycleId,
      last_error: null,
      last_outcome: null,
      last_import_job_id: null,
      last_csv_sync_run_id: null,
      updated_at: nowIso(),
    })
    .eq("company_id", companyId);
  if (updErr) return { ok: false, error: updErr.message };

  if (state.mode === "onboarding") {
    await patchOnboardingPdvFields(admin, companyId, {
      sync: true,
      portal_busy: true,
      portal_outcome: null,
      portal_message: null,
    });
  }

  const syncMode = state.mode === "onboarding"
    ? "onboarding_initial"
    : "previous_day";

  const enqFetch = await enqueueJob(admin, {
    type: "fetch_window",
    companyId,
    payload: { sync_mode: syncMode, cycle_id: cycleId },
    priority: state.priority,
  });
  if (enqFetch.error) return { ok: false, error: enqFetch.error };

  const enqClose = await enqueueJob(admin, {
    type: "close_cycle",
    companyId,
    payload: { cycle_id: cycleId },
    priority: state.priority,
    runAfter: addMinutesIso(1),
  });
  if (enqClose.error) return { ok: false, error: enqClose.error };

  console.log(LOG, JSON.stringify({
    fase: "sync_company",
    company_id: companyId,
    cycle_id: cycleId,
    mode: state.mode,
    sync_mode: syncMode,
  }));

  return {
    ok: true,
    detail: { cycle_id: cycleId, sync_mode: syncMode },
  };
}

async function handleFetchWindow(
  admin: SupabaseClient,
  job: EpocJobRow,
): Promise<JobResult> {
  const companyId = job.company_id;
  const state = await loadSyncState(admin, companyId);
  if (!state) return { ok: false, error: "epoc_sync_state ausente", fatal: true };

  const syncMode = job.payload?.sync_mode === "previous_day"
    ? "previous_day" as const
    : state.mode === "steady"
    ? "previous_day" as const
    : "onboarding_initial" as const;

  const result = await invokeEpocSyncCsv(companyId, syncMode);

  // Onboarding sem #tblExport: epoc-sync-csv devolve 502 + outcome no_tbl_export.
  // Trata como ciclo “vazio” (empty poll), não falha técnica permanente.
  const emptyPortal =
    !result.ok &&
    (result.data?.outcome === "no_tbl_export" ||
      result.data?.tblExport_found === false);

  if (!result.ok && !emptyPortal) {
    const isConflict = result.status === 409;
    const retryMin = isConflict ? 30 : backoffMinutes();
    await admin.from("epoc_sync_state").update({
      status: "backoff",
      last_error: result.error.slice(0, 500),
      last_outcome: "failed",
      next_sync_at: addMinutesIso(retryMin),
      running_since: null,
      updated_at: nowIso(),
    }).eq("company_id", companyId);

    if (state.mode === "onboarding") {
      await patchOnboardingPdvFields(admin, companyId, {
        portal_busy: false,
        portal_outcome: "failed",
        portal_message: result.error.slice(0, 500),
      });
    }

    if (state.mode === "steady") {
      await mirrorDailyAttemptSettings(admin, companyId, false, result.error);
    }

    return {
      ok: false,
      error: result.error,
      retryAfterMs: retryMin * 60_000,
    };
  }

  if (emptyPortal) {
    await admin.from("epoc_sync_state").update({
      last_import_job_id: null,
      last_outcome: "no_tbl_export",
      last_error: null,
      updated_at: nowIso(),
    }).eq("company_id", companyId);

    await enqueueJob(admin, {
      type: "close_cycle",
      companyId,
      payload: { cycle_id: state.cycle_id },
      priority: state.priority,
    });

    console.log(LOG, JSON.stringify({
      fase: "fetch_window",
      company_id: companyId,
      sync_mode: syncMode,
      outcome: "no_tbl_export",
    }));

    return {
      ok: true,
      detail: { sync_mode: syncMode, outcome: "no_tbl_export", empty: true },
    };
  }

  if (!result.ok) {
    return { ok: false, error: result.error, retryAfterMs: 60_000 };
  }

  const importJobId = result.data.csv_revenue_import_job_id
    ? String(result.data.csv_revenue_import_job_id)
    : null;

  await admin.from("epoc_sync_state").update({
    last_import_job_id: importJobId,
    last_outcome: result.data.outcome ?? "success",
    last_error: null,
    updated_at: nowIso(),
  }).eq("company_id", companyId);

  // Garante close_cycle cedo (pode já existir do sync_company).
  await enqueueJob(admin, {
    type: "close_cycle",
    companyId,
    payload: { cycle_id: state.cycle_id },
    priority: state.priority,
  });

  console.log(LOG, JSON.stringify({
    fase: "fetch_window",
    company_id: companyId,
    sync_mode: syncMode,
    import_job_id: importJobId,
    outcome: result.data.outcome ?? null,
    tblExport_found: result.data.tblExport_found ?? null,
  }));

  return {
    ok: true,
    detail: {
      sync_mode: syncMode,
      import_job_id: importJobId,
      outcome: result.data.outcome ?? null,
    },
  };
}

async function handleCloseCycle(
  admin: SupabaseClient,
  job: EpocJobRow,
): Promise<JobResult> {
  const companyId = job.company_id;
  const state = await loadSyncState(admin, companyId);
  if (!state) return { ok: false, error: "epoc_sync_state ausente", fatal: true };

  // Ainda há fetch_window aberto → espera.
  const { count: openFetch } = await admin
    .from("epoc_jobs")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("type", "fetch_window")
    .in("status", ["queued", "leased"]);
  if ((openFetch ?? 0) > 0) {
    return {
      ok: false,
      softRequeue: true,
      error: "aguardando fetch_window",
      retryAfterMs: 30_000,
    };
  }

  // fetch_window já marcou falha/backoff — não sobrescrever agenda.
  if (
    state.last_outcome === "failed" ||
    state.status === "backoff" ||
    state.status === "needs_attention"
  ) {
    await admin.from("epoc_sync_state").update({
      running_since: null,
      cycle_id: null,
      updated_at: nowIso(),
    }).eq("company_id", companyId);
    return {
      ok: true,
      detail: {
        skipped: true,
        reason: "fetch_failed_or_backoff",
        status: state.status,
      },
    };
  }

  // Sempre respeitar import/onboarding em curso (não só last_import_job_id).
  const obWait = await loadOnboardingPdv(admin, companyId);
  const importJobHint =
    state.last_import_job_id ??
    (typeof obWait.csv_import_job_id === "string"
      ? obWait.csv_import_job_id
      : null);

  if (
    obWait.import_status === "pending" ||
    obWait.import_status === "processing"
  ) {
    // Pump da fila: se a continuação pgmq morreu, o close_cycle (cron 1 min) retoma.
    await kickStalledCsvImport(admin, companyId, importJobHint);
    return {
      ok: false,
      softRequeue: true,
      error: `aguardando onboarding_pdv.import_status=${obWait.import_status}`,
      retryAfterMs: 45_000,
    };
  }
  const salesTotal = Number(obWait.sales_total ?? 0) || 0;
  const salesSync = Number(obWait.sales_sync ?? 0) || 0;
  // Só bloqueia por progresso se o import ainda não terminou.
  if (
    obWait.import_status !== "completed" &&
    obWait.import_status !== "failed" &&
    salesTotal > 0 &&
    salesSync < salesTotal
  ) {
    await kickStalledCsvImport(admin, companyId, importJobHint);
    return {
      ok: false,
      softRequeue: true,
      error: `aguardando progresso import (${salesSync}/${salesTotal})`,
      retryAfterMs: 45_000,
    };
  }
  if (obWait.portal_busy === true) {
    return {
      ok: false,
      softRequeue: true,
      error: "aguardando portal_busy",
      retryAfterMs: 30_000,
    };
  }

  // Se houve import job, espera status terminal.
  const importJobId = state.last_import_job_id ??
    (typeof obWait.csv_import_job_id === "string"
      ? obWait.csv_import_job_id
      : null);
  if (importJobId) {
    const { data: importJob } = await admin
      .from("integration_csv_revenue_import_jobs")
      .select("status")
      .eq("id", importJobId)
      .maybeSingle();
    const st = String(importJob?.status ?? "").toUpperCase();
    if (st === "PENDING" || st === "PROCESSING") {
      await kickStalledCsvImport(admin, companyId, importJobId);
      return {
        ok: false,
        softRequeue: true,
        error: `aguardando import (${st || "?"})`,
        retryAfterMs: 45_000,
      };
    }
    if (st === "FAILED") {
      await admin.from("epoc_sync_state").update({
        status: "needs_attention",
        last_error: "import CSV falhou",
        last_outcome: "import_failed",
        running_since: null,
        cycle_id: null,
        next_sync_at: addMinutesIso(backoffMinutes()),
        updated_at: nowIso(),
      }).eq("company_id", companyId);
      if (state.mode === "steady") {
        await mirrorDailyAttemptSettings(admin, companyId, false, "import failed");
      }
      return {
        ok: true,
        detail: { needs_attention: true, import_failed: true },
      };
    }
  }

  const nextSteadyAt = await nextSteadySyncAtIso(admin);
  let nextMode = state.mode;
  let nextPriority = state.priority;
  let nextSyncAt = nextSteadyAt;
  let emptyPoll = state.empty_poll_count;
  let completedOk = false;

  if (state.mode === "onboarding") {
    const ob = await loadOnboardingPdv(admin, companyId);
    const portalFailed = ob.portal_outcome === "failed";
    const portalEmpty = ob.portal_outcome === "no_tbl_export" ||
      state.last_outcome === "no_tbl_export";
    const importFailed = ob.import_status === "failed";
    const salesTotalClose = Number(ob.sales_total ?? 0) || 0;
    const salesSyncClose = Number(ob.sales_sync ?? 0) || 0;
    // Só fecha se o import reportou completed E o progresso não está a meio.
    const importDone = ob.import_status === "completed" &&
      (salesTotalClose <= 0 || salesSyncClose >= salesTotalClose);
    const hadSales = salesTotalClose > 0 || salesSyncClose > 0;

    if (portalFailed || importFailed) {
      emptyPoll += 1;
      nextSyncAt = addMinutesIso(onboardingEmptyPollMinutes());
      nextPriority = 100;
      await admin.from("epoc_sync_state").update({
        status: "backoff",
        mode: "onboarding",
        priority: 100,
        empty_poll_count: emptyPoll,
        next_sync_at: nextSyncAt,
        running_since: null,
        cycle_id: null,
        last_error: (ob.portal_message || ob.import_error || "falha onboarding")
          ?.toString()
          .slice(0, 500) ?? "falha onboarding",
        updated_at: nowIso(),
      }).eq("company_id", companyId);
      return {
        ok: true,
        detail: { empty_poll: emptyPoll, retry_onboarding: true },
      };
    }

    // Sem vendas na janela: empty poll algumas vezes; depois fecha onboarding.
    if (portalEmpty && !hadSales) {
      emptyPoll += 1;
      if (emptyPoll < 3) {
        nextSyncAt = addMinutesIso(onboardingEmptyPollMinutes());
        await admin.from("epoc_sync_state").update({
          status: "idle",
          mode: "onboarding",
          priority: 100,
          empty_poll_count: emptyPoll,
          next_sync_at: nextSyncAt,
          running_since: null,
          cycle_id: null,
          last_outcome: "no_tbl_export",
          updated_at: nowIso(),
        }).eq("company_id", companyId);
        return {
          ok: true,
          detail: { empty_poll: emptyPoll, retry_empty: true },
        };
      }
      // Pipeline vai a steady; card do dashboard fica para o utilizador confirmar.
      completedOk = false;
      nextMode = "steady";
      nextPriority = 0;
      nextSyncAt = nextSteadyAt;
      await patchOnboardingPdvFields(admin, companyId, {
        sync: false,
        portal_busy: false,
        import_status: "completed",
        sales_total: 0,
        sales_sync: 0,
      });
    } else if (importDone) {
      // Não marca completed — o card pede «Confirmar e fechar» no dashboard.
      completedOk = false;
      nextMode = "steady";
      nextPriority = 0;
      nextSyncAt = nextSteadyAt;
      await patchOnboardingPdvFields(admin, companyId, {
        sync: false,
        portal_busy: false,
      });
    } else if (!hadSales && ob.portal_outcome === "success" &&
      ob.import_status === "completed") {
      completedOk = false;
      nextMode = "steady";
      nextPriority = 0;
      nextSyncAt = nextSteadyAt;
      await patchOnboardingPdvFields(admin, companyId, {
        sync: false,
        portal_busy: false,
      });
    } else {
      if (salesTotalClose > 0 && salesSyncClose < salesTotalClose) {
        await kickStalledCsvImport(admin, companyId, importJobHint);
      }
      return {
        ok: false,
        softRequeue: true,
        error: "aguardando conclusão do import onboarding",
        retryAfterMs: 60_000,
      };
    }
  }

  await admin.from("epoc_sync_state").update({
    mode: nextMode,
    status: "idle",
    priority: nextPriority,
    cycle_id: null,
    running_since: null,
    last_success_at: nowIso(),
    next_sync_at: nextSyncAt,
    empty_poll_count: emptyPoll,
    last_error: null,
    updated_at: nowIso(),
  }).eq("company_id", companyId);

  if (nextMode === "steady") {
    await mirrorDailyAttemptSettings(admin, companyId, true, "pipeline close_cycle");
  }

  console.log(LOG, JSON.stringify({
    fase: "close_cycle",
    company_id: companyId,
    mode: nextMode,
    completed: completedOk,
    next_sync_at: nextSyncAt,
    import_job_id: importJobId,
  }));

  return {
    ok: true,
    detail: {
      mode: nextMode,
      completed: completedOk,
      next_sync_at: nextSyncAt,
    },
  };
}

export async function runEpocJob(
  admin: SupabaseClient,
  job: EpocJobRow,
): Promise<JobResult> {
  switch (job.type) {
    case "sync_company":
      return handleSyncCompany(admin, job);
    case "fetch_window":
      return handleFetchWindow(admin, job);
    case "close_cycle":
      return handleCloseCycle(admin, job);
    default:
      return { ok: false, error: `tipo desconhecido: ${job.type}`, fatal: true };
  }
}

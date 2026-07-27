/** Insere job de import CSV EPOC e opcionalmente dispara o processador. */

// deno-lint-ignore no-explicit-any
type Admin = any;

import {
  isOnboardingPdvImportInProgress,
  patchOnboardingPdv,
  readOnboardingPdvCsvStoragePath,
} from "./onboardingPdvPatch.ts";
import {
  triggerCsvRevenueImportJob,
  type TriggerCsvRevenueImportResult,
} from "./triggerCsvRevenueImportJob.ts";
import { triggerEpocCsvImportWorker } from "./epocCsvImportOrchestrator.ts";

const DEFAULT_BUCKET = "company-setup";

export type InsertCsvRevenueImportJobResult = {
  jobId: string | null;
  error: string | null;
};

export async function insertCsvRevenueImportJob(
  admin: Admin,
  input: {
    companyId: string;
    requestedBy: string;
    storagePath: string;
    storageBucket?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<InsertCsvRevenueImportJobResult> {
  const { data: jobIns, error: jobErr } = await admin
    .from("integration_csv_revenue_import_jobs")
    .insert({
      company_id: input.companyId,
      requested_by: input.requestedBy,
      provider: "epoc",
      storage_bucket: input.storageBucket ?? DEFAULT_BUCKET,
      storage_path: input.storagePath,
      status: "PENDING",
      metadata: input.metadata ?? {},
    })
    .select("id")
    .maybeSingle();

  if (jobErr) {
    return { jobId: null, error: jobErr.message };
  }
  if (!jobIns?.id) {
    return { jobId: null, error: "Insert do job não devolveu id." };
  }
  return { jobId: String(jobIns.id), error: null };
}

export type EnqueueAndTriggerEpocCsvImportResult = {
  jobId: string | null;
  triggerOk: boolean;
  triggerError?: string;
  error?: string;
};

/** Insere job, confirma persistência e dispara `epoc-csv-import-worker`. */
export async function enqueueAndTriggerEpocCsvImport(
  admin: Admin,
  input: {
    companyId: string;
    requestedBy: string;
    storagePath: string;
    storageBucket?: string;
    metadata?: Record<string, unknown>;
    supabaseUrl: string;
    serviceKey: string;
    anonKey: string;
    logTag?: string;
  },
): Promise<EnqueueAndTriggerEpocCsvImportResult> {
  const insert = await insertCsvRevenueImportJob(admin, {
    companyId: input.companyId,
    requestedBy: input.requestedBy,
    storagePath: input.storagePath,
    storageBucket: input.storageBucket,
    metadata: input.metadata,
  });
  if (!insert.jobId) {
    return { jobId: null, triggerOk: false, error: insert.error };
  }

  const { data: verify, error: verifyErr } = await admin
    .from("integration_csv_revenue_import_jobs")
    .select("id")
    .eq("id", insert.jobId)
    .maybeSingle();
  if (verifyErr || !verify?.id) {
    return {
      jobId: null,
      triggerOk: false,
      error: verifyErr?.message ?? "Job não encontrado após insert.",
    };
  }

  const trigger = await triggerCsvRevenueImportJob(
    input.supabaseUrl,
    input.serviceKey,
    input.anonKey,
    insert.jobId,
    { logTag: input.logTag },
  );
  return {
    jobId: insert.jobId,
    triggerOk: trigger.ok,
    triggerError: trigger.error,
  };
}

/** Último CSV exportado (onboarding, integração ou run de sync bem-sucedido). */
export async function resolveLastEpocCsvStoragePath(
  admin: Admin,
  companyId: string,
): Promise<{ storagePath: string | null; storageBucket: string }> {
  const storageBucket = DEFAULT_BUCKET;

  const { data: companyRow } = await admin
    .from("companies")
    .select("onboarding_pdv")
    .eq("id", companyId)
    .maybeSingle();
  const fromOnboarding = readOnboardingPdvCsvStoragePath(
    companyRow?.onboarding_pdv,
  );
  if (fromOnboarding) {
    return { storagePath: fromOnboarding, storageBucket };
  }

  const { data: integ } = await admin
    .from("company_integrations")
    .select("settings")
    .eq("company_id", companyId)
    .eq("provider", "epoc")
    .maybeSingle();

  const settings =
    integ?.settings &&
    typeof integ.settings === "object" &&
    !Array.isArray(integ.settings)
      ? (integ.settings as Record<string, unknown>)
      : {};
  const fromSettings =
    typeof settings.last_epoc_csv_storage_path === "string"
      ? settings.last_epoc_csv_storage_path.trim()
      : "";
  if (fromSettings) {
    return { storagePath: fromSettings, storageBucket };
  }

  const { data: run } = await admin
    .from("epoc_csv_sync_runs")
    .select("metadata")
    .eq("company_id", companyId)
    .eq("outcome", "success")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const meta =
    run?.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata)
      ? (run.metadata as Record<string, unknown>)
      : {};
  const fromRun =
    typeof meta.csv_storage_path === "string" ? meta.csv_storage_path.trim() : "";
  return { storagePath: fromRun || null, storageBucket };
}

export async function epocCsvExistsInStorage(
  admin: Admin,
  bucket: string,
  path: string,
): Promise<boolean> {
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  const { data, error } = await admin.storage.from(bucket).list(folder, {
    limit: 100,
    search: name,
  });
  if (error) return false;
  return (data ?? []).some((f: { name?: string }) => f.name === name);
}

type LatestEpocImportJob = {
  id: string;
  status: string;
  storage_path: string;
  csv_resume_row_index?: number | null;
  metadata?: Record<string, unknown> | null;
};

export async function loadLatestEpocCsvImportJob(
  admin: Admin,
  companyId: string,
): Promise<LatestEpocImportJob | null> {
  const { data } = await admin
    .from("integration_csv_revenue_import_jobs")
    .select("id, status, storage_path, csv_resume_row_index, metadata")
    .eq("company_id", companyId)
    .eq("provider", "epoc")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.id) return null;
  return {
    id: String(data.id),
    status: String(data.status ?? ""),
    storage_path: String(data.storage_path ?? ""),
    csv_resume_row_index: data.csv_resume_row_index,
    metadata:
      data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : null,
  };
}

/** Job COMPLETED mas onboarding ainda preso → alinha métricas sem reimportar. */
export async function reconcileOnboardingFromCompletedCsvJob(
  admin: Admin,
  companyId: string,
  job: LatestEpocImportJob,
  logTag: string,
): Promise<boolean> {
  if (job.status !== "COMPLETED") return false;

  const meta = job.metadata ?? {};
  const totalRows =
    Number(meta.csv_total_data_rows ?? job.csv_resume_row_index ?? 0) || 0;

  await patchOnboardingPdv(
    admin,
    companyId,
    {
      sales_total: totalRows,
      sales_sync: totalRows,
      import_status: "completed",
      sync: false,
      csv_import_job_id: job.id,
      csv_storage_path: job.storage_path || null,
    },
    logTag,
  );
  return true;
}

export type RecoverEpocCsvImportResult = {
  ok: boolean;
  action?: "triggered" | "reconciled" | "recreated";
  job_id?: string;
  error?: string;
  trigger?: TriggerCsvRevenueImportResult;
};

/**
 * Retoma job ativo, reconcilia onboarding com job COMPLETED, ou recria job a partir
 * do último CSV no Storage quando o onboarding/import ficou órfão.
 */
export async function recoverEpocCsvRevenueImport(
  admin: Admin,
  input: {
    companyId: string;
    requestedBy: string;
    supabaseUrl: string;
    serviceKey: string;
    anonKey: string;
    jobIdHint?: string;
    logTag?: string;
  },
): Promise<RecoverEpocCsvImportResult> {
  const logTag = input.logTag ?? "[recoverEpocCsvImport]";
  const { companyId, requestedBy } = input;

  const { data: companyRow } = await admin
    .from("companies")
    .select("onboarding_pdv")
    .eq("id", companyId)
    .maybeSingle();

  const onboarding = companyRow?.onboarding_pdv;
  const importInProgress = isOnboardingPdvImportInProgress(onboarding);

  let activeQuery = admin
    .from("integration_csv_revenue_import_jobs")
    .select("id, status, csv_resume_row_index, updated_at")
    .eq("company_id", companyId)
    .eq("provider", "epoc")
    .in("status", ["PENDING", "PROCESSING"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (input.jobIdHint) {
    activeQuery = activeQuery.eq("id", input.jobIdHint);
  }

  const { data: activeJob, error: activeErr } = await activeQuery.maybeSingle();
  if (activeErr) {
    return { ok: false, error: activeErr.message };
  }

  if (activeJob?.id) {
    const jobId = String(activeJob.id);
    // PENDING ou PROCESSING → orquestrador (alive < 2 min faz skip; órfão reclama).
    const trigger = await triggerEpocCsvImportWorker(
      input.supabaseUrl,
      input.serviceKey,
      jobId,
      { logTag },
    );
    if (!trigger.ok) {
      return {
        ok: false,
        action: "triggered",
        job_id: jobId,
        error: trigger.error ?? "Falha ao disparar processamento.",
        trigger,
      };
    }
    return { ok: true, action: "triggered", job_id: jobId, trigger };
  }

  const latestJob = await loadLatestEpocCsvImportJob(admin, companyId);
  if (latestJob?.status === "COMPLETED" && importInProgress) {
    await reconcileOnboardingFromCompletedCsvJob(
      admin,
      companyId,
      latestJob,
      logTag,
    );
    return { ok: true, action: "reconciled", job_id: latestJob.id };
  }

  const { storagePath, storageBucket } = await resolveLastEpocCsvStoragePath(
    admin,
    companyId,
  );
  if (!storagePath) {
    return {
      ok: false,
      error:
        "Não há CSV exportado guardado. Repita a sincronização EPOC no portal.",
    };
  }

  const exists = await epocCsvExistsInStorage(admin, storageBucket, storagePath);
  if (!exists) {
    return {
      ok: false,
      error:
        "O CSV exportado já não está no Storage. Repita a sincronização EPOC.",
    };
  }

  if (
    latestJob?.status === "COMPLETED" &&
    latestJob.storage_path === storagePath
  ) {
    await reconcileOnboardingFromCompletedCsvJob(
      admin,
      companyId,
      latestJob,
      logTag,
    );
    return { ok: true, action: "reconciled", job_id: latestJob.id };
  }

  const ob =
    onboarding && typeof onboarding === "object" && !Array.isArray(onboarding)
      ? (onboarding as Record<string, unknown>)
      : null;
  const importStatus =
    typeof ob?.import_status === "string" ? ob.import_status : null;
  const mayRecreate =
    importInProgress ||
    importStatus === "pending" ||
    importStatus === "processing" ||
    ob?.sync === true;
  if (!mayRecreate) {
    return {
      ok: false,
      error:
        "Não há importação pendente nem CSV recente para reprocessar nesta unidade.",
    };
  }

  const onboardingMeta =
    onboarding &&
    typeof onboarding === "object" &&
    !Array.isArray(onboarding) &&
    (onboarding as Record<string, unknown>).sync === true
      ? { sync_mode: "onboarding_initial" as const, source: "kick-csv-revenue-import-job" }
      : { source: "kick-csv-revenue-import-job" };

  const insert = await insertCsvRevenueImportJob(admin, {
    companyId,
    requestedBy,
    storagePath,
    storageBucket,
    metadata: onboardingMeta,
  });
  if (!insert.jobId) {
    return {
      ok: false,
      error: insert.error ?? "Não foi possível criar job de importação.",
    };
  }

  await patchOnboardingPdv(
    admin,
    companyId,
    {
      import_status: "pending",
      import_error: null,
      csv_import_job_id: insert.jobId,
      csv_storage_path: storagePath,
      import_started_at: new Date().toISOString(),
    },
    logTag,
  );

  const trigger = await triggerCsvRevenueImportJob(
    input.supabaseUrl,
    input.serviceKey,
    input.anonKey,
    insert.jobId,
    { logTag },
  );
  if (!trigger.ok) {
    return {
      ok: false,
      action: "recreated",
      job_id: insert.jobId,
      error:
        trigger.error ??
        "Job criado, mas o processamento não iniciou. Tente novamente.",
      trigger,
    };
  }

  return {
    ok: true,
    action: "recreated",
    job_id: insert.jobId,
    trigger,
  };
}

/** Atualiza `companies.onboarding_pdv` durante onboarding EPOC (portal + import CSV). */

// deno-lint-ignore no-explicit-any
type Admin = any;

export type OnboardingPdvImportStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export type OnboardingPdvPatch = {
  completed?: boolean;
  sync?: boolean;
  sales_total?: number;
  sales_sync?: number;
  portal_busy?: boolean;
  portal_outcome?: string | null;
  portal_message?: string | null;
  import_status?: OnboardingPdvImportStatus | string | null;
  import_error?: string | null;
  /** Job em `integration_csv_revenue_import_jobs` (rastreio / recuperação). */
  csv_import_job_id?: string | null;
  /** CSV exportado no Storage (rastreio / recuperação sem reler integração). */
  csv_storage_path?: string | null;
  /** ISO8601 — início da fila/import CSV (UI «Retomar importação» após 15 min). */
  import_started_at?: string | null;
};

function numMetric(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0;
}

export function isOnboardingEpocCsvJobMetadata(
  meta: Record<string, unknown> | null | undefined,
): boolean {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  return meta.sync_mode === "onboarding_initial";
}

/** Job EPOC deve atualizar `onboarding_pdv` (metadata ou fluxo PDV ainda ativo). */
export async function resolveOnboardingCsvJobPatchEnabled(
  admin: Admin,
  companyId: string,
  meta: Record<string, unknown> | null | undefined,
): Promise<boolean> {
  if (isOnboardingEpocCsvJobMetadata(meta)) return true;

  const { data: row, error } = await admin
    .from("companies")
    .select("onboarding_pdv")
    .eq("id", companyId)
    .maybeSingle();
  if (error || !row) return false;

  const ob = row.onboarding_pdv;
  if (!ob || typeof ob !== "object" || Array.isArray(ob)) return false;
  const o = ob as Record<string, unknown>;
  return (
    o.sync === true ||
    isOnboardingPdvImportInProgress(ob) ||
    o.import_status === "pending" ||
    o.import_status === "processing"
  );
}

export function readOnboardingPdvCsvStoragePath(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>).csv_storage_path;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function readOnboardingPdvCsvImportJobId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>).csv_import_job_id;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function onboardingPdvPatchAllowed(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return (raw as Record<string, unknown>).completed !== true;
}

/** `onboarding_pdv.sync === true` — onboarding PDV em curso; bloqueia rotina diária EPOC. */
export function isOnboardingPdvSyncInProgress(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return (raw as Record<string, unknown>).sync === true;
}

/** Import CSV de vendas ainda não terminou (fila, chunks ou linhas em falta). */
export function isOnboardingPdvImportInProgress(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  const st = o.import_status;
  if (st === "pending" || st === "processing") return true;
  const salesTotal = numMetric(o.sales_total);
  const salesSync = numMetric(o.sales_sync);
  return salesTotal > 0 && salesSync < salesTotal;
}

/** Remove `sync: false` do patch se o import ainda estiver ativo. */
export function onboardingPdvPatchWithoutPrematureSyncClear(
  raw: unknown,
  patch: OnboardingPdvPatch,
): OnboardingPdvPatch {
  if (patch.sync !== false) return patch;
  if (patch.import_status === "completed" || patch.import_status === "failed") {
    return patch;
  }
  if (!isOnboardingPdvImportInProgress(raw)) return patch;
  const next = { ...patch };
  delete next.sync;
  return next;
}

/** Merge parcial em `onboarding_pdv` enquanto a etapa PDV não estiver concluída. */
export async function patchOnboardingPdv(
  admin: Admin,
  companyId: string,
  patch: OnboardingPdvPatch,
  logTag = "[onboarding-pdv]",
): Promise<void> {
  if (!patch || Object.keys(patch).length === 0) return;

  const { data: row, error } = await admin
    .from("companies")
    .select("onboarding_pdv")
    .eq("id", companyId)
    .maybeSingle();
  if (error || !row) {
    console.warn(logTag, "read", companyId, error?.message);
    return;
  }
  if (!onboardingPdvPatchAllowed(row.onboarding_pdv)) return;

  const effective = onboardingPdvPatchWithoutPrematureSyncClear(
    row.onboarding_pdv,
    patch,
  );
  if (Object.keys(effective).length === 0) return;

  const raw = row.onboarding_pdv;
  const prev =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  const next: Record<string, unknown> = { ...prev };

  for (const [k, v] of Object.entries(effective)) {
    if (v === undefined) continue;
    if (k === "sales_total" || k === "sales_sync") {
      next[k] = numMetric(v);
    } else {
      next[k] = v;
    }
  }

  const { error: upErr } = await admin
    .from("companies")
    .update({ onboarding_pdv: next })
    .eq("id", companyId);
  if (upErr) {
    console.warn(logTag, "update", companyId, upErr.message);
    return;
  }
  console.log(
    logTag,
    JSON.stringify({ company_id: companyId, keys: Object.keys(effective) }),
  );
}

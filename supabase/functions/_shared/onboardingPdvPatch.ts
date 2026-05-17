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

export function onboardingPdvPatchAllowed(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return (raw as Record<string, unknown>).completed !== true;
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

  const raw = row.onboarding_pdv;
  const prev =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  const next: Record<string, unknown> = { ...prev };

  for (const [k, v] of Object.entries(patch)) {
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
  console.log(logTag, JSON.stringify({ company_id: companyId, keys: Object.keys(patch) }));
}

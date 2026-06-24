import {
  mergeOnboardingPdv,
  shouldKeepOnboardingPdvSync,
  type OnboardingPdvImportStatus,
} from "@/lib/onboardingPdvDefaults";
import { supabase } from "@/lib/supabase";

function patchWithoutPrematureSyncClear(
  raw: unknown,
  patch: Parameters<typeof mergeOnboardingPdv>[1],
): Parameters<typeof mergeOnboardingPdv>[1] {
  if (patch.sync !== false) return patch;
  if (patch.import_status === "completed" || patch.import_status === "failed") {
    return patch;
  }
  if (!shouldKeepOnboardingPdvSync(raw)) return patch;
  const { sync: _sync, ...rest } = patch;
  return rest;
}

/** Atualiza `companies.onboarding_pdv` com merge parcial. */
export async function patchCompanyOnboardingPdv(
  companyId: string,
  patch: Partial<{
    completed: boolean;
    sync: boolean;
    sales_total: number;
    sales_sync: number;
    portal_busy: boolean;
    portal_outcome: string | null;
    portal_message: string | null;
    import_status: OnboardingPdvImportStatus | null;
    import_error: string | null;
    csv_import_job_id: string | null;
    csv_storage_path: string | null;
    import_started_at: string | null;
  }>,
): Promise<{ error?: string }> {
  const { data: row, error: readErr } = await supabase
    .from("companies")
    .select("onboarding_pdv")
    .eq("id", companyId)
    .maybeSingle();
  if (readErr) return { error: readErr.message };

  const effective = patchWithoutPrematureSyncClear(row?.onboarding_pdv, patch);
  if (Object.keys(effective).length === 0) return {};

  const { error } = await supabase
    .from("companies")
    .update({
      onboarding_pdv: mergeOnboardingPdv(row?.onboarding_pdv, effective),
    })
    .eq("id", companyId);
  return { error: error?.message };
}

import { mergeOnboardingPdv } from "@/lib/onboardingPdvDefaults";
import { supabase } from "@/lib/supabase";

/** Atualiza `companies.onboarding_pdv` com merge parcial. */
export async function patchCompanyOnboardingPdv(
  companyId: string,
  patch: Partial<{ completed: boolean; sync: boolean }>,
): Promise<{ error?: string }> {
  const { data: row, error: readErr } = await supabase
    .from("companies")
    .select("onboarding_pdv")
    .eq("id", companyId)
    .maybeSingle();
  if (readErr) return { error: readErr.message };

  const { error } = await supabase
    .from("companies")
    .update({
      onboarding_pdv: mergeOnboardingPdv(row?.onboarding_pdv, patch),
    })
    .eq("id", companyId);
  return { error: error?.message };
}

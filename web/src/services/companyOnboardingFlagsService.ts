import { supabase } from "@/lib/supabase";

export async function completeCompanyOnboardingFiscalStep(
  companyId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("companies")
    .update({ onboarding_fiscal_completed: true, syncing_fiscal: false })
    .eq("id", companyId);
  return { error: error?.message };
}

export async function completeCompanyOnboardingIntegrationPdvStep(
  companyId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("companies")
    .update({
      onboarding_integration_pdv_completed: true,
      syncing_pdv: false,
    })
    .eq("id", companyId);
  return { error: error?.message };
}

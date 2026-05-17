import { supabase } from "@/lib/supabase";

function mergeOnboardingFiscalFinalize(
  raw: unknown,
): Record<string, unknown> {
  const prev =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  return {
    ...prev,
    completed: true,
    sync: false,
  };
}

export async function completeCompanyOnboardingFiscalStep(
  companyId: string,
): Promise<{ error?: string }> {
  const { data: row, error: fErr } = await supabase
    .from("companies")
    .select("onboarding_fiscal")
    .eq("id", companyId)
    .maybeSingle();
  if (fErr) return { error: fErr.message };
  if (!row) return { error: "Empresa não encontrada." };

  const { error } = await supabase
    .from("companies")
    .update({
      onboarding_fiscal: mergeOnboardingFiscalFinalize(row.onboarding_fiscal),
    })
    .eq("id", companyId);
  return { error: error?.message };
}

/** Única via de produto para `onboarding_fiscal.completed = true` (confirmação manual no dashboard). */
export async function confirmOnboardingFiscalInterpretPhase(
  companyId: string,
): Promise<{ error?: string }> {
  return completeCompanyOnboardingFiscalStep(companyId);
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

import { supabase } from "@/lib/supabase";

function mergeOnboardingFiscalCompleted(
  raw: unknown,
  completed: boolean,
): Record<string, unknown> {
  const prev =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  return { ...prev, completed };
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
      onboarding_fiscal_completed: true,
      syncing_fiscal: false,
      onboarding_fiscal: mergeOnboardingFiscalCompleted(row.onboarding_fiscal, true),
    })
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

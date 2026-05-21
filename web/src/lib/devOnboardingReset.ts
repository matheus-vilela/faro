import { defaultOnboardingFiscalRecord } from "@/lib/onboardingFiscalDefaults";
import {
  defaultOnboardingPdvRecord,
  mergeOnboardingPdv,
} from "@/lib/onboardingPdvDefaults";
import { supabase } from "@/lib/supabase";

export type DevOnboardingResetTarget = "fiscal" | "pdv" | "both";

function setupObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** Lê `setup.epoc` atual (credenciais/modo PDV do wizard) sem alterar o resto do setup. */
async function readSetupEpocSnapshot(
  companyId: string,
): Promise<unknown | undefined> {
  const { data, error } = await supabase
    .from("companies")
    .select("setup")
    .eq("id", companyId)
    .maybeSingle();
  if (error) return undefined;
  const epoc = setupObject(data?.setup)?.epoc;
  return epoc === undefined ? undefined : epoc;
}

function setupEpocJsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Repõe `setup.epoc` se tiver sido alterado durante o reset de onboarding PDV. */
async function restoreSetupEpocIfChanged(
  companyId: string,
  epocSnapshot: unknown,
): Promise<{ error?: string }> {
  const { data, error: readErr } = await supabase
    .from("companies")
    .select("setup")
    .eq("id", companyId)
    .maybeSingle();
  if (readErr) return { error: readErr.message };

  const currentEpoc = setupObject(data?.setup)?.epoc;
  if (setupEpocJsonEqual(currentEpoc, epocSnapshot)) return {};

  const base = setupObject(data?.setup) ?? {};
  const { error } = await supabase
    .from("companies")
    .update({
      setup: { ...base, epoc: epocSnapshot },
    })
    .eq("id", companyId);
  if (error) return { error: error.message };
  return {};
}

/** Repõe PDV para reexibir cards e fluxo EPOC no dashboard (`sync: true`, contadores zerados). */
export function onboardingPdvRecordForDevReset(): Record<string, unknown> {
  return mergeOnboardingPdv(defaultOnboardingPdvRecord(), {
    completed: false,
    sync: true,
    sales_total: 0,
    sales_sync: 0,
    portal_busy: false,
    portal_outcome: null,
    portal_message: null,
    import_status: null,
    import_error: null,
  });
}

/**
 * Repõe `onboarding_fiscal` e/ou `onboarding_pdv` para testes no dashboard.
 * Não altera `companies.setup` — em especial preserva `setup.epoc` (passo PDV do wizard).
 */
export async function resetCompanyOnboardingForDev(
  companyId: string,
  target: DevOnboardingResetTarget,
): Promise<{ error?: string }> {
  const touchesPdv = target === "pdv" || target === "both";

  const patch: Record<string, unknown> = {};
  if (target === "fiscal" || target === "both") {
    patch.onboarding_fiscal = defaultOnboardingFiscalRecord();
  }
  if (touchesPdv) {
    patch.onboarding_pdv = onboardingPdvRecordForDevReset();
  }
  delete patch.setup;

  const { error } = await supabase
    .from("companies")
    .update(patch)
    .eq("id", companyId);
  if (error) return { error: error.message };

  return {};
}
